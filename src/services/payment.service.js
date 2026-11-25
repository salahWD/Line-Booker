// Manual Whish Money payments.
//
// • All appointment fees are paid to the PLATFORM's Whish account (platform_settings).
// • We only show the link (as a button and QR code) exactly as the admin saved it — no
//   parameters are added and the amount is never assumed to be pre-filled.
// • "I transferred the money" records a submission → payment status awaiting_verification.
//   Opening the link or submitting proof NEVER marks anything as paid.
// • Only the platform admin confirms or rejects, after checking the Whish account.
import fs from 'node:fs/promises';
import path from 'node:path';
import QRCode from 'qrcode';
import { transaction } from '../config/db.js';
import { env } from '../config/env.js';
import * as paymentModel from '../models/payment.model.js';
import * as appointmentModel from '../models/appointment.model.js';
import * as slotModel from '../models/slot.model.js';
import * as settingsService from './settings.service.js';
import * as notifications from './notification.service.js';
import * as audit from './audit.service.js';
import { assertPlatformAdmin } from './access.service.js';
import { formatMoney } from '../utils/money.js';
import { formatDate, hhmm } from '../utils/dates.js';
import { badRequest, conflict, notFound } from '../utils/errors.js';
import { t } from '../locales/ar.js';

/** Everything the payment panel shows (amount, type, reference, link + QR). */
export async function paymentPanel(detail) {
  const settings = await settingsService.getSettings();
  const url = settings.whishPaymentUrl || null;
  const qrSvg = url ? await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }) : null;
  const a = detail.appointment;
  return {
    url,
    qrSvg,
    amount: formatMoney(a.amountDue, a.currency),
    feeTypeLabel: t(`payment.feeTypes.${a.feeType}`),
    reference: a.reference,
    branchName: detail.branchName,
    businessName: detail.businessName,
    extraInstructions: settings.paymentInstructions,
    holdExpiresAt: a.holdExpiresAt,
  };
}

/**
 * Customer says they transferred the money. `file` is the optional proof already
 * checked and saved by the upload middleware.
 */
export async function submitTransfer(customer, reference, { transactionRef }, file) {
  const detail = await appointmentModel.findDetailByReference(String(reference));
  if (!detail || detail.appointment.customerId !== customer.id) throw notFound();
  const a = detail.appointment;
  if (a.status !== 'held' || a.paymentStatus !== 'unpaid') throw badRequest(t('payment.cannotSubmit'));
  if (a.holdExpiresAt && new Date(a.holdExpiresAt) <= new Date()) throw badRequest(t('appointment.holdExpired'));

  return transaction(async (tx) => {
    const updated = await appointmentModel.transition(
      a.id,
      { from: ['held'], paymentFrom: ['unpaid'] },
      // From now on the slot stays reserved until the admin decides.
      { paymentStatus: 'awaiting_verification', holdExpiresAt: null },
      tx,
    );
    if (!updated) throw conflict(t('payment.cannotSubmit'));

    const submission = await paymentModel.create(
      {
        appointmentId: a.id,
        customerId: customer.id,
        transactionRef: transactionRef.trim(),
        proofPath: file?.relativePath ?? null,
        proofMime: file?.mime ?? null,
        proofSize: file?.size ?? null,
      },
      tx,
    );
    await appointmentModel.addEvent(a.id, 'payment_submitted', customer.id, { transactionRef }, tx);
    await notifications.queueSms(tx, {
      to: customer.phone,
      kind: 'payment_submitted',
      body: notifications.message('paymentSubmitted', { ref: a.reference }),
      userId: customer.id,
      appointmentId: a.id,
    });
    return submission;
  });
}

/** Platform admin: the money arrived in the Whish account → confirm the appointment. */
export async function confirmPayment(admin, submissionId, ip) {
  assertPlatformAdmin(admin);
  return transaction(async (tx) => {
    const submission = await paymentModel.transition(
      Number(submissionId),
      'pending',
      { status: 'confirmed', reviewedById: admin.id, reviewedAt: new Date() },
      tx,
    );
    if (!submission) throw conflict('تمت معالجة هذه الدفعة مسبقاً.');

    const now = new Date();
    const appointment = await appointmentModel.transition(
      submission.appointmentId,
      { from: ['held'], paymentFrom: ['awaiting_verification'] },
      { status: 'confirmed', paymentStatus: 'confirmed', paymentConfirmedById: admin.id, paymentConfirmedAt: now, confirmedAt: now },
      tx,
    );
    // E.g. the customer cancelled meanwhile — the admin should reject (and refund outside the app).
    if (!appointment) throw conflict('لم يعد هذا الموعد بانتظار الدفع (ربما ألغاه الزبون). استخدم "رفض" وأعد المبلغ يدوياً إن لزم.');

    await appointmentModel.addEvent(appointment.id, 'payment_confirmed', admin.id, { submissionId: submission.id }, tx);
    await audit.log(tx, {
      actor: admin,
      action: 'payment.confirm',
      entityType: 'payment_submission',
      entityId: submission.id,
      businessId: appointment.businessId,
      after: { reference: appointment.reference, amount: appointment.amountDue, currency: appointment.currency },
      ip,
    });

    const detail = await appointmentModel.findDetailById(appointment.id, tx);
    await notifications.notifyCustomer(tx, {
      userId: appointment.customerId,
      phone: detail.customerPhone,
      kind: 'appointment_confirmed',
      title: t('appointment.confirmedTitle'),
      body: notifications.message('appointmentConfirmed', {
        ref: appointment.reference,
        branch: detail.branchName,
        date: formatDate(appointment.localDate, detail.timezone),
        time: hhmm(appointment.localTime),
        link: notifications.absoluteUrl(`/me/appointments/${appointment.reference}`),
      }),
      link: notifications.absoluteUrl(`/me/appointments/${appointment.reference}`),
      appointmentId: appointment.id,
    });
    return appointment; // the reminder is sent later by the job sweep
  });
}

/** Platform admin: the money did not arrive (or is wrong) → cancel and free the slot. */
export async function rejectPayment(admin, submissionId, reason, ip) {
  assertPlatformAdmin(admin);
  return transaction(async (tx) => {
    const submission = await paymentModel.transition(
      Number(submissionId),
      'pending',
      { status: 'rejected', reviewedById: admin.id, reviewedAt: new Date(), reviewNote: reason },
      tx,
    );
    if (!submission) throw conflict('تمت معالجة هذه الدفعة مسبقاً.');

    const appointment = await appointmentModel.transition(
      submission.appointmentId,
      { from: ['held'], paymentFrom: ['awaiting_verification'] },
      {
        status: 'cancelled',
        paymentStatus: 'rejected',
        cancelReason: `${t('appointment.reasonPaymentRejected')}: ${reason}`,
        cancelledAt: new Date(),
        cancelledById: admin.id,
      },
      tx,
    );
    const current = appointment ?? (await appointmentModel.findById(submission.appointmentId, tx));
    if (appointment) await slotModel.release(appointment.slotId, tx);

    await appointmentModel.addEvent(current.id, 'payment_rejected', admin.id, { reason }, tx);
    await audit.log(tx, {
      actor: admin,
      action: 'payment.reject',
      entityType: 'payment_submission',
      entityId: submission.id,
      businessId: current.businessId,
      after: { reference: current.reference, reason },
      ip,
    });
    if (appointment) {
      const detail = await appointmentModel.findDetailById(current.id, tx);
      await notifications.notifyCustomer(tx, {
        userId: current.customerId,
        phone: detail.customerPhone,
        kind: 'payment_rejected',
        title: t('payment.statusLabels.rejected'),
        body: notifications.message('paymentRejected', { ref: current.reference, reason }),
        link: notifications.absoluteUrl(`/me/appointments/${current.reference}`),
        appointmentId: current.id,
      });
    }
    return current;
  });
}

export async function adminQueue() {
  return paymentModel.listForAdmin({ statuses: ['pending'] });
}

export async function adminHistory() {
  return paymentModel.listForAdmin({ statuses: ['confirmed', 'rejected'], limit: 200 });
}

/**
 * Proof files are private: only the platform admin (who verifies) and the customer who
 * uploaded it may open them.
 */
export async function proofFile(user, submissionId) {
  const submission = await paymentModel.findById(Number(submissionId));
  if (!submission?.proofPath) throw notFound();
  const allowed = user.role === 'platform_admin' || submission.customerId === user.id;
  if (!allowed) throw notFound();
  const absolute = path.resolve(env.UPLOAD_DIR, submission.proofPath);
  if (!absolute.startsWith(path.resolve(env.UPLOAD_DIR))) throw notFound();
  await fs.access(absolute).catch(() => {
    throw notFound();
  });
  return { absolute, mime: submission.proofMime };
}

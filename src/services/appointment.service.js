// Paid date-and-time appointments.
//
//   customer picks a free slot
//        │ hold(): one place on the slot is reserved atomically (no overbooking)
//        ▼
//   held  + payment unpaid ── hold time runs out ──▶ expired (place released)
//        │ customer: "I transferred the money"  (payment.service)
//        ▼
//   held  + payment awaiting_verification   (slot stays reserved, no time limit)
//        │ platform admin confirms ──▶ confirmed + payment confirmed
//        │ platform admin rejects  ──▶ cancelled + payment rejected (place released)
//        ▼
//   confirmed ──check-in on the day──▶ checked_in (gets a ticket in the line)
//             ──ticket completed────▶ completed  → customer may leave one review
//             ──never came──────────▶ no_show
//   held/confirmed ──cancel (before the cutoff for customers)──▶ cancelled (place released)
//
// A fee of 0 skips payment: the appointment is confirmed immediately.
import { transaction, isUniqueViolation } from '../config/db.js';
import { env } from '../config/env.js';
import * as appointmentModel from '../models/appointment.model.js';
import * as slotModel from '../models/slot.model.js';
import * as lineModel from '../models/line.model.js';
import * as ticketModel from '../models/ticket.model.js';
import * as noteModel from '../models/note.model.js';
import * as paymentModel from '../models/payment.model.js';
import * as reviewModel from '../models/review.model.js';
import * as userModel from '../models/user.model.js';
import * as access from './access.service.js';
import * as audit from './audit.service.js';
import * as settings from './settings.service.js';
import * as notifications from './notification.service.js';
import * as realtime from './realtime.service.js';
import { enqueue, QUEUES } from '../jobs/boss.js';
import { appointmentReference } from '../utils/codes.js';
import { formatMoney, isFree } from '../utils/money.js';
import { formatDate, hhmm, todayIn } from '../utils/dates.js';
import { badRequest, conflict, notFound } from '../utils/errors.js';
import { t } from '../locales/ar.js';

const payLink = (reference) => notifications.absoluteUrl(`/me/appointments/${reference}`);

/** Text variables shared by appointment SMS messages. */
function smsVars(appointment, branch) {
  return {
    ref: appointment.reference,
    branch: branch.name,
    date: formatDate(appointment.localDate, branch.timezone),
    time: hhmm(appointment.localTime),
    amount: formatMoney(appointment.amountDue, appointment.currency),
    link: payLink(appointment.reference),
  };
}

/** Schedules the reminder job (it re-checks the appointment when it runs). */
export function scheduleReminder(tx, appointment) {
  const sendAt = new Date(new Date(appointment.startsAt).getTime() - env.REMINDER_HOURS_BEFORE * 3600_000);
  if (sendAt <= new Date()) return;
  tx.afterCommit(() =>
    enqueue(QUEUES.REMINDER, { appointmentId: appointment.id, startsAt: new Date(appointment.startsAt).toISOString() }, { startAfter: sendAt }),
  );
}

async function loadBookableLine(lineId) {
  const found = await lineModel.findWithBranch(Number(lineId));
  if (!found || !found.line.isActive || !found.branch.isActive || !found.businessActive) throw notFound();
  return found;
}

// ─── Booking ────────────────────────────────────────────────────────────────

export async function hold(customer, lineId, { slotId, note }) {
  const { line, branch } = await loadBookableLine(lineId);
  const free = isFree(branch.feeAmount);
  const holdMinutes = free ? 0 : await settings.holdMinutesFor(branch);

  return transaction(async (tx) => {
    const slot = await slotModel.findById(Number(slotId), tx);
    if (!slot || slot.lineId !== line.id) throw notFound();
    const earliest = Date.now() + branch.minNoticeMinutes * 60_000;
    if (new Date(slot.startsAt).getTime() < earliest) throw badRequest(t('appointment.slotTooSoon'));

    // The capacity guard: succeeds only while reserved_count < capacity.
    const reserved = await slotModel.reserve(slot.id, tx);
    if (!reserved) throw conflict(t('appointment.slotTaken'));

    const now = new Date();
    let appointment;
    try {
      appointment = await appointmentModel.create(
        {
          reference: appointmentReference(),
          slotId: slot.id,
          businessId: line.businessId,
          branchId: line.branchId,
          lineId: line.id,
          customerId: customer.id,
          startsAt: slot.startsAt,
          localDate: slot.localDate,
          localTime: slot.localTime,
          status: free ? 'confirmed' : 'held',
          holdExpiresAt: free ? null : new Date(now.getTime() + holdMinutes * 60_000),
          amountDue: branch.feeAmount,
          currency: branch.currency,
          feeType: branch.feeType,
          paymentStatus: free ? 'not_required' : 'unpaid',
          confirmedAt: free ? now : null,
          customerNote: note || null,
        },
        tx,
      );
    } catch (err) {
      if (isUniqueViolation(err, 'appointments_one_active_per_day')) throw conflict(t('appointment.duplicateDay'));
      throw err;
    }

    await appointmentModel.addEvent(appointment.id, free ? 'confirmed' : 'held', customer.id, null, tx);
    const vars = smsVars(appointment, branch);
    await notifications.queueSms(tx, {
      to: customer.phone,
      kind: free ? 'appointment_confirmed' : 'hold_created',
      body: free
        ? notifications.message('appointmentConfirmed', vars)
        : notifications.message('holdCreated', { ...vars, minutes: holdMinutes }),
      userId: customer.id,
      appointmentId: appointment.id,
    });

    if (free) scheduleReminder(tx, appointment);
    else tx.afterCommit(() => enqueue(QUEUES.HOLD_EXPIRY, { appointmentId: appointment.id }, { startAfter: appointment.holdExpiresAt }));
    return appointment;
  });
}

/** Releases an unpaid hold whose time is up (job + every-minute sweep). */
export async function expireHold(appointmentId) {
  return transaction(async (tx) => {
    const appointment = await appointmentModel.findByIdForUpdate(appointmentId, tx);
    if (!appointment || appointment.status !== 'held' || appointment.paymentStatus !== 'unpaid') return false;
    if (!appointment.holdExpiresAt || new Date(appointment.holdExpiresAt) > new Date()) return false;

    await appointmentModel.update(appointment.id, { status: 'expired', expiredAt: new Date(), holdExpiresAt: null }, tx);
    await slotModel.release(appointment.slotId, tx);
    await appointmentModel.addEvent(appointment.id, 'expired', null, null, tx);
    const customer = await userModel.findById(appointment.customerId, tx);
    await notifications.queueSms(tx, {
      to: customer?.phone,
      kind: 'hold_expired',
      body: notifications.message('holdExpired', { ref: appointment.reference }),
      userId: appointment.customerId,
      appointmentId: appointment.id,
    });
    return true;
  });
}

export async function expireDueHolds() {
  const due = await appointmentModel.dueHolds(200);
  let expired = 0;
  for (const { id } of due) if (await expireHold(id)) expired += 1;
  return expired;
}

// ─── Cancel / reschedule ────────────────────────────────────────────────────

/**
 * If the appointment has an active ticket, takes that line's lock and returns the ticket.
 * Locks are always taken line-first (like every queue action) so transactions never deadlock.
 */
async function lockTicketLine(appointmentId, tx) {
  const ticket = await ticketModel.findActiveForAppointment(appointmentId, tx);
  if (!ticket) return null;
  await lineModel.lock(ticket.lineId, tx);
  return ticketModel.findActiveForAppointment(appointmentId, tx); // re-read under the lock
}

function assertBeforeCutoff(detail) {
  const cutoff = new Date(detail.appointment.startsAt).getTime() - detail.cancellationCutoffHours * 3600_000;
  if (Date.now() > cutoff) throw badRequest(t('appointment.cancelTooLate', { hours: detail.cancellationCutoffHours }));
}

async function customerDetailOrThrow(customer, reference) {
  const detail = await appointmentModel.findDetailByReference(String(reference));
  if (!detail || detail.appointment.customerId !== customer.id) throw notFound();
  return detail;
}

export async function cancelByCustomer(customer, reference) {
  const detail = await customerDetailOrThrow(customer, reference);
  const { appointment } = detail;
  if (!['held', 'confirmed'].includes(appointment.status)) throw badRequest(t('appointment.cancelTooLate', { hours: detail.cancellationCutoffHours }));
  if (appointment.status === 'confirmed') assertBeforeCutoff(detail);

  return transaction(async (tx) => {
    const cancelled = await appointmentModel.transition(
      appointment.id,
      { from: ['held', 'confirmed'] },
      { status: 'cancelled', cancelledAt: new Date(), cancelledById: customer.id, holdExpiresAt: null },
      tx,
    );
    if (!cancelled) throw conflict(t('common.errorGeneric'));
    await slotModel.release(appointment.slotId, tx);
    await appointmentModel.addEvent(appointment.id, 'cancelled', customer.id, null, tx);
    return cancelled;
  });
}

export async function cancelByStaff(user, appointmentId, reason, ip) {
  const appointment = await appointmentModel.findById(Number(appointmentId));
  await access.assertRecordAccess(user, appointment);

  return transaction(async (tx) => {
    // Lock the line first (same order as queue actions → no deadlocks).
    const ticket = await lockTicketLine(appointment.id, tx);
    const cancelled = await appointmentModel.transition(
      appointment.id,
      { from: ['held', 'confirmed', 'checked_in'] },
      { status: 'cancelled', cancelledAt: new Date(), cancelledById: user.id, cancelReason: reason || null, holdExpiresAt: null },
      tx,
    );
    if (!cancelled) throw conflict(t('operator.alreadyHandled'));
    await slotModel.release(appointment.slotId, tx);

    // A checked-in customer also leaves the line.
    if (ticket) {
      await ticketModel.transition(ticket.id, ['waiting', 'called'], { status: 'cancelled', closedAt: new Date() }, tx);
      await realtime.notifyLineChange(tx, { lineId: ticket.lineId, branchId: ticket.branchId, type: 'cancelled' });
    }

    await appointmentModel.addEvent(appointment.id, 'cancelled', user.id, { reason }, tx);
    await audit.log(tx, { actor: user, action: 'appointment.cancel', entityType: 'appointment', entityId: appointment.id, businessId: appointment.businessId, after: { reason }, ip });
    const detail = await appointmentModel.findDetailById(appointment.id, tx);
    await notifications.queueSms(tx, {
      to: detail.customerPhone,
      kind: 'appointment_cancelled',
      body: notifications.message('appointmentCancelled', { ref: appointment.reference, branch: detail.branchName }),
      userId: appointment.customerId,
      appointmentId: appointment.id,
    });
    return cancelled;
  });
}

export async function reschedule(customer, reference, newSlotId) {
  const detail = await customerDetailOrThrow(customer, reference);
  const { appointment } = detail;
  if (!detail.allowReschedule) throw badRequest(t('appointment.rescheduleNotAllowed'));
  if (!['held', 'confirmed'].includes(appointment.status)) throw badRequest(t('appointment.rescheduleNotAllowed'));
  assertBeforeCutoff(detail);
  const { branch } = await loadBookableLine(appointment.lineId);

  return transaction(async (tx) => {
    const locked = await appointmentModel.findByIdForUpdate(appointment.id, tx);
    if (!['held', 'confirmed'].includes(locked.status)) throw conflict(t('common.errorGeneric'));

    const slot = await slotModel.findById(Number(newSlotId), tx);
    if (!slot || slot.lineId !== locked.lineId || slot.id === locked.slotId) throw notFound();
    if (new Date(slot.startsAt).getTime() < Date.now() + branch.minNoticeMinutes * 60_000) throw badRequest(t('appointment.slotTooSoon'));

    const reserved = await slotModel.reserve(slot.id, tx);
    if (!reserved) throw conflict(t('appointment.slotTaken'));
    await slotModel.release(locked.slotId, tx);

    let updated;
    try {
      updated = await appointmentModel.update(
        locked.id,
        { slotId: slot.id, startsAt: slot.startsAt, localDate: slot.localDate, localTime: slot.localTime, reminderSentAt: null },
        tx,
      );
    } catch (err) {
      if (isUniqueViolation(err, 'appointments_one_active_per_day')) throw conflict(t('appointment.duplicateDay'));
      throw err;
    }
    await appointmentModel.addEvent(
      locked.id,
      'rescheduled',
      customer.id,
      { from: `${locked.localDate} ${hhmm(locked.localTime)}`, to: `${slot.localDate} ${hhmm(slot.localTime)}` },
      tx,
    );
    if (updated.status === 'confirmed') scheduleReminder(tx, updated);
    return updated;
  });
}

export async function markNoShow(user, appointmentId) {
  const appointment = await appointmentModel.findById(Number(appointmentId));
  await access.assertRecordAccess(user, appointment);
  if (new Date(appointment.startsAt) > new Date()) throw badRequest('لا يمكن تسجيل عدم الحضور قبل وقت الموعد.');

  return transaction(async (tx) => {
    const ticket = await lockTicketLine(appointment.id, tx);
    const updated = await appointmentModel.transition(appointment.id, { from: ['confirmed', 'checked_in'] }, { status: 'no_show', noShowAt: new Date() }, tx);
    if (!updated) throw conflict(t('operator.alreadyHandled'));
    if (ticket) {
      await ticketModel.transition(ticket.id, ['waiting', 'called'], { status: 'skipped', closedAt: new Date() }, tx);
      await realtime.notifyLineChange(tx, { lineId: ticket.lineId, branchId: ticket.branchId, type: 'skipped' });
    }
    await appointmentModel.addEvent(appointment.id, 'no_show', user.id, null, tx);
    return updated;
  });
}

/** Reminder job: only sends if the appointment is still confirmed for the same time. */
export async function sendReminder(appointmentId, startsAtIso) {
  const detail = await appointmentModel.findDetailById(appointmentId);
  if (!detail) return;
  const { appointment } = detail;
  if (appointment.status !== 'confirmed' || appointment.reminderSentAt) return;
  if (new Date(appointment.startsAt).toISOString() !== startsAtIso) return; // rescheduled since

  await transaction(async (tx) => {
    await appointmentModel.update(appointment.id, { reminderSentAt: new Date() }, tx);
    await notifications.notifyCustomer(tx, {
      userId: appointment.customerId,
      phone: detail.customerPhone,
      kind: 'reminder',
      title: detail.branchName,
      body: notifications.message('reminder', { ref: appointment.reference, branch: detail.branchName, time: hhmm(appointment.localTime) }),
      link: payLink(appointment.reference),
      appointmentId: appointment.id,
    });
  });
}

/** Day close: appointments of past days that never completed become no-shows. */
export async function closePastDays(branch) {
  return transaction((tx) => appointmentModel.markPastAsNoShow(branch.id, todayIn(branch.timezone), tx));
}

// ─── Read models ────────────────────────────────────────────────────────────

const ACTIVE = ['held', 'confirmed', 'checked_in'];

export async function listForCustomer(customer) {
  const all = await appointmentModel.listForCustomer(customer.id);
  const now = Date.now();
  const upcoming = all
    .filter((a) => ACTIVE.includes(a.appointment.status) && new Date(a.appointment.startsAt).getTime() > now - 6 * 3600_000)
    .reverse();
  const past = all.filter((a) => !upcoming.includes(a));
  return { upcoming, past };
}

/** Customer view of one appointment — notes are limited to customer + shared kinds. */
export async function customerView(customer, reference) {
  const detail = await customerDetailOrThrow(customer, reference);
  const id = detail.appointment.id;
  const [events, notes, submissions, review, ticket] = await Promise.all([
    appointmentModel.listEvents(id),
    noteModel.list({ appointmentId: id, kinds: ['customer', 'shared'] }),
    paymentModel.listForAppointment(id),
    reviewModel.findByAppointment(id),
    ticketModel.findActiveForAppointment(id),
  ]);
  return { ...detail, events, notes, submissions, review, ticket };
}

export async function listForStaff(user, filters) {
  const branchIds = await access.accessibleBranchIds(user);
  return appointmentModel.listForStaff({ ...filters, branchIds });
}

/** Staff view — includes internal notes. Payment decisions are read-only here. */
export async function staffView(user, appointmentId) {
  const detail = await appointmentModel.findDetailById(Number(appointmentId));
  if (!detail) throw notFound();
  await access.assertRecordAccess(user, detail.appointment);
  const id = detail.appointment.id;
  const [events, notes, submissions, ticket] = await Promise.all([
    appointmentModel.listEvents(id),
    noteModel.list({ appointmentId: id, kinds: ['customer', 'internal', 'shared'] }),
    paymentModel.listForAppointment(id),
    ticketModel.findActiveForAppointment(id),
  ]);
  return { ...detail, events, notes, submissions, ticket };
}

// "My area": tickets, appointments, payment submission, notes, reviews, reschedule.
import * as ticketModel from '../models/ticket.model.js';
import * as lineModel from '../models/line.model.js';
import * as appointments from '../services/appointment.service.js';
import * as payments from '../services/payment.service.js';
import * as lineService from '../services/line.service.js';
import * as notes from '../services/note.service.js';
import * as reviews from '../services/review.service.js';
import * as availability from '../services/availability.service.js';
import { parse } from '../middleware/validate.js';
import { discardUpload } from '../middleware/upload.js';
import * as v from '../validators/customer.validators.js';
import { env } from '../config/env.js';
import { todayIn } from '../utils/dates.js';
import { t } from '../locales/ar.js';

export async function dashboard(req, res) {
  const [tickets, list] = await Promise.all([ticketModel.listForCustomer(req.user.id, 20), appointments.listForCustomer(req.user)]);
  res.render('pages/customer/me', {
    title: t('me.title'),
    activeTickets: tickets.filter((x) => ['waiting', 'called'].includes(x.status)),
    pastTickets: tickets.filter((x) => !['waiting', 'called'].includes(x.status)).slice(0, 10),
    upcoming: list.upcoming,
    past: list.past.slice(0, 15),
  });
}

export async function appointmentPage(req, res) {
  const view = await appointments.customerView(req.user, req.params.ref);
  const a = view.appointment;
  const needsPayment = a.status === 'held';
  res.render('pages/customer/appointment', {
    title: `${t('appointment.detailsTitle')} ${a.reference}`,
    view,
    a,
    panel: needsPayment ? await payments.paymentPanel(view) : null,
    canCancel: ['held', 'confirmed'].includes(a.status),
    canReschedule: view.allowReschedule && ['held', 'confirmed'].includes(a.status),
    canCheckIn: a.status === 'confirmed' && a.localDate === todayIn(view.timezone), // only on the day itself
    canReview: a.status === 'completed' && !view.review,
    maxUploadMb: env.MAX_UPLOAD_MB,
  });
}

export async function cancel(req, res) {
  await appointments.cancelByCustomer(req.user, req.params.ref);
  req.flash('success', t('appointment.cancelled'));
  res.redirect(`/me/appointments/${req.params.ref}`);
}

export async function checkIn(req, res) {
  const view = await appointments.customerView(req.user, req.params.ref);
  const ticket = await lineService.checkIn(req.user, view.appointment.id);
  req.flash('success', t('appointment.checkedIn'));
  res.redirect(`/t/${ticket.trackingToken}`);
}

export async function rescheduleForm(req, res) {
  const view = await appointments.customerView(req.user, req.params.ref);
  const found = await lineModel.findWithBranch(view.appointment.lineId);
  const { date } = parse(v.dateQuery, req.query);
  const dates = await availability.bookableDates(found.line, found.branch);
  const selectedDate = dates.find((d) => d.date === date)?.date ?? dates[0]?.date ?? null;
  const slots = selectedDate ? await availability.bookableSlots(found.line, found.branch, selectedDate) : [];
  res.render('pages/customer/reschedule', {
    title: t('appointment.rescheduleTitle'),
    view,
    a: view.appointment,
    dates,
    selectedDate,
    slots: slots.filter((s) => s.id !== view.appointment.slotId),
  });
}

export async function reschedule(req, res) {
  const { slotId } = parse(v.reschedule, req.body);
  await appointments.reschedule(req.user, req.params.ref, slotId);
  req.flash('success', t('appointment.rescheduled'));
  res.redirect(`/me/appointments/${req.params.ref}`);
}

/** "I transferred the money" (multipart form with optional proof file). */
export async function submitTransfer(req, res) {
  try {
    const data = parse(v.transfer, req.body);
    await payments.submitTransfer(req.user, req.params.ref, data, req.proof);
  } catch (err) {
    await discardUpload(req);
    throw err;
  }
  req.flash('success', t('payment.submitted'));
  res.redirect(`/me/appointments/${req.params.ref}`);
}

export async function proof(req, res) {
  const file = await payments.proofFile(req.user, req.params.id);
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Content-Disposition', 'inline');
  res.type(file.mime).sendFile(file.absolute);
}

export async function addNote(req, res) {
  const { body } = parse(v.note, req.body);
  const view = await appointments.customerView(req.user, req.params.ref);
  await notes.addCustomerNote(req.user, { appointmentId: view.appointment.id }, body);
  req.flash('success', t('notes.added'));
  res.redirect(`/me/appointments/${req.params.ref}#notes`);
}

export async function addReview(req, res) {
  const data = parse(v.review, req.body);
  await reviews.create(req.user, req.params.ref, data);
  req.flash('success', t('reviews.thanks'));
  res.redirect(`/me/appointments/${req.params.ref}`);
}

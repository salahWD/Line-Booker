// Operator console (also used by owners): live line control + the day's appointments.
// Queue actions are JSON endpoints called with fetch() from the console page.
import * as access from '../services/access.service.js';
import * as lineModel from '../models/line.model.js';
import * as branchModel from '../models/branch.model.js';
import * as lineService from '../services/line.service.js';
import * as appointments from '../services/appointment.service.js';
import * as notes from '../services/note.service.js';
import * as realtime from '../services/realtime.service.js';
import { parse } from '../middleware/validate.js';
import * as v from '../validators/staff.validators.js';
import { APPOINTMENT_STATUSES } from '../config/constants.js';
import { todayIn } from '../utils/dates.js';
import { clientIp } from '../utils/http.js';
import { t } from '../locales/ar.js';

/** Branches + lines this user can operate. */
async function accessibleLines(user) {
  const ids = await access.accessibleBranchIds(user);
  const branches = ids === null ? await branchModel.listAll() : await branchModel.listByIds(ids);
  const lines = await lineModel.listByBranchIds(branches.map((b) => b.id), { activeOnly: true });
  return branches.map((b) => ({ ...b, lines: lines.filter((l) => l.branchId === b.id) }));
}

export async function index(req, res) {
  const branches = await accessibleLines(req.user);
  const total = branches.reduce((n, b) => n + b.lines.length, 0);
  if (total === 1) return res.redirect(`/operator/lines/${branches.find((b) => b.lines.length).lines[0].id}`);
  res.render('pages/operator/index', { layout: 'layouts/staff', title: t('operator.title'), branches });
}

export async function consolePage(req, res) {
  const { line, branch } = await access.getLineForStaff(req.user, req.params.lineId);
  res.render('pages/operator/console', { layout: 'layouts/staff', title: `${line.name} — ${branch.name}`, line, branch });
}

export async function state(req, res) {
  res.json(await lineService.operatorView(req.user, req.params.lineId));
}

export async function events(req, res) {
  const { line } = await access.getLineForStaff(req.user, req.params.lineId);
  realtime.subscribe(req, res, [`line:${line.id}`]);
}

// ── Queue actions (JSON) ─────────────────────────────────────────

const counterOf = (req) => parse(v.counter, req.body).counterLabel;

export async function callNext(req, res) {
  const ticket = await lineService.callNext(req.user, req.params.lineId, counterOf(req));
  res.json({ ok: true, ticket: ticket ? { id: ticket.id, code: ticket.displayCode } : null, message: ticket ? null : t('operator.noneWaiting') });
}

const ticketActions = {
  call: (req) => lineService.callTicket(req.user, req.params.ticketId, counterOf(req)),
  recall: (req) => lineService.recall(req.user, req.params.ticketId),
  complete: (req) => lineService.complete(req.user, req.params.ticketId),
  skip: (req) => lineService.skip(req.user, req.params.ticketId),
  restore: (req) => lineService.restore(req.user, req.params.ticketId),
  cancel: (req) => lineService.cancel(req.user, req.params.ticketId),
};

export async function ticketAction(req, res) {
  const action = ticketActions[req.params.action];
  if (!action) return res.status(404).json({ error: { message: 'unknown action' } });
  const ticket = await action(req);
  res.json({ ok: true, ticket: { id: ticket.id, code: ticket.displayCode, status: ticket.status } });
}

export async function lineAction(req, res) {
  const { lineId, action } = req.params;
  if (action === 'pause') await lineService.setPaused(req.user, lineId, true, parse(v.pause, req.body).reason);
  else if (action === 'resume') await lineService.setPaused(req.user, lineId, false);
  else if (action === 'open') await lineService.setOpen(req.user, lineId, true);
  else if (action === 'close') await lineService.setOpen(req.user, lineId, false);
  else return res.status(404).json({ error: { message: 'unknown action' } });
  res.json({ ok: true });
}

export async function walkIn(req, res) {
  const data = parse(v.walkIn, req.body);
  const ticket = await lineService.addWalkIn(req.user, req.params.lineId, data);
  res.json({ ok: true, ticket: { id: ticket.id, code: ticket.displayCode, trackingToken: ticket.trackingToken }, message: t('operator.ticketAdded', { code: ticket.displayCode }) });
}

// ── Appointments ─────────────────────────────────────────────────

export async function appointmentsPage(req, res) {
  const branches = await accessibleLines(req.user);
  const lines = branches.flatMap((b) => b.lines.map((l) => ({ ...l, branchName: b.name })));
  const tz = branches[0]?.timezone ?? 'Asia/Beirut';
  const q = String(req.query.q ?? '').trim().slice(0, 60);
  const date = req.query.date === 'all' || q ? null : (req.query.date || todayIn(tz));
  const status = APPOINTMENT_STATUSES.includes(req.query.status) ? req.query.status : null;
  const lineId = req.query.lineId ? Number(req.query.lineId) : null;
  const list = await appointments.listForStaff(req.user, { date, lineId, status, q });
  res.render('pages/operator/appointments', {
    layout: 'layouts/staff',
    title: t('operator.appointmentsTitle'),
    list,
    lines,
    filters: { date: date ?? '', lineId, status, q },
    statuses: APPOINTMENT_STATUSES,
  });
}

export async function appointmentPage(req, res) {
  const view = await appointments.staffView(req.user, req.params.id);
  res.render('pages/operator/appointment', { layout: 'layouts/staff', title: view.appointment.reference, view, a: view.appointment });
}

export async function appointmentCheckIn(req, res) {
  const ticket = await lineService.checkIn(req.user, req.params.id, { byStaff: true });
  req.flash('success', t('operator.ticketAdded', { code: ticket.displayCode }));
  res.redirect(`/operator/appointments/${req.params.id}`);
}

export async function appointmentNoShow(req, res) {
  await appointments.markNoShow(req.user, req.params.id);
  req.flash('success', t('common.saved'));
  res.redirect(`/operator/appointments/${req.params.id}`);
}

export async function appointmentCancel(req, res) {
  const { reason } = parse(v.cancelReason, req.body);
  await appointments.cancelByStaff(req.user, req.params.id, reason, clientIp(req));
  req.flash('success', t('appointment.cancelled'));
  res.redirect(`/operator/appointments/${req.params.id}`);
}

export async function appointmentNote(req, res) {
  const { body, kind } = parse(v.staffNote, req.body);
  await notes.addStaffNote(req.user, { appointmentId: req.params.id }, kind, body);
  req.flash('success', t('notes.added'));
  res.redirect(`/operator/appointments/${req.params.id}#notes`);
}

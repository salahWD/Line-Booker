// Business owner: dashboard, branches, lines, slots, operators, reports, reviews, audit.
import * as branchService from '../services/branch.service.js';
import * as staffService from '../services/staff.service.js';
import * as availability from '../services/availability.service.js';
import * as reportService from '../services/report.service.js';
import * as reviewService from '../services/review.service.js';
import * as lineModel from '../models/line.model.js';
import { parse } from '../middleware/validate.js';
import * as v from '../validators/staff.validators.js';
import { CURRENCIES, FEE_TYPES, QUEUE_POLICIES } from '../config/constants.js';
import { isoDate } from '../validators/common.js';
import { toCsv, sendCsv } from '../utils/csv.js';
import { todayIn, addDays } from '../utils/dates.js';
import { clientIp } from '../utils/http.js';
import { t } from '../locales/ar.js';

const staffLayout = { layout: 'layouts/staff' };
const branchFormOptions = { currencies: CURRENCIES, feeTypes: FEE_TYPES };

export async function dashboard(req, res) {
  const [today, ratings] = await Promise.all([
    reportService.ownerDashboard(req.user),
    branchService.listForOwner(req.user).then((list) => reviewService.ratingByBranch(list.map((b) => b.id))),
  ]);
  res.render('pages/owner/dashboard', { ...staffLayout, title: t('owner.title'), today, ratings });
}

// ── Branches ─────────────────────────────────────────────────────

export async function branches(req, res) {
  const list = await branchService.listForOwner(req.user);
  const lines = await lineModel.listByBranchIds(list.map((b) => b.id));
  res.render('pages/owner/branches', { ...staffLayout, title: t('owner.branches'), list, lines });
}

export function newBranch(req, res) {
  res.render('pages/owner/branch-form', { ...staffLayout, ...branchFormOptions, title: t('owner.newBranch'), branch: null });
}

export async function createBranch(req, res) {
  const data = parse(v.branch, req.body);
  const branch = await branchService.create(req.user, data, clientIp(req));
  req.flash('success', t('owner.branchCreated'));
  res.redirect(`/owner/branches/${branch.id}`);
}

export async function editBranch(req, res) {
  const data = await branchService.editData(req.user, req.params.branchId);
  res.render('pages/owner/branch-form', { ...staffLayout, ...branchFormOptions, title: t('owner.editBranch'), ...data });
}

export async function updateBranch(req, res) {
  const data = parse(v.branch, req.body);
  await branchService.update(req.user, req.params.branchId, data, clientIp(req));
  req.flash('success', t('common.saved'));
  res.redirect(`/owner/branches/${req.params.branchId}`);
}

export async function saveHours(req, res) {
  const rows = parse(v.hours, req.body);
  await branchService.setHours(req.user, req.params.branchId, rows, clientIp(req));
  req.flash('success', t('common.saved'));
  res.redirect(`/owner/branches/${req.params.branchId}#hours`);
}

export async function addHoliday(req, res) {
  const { date, reason } = parse(v.holiday, req.body);
  await branchService.addHoliday(req.user, req.params.branchId, date, reason);
  req.flash('success', t('common.saved'));
  res.redirect(`/owner/branches/${req.params.branchId}#holidays`);
}

export async function removeHoliday(req, res) {
  await branchService.removeHoliday(req.user, req.params.branchId, req.params.holidayId);
  res.redirect(`/owner/branches/${req.params.branchId}#holidays`);
}

export async function regenerateDisplay(req, res) {
  await branchService.regenerateDisplayToken(req.user, req.params.branchId, clientIp(req));
  req.flash('success', t('common.saved'));
  res.redirect(`/owner/branches/${req.params.branchId}#display`);
}

// ── Lines ────────────────────────────────────────────────────────

export async function newLine(req, res) {
  const { branch } = await branchService.editData(req.user, req.params.branchId);
  res.render('pages/owner/line-form', { ...staffLayout, title: t('owner.newLine'), branch, line: null, policies: QUEUE_POLICIES });
}

export async function createLine(req, res) {
  const data = parse(v.line, req.body);
  const line = await branchService.createLine(req.user, req.params.branchId, data, clientIp(req));
  req.flash('success', t('owner.lineCreated'));
  res.redirect(`/owner/lines/${line.id}/slots`);
}

export async function editLine(req, res) {
  const { line, branch } = await branchService.lineForOwner(req.user, req.params.lineId);
  res.render('pages/owner/line-form', { ...staffLayout, title: t('owner.editLine'), branch, line, policies: QUEUE_POLICIES });
}

export async function updateLine(req, res) {
  const data = parse(v.line, req.body);
  await branchService.updateLine(req.user, req.params.lineId, data, clientIp(req));
  req.flash('success', t('common.saved'));
  res.redirect(`/owner/lines/${req.params.lineId}/edit`);
}

// ── Slots (free appointment times) ───────────────────────────────

export async function slots(req, res) {
  const { line, branch } = await branchService.lineForOwner(req.user, req.params.lineId);
  const today = todayIn(branch.timezone);
  const date = isoDate.safeParse(req.query.date).success ? req.query.date : today;
  const day = await availability.daySlots(req.user, line.id, date);
  res.render('pages/owner/slots', {
    ...staffLayout,
    title: t('owner.slotsTitle', { line: line.name }),
    line,
    branch,
    date,
    prevDate: addDays(date, -1),
    nextDate: addDays(date, 1),
    today,
    defaultTo: addDays(today, 27),
    slots: day.slots,
  });
}

export async function generateSlots(req, res) {
  const data = parse(v.slotGenerator, req.body);
  const created = await availability.generateSlots(req.user, req.params.lineId, data, clientIp(req));
  req.flash('success', t('owner.generated', { count: created }));
  res.redirect(`/owner/lines/${req.params.lineId}/slots?date=${data.fromDate}`);
}

export async function addSlot(req, res) {
  const data = parse(v.singleSlot, req.body);
  await availability.addSlot(req.user, req.params.lineId, data);
  req.flash('success', t('common.saved'));
  res.redirect(`/owner/lines/${req.params.lineId}/slots?date=${data.date}`);
}

export async function toggleSlot(req, res) {
  const slot = await availability.setSlotOpen(req.user, req.params.slotId, req.body.open === '1');
  res.redirect(`/owner/lines/${slot.lineId}/slots?date=${slot.localDate}`);
}

export async function deleteSlot(req, res) {
  const slot = await availability.deleteSlot(req.user, req.params.slotId);
  req.flash('success', t('owner.slotDeleted'));
  res.redirect(`/owner/lines/${slot.lineId}/slots?date=${slot.localDate}`);
}

export async function closeDay(req, res) {
  const { date } = parse(v.holiday.pick({ date: true }), req.body);
  const count = await availability.closeDay(req.user, req.params.lineId, date, clientIp(req));
  req.flash('success', t('owner.dayClosed', { count }));
  res.redirect(`/owner/lines/${req.params.lineId}/slots?date=${date}`);
}

// ── Operators ────────────────────────────────────────────────────

export async function operators(req, res) {
  const [list, branches] = await Promise.all([staffService.listOperators(req.user), branchService.listForOwner(req.user)]);
  res.render('pages/owner/operators', { ...staffLayout, title: t('owner.operators'), list, branches });
}

export async function newOperator(req, res) {
  const branches = await branchService.listForOwner(req.user);
  res.render('pages/owner/operator-form', { ...staffLayout, title: t('owner.newOperator'), operator: null, branches });
}

export async function createOperator(req, res) {
  const data = parse(v.operatorCreate, req.body);
  await staffService.createOperator(req.user, data, clientIp(req));
  req.flash('success', t('owner.operatorCreated'));
  res.redirect('/owner/operators');
}

export async function editOperator(req, res) {
  const [operator, branches] = await Promise.all([staffService.getOperator(req.user, req.params.id), branchService.listForOwner(req.user)]);
  res.render('pages/owner/operator-form', { ...staffLayout, title: t('owner.editOperator'), operator, branches });
}

export async function updateOperator(req, res) {
  const data = parse(v.operatorUpdate, req.body);
  await staffService.updateOperator(req.user, req.params.id, data, clientIp(req));
  req.flash('success', t('common.saved'));
  res.redirect('/owner/operators');
}

// ── Reports ──────────────────────────────────────────────────────

async function reportData(req) {
  const query = parse(v.reportQuery, req.query);
  return reportService.ownerReport(req.user, query);
}

export async function reports(req, res) {
  const [report, branches] = await Promise.all([reportData(req), branchService.listForOwner(req.user)]);
  const lines = await lineModel.listByBranchIds(branches.map((b) => b.id));
  res.render('pages/owner/reports', { ...staffLayout, title: t('reports.title'), report, branches, lines });
}

export async function exportCsv(req, res) {
  const report = await reportData(req);
  const { from, to } = report.period;
  const type = req.query.type;
  if (type === 'tickets') {
    return sendCsv(res, `tickets-${from}-${to}.csv`, toCsv(report.tickets, [
      { key: 'branch_name', label: t('common.branch') },
      { key: 'line_name', label: t('common.line') },
      { key: 'total', label: t('reports.tickets') },
      { key: 'walk_ins', label: t('reports.walkIns') },
      { key: 'from_appointments', label: t('reports.fromAppointments') },
      { key: 'served', label: t('reports.served') },
      { key: 'avg_wait', label: `${t('reports.avgWait')} (${t('reports.minutesUnit')})` },
      { key: 'p90_wait', label: `${t('reports.p90Wait')} (${t('reports.minutesUnit')})` },
      { key: 'accuracy', label: `${t('reports.accuracy')} %` },
      { key: 'mae', label: `${t('reports.mae')} (${t('reports.minutesUnit')})` },
    ]));
  }
  if (type === 'fees') {
    return sendCsv(res, `fees-${from}-${to}.csv`, toCsv(report.fees, [
      { key: 'branch_name', label: t('common.branch') },
      { key: 'currency', label: t('common.currency') },
      { key: 'expected', label: t('reports.expectedFees') },
      { key: 'confirmed', label: t('reports.confirmedFees') },
      { key: 'awaiting', label: t('payment.statusLabels.awaiting_verification') },
    ]));
  }
  if (type === 'daily') {
    return sendCsv(res, `daily-${from}-${to}.csv`, toCsv(report.daily, [
      { key: 'day', label: t('common.date') },
      { key: 'completed', label: t('reports.attended') },
      { key: 'noShow', label: t('reports.noShows') },
      { key: 'cancelled', label: t('reports.cancellations') },
      { key: 'tickets', label: t('reports.tickets') },
      { key: 'avgWait', label: t('reports.avgWait') },
    ]));
  }
  return sendCsv(res, `appointments-${from}-${to}.csv`, toCsv(report.appointments, [
    { key: 'branch_name', label: t('common.branch') },
    { key: 'line_name', label: t('common.line') },
    { key: 'total', label: t('reports.appointments') },
    { key: 'completed', label: t('reports.attended') },
    { key: 'no_show', label: t('reports.noShows') },
    { key: 'cancelled', label: t('reports.cancellations') },
    { key: 'expired', label: t('reports.expired') },
    { key: 'attendanceRate', label: `${t('reports.attendanceRate')} %` },
  ]));
}

// ── Reviews & audit ──────────────────────────────────────────────

export async function reviews(req, res) {
  const branchId = req.query.branchId ? Number(req.query.branchId) : undefined;
  const [list, branches] = await Promise.all([reviewService.listForOwner(req.user, { branchId }), branchService.listForOwner(req.user)]);
  res.render('pages/owner/reviews', { ...staffLayout, title: t('owner.reviews'), list, branches, branchId });
}

export async function replyReview(req, res) {
  const { reply } = parse(v.reply, req.body);
  await reviewService.reply(req.user, req.params.id, reply, clientIp(req));
  req.flash('success', t('reviews.replied'));
  res.redirect('/owner/reviews');
}

export async function audit(req, res) {
  const logs = await reportService.auditLog({ businessId: req.user.businessId });
  res.render('pages/owner/audit', { ...staffLayout, title: t('owner.audit'), logs });
}

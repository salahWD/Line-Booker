// Appointment booking flow: branch → line → date → time → hold.
import * as branchModel from '../models/branch.model.js';
import * as lineModel from '../models/line.model.js';
import * as availability from '../services/availability.service.js';
import * as appointments from '../services/appointment.service.js';
import * as settings from '../services/settings.service.js';
import { parse } from '../middleware/validate.js';
import * as v from '../validators/customer.validators.js';
import { isFree, formatMoney } from '../utils/money.js';
import { notFound } from '../utils/errors.js';
import { t } from '../locales/ar.js';

async function loadBranchAndLine(slug, lineId) {
  const found = await branchModel.findPublicBySlug(String(slug));
  if (!found) throw notFound();
  const lines = await lineModel.listByBranch(found.branch.id, { activeOnly: true });
  const line = lineId ? lines.find((l) => l.id === Number(lineId)) : null;
  if (lineId && !line) throw notFound();
  return { ...found, lines, line };
}

/** Step 1: choose a line (skipped when the branch has only one). */
export async function chooseLine(req, res) {
  const { branch, businessName, lines } = await loadBranchAndLine(req.params.slug);
  if (lines.length === 1) return res.redirect(`/book/${branch.slug}/${lines[0].id}`);
  res.render('pages/customer/book-line', { title: t('appointment.bookTitle'), branch, businessName, lines });
}

/** Step 2: dates as chips, then the free times of the selected date. */
export async function chooseSlot(req, res) {
  const { branch, businessName, line, lines } = await loadBranchAndLine(req.params.slug, req.params.lineId);
  const { date } = parse(v.dateQuery, req.query);
  const dates = await availability.bookableDates(line, branch);
  const selectedDate = dates.find((d) => d.date === date)?.date ?? dates[0]?.date ?? null;
  const slots = selectedDate ? await availability.bookableSlots(line, branch, selectedDate) : [];
  res.render('pages/customer/book-slot', {
    title: t('appointment.bookTitle'),
    branch,
    businessName,
    line,
    hasManyLines: lines.length > 1,
    dates,
    selectedDate,
    slots,
    free: isFree(branch.feeAmount),
    feeText: formatMoney(branch.feeAmount, branch.currency),
    holdMinutes: await settings.holdMinutesFor(branch),
  });
}

/** Step 3: hold the slot and go to the appointment page (payment instructions). */
export async function hold(req, res) {
  const { line } = await loadBranchAndLine(req.params.slug, req.params.lineId);
  const data = parse(v.hold, req.body);
  const appointment = await appointments.hold(req.user, line.id, data);
  req.flash('success', t(appointment.status === 'held' ? 'appointment.heldTitle' : 'appointment.confirmedTitle'));
  res.redirect(`/me/appointments/${appointment.reference}`);
}

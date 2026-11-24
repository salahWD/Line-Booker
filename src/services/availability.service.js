// Appointment slots: owners publish free times, customers see what is still bookable.
// Slots belong to a line (e.g. one clinic) and are stored in UTC plus branch-local date/time.
import { transaction } from '../config/db.js';
import * as slotModel from '../models/slot.model.js';
import * as branchModel from '../models/branch.model.js';
import * as access from './access.service.js';
import * as audit from './audit.service.js';
import { dateRange, weekdayOf, localToDate, todayIn, addDays, hhmm, dayChip } from '../utils/dates.js';
import { badRequest, notFound } from '../utils/errors.js';
import { LIMITS } from '../config/constants.js';
import { t } from '../locales/ar.js';

const toMinutes = (hm) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
const fromMinutes = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** Owner check for slot management: the line must belong to the owner's business. */
async function lineForOwner(user, lineId) {
  const found = await access.getLineForStaff(user, lineId);
  access.assertOwnerOf(user, found.line.businessId);
  return found;
}

/**
 * Creates free slots in bulk, e.g. "every Mon–Thu from 09:00 to 13:00, 20 minutes each".
 * Holidays, past times and already-existing slots are skipped.
 */
export async function generateSlots(user, lineId, input, ip) {
  const { line, branch } = await lineForOwner(user, lineId);
  const { fromDate, toDate, weekdays, startTime, endTime, slotMinutes, capacity } = input;

  const days = dateRange(fromDate, toDate);
  if (!days.length) throw badRequest('تاريخ البداية يجب أن يسبق تاريخ النهاية.');
  if (days.length > LIMITS.slotGeneratorMaxDays) throw badRequest(`الحد الأقصى ${LIMITS.slotGeneratorMaxDays} يوماً في المرة الواحدة.`);
  const start = toMinutes(startTime);
  const end = toMinutes(endTime);
  if (end - start < slotMinutes) throw badRequest('الفترة الزمنية أقصر من مدة الموعد.');

  const holidays = await branchModel.holidayDates(branch.id, fromDate, toDate);
  const now = new Date();
  const slots = [];
  for (const date of days) {
    if (!weekdays.includes(weekdayOf(date)) || holidays.has(date)) continue;
    for (let m = start; m + slotMinutes <= end; m += slotMinutes) {
      const localTime = fromMinutes(m);
      const startsAt = localToDate(date, localTime, branch.timezone);
      if (startsAt <= now) continue;
      slots.push({
        businessId: line.businessId,
        branchId: line.branchId,
        lineId: line.id,
        startsAt,
        localDate: date,
        localTime,
        durationMinutes: slotMinutes,
        capacity,
      });
    }
  }

  return transaction(async (tx) => {
    let created = 0;
    for (let i = 0; i < slots.length; i += 500) created += await slotModel.insertMany(slots.slice(i, i + 500), tx);
    await audit.log(tx, {
      actor: user,
      action: 'slots.generate',
      entityType: 'line',
      entityId: line.id,
      businessId: line.businessId,
      after: { ...input, created },
      ip,
    });
    return created;
  });
}

/** Owner calendar: all slots of one day with how many are booked. */
export async function daySlots(user, lineId, date) {
  const { line, branch } = await lineForOwner(user, lineId);
  const slots = await slotModel.listDay(line.id, date);
  const booked = await slotModel.bookingsBySlot(slots.map((s) => s.id));
  return {
    line,
    branch,
    slots: slots.map((s) => ({ ...s, time: hhmm(s.localTime), booked: booked[s.id] ?? 0 })),
  };
}

export async function addSlot(user, lineId, { date, time, durationMinutes, capacity }) {
  const { line, branch } = await lineForOwner(user, lineId);
  const startsAt = localToDate(date, time, branch.timezone);
  if (startsAt <= new Date()) throw badRequest('لا يمكن إضافة موعد في وقت مضى.');
  const created = await slotModel.insertMany([
    { businessId: line.businessId, branchId: line.branchId, lineId: line.id, startsAt, localDate: date, localTime: time, durationMinutes, capacity },
  ]);
  if (!created) throw badRequest('يوجد موعد في هذا الوقت مسبقاً.');
}

async function slotForOwner(user, slotId) {
  const slot = await slotModel.findById(Number(slotId));
  if (!slot) throw notFound();
  await lineForOwner(user, slot.lineId);
  return slot;
}

export async function setSlotOpen(user, slotId, isOpen) {
  const slot = await slotForOwner(user, slotId);
  return slotModel.setOpen(slot.id, isOpen);
}

export async function deleteSlot(user, slotId) {
  const slot = await slotForOwner(user, slotId);
  const deleted = await slotModel.deleteIfUnused(slot.id);
  if (!deleted) throw badRequest(t('owner.slotHasBookings'));
  return slot;
}

export async function closeDay(user, lineId, date, ip) {
  const { line } = await lineForOwner(user, lineId);
  return transaction(async (tx) => {
    const count = await slotModel.closeDay(line.id, date, tx);
    await audit.log(tx, { actor: user, action: 'slots.close_day', entityType: 'line', entityId: line.id, businessId: line.businessId, after: { date, count }, ip });
    return count;
  });
}

// ─── Customer side ──────────────────────────────────────────────────────────

/** Earliest bookable moment: now + the branch's minimum notice. */
const earliestFor = (branch) => new Date(Date.now() + branch.minNoticeMinutes * 60_000);

export async function bookableDates(line, branch) {
  const window = Math.min(branch.bookingWindowDays, LIMITS.bookingWindowDays);
  const lastDate = addDays(todayIn(branch.timezone), window);
  const dates = await slotModel.bookableDates(line.id, earliestFor(branch), lastDate);
  return dates.map((d) => ({ ...d, ...dayChip(d.date, branch.timezone) }));
}

export async function bookableSlots(line, branch, date) {
  const slots = await slotModel.bookableSlots(line.id, date, earliestFor(branch));
  return slots.map((s) => ({ id: s.id, time: hhmm(s.localTime), remaining: s.capacity - s.reservedCount, duration: s.durationMinutes }));
}

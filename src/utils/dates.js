// Time helpers. Rule of thumb used everywhere:
//   - instants (timestamps) are stored in UTC (timestamptz)
//   - calendar days and wall-clock times are stored in the BRANCH's timezone ('YYYY-MM-DD', 'HH:mm')
import { DateTime, Settings } from 'luxon';

// Machine formats (toFormat('HH:mm'), ISO dates sent to SQL) must always use Western digits,
// so Luxon's defaults stay neutral; Arabic is applied only to human-readable dates below.
Settings.defaultLocale = 'en-GB';
Settings.defaultNumberingSystem = 'latn';

// Levantine Arabic month names ("تشرين الثاني") with Western digits.
const AR = { locale: 'ar-LB', numberingSystem: 'latn' };

/** Current moment in the given timezone (Luxon DateTime). */
export const nowIn = (tz) => DateTime.now().setZone(tz);

/** Today's calendar date in the given timezone, e.g. '2026-11-23'. */
export const todayIn = (tz) => nowIn(tz).toISODate();

/** Branch-local date + time → JS Date (UTC instant). */
export function localToDate(isoDate, hhmm, tz) {
  return DateTime.fromISO(`${isoDate}T${hhmm.slice(0, 5)}`, { zone: tz }).toJSDate();
}

/** JS Date → DateTime in the given zone. */
export const inZone = (date, tz) => DateTime.fromJSDate(new Date(date)).setZone(tz);

/** "10:45" */
export const formatTime = (date, tz) => (date ? inZone(date, tz).toFormat('HH:mm') : '');

/** "الاثنين 23 تشرين الثاني 2026" — for a 'YYYY-MM-DD' string or a Date. */
export function formatDate(value, tz) {
  if (!value) return '';
  const dt = typeof value === 'string' ? DateTime.fromISO(value, { zone: tz }) : inZone(value, tz);
  return dt.reconfigure(AR).toFormat('cccc d LLLL yyyy');
}

/** Short day label for date chips: { weekday: 'الاثنين', day: '23 تشرين الثاني' } */
export function dayChip(isoDate, tz) {
  const dt = DateTime.fromISO(isoDate, { zone: tz }).reconfigure(AR);
  return { weekday: dt.toFormat('cccc'), day: dt.toFormat('d LLLL') };
}

/** "23/11/2026 10:45" */
export function formatDateTime(date, tz) {
  return date ? inZone(date, tz).toFormat('dd/MM/yyyy HH:mm') : '';
}

/** 'HH:mm:ss' (Postgres time) → 'HH:mm' */
export const hhmm = (t) => (t ? String(t).slice(0, 5) : '');

/** ISO weekday (1 = Monday … 7 = Sunday) of a 'YYYY-MM-DD' date. */
export const weekdayOf = (isoDate) => DateTime.fromISO(isoDate).weekday;

/** Inclusive list of 'YYYY-MM-DD' strings between two dates. */
export function dateRange(fromIso, toIso) {
  const out = [];
  let d = DateTime.fromISO(fromIso);
  const end = DateTime.fromISO(toIso);
  while (d <= end) {
    out.push(d.toISODate());
    d = d.plus({ days: 1 });
  }
  return out;
}

export const addDays = (isoDate, days) => DateTime.fromISO(isoDate).plus({ days }).toISODate();

export const minutesBetween = (a, b) => (new Date(b) - new Date(a)) / 60000;

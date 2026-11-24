// Waiting-time estimate for a line.
//
// 1. Pace = minutes between two consecutive calls ("one number every X minutes").
//    It already includes how many counters are serving. Picked from, in order:
//      live       → today's calls in the last 2 hours (paused time removed), ≥ 5 gaps
//      history    → same weekday, ±1 hour around now, last 4 weeks, ≥ 8 gaps
//      configured → owner's "average minutes per customer" ÷ number of counters
// 2. Some people ahead will not show up (skipped); "ahead" is reduced by today's skip rate.
// 3. Wait ≈ effectiveAhead × pace + pace / 2   (half a service for the person at the counter)
// 4. Shown as a range that is wider when the data is less reliable.
import * as ticketModel from '../models/ticket.model.js';
import * as lineModel from '../models/line.model.js';
import { nowIn, todayIn, addDays, formatTime } from '../utils/dates.js';

const LIVE_WINDOW_MINUTES = 120;
const MIN_LIVE_GAPS = 5;
const MIN_HISTORY_GAPS = 8;
const RANGE = { live: [0.8, 1.3], history: [0.7, 1.5], configured: [0.6, 1.7] };
const CACHE_MS = 15_000;

const cache = new Map(); // lineId → { at, stats }

/** Drop the cached pace after a queue change so the next estimate uses fresh data. */
export function invalidate(lineId) {
  cache.delete(lineId);
}

const average = (values) => values.reduce((sum, v) => sum + v, 0) / values.length;

/** Minutes of [from, to] that fall inside a pause. */
function pausedMinutes(pauses, from, to) {
  let total = 0;
  for (const p of pauses) {
    const start = Math.max(new Date(p.pausedAt).getTime(), from.getTime());
    const end = Math.min(new Date(p.resumedAt ?? Date.now()).getTime(), to.getTime());
    if (end > start) total += (end - start) / 60_000;
  }
  return total;
}

/** Returns { pace, method, skipRate } for a line. */
export async function getStats(line, timezone) {
  const hit = cache.get(line.id);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.stats;

  const now = new Date();
  const windowStart = new Date(now.getTime() - LIVE_WINDOW_MINUTES * 60_000);
  const [calls, pauses] = await Promise.all([
    ticketModel.callTimesSince(line.id, windowStart),
    lineModel.pausesSince(line.id, windowStart),
  ]);

  const gaps = [];
  for (let i = 1; i < calls.length; i += 1) {
    const from = new Date(calls[i - 1]);
    const to = new Date(calls[i]);
    const gap = (to - from) / 60_000 - pausedMinutes(pauses, from, to);
    if (gap > 0.1 && gap < 60) gaps.push(gap);
  }

  let pace;
  let method;
  if (gaps.length >= MIN_LIVE_GAPS) {
    pace = average(gaps);
    method = 'live';
  } else {
    const local = nowIn(timezone);
    const today = local.toISODate();
    const history = await ticketModel.historicalCallGap({
      lineId: line.id,
      timezone,
      fromDate: addDays(today, -28),
      toDate: today,
      isoWeekday: local.weekday,
      timeFrom: local.minus({ hours: 1 }).toFormat('HH:mm'),
      timeTo: local.plus({ hours: 1 }).toFormat('HH:mm'),
    });
    if (history.samples >= MIN_HISTORY_GAPS && history.avgGap) {
      pace = history.avgGap;
      method = 'history';
    } else {
      pace = line.avgMinutesPerCustomer / Math.max(1, line.countersCount);
      method = 'configured';
    }
  }

  const skip = await ticketModel.todaySkipStats(line.id, todayIn(timezone));
  const skipRate = skip.called >= 10 ? Math.min(0.5, skip.skipped / skip.called) : 0;

  const stats = { pace, method, skipRate };
  cache.set(line.id, { at: Date.now(), stats });
  return stats;
}

function roundRange(low, high) {
  if (high > 15) return [Math.floor(low / 5) * 5, Math.ceil(high / 5) * 5];
  return [Math.floor(low), Math.max(Math.ceil(high), Math.floor(low) + 1)];
}

/**
 * Estimate for someone with `ahead` people in front of them.
 * @returns {{ahead, paceMinutes, lowMin, highMin, expectedFrom, expectedTo, method, computedAt, paused}}
 */
export function estimateWait(stats, ahead, { timezone, paused = false, now = new Date() } = {}) {
  const effectiveAhead = ahead * (1 - stats.skipRate);
  const middle = effectiveAhead * stats.pace + stats.pace / 2;
  const [lowFactor, highFactor] = RANGE[stats.method];
  const [lowMin, highMin] = roundRange(middle * lowFactor, middle * highFactor);
  return {
    ahead,
    paceMinutes: Math.round(stats.pace * 10) / 10,
    lowMin,
    highMin,
    expectedFrom: formatTime(new Date(now.getTime() + lowMin * 60_000), timezone),
    expectedTo: formatTime(new Date(now.getTime() + highMin * 60_000), timezone),
    method: stats.method,
    computedAt: now.toISOString(),
    paused,
  };
}

// Report queries (aggregates). Dates are branch-local calendar days ('YYYY-MM-DD').
// MySQL returns SUM/AVG as decimal strings, so every query converts its numeric fields.
// `sum(condition)` counts the rows where the condition is true (MySQL booleans are 0/1).
import { sql } from 'drizzle-orm';
import { rows, numbers } from './db-helpers.js';
import { todayIn } from '../utils/dates.js';

/** Optional filters shared by the owner reports. */
function filters(alias, { businessId, branchId, lineId }) {
  const parts = [];
  if (businessId) parts.push(sql`and ${sql.raw(alias)}.business_id = ${businessId}`);
  if (branchId) parts.push(sql`and ${sql.raw(alias)}.branch_id = ${branchId}`);
  if (lineId) parts.push(sql`and ${sql.raw(alias)}.line_id = ${lineId}`);
  return sql.join(parts, sql` `);
}

export async function appointmentSummary(f) {
  const result = await rows(sql`
    select a.branch_id, b.name as branch_name, a.line_id, l.name as line_name,
           count(*) as total,
           sum(a.status = 'completed') as completed,
           sum(a.status = 'no_show') as no_show,
           sum(a.status = 'cancelled') as cancelled,
           sum(a.status = 'expired') as expired,
           sum(a.status in ('held', 'confirmed', 'checked_in')) as open
    from appointments a
    join branches b on b.id = a.branch_id
    join \`lines\` l on l.id = a.line_id
    where a.local_date between ${f.from} and ${f.to} ${filters('a', f)}
    group by a.branch_id, b.name, a.line_id, l.name
    order by b.name, l.name
  `);
  return numbers(result, ['total', 'completed', 'no_show', 'cancelled', 'expired', 'open']);
}

/** Expected fees (bookings that were not cancelled/expired) vs fees the platform admin confirmed. */
export async function feeSummary(f) {
  const result = await rows(sql`
    select a.branch_id, b.name as branch_name, a.currency,
           coalesce(sum(case when a.payment_status <> 'not_required' and a.status not in ('cancelled', 'expired')
                             then a.amount_due end), 0) as expected,
           coalesce(sum(case when a.payment_status = 'confirmed' then a.amount_due end), 0) as confirmed,
           sum(a.payment_status = 'awaiting_verification') as awaiting
    from appointments a
    join branches b on b.id = a.branch_id
    where a.local_date between ${f.from} and ${f.to} ${filters('a', f)}
    group by a.branch_id, b.name, a.currency
    order by b.name, a.currency
  `);
  return numbers(result, ['expected', 'confirmed', 'awaiting']);
}

/** Continuous 90th percentile (same result as PostgreSQL's percentile_cont(0.9)). */
function p90(sortedValues) {
  if (!sortedValues.length) return null;
  const pos = (sortedValues.length - 1) * 0.9;
  const low = Math.floor(pos);
  const high = Math.ceil(pos);
  return sortedValues[low] + (sortedValues[high] - sortedValues[low]) * (pos - low);
}

/**
 * Line activity: volume, real waiting time and estimate accuracy.
 * "within range" = the real wait (join → first call) fell inside the range shown at join time.
 */
export async function ticketSummary(f) {
  const result = await rows(sql`
    select t.branch_id, b.name as branch_name, t.line_id, l.name as line_name,
           count(*) as total,
           sum(t.source = 'walk_in') as walk_ins,
           sum(t.source = 'appointment') as from_appointments,
           sum(t.status = 'completed') as served,
           sum(t.status in ('skipped', 'cancelled', 'expired')) as not_served,
           round(avg(t.actual_wait_seconds) / 60.0, 1) as avg_wait,
           sum(t.actual_wait_seconds is not null and t.estimate_low_min is not null) as estimated,
           sum(t.actual_wait_seconds is not null and t.estimate_low_min is not null
               and t.actual_wait_seconds / 60.0 between t.estimate_low_min and t.estimate_high_min) as within_range,
           round(avg(case when t.actual_wait_seconds is not null and t.estimate_low_min is not null
                          then abs(t.actual_wait_seconds / 60.0 - (t.estimate_low_min + t.estimate_high_min) / 2.0) end), 1) as mae
    from queue_tickets t
    join branches b on b.id = t.branch_id
    join \`lines\` l on l.id = t.line_id
    where t.service_date between ${f.from} and ${f.to} ${filters('t', f)}
    group by t.branch_id, b.name, t.line_id, l.name
    order by b.name, l.name
  `);
  numbers(result, ['total', 'walk_ins', 'from_appointments', 'served', 'not_served', 'avg_wait', 'estimated', 'within_range', 'mae']);

  // 90th percentile of the real wait per line (MySQL has no percentile function).
  const waits = await rows(sql`
    select t.line_id, t.actual_wait_seconds as w
    from queue_tickets t
    where t.service_date between ${f.from} and ${f.to} ${filters('t', f)} and t.actual_wait_seconds is not null
    order by t.line_id, t.actual_wait_seconds
  `);
  const byLine = new Map();
  for (const { line_id: lineId, w } of waits) {
    if (!byLine.has(lineId)) byLine.set(lineId, []);
    byLine.get(lineId).push(Number(w));
  }
  for (const row of result) {
    const value = p90(byLine.get(row.line_id) ?? []);
    row.p90_wait = value == null ? null : Math.round((value / 60) * 10) / 10;
  }
  return result;
}

export async function appointmentsDaily(f) {
  const result = await rows(sql`
    select a.local_date as day,
           sum(a.status = 'completed') as completed,
           sum(a.status = 'no_show') as no_show,
           sum(a.status in ('cancelled', 'expired')) as cancelled,
           sum(a.status in ('held', 'confirmed', 'checked_in')) as open
    from appointments a
    where a.local_date between ${f.from} and ${f.to} ${filters('a', f)}
    group by a.local_date order by a.local_date
  `);
  return numbers(result, ['completed', 'no_show', 'cancelled', 'open']);
}

export async function ticketsDaily(f) {
  const result = await rows(sql`
    select t.service_date as day, count(*) as tickets,
           round(avg(t.actual_wait_seconds) / 60.0, 1) as avg_wait
    from queue_tickets t
    where t.service_date between ${f.from} and ${f.to} ${filters('t', f)}
    group by t.service_date order by t.service_date
  `);
  return numbers(result, ['tickets', 'avg_wait']);
}

/** Platform admin: fees it confirmed, per business/branch/currency — for manual settlement. */
export async function settlement({ from, to }) {
  const result = await rows(sql`
    select bu.name as business_name, b.name as branch_name, a.currency,
           count(*) as count, sum(a.amount_due) as total
    from appointments a
    join branches b on b.id = a.branch_id
    join businesses bu on bu.id = a.business_id
    where a.payment_status = 'confirmed'
      and a.payment_confirmed_at >= ${from}
      and a.payment_confirmed_at < date_add(${to}, interval 1 day)
    group by bu.name, b.name, a.currency
    order by bu.name, b.name, a.currency
  `);
  return numbers(result, ['count', 'total']);
}

/** Owner dashboard numbers for today, per branch ("today" in each branch's own timezone). */
export async function ownerToday(businessId) {
  const branchRows = await rows(sql`select id, name, timezone from branches where business_id = ${businessId} order by name`);
  const result = [];
  for (const b of branchRows) {
    const today = todayIn(b.timezone);
    const [row] = await rows(sql`
      select
        (select count(*) from queue_tickets t where t.branch_id = ${b.id} and t.service_date = ${today}) as tickets_today,
        (select count(*) from queue_tickets t where t.branch_id = ${b.id} and t.status = 'waiting') as waiting_now,
        (select count(*) from appointments a where a.branch_id = ${b.id} and a.local_date = ${today}
           and a.status in ('confirmed', 'checked_in', 'completed')) as appointments_today,
        (select count(*) from appointments a where a.branch_id = ${b.id} and a.payment_status = 'awaiting_verification') as awaiting_payments
    `);
    result.push({ branch_id: b.id, branch_name: b.name, ...row });
  }
  return numbers(result, ['tickets_today', 'waiting_now', 'appointments_today', 'awaiting_payments']);
}

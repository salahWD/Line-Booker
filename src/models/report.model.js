// Report queries (aggregates). Dates are branch-local calendar days ('YYYY-MM-DD').
import { sql } from 'drizzle-orm';
import { rows } from './db-helpers.js';

/** Optional filters shared by the owner reports. */
function filters(alias, { businessId, branchId, lineId }) {
  const parts = [];
  if (businessId) parts.push(sql`and ${sql.raw(alias)}.business_id = ${businessId}`);
  if (branchId) parts.push(sql`and ${sql.raw(alias)}.branch_id = ${branchId}`);
  if (lineId) parts.push(sql`and ${sql.raw(alias)}.line_id = ${lineId}`);
  return sql.join(parts, sql` `);
}

export function appointmentSummary(f) {
  return rows(sql`
    select a.branch_id, b.name as branch_name, a.line_id, l.name as line_name,
           count(*)::int as total,
           count(*) filter (where a.status = 'completed')::int as completed,
           count(*) filter (where a.status = 'no_show')::int as no_show,
           count(*) filter (where a.status = 'cancelled')::int as cancelled,
           count(*) filter (where a.status = 'expired')::int as expired,
           count(*) filter (where a.status in ('held', 'confirmed', 'checked_in'))::int as open
    from appointments a
    join branches b on b.id = a.branch_id
    join lines l on l.id = a.line_id
    where a.local_date between ${f.from} and ${f.to} ${filters('a', f)}
    group by a.branch_id, b.name, a.line_id, l.name
    order by b.name, l.name
  `);
}

/** Expected fees (bookings that were not cancelled/expired) vs fees the platform admin confirmed. */
export function feeSummary(f) {
  return rows(sql`
    select a.branch_id, b.name as branch_name, a.currency,
           coalesce(sum(a.amount_due) filter (
             where a.payment_status <> 'not_required' and a.status not in ('cancelled', 'expired')), 0)::float as expected,
           coalesce(sum(a.amount_due) filter (where a.payment_status = 'confirmed'), 0)::float as confirmed,
           count(*) filter (where a.payment_status = 'awaiting_verification')::int as awaiting
    from appointments a
    join branches b on b.id = a.branch_id
    where a.local_date between ${f.from} and ${f.to} ${filters('a', f)}
    group by a.branch_id, b.name, a.currency
    order by b.name, a.currency
  `);
}

/**
 * Line activity: volume, real waiting time and estimate accuracy.
 * "within range" = the real wait (join → first call) fell inside the range shown at join time.
 */
export function ticketSummary(f) {
  return rows(sql`
    select t.branch_id, b.name as branch_name, t.line_id, l.name as line_name,
           count(*)::int as total,
           count(*) filter (where t.source = 'walk_in')::int as walk_ins,
           count(*) filter (where t.source = 'appointment')::int as from_appointments,
           count(*) filter (where t.status = 'completed')::int as served,
           count(*) filter (where t.status in ('skipped', 'cancelled', 'expired'))::int as not_served,
           round(avg(t.actual_wait_seconds) / 60.0, 1)::float as avg_wait,
           round((percentile_cont(0.9) within group (order by t.actual_wait_seconds) / 60.0)::numeric, 1)::float as p90_wait,
           count(*) filter (where t.actual_wait_seconds is not null and t.estimate_low_min is not null)::int as estimated,
           count(*) filter (where t.actual_wait_seconds is not null and t.estimate_low_min is not null
             and t.actual_wait_seconds / 60.0 between t.estimate_low_min and t.estimate_high_min)::int as within_range,
           round(avg(abs(t.actual_wait_seconds / 60.0 - (t.estimate_low_min + t.estimate_high_min) / 2.0))
             filter (where t.actual_wait_seconds is not null and t.estimate_low_min is not null), 1)::float as mae
    from queue_tickets t
    join branches b on b.id = t.branch_id
    join lines l on l.id = t.line_id
    where t.service_date between ${f.from} and ${f.to} ${filters('t', f)}
    group by t.branch_id, b.name, t.line_id, l.name
    order by b.name, l.name
  `);
}

export function appointmentsDaily(f) {
  return rows(sql`
    select a.local_date as day,
           count(*) filter (where a.status = 'completed')::int as completed,
           count(*) filter (where a.status = 'no_show')::int as no_show,
           count(*) filter (where a.status in ('cancelled', 'expired'))::int as cancelled,
           count(*) filter (where a.status in ('held', 'confirmed', 'checked_in'))::int as open
    from appointments a
    where a.local_date between ${f.from} and ${f.to} ${filters('a', f)}
    group by a.local_date order by a.local_date
  `);
}

export function ticketsDaily(f) {
  return rows(sql`
    select t.service_date as day, count(*)::int as tickets,
           round(avg(t.actual_wait_seconds) / 60.0, 1)::float as avg_wait
    from queue_tickets t
    where t.service_date between ${f.from} and ${f.to} ${filters('t', f)}
    group by t.service_date order by t.service_date
  `);
}

/** Platform admin: fees it confirmed, per business/branch/currency — for manual settlement. */
export function settlement({ from, to }) {
  return rows(sql`
    select bu.name as business_name, b.name as branch_name, a.currency,
           count(*)::int as count, sum(a.amount_due)::float as total
    from appointments a
    join branches b on b.id = a.branch_id
    join businesses bu on bu.id = a.business_id
    where a.payment_status = 'confirmed'
      and a.payment_confirmed_at >= ${from}::date
      and a.payment_confirmed_at < (${to}::date + interval '1 day')
    group by bu.name, b.name, a.currency
    order by bu.name, b.name, a.currency
  `);
}

/** Owner dashboard numbers for today, per branch. */
export function ownerToday(businessId) {
  return rows(sql`
    select b.id as branch_id, b.name as branch_name,
      (select count(*)::int from queue_tickets t where t.branch_id = b.id
         and t.service_date = (now() at time zone b.timezone)::date) as tickets_today,
      (select count(*)::int from queue_tickets t where t.branch_id = b.id and t.status = 'waiting') as waiting_now,
      (select count(*)::int from appointments a where a.branch_id = b.id
         and a.local_date = (now() at time zone b.timezone)::date and a.status in ('confirmed', 'checked_in', 'completed')) as appointments_today,
      (select count(*)::int from appointments a where a.branch_id = b.id and a.payment_status = 'awaiting_verification') as awaiting_payments
    from branches b where b.business_id = ${businessId}
    order by b.name
  `);
}

// Queue tickets ("numbers") and the per-day number counter.
import { and, eq, inArray, desc, asc, isNotNull, sql } from 'drizzle-orm';
import { queueTickets, queueCounters, users, lines, branches, appointments } from './schema/index.js';
import { exec, one, rows } from './db-helpers.js';

/** Atomically takes the next ticket number for a line and day (1, 2, 3 …). */
export async function nextNumber(lineId, serviceDate, tx) {
  const [row] = await exec(tx)
    .insert(queueCounters)
    .values({ lineId, serviceDate, lastNumber: 1 })
    .onConflictDoUpdate({
      target: [queueCounters.lineId, queueCounters.serviceDate],
      set: { lastNumber: sql`${queueCounters.lastNumber} + 1` },
    })
    .returning({ number: queueCounters.lastNumber });
  return row.number;
}

export async function create(data, tx) {
  return one(await exec(tx).insert(queueTickets).values(data).returning());
}

export async function findById(id, tx) {
  return one(await exec(tx).select().from(queueTickets).where(eq(queueTickets.id, id)));
}

export async function findByToken(token, tx) {
  return one(await exec(tx).select().from(queueTickets).where(eq(queueTickets.trackingToken, token)));
}

export async function findActiveForCustomer(lineId, customerId, tx) {
  return one(
    await exec(tx)
      .select()
      .from(queueTickets)
      .where(
        and(
          eq(queueTickets.lineId, lineId),
          eq(queueTickets.customerId, customerId),
          inArray(queueTickets.status, ['waiting', 'called']),
        ),
      ),
  );
}

export async function findActiveForAppointment(appointmentId, tx) {
  return one(
    await exec(tx)
      .select()
      .from(queueTickets)
      .where(and(eq(queueTickets.appointmentId, appointmentId), inArray(queueTickets.status, ['waiting', 'called']))),
  );
}

/** Columns the queue screens need, with the customer's name for staff views. */
const listColumns = {
  id: queueTickets.id,
  lineId: queueTickets.lineId,
  displayCode: queueTickets.displayCode,
  number: queueTickets.number,
  source: queueTickets.source,
  status: queueTickets.status,
  priorityGroup: queueTickets.priorityGroup,
  sortAt: queueTickets.sortAt,
  joinedAt: queueTickets.joinedAt,
  firstCalledAt: queueTickets.firstCalledAt,
  lastCalledAt: queueTickets.lastCalledAt,
  recallCount: queueTickets.recallCount,
  counterLabel: queueTickets.counterLabel,
  customerId: queueTickets.customerId,
  appointmentId: queueTickets.appointmentId,
  phone: queueTickets.phone,
  guestName: queueTickets.guestName,
  customerName: users.name,
  trackingToken: queueTickets.trackingToken,
  alertLeadMinutes: queueTickets.alertLeadMinutes,
  approachAlertedAt: queueTickets.approachAlertedAt,
};

export async function listByStatus(lineId, serviceDate, statuses, tx) {
  return exec(tx)
    .select(listColumns)
    .from(queueTickets)
    .leftJoin(users, eq(users.id, queueTickets.customerId))
    .where(
      and(
        eq(queueTickets.lineId, lineId),
        eq(queueTickets.serviceDate, serviceDate),
        inArray(queueTickets.status, statuses),
      ),
    )
    .orderBy(asc(queueTickets.joinedAt));
}

/** Most recent calls (for display screens): newest first. */
export async function recentCalls(lineIds, serviceDate, limit, tx) {
  if (!lineIds.length) return [];
  return exec(tx)
    .select({
      id: queueTickets.id,
      lineId: queueTickets.lineId,
      displayCode: queueTickets.displayCode,
      counterLabel: queueTickets.counterLabel,
      status: queueTickets.status,
      lastCalledAt: queueTickets.lastCalledAt,
      recallCount: queueTickets.recallCount,
    })
    .from(queueTickets)
    .where(
      and(
        inArray(queueTickets.lineId, lineIds),
        eq(queueTickets.serviceDate, serviceDate),
        isNotNull(queueTickets.lastCalledAt),
      ),
    )
    .orderBy(desc(queueTickets.lastCalledAt))
    .limit(limit);
}

/** Priority groups of the latest first-calls (newest first) — the memory of the "interleave" policy. */
export async function recentCallGroups(lineId, serviceDate, limit, tx) {
  const result = await exec(tx)
    .select({ group: queueTickets.priorityGroup })
    .from(queueTickets)
    .where(
      and(
        eq(queueTickets.lineId, lineId),
        eq(queueTickets.serviceDate, serviceDate),
        isNotNull(queueTickets.firstCalledAt),
      ),
    )
    .orderBy(desc(queueTickets.firstCalledAt))
    .limit(limit);
  return result.map((r) => r.group);
}

/**
 * Changes a ticket's status only if it is currently in one of `fromStatuses`.
 * Returns the updated row, or null when another operator already changed it.
 */
export async function transition(id, fromStatuses, data, tx) {
  return one(
    await exec(tx)
      .update(queueTickets)
      .set(data)
      .where(and(eq(queueTickets.id, id), inArray(queueTickets.status, fromStatuses)))
      .returning(),
  );
}

export async function update(id, data, tx) {
  return one(await exec(tx).update(queueTickets).set(data).where(eq(queueTickets.id, id)).returning());
}

/** Marks the "approaching" alert as sent — only once per ticket. */
export async function claimApproachAlert(id, tx) {
  return one(
    await exec(tx)
      .update(queueTickets)
      .set({ approachAlertedAt: new Date() })
      .where(and(eq(queueTickets.id, id), sql`${queueTickets.approachAlertedAt} is null`, eq(queueTickets.status, 'waiting')))
      .returning({ id: queueTickets.id }),
  );
}

/** A customer's tickets with line and branch names (newest first). */
export async function listForCustomer(customerId, limit, tx) {
  return exec(tx)
    .select({
      id: queueTickets.id,
      displayCode: queueTickets.displayCode,
      status: queueTickets.status,
      joinedAt: queueTickets.joinedAt,
      trackingToken: queueTickets.trackingToken,
      serviceDate: queueTickets.serviceDate,
      lineName: lines.name,
      branchName: branches.name,
      timezone: branches.timezone,
    })
    .from(queueTickets)
    .innerJoin(lines, eq(lines.id, queueTickets.lineId))
    .innerJoin(branches, eq(branches.id, queueTickets.branchId))
    .where(eq(queueTickets.customerId, customerId))
    .orderBy(desc(queueTickets.joinedAt))
    .limit(limit);
}

/** Waiting counts per line (for branch pages and the owner dashboard). */
export async function waitingCounts(lineIds, tx) {
  if (!lineIds.length) return {};
  const result = await exec(tx)
    .select({ lineId: queueTickets.lineId, count: sql`count(*)::int` })
    .from(queueTickets)
    .where(and(inArray(queueTickets.lineId, lineIds), eq(queueTickets.status, 'waiting')))
    .groupBy(queueTickets.lineId);
  return Object.fromEntries(result.map((r) => [r.lineId, r.count]));
}

// ── Numbers used by the waiting-time estimate ───────────────────

/** First-call times on a line since `from` (ascending). */
export async function callTimesSince(lineId, from, tx) {
  const result = await exec(tx)
    .select({ at: queueTickets.firstCalledAt })
    .from(queueTickets)
    .where(and(eq(queueTickets.lineId, lineId), sql`${queueTickets.firstCalledAt} >= ${from}`))
    .orderBy(asc(queueTickets.firstCalledAt));
  return result.map((r) => r.at);
}

/**
 * Average gap (minutes) between consecutive calls on the same weekday over past weeks,
 * restricted to a time-of-day window around now. Gaps over 60 minutes (breaks) are ignored.
 */
export async function historicalCallGap({ lineId, timezone, fromDate, toDate, isoWeekday, timeFrom, timeTo }, tx) {
  const [row] = await rows(
    sql`
      with calls as (
        select first_called_at,
               extract(epoch from first_called_at - lag(first_called_at)
                 over (partition by service_date order by first_called_at)) / 60.0 as gap
        from queue_tickets
        where line_id = ${lineId}
          and service_date >= ${fromDate} and service_date < ${toDate}
          and extract(isodow from service_date) = ${isoWeekday}
          and first_called_at is not null
      )
      select avg(gap)::float as avg_gap, count(gap)::int as samples
      from calls
      where gap between 0.2 and 60
        and (first_called_at at time zone ${timezone})::time between ${timeFrom}::time and ${timeTo}::time
    `,
    tx,
  );
  return { avgGap: row?.avg_gap ?? null, samples: row?.samples ?? 0 };
}

/** Today's called vs. skipped counts — skipped people do not delay the people behind them. */
export async function todaySkipStats(lineId, serviceDate, tx) {
  const [row] = await rows(
    sql`
      select count(*) filter (where first_called_at is not null)::int as called,
             count(*) filter (where status = 'skipped' or (status = 'cancelled' and first_called_at is not null))::int as skipped
      from queue_tickets where line_id = ${lineId} and service_date = ${serviceDate}
    `,
    tx,
  );
  return row;
}

/** Today's summary for operator/owner dashboards. */
export async function todayStats(lineId, serviceDate, tx) {
  const [row] = await rows(
    sql`
      select count(*) filter (where status = 'completed')::int as served,
             count(*) filter (where status = 'waiting')::int as waiting,
             round(avg(actual_wait_seconds) / 60.0)::int as avg_wait_min
      from queue_tickets where line_id = ${lineId} and service_date = ${serviceDate}
    `,
    tx,
  );
  return row;
}

/** End of day: closes leftover tickets from previous days. */
export async function expireBefore(lineId, serviceDate, tx) {
  return exec(tx)
    .update(queueTickets)
    .set({ status: 'expired', closedAt: new Date() })
    .where(
      and(
        eq(queueTickets.lineId, lineId),
        sql`${queueTickets.serviceDate} < ${serviceDate}`,
        inArray(queueTickets.status, ['waiting', 'called', 'skipped']),
      ),
    )
    .returning({ id: queueTickets.id, appointmentId: queueTickets.appointmentId });
}

export async function countToday(tx) {
  const [row] = await rows(sql`select count(*)::int as n from queue_tickets where joined_at >= now() - interval '24 hours'`, tx);
  return row.n;
}

/** Ticket joined with its appointment start time (for operator lists). */
export async function appointmentTimes(ids, tx) {
  if (!ids.length) return {};
  const result = await exec(tx)
    .select({ id: appointments.id, localTime: appointments.localTime, reference: appointments.reference })
    .from(appointments)
    .where(inArray(appointments.id, ids));
  return Object.fromEntries(result.map((r) => [r.id, r]));
}

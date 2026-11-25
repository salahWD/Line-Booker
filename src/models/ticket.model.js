// Queue tickets ("numbers") and the per-day number counter.
import { and, eq, inArray, desc, asc, isNotNull, isNull, lt, gte, sql } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { queueTickets, queueCounters, users, lines, branches, appointments } from './schema/index.js';
import { exec, one, rows, insertOne, updateOne, affected, utcDate, numbers } from './db-helpers.js';

/** Atomically takes the next ticket number for a line and day (1, 2, 3 …). */
export async function nextNumber(lineId, serviceDate, tx) {
  await exec(tx)
    .insert(queueCounters)
    .values({ lineId, serviceDate, lastNumber: 1 })
    .onDuplicateKeyUpdate({ set: { lastNumber: sql`${queueCounters.lastNumber} + 1` } });
  // The upsert keeps the counter row locked until commit, so this read returns our number.
  const [row] = await exec(tx)
    .select({ number: queueCounters.lastNumber })
    .from(queueCounters)
    .where(and(eq(queueCounters.lineId, lineId), eq(queueCounters.serviceDate, serviceDate)));
  return row.number;
}

export async function create(data, tx) {
  return insertOne(queueTickets, data, tx);
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
    .orderBy(asc(queueTickets.joinedAt), asc(queueTickets.id));
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
    .orderBy(desc(queueTickets.firstCalledAt), desc(queueTickets.id))
    .limit(limit);
  return result.map((r) => r.group);
}

/**
 * Changes a ticket's status only if it is currently in one of `fromStatuses`.
 * Returns the updated row, or null when another operator already changed it.
 */
export async function transition(id, fromStatuses, data, tx) {
  return updateOne(queueTickets, id, data, tx, inArray(queueTickets.status, fromStatuses));
}

export async function update(id, data, tx) {
  return updateOne(queueTickets, id, data, tx);
}

/** Marks the "approaching" alert as sent — only once per ticket. */
export async function claimApproachAlert(id, tx) {
  const result = await exec(tx)
    .update(queueTickets)
    .set({ approachAlertedAt: new Date() })
    .where(and(eq(queueTickets.id, id), isNull(queueTickets.approachAlertedAt), eq(queueTickets.status, 'waiting')));
  return affected(result) ? { id } : null;
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
    .select({ lineId: queueTickets.lineId, count: sql`count(*)`.mapWith(Number) })
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
    .where(and(eq(queueTickets.lineId, lineId), gte(queueTickets.firstCalledAt, from)))
    .orderBy(asc(queueTickets.firstCalledAt));
  return result.map((r) => r.at);
}

/**
 * Average gap (minutes) between consecutive calls on the same weekday over past weeks,
 * restricted to a time-of-day window around now. Gaps over 60 minutes (breaks) are ignored.
 */
export async function historicalCallGap({ lineId, timezone, fromDate, toDate, isoWeekday, timeFrom, timeTo }, tx) {
  // MySQL WEEKDAY() is 0 = Monday, so the ISO weekday is WEEKDAY() + 1.
  const calls = await rows(
    sql`
      select service_date, first_called_at
      from queue_tickets
      where line_id = ${lineId}
        and service_date >= ${fromDate} and service_date < ${toDate}
        and weekday(service_date) + 1 = ${isoWeekday}
        and first_called_at is not null
      order by service_date, first_called_at
    `,
    tx,
  );
  // Gaps between consecutive calls of the same day, kept when the call happened inside the
  // branch-local time window. Done in JS so MySQL needs no time-zone tables.
  let total = 0;
  let samples = 0;
  let prev = null;
  for (const row of calls) {
    const at = utcDate(row.first_called_at);
    if (prev && prev.day === row.service_date) {
      const gap = (at - prev.at) / 60_000;
      const local = DateTime.fromJSDate(at, { zone: timezone }).toFormat('HH:mm:ss');
      if (gap >= 0.2 && gap <= 60 && local >= timeFrom && local <= timeTo) {
        total += gap;
        samples += 1;
      }
    }
    prev = { day: row.service_date, at };
  }
  return { avgGap: samples ? total / samples : null, samples };
}

/** Today's called vs. skipped counts — skipped people do not delay the people behind them. */
export async function todaySkipStats(lineId, serviceDate, tx) {
  const result = await rows(
    sql`
      select coalesce(sum(first_called_at is not null), 0) as called,
             coalesce(sum(status = 'skipped' or (status = 'cancelled' and first_called_at is not null)), 0) as skipped
      from queue_tickets where line_id = ${lineId} and service_date = ${serviceDate}
    `,
    tx,
  );
  return numbers(result, ['called', 'skipped'])[0];
}

/** Today's summary for operator/owner dashboards. */
export async function todayStats(lineId, serviceDate, tx) {
  const result = await rows(
    sql`
      select coalesce(sum(status = 'completed'), 0) as served,
             coalesce(sum(status = 'waiting'), 0) as waiting,
             round(avg(actual_wait_seconds) / 60.0) as avg_wait_min
      from queue_tickets where line_id = ${lineId} and service_date = ${serviceDate}
    `,
    tx,
  );
  return numbers(result, ['served', 'waiting', 'avg_wait_min'])[0];
}

/** End of day: closes leftover tickets from previous days. Returns the closed tickets. */
export async function expireBefore(lineId, serviceDate, tx) {
  const leftovers = await exec(tx)
    .select({ id: queueTickets.id, appointmentId: queueTickets.appointmentId })
    .from(queueTickets)
    .where(
      and(
        eq(queueTickets.lineId, lineId),
        lt(queueTickets.serviceDate, serviceDate),
        inArray(queueTickets.status, ['waiting', 'called', 'skipped']),
      ),
    )
    .for('update');
  if (leftovers.length) {
    await exec(tx)
      .update(queueTickets)
      .set({ status: 'expired', closedAt: new Date() })
      .where(inArray(queueTickets.id, leftovers.map((r) => r.id)));
  }
  return leftovers;
}

export async function countToday(tx) {
  const [row] = await rows(sql`select count(*) as n from queue_tickets where joined_at >= ${new Date(Date.now() - 86_400_000)}`, tx);
  return Number(row.n);
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

// Appointments and their event history.
import { and, eq, inArray, desc, asc, or, ilike, sql, lte } from 'drizzle-orm';
import { appointments, appointmentEvents, users, lines, branches, businesses } from './schema/index.js';
import { exec, one } from './db-helpers.js';

export async function create(data, tx) {
  return one(await exec(tx).insert(appointments).values(data).returning());
}

export async function findById(id, tx) {
  return one(await exec(tx).select().from(appointments).where(eq(appointments.id, id)));
}

/** Locks the row for the rest of the transaction (status changes, reschedule). */
export async function findByIdForUpdate(id, tx) {
  return one(await tx.select().from(appointments).where(eq(appointments.id, id)).for('update'));
}

/** Full view: appointment + line + branch + business + customer. */
const detailColumns = {
  appointment: appointments,
  lineName: lines.name,
  lineCheckinOpenMinutes: lines.checkinOpenMinutes,
  branchName: branches.name,
  branchSlug: branches.slug,
  timezone: branches.timezone,
  cancellationCutoffHours: branches.cancellationCutoffHours,
  allowReschedule: branches.allowReschedule,
  cancellationPolicyText: branches.cancellationPolicyText,
  businessName: businesses.name,
  customerName: users.name,
  customerPhone: users.phone,
};

function detailQuery(tx) {
  return exec(tx)
    .select(detailColumns)
    .from(appointments)
    .innerJoin(lines, eq(lines.id, appointments.lineId))
    .innerJoin(branches, eq(branches.id, appointments.branchId))
    .innerJoin(businesses, eq(businesses.id, appointments.businessId))
    .innerJoin(users, eq(users.id, appointments.customerId));
}

export async function findDetailById(id, tx) {
  return one(await detailQuery(tx).where(eq(appointments.id, id)));
}

export async function findDetailByReference(reference, tx) {
  return one(await detailQuery(tx).where(eq(appointments.reference, reference)));
}

export async function listForCustomer(customerId, tx) {
  return detailQuery(tx).where(eq(appointments.customerId, customerId)).orderBy(desc(appointments.startsAt)).limit(100);
}

/**
 * Staff list. `branchIds` = null means all branches (platform admin).
 * Filters: date, lineId, status, q (reference or phone).
 */
export async function listForStaff({ branchIds, date, lineId, status, q, limit = 100 }, tx) {
  const conditions = [];
  if (branchIds) conditions.push(branchIds.length ? inArray(appointments.branchId, branchIds) : sql`false`);
  if (date) conditions.push(eq(appointments.localDate, date));
  if (lineId) conditions.push(eq(appointments.lineId, lineId));
  if (status) conditions.push(eq(appointments.status, status));
  if (q) conditions.push(or(ilike(appointments.reference, `%${q}%`), ilike(users.phone, `%${q}%`), ilike(users.name, `%${q}%`)));
  return detailQuery(tx)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(date ? asc(appointments.startsAt) : desc(appointments.startsAt))
    .limit(limit);
}

/**
 * Status change guarded by the current status (and optionally payment status).
 * Returns null if the appointment was already changed by someone else.
 */
export async function transition(id, { from, paymentFrom }, data, tx) {
  const conditions = [eq(appointments.id, id), inArray(appointments.status, from)];
  if (paymentFrom) conditions.push(inArray(appointments.paymentStatus, paymentFrom));
  return one(await exec(tx).update(appointments).set(data).where(and(...conditions)).returning());
}

export async function update(id, data, tx) {
  return one(await exec(tx).update(appointments).set(data).where(eq(appointments.id, id)).returning());
}

/** The customer's confirmed or checked-in appointment on a line for a given day (if any). */
export async function findForCustomerLineDay(customerId, lineId, localDate, tx) {
  return one(
    await exec(tx)
      .select()
      .from(appointments)
      .where(
        and(
          eq(appointments.customerId, customerId),
          eq(appointments.lineId, lineId),
          eq(appointments.localDate, localDate),
          inArray(appointments.status, ['confirmed', 'checked_in']),
        ),
      ),
  );
}

/** Unpaid holds whose time is up. */
export async function dueHolds(limit, tx) {
  return exec(tx)
    .select({ id: appointments.id })
    .from(appointments)
    .where(
      and(
        eq(appointments.status, 'held'),
        eq(appointments.paymentStatus, 'unpaid'),
        lte(appointments.holdExpiresAt, new Date()),
      ),
    )
    .limit(limit);
}

/** Confirmed / checked-in appointments of earlier days that never completed → no-show. */
export async function markPastAsNoShow(branchId, today, tx) {
  return exec(tx)
    .update(appointments)
    .set({ status: 'no_show', noShowAt: new Date() })
    .where(
      and(
        eq(appointments.branchId, branchId),
        inArray(appointments.status, ['confirmed', 'checked_in']),
        sql`${appointments.localDate} < ${today}`,
      ),
    )
    .returning({ id: appointments.id, slotId: appointments.slotId });
}

/** Today's appointments of a line for the operator console. */
export async function listForLineDay(lineId, localDate, tx) {
  return exec(tx)
    .select({
      id: appointments.id,
      reference: appointments.reference,
      localTime: appointments.localTime,
      startsAt: appointments.startsAt,
      status: appointments.status,
      paymentStatus: appointments.paymentStatus,
      customerName: users.name,
      customerPhone: users.phone,
    })
    .from(appointments)
    .innerJoin(users, eq(users.id, appointments.customerId))
    .where(
      and(
        eq(appointments.lineId, lineId),
        eq(appointments.localDate, localDate),
        inArray(appointments.status, ['confirmed', 'checked_in', 'completed', 'no_show', 'held']),
      ),
    )
    .orderBy(asc(appointments.startsAt));
}

// ── Events ─────────────────────────────────────────────────────

export async function addEvent(appointmentId, type, actorUserId, data, tx) {
  await exec(tx).insert(appointmentEvents).values({ appointmentId, type, actorUserId, data });
}

export async function listEvents(appointmentId, tx) {
  return exec(tx)
    .select({ event: appointmentEvents, actorName: users.name, actorRole: users.role })
    .from(appointmentEvents)
    .leftJoin(users, eq(users.id, appointmentEvents.actorUserId))
    .where(eq(appointmentEvents.appointmentId, appointmentId))
    .orderBy(asc(appointmentEvents.createdAt));
}

// Appointment slots published by owners, and the capacity counter on each slot.
import { and, eq, asc, gt, sql, inArray } from 'drizzle-orm';
import { appointmentSlots, appointments } from './schema/index.js';
import { exec, one, rows } from './db-helpers.js';

export async function findById(id, tx) {
  return one(await exec(tx).select().from(appointmentSlots).where(eq(appointmentSlots.id, id)));
}

/** Bulk insert; slots that already exist (same line + start) are skipped. Returns the inserted count. */
export async function insertMany(slots, tx) {
  if (!slots.length) return 0;
  const inserted = await exec(tx)
    .insert(appointmentSlots)
    .values(slots)
    .onConflictDoNothing({ target: [appointmentSlots.lineId, appointmentSlots.startsAt] })
    .returning({ id: appointmentSlots.id });
  return inserted.length;
}

export async function listDay(lineId, localDate, tx) {
  return exec(tx)
    .select()
    .from(appointmentSlots)
    .where(and(eq(appointmentSlots.lineId, lineId), eq(appointmentSlots.localDate, localDate)))
    .orderBy(asc(appointmentSlots.startsAt));
}

/** Days that still have at least one bookable slot, with how many places are left. */
export async function bookableDates(lineId, earliest, lastDate, tx) {
  return rows(
    sql`
      select local_date as date, sum(capacity - reserved_count)::int as remaining
      from appointment_slots
      where line_id = ${lineId} and is_open and reserved_count < capacity
        and starts_at >= ${earliest} and local_date <= ${lastDate}
      group by local_date
      order by local_date
    `,
    tx,
  );
}

export async function bookableSlots(lineId, localDate, earliest, tx) {
  return exec(tx)
    .select()
    .from(appointmentSlots)
    .where(
      and(
        eq(appointmentSlots.lineId, lineId),
        eq(appointmentSlots.localDate, localDate),
        eq(appointmentSlots.isOpen, true),
        sql`${appointmentSlots.reservedCount} < ${appointmentSlots.capacity}`,
        gt(appointmentSlots.startsAt, earliest),
      ),
    )
    .orderBy(asc(appointmentSlots.startsAt));
}

/**
 * Takes one place on a slot — the heart of "no overbooking".
 * The WHERE clause and the increment run as one statement on a locked row, so when
 * many customers book the last place at the same moment exactly one UPDATE succeeds.
 * Returns the slot, or null when it is full/closed.
 */
export async function reserve(slotId, tx) {
  return one(
    await exec(tx)
      .update(appointmentSlots)
      .set({ reservedCount: sql`${appointmentSlots.reservedCount} + 1` })
      .where(
        and(
          eq(appointmentSlots.id, slotId),
          eq(appointmentSlots.isOpen, true),
          sql`${appointmentSlots.reservedCount} < ${appointmentSlots.capacity}`,
        ),
      )
      .returning(),
  );
}

/** Gives a place back (cancellation, expiry, rejection, reschedule). */
export async function release(slotId, tx) {
  await exec(tx)
    .update(appointmentSlots)
    .set({ reservedCount: sql`greatest(${appointmentSlots.reservedCount} - 1, 0)` })
    .where(eq(appointmentSlots.id, slotId));
}

export async function setOpen(slotId, isOpen, tx) {
  return one(await exec(tx).update(appointmentSlots).set({ isOpen }).where(eq(appointmentSlots.id, slotId)).returning());
}

export async function closeDay(lineId, localDate, tx) {
  const result = await exec(tx)
    .update(appointmentSlots)
    .set({ isOpen: false })
    .where(and(eq(appointmentSlots.lineId, lineId), eq(appointmentSlots.localDate, localDate), eq(appointmentSlots.isOpen, true)))
    .returning({ id: appointmentSlots.id });
  return result.length;
}

/** Deletes a slot only if no appointment (of any status) ever used it. */
export async function deleteIfUnused(slotId, tx) {
  const result = await exec(tx)
    .delete(appointmentSlots)
    .where(
      and(
        eq(appointmentSlots.id, slotId),
        sql`not exists (select 1 from ${appointments} where ${appointments.slotId} = ${appointmentSlots.id})`,
      ),
    )
    .returning({ id: appointmentSlots.id });
  return result.length > 0;
}

/** Booked customers per slot (owner calendar). */
export async function bookingsBySlot(slotIds, tx) {
  if (!slotIds.length) return {};
  const result = await exec(tx)
    .select({ slotId: appointments.slotId, count: sql`count(*)::int` })
    .from(appointments)
    .where(and(inArray(appointments.slotId, slotIds), inArray(appointments.status, ['held', 'confirmed', 'checked_in'])))
    .groupBy(appointments.slotId);
  return Object.fromEntries(result.map((r) => [r.slotId, r.count]));
}

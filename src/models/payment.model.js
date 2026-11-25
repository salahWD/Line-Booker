// Payment submissions ("I transferred the money") reviewed by the platform admin.
import { and, eq, desc, asc, inArray, sql } from 'drizzle-orm';
import { paymentSubmissions, appointments, users, branches, businesses, lines } from './schema/index.js';
import { exec, one, insertOne, updateOne, affected } from './db-helpers.js';

export async function create(data, tx) {
  return insertOne(paymentSubmissions, data, tx);
}

export async function findById(id, tx) {
  return one(await exec(tx).select().from(paymentSubmissions).where(eq(paymentSubmissions.id, id)));
}

export async function listForAppointment(appointmentId, tx) {
  return exec(tx)
    .select({ submission: paymentSubmissions, reviewerName: users.name })
    .from(paymentSubmissions)
    .leftJoin(users, eq(users.id, paymentSubmissions.reviewedById))
    .where(eq(paymentSubmissions.appointmentId, appointmentId))
    .orderBy(desc(paymentSubmissions.createdAt));
}

/** Admin queue (pending first, oldest first) or history. */
export async function listForAdmin({ statuses, limit = 100 }, tx) {
  return exec(tx)
    .select({
      submission: paymentSubmissions,
      reference: appointments.reference,
      appointmentStatus: appointments.status,
      amountDue: appointments.amountDue,
      currency: appointments.currency,
      feeType: appointments.feeType,
      startsAt: appointments.startsAt,
      customerName: users.name,
      customerPhone: users.phone,
      branchName: branches.name,
      timezone: branches.timezone,
      businessName: businesses.name,
      lineName: lines.name,
    })
    .from(paymentSubmissions)
    .innerJoin(appointments, eq(appointments.id, paymentSubmissions.appointmentId))
    .innerJoin(users, eq(users.id, paymentSubmissions.customerId))
    .innerJoin(branches, eq(branches.id, appointments.branchId))
    .innerJoin(businesses, eq(businesses.id, appointments.businessId))
    .innerJoin(lines, eq(lines.id, appointments.lineId))
    .where(inArray(paymentSubmissions.status, statuses))
    .orderBy(statuses.includes('pending') ? asc(paymentSubmissions.createdAt) : desc(paymentSubmissions.createdAt))
    .limit(limit);
}

/** Status change guarded by the current status (another admin may have decided already). */
export async function transition(id, fromStatus, data, tx) {
  return updateOne(paymentSubmissions, id, data, tx, eq(paymentSubmissions.status, fromStatus));
}

export async function countPending(tx) {
  const [row] = await exec(tx)
    .select({ n: sql`count(*)`.mapWith(Number) })
    .from(paymentSubmissions)
    .where(eq(paymentSubmissions.status, 'pending'));
  return row.n;
}

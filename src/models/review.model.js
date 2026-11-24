// Reviews: one per completed appointment, with an optional owner reply.
import { and, eq, desc, inArray, sql } from 'drizzle-orm';
import { reviews, users, branches, lines, appointments } from './schema/index.js';
import { exec, one } from './db-helpers.js';

export async function create(data, tx) {
  return one(await exec(tx).insert(reviews).values(data).returning());
}

export async function findById(id, tx) {
  return one(await exec(tx).select().from(reviews).where(eq(reviews.id, id)));
}

export async function findByAppointment(appointmentId, tx) {
  return one(await exec(tx).select().from(reviews).where(eq(reviews.appointmentId, appointmentId)));
}

export async function update(id, data, tx) {
  return one(await exec(tx).update(reviews).set(data).where(eq(reviews.id, id)).returning());
}

const listColumns = {
  review: reviews,
  customerName: users.name,
  branchName: branches.name,
  lineName: lines.name,
  reference: appointments.reference,
};

export async function listForBranch(branchId, limit, tx) {
  return exec(tx)
    .select(listColumns)
    .from(reviews)
    .innerJoin(users, eq(users.id, reviews.customerId))
    .innerJoin(branches, eq(branches.id, reviews.branchId))
    .innerJoin(lines, eq(lines.id, reviews.lineId))
    .innerJoin(appointments, eq(appointments.id, reviews.appointmentId))
    .where(eq(reviews.branchId, branchId))
    .orderBy(desc(reviews.createdAt))
    .limit(limit);
}

export async function listForBusiness(businessId, { branchId } = {}, tx) {
  const conditions = [eq(reviews.businessId, businessId)];
  if (branchId) conditions.push(eq(reviews.branchId, branchId));
  return exec(tx)
    .select(listColumns)
    .from(reviews)
    .innerJoin(users, eq(users.id, reviews.customerId))
    .innerJoin(branches, eq(branches.id, reviews.branchId))
    .innerJoin(lines, eq(lines.id, reviews.lineId))
    .innerJoin(appointments, eq(appointments.id, reviews.appointmentId))
    .where(and(...conditions))
    .orderBy(desc(reviews.createdAt))
    .limit(200);
}

/** { branchId: { avg, count } } */
export async function ratingByBranch(branchIds, tx) {
  if (!branchIds.length) return {};
  const result = await exec(tx)
    .select({ branchId: reviews.branchId, avg: sql`round(avg(${reviews.rating}), 1)::float`, count: sql`count(*)::int` })
    .from(reviews)
    .where(inArray(reviews.branchId, branchIds))
    .groupBy(reviews.branchId);
  return Object.fromEntries(result.map((r) => [r.branchId, { avg: r.avg, count: r.count }]));
}

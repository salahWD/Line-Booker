// Branches with their opening hours and holidays.
import { and, eq, asc, gte, like, or, inArray, sql } from 'drizzle-orm';
import { branches, businesses, branchHours, branchHolidays } from './schema/index.js';
import { exec, one, insertOne, updateOne, affected } from './db-helpers.js';

export async function findById(id, tx) {
  return one(await exec(tx).select().from(branches).where(eq(branches.id, id)));
}

/** Public lookup: only active branches of active businesses. */
export async function findPublicBySlug(slug, tx) {
  return one(
    await exec(tx)
      .select({ branch: branches, businessName: businesses.name })
      .from(branches)
      .innerJoin(businesses, eq(businesses.id, branches.businessId))
      .where(and(eq(branches.slug, slug), eq(branches.isActive, true), eq(businesses.isActive, true))),
  );
}

export async function findByDisplayToken(token, tx) {
  return one(await exec(tx).select().from(branches).where(eq(branches.displayToken, token)));
}

export async function listPublic(search, tx) {
  const conditions = [eq(branches.isActive, true), eq(businesses.isActive, true)];
  if (search) {
    const like = `%${search}%`;
    conditions.push(or(like(branches.name, like), like(branches.city, like), like(businesses.name, like)));
  }
  return exec(tx)
    .select({
      id: branches.id,
      name: branches.name,
      slug: branches.slug,
      city: branches.city,
      address: branches.address,
      feeAmount: branches.feeAmount,
      currency: branches.currency,
      businessName: businesses.name,
    })
    .from(branches)
    .innerJoin(businesses, eq(businesses.id, branches.businessId))
    .where(and(...conditions))
    .orderBy(asc(businesses.name), asc(branches.name))
    .limit(100);
}

export async function listByBusiness(businessId, tx) {
  return exec(tx).select().from(branches).where(eq(branches.businessId, businessId)).orderBy(asc(branches.name));
}

export async function listByIds(ids, tx) {
  if (!ids.length) return [];
  return exec(tx).select().from(branches).where(inArray(branches.id, ids)).orderBy(asc(branches.name));
}

export async function listAll(tx) {
  return exec(tx).select().from(branches).orderBy(asc(branches.name));
}

export async function create(data, tx) {
  return insertOne(branches, data, tx);
}

export async function update(id, data, tx) {
  return updateOne(branches, id, data, tx);
}

export async function count(tx) {
  const [row] = await exec(tx).select({ n: sql`count(*)`.mapWith(Number) }).from(branches);
  return row.n;
}

// ── Opening hours ──────────────────────────────────────────────

export async function listHours(branchId, tx) {
  return exec(tx)
    .select()
    .from(branchHours)
    .where(eq(branchHours.branchId, branchId))
    .orderBy(asc(branchHours.weekday), asc(branchHours.openTime));
}

export async function replaceHours(branchId, rows, tx) {
  await exec(tx).delete(branchHours).where(eq(branchHours.branchId, branchId));
  if (rows.length) await exec(tx).insert(branchHours).values(rows.map((r) => ({ ...r, branchId })));
}

// ── Holidays ───────────────────────────────────────────────────

export async function listHolidays(branchId, fromDate, tx) {
  return exec(tx)
    .select()
    .from(branchHolidays)
    .where(and(eq(branchHolidays.branchId, branchId), gte(branchHolidays.date, fromDate)))
    .orderBy(asc(branchHolidays.date));
}

export async function holidayDates(branchId, fromDate, toDate, tx) {
  const rows = await exec(tx)
    .select({ date: branchHolidays.date })
    .from(branchHolidays)
    .where(and(eq(branchHolidays.branchId, branchId), sql`${branchHolidays.date} between ${fromDate} and ${toDate}`));
  return new Set(rows.map((r) => r.date));
}

export async function addHoliday(branchId, date, reason, tx) {
  await exec(tx).insert(branchHolidays).ignore().values({ branchId, date, reason });
}

export async function removeHoliday(branchId, holidayId, tx) {
  await exec(tx).delete(branchHolidays).where(and(eq(branchHolidays.id, holidayId), eq(branchHolidays.branchId, branchId)));
}

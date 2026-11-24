// Lines (e.g. one per clinic) and their pause history.
import { and, eq, asc, inArray, isNull, sql } from 'drizzle-orm';
import { lines, linePauses, branches, businesses } from './schema/index.js';
import { exec, one } from './db-helpers.js';

export async function findById(id, tx) {
  return one(await exec(tx).select().from(lines).where(eq(lines.id, id)));
}

/** Line together with its branch (timezone, name, fee…). */
export async function findWithBranch(id, tx) {
  return one(
    await exec(tx)
      .select({ line: lines, branch: branches, businessName: businesses.name, businessActive: businesses.isActive })
      .from(lines)
      .innerJoin(branches, eq(branches.id, lines.branchId))
      .innerJoin(businesses, eq(businesses.id, lines.businessId))
      .where(eq(lines.id, id)),
  );
}

export async function findByDisplayToken(token, tx) {
  return one(await exec(tx).select().from(lines).where(eq(lines.displayToken, token)));
}

export async function listByBranch(branchId, { activeOnly = false } = {}, tx) {
  const conditions = [eq(lines.branchId, branchId)];
  if (activeOnly) conditions.push(eq(lines.isActive, true));
  return exec(tx).select().from(lines).where(and(...conditions)).orderBy(asc(lines.sortOrder), asc(lines.id));
}

export async function listByBranchIds(branchIds, { activeOnly = false } = {}, tx) {
  if (!branchIds.length) return [];
  const conditions = [inArray(lines.branchId, branchIds)];
  if (activeOnly) conditions.push(eq(lines.isActive, true));
  return exec(tx)
    .select()
    .from(lines)
    .where(and(...conditions))
    .orderBy(asc(lines.branchId), asc(lines.sortOrder), asc(lines.id));
}

export async function listAllActive(tx) {
  return exec(tx)
    .select({ line: lines, timezone: branches.timezone })
    .from(lines)
    .innerJoin(branches, eq(branches.id, lines.branchId))
    .where(eq(lines.isActive, true));
}

export async function create(data, tx) {
  return one(await exec(tx).insert(lines).values(data).returning());
}

export async function update(id, data, tx) {
  return one(await exec(tx).update(lines).set(data).where(eq(lines.id, id)).returning());
}

/**
 * Serialises every queue action on one line for the rest of the transaction.
 * Two operators pressing "call next" at the same moment are handled one after the other.
 */
export async function lock(lineId, tx) {
  await tx.execute(sql`select pg_advisory_xact_lock(${lineId})`);
}

// ── Pauses ─────────────────────────────────────────────────────

export async function openPause(lineId, userId, reason, tx) {
  await exec(tx).insert(linePauses).values({ lineId, pausedById: userId, reason });
}

export async function closeOpenPauses(lineId, tx) {
  await exec(tx)
    .update(linePauses)
    .set({ resumedAt: new Date() })
    .where(and(eq(linePauses.lineId, lineId), isNull(linePauses.resumedAt)));
}

/** Pauses that overlap [from, now] — used to ignore paused time in estimates. */
export async function pausesSince(lineId, from, tx) {
  return exec(tx)
    .select({ pausedAt: linePauses.pausedAt, resumedAt: linePauses.resumedAt })
    .from(linePauses)
    .where(and(eq(linePauses.lineId, lineId), sql`coalesce(${linePauses.resumedAt}, now()) >= ${from}`));
}

export async function currentPause(lineId, tx) {
  return one(
    await exec(tx)
      .select()
      .from(linePauses)
      .where(and(eq(linePauses.lineId, lineId), isNull(linePauses.resumedAt)))
      .orderBy(sql`${linePauses.pausedAt} desc`)
      .limit(1),
  );
}

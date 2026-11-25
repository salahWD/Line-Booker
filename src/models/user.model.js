// Users: customers, operators, business owners and platform admins.
import { and, eq, inArray, or, asc, sql } from 'drizzle-orm';
import { users, operatorBranches, businesses } from './schema/index.js';
import { exec, one, insertOne, updateOne, affected } from './db-helpers.js';

export async function findById(id, tx) {
  return one(await exec(tx).select().from(users).where(eq(users.id, id)));
}

/** User plus their business's active flag (staff accounts are blocked when the business is suspended). */
export async function findWithBusiness(id, tx) {
  return one(
    await exec(tx)
      .select({ user: users, businessActive: businesses.isActive, businessName: businesses.name })
      .from(users)
      .leftJoin(businesses, eq(businesses.id, users.businessId))
      .where(eq(users.id, id)),
  );
}

export async function findByPhone(phone, tx) {
  return one(await exec(tx).select().from(users).where(eq(users.phone, phone)));
}

/** Staff log in with email or phone. */
export async function findStaffByIdentifier({ email, phone }, tx) {
  const conditions = [];
  if (email) conditions.push(eq(users.email, email));
  if (phone) conditions.push(eq(users.phone, phone));
  if (!conditions.length) return null;
  return one(
    await exec(tx)
      .select()
      .from(users)
      .where(and(or(...conditions), inArray(users.role, ['platform_admin', 'business_owner', 'branch_operator']))),
  );
}

export async function create(data, tx) {
  return insertOne(users, data, tx);
}

export async function update(id, data, tx) {
  return updateOne(users, id, data, tx);
}

export async function touchLogin(id, tx) {
  await exec(tx).update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, id));
}

export async function listOperators(businessId, tx) {
  return exec(tx)
    .select()
    .from(users)
    .where(and(eq(users.businessId, businessId), eq(users.role, 'branch_operator')))
    .orderBy(asc(users.name));
}

export async function operatorBranchIds(userId, tx) {
  const rows = await exec(tx)
    .select({ branchId: operatorBranches.branchId })
    .from(operatorBranches)
    .where(eq(operatorBranches.userId, userId));
  return rows.map((r) => r.branchId);
}

/** Replace an operator's branch assignments. */
export async function setOperatorBranches(userId, branchIds, tx) {
  await exec(tx).delete(operatorBranches).where(eq(operatorBranches.userId, userId));
  if (branchIds.length) {
    await exec(tx).insert(operatorBranches).values(branchIds.map((branchId) => ({ userId, branchId })));
  }
}

export async function countByRole(tx) {
  const rows = await exec(tx)
    .select({ role: users.role, count: sql`count(*)`.mapWith(Number) })
    .from(users)
    .groupBy(users.role);
  return Object.fromEntries(rows.map((r) => [r.role, r.count]));
}

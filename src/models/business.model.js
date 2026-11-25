// Businesses (tenants) — managed by the platform admin.
import { eq, desc, sql } from 'drizzle-orm';
import { businesses, branches, users } from './schema/index.js';
import { exec, one, insertOne, updateOne, affected } from './db-helpers.js';

export async function findById(id, tx) {
  return one(await exec(tx).select().from(businesses).where(eq(businesses.id, id)));
}

export async function create(data, tx) {
  return insertOne(businesses, data, tx);
}

export async function update(id, data, tx) {
  return updateOne(businesses, id, data, tx);
}

/** Admin list with branch count and owner contact. */
export async function listWithStats(tx) {
  return exec(tx)
    .select({
      id: businesses.id,
      name: businesses.name,
      slug: businesses.slug,
      phone: businesses.phone,
      isActive: businesses.isActive,
      createdAt: businesses.createdAt,
      branchCount: sql`(select count(*) from ${branches} where ${branches.businessId} = ${businesses.id})`.mapWith(Number),
      ownerName: sql`(select ${users.name} from ${users} where ${users.businessId} = ${businesses.id} and ${users.role} = 'business_owner' order by ${users.id} limit 1)`,
      ownerEmail: sql`(select ${users.email} from ${users} where ${users.businessId} = ${businesses.id} and ${users.role} = 'business_owner' order by ${users.id} limit 1)`,
    })
    .from(businesses)
    .orderBy(desc(businesses.createdAt));
}

export async function count(tx) {
  const [row] = await exec(tx).select({ n: sql`count(*)`.mapWith(Number) }).from(businesses);
  return row.n;
}

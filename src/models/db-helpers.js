// Small helpers shared by the model files.
// MySQL has no `RETURNING`, so inserts and guarded updates read the row back by id
// (inside the same transaction when one is given).
import { eq, and } from 'drizzle-orm';
import { db } from '../config/db.js';

/** Use the transaction when given, otherwise the shared connection pool. */
export const exec = (tx) => tx ?? db;

/** First row or null. */
export const one = (rows) => rows[0] ?? null;

/** Run raw SQL (drizzle `sql` template) and return plain rows. */
export async function rows(query, tx) {
  const [result] = await exec(tx).execute(query);
  return result;
}

/** Number of rows matched by an UPDATE / DELETE result. */
export const affected = (result) => result?.[0]?.affectedRows ?? 0;

/** Inserts one row and returns it as stored (defaults included). */
export async function insertOne(table, data, tx) {
  const [{ id }] = await exec(tx).insert(table).values(data).$returningId();
  return one(await exec(tx).select().from(table).where(eq(table.id, id)));
}

/**
 * UPDATE … WHERE id = ? [AND extra conditions] and return the updated row,
 * or null when nothing matched (e.g. another operator changed the status first).
 */
export async function updateOne(table, id, data, tx, ...conditions) {
  const result = await exec(tx)
    .update(table)
    .set(data)
    .where(and(eq(table.id, id), ...conditions));
  if (!affected(result)) return null;
  return one(await exec(tx).select().from(table).where(eq(table.id, id)));
}

/** Converts a DATETIME string from a raw query ('YYYY-MM-DD HH:MM:SS.mmm', UTC) to a Date. */
export const utcDate = (value) => (value == null ? null : value instanceof Date ? value : new Date(`${String(value).replace(' ', 'T')}Z`));

/** Converts numeric strings (MySQL DECIMAL / SUM / AVG results) in the given fields to numbers. */
export function numbers(list, fields) {
  for (const row of list) {
    for (const field of fields) row[field] = row[field] == null ? null : Number(row[field]);
  }
  return list;
}

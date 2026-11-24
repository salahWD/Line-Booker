// Small helpers shared by the model files.
import { db } from '../config/db.js';

/** Use the transaction when given, otherwise the shared connection pool. */
export const exec = (tx) => tx ?? db;

/** First row or null. */
export const one = (rows) => rows[0] ?? null;

/** Run raw SQL (drizzle `sql` template) and return plain rows. */
export async function rows(query, tx) {
  const result = await exec(tx).execute(query);
  return result.rows;
}

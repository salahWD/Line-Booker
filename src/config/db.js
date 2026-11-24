// Single PostgreSQL pool + Drizzle instance shared by the whole app.
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { env } from './env.js';
import * as schema from '../models/schema/index.js';
import { logger } from '../utils/logger.js';

// Return DATE columns as plain 'YYYY-MM-DD' strings (they are branch-local calendar days,
// so converting them to JS Dates would shift them by the server's timezone).
pg.types.setTypeParser(1082, (value) => value);
// NUMERIC money columns arrive as strings; keep them as strings and format explicitly.

export const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 15 });
pool.on('error', (err) => logger.error('PostgreSQL pool error', err));

// casing: camelCase property names in JS ↔ snake_case column names in PostgreSQL.
export const db = drizzle(pool, { schema, casing: 'snake_case' });

/**
 * Runs `work(tx)` inside a database transaction.
 * Code inside can register `tx.afterCommit(fn)` callbacks — they run only after the
 * transaction commits (e.g. enqueueing jobs), and never if it rolls back.
 */
export async function transaction(work) {
  const afterCommit = [];
  const result = await db.transaction(async (tx) => {
    tx.afterCommit = (fn) => afterCommit.push(fn);
    return work(tx);
  });
  for (const fn of afterCommit) {
    try {
      await fn();
    } catch (err) {
      logger.error('afterCommit callback failed', err);
    }
  }
  return result;
}

/** True when a Postgres error is a unique-constraint violation (optionally on a given index). */
export function isUniqueViolation(err, constraintName) {
  const pgErr = err?.cause ?? err;
  if (pgErr?.code !== '23505') return false;
  return constraintName ? pgErr.constraint === constraintName : true;
}

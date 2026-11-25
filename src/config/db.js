// Single MySQL / MariaDB pool + Drizzle instance shared by the whole app.
import mysql from 'mysql2/promise';
import { drizzle } from 'drizzle-orm/mysql2';
import { env } from './env.js';
import * as schema from '../models/schema/index.js';
import { logger } from '../utils/logger.js';

export const pool = mysql.createPool({
  uri: env.DATABASE_URL,
  connectionLimit: env.DB_POOL_SIZE,
  charset: 'utf8mb4',
  timezone: 'Z', // JS Dates are sent as UTC
  dateStrings: true, // DATE / DATETIME come back as strings; Drizzle and our helpers convert them
  waitForConnections: true,
  enableKeepAlive: true,
});

// Every connection works in UTC and with READ COMMITTED, like PostgreSQL's default:
// a statement always sees rows committed before it started (needed by the line locks).
pool.pool.on('connection', (conn) => {
  conn.query("SET time_zone = '+00:00'");
  conn.query('SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED');
});

// casing: camelCase property names in JS ↔ snake_case column names in MySQL.
export const db = drizzle(pool, { schema, mode: 'default', casing: 'snake_case' });

// Deadlocks and lock timeouts are safe to retry: the whole transaction was rolled back.
const RETRYABLE = new Set([1213, 1205]); // ER_LOCK_DEADLOCK, ER_LOCK_WAIT_TIMEOUT
const MAX_TRIES = 4;

/**
 * Runs `work(tx)` inside a database transaction (retried on deadlock).
 * Code inside can register `tx.afterCommit(fn)` callbacks — they run only after the
 * transaction commits (e.g. sending notifications), and never if it rolls back.
 */
export async function transaction(work) {
  for (let attempt = 1; ; attempt += 1) {
    const afterCommit = [];
    try {
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
    } catch (err) {
      if (attempt >= MAX_TRIES || !RETRYABLE.has(dbError(err)?.errno)) throw err;
      await new Promise((resolve) => setTimeout(resolve, 20 * attempt + Math.random() * 30));
    }
  }
}

/** The driver error behind a Drizzle error (Drizzle wraps it in `cause`). */
export const dbError = (err) => (err?.errno ? err : err?.cause);

/** True when a MySQL error is a duplicate-key violation (optionally on a given unique index). */
export function isUniqueViolation(err, constraintName) {
  const e = dbError(err);
  if (e?.errno !== 1062) return false; // ER_DUP_ENTRY
  return constraintName ? String(e.sqlMessage ?? e.message).includes(constraintName) : true;
}

// pg-boss setup: background jobs stored in PostgreSQL (schema "pgboss").
import PgBoss from 'pg-boss';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

export const QUEUES = {
  NOTIFY_SEND: 'notify-send', // send one SMS/push notification (with retries)
  HOLD_EXPIRY: 'hold-expiry', // release an unpaid appointment hold when its time is up
  REMINDER: 'appointment-reminder', // remind the customer before a confirmed appointment
  EVERY_MINUTE: 'every-minute', // safety sweeps: stuck notifications, due holds, line alerts
  DAY_CLOSE: 'day-close', // expire yesterday's tickets, mark no-shows
  HOURLY_CLEANUP: 'hourly-cleanup', // delete old OTP codes
};

const QUEUE_OPTIONS = {
  [QUEUES.NOTIFY_SEND]: { retryLimit: 4, retryDelay: 15, retryBackoff: true, expireInSeconds: 60 },
  [QUEUES.HOLD_EXPIRY]: { retryLimit: 3, retryDelay: 30 },
  [QUEUES.REMINDER]: { retryLimit: 3, retryDelay: 60 },
  [QUEUES.EVERY_MINUTE]: { retryLimit: 0, expireInSeconds: 55 },
  [QUEUES.DAY_CLOSE]: { retryLimit: 1 },
  [QUEUES.HOURLY_CLEANUP]: { retryLimit: 1 },
};

let boss = null;

/** Starts pg-boss and makes sure every queue exists. Safe to call once per process. */
export async function startBoss() {
  if (boss) return boss;
  const instance = new PgBoss({ connectionString: env.DATABASE_URL, schema: 'pgboss' });
  instance.on('error', (err) => logger.error('pg-boss error', err));
  await instance.start();
  for (const [name, options] of Object.entries(QUEUE_OPTIONS)) await instance.createQueue(name, options);
  boss = instance;
  return boss;
}

export function getBoss() {
  return boss;
}

export async function stopBoss() {
  if (boss) await boss.stop({ graceful: true, timeout: 10_000 });
  boss = null;
}

/**
 * Adds a job. Never throws: if the queue is unavailable the work is picked up later by the
 * every-minute sweep (notifications and holds are also tracked in our own tables).
 */
export async function enqueue(name, data, options = {}) {
  if (!boss) return null;
  try {
    return await boss.send(name, data, options);
  } catch (err) {
    logger.error(`Could not enqueue ${name}`, err);
    return null;
  }
}

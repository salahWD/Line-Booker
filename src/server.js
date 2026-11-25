// Starts the web server and (optionally) the background jobs.
import { env } from './config/env.js';
import { pool } from './config/db.js';
import { runMigrations } from './config/migrate.js';
import { app } from './app.js';
import { startJobs, stopJobs } from './jobs/index.js';
import { logger } from './utils/logger.js';

// On hosts without a deploy hook (e.g. shared hosting) the app can migrate itself on start.
if (env.RUN_MIGRATIONS) {
  await runMigrations();
  logger.info('Database migrations applied.');
}
if (env.RUN_JOBS) await startJobs();

const server = app.listen(env.PORT, () => {
  logger.info(`${env.APP_NAME} is running on ${env.APP_URL} (port ${env.PORT}, ${env.NODE_ENV})`);
  if (env.SMS_PROVIDER === 'mock') logger.warn('SMS provider: MOCK — no real SMS is sent. See /dev/notifications');
  if (env.pushProvider === 'mock') logger.warn('Push provider: MOCK — set FIREBASE_* env vars for real push notifications.');
  if (!env.RUN_JOBS && !env.CRON_SECRET) logger.warn('RUN_JOBS=false and no CRON_SECRET: background jobs will not run.');
});

async function shutdown(signal) {
  logger.info(`${signal} received, shutting down…`);
  stopJobs();
  server.closeAllConnections(); // also ends open SSE streams
  server.close();
  await pool.end();
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

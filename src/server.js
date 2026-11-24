// Starts the web server, the realtime listener and (optionally) the background workers.
import { env } from './config/env.js';
import { pool } from './config/db.js';
import { app } from './app.js';
import { startListener } from './services/realtime.service.js';
import { startBoss, stopBoss } from './jobs/boss.js';
import { startJobs } from './jobs/index.js';
import { logger } from './utils/logger.js';

await startListener();
// The web process always needs pg-boss to *add* jobs; RUN_JOBS decides if it also *runs* them.
if (env.RUN_JOBS) await startJobs();
else await startBoss();

const server = app.listen(env.PORT, () => {
  logger.info(`${env.APP_NAME} is running on ${env.APP_URL} (port ${env.PORT}, ${env.NODE_ENV})`);
  if (env.SMS_PROVIDER === 'mock') logger.warn('SMS provider: MOCK — no real SMS is sent. See /dev/notifications');
  if (env.pushProvider === 'mock') logger.warn('Push provider: MOCK — set FIREBASE_* env vars for real push notifications.');
});

async function shutdown(signal) {
  logger.info(`${signal} received, shutting down…`);
  server.closeAllConnections(); // also ends open SSE streams
  server.close();
  await stopBoss();
  await pool.end();
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

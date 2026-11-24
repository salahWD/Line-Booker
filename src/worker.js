// Optional separate worker process (set RUN_JOBS=false for the web process, then `npm run worker`).
import { pool } from './config/db.js';
import { startJobs } from './jobs/index.js';
import { stopBoss } from './jobs/boss.js';
import { logger } from './utils/logger.js';

await startJobs();
logger.info('Worker process ready.');

async function shutdown() {
  await stopBoss();
  await pool.end();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Background jobs, stored in MySQL (no extra queue service needed on shared hosting).
//
// `tick()` runs the recurring tasks below that are due. It is called:
//   • every 15 s inside the app when RUN_JOBS=true, and/or
//   • by a hosting cron job: GET /internal/tick?key=CRON_SECRET (keeps working if the
//     host pauses idle apps).
// A row per task in `job_runs` works as a lock + "last run" clock, so several processes
// (or the app and the cron job) never run the same task twice at the same time.
import { and, eq, isNull, lte, or } from 'drizzle-orm';
import { db } from '../config/db.js';
import { jobRuns } from '../models/schema/index.js';
import { affected } from '../models/db-helpers.js';
import { sendDue } from '../services/notification.service.js';
import { expireDueHolds, sendDueReminders } from '../services/appointment.service.js';
import { sweepAllLines } from '../services/alert.service.js';
import { dayClose, hourlyCleanup } from '../services/maintenance.service.js';
import { logger } from '../utils/logger.js';

const TICK_MS = 15_000;
const LEASE_MS = 5 * 60_000; // a task that runs longer than this is assumed dead

const TASKS = [
  {
    name: 'sweep',
    everyMs: TICK_MS,
    run: async () => {
      await sendDue(); // notifications to retry (and ones whose sender died)
      await expireDueHolds(); // unpaid appointment holds whose time is up
      await sweepAllLines(); // "your turn is coming" alerts that became due as time passed
      await sendDueReminders(); // appointment reminders
    },
  },
  { name: 'day-close', everyMs: 15 * 60_000, run: dayClose }, // expire old tickets, mark no-shows
  { name: 'cleanup', everyMs: 60 * 60_000, run: hourlyCleanup }, // delete old OTP codes and sessions
];

/** Takes the task's lock if it is due and nobody else is running it. */
async function claim(task) {
  await db.insert(jobRuns).ignore().values({ name: task.name });
  const now = Date.now();
  const result = await db
    .update(jobRuns)
    .set({ lockedUntil: new Date(now + LEASE_MS), lastStartedAt: new Date(now) })
    .where(
      and(
        eq(jobRuns.name, task.name),
        or(isNull(jobRuns.lockedUntil), lte(jobRuns.lockedUntil, new Date(now))),
        // a little slack so a 15 s timer that fires a few ms early still counts
        or(isNull(jobRuns.lastStartedAt), lte(jobRuns.lastStartedAt, new Date(now - task.everyMs + 1_000))),
      ),
    );
  return affected(result) > 0;
}

async function runTask(task) {
  if (!(await claim(task))) return false;
  let error = null;
  try {
    await task.run();
  } catch (err) {
    error = err;
    logger.error(`Job "${task.name}" failed`, err);
  }
  await db
    .update(jobRuns)
    .set({ lockedUntil: null, lastFinishedAt: new Date(), lastError: error ? String(error.message).slice(0, 1000) : null })
    .where(eq(jobRuns.name, task.name));
  return true;
}

let running = false;

/** Runs every task that is due. Returns the names of the tasks that ran. */
export async function tick() {
  if (running) return []; // the previous tick is still busy in this process
  running = true;
  const ran = [];
  try {
    for (const task of TASKS) if (await runTask(task)) ran.push(task.name);
  } catch (err) {
    logger.error('Job tick failed', err);
  } finally {
    running = false;
  }
  return ran;
}

let timer = null;

export async function startJobs() {
  if (timer) return;
  timer = setInterval(() => void tick(), TICK_MS);
  void tick();
  logger.info('Background jobs started (MySQL job runner, every 15 s).');
}

export function stopJobs() {
  if (timer) clearInterval(timer);
  timer = null;
}

// Registers the background workers and the recurring schedules.
import { startBoss, QUEUES } from './boss.js';
import { sendNotification, sweepStuck } from '../services/notification.service.js';
import { expireHold, expireDueHolds, sendReminder } from '../services/appointment.service.js';
import { sweepAllLines } from '../services/alert.service.js';
import { dayClose, hourlyCleanup } from '../services/maintenance.service.js';
import { logger } from '../utils/logger.js';

/** Each handler receives an array of jobs (pg-boss v10); we process them one by one. */
const each = (fn) => async (jobs) => {
  for (const job of jobs) await fn(job.data ?? {});
};

export async function startJobs() {
  const boss = await startBoss();

  // Three parallel senders keep "your turn" alerts quick even when many go out at once.
  for (let i = 0; i < 3; i += 1) {
    await boss.work(QUEUES.NOTIFY_SEND, { pollingIntervalSeconds: 1 }, each(({ id }) => sendNotification(id)));
  }
  await boss.work(QUEUES.HOLD_EXPIRY, each(({ appointmentId }) => expireHold(appointmentId)));
  await boss.work(QUEUES.REMINDER, each(({ appointmentId, startsAt }) => sendReminder(appointmentId, startsAt)));

  await boss.work(
    QUEUES.EVERY_MINUTE,
    each(async () => {
      await sweepStuck(); // notifications that never reached the queue
      await expireDueHolds(); // unpaid holds past their time (backup for hold-expiry jobs)
      await sweepAllLines(); // "approaching" alerts that became due as time passed
    }),
  );
  await boss.work(QUEUES.DAY_CLOSE, each(dayClose));
  await boss.work(QUEUES.HOURLY_CLEANUP, each(hourlyCleanup));

  await boss.schedule(QUEUES.EVERY_MINUTE, '* * * * *');
  await boss.schedule(QUEUES.DAY_CLOSE, '*/15 * * * *');
  await boss.schedule(QUEUES.HOURLY_CLEANUP, '7 * * * *');

  logger.info('Background jobs started (pg-boss).');
  return boss;
}

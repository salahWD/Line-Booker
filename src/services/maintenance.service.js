// End-of-day housekeeping, run every 15 minutes by a job (each branch uses its own timezone):
//   • tickets left from previous days → expired
//   • confirmed / checked-in appointments of previous days that never completed → no_show
import { transaction } from '../config/db.js';
import * as branchModel from '../models/branch.model.js';
import * as lineModel from '../models/line.model.js';
import * as ticketModel from '../models/ticket.model.js';
import * as misc from '../models/misc.model.js';
import * as realtime from './realtime.service.js';
import { closePastDays } from './appointment.service.js';
import { todayIn } from '../utils/dates.js';

export async function dayClose() {
  const branches = await branchModel.listAll();
  for (const branch of branches) {
    const today = todayIn(branch.timezone);
    for (const line of await lineModel.listByBranch(branch.id)) {
      await transaction(async (tx) => {
        await lineModel.lock(line.id, tx);
        const expired = await ticketModel.expireBefore(line.id, today, tx);
        if (expired.length) await realtime.notifyLineChange(tx, { lineId: line.id, branchId: branch.id, type: 'day_closed' });
      });
    }
    await closePastDays(branch);
  }
}

export async function hourlyCleanup() {
  await misc.deleteOldOtps();
}

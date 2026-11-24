// Phone alerts for people waiting in a line:
//   • "approaching" — sent once, when the estimated wait drops to the customer's chosen lead
//     time (e.g. 15 min) OR when only a few people are left ahead (line.alertAheadThreshold).
//   • "your turn"   — sent when the ticket is called (and again on recall).
// Delivery: Firebase push to the customer's devices, SMS when push is unavailable/fails.
import { transaction } from '../config/db.js';
import * as lineModel from '../models/line.model.js';
import * as ticketModel from '../models/ticket.model.js';
import * as notifications from './notification.service.js';
import * as estimate from './estimate.service.js';
import { orderedWaiting } from './queueOrder.service.js';
import { t } from '../locales/ar.js';
import { logger } from '../utils/logger.js';

const MAX_CHECKED = 60; // nobody further back than this is close to their turn

const trackingLink = (ticket) => notifications.absoluteUrl(`/t/${ticket.trackingToken}`);

function aheadText(ahead) {
  if (ahead === 0) return t('ticket.aheadNone');
  if (ahead === 1) return t('ticket.aheadOne');
  return t('ticket.aheadCount', { count: ahead });
}

/** Looks at every waiting ticket of a line and sends due "approaching" alerts. */
export async function checkLine(lineId) {
  try {
    const found = await lineModel.findWithBranch(lineId);
    if (!found) return;
    const { line, branch } = found;
    if (!line.isActive || !line.isOpen || line.isPaused) return; // nobody moves while paused

    const ordered = await orderedWaiting(line, branch.timezone);
    if (!ordered.length) return;
    const stats = await estimate.getStats(line, branch.timezone);

    for (const [ahead, ticket] of ordered.slice(0, MAX_CHECKED).entries()) {
      if (ticket.approachAlertedAt || (!ticket.customerId && !ticket.phone)) continue;
      const est = estimate.estimateWait(stats, ahead, { timezone: branch.timezone });
      const lead = ticket.alertLeadMinutes ?? line.defaultAlertLeadMinutes;
      const due = ahead < line.alertAheadThreshold || est.lowMin <= lead;
      if (!due) continue;

      await transaction(async (tx) => {
        // Claiming inside the transaction guarantees the alert is sent only once.
        const claimed = await ticketModel.claimApproachAlert(ticket.id, tx);
        if (!claimed) return;
        await notifications.notifyCustomer(tx, {
          userId: ticket.customerId,
          phone: ticket.phone,
          kind: 'turn_approaching',
          title: t('sms.turnApproachingTitle'),
          body: notifications.message('turnApproaching', {
            code: ticket.displayCode,
            line: line.name,
            ahead: aheadText(ahead),
            minutes: est.lowMin,
            link: trackingLink(ticket),
          }),
          link: trackingLink(ticket),
          ticketId: ticket.id,
        });
      });
    }
  } catch (err) {
    logger.error(`Alert check failed for line ${lineId}`, err);
  }
}

/** Called inside the "call" transaction: tells the customer to come to the counter now. */
export async function sendYourTurn(tx, ticket, line) {
  if (!ticket.customerId && !ticket.phone) return;
  await notifications.notifyCustomer(tx, {
    userId: ticket.customerId,
    phone: ticket.phone,
    kind: 'your_turn',
    title: t('sms.yourTurnTitle'),
    body: notifications.message('yourTurn', {
      code: ticket.displayCode,
      counter: ticket.counterLabel || t('client.serviceDesk'),
      line: line.name,
    }),
    link: trackingLink(ticket),
    ticketId: ticket.id,
  });
}

/** Every-minute sweep: estimates change over time even when nothing is clicked. */
export async function sweepAllLines() {
  const lines = await lineModel.listAllActive();
  const counts = await ticketModel.waitingCounts(lines.map((l) => l.line.id));
  for (const { line } of lines) if (counts[line.id]) await checkLine(line.id);
}

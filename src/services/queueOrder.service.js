// Decides who is called next in a line.
//
// Every ticket belongs to one priority group:
//   appointment → an appointment holder who checked in no later than (slot + late grace).
//                 Ordered by their appointment time.
//   walk_in     → everyone else (including late appointment holders). Ordered by arrival.
//
// Branch policies (lines.queue_policy):
//   fifo          strictly by arrival, appointments get no priority
//   booked_first  all on-time appointment holders first, then walk-ins
//   interleave    N appointment holders, then 1 walk-in, then N, then 1 … (N = interleave_ratio)
//                 so walk-ins are never starved. Falls back to whichever group is not empty.
import * as ticketModel from '../models/ticket.model.js';
import { todayIn } from '../utils/dates.js';

const byTime = (key) => (a, b) => new Date(a[key]) - new Date(b[key]) || a.id - b.id;

/**
 * Pure function: returns the waiting tickets in the order they will be called.
 * @param {Array<{id, priorityGroup, sortAt, joinedAt}>} tickets
 * @param {{policy: string, ratio?: number, recentGroups?: string[]}} options
 *        recentGroups = priority groups of the latest calls, newest first (memory for "interleave")
 */
export function orderQueue(tickets, { policy, ratio = 2, recentGroups = [] }) {
  if (policy === 'fifo') return [...tickets].sort(byTime('joinedAt'));

  const booked = tickets.filter((t) => t.priorityGroup === 'appointment').sort(byTime('sortAt'));
  const walkIns = tickets.filter((t) => t.priorityGroup !== 'appointment').sort(byTime('sortAt'));
  if (policy === 'booked_first') return [...booked, ...walkIns];

  // interleave: how many appointment holders were called in a row just before now?
  let streak = 0;
  for (const group of recentGroups) {
    if (group !== 'appointment') break;
    streak += 1;
  }
  const ordered = [];
  while (booked.length || walkIns.length) {
    const takeBooked = booked.length > 0 && (streak < ratio || walkIns.length === 0);
    if (takeBooked) {
      ordered.push(booked.shift());
      streak += 1;
    } else {
      ordered.push(walkIns.shift());
      streak = 0;
    }
  }
  return ordered;
}

/** Loads today's waiting tickets of a line and orders them with the line's policy. */
export async function orderedWaiting(line, timezone, tx) {
  const date = todayIn(timezone);
  const waiting = await ticketModel.listByStatus(line.id, date, ['waiting'], tx);
  const recentGroups =
    line.queuePolicy === 'interleave' ? await ticketModel.recentCallGroups(line.id, date, 20, tx) : [];
  return orderQueue(waiting, { policy: line.queuePolicy, ratio: line.interleaveRatio, recentGroups });
}

/** Priority group and ordering key for a new ticket. */
export function priorityFor({ appointment, line, now = new Date() }) {
  if (appointment) {
    const lateLimit = new Date(new Date(appointment.startsAt).getTime() + line.lateGraceMinutes * 60_000);
    if (now <= lateLimit) return { priorityGroup: 'appointment', sortAt: new Date(appointment.startsAt) };
  }
  return { priorityGroup: 'walk_in', sortAt: now };
}

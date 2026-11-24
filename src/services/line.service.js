// Live lines ("take a number") — joining, checking in with an appointment, operator actions
// and the read models for the tracker page, operator console and display screens.
//
// Ticket life cycle:
//   waiting ──call──▶ called ──complete──▶ completed
//      ▲                │  └──recall (stays called, alerts again)
//      └──restore── skipped ◀──skip──┘
//   waiting/called/skipped ──cancel──▶ cancelled      (leftovers at day end ──▶ expired)
//
// Concurrency: every change runs in a transaction that first takes a per-line advisory lock,
// then updates rows only if they are still in the expected status. Two operators pressing
// "call next" at once are therefore served one after the other and get different tickets.
import { transaction, isUniqueViolation } from '../config/db.js';
import * as lineModel from '../models/line.model.js';
import * as ticketModel from '../models/ticket.model.js';
import * as branchModel from '../models/branch.model.js';
import * as appointmentModel from '../models/appointment.model.js';
import * as slotModel from '../models/slot.model.js';
import * as userModel from '../models/user.model.js';
import * as access from './access.service.js';
import * as estimate from './estimate.service.js';
import * as alerts from './alert.service.js';
import * as realtime from './realtime.service.js';
import * as notifications from './notification.service.js';
import { orderedWaiting, priorityFor } from './queueOrder.service.js';
import { randomToken, ticketDisplayCode } from '../utils/codes.js';
import { todayIn, nowIn, hhmm } from '../utils/dates.js';
import { normalizePhone, maskPhone } from '../utils/phone.js';
import { badRequest, conflict, notFound } from '../utils/errors.js';
import { t } from '../locales/ar.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Branch open right now? (no hours configured = always open; holidays = closed) */
export async function isBranchOpenNow(branch) {
  const hours = await branchModel.listHours(branch.id);
  if (!hours.length) return true;
  const now = nowIn(branch.timezone);
  const holidays = await branchModel.holidayDates(branch.id, now.toISODate(), now.toISODate());
  if (holidays.size) return false;
  const time = now.toFormat('HH:mm:ss');
  return hours.some((h) => h.weekday === now.weekday && h.openTime <= time && time < h.closeTime);
}

/** Policy explanation shown to customers. */
export function policyText(line) {
  const main = t(`policy.${line.queuePolicy}`, { ratio: line.interleaveRatio });
  return line.queuePolicy === 'fifo' ? main : `${main} ${t('policy.late', { minutes: line.lateGraceMinutes })}`;
}

/**
 * Runs a queue change for one line: lock → change → realtime event → alerts after commit.
 * `work(tx)` returns whatever the caller needs.
 */
async function lineChange(line, type, work) {
  const result = await transaction(async (tx) => {
    await lineModel.lock(line.id, tx);
    const value = await work(tx);
    await realtime.notifyLineChange(tx, { lineId: line.id, branchId: line.branchId, type });
    tx.afterCommit(() => {
      estimate.invalidate(line.id);
      alerts.checkLine(line.id); // fire-and-forget so the operator isn't kept waiting; logs its own errors
    });
    return value;
  });
  return result;
}

/** Creates a ticket (caller holds the line lock) and stores its first estimate. */
async function createTicket(tx, { line, branch, appointment, customerId, phone, guestName, createdById }) {
  const serviceDate = todayIn(branch.timezone);
  const number = await ticketModel.nextNumber(line.id, serviceDate, tx);
  const { priorityGroup, sortAt } = priorityFor({ appointment, line });

  const ticket = await ticketModel.create(
    {
      businessId: line.businessId,
      branchId: line.branchId,
      lineId: line.id,
      serviceDate,
      number,
      displayCode: ticketDisplayCode(line.codePrefix, number),
      source: appointment ? 'appointment' : 'walk_in',
      appointmentId: appointment?.id ?? null,
      customerId: customerId ?? null,
      phone: phone ?? null,
      guestName: guestName ?? null,
      priorityGroup,
      sortAt,
      trackingToken: randomToken(),
      alertLeadMinutes: line.defaultAlertLeadMinutes,
      createdById: createdById ?? null,
    },
    tx,
  );

  // Remember the estimate we showed at the start — reports compare it with the real wait.
  const ordered = await orderedWaiting(line, branch.timezone, tx);
  const ahead = Math.max(0, ordered.findIndex((x) => x.id === ticket.id));
  const stats = await estimate.getStats(line, branch.timezone);
  const est = estimate.estimateWait(stats, ahead, { timezone: branch.timezone });
  return ticketModel.update(
    ticket.id,
    { estimateLowMin: est.lowMin, estimateHighMin: est.highMin, estimateMethod: est.method },
    tx,
  );
}

async function loadLine(lineId) {
  const found = await lineModel.findWithBranch(Number(lineId));
  if (!found || !found.line.isActive || !found.branch.isActive || !found.businessActive) throw notFound();
  return found;
}

// ─── Customer actions ───────────────────────────────────────────────────────

/**
 * A logged-in customer takes a number.
 * `onsite` = true when they came through the QR poster at the branch (allowed even when
 * remote joining is switched off for the line).
 * Returns { ticket, outcome: 'created' | 'existing' | 'checked_in' }.
 */
export async function joinAsCustomer(customer, lineId, { onsite = false } = {}) {
  const { line, branch } = await loadLine(lineId);
  if (!line.isOpen) throw badRequest(t('ticket.lineClosed'));
  if (!line.allowRemoteJoin && !onsite) throw badRequest(t('ticket.remoteJoinDisabled'));
  if (!(await isBranchOpenNow(branch))) throw badRequest(t('ticket.branchClosedNow'));

  try {
    return await lineChange(line, 'joined', async (tx) => {
      const existing = await ticketModel.findActiveForCustomer(line.id, customer.id, tx);
      if (existing) return { ticket: existing, outcome: 'existing' };

      // Has an appointment on this line today? Then this is a check-in, not a new walk-in.
      const appointment = await appointmentModel.findForCustomerLineDay(customer.id, line.id, todayIn(branch.timezone), tx);
      if (appointment?.status === 'confirmed') {
        const ticket = await checkInLocked(tx, { appointment, line, branch, actorId: customer.id });
        return { ticket, outcome: 'checked_in' };
      }

      const ticket = await createTicket(tx, { line, branch, customerId: customer.id, phone: customer.phone });
      return { ticket, outcome: 'created' };
    });
  } catch (err) {
    // Lost a race with a parallel request from the same customer → return the ticket that won.
    if (isUniqueViolation(err)) {
      const existing = await ticketModel.findActiveForCustomer(line.id, customer.id);
      if (existing) return { ticket: existing, outcome: 'existing' };
    }
    throw err;
  }
}

/** Customer (by tracking link) chooses how many minutes before their turn to be alerted. */
export async function setAlertLead(token, minutes) {
  const ticket = await ticketModel.findByToken(token);
  if (!ticket || !['waiting', 'called'].includes(ticket.status)) throw notFound();
  const updated = await ticketModel.update(ticket.id, { alertLeadMinutes: minutes });
  await alerts.checkLine(ticket.lineId);
  return updated;
}

/** Customer cancels their own ticket (whoever holds the secret tracking link). */
export async function cancelByToken(token, actorId) {
  const ticket = await ticketModel.findByToken(token);
  if (!ticket) throw notFound();
  const { line } = await loadLine(ticket.lineId);
  return lineChange(line, 'cancelled', (tx) => cancelLocked(tx, ticket, actorId));
}

// ─── Appointment check-in ───────────────────────────────────────────────────

/**
 * Turns a confirmed appointment into a ticket in its line (caller holds the line lock).
 * If the customer already took a walk-in number, that ticket is upgraded instead of
 * creating a second one.
 */
async function checkInLocked(tx, { appointment, line, branch, actorId }) {
  const existing = await ticketModel.findActiveForAppointment(appointment.id, tx);
  if (existing) return existing;

  const walkIn = await ticketModel.findActiveForCustomer(line.id, appointment.customerId, tx);
  let ticket;
  if (walkIn) {
    const { priorityGroup, sortAt } = priorityFor({ appointment, line });
    ticket = await ticketModel.update(walkIn.id, { source: 'appointment', appointmentId: appointment.id, priorityGroup, sortAt }, tx);
  } else {
    const customer = await userModel.findById(appointment.customerId, tx);
    ticket = await createTicket(tx, {
      line,
      branch,
      appointment,
      customerId: appointment.customerId,
      phone: customer?.phone,
      createdById: actorId,
    });
  }

  const updated = await appointmentModel.transition(
    appointment.id,
    { from: ['confirmed'] },
    { status: 'checked_in', checkedInAt: new Date() },
    tx,
  );
  if (!updated) throw conflict(t('appointment.checkInNeedsConfirm'));
  await appointmentModel.addEvent(appointment.id, 'checked_in', actorId, { ticket: ticket.displayCode }, tx);
  return ticket;
}

/**
 * Check in an appointment. Customers can do it themselves from `checkinOpenMinutes`
 * before the slot; staff can do it any time on the day.
 */
export async function checkIn(actor, appointmentId, { byStaff = false } = {}) {
  const appointment = await appointmentModel.findById(Number(appointmentId));
  if (!appointment) throw notFound();
  if (byStaff) await access.assertRecordAccess(actor, appointment);
  else if (appointment.customerId !== actor.id) throw notFound();

  const { line, branch } = await loadLine(appointment.lineId);
  if (appointment.status === 'checked_in') {
    const ticket = await ticketModel.findActiveForAppointment(appointment.id);
    if (ticket) return ticket;
  }
  if (appointment.status !== 'confirmed') throw badRequest(t('appointment.checkInNeedsConfirm'));
  if (appointment.localDate !== todayIn(branch.timezone)) throw badRequest(t('appointment.checkInNotYet', { minutes: line.checkinOpenMinutes }));
  if (!byStaff) {
    const opensAt = new Date(appointment.startsAt).getTime() - line.checkinOpenMinutes * 60_000;
    if (Date.now() < opensAt) throw badRequest(t('appointment.checkInNotYet', { minutes: line.checkinOpenMinutes }));
  }

  return lineChange(line, 'checked_in', async (tx) => {
    const locked = await appointmentModel.findByIdForUpdate(appointment.id, tx);
    return checkInLocked(tx, { appointment: locked, line, branch, actorId: actor.id });
  });
}

// ─── Operator actions ───────────────────────────────────────────────────────

/** Loads a ticket and checks that the staff member may operate its line. */
async function ticketForStaff(user, ticketId) {
  const ticket = await ticketModel.findById(Number(ticketId));
  if (!ticket) throw notFound();
  const { line, branch } = await access.getLineForStaff(user, ticket.lineId);
  return { ticket, line, branch };
}

const alreadyHandled = () => conflict(t('operator.alreadyHandled'));

async function callLocked(tx, ticket, line, counterLabel) {
  const now = new Date();
  const firstCall = !ticket.firstCalledAt;
  const called = await ticketModel.transition(
    ticket.id,
    ['waiting'],
    {
      status: 'called',
      lastCalledAt: now,
      counterLabel: counterLabel || ticket.counterLabel || null,
      firstCalledAt: ticket.firstCalledAt ?? now,
      // Real waiting time (join → first call) — compared with the estimate in reports.
      actualWaitSeconds: firstCall ? Math.round((now - new Date(ticket.joinedAt)) / 1000) : ticket.actualWaitSeconds,
    },
    tx,
  );
  if (!called) throw alreadyHandled();
  await alerts.sendYourTurn(tx, called, line);
  return called;
}

export async function callNext(user, lineId, counterLabel) {
  const { line, branch } = await access.getLineForStaff(user, lineId);
  return lineChange(line, 'called', async (tx) => {
    const [next] = await orderedWaiting(line, branch.timezone, tx);
    if (!next) return null;
    return callLocked(tx, next, line, counterLabel);
  });
}

export async function callTicket(user, ticketId, counterLabel) {
  const { ticket, line } = await ticketForStaff(user, ticketId);
  return lineChange(line, 'called', (tx) => callLocked(tx, ticket, line, counterLabel));
}

export async function recall(user, ticketId) {
  const { ticket, line } = await ticketForStaff(user, ticketId);
  return lineChange(line, 'recalled', async (tx) => {
    const updated = await ticketModel.transition(
      ticket.id,
      ['called'],
      { lastCalledAt: new Date(), recallCount: ticket.recallCount + 1 },
      tx,
    );
    if (!updated) throw alreadyHandled();
    await alerts.sendYourTurn(tx, updated, line);
    return updated;
  });
}

export async function complete(user, ticketId) {
  const { ticket, line } = await ticketForStaff(user, ticketId);
  return lineChange(line, 'completed', async (tx) => {
    const updated = await ticketModel.transition(ticket.id, ['called'], { status: 'completed', completedAt: new Date() }, tx);
    if (!updated) throw alreadyHandled();
    if (updated.appointmentId) {
      const done = await appointmentModel.transition(
        updated.appointmentId,
        { from: ['checked_in'] },
        { status: 'completed', completedAt: new Date() },
        tx,
      );
      if (done) await appointmentModel.addEvent(updated.appointmentId, 'completed', user.id, null, tx);
    }
    return updated;
  });
}

export async function skip(user, ticketId) {
  const { ticket, line } = await ticketForStaff(user, ticketId);
  return lineChange(line, 'skipped', async (tx) => {
    const updated = await ticketModel.transition(ticket.id, ['waiting', 'called'], { status: 'skipped', closedAt: new Date() }, tx);
    if (!updated) throw alreadyHandled();
    return updated;
  });
}

/** Puts a skipped ticket back in the line at its original place. */
export async function restore(user, ticketId) {
  const { ticket, line } = await ticketForStaff(user, ticketId);
  return lineChange(line, 'restored', async (tx) => {
    const updated = await ticketModel.transition(ticket.id, ['skipped'], { status: 'waiting', closedAt: null }, tx);
    if (!updated) throw alreadyHandled();
    return updated;
  });
}

async function cancelLocked(tx, ticket, actorId) {
  const updated = await ticketModel.transition(
    ticket.id,
    ['waiting', 'called', 'skipped'],
    { status: 'cancelled', closedAt: new Date() },
    tx,
  );
  if (!updated) throw alreadyHandled();
  if (updated.appointmentId) {
    const cancelled = await appointmentModel.transition(
      updated.appointmentId,
      { from: ['checked_in'] },
      { status: 'cancelled', cancelledAt: new Date(), cancelledById: actorId },
      tx,
    );
    if (cancelled) {
      await slotModel.release(cancelled.slotId, tx);
      await appointmentModel.addEvent(cancelled.id, 'cancelled', actorId, { via: 'ticket' }, tx);
    }
  }
  return updated;
}

export async function cancel(user, ticketId) {
  const { ticket, line } = await ticketForStaff(user, ticketId);
  return lineChange(line, 'cancelled', (tx) => cancelLocked(tx, ticket, user.id));
}

export async function setPaused(user, lineId, paused, reason) {
  const { line } = await access.getLineForStaff(user, lineId);
  return lineChange(line, paused ? 'paused' : 'resumed', async (tx) => {
    if (paused && !line.isPaused) await lineModel.openPause(line.id, user.id, reason ?? null, tx);
    if (!paused) await lineModel.closeOpenPauses(line.id, tx);
    return lineModel.update(line.id, { isPaused: paused }, tx);
  });
}

export async function setOpen(user, lineId, isOpen) {
  const { line } = await access.getLineForStaff(user, lineId);
  return lineChange(line, isOpen ? 'opened' : 'closed', (tx) => lineModel.update(line.id, { isOpen }, tx));
}

/** Staff adds someone standing at the desk (optionally with a phone for alerts). */
export async function addWalkIn(user, lineId, { guestName, phone }) {
  const { line, branch } = await access.getLineForStaff(user, lineId);
  const normalized = phone ? normalizePhone(phone) : null;
  if (phone && !normalized) throw badRequest(t('auth.invalidPhone'));

  return lineChange(line, 'joined', async (tx) => {
    const ticket = await createTicket(tx, { line, branch, guestName, phone: normalized, createdById: user.id });
    if (normalized) {
      const link = notifications.absoluteUrl(`/t/${ticket.trackingToken}`);
      await notifications.queueSms(tx, {
        to: normalized,
        kind: 'ticket_created',
        body: notifications.message('ticketCreated', { code: ticket.displayCode, line: line.name, link }),
        ticketId: ticket.id,
      });
    }
    return ticket;
  });
}

// ─── Read models (what each screen receives) ────────────────────────────────

/** Public summary of a line for the branch page: waiting count + estimate for a new joiner. */
export async function publicLineSummary(line, branch) {
  const waiting = await orderedWaiting(line, branch.timezone);
  const stats = await estimate.getStats(line, branch.timezone);
  return {
    id: line.id,
    waiting: waiting.length,
    isOpen: line.isOpen,
    paused: line.isPaused,
    estimate: estimate.estimateWait(stats, waiting.length, { timezone: branch.timezone, paused: line.isPaused }),
  };
}

/** Customer tracker page data (no other customer's details, ever). */
export async function ticketView(token) {
  const ticket = await ticketModel.findByToken(token);
  if (!ticket) throw notFound();
  const found = await lineModel.findWithBranch(ticket.lineId);
  const { line, branch } = found;

  let position = null;
  let est = null;
  if (ticket.status === 'waiting') {
    const ordered = await orderedWaiting(line, branch.timezone);
    const ahead = ordered.findIndex((x) => x.id === ticket.id);
    position = ahead === -1 ? null : ahead;
    if (position !== null) {
      const stats = await estimate.getStats(line, branch.timezone);
      est = estimate.estimateWait(stats, position, { timezone: branch.timezone, paused: line.isPaused });
    }
  }

  return {
    ticket: {
      code: ticket.displayCode,
      status: ticket.status,
      source: ticket.source,
      counterLabel: ticket.counterLabel,
      lastCalledAt: ticket.lastCalledAt,
      recallCount: ticket.recallCount,
      alertLeadMinutes: ticket.alertLeadMinutes ?? line.defaultAlertLeadMinutes,
      joinedAt: ticket.joinedAt,
      customerId: ticket.customerId,
      id: ticket.id,
    },
    ahead: position,
    estimate: est,
    line: { id: line.id, name: line.name, isOpen: line.isOpen, paused: line.isPaused, policy: policyText(line) },
    branch: { name: branch.name, slug: branch.slug, timezone: branch.timezone },
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Display screen data. Only ticket codes and counter labels — never names, phones,
 * notes or payment information.
 */
export async function displayView({ branch, lineFilterId }) {
  let lines = await lineModel.listByBranch(branch.id, { activeOnly: true });
  if (lineFilterId) lines = lines.filter((l) => l.id === Number(lineFilterId));
  const date = todayIn(branch.timezone);
  const lineIds = lines.map((l) => l.id);
  const [counts, recent] = await Promise.all([
    ticketModel.waitingCounts(lineIds),
    ticketModel.recentCalls(lineIds, date, 12),
  ]);
  const lineName = Object.fromEntries(lines.map((l) => [l.id, l.name]));
  const serving = recent.filter((r) => r.status === 'called');

  return {
    branchName: branch.name,
    lines: lines.map((l) => ({
      id: l.id,
      name: l.name,
      waiting: counts[l.id] ?? 0,
      isOpen: l.isOpen,
      paused: l.isPaused,
      nowServing: serving
        .filter((r) => r.lineId === l.id)
        .map((r) => ({ id: r.id, code: r.displayCode, counter: r.counterLabel, at: r.lastCalledAt, recalls: r.recallCount })),
    })),
    recentCalls: recent.slice(0, 8).map((r) => ({
      id: r.id,
      code: r.displayCode,
      counter: r.counterLabel,
      line: lineName[r.lineId],
      at: r.lastCalledAt,
      recalls: r.recallCount,
    })),
    updatedAt: new Date().toISOString(),
  };
}

/** Everything the operator console shows for one line. */
export async function operatorView(user, lineId) {
  const { line, branch } = await access.getLineForStaff(user, lineId);
  const date = todayIn(branch.timezone);
  const [ordered, called, skipped, stats, today, appointments] = await Promise.all([
    orderedWaiting(line, branch.timezone),
    ticketModel.listByStatus(line.id, date, ['called'], null),
    ticketModel.listByStatus(line.id, date, ['skipped'], null),
    estimate.getStats(line, branch.timezone),
    ticketModel.todayStats(line.id, date),
    appointmentModel.listForLineDay(line.id, date),
  ]);
  const apptTimes = await ticketModel.appointmentTimes(
    [...ordered, ...called].map((x) => x.appointmentId).filter(Boolean),
  );

  const shape = (x, index) => ({
    id: x.id,
    code: x.displayCode,
    position: index ?? null,
    name: x.customerName || x.guestName || '',
    phone: x.phone ? maskPhone(x.phone) : '',
    source: x.source,
    priorityGroup: x.priorityGroup,
    appointmentTime: x.appointmentId ? hhmm(apptTimes[x.appointmentId]?.localTime) : null,
    joinedAt: x.joinedAt,
    lastCalledAt: x.lastCalledAt,
    counterLabel: x.counterLabel,
    recallCount: x.recallCount,
    waitedMinutes: Math.max(0, Math.round((Date.now() - new Date(x.joinedAt)) / 60_000)),
  });

  return {
    line: {
      id: line.id,
      name: line.name,
      isOpen: line.isOpen,
      paused: line.isPaused,
      policy: policyText(line),
      displayToken: line.displayToken,
    },
    branch: { id: branch.id, name: branch.name, displayToken: branch.displayToken },
    waiting: ordered.map((x, i) => shape(x, i)),
    called: called.map((x) => shape(x)).sort((a, b) => new Date(b.lastCalledAt) - new Date(a.lastCalledAt)),
    skipped: skipped.map((x) => shape(x)),
    appointments: appointments.map((a) => ({
      id: a.id,
      reference: a.reference,
      time: hhmm(a.localTime),
      status: a.status,
      paymentStatus: a.paymentStatus,
      name: a.customerName,
    })),
    stats: { served: today.served, waiting: ordered.length, avgWaitMin: today.avg_wait_min },
    estimateForNew: estimate.estimateWait(stats, ordered.length, { timezone: branch.timezone, paused: line.isPaused }),
    updatedAt: new Date().toISOString(),
  };
}

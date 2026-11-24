// The two core features live here:
//   1. Live lines  → lines, queue_tickets, queue_counters, line_pauses
//   2. Appointments → appointment_slots, appointments, appointment_events, payment_submissions
// plus notes and reviews that attach to them.
import { sql } from 'drizzle-orm';
import {
  pgTable, integer, text, varchar, boolean, numeric, date, time, jsonb, smallint,
  index, uniqueIndex, unique, check, primaryKey, foreignKey,
} from 'drizzle-orm/pg-core';
import { id, ts, createdAt, updatedAt } from './columns.js';
import { users, businesses, branches } from './core.js';
import {
  queuePolicyEnum, ticketSourceEnum, priorityGroupEnum, ticketStatusEnum, appointmentStatusEnum,
  paymentStatusEnum, submissionStatusEnum, currencyEnum, feeTypeEnum, noteKindEnum,
} from './enums.js';

// Every row below carries businessId + branchId + lineId. One composite FK to `lines`
// guarantees the three always agree, which keeps business isolation queries simple.
const lineRef = (t) =>
  foreignKey({
    columns: [t.lineId, t.branchId, t.businessId],
    foreignColumns: [lines.id, lines.branchId, lines.businessId],
  });

// ─── Live lines ──────────────────────────────────────────────────────────────

/** A named line inside a branch, e.g. "عيادة الأطفال". */
export const lines = pgTable(
  'lines',
  {
    id: id(),
    businessId: integer().notNull(),
    branchId: integer().notNull(),
    name: text().notNull(),
    description: text(),
    codePrefix: varchar({ length: 3 }).notNull().default('A'),
    // Owner's estimate of minutes spent per customer at one counter (fallback when there is no data).
    avgMinutesPerCustomer: integer().notNull().default(10),
    countersCount: smallint().notNull().default(1),
    queuePolicy: queuePolicyEnum().notNull().default('interleave'),
    interleaveRatio: smallint().notNull().default(2),
    lateGraceMinutes: integer().notNull().default(10),
    checkinOpenMinutes: integer().notNull().default(60),
    allowRemoteJoin: boolean().notNull().default(true),
    defaultAlertLeadMinutes: integer().notNull().default(15),
    alertAheadThreshold: smallint().notNull().default(2),
    isOpen: boolean().notNull().default(true),
    isPaused: boolean().notNull().default(false),
    displayToken: varchar({ length: 64 }).notNull().unique(),
    sortOrder: smallint().notNull().default(0),
    isActive: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({ columns: [t.branchId, t.businessId], foreignColumns: [branches.id, branches.businessId] }),
    unique('lines_id_branch_business_uq').on(t.id, t.branchId, t.businessId),
    check('lines_avg_minutes', sql`${t.avgMinutesPerCustomer} between 1 and 240`),
    check('lines_counters', sql`${t.countersCount} between 1 and 50`),
    check('lines_ratio', sql`${t.interleaveRatio} between 1 and 10`),
    index().on(t.branchId),
  ],
);

/** Per-line, per-day ticket number sequence (incremented atomically with an upsert). */
export const queueCounters = pgTable(
  'queue_counters',
  {
    lineId: integer().notNull().references(() => lines.id, { onDelete: 'cascade' }),
    serviceDate: date().notNull(),
    lastNumber: integer().notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.lineId, t.serviceDate] })],
);

/** History of pauses, so waiting estimates can ignore paused time. */
export const linePauses = pgTable(
  'line_pauses',
  {
    id: id(),
    lineId: integer().notNull().references(() => lines.id, { onDelete: 'cascade' }),
    pausedAt: ts().notNull().defaultNow(),
    resumedAt: ts(),
    pausedById: integer().references(() => users.id),
    reason: text(),
  },
  (t) => [index().on(t.lineId, t.pausedAt)],
);

// ─── Appointments ────────────────────────────────────────────────────────────

/** A bookable time slot that the owner marked as free. */
export const appointmentSlots = pgTable(
  'appointment_slots',
  {
    id: id(),
    businessId: integer().notNull(),
    branchId: integer().notNull(),
    lineId: integer().notNull(),
    startsAt: ts().notNull(),
    localDate: date().notNull(), // branch-local calendar day
    localTime: time().notNull(), // branch-local start time
    durationMinutes: smallint().notNull(),
    capacity: smallint().notNull().default(1),
    // Number of held/confirmed appointments on this slot. Only changed by conditional UPDATEs.
    reservedCount: smallint().notNull().default(0),
    isOpen: boolean().notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    lineRef(t),
    unique('slots_line_start_uq').on(t.lineId, t.startsAt),
    check('slots_capacity_positive', sql`${t.capacity} >= 1`),
    check('slots_reserved_non_negative', sql`${t.reservedCount} >= 0`),
    index().on(t.lineId, t.localDate),
  ],
);

export const appointments = pgTable(
  'appointments',
  {
    id: id(),
    reference: varchar({ length: 12 }).notNull().unique(),
    slotId: integer().notNull().references(() => appointmentSlots.id),
    businessId: integer().notNull(),
    branchId: integer().notNull(),
    lineId: integer().notNull(),
    customerId: integer().notNull().references(() => users.id),
    startsAt: ts().notNull(),
    localDate: date().notNull(),
    localTime: time().notNull(),
    status: appointmentStatusEnum().notNull().default('held'),
    holdExpiresAt: ts(),
    // Fee snapshot taken at booking time — later fee changes never affect this appointment.
    amountDue: numeric({ precision: 12, scale: 2 }).notNull(),
    currency: currencyEnum().notNull(),
    feeType: feeTypeEnum().notNull(),
    paymentStatus: paymentStatusEnum().notNull(),
    paymentConfirmedById: integer().references(() => users.id),
    paymentConfirmedAt: ts(),
    customerNote: text(),
    cancelReason: text(),
    cancelledById: integer().references(() => users.id),
    cancelledAt: ts(),
    confirmedAt: ts(),
    checkedInAt: ts(),
    completedAt: ts(),
    noShowAt: ts(),
    expiredAt: ts(),
    reminderSentAt: ts(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    lineRef(t),
    // One active appointment per customer, per line, per day.
    uniqueIndex('appointments_one_active_per_day')
      .on(t.customerId, t.lineId, t.localDate)
      .where(sql`${t.status} in ('held', 'confirmed', 'checked_in')`),
    index().on(t.branchId, t.localDate),
    index().on(t.status, t.holdExpiresAt),
    index().on(t.customerId),
  ],
);

/** Append-only history of what happened to an appointment and who did it. */
export const appointmentEvents = pgTable(
  'appointment_events',
  {
    id: id(),
    appointmentId: integer().notNull().references(() => appointments.id, { onDelete: 'cascade' }),
    type: varchar({ length: 40 }).notNull(),
    actorUserId: integer().references(() => users.id),
    data: jsonb(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.appointmentId)],
);

/** "I transferred the money" submissions, reviewed manually by the platform admin. */
export const paymentSubmissions = pgTable(
  'payment_submissions',
  {
    id: id(),
    appointmentId: integer().notNull().references(() => appointments.id),
    customerId: integer().notNull().references(() => users.id),
    transactionRef: varchar({ length: 80 }).notNull(),
    proofPath: text(),
    proofMime: varchar({ length: 60 }),
    proofSize: integer(),
    status: submissionStatusEnum().notNull().default('pending'),
    reviewedById: integer().references(() => users.id),
    reviewedAt: ts(),
    reviewNote: text(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('payment_submissions_one_pending')
      .on(t.appointmentId)
      .where(sql`${t.status} = 'pending'`),
    index().on(t.status, t.createdAt),
  ],
);

// ─── Tickets (defined after appointments because they reference them) ───────

export const queueTickets = pgTable(
  'queue_tickets',
  {
    id: id(),
    businessId: integer().notNull(),
    branchId: integer().notNull(),
    lineId: integer().notNull(),
    serviceDate: date().notNull(),
    number: integer().notNull(),
    displayCode: varchar({ length: 12 }).notNull(),
    source: ticketSourceEnum().notNull(),
    appointmentId: integer().references(() => appointments.id),
    customerId: integer().references(() => users.id),
    guestName: text(),
    phone: varchar({ length: 20 }),
    priorityGroup: priorityGroupEnum().notNull(),
    sortAt: ts().notNull(), // ordering key inside its priority group
    status: ticketStatusEnum().notNull().default('waiting'),
    joinedAt: ts().notNull().defaultNow(),
    firstCalledAt: ts(),
    lastCalledAt: ts(),
    recallCount: smallint().notNull().default(0),
    counterLabel: varchar({ length: 40 }),
    completedAt: ts(),
    closedAt: ts(), // skipped / cancelled / expired time
    trackingToken: varchar({ length: 64 }).notNull().unique(),
    alertLeadMinutes: smallint(),
    approachAlertedAt: ts(),
    // First estimate shown when the ticket was taken, kept to measure accuracy later.
    estimateLowMin: integer(),
    estimateHighMin: integer(),
    estimateMethod: varchar({ length: 12 }),
    actualWaitSeconds: integer(),
    createdById: integer().references(() => users.id),
    updatedAt: updatedAt(),
  },
  (t) => [
    lineRef(t),
    unique('tickets_line_day_number_uq').on(t.lineId, t.serviceDate, t.number),
    // Never two active tickets for the same appointment or the same customer in one line.
    uniqueIndex('tickets_one_active_per_appointment')
      .on(t.appointmentId)
      .where(sql`${t.status} in ('waiting', 'called') and ${t.appointmentId} is not null`),
    uniqueIndex('tickets_one_active_per_customer')
      .on(t.lineId, t.customerId)
      .where(sql`${t.status} in ('waiting', 'called') and ${t.customerId} is not null`),
    index().on(t.lineId, t.status),
    index().on(t.lineId, t.serviceDate),
    index().on(t.customerId),
  ],
);

// ─── Notes & reviews ────────────────────────────────────────────────────────

/**
 * kind = customer → written by the customer (visible to customer + staff)
 *        internal → staff only (never sent to customer pages)
 *        shared   → written by staff, visible to the customer
 */
export const notes = pgTable(
  'notes',
  {
    id: id(),
    businessId: integer().notNull().references(() => businesses.id),
    branchId: integer().notNull().references(() => branches.id),
    appointmentId: integer().references(() => appointments.id, { onDelete: 'cascade' }),
    ticketId: integer().references(() => queueTickets.id, { onDelete: 'cascade' }),
    authorId: integer().notNull().references(() => users.id),
    kind: noteKindEnum().notNull(),
    body: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check('notes_one_target', sql`num_nonnulls(${t.appointmentId}, ${t.ticketId}) = 1`),
    index().on(t.appointmentId),
    index().on(t.ticketId),
  ],
);

export const reviews = pgTable(
  'reviews',
  {
    id: id(),
    appointmentId: integer().notNull().unique().references(() => appointments.id),
    businessId: integer().notNull().references(() => businesses.id),
    branchId: integer().notNull().references(() => branches.id),
    lineId: integer().notNull().references(() => lines.id),
    customerId: integer().notNull().references(() => users.id),
    rating: smallint().notNull(),
    comment: text(),
    ownerReply: text(),
    repliedById: integer().references(() => users.id),
    repliedAt: ts(),
    createdAt: createdAt(),
  },
  (t) => [check('reviews_rating_range', sql`${t.rating} between 1 and 5`), index().on(t.branchId)],
);

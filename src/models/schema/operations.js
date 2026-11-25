// The two core features live here:
//   1. Live lines  → lines, queue_tickets, queue_counters, line_pauses
//   2. Appointments → appointment_slots, appointments, appointment_events, payment_submissions
// plus notes and reviews that attach to them.
//
// MySQL has no partial unique indexes, so "only one ACTIVE row" rules use a generated
// column that is 1 while the row is active and NULL otherwise (unique indexes ignore NULLs).
import { sql } from 'drizzle-orm';
import {
  mysqlTable, int, text, varchar, boolean, decimal, date, time, smallint, tinyint,
  index, uniqueIndex, unique, check, primaryKey, foreignKey,
} from 'drizzle-orm/mysql-core';
import { id, ts, createdAt, updatedAt, json } from './columns.js';
import { users, businesses, branches } from './core.js';
import {
  queuePolicyEnum, ticketSourceEnum, priorityGroupEnum, ticketStatusEnum, appointmentStatusEnum,
  paymentStatusEnum, submissionStatusEnum, currencyEnum, feeTypeEnum, noteKindEnum,
} from './enums.js';

// Every row below carries businessId + branchId + lineId. One composite FK to `lines`
// guarantees the three always agree, which keeps business isolation queries simple.
const lineRef = (name, t) =>
  foreignKey({
    name,
    columns: [t.lineId, t.branchId, t.businessId],
    foreignColumns: [lines.id, lines.branchId, lines.businessId],
  });

/** 1 while the row is active, NULL otherwise — used by the "one active row" unique indexes. */
const activeFlag = (condition) => tinyint().generatedAlwaysAs(sql.raw(`(case when ${condition} then 1 end)`), { mode: 'stored' });

// ─── Live lines ──────────────────────────────────────────────────────────────

/** A named line inside a branch, e.g. "عيادة الأطفال". */
export const lines = mysqlTable(
  'lines',
  {
    id: id(),
    businessId: int().notNull(),
    branchId: int().notNull(),
    name: varchar({ length: 160 }).notNull(),
    description: text(),
    codePrefix: varchar({ length: 3 }).notNull().default('A'),
    // Owner's estimate of minutes spent per customer at one counter (fallback when there is no data).
    avgMinutesPerCustomer: int().notNull().default(10),
    countersCount: smallint().notNull().default(1),
    queuePolicy: queuePolicyEnum().notNull().default('interleave'),
    interleaveRatio: smallint().notNull().default(2),
    lateGraceMinutes: int().notNull().default(10),
    checkinOpenMinutes: int().notNull().default(60),
    allowRemoteJoin: boolean().notNull().default(true),
    defaultAlertLeadMinutes: int().notNull().default(15),
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
    foreignKey({ name: 'lines_branch_fk', columns: [t.branchId, t.businessId], foreignColumns: [branches.id, branches.businessId] }),
    unique('lines_id_branch_business_uq').on(t.id, t.branchId, t.businessId),
    check('lines_avg_minutes', sql`${t.avgMinutesPerCustomer} between 1 and 240`),
    check('lines_counters', sql`${t.countersCount} between 1 and 50`),
    check('lines_ratio', sql`${t.interleaveRatio} between 1 and 10`),
    index('lines_branch_idx').on(t.branchId),
  ],
);

/** Per-line, per-day ticket number sequence (incremented atomically with an upsert). */
export const queueCounters = mysqlTable(
  'queue_counters',
  {
    lineId: int().notNull().references(() => lines.id, { onDelete: 'cascade' }),
    serviceDate: date({ mode: 'string' }).notNull(),
    lastNumber: int().notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.lineId, t.serviceDate] })],
);

/** History of pauses, so waiting estimates can ignore paused time. */
export const linePauses = mysqlTable(
  'line_pauses',
  {
    id: id(),
    lineId: int().notNull().references(() => lines.id, { onDelete: 'cascade' }),
    pausedAt: createdAt(),
    resumedAt: ts(),
    pausedById: int().references(() => users.id),
    reason: varchar({ length: 200 }),
  },
  (t) => [index('line_pauses_line_idx').on(t.lineId, t.pausedAt)],
);

// ─── Appointments ────────────────────────────────────────────────────────────

/** A bookable time slot that the owner marked as free. */
export const appointmentSlots = mysqlTable(
  'appointment_slots',
  {
    id: id(),
    businessId: int().notNull(),
    branchId: int().notNull(),
    lineId: int().notNull(),
    startsAt: ts().notNull(),
    localDate: date({ mode: 'string' }).notNull(), // branch-local calendar day
    localTime: time().notNull(), // branch-local start time
    durationMinutes: smallint().notNull(),
    capacity: smallint().notNull().default(1),
    // Number of held/confirmed appointments on this slot. Only changed by conditional UPDATEs.
    reservedCount: smallint().notNull().default(0),
    isOpen: boolean().notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    lineRef('slots_line_fk', t),
    unique('slots_line_start_uq').on(t.lineId, t.startsAt),
    check('slots_capacity_positive', sql`${t.capacity} >= 1`),
    check('slots_reserved_non_negative', sql`${t.reservedCount} >= 0`),
    index('slots_line_day_idx').on(t.lineId, t.localDate),
  ],
);

export const appointments = mysqlTable(
  'appointments',
  {
    id: id(),
    reference: varchar({ length: 12 }).notNull().unique(),
    slotId: int().notNull().references(() => appointmentSlots.id),
    businessId: int().notNull(),
    branchId: int().notNull(),
    lineId: int().notNull(),
    customerId: int().notNull().references(() => users.id),
    startsAt: ts().notNull(),
    localDate: date({ mode: 'string' }).notNull(),
    localTime: time().notNull(),
    status: appointmentStatusEnum().notNull().default('held'),
    holdExpiresAt: ts(),
    // Fee snapshot taken at booking time — later fee changes never affect this appointment.
    amountDue: decimal({ precision: 12, scale: 2 }).notNull(),
    currency: currencyEnum().notNull(),
    feeType: feeTypeEnum().notNull(),
    paymentStatus: paymentStatusEnum().notNull(),
    paymentConfirmedById: int().references(() => users.id),
    paymentConfirmedAt: ts(),
    customerNote: text(),
    cancelReason: text(),
    cancelledById: int().references(() => users.id),
    cancelledAt: ts(),
    confirmedAt: ts(),
    checkedInAt: ts(),
    completedAt: ts(),
    noShowAt: ts(),
    expiredAt: ts(),
    reminderSentAt: ts(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    activeFlag: activeFlag(`status in ('held', 'confirmed', 'checked_in')`),
  },
  (t) => [
    lineRef('appointments_line_fk', t),
    // One active appointment per customer, per line, per day.
    uniqueIndex('appointments_one_active_per_day').on(t.customerId, t.lineId, t.localDate, t.activeFlag),
    index('appointments_branch_day_idx').on(t.branchId, t.localDate),
    index('appointments_status_hold_idx').on(t.status, t.holdExpiresAt),
    index('appointments_customer_idx').on(t.customerId),
  ],
);

/** Append-only history of what happened to an appointment and who did it. */
export const appointmentEvents = mysqlTable(
  'appointment_events',
  {
    id: id(),
    appointmentId: int().notNull().references(() => appointments.id, { onDelete: 'cascade' }),
    type: varchar({ length: 40 }).notNull(),
    actorUserId: int().references(() => users.id),
    data: json(),
    createdAt: createdAt(),
  },
  (t) => [index('appointment_events_appointment_idx').on(t.appointmentId)],
);

/** "I transferred the money" submissions, reviewed manually by the platform admin. */
export const paymentSubmissions = mysqlTable(
  'payment_submissions',
  {
    id: id(),
    appointmentId: int().notNull().references(() => appointments.id),
    customerId: int().notNull().references(() => users.id),
    transactionRef: varchar({ length: 80 }).notNull(),
    proofPath: varchar({ length: 255 }),
    proofMime: varchar({ length: 60 }),
    proofSize: int(),
    status: submissionStatusEnum().notNull().default('pending'),
    reviewedById: int().references(() => users.id),
    reviewedAt: ts(),
    reviewNote: text(),
    createdAt: createdAt(),
    pendingFlag: activeFlag(`status = 'pending'`),
  },
  (t) => [
    uniqueIndex('payment_submissions_one_pending').on(t.appointmentId, t.pendingFlag),
    index('payment_submissions_status_idx').on(t.status, t.createdAt),
  ],
);

// ─── Tickets (defined after appointments because they reference them) ───────

export const queueTickets = mysqlTable(
  'queue_tickets',
  {
    id: id(),
    businessId: int().notNull(),
    branchId: int().notNull(),
    lineId: int().notNull(),
    serviceDate: date({ mode: 'string' }).notNull(),
    number: int().notNull(),
    displayCode: varchar({ length: 12 }).notNull(),
    source: ticketSourceEnum().notNull(),
    appointmentId: int().references(() => appointments.id),
    customerId: int().references(() => users.id),
    guestName: varchar({ length: 120 }),
    phone: varchar({ length: 20 }),
    priorityGroup: priorityGroupEnum().notNull(),
    sortAt: ts().notNull(), // ordering key inside its priority group
    status: ticketStatusEnum().notNull().default('waiting'),
    joinedAt: createdAt(),
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
    estimateLowMin: int(),
    estimateHighMin: int(),
    estimateMethod: varchar({ length: 12 }),
    actualWaitSeconds: int(),
    createdById: int().references(() => users.id),
    updatedAt: updatedAt(),
    activeFlag: activeFlag(`status in ('waiting', 'called')`),
  },
  (t) => [
    lineRef('tickets_line_fk', t),
    unique('tickets_line_day_number_uq').on(t.lineId, t.serviceDate, t.number),
    // Never two active tickets for the same appointment or the same customer in one line.
    // (Rows with a NULL appointment/customer are ignored by these unique indexes.)
    uniqueIndex('tickets_one_active_per_appointment').on(t.appointmentId, t.activeFlag),
    uniqueIndex('tickets_one_active_per_customer').on(t.lineId, t.customerId, t.activeFlag),
    index('tickets_line_status_idx').on(t.lineId, t.status),
    index('tickets_line_day_idx').on(t.lineId, t.serviceDate),
    index('tickets_customer_idx').on(t.customerId),
  ],
);

// ─── Notes & reviews ────────────────────────────────────────────────────────

/**
 * kind = customer → written by the customer (visible to customer + staff)
 *        internal → staff only (never sent to customer pages)
 *        shared   → written by staff, visible to the customer
 */
export const notes = mysqlTable(
  'notes',
  {
    id: id(),
    businessId: int().notNull().references(() => businesses.id),
    branchId: int().notNull().references(() => branches.id),
    appointmentId: int().references(() => appointments.id),
    ticketId: int().references(() => queueTickets.id),
    authorId: int().notNull().references(() => users.id),
    kind: noteKindEnum().notNull(),
    body: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check('notes_one_target', sql`(${t.appointmentId} is not null) + (${t.ticketId} is not null) = 1`),
    index('notes_appointment_idx').on(t.appointmentId),
    index('notes_ticket_idx').on(t.ticketId),
  ],
);

export const reviews = mysqlTable(
  'reviews',
  {
    id: id(),
    appointmentId: int().notNull().unique().references(() => appointments.id),
    businessId: int().notNull().references(() => businesses.id),
    branchId: int().notNull().references(() => branches.id),
    lineId: int().notNull().references(() => lines.id),
    customerId: int().notNull().references(() => users.id),
    rating: smallint().notNull(),
    comment: text(),
    ownerReply: text(),
    repliedById: int().references(() => users.id),
    repliedAt: ts(),
    createdAt: createdAt(),
  },
  (t) => [check('reviews_rating_range', sql`${t.rating} between 1 and 5`), index('reviews_branch_idx').on(t.branchId)],
);

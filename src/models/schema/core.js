// Core tables: businesses, users, branches (+ hours/holidays), operator access,
// platform settings, sessions, OTP codes, the audit log and the background-job bookkeeping.
// Column names are camelCase here and snake_case in MySQL (drizzle `casing: 'snake_case'`).
import { sql } from 'drizzle-orm';
import {
  mysqlTable, int, text, varchar, boolean, decimal, date, time, smallint,
  index, unique, check, primaryKey,
} from 'drizzle-orm/mysql-core';
import { roleEnum, currencyEnum, feeTypeEnum } from './enums.js';
import { id, ts, createdAt, updatedAt, json } from './columns.js';

export const businesses = mysqlTable('businesses', {
  id: id(),
  name: varchar({ length: 160 }).notNull(),
  slug: varchar({ length: 80 }).notNull().unique(),
  phone: varchar({ length: 20 }),
  description: text(),
  isActive: boolean().notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const users = mysqlTable(
  'users',
  {
    id: id(),
    role: roleEnum().notNull(),
    name: varchar({ length: 120 }).notNull().default(''),
    phone: varchar({ length: 20 }).unique(),
    email: varchar({ length: 160 }).unique(),
    passwordHash: varchar({ length: 100 }),
    // Owners and operators belong to exactly one business; admins and customers to none.
    businessId: int().references(() => businesses.id),
    isActive: boolean().notNull().default(true),
    phoneVerifiedAt: ts(),
    lastLoginAt: ts(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      'users_business_matches_role',
      sql`(${t.role} in ('business_owner', 'branch_operator')) = (${t.businessId} is not null)`,
    ),
    index('users_business_idx').on(t.businessId),
  ],
);

// Exactly one row (id = 1): the platform's own Whish Money link and payment rules.
export const platformSettings = mysqlTable(
  'platform_settings',
  {
    id: int().primaryKey().default(1),
    whishPaymentUrl: text(),
    paymentInstructions: text(),
    defaultHoldMinutes: int().notNull().default(30),
    updatedById: int().references(() => users.id),
    updatedAt: updatedAt(),
  },
  (t) => [check('platform_settings_single_row', sql`${t.id} = 1`)],
);

export const branches = mysqlTable(
  'branches',
  {
    id: id(),
    businessId: int().notNull().references(() => businesses.id),
    name: varchar({ length: 160 }).notNull(),
    slug: varchar({ length: 100 }).notNull().unique(),
    city: varchar({ length: 80 }).notNull().default(''),
    address: text(),
    phone: varchar({ length: 20 }),
    timezone: varchar({ length: 64 }).notNull().default('Asia/Beirut'),
    // Appointment fee set by the business (paid to the platform, verified by the platform admin).
    feeAmount: decimal({ precision: 12, scale: 2 }).notNull().default('0'),
    currency: currencyEnum().notNull().default('USD'),
    feeType: feeTypeEnum().notNull().default('deposit'),
    holdMinutes: int(), // null = use the platform default
    minNoticeMinutes: int().notNull().default(60),
    bookingWindowDays: int().notNull().default(30),
    cancellationCutoffHours: int().notNull().default(24),
    allowReschedule: boolean().notNull().default(true),
    cancellationPolicyText: text(),
    displayToken: varchar({ length: 64 }).notNull().unique(),
    isActive: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // Lets child tables use a composite FK so a row can never point at another business's branch.
    unique('branches_id_business_uq').on(t.id, t.businessId),
    check('branches_fee_non_negative', sql`${t.feeAmount} >= 0`),
    index('branches_business_idx').on(t.businessId),
  ],
);

// Weekly opening hours (several rows per weekday allowed, e.g. for a lunch break).
// weekday follows ISO / Luxon: 1 = Monday … 7 = Sunday.
export const branchHours = mysqlTable(
  'branch_hours',
  {
    id: id(),
    branchId: int().notNull().references(() => branches.id, { onDelete: 'cascade' }),
    weekday: smallint().notNull(),
    openTime: time().notNull(),
    closeTime: time().notNull(),
  },
  (t) => [
    check('branch_hours_weekday', sql`${t.weekday} between 1 and 7`),
    check('branch_hours_order', sql`${t.closeTime} > ${t.openTime}`),
    index('branch_hours_branch_idx').on(t.branchId),
  ],
);

export const branchHolidays = mysqlTable(
  'branch_holidays',
  {
    id: id(),
    branchId: int().notNull().references(() => branches.id, { onDelete: 'cascade' }),
    date: date({ mode: 'string' }).notNull(),
    reason: varchar({ length: 200 }),
  },
  (t) => [unique('branch_holidays_branch_date_uq').on(t.branchId, t.date)],
);

// Which branches an operator may manage.
export const operatorBranches = mysqlTable(
  'operator_branches',
  {
    userId: int().notNull().references(() => users.id, { onDelete: 'cascade' }),
    branchId: int().notNull().references(() => branches.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.branchId] })],
);

// Login sessions (see config/sessionStore.js).
export const sessions = mysqlTable(
  'sessions',
  {
    sid: varchar({ length: 128 }).primaryKey(),
    sess: json().notNull(),
    expire: ts().notNull(),
  },
  (t) => [index('sessions_expire_idx').on(t.expire)],
);

export const otpCodes = mysqlTable(
  'otp_codes',
  {
    id: id(),
    phone: varchar({ length: 20 }).notNull(),
    codeHash: varchar({ length: 128 }).notNull(),
    expiresAt: ts().notNull(),
    attempts: smallint().notNull().default(0),
    consumedAt: ts(),
    ip: varchar({ length: 64 }),
    createdAt: createdAt(),
  },
  (t) => [index('otp_codes_phone_idx').on(t.phone, t.createdAt)],
);

export const auditLogs = mysqlTable(
  'audit_logs',
  {
    id: id(),
    actorUserId: int().references(() => users.id, { onDelete: 'set null' }),
    businessId: int().references(() => businesses.id, { onDelete: 'set null' }),
    action: varchar({ length: 80 }).notNull(),
    entityType: varchar({ length: 40 }).notNull(),
    entityId: int(),
    before: json(),
    after: json(),
    ip: varchar({ length: 64 }),
    createdAt: createdAt(),
  },
  (t) => [index('audit_logs_business_idx').on(t.businessId, t.createdAt), index('audit_logs_created_idx').on(t.createdAt)],
);

// Background jobs: one row per recurring task, used so that only one process runs it at a time.
export const jobRuns = mysqlTable('job_runs', {
  name: varchar({ length: 40 }).primaryKey(),
  lockedUntil: ts(),
  lastStartedAt: ts(),
  lastFinishedAt: ts(),
  lastError: text(),
});

// One row per line. Queue actions lock this row (SELECT … FOR UPDATE) for the whole transaction,
// so two operators pressing "call next" together are handled one after the other.
// It is a separate table so the lock never blocks foreign-key checks on `lines`.
export const lineLocks = mysqlTable('line_locks', {
  lineId: int().primaryKey(),
});

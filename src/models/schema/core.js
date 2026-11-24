// Core tables: businesses, users, branches (+ hours/holidays), operator access,
// platform settings, sessions, OTP codes and the audit log.
// Column names are camelCase here and snake_case in PostgreSQL (drizzle `casing: 'snake_case'`).
import { sql } from 'drizzle-orm';
import {
  pgTable, integer, text, varchar, boolean, timestamp, numeric, date, time, jsonb, json,
  smallint, index, unique, check, primaryKey,
} from 'drizzle-orm/pg-core';
import { roleEnum, currencyEnum, feeTypeEnum } from './enums.js';
import { id, ts, createdAt, updatedAt } from './columns.js';

export const businesses = pgTable('businesses', {
  id: id(),
  name: text().notNull(),
  slug: varchar({ length: 80 }).notNull().unique(),
  phone: varchar({ length: 20 }),
  description: text(),
  isActive: boolean().notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const users = pgTable(
  'users',
  {
    id: id(),
    role: roleEnum().notNull(),
    name: text().notNull().default(''),
    phone: varchar({ length: 20 }).unique(),
    email: varchar({ length: 160 }).unique(),
    passwordHash: text(),
    // Owners and operators belong to exactly one business; admins and customers to none.
    businessId: integer().references(() => businesses.id),
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
    index().on(t.businessId),
  ],
);

// Exactly one row (id = 1): the platform's own Whish Money link and payment rules.
export const platformSettings = pgTable(
  'platform_settings',
  {
    id: integer().primaryKey().default(1),
    whishPaymentUrl: text(),
    paymentInstructions: text(),
    defaultHoldMinutes: integer().notNull().default(30),
    updatedById: integer().references(() => users.id),
    updatedAt: updatedAt(),
  },
  (t) => [check('platform_settings_single_row', sql`${t.id} = 1`)],
);

export const branches = pgTable(
  'branches',
  {
    id: id(),
    businessId: integer().notNull().references(() => businesses.id),
    name: text().notNull(),
    slug: varchar({ length: 100 }).notNull().unique(),
    city: text().notNull().default(''),
    address: text(),
    phone: varchar({ length: 20 }),
    timezone: varchar({ length: 64 }).notNull().default('Asia/Beirut'),
    // Appointment fee set by the business (paid to the platform, verified by the platform admin).
    feeAmount: numeric({ precision: 12, scale: 2 }).notNull().default('0'),
    currency: currencyEnum().notNull().default('USD'),
    feeType: feeTypeEnum().notNull().default('deposit'),
    holdMinutes: integer(), // null = use the platform default
    minNoticeMinutes: integer().notNull().default(60),
    bookingWindowDays: integer().notNull().default(30),
    cancellationCutoffHours: integer().notNull().default(24),
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
    index().on(t.businessId),
  ],
);

// Weekly opening hours (several rows per weekday allowed, e.g. for a lunch break).
// weekday follows ISO / Luxon: 1 = Monday … 7 = Sunday.
export const branchHours = pgTable(
  'branch_hours',
  {
    id: id(),
    branchId: integer().notNull().references(() => branches.id, { onDelete: 'cascade' }),
    weekday: smallint().notNull(),
    openTime: time().notNull(),
    closeTime: time().notNull(),
  },
  (t) => [
    check('branch_hours_weekday', sql`${t.weekday} between 1 and 7`),
    check('branch_hours_order', sql`${t.closeTime} > ${t.openTime}`),
    index().on(t.branchId),
  ],
);

export const branchHolidays = pgTable(
  'branch_holidays',
  {
    id: id(),
    branchId: integer().notNull().references(() => branches.id, { onDelete: 'cascade' }),
    date: date().notNull(),
    reason: text(),
  },
  (t) => [unique('branch_holidays_branch_date_uq').on(t.branchId, t.date)],
);

// Which branches an operator may manage.
export const operatorBranches = pgTable(
  'operator_branches',
  {
    userId: integer().notNull().references(() => users.id, { onDelete: 'cascade' }),
    branchId: integer().notNull().references(() => branches.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.branchId] })],
);

// Session store used by connect-pg-simple (column names are fixed by that library).
export const sessions = pgTable(
  'session',
  {
    sid: varchar().primaryKey(),
    sess: json().notNull(),
    expire: timestamp({ precision: 6 }).notNull(),
  },
  (t) => [index('IDX_session_expire').on(t.expire)],
);

export const otpCodes = pgTable(
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
  (t) => [index().on(t.phone, t.createdAt)],
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: id(),
    actorUserId: integer().references(() => users.id, { onDelete: 'set null' }),
    businessId: integer().references(() => businesses.id, { onDelete: 'set null' }),
    action: varchar({ length: 80 }).notNull(),
    entityType: varchar({ length: 40 }).notNull(),
    entityId: integer(),
    before: jsonb(),
    after: jsonb(),
    ip: varchar({ length: 64 }),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.businessId, t.createdAt), index().on(t.createdAt)],
);

// Notification outbox (SMS + push) and the customers' Firebase push tokens.
import { pgTable, integer, text, varchar, smallint, index } from 'drizzle-orm/pg-core';
import { id, ts, createdAt } from './columns.js';
import { users } from './core.js';
import { appointments, queueTickets } from './operations.js';
import { notificationChannelEnum, notificationKindEnum, notificationStatusEnum } from './enums.js';

export const pushTokens = pgTable(
  'push_tokens',
  {
    id: id(),
    userId: integer().notNull().references(() => users.id, { onDelete: 'cascade' }),
    token: text().notNull().unique(),
    userAgent: text(),
    createdAt: createdAt(),
    lastSeenAt: ts().notNull().defaultNow(),
    revokedAt: ts(),
  },
  (t) => [index().on(t.userId)],
);

/**
 * One row per message. Rows are written inside the business transaction ("outbox"),
 * then a pg-boss job sends them with retries and records the delivery status.
 */
export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    channel: notificationChannelEnum().notNull(),
    kind: notificationKindEnum().notNull(),
    userId: integer().references(() => users.id, { onDelete: 'set null' }),
    toPhone: varchar({ length: 20 }),
    title: text(),
    body: text().notNull(), // what admins see in logs (OTP codes are redacted here)
    secretBody: text(), // real OTP text; cleared as soon as it is sent
    link: text(),
    fallbackPhone: varchar({ length: 20 }), // push → SMS fallback target
    status: notificationStatusEnum().notNull().default('queued'),
    attempts: smallint().notNull().default(0),
    provider: varchar({ length: 20 }),
    providerMessageId: varchar({ length: 120 }),
    lastError: text(),
    appointmentId: integer().references(() => appointments.id, { onDelete: 'set null' }),
    ticketId: integer().references(() => queueTickets.id, { onDelete: 'set null' }),
    enqueuedAt: ts(),
    sentAt: ts(),
    deliveredAt: ts(),
    failedAt: ts(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.status, t.createdAt), index().on(t.ticketId), index().on(t.appointmentId), index().on(t.createdAt)],
);

// Notification outbox (SMS + push) and the customers' Firebase push tokens.
import { mysqlTable, int, text, varchar, smallint, index } from 'drizzle-orm/mysql-core';
import { id, ts, createdAt } from './columns.js';
import { users } from './core.js';
import { appointments, queueTickets } from './operations.js';
import { notificationChannelEnum, notificationKindEnum, notificationStatusEnum } from './enums.js';

export const pushTokens = mysqlTable(
  'push_tokens',
  {
    id: id(),
    userId: int().notNull().references(() => users.id, { onDelete: 'cascade' }),
    token: varchar({ length: 400 }).notNull().unique(),
    userAgent: varchar({ length: 300 }),
    createdAt: createdAt(),
    lastSeenAt: createdAt(),
    revokedAt: ts(),
  },
  (t) => [index('push_tokens_user_idx').on(t.userId)],
);

/**
 * One row per message. Rows are written inside the business transaction ("outbox"),
 * then sent right after commit; failures are retried by the job sweep at `nextAttemptAt`.
 */
export const notifications = mysqlTable(
  'notifications',
  {
    id: id(),
    channel: notificationChannelEnum().notNull(),
    kind: notificationKindEnum().notNull(),
    userId: int().references(() => users.id, { onDelete: 'set null' }),
    toPhone: varchar({ length: 20 }),
    title: varchar({ length: 200 }),
    body: text().notNull(), // what admins see in logs (OTP codes are redacted here)
    secretBody: text(), // real OTP text; cleared as soon as it is sent
    link: varchar({ length: 500 }),
    fallbackPhone: varchar({ length: 20 }), // push → SMS fallback target
    status: notificationStatusEnum().notNull().default('queued'),
    attempts: smallint().notNull().default(0),
    nextAttemptAt: ts(), // when a failed send may be retried (null = now)
    provider: varchar({ length: 20 }),
    providerMessageId: varchar({ length: 120 }),
    lastError: text(),
    appointmentId: int().references(() => appointments.id, { onDelete: 'set null' }),
    ticketId: int().references(() => queueTickets.id, { onDelete: 'set null' }),
    sentAt: ts(),
    deliveredAt: ts(),
    failedAt: ts(),
    createdAt: createdAt(),
  },
  (t) => [
    index('notifications_status_idx').on(t.status, t.nextAttemptAt),
    index('notifications_ticket_idx').on(t.ticketId),
    index('notifications_appointment_idx').on(t.appointmentId),
    index('notifications_created_idx').on(t.createdAt),
    index('notifications_provider_msg_idx').on(t.providerMessageId),
  ],
);

// PostgreSQL enum types, built from the shared value lists in config/constants.js.
import { pgEnum } from 'drizzle-orm/pg-core';
import * as C from '../../config/constants.js';

export const roleEnum = pgEnum('user_role', C.ROLES);
export const currencyEnum = pgEnum('currency', C.CURRENCIES);
export const feeTypeEnum = pgEnum('fee_type', C.FEE_TYPES);
export const queuePolicyEnum = pgEnum('queue_policy', C.QUEUE_POLICIES);
export const ticketSourceEnum = pgEnum('ticket_source', C.TICKET_SOURCES);
export const priorityGroupEnum = pgEnum('priority_group', C.PRIORITY_GROUPS);
export const ticketStatusEnum = pgEnum('ticket_status', C.TICKET_STATUSES);
export const appointmentStatusEnum = pgEnum('appointment_status', C.APPOINTMENT_STATUSES);
export const paymentStatusEnum = pgEnum('payment_status', C.PAYMENT_STATUSES);
export const submissionStatusEnum = pgEnum('submission_status', C.SUBMISSION_STATUSES);
export const noteKindEnum = pgEnum('note_kind', C.NOTE_KINDS);
export const notificationChannelEnum = pgEnum('notification_channel', C.NOTIFICATION_CHANNELS);
export const notificationKindEnum = pgEnum('notification_kind', C.NOTIFICATION_KINDS);
export const notificationStatusEnum = pgEnum('notification_status', C.NOTIFICATION_STATUSES);

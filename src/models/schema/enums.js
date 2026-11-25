// MySQL ENUM column builders, built from the shared value lists in config/constants.js.
// (MySQL enums belong to a column, so each export is a function that makes a new column.)
import { mysqlEnum } from 'drizzle-orm/mysql-core';
import * as C from '../../config/constants.js';

export const roleEnum = () => mysqlEnum(C.ROLES);
export const currencyEnum = () => mysqlEnum(C.CURRENCIES);
export const feeTypeEnum = () => mysqlEnum(C.FEE_TYPES);
export const queuePolicyEnum = () => mysqlEnum(C.QUEUE_POLICIES);
export const ticketSourceEnum = () => mysqlEnum(C.TICKET_SOURCES);
export const priorityGroupEnum = () => mysqlEnum(C.PRIORITY_GROUPS);
export const ticketStatusEnum = () => mysqlEnum(C.TICKET_STATUSES);
export const appointmentStatusEnum = () => mysqlEnum(C.APPOINTMENT_STATUSES);
export const paymentStatusEnum = () => mysqlEnum(C.PAYMENT_STATUSES);
export const submissionStatusEnum = () => mysqlEnum(C.SUBMISSION_STATUSES);
export const noteKindEnum = () => mysqlEnum(C.NOTE_KINDS);
export const notificationChannelEnum = () => mysqlEnum(C.NOTIFICATION_CHANNELS);
export const notificationKindEnum = () => mysqlEnum(C.NOTIFICATION_KINDS);
export const notificationStatusEnum = () => mysqlEnum(C.NOTIFICATION_STATUSES);

// Column helpers shared by all schema files (not exported from schema/index.js).
import { integer, timestamp } from 'drizzle-orm/pg-core';

export const id = () => integer().primaryKey().generatedAlwaysAsIdentity();
export const ts = () => timestamp({ withTimezone: true });
export const createdAt = () => ts().notNull().defaultNow();
export const updatedAt = () => ts().notNull().defaultNow().$onUpdate(() => new Date());

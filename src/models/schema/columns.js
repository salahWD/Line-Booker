// Column helpers shared by all schema files (not exported from schema/index.js).
import { sql } from 'drizzle-orm';
import { int, datetime, customType } from 'drizzle-orm/mysql-core';

export const id = () => int().primaryKey().autoincrement();

// All timestamps are stored as UTC DATETIME(3) (every connection runs with time_zone '+00:00').
export const ts = () => datetime({ mode: 'date', fsp: 3 });
export const createdAt = () => ts().notNull().default(sql`CURRENT_TIMESTAMP(3)`);
export const updatedAt = () => ts().notNull().default(sql`CURRENT_TIMESTAMP(3)`).$onUpdate(() => new Date());

// JSON column that also works on MariaDB, where JSON is stored as text and comes back as a string.
export const json = customType({
  dataType: () => 'json',
  toDriver: (value) => JSON.stringify(value),
  fromDriver: (value) => (typeof value === 'string' ? JSON.parse(value) : value),
});

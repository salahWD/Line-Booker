// DEVELOPMENT ONLY: drops every table (app, pg-boss and migration history) so that
// `npm run db:reset` can rebuild the database from migrations + seed data.
import { env } from '../src/config/env.js';
import { pool } from '../src/config/db.js';

if (env.isProduction) {
  console.error('Refusing to reset a production database.');
  process.exit(1);
}

await pool.query(`
  drop schema if exists public cascade;
  drop schema if exists pgboss cascade;
  drop schema if exists drizzle cascade;
  create schema public;
`);
console.log('🧹 Database emptied.');
await pool.end();

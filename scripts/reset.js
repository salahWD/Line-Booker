// DEVELOPMENT ONLY: drops every table in the database (including the migration history)
// so that `npm run db:reset` can rebuild it from migrations + seed data.
import { env } from '../src/config/env.js';
import { pool } from '../src/config/db.js';

if (env.isProduction) {
  console.error('Refusing to reset a production database.');
  process.exit(1);
}

const [tables] = await pool.query(
  "select table_name as name from information_schema.tables where table_schema = database() and table_type = 'BASE TABLE'",
);
const conn = await pool.getConnection();
try {
  await conn.query('set foreign_key_checks = 0');
  for (const { name } of tables) await conn.query(`drop table if exists \`${name}\``);
  await conn.query('set foreign_key_checks = 1');
} finally {
  conn.release();
}
console.log(`🧹 Database emptied (${tables.length} tables dropped).`);
await pool.end();

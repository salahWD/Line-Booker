// Development only: runs a real PostgreSQL server from node_modules (no install needed).
// Data lives in ./.pgdata. Keep this terminal open; press Ctrl+C to stop the database.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';

const port = Number(process.env.EMBEDDED_PG_PORT || 5433);
const password = process.env.EMBEDDED_PG_PASSWORD || 'postgres';
const databaseDir = path.resolve('.pgdata');
const dbName = new URL(process.env.DATABASE_URL || 'postgres://x@localhost/booking').pathname.slice(1) || 'booking';

const pg = new EmbeddedPostgres({
  databaseDir,
  user: 'postgres',
  password,
  port,
  persistent: true,
  // Always UTF-8 (Arabic text). Without this, Windows would create a WIN1252 database.
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
  onLog: () => {}, // keep the terminal quiet; errors are still thrown
});

const firstRun = !fs.existsSync(path.join(databaseDir, 'PG_VERSION'));
if (firstRun) {
  console.log('Initialising a new PostgreSQL data directory in .pgdata …');
  await pg.initialise();
}

await pg.start();

try {
  await pg.createDatabase(dbName);
  console.log(`Created database "${dbName}".`);
} catch {
  // Already exists — fine.
}

console.log(`✅ PostgreSQL is running on port ${port} (database "${dbName}"). Press Ctrl+C to stop.`);

const shutdown = async () => {
  console.log('\nStopping PostgreSQL …');
  await pg.stop();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

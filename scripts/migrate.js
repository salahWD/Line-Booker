// Applies pending SQL migrations: `npm run db:migrate`.
import { pool } from '../src/config/db.js';
import { runMigrations } from '../src/config/migrate.js';

await runMigrations();
console.log('✅ Migrations applied.');
await pool.end();

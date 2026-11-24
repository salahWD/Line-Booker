import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

// drizzle-kit reads the table definitions and writes SQL migrations to database/migrations.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/models/schema/index.js',
  out: './database/migrations',
  casing: 'snake_case',
  dbCredentials: { url: process.env.DATABASE_URL },
});

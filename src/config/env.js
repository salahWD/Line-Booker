// Loads .env and validates every setting once at startup, so the rest of the code
// can import `env` and trust its types. A bad or missing value stops the app early.
import 'dotenv/config';
import { z } from 'zod';

const bool = z
  .union([z.boolean(), z.string()])
  .transform((v) => v === true || v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  APP_NAME: z.string().default('دوري'),
  APP_URL: z.string().url().default('http://localhost:3000'),
  TRUST_PROXY: z.coerce.number().int().default(0),

  // mysql://user:password@host:3306/database
  DATABASE_URL: z.string().startsWith('mysql://', 'DATABASE_URL must start with mysql://'),
  DB_POOL_SIZE: z.coerce.number().int().min(1).default(10),
  // Apply pending database migrations when the server starts (handy on hosts without SSH).
  RUN_MIGRATIONS: bool.default(false),

  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  OTP_SECRET: z.string().min(32, 'OTP_SECRET must be at least 32 characters'),

  RUN_JOBS: bool.default(true),
  // Secret for GET /internal/tick?key=… so a hosting cron job can run the background jobs.
  CRON_SECRET: z.string().default(''),
  REMINDER_HOURS_BEFORE: z.coerce.number().min(0).default(3),

  DEFAULT_TIMEZONE: z.string().default('Asia/Beirut'),
  DEFAULT_PHONE_COUNTRY: z.string().length(2).default('LB'),

  OTP_TTL_SECONDS: z.coerce.number().int().min(60).default(300),
  OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().min(10).default(60),
  OTP_MAX_PER_HOUR: z.coerce.number().int().min(1).default(5),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(5),

  SMS_PROVIDER: z.enum(['mock', 'twilio']).default('mock'),
  TWILIO_ACCOUNT_SID: z.string().optional().default(''),
  TWILIO_AUTH_TOKEN: z.string().optional().default(''),
  TWILIO_FROM: z.string().optional().default(''),
  SMS_WEBHOOK_SECRET: z.string().default('change-me'),

  FIREBASE_PROJECT_ID: z.string().optional().default(''),
  FIREBASE_CLIENT_EMAIL: z.string().optional().default(''),
  FIREBASE_PRIVATE_KEY: z.string().optional().default(''),
  FIREBASE_WEB_API_KEY: z.string().optional().default(''),
  FIREBASE_WEB_AUTH_DOMAIN: z.string().optional().default(''),
  FIREBASE_WEB_MESSAGING_SENDER_ID: z.string().optional().default(''),
  FIREBASE_WEB_APP_ID: z.string().optional().default(''),
  FIREBASE_WEB_VAPID_KEY: z.string().optional().default(''),
  FIREBASE_WEB_SDK_VERSION: z.string().default('10.14.1'),

  UPLOAD_DIR: z.string().default('uploads'),
  MAX_UPLOAD_MB: z.coerce.number().min(1).max(20).default(5),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('❌ Invalid environment configuration:');
  for (const issue of parsed.error.issues) console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  console.error('Copy .env.example to .env and fill in the values.');
  process.exit(1);
}

export const env = {
  ...parsed.data,
  isProduction: parsed.data.NODE_ENV === 'production',
  // Real FCM is used only when the server credentials are present; otherwise the dev mock.
  pushProvider: parsed.data.FIREBASE_PROJECT_ID ? 'fcm' : 'mock',
};

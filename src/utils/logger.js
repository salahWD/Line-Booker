// Minimal console logger with timestamps. Swap for pino/winston later if needed.
const ts = () => new Date().toISOString();

export const logger = {
  info: (msg, meta) => console.log(`[${ts()}] INFO  ${msg}`, meta ?? ''),
  warn: (msg, meta) => console.warn(`[${ts()}] WARN  ${msg}`, meta ?? ''),
  error: (msg, err) => console.error(`[${ts()}] ERROR ${msg}`, err?.stack ?? err ?? ''),
};

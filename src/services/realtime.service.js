// Live updates with Server-Sent Events.
//
// Flow:  queue action (in a DB transaction) ──pg_notify──▶ PostgreSQL
//        PostgreSQL ──LISTEN──▶ every web process ──SSE "change" event──▶ browsers
//        browser ──fetch──▶ its own permission-checked JSON state
//
// pg_notify inside the transaction is delivered only when the transaction commits, so
// screens never see half-finished changes. Events carry no personal data: each screen
// re-fetches whatever it is allowed to see.
import pg from 'pg';
import { sql } from 'drizzle-orm';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

const CHANNEL = 'realtime';
const HEARTBEAT_MS = 20_000;

/** channel name → Set of SSE responses. Channels: "line:12", "branch:3". */
const subscribers = new Map();
let listener = null;

/** Call inside a transaction after changing a line's queue. */
export async function notifyLineChange(tx, { lineId, branchId, type }) {
  const payload = JSON.stringify({ lineId, branchId, type, at: Date.now() });
  await tx.execute(sql`select pg_notify(${CHANNEL}, ${payload})`);
}

function broadcast(payload) {
  const message = `event: change\ndata: ${JSON.stringify({ type: payload.type, at: payload.at })}\n\n`;
  for (const channel of [`line:${payload.lineId}`, `branch:${payload.branchId}`]) {
    for (const res of subscribers.get(channel) ?? []) res.write(message);
  }
}

/** Starts the LISTEN connection (reconnects automatically if the database restarts). */
export async function startListener() {
  if (listener) return;
  const connect = async (attempt = 0) => {
    const client = new pg.Client({ connectionString: env.DATABASE_URL });
    client.on('notification', (msg) => {
      try {
        broadcast(JSON.parse(msg.payload));
      } catch (err) {
        logger.error('Bad realtime payload', err);
      }
    });
    client.on('error', (err) => {
      logger.warn(`Realtime listener lost: ${err.message}`);
      listener = null;
      client.end().catch(() => {});
      setTimeout(() => connect(attempt + 1), Math.min(30_000, 1000 * 2 ** attempt));
    });
    try {
      await client.connect();
      await client.query(`LISTEN ${CHANNEL}`);
      listener = client;
      if (attempt > 0) {
        // Tell every open screen to refresh — they may have missed events while we were down.
        broadcastAll({ type: 'resync', at: Date.now() });
      }
    } catch (err) {
      logger.warn(`Realtime listener could not connect: ${err.message}`);
      setTimeout(() => connect(attempt + 1), Math.min(30_000, 1000 * 2 ** attempt));
    }
  };
  await connect();
}

function broadcastAll(payload) {
  const message = `event: change\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const set of subscribers.values()) for (const res of set) res.write(message);
}

/**
 * Turns the response into an SSE stream subscribed to the given channels.
 * The browser's EventSource reconnects by itself; `retry` tells it to wait 3 s.
 */
export function subscribe(req, res, channels) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // disable proxy buffering (nginx)
  });
  res.write(`retry: 3000\nevent: ready\ndata: {}\n\n`);

  for (const channel of channels) {
    if (!subscribers.has(channel)) subscribers.set(channel, new Set());
    subscribers.get(channel).add(res);
  }

  // Named ping events let the browser detect a silently dead connection.
  const heartbeat = setInterval(() => res.write(`event: ping\ndata: ${Date.now()}\n\n`), HEARTBEAT_MS);

  req.on('close', () => {
    clearInterval(heartbeat);
    for (const channel of channels) {
      const set = subscribers.get(channel);
      set?.delete(res);
      if (set && set.size === 0) subscribers.delete(channel);
    }
  });
}

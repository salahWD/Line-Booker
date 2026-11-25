// Live updates with Server-Sent Events.
//
// Flow:  queue action (in a DB transaction) ──after commit──▶ broadcast in this process
//        ──SSE "change" event──▶ browsers ──fetch──▶ their own permission-checked JSON
//
// The event is sent only after the transaction commits, so screens never see half-finished
// changes. Events carry no personal data: each screen re-fetches what it is allowed to see.
//
// Note: this works inside one Node process (how shared hosting runs the app). With several
// processes, screens connected to another process still update through their 30-second
// polling fallback (see public/js/lib/live.js).

const HEARTBEAT_MS = 20_000;

/** channel name → Set of SSE responses. Channels: "line:12", "branch:3". */
const subscribers = new Map();

/** Call inside a transaction after changing a line's queue (sent when it commits). */
export async function notifyLineChange(tx, { lineId, branchId, type }) {
  const payload = { lineId, branchId, type, at: Date.now() };
  if (tx?.afterCommit) tx.afterCommit(() => broadcast(payload));
  else broadcast(payload);
}

function broadcast(payload) {
  const message = `event: change\ndata: ${JSON.stringify({ type: payload.type, at: payload.at })}\n\n`;
  for (const channel of [`line:${payload.lineId}`, `branch:${payload.branchId}`]) {
    for (const res of subscribers.get(channel) ?? []) res.write(message);
  }
}

/** Kept for symmetry with older setups; nothing to start without a database listener. */
export async function startListener() {}

/**
 * Turns the response into an SSE stream subscribed to the given channels.
 * The browser's EventSource reconnects by itself; `retry` tells it to wait 3 s.
 */
export function subscribe(req, res, channels) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // disable proxy buffering (nginx / LiteSpeed)
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

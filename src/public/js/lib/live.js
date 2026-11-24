// Live connection to the server (Server-Sent Events) with automatic recovery.
//
// connectLive(url, { onChange, onStatus }):
//   • onChange() is called on every server event AND after every (re)connection,
//     so the screen always re-fetches its state after a gap.
//   • onStatus(true|false) reports connected / disconnected (for the banner).
//   • If no event or heartbeat arrives for 45 s the connection is rebuilt.
//   • A slow 30 s poll keeps the screen fresh even if SSE is blocked by a proxy.

const HEARTBEAT_TIMEOUT_MS = 45_000;
const FALLBACK_POLL_MS = 30_000;

export function connectLive(url, { onChange, onStatus }) {
  let source = null;
  let watchdog = null;
  let retryDelay = 1000;
  let closed = false;

  const resetWatchdog = () => {
    clearTimeout(watchdog);
    watchdog = setTimeout(() => reconnect(), HEARTBEAT_TIMEOUT_MS);
  };

  function open() {
    source = new EventSource(url);
    source.addEventListener('ready', () => {
      retryDelay = 1000;
      onStatus(true);
      onChange('reconnect');
      resetWatchdog();
    });
    source.addEventListener('change', (event) => {
      resetWatchdog();
      let payload = {};
      try {
        payload = JSON.parse(event.data);
      } catch {
        /* ignore */
      }
      onChange(payload.type ?? 'change');
    });
    source.addEventListener('ping', resetWatchdog);
    source.onerror = () => {
      onStatus(false);
      // The browser retries by itself while readyState is CONNECTING; if it gave up, we retry.
      if (source.readyState === EventSource.CLOSED) reconnect();
    };
    resetWatchdog();
  }

  function reconnect() {
    if (closed) return;
    source?.close();
    onStatus(false);
    setTimeout(open, retryDelay);
    retryDelay = Math.min(retryDelay * 2, 30_000);
  }

  const poll = setInterval(() => onChange('poll'), FALLBACK_POLL_MS);
  // Coming back to the tab (phones suspend background pages): refresh immediately.
  const onVisible = () => {
    if (document.visibilityState === 'visible') onChange('visible');
  };
  document.addEventListener('visibilitychange', onVisible);

  open();

  return () => {
    closed = true;
    clearInterval(poll);
    clearTimeout(watchdog);
    document.removeEventListener('visibilitychange', onVisible);
    source?.close();
  };
}

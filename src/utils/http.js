// Request helpers.

/** True for fetch()/API calls that expect JSON instead of an HTML page. */
export function wantsJson(req) {
  return req.xhr || req.get('accept')?.includes('application/json') || req.is('application/json') === 'application/json';
}

/** Same-site "back" URL from the Referer header (never redirects to another site). */
export function backUrl(req, fallback = '/') {
  const referer = req.get('referer');
  if (!referer) return fallback;
  try {
    const url = new URL(referer);
    if (url.host !== req.get('host')) return fallback;
    return url.pathname + url.search;
  } catch {
    return fallback;
  }
}

/** Only allow local paths for ?next= redirects. */
export function safeNext(next, fallback = '/') {
  return typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') ? next : fallback;
}

export const clientIp = (req) => req.ip;

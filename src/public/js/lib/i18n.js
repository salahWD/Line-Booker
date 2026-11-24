// Arabic strings for browser scripts (embedded by the server in <script id="i18n" type="application/json">).
let strings = {};
try {
  strings = JSON.parse(document.getElementById('i18n')?.textContent || '{}');
} catch {
  strings = {};
}

/** t('range', { low: 5, high: 10 }) → "5–10 دقيقة" */
export function t(key, vars = {}) {
  const value = strings[key] ?? key;
  return value.replace(/\{(\w+)\}/g, (_, name) => (vars[name] ?? ''));
}

/** Reads JSON from a data-* attribute (the server escapes it). */
export function dataJson(el, name, fallback = null) {
  try {
    const raw = el.dataset[name];
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

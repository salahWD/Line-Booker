// Small display helpers for browser scripts.
import { t } from './i18n.js';

/** "10:45" in the visitor's local time (Western digits). */
export function clockTime(date = new Date()) {
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(date));
}

export function aheadText(ahead) {
  if (ahead === null || ahead === undefined) return '—';
  if (ahead === 0) return t('aheadNone');
  if (ahead === 1) return t('aheadOne');
  return t('aheadMany', { count: ahead });
}

export function rangeText(estimate) {
  if (!estimate) return '—';
  if (estimate.highMin < 1) return t('lessThanMinute');
  return t('range', { low: estimate.lowMin, high: estimate.highMin });
}

/** mm:ss countdown text. */
export function countdownText(ms) {
  if (ms <= 0) return '00:00';
  const total = Math.floor(ms / 1000);
  const minutes = String(Math.floor(total / 60)).padStart(2, '0');
  const seconds = String(total % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

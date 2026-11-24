// Small reusable components.
import { t, dataJson } from '../lib/i18n.js';
import { countdownText } from '../lib/format.js';

/**
 * Countdown. Either data-seconds="60" (counts down from N) or data-until="ISO date".
 * Exposes `remaining` (seconds) and `clock` (mm:ss). Reloads the page when it reaches 0
 * if data-until is used (e.g. an appointment hold expiring).
 */
export const countdown = () => ({
  remaining: 0,
  clock: '',
  init() {
    const { seconds, until } = this.$el.dataset;
    const end = until ? new Date(until).getTime() : Date.now() + Number(seconds || 0) * 1000;
    const tick = () => {
      const ms = end - Date.now();
      this.remaining = Math.max(0, Math.ceil(ms / 1000));
      this.clock = ms > 0 ? countdownText(ms) : t('expired');
      if (ms <= 0) {
        clearInterval(this.timer);
        if (until) setTimeout(() => location.reload(), 1500);
      }
    };
    tick();
    this.timer = setInterval(tick, 1000);
  },
  destroy() {
    clearInterval(this.timer);
  },
});

/** Copy-to-clipboard button (data-text). */
export const copyText = () => ({
  label: '',
  init() {
    this.label = this.$el.querySelector('button')?.textContent.trim() ?? '';
    this.original = this.label;
  },
  async copy() {
    try {
      await navigator.clipboard.writeText(this.$el.dataset.text);
      this.label = t('copied');
      setTimeout(() => (this.label = this.original), 2000);
    } catch {
      /* clipboard not available */
    }
  },
});

/** Weekly opening hours editor (rows posted as parallel arrays). */
export const hoursEditor = () => ({
  rows: [],
  init() {
    this.rows = dataJson(this.$el, 'rows', []);
  },
  add() {
    const last = this.rows[this.rows.length - 1];
    this.rows.push({ weekday: last ? (last.weekday % 7) + 1 : 1, openTime: last?.openTime ?? '09:00', closeTime: last?.closeTime ?? '17:00' });
  },
  remove(index) {
    this.rows.splice(index, 1);
  },
});

/** Development inbox: refresh every 4 s so new OTP codes appear without reloading by hand. */
export const devInbox = () => ({
  init() {
    this.timer = setInterval(() => location.reload(), 4000);
  },
  destroy() {
    clearInterval(this.timer);
  },
});

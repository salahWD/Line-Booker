// Public waiting-room screen: big "now serving" numbers, recent calls, optional chime.
// Shows only ticket codes and counters (the server never sends personal data here).
import { connectLive } from '../lib/live.js';
import { api } from '../lib/api.js';
import { chime, unlockAudio } from '../lib/alarm.js';
import { clockTime } from '../lib/format.js';

const FLASH_MS = 6000;

export default () => ({
  state: { lines: [], recentCalls: [] },
  disconnected: false,
  soundOn: false,
  clock: clockTime(),
  flash: { code: '', counter: '', line: '' },
  seenCalls: null, // "id-recalls" keys already announced

  init() {
    const el = this.$el;
    this.urls = { state: el.dataset.stateUrl, events: el.dataset.eventsUrl };
    const button = el.querySelector('[data-label-on]');
    this.labels = { on: button?.dataset.labelOn ?? '', off: button?.dataset.labelOff ?? '' };
    try {
      this.soundOn = localStorage.getItem('display-sound') === '1';
    } catch {
      /* ignore */
    }
    this.clockTimer = setInterval(() => (this.clock = clockTime()), 10_000);
    this.disconnect = connectLive(this.urls.events, {
      onChange: () => this.refresh(),
      onStatus: (connected) => (this.disconnected = !connected),
    });
  },

  destroy() {
    this.disconnect?.();
    clearInterval(this.clockTimer);
  },

  get soundLabel() {
    return this.soundOn ? this.labels.on : this.labels.off;
  },

  toggleSound() {
    this.soundOn = !this.soundOn;
    if (this.soundOn) {
      unlockAudio();
      chime();
    }
    try {
      localStorage.setItem('display-sound', this.soundOn ? '1' : '0');
    } catch {
      /* ignore */
    }
  },

  async refresh() {
    let next;
    try {
      next = await api(this.urls.state);
    } catch {
      return; // keep showing the last state; the banner tells staff the screen is offline
    }
    const keys = next.recentCalls.map((c) => `${c.id}-${c.recalls}`);
    // Announce calls we have not seen yet (not on the very first load).
    if (this.seenCalls) {
      const fresh = next.recentCalls.find((c) => !this.seenCalls.has(`${c.id}-${c.recalls}`));
      if (fresh) this.announce(fresh);
    }
    this.seenCalls = new Set(keys);
    this.state = next;
  },

  announce(call) {
    this.flash = { code: call.code, counter: call.counter ?? '', line: call.line ?? '' };
    if (this.soundOn) chime();
    const overlay = this.$el.querySelector('[data-flash-overlay]');
    if (window.gsap && overlay) {
      window.gsap.fromTo(overlay, { opacity: 0, scale: 0.96 }, { opacity: 1, scale: 1, duration: 0.35, ease: 'power2.out' });
    }
    clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => (this.flash = { code: '', counter: '', line: '' }), FLASH_MS);
  },
});

// Branch page: keeps each line's waiting count and estimate up to date.
import { connectLive } from '../lib/live.js';
import { api } from '../lib/api.js';
import { dataJson } from '../lib/i18n.js';

export default () => ({
  lines: {},
  disconnected: false,

  init() {
    const el = this.$el;
    this.urls = { state: el.dataset.stateUrl, events: el.dataset.eventsUrl };
    this.store(dataJson(el, 'initial', [])); // server-rendered summaries
    this.disconnect = connectLive(this.urls.events, {
      onChange: () => this.refresh(),
      onStatus: (connected) => (this.disconnected = !connected),
    });
  },

  destroy() {
    this.disconnect?.();
  },

  store(list) {
    const next = {};
    for (const line of list) next[line.id] = line;
    this.lines = next;
  },

  async refresh() {
    try {
      this.store((await api(this.urls.state)).lines);
    } catch {
      /* keep the last values; the banner shows the connection problem */
    }
  },

  /** Values shown on one line card. */
  lineState(id) {
    const line = this.lines[id];
    if (!line) return { waiting: '—', range: '—', pace: '—', closed: false, paused: false };
    return {
      waiting: line.waiting,
      range: `${line.estimate.lowMin}–${line.estimate.highMin}`,
      pace: line.estimate.paceMinutes,
      closed: !line.isOpen,
      paused: line.paused,
    };
  },
});

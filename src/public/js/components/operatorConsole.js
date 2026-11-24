// Operator console for one line: live list + actions (call, recall, complete, skip…).
// Every action is a POST; the realtime event that follows refreshes all open consoles.
import { connectLive } from '../lib/live.js';
import { api, post } from '../lib/api.js';
import { dataJson } from '../lib/i18n.js';

const EMPTY = {
  line: {},
  waiting: [],
  called: [],
  skipped: [],
  appointments: [],
  stats: { served: 0, waiting: 0, avgWaitMin: null },
  estimateForNew: { lowMin: 0, highMin: 0 },
};

export default () => ({
  state: EMPTY,
  loaded: false,
  loadError: '',
  busy: false,
  message: '',
  messageError: false,
  disconnected: false,
  counterLabel: '',
  walkIn: { guestName: '', phone: '' },

  init() {
    const el = this.$el;
    this.lineId = el.dataset.lineId;
    this.urls = { state: el.dataset.stateUrl, events: el.dataset.eventsUrl };
    this.labels = dataJson(el, 'labels', {});
    try {
      this.counterLabel = localStorage.getItem(`counter-${this.lineId}`) ?? '';
    } catch {
      /* storage blocked — the label just isn't remembered */
    }
    this.disconnect = connectLive(this.urls.events, {
      onChange: () => this.refresh(),
      onStatus: (connected) => (this.disconnected = !connected),
    });
  },

  destroy() {
    this.disconnect?.();
  },

  async refresh() {
    try {
      this.state = await api(this.urls.state);
      this.loaded = true;
      this.loadError = '';
    } catch (err) {
      if (!this.loaded) this.loadError = err.message;
    }
  },

  saveCounter() {
    try {
      localStorage.setItem(`counter-${this.lineId}`, this.counterLabel);
    } catch {
      /* ignore */
    }
  },

  flash(text, isError = false) {
    this.message = text;
    this.messageError = isError;
    clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => (this.message = ''), 5000);
  },

  /** Runs an action, shows its error if any, then refreshes. */
  async run(url, body) {
    if (this.busy) return null;
    this.busy = true;
    try {
      const result = await post(url, body);
      if (result.message) this.flash(result.message);
      return result;
    } catch (err) {
      this.flash(err.message, true);
      return null;
    } finally {
      this.busy = false;
      this.refresh();
    }
  },

  callNext() {
    return this.run(`/operator/lines/${this.lineId}/call-next`, { counterLabel: this.counterLabel });
  },

  act(action, ticketId) {
    return this.run(`/operator/tickets/${ticketId}/${action}`, { counterLabel: this.counterLabel });
  },

  cancelTicket(ticketId) {
    if (window.confirm(this.labels.confirmCancel)) this.act('cancel', ticketId);
  },

  lineAction(action) {
    return this.run(`/operator/lines/${this.lineId}/${action}`, {});
  },

  async addWalkIn() {
    const result = await this.run(`/operator/lines/${this.lineId}/walk-in`, { ...this.walkIn });
    if (result) this.walkIn = { guestName: '', phone: '' };
  },

  sourceLabel(ticket) {
    return ticket.priorityGroup === 'appointment' ? this.labels.appointment : this.labels.walk_in;
  },

  appointmentStatus(status) {
    return this.labels.statuses?.[status] ?? status;
  },
});

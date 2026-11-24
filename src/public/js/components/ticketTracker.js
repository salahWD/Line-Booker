// Customer's live ticket page (/t/:token).
// Keeps the position and estimate fresh, rings + vibrates when the ticket is called,
// lets the customer choose the alert lead time and enable push notifications.
import { connectLive } from '../lib/live.js';
import { api, post } from '../lib/api.js';
import { t, dataJson } from '../lib/i18n.js';
import { aheadText, rangeText, clockTime } from '../lib/format.js';
import { startAlarm, unlockAudio } from '../lib/alarm.js';
import { enablePush, registerServiceWorker, showLocalNotification } from '../lib/push.js';

const STATUS_CLASSES = {
  waiting: 'badge-blue',
  called: 'badge-amber',
  completed: 'badge-green',
  skipped: 'badge-red',
  cancelled: 'badge-gray',
  expired: 'badge-gray',
};

export default () => ({
  state: { ticket: {}, line: {}, branch: {}, estimate: null, ahead: null, updatedAt: null },
  disconnected: false,
  alertLead: 15,
  alertMessage: '',
  pushEnabled: false,
  pushBusy: false,
  pushMessage: '',
  alarmAck: false,
  stopAlarm: null,
  lastCallKey: null,
  isIos: /iPad|iPhone|iPod/.test(navigator.userAgent),

  init() {
    const el = this.$el;
    this.urls = { state: el.dataset.stateUrl, events: el.dataset.eventsUrl, alert: el.dataset.alertUrl };
    this.statusLabels = dataJson(el, 'statusLabels', {});
    this.methodLabels = dataJson(el, 'methodLabels', {});
    this.endMessages = dataJson(el, 'endMessages', {});
    this.push = { config: dataJson(el, 'pushConfig'), vapidKey: el.dataset.vapidKey, sdkVersion: el.dataset.firebaseSdk };
    this.apply(dataJson(el, 'initial', this.state));
    this.alertLead = this.state.ticket.alertLeadMinutes ?? 15;
    this.pushEnabled = 'Notification' in window && Notification.permission === 'granted' && Boolean(el.dataset.canPush);
    if (this.pushEnabled) registerServiceWorker();
    // Any tap on the page unlocks audio so the alarm can play later.
    document.addEventListener('pointerdown', unlockAudio, { once: true });

    this.disconnect = connectLive(this.urls.events, {
      onChange: () => this.refresh(),
      onStatus: (connected) => (this.disconnected = !connected),
    });
  },

  destroy() {
    this.disconnect?.();
    this.stopAlarm?.();
  },

  async refresh() {
    try {
      this.apply(await api(this.urls.state));
    } catch {
      /* keep the last known state; the banner shows the connection problem */
    }
  },

  apply(next) {
    this.state = next;
    const ticket = next.ticket;
    if (ticket.status !== 'called') return this.silence();
    // Each call and each recall has a new key → ring again (also when the page is opened
    // from the push notification while already called; audio may need a tap first).
    const callKey = `${ticket.lastCalledAt}-${ticket.recallCount}`;
    if (callKey !== this.lastCallKey) {
      this.lastCallKey = callKey;
      this.ring();
    }
  },

  ring() {
    this.alarmAck = false;
    this.stopAlarm?.();
    this.stopAlarm = startAlarm();
    if (document.visibilityState !== 'visible') {
      showLocalNotification(t('calledTitle'), this.counterText, location.href);
    }
    if (window.gsap) window.gsap.fromTo('[role="alertdialog"]', { scale: 0.9 }, { scale: 1, duration: 0.4, ease: 'back.out' });
  },

  silence() {
    this.stopAlarm?.();
    this.stopAlarm = null;
  },

  acknowledge() {
    this.alarmAck = true;
    this.silence();
  },

  async saveAlert() {
    try {
      await post(this.urls.alert, { minutes: this.alertLead });
      this.alertMessage = t('alertSaved', { minutes: this.alertLead });
    } catch (err) {
      this.alertMessage = err.message;
    }
  },

  async enablePush() {
    this.pushBusy = true;
    try {
      const result = await enablePush(this.push);
      this.pushEnabled = result === 'enabled';
      this.pushMessage = t(result === 'enabled' ? 'pushEnabled' : result === 'denied' ? 'pushDenied' : 'pushUnsupported');
    } catch (err) {
      this.pushMessage = err.message || t('pushUnsupported');
    } finally {
      this.pushBusy = false;
    }
  },

  // ── Values shown in the template ───────────────────────────
  get isWaiting() { return this.state.ticket.status === 'waiting'; },
  get isCalled() { return this.state.ticket.status === 'called'; },
  get isActive() { return this.isWaiting || this.isCalled; },
  get showCalledOverlay() { return this.isCalled && !this.alarmAck; },
  get statusLabel() { return this.statusLabels[this.state.ticket.status] ?? ''; },
  get statusClass() { return STATUS_CLASSES[this.state.ticket.status] ?? 'badge-gray'; },
  get aheadText() { return aheadText(this.state.ahead); },
  get rangeText() { return rangeText(this.state.estimate); },
  get expectedText() {
    const e = this.state.estimate;
    return e ? t('expectedAt', { from: e.expectedFrom, to: e.expectedTo }) : '';
  },
  get paceText() { return this.state.estimate ? t('paceValue', { minutes: this.state.estimate.paceMinutes }) : ''; },
  get methodText() { return this.state.estimate ? this.methodLabels[this.state.estimate.method] ?? '' : ''; },
  get updatedText() { return this.state.updatedAt ? clockTime(this.state.updatedAt) : ''; },
  get counterText() { return t('goTo', { counter: this.state.ticket.counterLabel || t('serviceDesk') }); },
  get endMessage() { return this.endMessages[this.state.ticket.status] ?? ''; },
});

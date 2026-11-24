// Browser entry point: registers the Alpine components (CSP build — no inline JS needed)
// and a few page-wide behaviours.
import Alpine from '/vendor/alpine/module.esm.js';
import { t } from './lib/i18n.js';
import ticketTracker from './components/ticketTracker.js';
import operatorConsole from './components/operatorConsole.js';
import displayBoard from './components/displayBoard.js';
import branchLive from './components/branchLive.js';
import reportCharts from './components/reportCharts.js';
import { countdown, copyText, hoursEditor, devInbox } from './components/small.js';

Alpine.data('ticketTracker', ticketTracker);
Alpine.data('operatorConsole', operatorConsole);
Alpine.data('displayBoard', displayBoard);
Alpine.data('branchLive', branchLive);
Alpine.data('reportCharts', reportCharts);
Alpine.data('countdown', countdown);
Alpine.data('copyText', copyText);
Alpine.data('hoursEditor', hoursEditor);
Alpine.data('devInbox', devInbox);

// Forms with data-confirm="question" ask before submitting (cancel, delete…).
document.addEventListener('submit', (event) => {
  const form = event.target.closest('form[data-confirm]');
  if (form && !window.confirm(form.dataset.confirm || t('confirmGeneric'))) event.preventDefault();
});

// Prevent double submits: disable the submit button once a normal form is sent.
document.addEventListener('submit', (event) => {
  if (event.defaultPrevented) return;
  const button = event.target.querySelector('button[type="submit"]');
  if (button) setTimeout(() => (button.disabled = true), 0);
});

// Subtle entrance animation (skipped for users who prefer reduced motion).
window.addEventListener('DOMContentLoaded', () => {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!window.gsap || reduce) return;
  window.gsap.from('[data-animate]', { opacity: 0, y: 8, duration: 0.35, stagger: 0.04, ease: 'power1.out' });
  window.gsap.from('[data-flash]', { opacity: 0, y: -6, duration: 0.3 });
});

window.Alpine = Alpine;
Alpine.start();

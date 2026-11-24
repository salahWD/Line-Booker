// Owner report charts (Chart.js is loaded only on the reports page).
import { dataJson } from '../lib/i18n.js';

const COLORS = {
  completed: '#1f776d',
  noShow: '#e11d48',
  cancelled: '#94a3b8',
  open: '#f59e0b',
  tickets: '#49b0a2',
  avgWait: '#0f172a',
};

export default () => ({
  init() {
    const daily = dataJson(this.$el, 'daily', []);
    const labels = dataJson(this.$el, 'labels', {});
    const start = () => {
      if (!window.Chart) return setTimeout(start, 100); // wait for the deferred script
      this.draw(daily, labels);
    };
    start();
  },

  draw(daily, labels) {
    const { Chart } = window;
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    const days = daily.map((d) => d.day.slice(5)); // MM-DD
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const base = {
      responsive: true,
      maintainAspectRatio: false,
      animation: reducedMotion ? false : { duration: 400 },
      plugins: { legend: { rtl: true, position: 'bottom' }, tooltip: { rtl: true } },
    };

    this.charts = [
      new Chart(this.$refs.appointments, {
        type: 'bar',
        data: {
          labels: days,
          datasets: ['completed', 'noShow', 'cancelled', 'open'].map((key) => ({
            label: labels[key],
            data: daily.map((d) => d[key]),
            backgroundColor: COLORS[key],
            stack: 'a',
          })),
        },
        options: { ...base, scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } } } },
      }),
      new Chart(this.$refs.tickets, {
        type: 'bar',
        data: {
          labels: days,
          datasets: [
            { type: 'bar', label: labels.tickets, data: daily.map((d) => d.tickets), backgroundColor: COLORS.tickets, yAxisID: 'y' },
            { type: 'line', label: labels.avgWait, data: daily.map((d) => d.avgWait), borderColor: COLORS.avgWait, backgroundColor: COLORS.avgWait, tension: 0.3, spanGaps: true, yAxisID: 'y1' },
          ],
        },
        options: {
          ...base,
          scales: {
            y: { beginAtZero: true, ticks: { precision: 0 } },
            y1: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false } },
          },
        },
      }),
    ];
  },

  destroy() {
    this.charts?.forEach((c) => c.destroy());
  },
});

// Sounds made with the Web Audio API (no audio files to download).
// Browsers only allow sound after the user has interacted with the page, so screens
// call unlockAudio() from a click (e.g. "enable sound" or any button press).

let ctx = null;

function audio() {
  if (!ctx) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return null;
    ctx = new AudioContext();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

export function unlockAudio() {
  audio();
}

function tone(frequency, start, duration, volume = 0.3) {
  const c = audio();
  if (!c) return;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = 'sine';
  osc.frequency.value = frequency;
  gain.gain.setValueAtTime(0, c.currentTime + start);
  gain.gain.linearRampToValueAtTime(volume, c.currentTime + start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + start + duration);
  osc.connect(gain).connect(c.destination);
  osc.start(c.currentTime + start);
  osc.stop(c.currentTime + start + duration + 0.05);
}

/** Two-note "ding-dong" for the waiting-room display. */
export function chime() {
  tone(880, 0, 0.6);
  tone(660, 0.35, 0.9);
}

/** Loud repeating alarm for "your turn" on the customer's phone. Returns a stop() function. */
export function startAlarm() {
  const ring = () => {
    tone(988, 0, 0.25, 0.5);
    tone(1319, 0.3, 0.25, 0.5);
    tone(988, 0.6, 0.25, 0.5);
    if (navigator.vibrate) navigator.vibrate([400, 150, 400, 150, 800]);
  };
  ring();
  const timer = setInterval(ring, 2000);
  return () => {
    clearInterval(timer);
    if (navigator.vibrate) navigator.vibrate(0);
  };
}

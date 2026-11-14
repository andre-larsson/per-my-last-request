// Short synthesized cues for turn playback. No audio files; everything is built from oscillators and noise.
// Kept quiet and mostly low: thuds, knocks and soft chimes, nothing shrill, nothing that loops.
let ctx = null;
let out = null;
let noiseBuffer = null;
let enabled = true;

/** Browsers start audio suspended until a click or key press. Call this from any user gesture. */
export function unlockSound() {
  if (!enabled) return;
  try {
    if (!ctx) {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) return;
      ctx = new Context();
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -12;
      limiter.ratio.value = 6;
      out = ctx.createGain();
      out.gain.value = 0.7;
      out.connect(limiter).connect(ctx.destination);
      noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
  } catch { ctx = null; }
}
export function setSoundEnabled(on) {
  enabled = on;
  if (on) unlockSound();
  else ctx?.suspend?.();
}
export const soundEnabled = () => enabled;

function envelope(t, gain, attack, dur) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  g.connect(out);
  return g;
}
function tone(t, { freq, to = freq, type = 'sine', dur = 0.2, gain = 0.3, attack = 0.005 }) {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (to !== freq) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
  osc.connect(envelope(t, gain, attack, dur));
  osc.start(t);
  osc.stop(t + dur + 0.05);
}
function noise(t, { dur = 0.1, gain = 0.3, type = 'lowpass', freq = 1000, to = freq, q = 0.8, attack = 0.003 }) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.Q.value = q;
  filter.frequency.setValueAtTime(freq, t);
  if (to !== freq) filter.frequency.exponentialRampToValueAtTime(to, t + dur);
  src.connect(filter).connect(envelope(t, gain, attack, dur));
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.05);
}
const notes = (t, freqs, { step = 0.09, dur = 0.25, gain = 0.12, type = 'triangle' } = {}) => freqs.forEach((freq, i) => tone(t + i * step, { freq, type, dur, gain }));

// One cue per kind of moment. The decision is a rubber stamp, since the guild runs on paperwork.
const CUES = {
  choose: t => { tone(t, { freq: 150, to: 60, dur: 0.16, gain: 0.5 }); noise(t, { freq: 900, dur: 0.06, gain: 0.35 }); },
  walk: t => { noise(t, { freq: 500, dur: 0.08, gain: 0.45 }); noise(t + 0.17, { freq: 450, dur: 0.08, gain: 0.4 }); },
  strike: t => { noise(t, { type: 'bandpass', freq: 700, to: 2200, q: 1.2, dur: 0.09, gain: 0.18, attack: 0.02 }); noise(t + 0.08, { freq: 1300, dur: 0.06, gain: 0.45 }); tone(t + 0.08, { freq: 210, to: 90, dur: 0.1, gain: 0.32 }); },
  heavy: t => { noise(t, { type: 'bandpass', freq: 500, to: 1800, q: 1.2, dur: 0.15, gain: 0.2, attack: 0.04 }); noise(t + 0.13, { freq: 800, dur: 0.12, gain: 0.55 }); tone(t + 0.13, { freq: 160, to: 50, dur: 0.22, gain: 0.5 }); },
  guard: t => { noise(t, { type: 'bandpass', freq: 900, dur: 0.06, gain: 0.12 }); tone(t + 0.03, { freq: 260, to: 240, type: 'triangle', dur: 0.12, gain: 0.3 }); },
  block: t => { notes(t, [311, 467, 702], { step: 0, dur: 0.35, gain: 0.1, type: 'sine' }); noise(t, { freq: 1600, dur: 0.05, gain: 0.25 }); tone(t, { freq: 120, to: 70, dur: 0.12, gain: 0.25 }); },
  hurt: t => { tone(t, { freq: 115, to: 45, dur: 0.26, gain: 0.55 }); noise(t, { freq: 420, dur: 0.14, gain: 0.4 }); },
  idle: t => { noise(t, { type: 'bandpass', freq: 480, q: 0.7, dur: 0.38, gain: 0.3, attack: 0.1 }); },
  counter: t => { CUES.block(t); CUES.heavy(t + 0.1); },
  heal: t => notes(t, [392, 494, 587], { step: 0.08, dur: 0.3, gain: 0.12 }),
  coins: t => { tone(t, { freq: 784, type: 'triangle', dur: 0.12, gain: 0.17 }); tone(t + 0.07, { freq: 1047, type: 'triangle', dur: 0.22, gain: 0.14 }); },
  retreat: t => { noise(t, { type: 'bandpass', freq: 1400, to: 350, q: 1, dur: 0.28, gain: 0.35, attack: 0.03 }); tone(t + 0.05, { freq: 330, to: 220, type: 'triangle', dur: 0.22, gain: 0.18 }); },
  enter: t => { tone(t, { freq: 98, type: 'triangle', dur: 0.3, gain: 0.35 }); tone(t + 0.14, { freq: 147, type: 'triangle', dur: 0.32, gain: 0.25 }); },
  // A smash is announced: two low pulses, like a heartbeat.
  warn: t => { tone(t, { freq: 82, dur: 0.15, gain: 0.5 }); tone(t + 0.19, { freq: 78, dur: 0.18, gain: 0.45 }); },
  defeat: t => { tone(t, { freq: 294, to: 98, type: 'triangle', dur: 0.5, gain: 0.4 }); noise(t, { freq: 500, dur: 0.22, gain: 0.45 }); },
  stamp: t => { tone(t, { freq: 130, to: 55, dur: 0.2, gain: 0.6 }); noise(t, { freq: 800, dur: 0.08, gain: 0.45 }); notes(t + 0.12, [523, 659, 784], { step: 0, dur: 0.6, gain: 0.07 }); },
  camp: t => notes(t, [392, 523], { step: 0.11, dur: 0.35, gain: 0.14 }),
  won: t => notes(t, [523, 659, 784, 1047], { step: 0.11, dur: 0.4, gain: 0.16 }),
  lost: t => notes(t, [392, 349, 294, 220], { step: 0.22, dur: 0.4, gain: 0.12 }),
};
export const SOUND_NAMES = Object.keys(CUES);

/** Plays a cue `delay` seconds from now. Silent when sound is off or the browser has not allowed audio yet. */
export function playSound(name, delay = 0) {
  if (!enabled || !ctx || ctx.state !== 'running' || !CUES[name]) return;
  try { CUES[name](ctx.currentTime + 0.01 + delay); } catch { /* A failed cue is never worth interrupting play for. */ }
}

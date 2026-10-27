import { readPrefs, writePrefs } from './saves';

// Sound, synthesised with WebAudio: no audio files to download. iOS only lets audio start inside a
// user gesture, so the context is created (or resumed) on the first touch or click.

let ctx: AudioContext | null = null;
let muted = readPrefs().muted === true;

function audio(): AudioContext | null {
  if (muted) return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

if (typeof window !== 'undefined') {
  const unlock = () => {
    audio();
    window.removeEventListener('pointerdown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(m: boolean): void {
  muted = m;
  writePrefs({ muted: m });
  if (m) void ctx?.suspend();
  else audio();
}

function tone(freq: number, dur: number, { type = 'sine' as OscillatorType, gain = 0.08, at = 0, slide = 0 } = {}) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + at;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur: number, { gain = 0.25, at = 0, cutoff = 900, sweep = 120 } = {}) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + at;
  const len = Math.floor(a.sampleRate * dur);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(cutoff, t);
  f.frequency.exponentialRampToValueAtTime(sweep, t + dur);
  const g = a.createGain();
  g.gain.setValueAtTime(gain, t);
  src.connect(f).connect(g).connect(a.destination);
  src.start(t);
}

export const sfx = {
  /** Selecting a unit or city. */
  select: () => tone(880, 0.06, { type: 'triangle', gain: 0.05 }),
  /** An order given. */
  order: () => {
    tone(520, 0.07, { type: 'square', gain: 0.035 });
    tone(780, 0.09, { type: 'square', gain: 0.035, at: 0.07 });
  },
  /** A target in crosshairs, waiting for the confirming tap. */
  arm: () => {
    for (let i = 0; i < 3; i++) tone(1320, 0.04, { type: 'square', gain: 0.03, at: i * 0.07 });
  },
  /** Orders locked: the turn goes. */
  endTurn: () => {
    tone(196, 0.35, { type: 'sawtooth', gain: 0.05, slide: 196 });
    tone(294, 0.35, { type: 'sawtooth', gain: 0.035, at: 0.05, slide: 294 });
  },
  /** A gun, a strike landing. */
  boom: () => {
    noise(0.7, { gain: 0.35, cutoff: 700, sweep: 60 });
    tone(70, 0.35, { type: 'sine', gain: 0.25, slide: -40 });
  },
  /** Small arms and a crump: a battle in a hex. */
  battle: () => {
    for (let i = 0; i < 5; i++) noise(0.06, { gain: 0.12, at: i * 0.07 + Math.random() * 0.03, cutoff: 3000, sweep: 800 });
    noise(0.5, { gain: 0.22, at: 0.25, cutoff: 600, sweep: 70 });
  },
  /** Victory and defeat stings. */
  win: () => [392, 494, 587, 784].forEach((f, i) => tone(f, 0.3, { type: 'triangle', gain: 0.06, at: i * 0.12 })),
  lose: () => [392, 330, 262, 196].forEach((f, i) => tone(f, 0.35, { type: 'triangle', gain: 0.06, at: i * 0.14 })),
};

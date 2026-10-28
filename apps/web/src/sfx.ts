import { readPrefs, writePrefs } from './saves';

// Sound, synthesised with WebAudio: no audio files to download. iOS only lets audio start inside a
// user gesture, so the context is created (or resumed) on the first touch or click.

let ctx: AudioContext | null = null;
let muted = readPrefs().muted === true;

export function audio(): AudioContext | null {
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

/** Arena sounds, by weapon and event. Throttled so a firefight does not turn into noise. */
const last: Record<string, number> = {};
function throttle(key: string, ms: number): boolean {
  const now = performance.now();
  if ((last[key] ?? 0) + ms > now) return false;
  last[key] = now;
  return true;
}

export const arenaSfx = {
  shell: () => {
    noise(0.45, { gain: 0.42, cutoff: 1400, sweep: 80 });
    tone(90, 0.3, { type: 'sine', gain: 0.3, slide: -55 });
  },
  cannon: () => throttle('cannon', 60) && noise(0.09, { gain: 0.22, cutoff: 3200, sweep: 600 }),
  bullet: () => throttle('bullet', 70) && noise(0.04, { gain: 0.1, cutoff: 5000, sweep: 2000 }),
  rocket: () => {
    noise(0.5, { gain: 0.16, cutoff: 2600, sweep: 400 });
    tone(320, 0.4, { type: 'sawtooth', gain: 0.025, slide: -200 });
  },
  lob: () => {
    noise(0.6, { gain: 0.5, cutoff: 700, sweep: 50 });
    tone(55, 0.5, { type: 'sine', gain: 0.35, slide: -25 });
  },
  dive: () => tone(1200, 0.9, { type: 'sawtooth', gain: 0.025, slide: -700 }),
  bounce: () => throttle('bounce', 50) && tone(2400, 0.08, { type: 'triangle', gain: 0.06, slide: -900 }),
  boom: (size: number) => {
    if (!throttle('boom', 45)) return;
    noise(0.5 + size * 0.35, { gain: Math.min(0.6, 0.3 + size * 0.15), cutoff: 900, sweep: 45 });
    tone(60, 0.4 + size * 0.2, { type: 'sine', gain: 0.32, slide: -35 });
  },
  hurt: () => throttle('hurt', 120) && tone(140, 0.12, { type: 'square', gain: 0.05, slide: -60 }),
  capture: () => throttle('capture', 900) && tone(660, 0.12, { type: 'triangle', gain: 0.05 }),
  ability: () => [523, 784, 1046].forEach((f, i) => tone(f, 0.14, { type: 'triangle', gain: 0.05, at: i * 0.06 })),
};

/** Battle music: drums, a driving bass line and a dark pad, scheduled on the audio clock. */
let music: { stop: () => void } | null = null;

export function startMusic(): void {
  stopMusic();
  const a = audio();
  if (!a) return;
  const out = a.createGain();
  out.gain.value = 0.0001;
  out.gain.exponentialRampToValueAtTime(0.5, a.currentTime + 1.2);
  out.connect(a.destination);
  const bpm = 128;
  const beat = 60 / bpm;
  // A minor, a riff of eighth notes with a turn every two bars.
  const riff = [45, 45, 57, 45, 48, 45, 55, 45, 45, 45, 57, 45, 52, 50, 48, 47];
  const hz = (m: number) => 440 * 2 ** ((m - 69) / 12);
  let step = 0;
  let next = a.currentTime + 0.1;
  const voice = (f: number, at: number, dur: number, type: OscillatorType, gain: number, cutoff: number) => {
    const o = a.createOscillator();
    const g = a.createGain();
    const lp = a.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = cutoff;
    o.type = type;
    o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(gain, at + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(lp).connect(g).connect(out);
    o.start(at);
    o.stop(at + dur + 0.05);
  };
  const hit = (at: number, dur: number, gain: number, cutoff: number, sweep: number) => {
    const len = Math.floor(a.sampleRate * dur);
    const buf = a.createBuffer(1, len, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
    const src = a.createBufferSource();
    src.buffer = buf;
    const f = a.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(cutoff, at);
    f.frequency.exponentialRampToValueAtTime(sweep, at + dur);
    const g = a.createGain();
    g.gain.value = gain;
    src.connect(f).connect(g).connect(out);
    src.start(at);
  };
  const timer = window.setInterval(() => {
    while (next < a.currentTime + 0.25) {
      const eighth = step % 16;
      const at = next;
      if (eighth % 4 === 0) {
        voice(55, at, 0.25, 'sine', 0.6, 400); // kick
        voice(110, at, 0.06, 'triangle', 0.25, 800);
      }
      if (eighth % 8 === 4) hit(at, 0.22, 0.35, 4000, 900); // snare
      hit(at, 0.04, 0.08, 9000, 6000); // hat
      voice(hz(riff[eighth]!), at, beat * 0.45, 'sawtooth', 0.13, 700 + 500 * Math.sin(step / 8));
      if (eighth === 0) for (const m of [57, 60, 64]) voice(hz(m), at, beat * 7.5, 'triangle', 0.025, 1200);
      step++;
      next += beat / 2;
    }
  }, 60);
  music = {
    stop: () => {
      window.clearInterval(timer);
      try {
        out.gain.cancelScheduledValues(a.currentTime);
        out.gain.setValueAtTime(out.gain.value, a.currentTime);
        out.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + 0.6);
        window.setTimeout(() => out.disconnect(), 800);
      } catch {
        out.disconnect();
      }
    },
  };
}

export function stopMusic(): void {
  music?.stop();
  music = null;
}

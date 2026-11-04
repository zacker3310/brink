// Synth voices for the score, the stingers and the interface: a handful of oscillators and one
// shared noise buffer each, scheduled on the audio clock and torn down when they end. Cheap enough
// to run a full battle score on a phone: no voice is more than four nodes.

export const hz = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);

let lite = false;

/** Phones: one oscillator a note instead of a detuned pair (half the score's oscillators). */
export function setLite(on: boolean): void {
  lite = on;
}

const noiseBufs = new WeakMap<BaseAudioContext, AudioBuffer>();

/** Two seconds of white noise, made once a context. */
export function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  let b = noiseBufs.get(ctx);
  if (!b) {
    const len = Math.floor(ctx.sampleRate * 2);
    b = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = b.getChannelData(0);
    // A fixed LCG: the same hiss every time, no Math.random in the audio path.
    let s = 0x2f6b1d;
    for (let i = 0; i < len; i++) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      d[i] = (s / 4294967296) * 2 - 1;
    }
    noiseBufs.set(ctx, b);
  }
  return b;
}

/** Disconnect a voice's nodes when its source stops. */
function cleanup(src: AudioScheduledSourceNode, nodes: AudioNode[]): void {
  src.onended = () => {
    for (const n of nodes) n.disconnect();
  };
}

/** An exponential-ish envelope on a gain: attack to `peak`, then decay to silence by `end`. */
function env(p: AudioParam, at: number, attack: number, peak: number, end: number, hold = 0): void {
  p.setValueAtTime(0.0001, at);
  p.exponentialRampToValueAtTime(Math.max(0.0002, peak), at + attack);
  if (hold > 0) p.setValueAtTime(Math.max(0.0002, peak), at + attack + hold);
  p.exponentialRampToValueAtTime(0.0001, Math.max(at + attack + hold + 0.01, end));
}

export interface ToneOpts {
  type?: OscillatorType;
  attack?: number;
  /** Seconds at full level after the attack. */
  hold?: number;
  /** Lowpass cutoff in Hz; 0 for none. */
  cutoff?: number;
  /** Cutoff at the end of the note (a closing filter). */
  cutoffEnd?: number;
  /** Pitch at the end, Hz (a slide). */
  slideTo?: number;
  /** Cents of detune; with `unison` a second oscillator at minus this. */
  detune?: number;
  unison?: boolean;
  q?: number;
}

/** One pitched note: one or two oscillators, an optional lowpass, a gain envelope. */
export function tone(ctx: BaseAudioContext, out: AudioNode, at: number, freq: number, dur: number, gain: number, o: ToneOpts = {}): void {
  const g = ctx.createGain();
  const nodes: AudioNode[] = [g];
  let head: AudioNode = g;
  if (o.cutoff) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = o.q ?? 0.8;
    f.frequency.setValueAtTime(o.cutoff, at);
    if (o.cutoffEnd) f.frequency.exponentialRampToValueAtTime(Math.max(30, o.cutoffEnd), at + dur);
    f.connect(g);
    head = f;
    nodes.push(f);
  }
  g.connect(out);
  env(g.gain, at, o.attack ?? 0.008, gain, at + dur, o.hold ?? 0);
  const oscs = o.unison && !lite ? [o.detune ?? 7, -(o.detune ?? 7)] : [o.detune ?? 0];
  let last: OscillatorNode | null = null;
  for (const dt of oscs) {
    const osc = ctx.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(freq, at);
    if (o.slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.slideTo), at + dur);
    if (dt) osc.detune.setValueAtTime(dt, at);
    osc.connect(head);
    osc.start(at);
    osc.stop(at + dur + 0.05);
    nodes.push(osc);
    last = osc;
  }
  if (last) cleanup(last, nodes);
}

export interface NoiseOpts {
  type?: BiquadFilterType;
  freq?: number;
  freqEnd?: number;
  q?: number;
  attack?: number;
}

/** A burst of filtered noise: a hat, a snare's rattle, a card's swish, radio hiss. */
export function noise(ctx: BaseAudioContext, out: AudioNode, at: number, dur: number, gain: number, o: NoiseOpts = {}): void {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  const f = ctx.createBiquadFilter();
  f.type = o.type ?? 'lowpass';
  f.Q.value = o.q ?? 0.8;
  f.frequency.setValueAtTime(o.freq ?? 1200, at);
  if (o.freqEnd) f.frequency.exponentialRampToValueAtTime(Math.max(30, o.freqEnd), at + dur);
  const g = ctx.createGain();
  env(g.gain, at, o.attack ?? 0.003, gain, at + dur);
  src.connect(f).connect(g).connect(out);
  // Start somewhere in the buffer so repeated hits are not one sample.
  const offset = ((at * 7919) % 1.5 + 1.5) % 1.5;
  src.start(at, offset);
  src.stop(at + dur + 0.05);
  cleanup(src, [src, f, g]);
}

// --- Instruments ------------------------------------------------------------------------------

export type Instrument = 'pad' | 'pluck' | 'bass' | 'brass' | 'strings' | 'bell' | 'kick' | 'taiko' | 'snare' | 'hat' | 'timpani' | 'hit';

/** Play `inst` at `at`. `midi` is ignored by the unpitched drums. */
export function play(ctx: BaseAudioContext, out: AudioNode, inst: Instrument, at: number, midi: number, dur: number, gain: number): void {
  const f = hz(midi);
  switch (inst) {
    case 'pad':
      tone(ctx, out, at, f, dur, gain, { type: 'sawtooth', attack: Math.min(1.2, dur * 0.4), hold: dur * 0.3, cutoff: 900, cutoffEnd: 500, unison: true, detune: 9 });
      return;
    case 'strings':
      tone(ctx, out, at, f, dur, gain, { type: 'sawtooth', attack: Math.min(0.3, dur * 0.3), hold: dur * 0.4, cutoff: 2600, cutoffEnd: 1400, unison: true, detune: 6 });
      return;
    case 'pluck':
      tone(ctx, out, at, f, dur, gain, { type: 'square', attack: 0.004, cutoff: 2200, cutoffEnd: 300, q: 2 });
      return;
    case 'bass':
      tone(ctx, out, at, f, dur, gain, { type: 'sawtooth', attack: 0.006, cutoff: 700, cutoffEnd: 120, q: 3 });
      return;
    case 'brass':
      tone(ctx, out, at, f, dur, gain, { type: 'sawtooth', attack: 0.05, hold: dur * 0.3, cutoff: 2400, cutoffEnd: 600, unison: true, detune: 5, q: 1.2 });
      return;
    case 'bell':
      tone(ctx, out, at, f, dur, gain, { type: 'sine', attack: 0.003 });
      tone(ctx, out, at, f * 2.76, dur * 0.5, gain * 0.35, { type: 'sine', attack: 0.003 });
      return;
    case 'kick':
      tone(ctx, out, at, 140, Math.min(dur, 0.35), gain, { type: 'sine', attack: 0.003, slideTo: 42 });
      return;
    case 'taiko':
      tone(ctx, out, at, 95, Math.min(dur, 0.7), gain, { type: 'sine', attack: 0.004, slideTo: 48 });
      noise(ctx, out, at, 0.18, gain * 0.5, { freq: 500, freqEnd: 120 });
      return;
    case 'snare':
      tone(ctx, out, at, 190, 0.12, gain * 0.5, { type: 'triangle', attack: 0.002, slideTo: 140 });
      noise(ctx, out, at, Math.min(dur, 0.22), gain, { type: 'bandpass', freq: 2200, freqEnd: 1400, q: 0.7 });
      return;
    case 'hat':
      noise(ctx, out, at, Math.min(dur, 0.06), gain, { type: 'highpass', freq: 7000 });
      return;
    case 'timpani':
      tone(ctx, out, at, f, dur, gain, { type: 'sine', attack: 0.006, slideTo: f * 0.97 });
      noise(ctx, out, at, 0.12, gain * 0.35, { freq: 700, freqEnd: 200 });
      return;
    case 'hit':
      // An orchestral hit: a low boom under a short noise crack.
      tone(ctx, out, at, 60, dur, gain, { type: 'sine', attack: 0.004, slideTo: 32 });
      noise(ctx, out, at, Math.min(dur, 0.6), gain * 0.6, { freq: 1600, freqEnd: 90 });
      return;
  }
}

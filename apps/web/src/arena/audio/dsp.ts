// Small DSP for synthesising sounds into plain arrays, once per sample rate, off the audio graph.
// Every layer adds into `out` at a start time in seconds.

export type Samples = Float32Array<ArrayBuffer>;
export type Rand = () => number;

/** mulberry32: a seeded uniform in [0, 1). */
export function rand(seed: number): Rand {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function samples(sr: number, seconds: number): Samples {
  return new Float32Array(Math.max(1, Math.ceil(sr * seconds)));
}

export const dB = (db: number): number => 10 ** (db / 20);

export type FilterType = 'lowpass' | 'highpass' | 'bandpass' | 'peak';

/** A biquad from the RBJ cookbook, run sample by sample. `set` keeps the state, so it can sweep. */
export class Biquad {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;

  constructor(
    private readonly type: FilterType,
    private readonly sr: number,
    f: number,
    private q = 0.707,
    private gain = 0,
  ) {
    this.set(f);
  }

  set(f: number, q = this.q, gain = this.gain): void {
    this.q = q;
    this.gain = gain;
    const w = (2 * Math.PI * Math.min(Math.max(f, 10), this.sr * 0.45)) / this.sr;
    const cos = Math.cos(w);
    const alpha = Math.sin(w) / (2 * q);
    let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
    if (this.type === 'lowpass') {
      b0 = (1 - cos) / 2;
      b1 = 1 - cos;
      b2 = b0;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
    } else if (this.type === 'highpass') {
      b0 = (1 + cos) / 2;
      b1 = -(1 + cos);
      b2 = b0;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
    } else if (this.type === 'bandpass') {
      b0 = alpha;
      b1 = 0;
      b2 = -alpha;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
    } else {
      const A = 10 ** (gain / 40);
      b0 = 1 + alpha * A;
      b1 = -2 * cos;
      b2 = 1 - alpha * A;
      a0 = 1 + alpha / A;
      a1 = -2 * cos;
      a2 = 1 - alpha / A;
    }
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = a1 / a0;
    this.a2 = a2 / a0;
  }

  run(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

/** Runs a whole buffer through filters in series, in place. */
export function filter(buf: Samples, ...chain: Biquad[]): Samples {
  for (let i = 0; i < buf.length; i++) {
    let v = buf[i]!;
    for (const f of chain) v = f.run(v);
    buf[i] = v;
  }
  return buf;
}

/**
 * A supersonic crack: the N-wave of a bullet's shock, a jump to +amp, a straight fall to -amp over
 * `ms`, a jump back; then its ground reflection a moment later.
 */
export function nwave(out: Samples, sr: number, at: number, ms: number, amp: number, r: Rand): void {
  const add = (start: number, a: number) => {
    const s = Math.round(start * sr);
    const n = Math.max(3, Math.round((ms / 1000) * sr));
    for (let i = 0; i <= n; i++) {
      const j = s + i;
      if (j >= out.length) return;
      // Soften the two jumps over one sample so they stay crisp but do not alias into a buzz.
      const edge = i === 0 || i === n ? 0.5 : 1;
      out[j]! += a * edge * (1 - (2 * i) / n);
    }
  };
  add(at, amp);
  add(at + (0.4 + r() * 0.9) / 1000, amp * (0.45 + r() * 0.2));
}

/**
 * A blast wave (Friedlander): an instant overpressure that decays through zero into a long, shallow
 * negative phase. `ms` is the positive phase; smoothed by a one-pole low-pass near 3 / T.
 */
export function friedlander(out: Samples, sr: number, at: number, ms: number, amp: number, b = 1.6): void {
  const T = ms / 1000;
  const s = Math.round(at * sr);
  const n = Math.round(T * 7 * sr);
  const fc = Math.min(3 / T, sr * 0.4);
  const k = 1 - Math.exp((-2 * Math.PI * fc) / sr);
  let y = 0;
  for (let i = 0; i < n; i++) {
    const j = s + i;
    if (j >= out.length) return;
    const t = i / sr;
    const p = (1 - t / T) * Math.exp((-b * t) / T);
    y += k * (p - y);
    out[j]! += amp * y;
  }
}

/** A damped sinusoid: one resonant mode of a body (a barrel, a hull, the air in a tube). */
export function mode(out: Samples, sr: number, at: number, hz: number, tauMs: number, amp: number, r: Rand, attackMs = 1): void {
  const s = Math.round(at * sr);
  const w = (2 * Math.PI * hz) / sr;
  const c = Math.cos(w);
  const sn = Math.sin(w);
  const ph = r() * 2 * Math.PI;
  let re = Math.cos(ph);
  let im = Math.sin(ph);
  const decay = Math.exp(-1 / ((tauMs / 1000) * sr));
  const attack = Math.max(1, Math.round((attackMs / 1000) * sr));
  let env = 1;
  for (let i = 0; env > 1e-4; i++) {
    const j = s + i;
    if (j >= out.length) return;
    const a = i < attack ? i / attack : 1;
    out[j]! += amp * env * a * im;
    const nr = re * c - im * sn;
    im = re * sn + im * c;
    re = nr;
    env *= decay;
  }
}

/** Shaped noise: white noise under an envelope, through a filter chain, added in. */
export function noise(out: Samples, sr: number, at: number, seconds: number, env: (t: number) => number, chain: Biquad[], amp: number, r: Rand): void {
  const s = Math.round(at * sr);
  const n = Math.min(Math.round(seconds * sr), out.length - s);
  // The envelope at control rate (every 8 samples), interpolated.
  const B = 8;
  const len = chain.length;
  let e0 = env(0);
  for (let i0 = 0; i0 < n; i0 += B) {
    const e1 = env((i0 + B) / sr);
    const m = Math.min(B, n - i0);
    for (let i = 0; i < m; i++) {
      let v = (r() * 2 - 1) * (e0 + ((e1 - e0) * i) / B);
      for (let f = 0; f < len; f++) v = chain[f]!.run(v);
      out[s + i0 + i]! += amp * v;
    }
    e0 = e1;
  }
}

/**
 * Additive tone with a moving pitch: `hz(t)`, `env(t)`, harmonic levels. A rotating phasor at
 * control rate and the Chebyshev recurrence for the harmonics keep it cheap.
 */
export function glide(out: Samples, sr: number, at: number, seconds: number, hz: (t: number) => number, env: (t: number) => number, harmonics: number[], amp: number): void {
  const s = Math.round(at * sr);
  const n = Math.min(Math.round(seconds * sr), out.length - s);
  const B = 16;
  const H = harmonics.length;
  let re = 1;
  let im = 0;
  let e0 = env(0);
  for (let i0 = 0; i0 < n; i0 += B) {
    const t1 = (i0 + B) / sr;
    const w = (2 * Math.PI * hz((i0 + B / 2) / sr)) / sr;
    const cw = Math.cos(w);
    const sw = Math.sin(w);
    const e1 = env(t1);
    const m = Math.min(B, n - i0);
    for (let i = 0; i < m; i++) {
      const nr = re * cw - im * sw;
      im = re * sw + im * cw;
      re = nr;
      const c2 = 2 * re;
      let prev = 0;
      let cur = im;
      let v = 0;
      for (let h = 0; h < H; h++) {
        v += harmonics[h]! * cur;
        const next = c2 * cur - prev;
        prev = cur;
        cur = next;
      }
      out[s + i0 + i]! += amp * (e0 + ((e1 - e0) * i) / B) * v;
    }
    const g = 1 / Math.hypot(re, im);
    re *= g;
    im *= g;
    e0 = e1;
  }
}

/** Sweeps a band-pass across a noise layer: `hz(t)` is the centre over time. */
export function sweep(out: Samples, sr: number, at: number, seconds: number, env: (t: number) => number, hz: (t: number) => number, q: number, amp: number, r: Rand): void {
  const bp = new Biquad('bandpass', sr, hz(0), q);
  const s = Math.round(at * sr);
  const n = Math.min(Math.round(seconds * sr), out.length - s);
  const B = 32;
  let e0 = env(0);
  for (let i0 = 0; i0 < n; i0 += B) {
    bp.set(hz(i0 / sr));
    const e1 = env((i0 + B) / sr);
    const m = Math.min(B, n - i0);
    for (let i = 0; i < m; i++) out[s + i0 + i]! += amp * bp.run((r() * 2 - 1) * (e0 + ((e1 - e0) * i) / B));
    e0 = e1;
  }
}

/** Fast attack, then one or two exponential decays (a blast's flash and its body). */
export function decay(attackMs: number, tauMs: number, tau2Ms = 0, mix2 = 0): (t: number) => number {
  const a = attackMs / 1000;
  const k1 = 1000 / tauMs;
  const k2 = tau2Ms > 0 ? 1000 / tau2Ms : 0;
  return (t) => {
    const rise = t < a ? t / a : 1;
    const tt = Math.max(0, t - a);
    return rise * ((1 - mix2) * Math.exp(-tt * k1) + (k2 ? mix2 * Math.exp(-tt * k2) : 0));
  };
}

/**
 * A rolling tail: low noise that swells and falls in bumps, like a report coming back off hills and
 * tree lines at different ranges.
 */
export function rumble(out: Samples, sr: number, at: number, seconds: number, hz: number, amp: number, bumps: number, r: Rand): void {
  const list: { t: number; a: number; up: number; down: number }[] = [];
  for (let i = 0; i < bumps; i++) {
    const t = (i === 0 ? 0 : r() ** 1.4) * seconds * 0.75;
    list.push({ t, a: (i === 0 ? 1 : 0.35 + r() * 0.65) * Math.exp(-t / (seconds * 0.45)), up: 0.02 + r() * 0.08, down: 0.12 + r() * 0.35 });
  }
  const at0 = (t: number) => {
    let e = 0;
    for (const b of list) {
      const d = t - b.t;
      if (d < 0) continue;
      e += b.a * (d < b.up ? d / b.up : Math.exp(-(d - b.up) / b.down));
    }
    return Math.min(1.5, e);
  };
  // The bumps are slow: evaluate them every 5 ms and interpolate.
  const step = 0.005;
  const table = Array.from({ length: Math.ceil(seconds / step) + 2 }, (_, i) => at0(i * step));
  const env = (t: number) => {
    const k = t / step;
    const i = Math.floor(k);
    const a = table[i] ?? 0;
    return a + ((table[i + 1] ?? a) - a) * (k - i);
  };
  noise(out, sr, at, seconds, env, [new Biquad('lowpass', sr, hz, 0.6), new Biquad('lowpass', sr, hz * 1.4, 0.6), new Biquad('highpass', sr, 28)], amp, r);
}

/** Small hard things landing: dirt, stones, brick, brass. `rate` is events a second at time t. */
export function patter(out: Samples, sr: number, at: number, seconds: number, rate: (t: number) => number, lo: number, hi: number, amp: number, r: Rand): void {
  const dt = 0.002;
  for (let t = 0; t < seconds; t += dt) {
    if (r() < rate(t) * dt) {
      const hz = lo * (hi / lo) ** r();
      const a = amp * (0.25 + r() * 0.75) * (1 - t / seconds);
      mode(out, sr, at + t, hz, 2 + r() * 6, a, r, 0.2);
      mode(out, sr, at + t, hz * (1.5 + r() * 0.6), 1.5 + r() * 3, a * 0.5, r, 0.2);
    }
  }
}

/** Removes DC and rumble below 20 Hz, fades the last few ms, and scales the peak to `peak`. */
export function finish(buf: Samples, sr: number, peak = 0.9): Samples {
  filter(buf, new Biquad('highpass', sr, 20), new Biquad('highpass', sr, 20));
  const fade = Math.min(buf.length, Math.round(sr * 0.004));
  for (let i = 0; i < fade; i++) buf[buf.length - 1 - i]! *= i / fade;
  return normalise(buf, peak);
}

export function normalise(buf: Samples, peak = 0.9): Samples {
  let max = 0;
  for (let i = 0; i < buf.length; i++) max = Math.max(max, Math.abs(buf[i]!));
  if (max > 0) {
    const k = peak / max;
    for (let i = 0; i < buf.length; i++) buf[i]! *= k;
  }
  return buf;
}

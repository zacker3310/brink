// Looped beds for continuous sources: engines, tracks, rotors, weather. Each loop is two identical
// periods of events, filtered end to end, and the second kept, so its end runs straight into its
// start. Steady noise layers are tiles filtered as if they had always been looping.

import { Biquad, decay, filter, friedlander, mode, noise, normalise, patter, rand, type Rand, type Samples } from './dsp';

interface Loop {
  /** Adds the period's events (starting at `at` seconds) into `out`. Must draw the same randoms each call. */
  events: (out: Samples, at: number) => void;
  /** Steady layers, one period long each, already seamless. */
  beds?: Samples[];
  /** Filters over the whole two-period buffer. */
  post?: (buf: Samples) => void;
}

function loop(sr: number, period: number, make: (n: number) => Loop): Samples {
  // A whole number of samples a period, so both copies sit on the same grid.
  const n = Math.round(period * sr);
  const { events, beds = [], post } = make(n);
  const twice: Samples = new Float32Array(n * 2);
  events(twice, 0);
  events(twice, n / sr);
  // A third copy: events jittered a little early land just before the end, as they would loop.
  events(twice, (2 * n) / sr);
  for (const bed of beds) {
    for (let i = 0; i < n; i++) {
      twice[i]! += bed[i]!;
      twice[n + i]! += bed[i]!;
    }
  }
  post?.(twice);
  filter(twice, new Biquad('highpass', sr, 20));
  return normalise(twice.slice(n, n * 2));
}

/** A steady noise layer one period long: white noise under `env`, filtered twice round so it loops clean. */
function bed(sr: number, n: number, r: Rand, env: (t: number) => number, chain: Biquad[], amp: number): Samples {
  const tile = new Float32Array(n);
  for (let i = 0; i < n; i++) tile[i] = (r() * 2 - 1) * env(i / sr);
  const out: Samples = new Float32Array(n);
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < n; i++) {
      let v = tile[i]!;
      for (const f of chain) v = f.run(v);
      if (pass === 1) out[i] = amp * v;
    }
  }
  return out;
}

/** Diesel firing at this many rpm when the loop plays at rate 1. */
export const DIESEL_RPM = 900;

/**
 * A V12 four-stroke (MTU MB 873, V-92S2F): 12 firings per two turns, each cylinder a little
 * different in strength and timing, so the note lopes rather than buzzes. Six cycles a loop.
 */
export function diesel(sr: number): Samples {
  const cycle = 120 / DIESEL_RPM;
  const gap = cycle / 12;
  return loop(sr, cycle * 6, (n) => ({
    events: (out, at) => {
      const r = rand(11);
      const off = Array.from({ length: 12 }, () => (r() - 0.5) * 0.06 * gap);
      const amp = Array.from({ length: 12 }, () => 0.7 + r() * 0.3);
      for (let c = 0; c < 6; c++) {
        for (let k = 0; k < 12; k++) {
          const t = at + c * cycle + k * gap + off[k]! + (r() - 0.5) * 0.012 * gap;
          const a = amp[k]! * (0.88 + r() * 0.24);
          friedlander(out, sr, Math.max(0, t), 2.4, a);
          noise(out, sr, Math.max(0, t), 0.012, decay(0.2, 3), [new Biquad('bandpass', sr, 1500, 1.2)], a * 0.18, r);
        }
      }
    },
    beds: [bed(sr, n, rand(12), () => 1, [new Biquad('lowpass', sr, 300, 0.7)], 0.08)],
    post: (buf) => {
      // Exhaust resonance on top of the low-passed pulse train.
      const pipe = filter(buf.slice(), new Biquad('bandpass', sr, 150, 1.5));
      filter(buf, new Biquad('lowpass', sr, 800, 0.7));
      for (let i = 0; i < buf.length; i++) buf[i]! += 0.8 * pipe[i]!;
      filter(buf, new Biquad('highpass', sr, 25));
    },
  }));
}

/** Track link clanks a second at rate 1. */
export const TRACK_CLANKS = 12;

/** Tracks: links slapping the sprocket and the road, the rumble of the ground, road wheels squealing. */
export function tracks(sr: number): Samples {
  const period = 2;
  return loop(sr, period, (n) => ({
    events: (out, at) => {
      const r = rand(23);
      for (let i = 0; i < period * TRACK_CLANKS; i++) {
        const t = Math.max(0, at + i / TRACK_CLANKS + (r() - 0.5) * 0.016);
        const hz = 900 + r() * 400;
        const a = 0.18 + r() * 0.14;
        [1, 1.6, 2.3, 3.4].forEach((k, m) => mode(out, sr, t, hz * k, 25 - m * 5, a / (1 + m * 0.6), r, 0.3));
        friedlander(out, sr, t, 1, a * 1.6);
        noise(out, sr, t, 0.03, decay(0.2, 6), [new Biquad('bandpass', sr, 2500, 1)], a * 0.8, r);
      }
    },
    beds: [
      bed(sr, n, rand(24), (t) => 0.6 + 0.4 * Math.sin(2 * Math.PI * 1.5 * t), [new Biquad('bandpass', sr, 2200, 12)], 0.9),
      bed(sr, n, rand(25), (t) => 0.5 + 0.5 * Math.sin(2 * Math.PI * 0.5 * t + 1), [new Biquad('bandpass', sr, 3400, 15)], 0.5),
      bed(sr, n, rand(26), () => 1, [new Biquad('lowpass', sr, 140, 0.7)], 0.5),
    ],
    post: (buf) => filter(buf, new Biquad('highpass', sr, 40)),
  }));
}

/**
 * A main rotor: each blade's slap (the tip meeting the vortex of the blade ahead) at the blade-pass
 * frequency, over broadband rotor noise swelling in step. Four turns a loop, blades a little uneven.
 */
export function rotor(sr: number, blades: number, rpm: number): Samples {
  const turn = 60 / rpm;
  return loop(sr, turn * 4, (n) => {
    // Fit the blade passes to the whole-sample period.
    const pass = n / sr / (blades * 4);
    const bpf = (2 * Math.PI) / pass;
    return {
      events: (out, at) => {
        const r = rand(31 + blades);
        const off = Array.from({ length: blades }, () => (r() - 0.5) * 0.04 * pass);
        const amp = Array.from({ length: blades }, () => 0.85 + r() * 0.15);
        for (let i = 0; i < blades * 4; i++) {
          const b = i % blades;
          const t = Math.max(0, at + i * pass + off[b]!);
          const a = amp[b]! * (0.93 + r() * 0.14);
          friedlander(out, sr, t, 3.5, a);
          mode(out, sr, t, 85, 30, a * 0.6, r, 2);
          noise(out, sr, t, 0.06, decay(0.5, 18), [new Biquad('bandpass', sr, 700, 0.7)], a * 0.45, r);
        }
      },
      beds: [bed(sr, n, rand(32), (t) => 0.55 + 0.45 * (0.5 + 0.5 * Math.cos(bpf * t)), [new Biquad('lowpass', sr, 900, 0.7)], 0.35)],
      post: (buf) => filter(buf, new Biquad('highpass', sr, 30)),
    };
  });
}

/** White noise, two seconds; looped it is still white. */
export function white(sr: number): Samples {
  const r = rand(5);
  const out: Samples = new Float32Array(Math.round(sr * 2));
  for (let i = 0; i < out.length; i++) out[i] = r() * 2 - 1;
  return out;
}

/** Rain: a hiss and countless drops, a few heavier ones on the ground. */
export function rain(sr: number): Samples {
  return loop(sr, 3, (n) => ({
    events: (out, at) => {
      const r = rand(41);
      patter(out, sr, at, 3, () => 350, 2000, 8000, 0.2, r);
      patter(out, sr, at, 3, () => 60, 300, 900, 0.1, r);
    },
    beds: [bed(sr, n, rand(42), () => 1, [new Biquad('highpass', sr, 1200), new Biquad('lowpass', sr, 9000)], 0.25)],
  }));
}

/** Night insects: three crickets chirping at their own rates. */
export function crickets(sr: number): Samples {
  return loop(sr, 4, () => ({
    events: (out, at) => {
      const r = rand(53);
      for (let c = 0; c < 3; c++) {
        const hz = 4400 + r() * 500;
        const rate = 2.1 + r() * 0.6;
        const level = 0.3 + r() * 0.4;
        for (let t = r() * 0.4; t < 4; t += 1 / rate) {
          for (let p = 0; p < 3; p++) mode(out, sr, at + t + p * 0.025, hz, 4, level, r, 2);
        }
      }
    },
  }));
}

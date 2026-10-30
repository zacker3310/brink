// Where a sound sits: distance from the listener in cells sets its level, how much of its top end
// the air has taken, how late it arrives, and how much of it is echo.

import { rand, type Samples } from './dsp';

/** Camera focus in cells; zoom 0 (close) .. 1 (whole field). */
export interface Listener {
  x: number;
  y: number;
  zoom: number;
}

export interface Spot {
  /** Effective distance, cells. */
  d: number;
  /** Direct level, 0..1. */
  gain: number;
  /** Air absorption: low-pass cutoff, Hz. */
  cutoff: number;
  /** Arrival delay, seconds (sound is slow; scaled so the field still feels immediate). */
  delay: number;
  /** Send to the shared echo. */
  wet: number;
  /** Stereo position, -1 .. 1. */
  pan: number;
}

/** The longest arrival delay, at the far end of the field. */
export const MAX_DELAY = 0.3;
/** Nearer than this (cells), flash and bang land together: the delay starts beyond it. */
const NEAR = 3;

/**
 * `reach`: cells at which the direct sound is 6 dB down; louder weapons carry farther. At night
 * sound carries (a temperature inversion bends it back down): more reach, more echo.
 */
export function place(x: number, y: number, l: Listener, reach: number, night = false): Spot {
  const dx = x - l.x;
  const dy = y - l.y;
  const d0 = Math.hypot(dx, dy);
  // Zoomed out the whole field is in earshot: distances even out and everything sits a little back.
  const z = Math.min(1, Math.max(0, l.zoom));
  const d = d0 * (1 - 0.35 * z) + 9 * z;
  const r = reach * (night ? 1.25 : 1);
  const gain = 1 / (1 + (d / r) ** 1.5);
  const cutoff = Math.min(18000, Math.max(500, 18000 / (1 + d * 0.32)));
  // Light before sound: a distant blast arrives late, up to MAX_DELAY at the far end of the field.
  const delay = Math.min(MAX_DELAY, Math.max(0, d - NEAR) * 0.0075);
  const wet = Math.min(0.75, 0.12 + 0.55 * (d / (d + 18)) + (night ? 0.08 : 0));
  const pan = Math.max(-1, Math.min(1, dx / (d0 + 3))) * 0.9;
  return { d, gain, cutoff, delay, wet, pan };
}

/**
 * The shared echo: early reflections off the ground and nearby cover, then a long tail that loses
 * its highs as it decays, with a few later returns from tree lines and hills. Stereo, decorrelated.
 */
export function impulse(sr: number, seconds = 3): [Samples, Samples] {
  const n = Math.ceil(sr * seconds);
  const out: [Samples, Samples] = [new Float32Array(n), new Float32Array(n)];
  for (let ch = 0; ch < 2; ch++) {
    const r = rand(97 + ch * 13);
    const buf = out[ch]!;
    for (let i = 0; i < 14; i++) {
      const t = 0.008 + r() ** 1.3 * 0.085;
      const j = Math.round(t * sr);
      const a = (0.6 - i * 0.032) * (r() < 0.5 ? -1 : 1);
      for (let k = 0; k < 3 && j + k < n; k++) buf[j + k]! += a * (1 - k * 0.3);
    }
    const returns = [0.32 + r() * 0.1, 0.68 + r() * 0.15, 1.15 + r() * 0.2];
    const envAt = (t: number) => {
      let e = Math.exp((-6.9 * t) / 2.6) * Math.min(1, Math.max(0, (t - 0.025) / 0.035)) * 0.35;
      for (const rt of returns) {
        const d = t - rt;
        if (d > 0) e += 0.16 * Math.exp(-d / 0.18) * Math.exp(-rt / 1.2);
      }
      return e;
    };
    let y = 0;
    // Envelope and filter move slowly: set them every 32 samples.
    for (let i0 = Math.round(0.025 * sr); i0 < n; i0 += 32) {
      const t = i0 / sr;
      const e0 = envAt(t);
      const e1 = envAt(t + 32 / sr);
      // A one-pole low-pass whose cutoff falls from 7 kHz to 500 Hz over the tail: highs die first.
      const fc = 500 + 6500 * Math.exp(-t / 0.5);
      const k = 1 - Math.exp((-2 * Math.PI * fc) / sr);
      for (let i = 0; i < 32 && i0 + i < n; i++) {
        y += k * (r() * 2 - 1 - y);
        buf[i0 + i]! += (e0 + ((e1 - e0) * i) / 32) * y * 1.6;
      }
    }
  }
  return out;
}

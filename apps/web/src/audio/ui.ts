// The interface's sounds, on the ui bus: short, dry and quiet, so a hundred taps a turn never
// tire. Each is a few scheduled voices; a sound called again within its own length is dropped.

import { noise, tone } from './voices';

export type UiSound = 'tap' | 'select' | 'order' | 'arm' | 'card' | 'endTurn' | 'back' | 'toggle' | 'error' | 'radio' | 'deploy';

type Recipe = (ctx: BaseAudioContext, out: AudioNode, t: number) => void;

export const UI_RECIPES: Record<UiSound, Recipe> = {
  // A soft click: a short blip with a breath of noise on its front.
  tap: (c, o, t) => {
    tone(c, o, t, 1500, 0.035, 0.035, { type: 'sine', attack: 0.002, slideTo: 1100 });
    noise(c, o, t, 0.012, 0.02, { type: 'highpass', freq: 4000 });
  },
  select: (c, o, t) => {
    tone(c, o, t, 880, 0.07, 0.045, { type: 'triangle', attack: 0.003 });
    tone(c, o, t + 0.035, 1320, 0.06, 0.03, { type: 'triangle', attack: 0.003 });
  },
  // An order acknowledged: two quick square blips, like a field set's keying tone.
  order: (c, o, t) => {
    tone(c, o, t, 660, 0.06, 0.03, { type: 'square', attack: 0.002, cutoff: 3000 });
    tone(c, o, t + 0.07, 990, 0.08, 0.03, { type: 'square', attack: 0.002, cutoff: 3000 });
  },
  arm: (c, o, t) => {
    for (let i = 0; i < 3; i++) tone(c, o, t + i * 0.06, 1320 + i * 110, 0.035, 0.026, { type: 'square', attack: 0.002, cutoff: 4000 });
  },
  // A card played: a paper swish, a soft thump as it lands, a chime.
  card: (c, o, t) => {
    noise(c, o, t, 0.16, 0.06, { type: 'bandpass', freq: 2500, freqEnd: 6000, q: 0.9, attack: 0.04 });
    tone(c, o, t + 0.13, 150, 0.12, 0.08, { type: 'sine', attack: 0.003, slideTo: 90 });
    tone(c, o, t + 0.15, 1046, 0.35, 0.03, { type: 'triangle', attack: 0.004 });
    tone(c, o, t + 0.19, 1568, 0.3, 0.02, { type: 'triangle', attack: 0.004 });
  },
  // Orders locked: a low swell rising into a heavy latch.
  endTurn: (c, o, t) => {
    tone(c, o, t, 98, 0.45, 0.05, { type: 'sawtooth', attack: 0.2, cutoff: 600, cutoffEnd: 1800, slideTo: 147 });
    tone(c, o, t, 147, 0.45, 0.035, { type: 'sawtooth', attack: 0.2, cutoff: 600, cutoffEnd: 1800, slideTo: 196 });
    tone(c, o, t + 0.42, 70, 0.2, 0.12, { type: 'sine', attack: 0.002, slideTo: 45 });
    noise(c, o, t + 0.42, 0.06, 0.06, { type: 'bandpass', freq: 1800, q: 1.2 });
  },
  back: (c, o, t) => {
    tone(c, o, t, 990, 0.05, 0.03, { type: 'triangle', attack: 0.002 });
    tone(c, o, t + 0.04, 660, 0.07, 0.03, { type: 'triangle', attack: 0.002 });
  },
  toggle: (c, o, t) => {
    tone(c, o, t, 1200, 0.03, 0.03, { type: 'square', attack: 0.001, cutoff: 3500 });
  },
  error: (c, o, t) => {
    tone(c, o, t, 220, 0.12, 0.04, { type: 'square', attack: 0.003, cutoff: 1200 });
    tone(c, o, t + 0.13, 196, 0.16, 0.04, { type: 'square', attack: 0.003, cutoff: 1200 });
  },
  // A radio net keyed: squelch open, a roger beep, squelch tail.
  radio: (c, o, t) => {
    noise(c, o, t, 0.07, 0.05, { type: 'bandpass', freq: 2200, q: 1.5 });
    tone(c, o, t + 0.07, 1250, 0.07, 0.03, { type: 'sine', attack: 0.002 });
    tone(c, o, t + 0.15, 1650, 0.06, 0.03, { type: 'sine', attack: 0.002 });
    noise(c, o, t + 0.22, 0.12, 0.035, { type: 'bandpass', freq: 1800, freqEnd: 900, q: 1.2 });
  },
  // Into battle: a rising whoosh and a low hit.
  deploy: (c, o, t) => {
    noise(c, o, t, 0.5, 0.06, { type: 'bandpass', freq: 400, freqEnd: 3000, q: 1, attack: 0.35 });
    tone(c, o, t + 0.45, 65, 0.4, 0.14, { type: 'sine', attack: 0.003, slideTo: 38 });
  },
};

/** Seconds within which the same sound is not played again. */
export const UI_GAP: Record<UiSound, number> = {
  tap: 0.04,
  select: 0.05,
  order: 0.08,
  arm: 0.1,
  card: 0.15,
  endTurn: 0.4,
  back: 0.05,
  toggle: 0.04,
  error: 0.2,
  radio: 0.25,
  deploy: 0.6,
};

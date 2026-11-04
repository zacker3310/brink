// The score as data: two pieces, each a stack of layers that come in with intensity. Pure and
// deterministic, so a bar is the same notes every time it comes round and the tests can read it.
//
// Planning (the war map, 72 bpm, D minor): a slow pad on its own when the world is calm; a plucked
// pulse once a war is on; taiko and timpani as cities come under threat; high strings in the last
// turns. The tense half of the range swaps the progression's last two chords for G minor and A
// major, so the harmony leans toward the dominant as it builds.
//
// Battle (the arena, 132 bpm, E phrygian): a drone and low pad from the first moment; drums on
// contact; a driving sixteenth-note bass under heavy fire; brass stabs when the battle is nearly
// decided, over a brighter progression that ends on B major.

import type { Instrument } from './voices';

export type Mode = 'planning' | 'battle';

export interface Layer {
  id: string;
  /** Intensity where the layer starts to come in, and where it is at full level. */
  on: number;
  full: number;
  /** Its level in the mix at full. */
  level: number;
}

export const LAYERS: Record<Mode, readonly Layer[]> = {
  planning: [
    { id: 'pad', on: -1, full: 0, level: 1 },
    { id: 'pulse', on: 0.25, full: 0.5, level: 0.9 },
    { id: 'drums', on: 0.5, full: 0.75, level: 1 },
    { id: 'high', on: 0.7, full: 0.95, level: 0.8 },
  ],
  battle: [
    { id: 'drone', on: -1, full: 0, level: 1 },
    { id: 'perc', on: 0.15, full: 0.35, level: 1 },
    { id: 'bass', on: 0.4, full: 0.6, level: 0.9 },
    { id: 'lead', on: 0.65, full: 0.85, level: 0.8 },
  ],
};

export const BPM: Record<Mode, number> = { planning: 72, battle: 132 };
export const STEPS = 16;

/** Seconds a sixteenth lasts. */
export const stepSeconds = (mode: Mode): number => 60 / BPM[mode] / 4;
export const barSeconds = (mode: Mode): number => stepSeconds(mode) * STEPS;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
export function smoothstep(a: number, b: number, v: number): number {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
}

/** Each layer's gain at an intensity (0..1). */
export function layerGains(mode: Mode, intensity: number): Record<string, number> {
  const out: Record<string, number> = {};
  const v = clamp01(Number.isFinite(intensity) ? intensity : 0);
  for (const l of LAYERS[mode]) out[l.id] = smoothstep(l.on, l.full, v) * l.level;
  return out;
}

export interface Note {
  layer: string;
  inst: Instrument;
  /** Sixteenth in the bar, 0..15. */
  step: number;
  midi: number;
  /** In sixteenths. */
  len: number;
  gain: number;
}

interface Chord {
  root: number;
  minor: boolean;
}

const triad = (c: Chord): [number, number, number] => [c.root, c.root + (c.minor ? 3 : 4), c.root + 7];

// D3 = 50. Two bars a chord: Dm, Bb, F, C; tense: Dm, Bb, Gm, A.
const PLAN_CALM: Chord[] = [
  { root: 50, minor: true },
  { root: 46, minor: false },
  { root: 53, minor: false },
  { root: 48, minor: false },
];
const PLAN_TENSE: Chord[] = [
  { root: 50, minor: true },
  { root: 46, minor: false },
  { root: 55, minor: true },
  { root: 45, minor: false },
];
// E2 = 40. A bar a chord: Em, F, G, F; nearly won: Em, C, D, B.
const BATTLE_DARK: Chord[] = [
  { root: 40, minor: true },
  { root: 41, minor: false },
  { root: 43, minor: false },
  { root: 41, minor: false },
];
const BATTLE_BRIGHT: Chord[] = [
  { root: 40, minor: true },
  { root: 36, minor: false },
  { root: 38, minor: false },
  { root: 35, minor: false },
];

/** The chord a bar is on. */
export function chordOf(mode: Mode, bar: number, intensity: number): Chord {
  if (mode === 'planning') {
    const prog = intensity >= 0.6 ? PLAN_TENSE : PLAN_CALM;
    return prog[Math.floor(bar / 2) % prog.length]!;
  }
  const prog = intensity >= 0.75 ? BATTLE_BRIGHT : BATTLE_DARK;
  return prog[bar % prog.length]!;
}

// The battle bass: semitones over the root, a sixteenth each (-1 rests).
const RIFF = [0, 0, 12, 0, 0, 0, 13, 0, 0, 0, 12, 0, 7, 0, 1, 0];

/** The notes of one bar, for the layers at or above `minGain` (quiet layers cost nothing). */
export function barNotes(mode: Mode, bar: number, intensity: number, gains: Record<string, number>, minGain = 0.02): Note[] {
  const on = (id: string) => (gains[id] ?? 0) >= minGain;
  const c = chordOf(mode, bar, intensity);
  const [r, t, f] = triad(c);
  const out: Note[] = [];
  const add = (layer: string, inst: Instrument, step: number, midi: number, len: number, gain: number) => {
    if (on(layer)) out.push({ layer, inst, step, midi, len, gain });
  };
  if (mode === 'planning') {
    const first = bar % 2 === 0;
    if (first) {
      add('pad', 'pad', 0, r - 12, 32, 0.05);
      add('pad', 'pad', 0, t, 32, 0.035);
      add('pad', 'pad', 0, f, 32, 0.035);
    }
    // The pulse: eighths on the root and fifth, an octave up, the last one reaching for the third.
    for (let s = 0; s < STEPS; s += 2) add('pulse', 'pluck', s, s === 14 ? t + 12 : s % 4 === 0 ? r + 12 : f + 12, 2, s === 0 ? 0.05 : 0.035);
    add('drums', 'taiko', 0, 0, 4, 0.22);
    add('drums', 'taiko', 6, 0, 4, 0.12);
    add('drums', 'taiko', 8, 0, 4, 0.16);
    if (bar % 8 === 7) for (let s = 8; s < STEPS; s++) add('drums', 'timpani', s, 38, 2, 0.05 + 0.01 * (s - 8));
    if (first) {
      add('high', 'strings', 0, f + 12, 16, 0.022);
      add('high', 'strings', 0, t + 24, 16, 0.018);
    } else add('high', 'strings', 8, r + 24, 8, 0.02);
    return out;
  }
  // Battle.
  add('drone', 'pad', 0, r - 12, 16, 0.06);
  add('drone', 'pad', 0, r, 16, 0.03);
  add('drone', 'pad', 0, f, 16, 0.025);
  for (const s of [0, 8, 10]) add('perc', 'kick', s, 0, 2, 0.32);
  for (const s of [4, 12]) add('perc', 'snare', s, 0, 2, 0.12);
  for (let s = 0; s < STEPS; s += 2) add('perc', 'hat', s, 0, 1, s % 4 === 2 ? 0.05 : 0.03);
  if (intensity >= 0.5) add('perc', 'taiko', 14, 0, 2, 0.16);
  for (let s = 0; s < STEPS; s++) {
    const n = RIFF[s]!;
    if (n >= 0) add('bass', 'bass', s, r + n, 1, n === 0 ? 0.07 : 0.06);
  }
  for (const [s, len] of [
    [0, 3],
    [6, 2],
    [10, 4],
  ] as const) {
    add('lead', 'brass', s, r + 24, len, 0.028);
    add('lead', 'brass', s, t + 24, len, 0.024);
    add('lead', 'brass', s, f + 24, len, 0.024);
  }
  return out;
}

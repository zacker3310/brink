// Stingers: short cues over the score for the moments that matter. Data, played by the music
// director (music.ts) on the music bus with the score ducked under them. When several land on one
// turn, the most important plays (`pickStinger`).

import type { Instrument } from './voices';

export type StingerKind =
  | 'turn'
  | 'war'
  | 'captured'
  | 'lost'
  | 'operation'
  | 'promotion'
  | 'battleWon'
  | 'battleLost'
  | 'victory'
  | 'defeat';

/** [seconds from the start, instrument, midi note, seconds long, gain]. */
export type Hit = readonly [number, Instrument, number, number, number];

export interface Stinger {
  /** Higher wins when two arrive together, and is not cut off by a lower one. */
  priority: number;
  /** How far the score dips under it (0..1). */
  duck: number;
  notes: readonly Hit[];
}

const chord = (t: number, inst: Instrument, notes: number[], dur: number, gain: number): Hit[] => notes.map((n) => [t, inst, n, dur, gain] as const);

export const STINGERS: Record<StingerKind, Stinger> = {
  // The turn resolves: a low swell and a timpani stroke, the map's heartbeat.
  turn: {
    priority: 1,
    duck: 0.3,
    notes: [...chord(0, 'brass', [38, 45], 1.1, 0.03), [0, 'timpani', 38, 1, 0.12], [0.36, 'timpani', 45, 0.8, 0.08]],
  },
  // War declared: war drums and a dissonant low brass cluster.
  war: {
    priority: 6,
    duck: 0.7,
    notes: [
      [0, 'hit', 0, 1.2, 0.35],
      [0.25, 'taiko', 0, 0.6, 0.3],
      [0.5, 'taiko', 0, 0.6, 0.3],
      [0.75, 'taiko', 0, 0.6, 0.35],
      ...chord(0, 'brass', [38, 39, 45], 2.2, 0.035),
      ...chord(1, 'brass', [37, 44, 50], 1.8, 0.03),
    ],
  },
  // A city taken: a rising fanfare in D major.
  captured: {
    priority: 4,
    duck: 0.6,
    notes: [
      [0, 'brass', 62, 0.22, 0.04],
      [0.18, 'brass', 66, 0.22, 0.04],
      [0.36, 'brass', 69, 0.6, 0.045],
      ...chord(0.36, 'brass', [50, 57], 1.2, 0.035),
      [0.36, 'timpani', 38, 1, 0.12],
    ],
  },
  // A city lost: a falling minor line over a low hit.
  lost: {
    priority: 5,
    duck: 0.6,
    notes: [
      [0, 'hit', 0, 1, 0.25],
      [0, 'strings', 65, 0.5, 0.03],
      [0.4, 'strings', 62, 0.5, 0.03],
      [0.8, 'strings', 58, 1.4, 0.03],
      ...chord(0.8, 'pad', [34, 46], 1.8, 0.04),
    ],
  },
  // An operation's prize taken: three chords, I - IV - I with a bell on top.
  operation: {
    priority: 5,
    duck: 0.7,
    notes: [
      ...chord(0, 'brass', [50, 57, 62, 66], 0.5, 0.03),
      ...chord(0.45, 'brass', [55, 59, 62, 67], 0.5, 0.03),
      ...chord(0.9, 'brass', [50, 57, 62, 66, 69], 1.6, 0.032),
      [0.9, 'bell', 86, 1.2, 0.05],
      [0.9, 'timpani', 38, 1.2, 0.14],
      [0, 'timpani', 38, 0.4, 0.08],
    ],
  },
  // A general promoted: a bright bell arpeggio.
  promotion: {
    priority: 3,
    duck: 0.4,
    notes: [
      [0, 'bell', 74, 0.9, 0.05],
      [0.1, 'bell', 78, 0.9, 0.05],
      [0.2, 'bell', 81, 0.9, 0.05],
      [0.3, 'bell', 86, 1.4, 0.06],
    ],
  },
  battleWon: {
    priority: 7,
    duck: 0.85,
    notes: [
      [0, 'timpani', 40, 0.8, 0.14],
      ...chord(0, 'brass', [52, 59, 64, 68], 0.35, 0.03),
      ...chord(0.32, 'brass', [54, 61, 66, 70], 0.35, 0.03),
      ...chord(0.64, 'brass', [52, 59, 64, 68, 71], 2, 0.034),
      [0.64, 'hit', 0, 1.2, 0.25],
    ],
  },
  battleLost: {
    priority: 7,
    duck: 0.85,
    notes: [
      [0, 'hit', 0, 1.4, 0.3],
      ...chord(0, 'brass', [40, 47, 52, 55], 1.2, 0.03),
      ...chord(1.1, 'pad', [36, 43, 48, 51], 2.4, 0.04),
    ],
  },
  victory: {
    priority: 9,
    duck: 0.95,
    notes: [
      [0, 'timpani', 38, 0.5, 0.14],
      [0.2, 'timpani', 38, 0.5, 0.14],
      [0, 'brass', 62, 0.2, 0.04],
      [0.2, 'brass', 62, 0.2, 0.04],
      [0.4, 'brass', 69, 0.4, 0.045],
      ...chord(0.8, 'brass', [50, 57, 62, 66, 69], 1, 0.032),
      ...chord(1.6, 'brass', [55, 59, 62, 67, 71], 0.7, 0.032),
      ...chord(2.2, 'brass', [50, 57, 62, 66, 74], 2.6, 0.035),
      [2.2, 'hit', 0, 1.6, 0.3],
      [2.2, 'bell', 86, 2, 0.05],
    ],
  },
  defeat: {
    priority: 9,
    duck: 0.95,
    notes: [
      [0, 'hit', 0, 2, 0.3],
      [0.2, 'strings', 62, 0.9, 0.03],
      [1.0, 'strings', 61, 0.9, 0.03],
      [1.8, 'strings', 58, 0.9, 0.03],
      [2.6, 'strings', 57, 2.2, 0.03],
      ...chord(0, 'pad', [26, 38, 45], 4.6, 0.045),
      [2.6, 'timpani', 33, 2, 0.12],
    ],
  },
};

/** Seconds a stinger rings for. */
export function stingerLength(kind: StingerKind): number {
  return Math.max(...STINGERS[kind].notes.map(([t, , , d]) => t + d));
}

/** The one to play of several arriving together: the highest priority. */
export function pickStinger(kinds: readonly StingerKind[]): StingerKind | null {
  let best: StingerKind | null = null;
  for (const k of kinds) if (!best || STINGERS[k].priority > STINGERS[best].priority) best = k;
  return best;
}

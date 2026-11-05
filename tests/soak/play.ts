import { expect } from 'vitest';
import type { Difficulty, GameEvent, WorldState } from '@brink/contracts';
import { theatreOf } from '@brink/scenarios';
import { GameSession } from '@brink/session';

// The soaks' match loop, one for every theatre: AI-only campaigns from seed 1 up, each played to its
// end with the world checked between every turn by the caller's invariants (`invariants.ts`), and
// a tally of how the wars ended. Each theatre's soak file says how many matches it plays, what it
// expects of the war, and prints its endings line.

/**
 * How many matches a theatre's soak plays: its own variable (the first of `own` that is set: its
 * name, then any older name a lane gave it), else `SOAK_MATCHES` up to `cap`, else `fallback`, the
 * count the theatre's soak has always played by default.
 */
export function matchCount(own: string | readonly string[], fallback: number, cap = Infinity): number {
  for (const name of typeof own === 'string' ? [own] : own) {
    const set = process.env[name];
    if (set !== undefined) return Number(set);
  }
  const all = process.env.SOAK_MATCHES;
  return all === undefined ? fallback : Math.min(cap, Number(all));
}

/** A test's time budget for `matches` matches of about `seconds` each on a busy runner (30 min at least). */
export function budget(matches: number, seconds: number): number {
  return Math.max(1_800_000, matches * seconds * 1000);
}

export interface Tally {
  matches: number;
  endings: Record<string, number>;
  /** Who won each decisive ending (not the turn limit), and who led on score at the limit. */
  decisive: Record<string, number>;
  onScore: Record<string, number>;
  turns: number[];
  rejected: number;
  rejectedBy: Record<string, number>;
  usage: { facilities: number; treaties: number; cards: number; techs: number; grown: number; captured: number };
  generals: { promoted: number; killed: number; topLevel: number };
}

export interface PlayOptions {
  difficulty?: Difficulty;
  blackFiles?: boolean;
  /** Every world between turns: the broken invariants, none when all hold. */
  check: (w: WorldState) => string[];
  /** Called with every turn's events and the world after it. */
  onTurn?: (events: readonly GameEvent[], w: WorldState, seed: number) => void;
  /** Called with the finished match. */
  onEnd?: (w: WorldState, seed: number) => void;
}

/** Play `seeds` of a theatre AI against AI. The test fails on a broken invariant or a match that never ends. */
export function play(theatre: string, seeds: readonly number[], opts: PlayOptions): Tally {
  const limit = theatreOf(theatre)?.maxTurns ?? 30;
  const t: Tally = {
    matches: seeds.length,
    endings: {},
    decisive: {},
    onScore: {},
    turns: [],
    rejected: 0,
    rejectedBy: {},
    usage: { facilities: 0, treaties: 0, cards: 0, techs: 0, grown: 0, captured: 0 },
    generals: { promoted: 0, killed: 0, topLevel: 1 },
  };
  for (const seed of seeds) {
    const s = GameSession.create(theatre, seed, null, [], { ...(opts.difficulty ? { difficulty: opts.difficulty } : {}), ...(opts.blackFiles ? { blackFiles: true } : {}) });
    let guard = 0;
    while (!s.over) {
      const r = s.advance();
      for (const e of r.events) {
        if (e.kind === 'order_rejected') {
          t.rejected += 1;
          t.rejectedBy[`${e.nation}: ${e.reason}`] = (t.rejectedBy[`${e.nation}: ${e.reason}`] ?? 0) + 1;
        } else if (e.kind === 'facility_built') t.usage.facilities += 1;
        else if (e.kind === 'treaty') t.usage.treaties += 1;
        else if (e.kind === 'card_played') t.usage.cards += 1;
        else if (e.kind === 'research') t.usage.techs += 1;
        else if (e.kind === 'city_grew') t.usage.grown += 1;
        else if (e.kind === 'site_captured') t.usage.captured += 1;
        else if (e.kind === 'commander' && e.change === 'level_up') t.generals.promoted += 1;
        else if (e.kind === 'commander' && e.change === 'killed') t.generals.killed += 1;
      }
      const w = s.snapshot();
      expect(opts.check(w), `${theatre} seed ${seed} turn ${s.turn}`).toEqual([]);
      opts.onTurn?.(r.events, w, seed);
      if (++guard > limit + 10) throw new Error(`${theatre} seed ${seed} did not end`);
    }
    const end = s.snapshot();
    for (const c of Object.values(end.commanders ?? {})) t.generals.topLevel = Math.max(t.generals.topLevel, c.level);
    const v = end.victory!;
    if (v.turn > end.maxTurns) throw new Error(`${theatre} seed ${seed} ended on turn ${v.turn}, past its limit ${end.maxTurns}`);
    t.endings[v.reason] = (t.endings[v.reason] ?? 0) + 1;
    const tally = v.reason === 'turn_limit' ? t.onScore : t.decisive;
    tally[v.winner] = (tally[v.winner] ?? 0) + 1;
    t.turns.push(v.turn);
    opts.onEnd?.(end, seed);
  }
  t.turns.sort((a, b) => a - b);
  return t;
}

/** Seeds 1 to `n`. */
export const seeds = (n: number): number[] => Array.from({ length: n }, (_, i) => i + 1);

/** Percent of the matches decided before the turn limit. */
export function decisiveRate(t: Tally): number {
  return t.matches ? Math.round(((t.matches - (t.endings.turn_limit ?? 0)) * 100) / t.matches) : 0;
}

/** The middle turn a match ended on. */
export function medianTurn(t: Tally): number | undefined {
  return t.turns[Math.floor(t.turns.length / 2)];
}

/** The endings line every theatre's soak prints first: how its wars ended and who won them. */
export function endings(label: string, t: Tally): unknown[] {
  return [`${label}endings`, t.endings, 'decisive', `${decisiveRate(t)}%`, 'median turn', medianTurn(t), 'decisive wins', t.decisive, 'turn-limit wins', t.onScore, 'rejected AI orders', t.rejected, ...(t.rejected ? [t.rejectedBy] : [])];
}

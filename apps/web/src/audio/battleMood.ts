// The battle's intensity for the score, read from the arena's own event log as the stage plays it:
// how much shooting there has been lately (heat, which cools over seconds), whether the sides have
// met, and how near the battle is to being decided either way. Pure state plus a clock the caller
// passes in, so the tests can drive it.

import type { Battle, BattleEvent, Side } from '@brink/arena/v2';

/** Seconds for the heat to fall to a third. */
export const COOLING = 8;
/** A side down to this share of its units has the battle nearly decided. */
export const NEAR = 0.4;

export interface Mood {
  sides: Record<string, Side>;
  start: Record<Side, number>;
  lost: Record<Side, number>;
  heat: number;
  /** When the heat was last brought up to date. */
  at: number;
  contact: boolean;
  /** Rounds the attacker (blue) has held the zone. */
  capture: number;
  /** A capture event came since the defender's turn began. */
  held: boolean;
  ended: 'won' | 'lost' | null;
}

export function newMood(units: readonly { id: string; side: Side; alive: boolean }[], now: number): Mood {
  const sides: Record<string, Side> = {};
  const start: Record<Side, number> = { blue: 0, red: 0 };
  const lost: Record<Side, number> = { blue: 0, red: 0 };
  for (const u of units) {
    sides[u.id] = u.side;
    start[u.side]++;
    if (!u.alive) lost[u.side]++;
  }
  return { sides, start, lost, heat: 0, at: now, contact: false, capture: 0, held: false, ended: null };
}

function cool(m: Mood, now: number): void {
  if (now > m.at) m.heat *= Math.exp(-(now - m.at) / COOLING);
  m.at = Math.max(m.at, now);
}

/** Folds a batch of events in. */
export function feedMood(m: Mood, events: readonly BattleEvent[], now: number): void {
  cool(m, now);
  for (const e of events) {
    switch (e.type) {
      case 'fire':
        m.contact = true;
        m.heat += 0.05;
        break;
      case 'impact':
      case 'casualties':
        m.heat += 0.04;
        break;
      case 'boom':
        m.heat += 0.03 + 0.03 * Math.min(3, e.size);
        break;
      case 'spotted':
        m.contact = true;
        break;
      case 'destroyed': {
        m.heat += 0.15;
        const side = m.sides[e.unit];
        if (side) m.lost[side]++;
        break;
      }
      case 'split':
        for (const id of e.into) m.sides[id] = m.sides[e.unit] ?? m.sides[id] ?? 'blue';
        break;
      case 'capture':
        m.capture = e.rounds;
        m.held = true;
        break;
      case 'turn':
        // The round closes after the defender's turn; one closing without a capture event means
        // the zone was let go.
        if (e.side === 'red') m.held = false;
        else if (!m.held) m.capture = 0;
        break;
      default:
        break;
    }
  }
  m.heat = Math.min(1.5, m.heat);
}

/** How decided the battle is, 0..1: one side worn down, or the zone held. */
export function nearness(m: Mood): number {
  const left = (s: Side) => (m.start[s] > 0 ? 1 - m.lost[s] / m.start[s] : 1);
  const worn = Math.max(0, (NEAR + 0.25 - Math.min(left('blue'), left('red'))) / 0.25);
  return Math.min(1, Math.max(worn, m.capture > 0 ? 0.8 + 0.2 * Math.min(1, m.capture - 1) : 0));
}

/** The intensity for the score (0..1). */
export function moodIntensity(m: Mood, now: number): number {
  if (m.ended) return 0.1;
  cool(m, now);
  const base = m.contact ? 0.3 : 0.12;
  const heat = Math.min(0.5, m.heat * 0.45);
  const near = nearness(m);
  return Math.min(1, Math.max(base + heat, near > 0 ? 0.7 + 0.3 * near : 0));
}

/**
 * The arena's hooks. The battle's sound (BattleAudio) begins and ends it with the stage; the stage
 * feeds it each batch of events as it takes them, and says when the film reaches the end (the
 * 'end' event in the log comes seconds before the film shows it).
 */
export interface BattleScoreHooks {
  begin(battle: Battle): void;
  feed(events: readonly BattleEvent[]): void;
  ended(won: boolean): void;
  end(): void;
}

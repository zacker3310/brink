// How tense the war map is, from what the player can see (NationView only), and which stinger a
// resolved turn earns. Pure: the bridge (bridge.ts) feeds the results to the music director.

import type { GameEvent, NationView, TurnReport } from '@brink/contracts';
import { keyDistance } from '@brink/map';
import type { StingerKind } from './stingers';
import { pickStinger } from './stingers';

/** Hexes from one of your sites at which an enemy counts as a threat to it. */
export const THREAT_RANGE = 2;
/** Turns from the end at which the last-turns build starts. */
export const FINAL_TURNS = 5;

const safeDistance = (a: string, b: string): number => {
  try {
    return keyDistance(a, b);
  } catch {
    return Infinity;
  }
};

/** Your sites with an enemy you are at war with in reach, the capital counted twice. */
export function threatenedSites(view: NationView): number {
  const self = view.self.id;
  const foes = new Set(Object.keys(view.relations).filter((n) => view.relations[n] === 'war' && n !== self));
  if (foes.size === 0) return 0;
  const enemies = Object.values(view.contacts)
    .filter((c) => foes.has(c.owner) && c.confirmed)
    .map((c) => c.key);
  if (enemies.length === 0) return 0;
  let n = 0;
  for (const s of Object.values(view.sites)) {
    if (s.owner !== self) continue;
    if (enemies.some((k) => safeDistance(k, s.key) <= THREAT_RANGE)) n += s.kind === 'capital' ? 2 : 1;
  }
  return n;
}

/**
 * The map's tension, 0..1: calm at peace; a war on lifts it to the pulse; cities under threat bring
 * in the drums; the last turns of the campaign (and a war on several fronts) push toward the top.
 */
export function mapTension(view: NationView): number {
  if (view.victory) return 0.2;
  const self = view.self.id;
  const wars = Object.keys(view.relations).filter((n) => n !== self && view.relations[n] === 'war').length;
  let t = 0.1;
  if (wars > 0) t += 0.25 + Math.min(0.1, 0.05 * (wars - 1));
  t += Math.min(0.35, 0.12 * threatenedSites(view));
  const left = view.maxTurns > 0 ? view.maxTurns - view.turn : Infinity;
  if (left <= FINAL_TURNS) t += 0.3 * (1 - Math.max(0, left) / (FINAL_TURNS + 1));
  return Math.min(1, Math.max(0, t));
}

/** The stingers a turn's events earn the player; the turn cue when nothing bigger happened. */
export function turnStingers(self: string, events: readonly GameEvent[]): StingerKind[] {
  const out: StingerKind[] = [];
  for (const e of events) {
    if (e.kind === 'site_captured') {
      if (e.to === self) out.push('captured');
      else if (e.from === self) out.push('lost');
    } else if (e.kind === 'diplomacy') {
      if (e.relation === 'war' && (e.a === self || e.b === self)) out.push('war');
    } else if (e.kind === 'commander') {
      if (e.nation === self && e.change === 'level_up') out.push('promotion');
    }
  }
  return out;
}

/** The one stinger for a new turn's report (victory and defeat are the overlay's, in sfx.ts). */
export function stingerForTurn(view: NationView, report: TurnReport | null): StingerKind | null {
  if (view.victory) return null;
  const kinds = report ? turnStingers(view.self.id, report.events) : [];
  return pickStinger(kinds.length > 0 ? kinds : ['turn']);
}

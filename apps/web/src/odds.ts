import type { Formation, FormationOrder, HexKey, NationView } from '@brink/contracts';
import { UNITS } from '@brink/game-data';
import { previewAssault, previewStrike } from '@brink/simulation';
import { contextualOrder, reachFor } from './planning';

// What a stack would do if you tapped a hex, and how a fight there would likely go: the map shows
// both before you commit, so an attack is never a guess.

export type Odds = 'good' | 'even' | 'bad';

export const ODDS_TEXT: Record<Odds, string> = { good: 'Likely win', even: 'Even fight', bad: 'Likely loss' };
/** The same, short enough to sit under a hex. */
export const ODDS_TAG: Record<Odds, string> = { good: 'WIN', even: 'EVEN', bad: 'RISKY' };

/** The order each unit of `group` would get for a tap on `key`; units that cannot do it are left out. */
export function groupOrders(view: NationView, group: readonly string[], key: HexKey): { orders: Record<string, FormationOrder>; error: string | null } {
  const orders: Record<string, FormationOrder> = {};
  let error: string | null = null;
  for (const id of group) {
    const f = view.formations[id];
    if (!f) continue;
    const res = contextualOrder(view, f, key, 'move', reachFor(view, f), true);
    if ('error' in res) error ??= res.error;
    else orders[id] = res.order;
  }
  return { orders, error };
}

/** The likely result of these units attacking `target`: assault odds for those closing in, a strike for the guns. */
export function oddsFor(view: NationView, attackers: readonly Formation[], target: HexKey): Odds | null {
  const melee = attackers.filter((f) => UNITS[f.unitClass].range === 0);
  if (melee.length > 0) {
    const p = previewAssault(
      view,
      melee.map((f) => f.id),
      target,
    );
    if (!p) return null;
    if (p.defenders === 0) return 'good';
    const win = p.outcomes.includes('attacker_victory');
    const held = p.outcomes.includes('defender_held');
    return win && !held ? 'good' : win || p.share[1] >= 450 ? 'even' : 'bad';
  }
  const ranged = attackers[0];
  if (!ranged) return null;
  const s = previewStrike(view, ranged.id, target);
  if (!s || s.targets === 0) return null;
  return s.loss[0] >= 150 ? 'good' : 'even';
}

/** Expected losses as a share of strength, for the attack card. */
export function lossText(view: NationView, attackers: readonly Formation[], target: HexKey): string | null {
  const melee = attackers.filter((f) => UNITS[f.unitClass].range === 0);
  const pct = (n: number, of: number) => Math.round((n / Math.max(1, of)) * 100);
  if (melee.length > 0) {
    const p = previewAssault(
      view,
      melee.map((f) => f.id),
      target,
    );
    if (!p) return null;
    if (p.defenders === 0) return 'No enemy seen there: you walk in.';
    const ours = melee.reduce((a, f) => a + f.strength, 0);
    return `You lose ~${pct(p.attackerLoss[0], ours)}–${pct(p.attackerLoss[1], ours)}% · they lose ~${pct(p.defenderLoss[0], 1000 * p.defenders)}–${pct(p.defenderLoss[1], 1000 * p.defenders)}%`;
  }
  const gun = attackers[0];
  const st = gun ? previewStrike(view, gun.id, target) : null;
  if (!st) return null;
  return st.targets === 0 ? 'No confirmed target there.' : `A strike from range: each target loses ~${pct(st.loss[0], 1000)}–${pct(st.loss[1], 1000)}%, no risk to you.`;
}

/** What a unit is for, in a line. */
export const ROLE: Record<string, string> = {
  infantry: 'Holds ground. Strongest dug in, in cities, forest and hills.',
  mechanized: 'Infantry in armour: quick, sturdy, good at everything.',
  armor: 'Breaks through. Hits hardest, best on open ground.',
  artillery: 'Fires from 2 hexes away without moving. Weak up close.',
  recon: 'Fast, sees far. Scout ahead, avoid fights.',
  air: 'Attack helicopters: strike far from base, rebase to your cities.',
  drone: 'Cheap eyes and strikes from range. Fragile.',
};

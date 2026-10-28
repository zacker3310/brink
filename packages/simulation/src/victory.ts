import type { NationId, VictoryState, WorldState } from '@brink/contracts';
import { RESOURCES } from '@brink/contracts';
import { VICTORY } from '@brink/game-data';
import { grossYields } from './economy';
import { totalVictoryPoints, victoryPoints, victoryThreshold } from './fog';
import { relationOf, sortedKeys } from './rules';

// Phase 11b. Every way a campaign ends, checked in a fixed order so two paths reached on the same
// turn always resolve the same way: last standing, domination, coalition, supremacy, then the score
// at the turn limit. The limit guarantees every campaign ends.

function living(world: WorldState): NationId[] {
  return sortedKeys(world.nations).filter((n) => !world.nations[n]!.eliminated);
}

function share(part: number, total: number): number {
  return total > 0 ? Math.floor((part * 100) / total) : 0;
}

/**
 * Each living nation's standing toward Supremacy: the average of its percent shares of victory
 * points, army strength and gross output (the four resources plus industry). Public, like the VP count.
 */
export function supremacyStanding(world: WorldState): Record<NationId, number> {
  const alive = living(world);
  const vp = victoryPoints(world);
  const army: Record<NationId, number> = {};
  const output: Record<NationId, number> = {};
  for (const n of alive) {
    army[n] = 0;
    const g = grossYields(world, n);
    output[n] = RESOURCES.reduce((a, r) => a + g.income[r], 0) + g.industry;
  }
  for (const id of sortedKeys(world.formations)) {
    const f = world.formations[id]!;
    if (army[f.owner] !== undefined) army[f.owner]! += f.strength;
  }
  const sum = (m: Record<NationId, number>) => alive.reduce((a, n) => a + m[n]!, 0);
  const [vpTotal, armyTotal, outTotal] = [totalVictoryPoints(world), sum(army), sum(output)];
  const out: Record<NationId, number> = {};
  for (const n of sortedKeys(world.nations)) {
    out[n] = alive.includes(n) ? Math.floor((share(vp[n]!, vpTotal) + share(army[n]!, armyTotal) + share(output[n]!, outTotal)) / 3) : 0;
  }
  return out;
}

/** Every group of two or more living nations in which each pair is allied, sorted. */
export function allianceBlocs(world: WorldState): NationId[][] {
  const alive = living(world);
  const out: NationId[][] = [];
  for (let mask = 1; mask < 1 << alive.length; mask++) {
    const members = alive.filter((_, i) => mask & (1 << i));
    if (members.length < 2) continue;
    if (members.every((a, i) => members.slice(i + 1).every((b) => relationOf(world.relations, a, b) === 'alliance'))) out.push(members);
  }
  return out;
}

/** Percent of all victory points a bloc of this size must hold for a coalition victory. */
export function coalitionShare(members: number): number {
  return Math.min(100, VICTORY.coalitionBase + VICTORY.coalitionPerMember * members);
}

export function evaluateVictory(world: WorldState): VictoryState | null {
  const alive = living(world);
  const turn = world.turn;
  if (alive.length === 1) return { winner: alive[0]!, reason: 'last_standing', turn };
  const vp = victoryPoints(world);
  const total = totalVictoryPoints(world);
  const byVp = (a: NationId, b: NationId) => vp[b]! - vp[a]! || (a < b ? -1 : 1);

  const leaders = alive.filter((n) => vp[n]! >= victoryThreshold(world));
  if (leaders.length === 1) return { winner: leaders[0]!, reason: 'victory_points', turn };

  if (turn >= VICTORY.supremacyFromTurn) {
    const blocs = allianceBlocs(world)
      .map((members) => ({ members, held: members.reduce((a, n) => a + vp[n]!, 0) }))
      .filter((b) => share(b.held, total) >= coalitionShare(b.members.length))
      .sort((x, y) => y.held - x.held || (x.members.join() < y.members.join() ? -1 : 1));
    const bloc = blocs[0];
    if (bloc) return { winner: [...bloc.members].sort(byVp)[0]!, reason: 'coalition', turn, coalition: bloc.members };

    const standing = supremacyStanding(world);
    const supreme = alive.filter((n) => standing[n]! >= VICTORY.supremacyShare && world.nations[n]!.stability >= VICTORY.supremacyStability);
    if (supreme.length === 1) return { winner: supreme[0]!, reason: 'supremacy', turn };
  }

  // Score: at the turn limit the highest strategic standing wins (land, army and output, as for
  // Supremacy), then victory points, then nation id.
  if (turn >= world.maxTurns) {
    const score = supremacyStanding(world);
    const ranked = [...alive].sort((a, b) => score[b]! - score[a]! || vp[b]! - vp[a]! || (a < b ? -1 : 1));
    return { winner: ranked[0]!, reason: 'turn_limit', turn };
  }
  return null;
}

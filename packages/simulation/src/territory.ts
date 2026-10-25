import type { GameEvent, HexKey, NationId, WorldState } from '@brink/contracts';
import { UNITS } from '@brink/game-data';
import { neighborKeys } from '@brink/map';
import { relationOf, sortedKeys } from './rules';

function transfer(world: WorldState, key: HexKey, to: NationId, events: GameEvent[]): void {
  const t = world.tiles[key]!;
  const from = t.owner;
  t.owner = to;
  events.push({ kind: 'territory', key, from, to });
  if (t.siteId) {
    const s = world.sites[t.siteId]!;
    if (s.owner !== to) {
      events.push({ kind: 'site_captured', site: s.id, key, from: s.owner, to });
      s.owner = to;
    }
  }
}

/**
 * Phase 9b. A hex held by one nation's ground formations passes to that nation if its owner
 * is at war with it (or it is unclaimed). Then empty, site-less hexes mostly surrounded by one
 * enemy and not covered by their owner's formations flip as the front consolidates. Both
 * passes are computed from a snapshot and applied together.
 */
export function resolveTerritory(world: WorldState, events: GameEvent[]): void {
  const occupants = new Map<HexKey, Set<NationId>>();
  for (const id of sortedKeys(world.formations)) {
    const f = world.formations[id]!;
    if (!UNITS[f.unitClass].ground) continue;
    occupants.set(f.key, new Set([...(occupants.get(f.key) ?? []), f.owner]));
  }

  const occupy: [HexKey, NationId][] = [];
  for (const key of sortedKeys(world.tiles)) {
    const nations = occupants.get(key);
    if (!nations || nations.size !== 1) continue;
    const n = [...nations][0]!;
    const owner = world.tiles[key]!.owner;
    if (owner === n) continue;
    if (owner === null || relationOf(world.relations, n, owner) === 'war') occupy.push([key, n]);
  }
  for (const [key, n] of occupy) transfer(world, key, n, events);

  const flips: [HexKey, NationId][] = [];
  for (const key of sortedKeys(world.tiles)) {
    const t = world.tiles[key]!;
    if (t.siteId || t.terrain === 'water' || occupants.has(key)) continue;
    const counts = new Map<NationId, number>();
    for (const k of neighborKeys(key)) {
      const o = world.tiles[k]?.owner;
      if (o) counts.set(o, (counts.get(o) ?? 0) + 1);
    }
    for (const [n, c] of [...counts].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      if (c < 4 || n === t.owner) continue;
      if (t.owner !== null && relationOf(world.relations, n, t.owner) !== 'war') continue;
      const covered = t.owner !== null && [key, ...neighborKeys(key)].some((k) => occupants.get(k)?.has(t.owner!));
      if (!covered) flips.push([key, n]);
    }
  }
  for (const [key, n] of flips) transfer(world, key, n, events);
}

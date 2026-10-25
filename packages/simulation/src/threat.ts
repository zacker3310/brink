import type { HexKey, NationView } from '@brink/contracts';
import { UNITS } from '@brink/game-data';
import { neighborKeys, rangeKeys, reachable } from '@brink/map';
import { enterCost, movementAllowance, sortedKeys } from './rules';

/**
 * Where hostile formations the viewer can see could hit next turn, as a count of threats per
 * hex. Ground formations move and then assault one hex further; artillery and air strike their
 * radius from where they stand (strikes resolve before movement). Built from the viewer's own
 * NationView, so it reveals nothing fog hides: stale contacts (older than a turn) are ignored and
 * movement is costed over terrain the viewer knows, at full readiness (the worst case).
 */
export function threatZones(view: NationView, only?: ReadonlySet<string>): Map<HexKey, number> {
  const out = new Map<HexKey, number>();
  for (const id of sortedKeys(view.contacts)) {
    if (only && !only.has(id)) continue;
    const c = view.contacts[id]!;
    if (view.relations[c.owner] !== 'war' || view.turn - c.lastSeen > 1) continue;
    const def = UNITS[c.unitClass];
    const hit = new Set<HexKey>();
    if (def.range > 0) {
      for (const k of rangeKeys(c.key, def.range)) if (k !== c.key && view.tiles[k]) hit.add(k);
    } else if (def.ground && def.movement > 0) {
      const mp = movementAllowance({ unitClass: c.unitClass, readiness: 100, fuel: 100 });
      const reach = reachable(c.key, mp, (_from, to) => enterCost(view.tiles[to], c.unitClass));
      for (const k of Object.keys(reach)) {
        hit.add(k);
        for (const n of neighborKeys(k)) if (view.tiles[n]) hit.add(n);
      }
    }
    for (const k of hit) out.set(k, (out.get(k) ?? 0) + 1);
  }
  return out;
}

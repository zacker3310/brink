import type { Contact, Formation, FormationOrder, HexKey, NationView } from '@brink/contracts';
import { AIR_REBASE_RANGE, UNITS } from '@brink/game-data';
import { areAdjacent, keyDistance, neighborKeys, pathFromReach, reachable, type Reach } from '@brink/map';
import { enterCost, movementAllowance } from '@brink/simulation';

export type Mode = 'move' | 'attack' | 'recon' | 'withdraw';

export function hostilesAt(view: NationView, key: HexKey): Contact[] {
  return Object.values(view.contacts).filter((c) => c.key === key && view.relations[c.owner] === 'war');
}

/** Hexes the formation can reach this turn over terrain its nation knows, avoiding known enemies. */
export function reachFor(view: NationView, f: Formation): Record<HexKey, Reach> {
  if (!UNITS[f.unitClass].ground) return { [f.key]: { cost: 0, prev: null } };
  const blocked = new Set(Object.values(view.contacts).filter((c) => c.confirmed && view.relations[c.owner] === 'war').map((c) => c.key));
  return reachable(f.key, movementAllowance(f), (_from, to) => (blocked.has(to) ? null : enterCost(view.tiles[to], f.unitClass)));
}

export interface Planned {
  order: FormationOrder;
  label: string;
}

/** The order a click on `key` means for formation `f` in `mode`, or a reason it means nothing. */
export function orderForClick(view: NationView, f: Formation, key: HexKey, mode: Mode, reach: Record<HexKey, Reach>): Planned | { error: string } {
  const def = UNITS[f.unitClass];
  const hostile = hostilesAt(view, key).length > 0;

  if (def.range > 0 && (hostile || mode === 'attack')) {
    const d = keyDistance(f.key, key);
    if (d < 1 || d > def.range) return { error: `Target is out of range (${def.range} hexes)` };
    if (f.ammunition < def.ammoPerAttack) return { error: 'Not enough ammunition to strike' };
    return { order: { type: 'attack', target: key, path: [] }, label: `Strike ${key}` };
  }

  if (!def.ground) {
    const site = view.tiles[key]?.siteId ? view.sites[view.tiles[key]!.siteId!] : undefined;
    if (!site || site.owner !== view.self.id) return { error: 'Air wings rebase only to your own cities and depots' };
    if (keyDistance(f.key, key) > AIR_REBASE_RANGE) return { error: `Rebase range is ${AIR_REBASE_RANGE} hexes` };
    return { order: { type: 'move', path: [key] }, label: `Rebase to ${site.name}` };
  }

  if (hostile || mode === 'attack') {
    if (f.ammunition < def.ammoPerAttack) return { error: 'Not enough ammunition to attack' };
    if (enterCost(view.tiles[key], f.unitClass) === null) return { error: 'Cannot assault impassable terrain' };
    if (areAdjacent(f.key, key)) return { order: { type: 'attack', target: key, path: [] }, label: `Assault ${key}` };
    const approach = neighborKeys(key)
      .filter((k) => reach[k] && k !== key)
      .sort((a, b) => reach[a]!.cost - reach[b]!.cost || (a < b ? -1 : 1))[0];
    if (!approach) return { error: 'No approach to that hex within movement range' };
    return { order: { type: 'attack', target: key, path: pathFromReach(reach, approach) ?? [] }, label: `Advance and assault ${key}` };
  }

  if (key === f.key) return { error: 'Already here' };
  if (!reach[key]) return { error: view.tiles[key]?.terrain == null ? 'Unknown terrain: scout it first' : 'Out of movement range this turn' };
  const path = pathFromReach(reach, key) ?? [];
  const label = mode === 'recon' ? `Recon to ${key}` : mode === 'withdraw' ? `Withdraw to ${key}` : `Move to ${key}`;
  return { order: { type: mode, path }, label };
}

export function describeOrder(order: FormationOrder | undefined): string {
  if (!order) return 'Hold (default)';
  switch (order.type) {
    case 'hold':
      return 'Hold';
    case 'defend':
      return 'Defend and dig in';
    case 'move':
      return `Move ${order.path.length} hex${order.path.length === 1 ? '' : 'es'}`;
    case 'recon':
      return `Recon ${order.path.length} hex${order.path.length === 1 ? '' : 'es'}`;
    case 'withdraw':
      return `Withdraw ${order.path.length} hex${order.path.length === 1 ? '' : 'es'}`;
    case 'attack':
      return order.path.length > 0 ? `Advance ${order.path.length}, assault ${order.target}` : `Attack ${order.target}`;
  }
}

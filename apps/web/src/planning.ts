import type { Contact, Formation, FormationOrder, HexKey, NationView } from '@brink/contracts';
import { AIR_REBASE_RANGE, UNITS } from '@brink/game-data';
import { areAdjacent, findPath, keyDistance, neighborKeys, pathFromReach, reachable, type Reach } from '@brink/map';
import { alongside, enterCost, isAir, isNaval, movementAllowance } from '@brink/simulation';
import { hexLabel } from './insight';

export type Mode = 'move' | 'attack' | 'recon' | 'withdraw';

export function hostilesAt(view: NationView, key: HexKey): Contact[] {
  return Object.values(view.contacts).filter((c) => c.key === key && view.relations[c.owner] === 'war');
}

/**
 * Hexes the formation can reach this turn over terrain its nation knows, avoiding known enemies.
 * Ships sail the sea and put in at ports; troops aboard a ship reach the shore beside it and beyond.
 */
export function reachFor(view: NationView, f: Formation): Record<HexKey, Reach> {
  if (isAir(f.unitClass)) return { [f.key]: { cost: 0, prev: null } };
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

  if (isAir(f.unitClass)) {
    const site = view.tiles[key]?.siteId ? view.sites[view.tiles[key]!.siteId!] : undefined;
    const deck = Object.values(view.formations).find((c) => c.key === key && UNITS[c.unitClass].carries === 'air' && c.id !== f.aboard && passengers(view, c.id) < (UNITS[c.unitClass].capacity ?? 0));
    if (keyDistance(f.key, key) > AIR_REBASE_RANGE) return { error: `Rebase range is ${AIR_REBASE_RANGE} hexes` };
    if (deck) return { order: { type: 'move', path: [key] }, label: `Land on ${deck.name}` };
    if (!site || site.owner !== view.self.id) return { error: 'Air wings rebase only to your own cities, depots and carriers' };
    return { order: { type: 'move', path: [key] }, label: `Rebase to ${site.name}` };
  }

  if (isNaval(f.unitClass) && (hostile || mode === 'attack')) return { error: `${def.name} does not fight: a fleet does` };

  if (hostile || mode === 'attack') {
    if (f.ammunition < def.ammoPerAttack) return { error: 'Not enough ammunition to attack' };
    if (f.aboard && !areAdjacent(f.key, key)) return { error: 'From a ship, storm a beach next to it' };
    if (enterCost(view.tiles[key], f.unitClass) === null) return { error: 'Cannot assault impassable terrain' };
    if (areAdjacent(f.key, key)) return { order: { type: 'attack', target: key, path: [] }, label: `Assault ${key}` };
    const approach = neighborKeys(key)
      .filter((k) => reach[k] && k !== key)
      .sort((a, b) => reach[a]!.cost - reach[b]!.cost || (a < b ? -1 : 1))[0];
    if (!approach) return { error: 'No approach to that hex within movement range' };
    return { order: { type: 'attack', target: key, path: pathFromReach(reach, approach) ?? [] }, label: `Advance and assault ${key}` };
  }

  if (key === f.key) return { error: 'Already here' };
  if (!reach[key]) {
    if (view.tiles[key]?.terrain == null) return { error: 'Unknown terrain: scout it first' };
    // Land troops tapping a shore they cannot walk to: the sea is in the way.
    if (UNITS[f.unitClass].ground && !f.aboard && enterCost(view.tiles[key], f.unitClass) !== null && !findPath(f.key, key, (_a, b) => enterCost(view.tiles[b], f.unitClass))) {
      return { error: 'Across the sea: board a transport in a port, then sail it there' };
    }
    return { error: 'Out of movement range this turn' };
  }
  const path = pathFromReach(reach, key) ?? [];
  const label = mode === 'recon' ? `Recon to ${key}` : mode === 'withdraw' ? `Withdraw to ${key}` : `Move to ${key}`;
  return { order: { type: mode, path }, label };
}

/** Plain-language order text; with a view, targets are named by place instead of coordinates. */
export function describeOrder(order: FormationOrder | undefined, view?: NationView): string {
  const place = (k: HexKey) => (view ? hexLabel(view, k) : k);
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
      return order.path.length > 0 ? `Advance ${order.path.length}, assault ${place(order.target)}` : `Attack ${place(order.target)}`;
    case 'embark':
      return `Board ${view?.formations[order.carrier]?.name ?? 'ship'}`;
  }
}

function passengers(view: NationView, carrier: string): number {
  return Object.values(view.formations).filter((p) => p.aboard === carrier).length;
}

/**
 * Own ships `f` can board now, with room for it: in its hex, or lying off the port it stands in.
 * Ground formations board transports, aircraft carriers.
 */
export function shipsAlongside(view: NationView, f: Formation): Formation[] {
  if (f.aboard || isNaval(f.unitClass)) return [];
  const kind = UNITS[f.unitClass].ground ? 'ground' : 'air';
  return Object.values(view.formations)
    .filter((c) => UNITS[c.unitClass].carries === kind && alongside(view, f, c) && passengers(view, c.id) < (UNITS[c.unitClass].capacity ?? 0))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

/** Board orders for a group: each formation takes the first ship with room, until they are full. */
export function boardOrders(view: NationView, group: Formation[]): Record<string, FormationOrder> {
  const room = new Map<string, number>();
  const out: Record<string, FormationOrder> = {};
  for (const f of group) {
    const ship = shipsAlongside(view, f).find((c) => {
      const left = room.get(c.id) ?? (UNITS[c.unitClass].capacity ?? 0) - passengers(view, c.id);
      return left > 0;
    });
    if (!ship) continue;
    room.set(ship.id, (room.get(ship.id) ?? (UNITS[ship.unitClass].capacity ?? 0) - passengers(view, ship.id)) - 1);
    out[f.id] = { type: 'embark', carrier: ship.id };
  }
  return out;
}

/** The order a right-click, a tap (or a click in the current mode) on `key` means for `f`. */
export function contextualOrder(view: NationView, f: Formation, key: HexKey, mode: Mode, reach: Record<HexKey, Reach>, rightClick: boolean): Planned | { error: string } {
  const m: Mode = hostilesAt(view, key).length > 0 ? 'attack' : rightClick && mode === 'attack' ? 'move' : mode;
  return orderForClick(view, f, key, m, reach);
}

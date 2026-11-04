import type { CardId, CardPlay, HexKey, NationView } from '@brink/contracts';
import type { Operation } from '@brink/ai';
import { CARDS } from '@brink/game-data';
import { findPath, keyDistance, neighborKeys } from '@brink/map';
import { checkTarget, enterCost, sortedKeys } from '@brink/simulation';

// Where the map should point: the place the running operation's current phase happens (the port
// the army gathers at, the beach it lands on, the prize it storms), and the hexes an armed doctrine
// card may be aimed at. Both read only the player's own picture.

export interface Spot {
  key: HexKey;
  /** A word or two for the map tag: EMBARK, LAND HERE, ASSAULT. */
  label: string;
}

/** The port the operation sails from: the one it builds the lift at, else the own port its phase names. */
function portOf(view: NationView, op: Operation, detail: string): HexKey | null {
  if (op.needs) return view.sites[op.needs.siteId]?.key ?? null;
  const ports = sortedKeys(view.sites)
    .map((id) => view.sites[id]!)
    .filter((s) => s.owner === view.self.id && view.tiles[s.key]?.port);
  return (ports.find((s) => detail.includes(s.name)) ?? null)?.key ?? null;
}

/** The beach: open shore nearest the prize that troops can walk from to the prize. */
function beachOf(view: NationView, at: HexKey): HexKey | null {
  const walk = (_a: HexKey, b: HexKey) => enterCost(view.tiles[b], 'infantry');
  const shore = sortedKeys(view.tiles)
    .filter((k) => keyDistance(k, at) <= 5 && enterCost(view.tiles[k], 'infantry') !== null && neighborKeys(k).some((n) => view.tiles[n]?.terrain === 'water'))
    .sort((a, b) => keyDistance(a, at) - keyDistance(b, at) || (a < b ? -1 : 1));
  return shore.find((k) => k === at || findPath(k, at, walk, { maxCost: 30 }) !== null) ?? null;
}

/** Where the operation's current phase takes place, or null when the prize itself is the place. */
export function operationSpot(view: NationView, op: Operation): Spot | null {
  const now = op.phases.find((p) => p.state === 'now');
  if (!now) return null;
  switch (now.id) {
    case 'lift':
    case 'assemble':
    case 'embark': {
      const key = portOf(view, op, now.detail);
      return key ? { key, label: now.id === 'lift' ? 'BUILD LIFT' : now.id === 'assemble' ? 'ASSEMBLE' : 'EMBARK' } : null;
    }
    case 'sail':
    case 'land': {
      const key = beachOf(view, op.at);
      return key && key !== op.at ? { key, label: 'LAND HERE' } : null;
    }
    default:
      return null;
  }
}

/**
 * The hexes an armed card can be aimed at that are worth pointing out: every legal hex of your own
 * for a card played on your ground; for the rest, legal hexes someone else holds or an enemy stands in.
 */
export function cardTargets(view: NationView, card: CardId): HexKey[] {
  const def = CARDS[card];
  if (!def || (def.target !== 'own-hex' && def.target !== 'enemy-hex' && def.target !== 'hex')) return [];
  const me = view.self.id;
  const contacts = new Set(Object.values(view.contacts).map((c) => c.key));
  return sortedKeys(view.tiles).filter((k) => {
    const t = view.tiles[k]!;
    if (def.target !== 'own-hex' && !((t.owner && t.owner !== me) || contacts.has(k))) return false;
    const play: CardPlay = { card, target: k };
    return checkTarget(view, me, play) === null;
  });
}

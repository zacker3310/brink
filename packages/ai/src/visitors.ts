import type { Contact, Formation, FormationId, FormationOrder, HexKey, NationOrders, NationView, SiteView } from '@brink/contracts';
import { STACK_LIMIT, UNITS } from '@brink/game-data';
import { areAdjacent, findPath, keyDistance, neighborKeys } from '@brink/map';
import { enterCost, movementAllowance, sortedKeys } from '@brink/simulation';

// The Visitors' planner (Black Files). They do not talk, trade or research; they grow out of their
// incursions and take ground. Each incursion keeps a shield over itself; everything else goes for
// the nearest place a power holds, storming what it can beat and walking past what it cannot.
// Like every planner it sees only its own NationView, and every order it writes is one the engine
// accepts: paths over ground it knows, within the formation's allowance, attacks on a land hex next
// to where the formation stands.

/** A hex is stormed when what is seen in it is at most this many times the attackers (percent). */
const STORM_ODDS = 220;

/** Sites a power holds, as last seen: the Visitors' prizes. */
function prizes(view: NationView): SiteView[] {
  const self = view.self.id;
  return sortedKeys(view.sites)
    .map((id) => view.sites[id]!)
    .filter((s) => s.owner !== self && view.tiles[s.key]?.terrain != null && view.tiles[s.key]!.terrain !== 'water');
}

function contactsByHex(view: NationView): Map<HexKey, Contact[]> {
  const out = new Map<HexKey, Contact[]>();
  for (const id of sortedKeys(view.contacts)) {
    const c = view.contacts[id]!;
    if (c.owner === view.self.id || view.turn - c.lastSeen > 1) continue;
    out.set(c.key, [...(out.get(c.key) ?? []), c]);
  }
  return out;
}

/** A path toward `goal` cut to this turn's allowance; it never enters a hex where a contact stands, nor ends in a full stack. */
function pathToward(view: NationView, f: Formation, goal: HexKey, blocked: Map<HexKey, Contact[]>, ends: Map<HexKey, number>): HexKey[] {
  const res = findPath(f.key, goal, (_from, to) => (blocked.has(to) ? null : enterCost(view.tiles[to], f.unitClass)));
  if (!res) return [];
  const allowance = movementAllowance(f);
  const out: HexKey[] = [];
  let cost = 0;
  for (const k of res.path) {
    const c = enterCost(view.tiles[k], f.unitClass);
    if (c === null || cost + c > allowance) break;
    cost += c;
    out.push(k);
  }
  while (out.length > 0 && (ends.get(out.at(-1)!) ?? 0) >= STACK_LIMIT) out.pop();
  return out;
}

export function planVisitors(view: NationView): NationOrders {
  const self = view.self.id;
  const own = sortedKeys(view.formations)
    .map((id) => view.formations[id]!)
    .filter((f) => UNITS[f.unitClass].ground);
  const orders: Record<FormationId, FormationOrder> = {};
  const seen = contactsByHex(view);
  const ends = new Map<HexKey, number>();
  for (const f of own) ends.set(f.key, (ends.get(f.key) ?? 0) + 1);
  const move = (f: Formation, path: HexKey[]) => {
    orders[f.id] = { type: 'move', path };
    ends.set(f.key, (ends.get(f.key) ?? 1) - 1);
    ends.set(path.at(-1)!, (ends.get(path.at(-1)!) ?? 0) + 1);
  };

  // Every incursion keeps its shield: an emitter (or, lacking one, its first defender) stays put.
  const incursions = sortedKeys(view.sites)
    .map((id) => view.sites[id]!)
    .filter((s) => s.owner === self);
  const keep = new Set<FormationId>();
  for (const s of incursions) {
    const here = own.filter((f) => f.key === s.key);
    const guard = here.find((f) => f.unitClass === 'emitter') ?? here[0];
    if (guard) keep.add(guard.id);
  }
  for (const f of own) if (keep.has(f.id) || f.unitClass === 'emitter') orders[f.id] = { type: 'defend' };

  const strength = (k: HexKey) => (seen.get(k) ?? []).reduce((a, c) => a + c.estimatedStrength, 0);
  const free = own.filter((f) => !orders[f.id]);

  // Storms: every land hex next to a free formation with someone in it, the weakest first; the
  // formations next to it go in together when the odds are good enough.
  const targets = [...seen.keys()]
    .filter((k) => enterCost(view.tiles[k], 'walker') !== null && free.some((f) => areAdjacent(f.key, k)))
    .sort((a, b) => strength(a) - strength(b) || (a < b ? -1 : 1));
  for (const k of targets) {
    const group = free.filter((f) => !orders[f.id] && areAdjacent(f.key, k));
    const mass = group.reduce((a, f) => a + f.strength, 0);
    if (group.length === 0 || strength(k) * 100 > mass * STORM_ODDS) continue;
    for (const f of group) orders[f.id] = { type: 'attack', target: k, path: [] };
  }

  // The rest march on the nearest prize a power holds: walk in where it is empty and next to them.
  const goals = prizes(view);
  for (const f of free) {
    if (orders[f.id]) continue;
    const goal = [...goals].sort((a, b) => keyDistance(f.key, a.key) - keyDistance(f.key, b.key) || (a.id < b.id ? -1 : 1))[0];
    if (!goal) {
      orders[f.id] = { type: 'defend' };
      continue;
    }
    if (areAdjacent(f.key, goal.key) && !seen.has(goal.key) && enterCost(view.tiles[goal.key], f.unitClass) !== null && (ends.get(goal.key) ?? 0) < STACK_LIMIT) {
      move(f, [goal.key]);
      continue;
    }
    const path = pathToward(view, f, goal.key, seen, ends);
    if (path.length > 0) move(f, path);
    else {
      // Boxed in: step to any open neighbour toward the prize, or hold.
      const step = neighborKeys(f.key)
        .filter((k) => !seen.has(k) && enterCost(view.tiles[k], f.unitClass) !== null && enterCost(view.tiles[k], f.unitClass)! <= movementAllowance(f) && (ends.get(k) ?? 0) < STACK_LIMIT)
        .sort((a, b) => keyDistance(a, goal.key) - keyDistance(b, goal.key) || (a < b ? -1 : 1))[0];
      if (step && keyDistance(step, goal.key) < keyDistance(f.key, goal.key)) move(f, [step]);
      else orders[f.id] = { type: 'defend' };
    }
  }
  return { nation: self, turn: view.turn, formations: orders, recruit: [], diplomacy: [] };
}

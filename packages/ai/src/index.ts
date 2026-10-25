import type {
  AiMemory,
  Budget,
  Contact,
  Formation,
  FormationId,
  FormationOrder,
  GameEvent,
  HexKey,
  NationId,
  NationOrders,
  NationView,
  RecruitOrder,
  SiteView,
  TechId,
  UnitClass,
} from '@brink/contracts';
import { RESOURCES, UNIT_CLASSES } from '@brink/contracts';
import { AIR_REBASE_RANGE, STACK_LIMIT, TECHS, UNITS } from '@brink/game-data';
import { areAdjacent, findPath, keyDistance, neighborKeys } from '@brink/map';
import { enterCost, movementAllowance, previewAssault, recruitCost, roll, sortedKeys } from '@brink/simulation';

// A deterministic utility AI. It sees only its own NationView and its own memory, and every
// order it writes goes through the same validator as a human's. Two layers:
//   strategic: where the threats are, which objective to take, what to build and research
//   tactical:  one order per formation that serves the strategic plan

export function emptyMemory(): AiMemory {
  return {
    enemySightings: { infantry: 0, mechanized: 0, armor: 0, artillery: 0, recon: 0, air: 0 },
    pressure: {},
    aggressors: {},
  };
}

interface Plan {
  enemies: Set<NationId>;
  /** Hostile contacts recent enough to act on. */
  contacts: Contact[];
  threats: Map<string, number>;
  target: SiteView | null;
  /** Hexes this nation's formations are planned to end the turn in, with counts. */
  ends: Map<HexKey, number>;
}

const isHostile = (view: NationView, owner: NationId) => view.relations[owner] === 'war';

function recentContacts(view: NationView): Contact[] {
  return Object.values(view.contacts)
    .filter((c) => isHostile(view, c.owner) && view.turn - c.lastSeen <= 2)
    .sort((a, b) => (a.formation < b.formation ? -1 : 1));
}

function threatsTo(view: NationView, contacts: Contact[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const id of sortedKeys(view.sites)) {
    const s = view.sites[id]!;
    if (s.owner !== view.self.id) continue;
    const t = contacts
      .filter((c) => UNITS[c.unitClass].ground && keyDistance(c.key, s.key) <= 3)
      .reduce((a, c) => a + c.estimatedStrength, 0);
    if (t > 0) out.set(id, t);
  }
  return out;
}

function chooseTarget(view: NationView, memory: AiMemory, contacts: Contact[], own: Formation[]): SiteView | null {
  if (own.length === 0) return null;
  const centroid = (k: HexKey) => own.reduce((a, f) => a + keyDistance(f.key, k), 0) / own.length;
  let best: SiteView | null = null;
  let bestScore = -Infinity;
  for (const id of sortedKeys(view.sites)) {
    const s = view.sites[id]!;
    if (s.owner === view.self.id) continue;
    if (s.owner !== null && !isHostile(view, s.owner)) continue;
    const guard = contacts.filter((c) => keyDistance(c.key, s.key) <= 1).reduce((a, c) => a + c.estimatedStrength, 0);
    const grudge = s.owner && memory.aggressors[s.owner] !== undefined ? 3 : 0;
    const weak = s.owner && view.nations[s.owner] ? -view.nations[s.owner]!.victoryPoints / 10 : 0;
    const score = (s.victoryPoints + grudge) * 10 - centroid(s.key) * 6 - guard / 100 + weak;
    if (score > bestScore || (score === bestScore && best && s.id < best.id)) {
      best = s;
      bestScore = score;
    }
  }
  return best;
}

/** A path for `f` toward `goal` over terrain this nation has seen, cut to this turn's allowance. */
function pathToward(view: NationView, f: Formation, goal: HexKey, plan: Plan, avoid: ReadonlySet<HexKey>): HexKey[] {
  const known = (k: HexKey) => view.tiles[k]?.terrain != null;
  let dest = goal;
  if (!known(goal) || avoid.has(goal)) {
    // Head for the closest hex we know.
    let bestD = Infinity;
    for (const k of sortedKeys(view.tiles)) {
      if (!known(k) || avoid.has(k) || enterCost(view.tiles[k], f.unitClass) === null) continue;
      const d = keyDistance(k, goal) * 100 + keyDistance(k, f.key);
      if (d < bestD) {
        bestD = d;
        dest = k;
      }
    }
  }
  if (dest === f.key) return [];
  const res = findPath(f.key, dest, (_from, to) => (avoid.has(to) ? null : enterCost(view.tiles[to], f.unitClass)));
  if (!res) return [];
  const allowance = movementAllowance(f);
  const out: HexKey[] = [];
  let cost = 0;
  for (const k of res.path) {
    const c = enterCost(view.tiles[k], f.unitClass)!;
    if (cost + c > allowance) break;
    cost += c;
    out.push(k);
  }
  // Do not end in an overfull hex: back off until there is room.
  while (out.length > 0 && (plan.ends.get(out.at(-1)!) ?? 0) >= STACK_LIMIT) out.pop();
  return out;
}

function endAt(plan: Plan, from: HexKey, to: HexKey): void {
  plan.ends.set(from, (plan.ends.get(from) ?? 1) - 1);
  plan.ends.set(to, (plan.ends.get(to) ?? 0) + 1);
}

function nearestOwnSite(view: NationView, key: HexKey, kinds: readonly SiteView['kind'][]): SiteView | null {
  let best: SiteView | null = null;
  for (const id of sortedKeys(view.sites)) {
    const s = view.sites[id]!;
    if (s.owner !== view.self.id || !kinds.includes(s.kind)) continue;
    if (!best || keyDistance(s.key, key) < keyDistance(best.key, key)) best = s;
  }
  return best;
}

const RESEARCH_PREFERENCE: TechId[] = [
  'logistics_doctrine',
  'industrial_automation',
  'combined_arms',
  'signals_intelligence',
  'composite_armor',
  'precision_munitions',
];

function chooseResearch(view: NationView): TechId | null | undefined {
  const r = view.self.research;
  if (r.current) return undefined;
  for (const t of RESEARCH_PREFERENCE) {
    const def = TECHS[t];
    if (!def || r.unlocked.includes(t)) continue;
    if (def.requires.every((p) => r.unlocked.includes(p))) return t;
  }
  return undefined;
}

/** What to build next, from the force mix and what the enemy fields. */
function wantedClass(memory: AiMemory, own: Formation[], queued: UnitClass[]): UnitClass {
  const have = new Map<UnitClass, number>();
  for (const c of UNIT_CLASSES) have.set(c, 0);
  for (const f of own) have.set(f.unitClass, have.get(f.unitClass)! + 1);
  for (const c of queued) have.set(c, have.get(c)! + 1);
  const seen = memory.enemySightings;
  const hard = seen.armor + seen.mechanized;
  const soft = seen.infantry + seen.artillery + seen.recon;
  const target: Record<UnitClass, number> = {
    infantry: 30,
    mechanized: 15,
    armor: hard > soft ? 25 : 15,
    artillery: soft >= hard ? 18 : 10,
    recon: 7,
    air: hard > soft ? 15 : 8,
  };
  const total = [...have.values()].reduce((a, v) => a + v, 0) + 1;
  let best: UnitClass = 'infantry';
  let gap = -Infinity;
  for (const c of UNIT_CLASSES) {
    const g = target[c] - (have.get(c)! * 100) / total;
    if (g > gap) {
      gap = g;
      best = c;
    }
  }
  return best;
}

function planRecruitment(view: NationView, memory: AiMemory, own: Formation[]): RecruitOrder[] {
  const out: RecruitOrder[] = [];
  const left = { ...view.self.stockpile };
  // Keep a reserve for upkeep and logistics.
  const reserve = { credits: 40, energy: 25, materials: 30, food: 25 };
  const queued = view.self.productionQueue.map((p) => p.unitClass);
  // Do not queue faster than industry can build.
  const backlog = view.self.productionQueue.reduce((a, p) => a + p.required - p.progress, 0);
  if (backlog > view.self.industrialCapacity * 2) return out;
  const sites = sortedKeys(view.sites)
    .map((id) => view.sites[id]!)
    .filter((s) => s.owner === view.self.id && (s.kind === 'capital' || s.kind === 'city'));
  for (const s of sites) {
    const c = wantedClass(memory, own, queued);
    const cost = recruitCost(view.self, c);
    if (RESOURCES.some((r) => left[r] - cost[r] < reserve[r])) continue;
    for (const r of RESOURCES) left[r] -= cost[r];
    queued.push(c);
    out.push({ siteId: s.id, unitClass: c });
    if (out.length >= 2) break;
  }
  return out;
}

function planBudget(view: NationView): Budget | undefined {
  const b = view.self.budget;
  if (view.self.stability < 45 && b.welfare < 20) return { ...b, welfare: 20 };
  if (view.self.stability > 70 && b.welfare > 5) return { ...b, welfare: 5 };
  return undefined;
}

export function updateMemory(memory: AiMemory, view: NationView, events: readonly GameEvent[]): AiMemory {
  const m: AiMemory = JSON.parse(JSON.stringify(memory)) as AiMemory;
  for (const c of UNIT_CLASSES) m.enemySightings[c] = Math.floor((m.enemySightings[c] * 3) / 4);
  for (const c of recentContacts(view)) if (c.confirmed) m.enemySightings[c.unitClass] += 1;
  for (const [site] of threatsTo(view, recentContacts(view))) m.pressure[site] = view.turn;
  for (const e of events) {
    if (e.kind === 'engagement') {
      const hitUs = e.participants.some((p) => p.owner === view.self.id && p.role === 'defender');
      if (hitUs) for (const p of e.participants) if (p.role === 'attacker') m.aggressors[p.owner] = view.turn;
    }
    if (e.kind === 'strike' && e.victims.some((v) => v.owner === view.self.id)) m.aggressors[e.owner] = view.turn;
  }
  return m;
}

/**
 * Orders for one nation's turn. Deterministic in (view, memory, seed). The returned orders are
 * legal against the authoritative world by construction: every path runs over terrain the
 * nation has seen, within the formation's allowance.
 */
export function planOrders(view: NationView, memory: AiMemory, seed: number): NationOrders {
  const self = view.self.id;
  const own = sortedKeys(view.formations).map((id) => view.formations[id]!);
  const contacts = recentContacts(view);
  const plan: Plan = {
    enemies: new Set(Object.keys(view.relations).filter((n) => isHostile(view, n) && !view.nations[n]!.eliminated)),
    contacts,
    threats: threatsTo(view, contacts),
    target: chooseTarget(view, memory, contacts, own),
    ends: new Map(),
  };
  for (const f of own) plan.ends.set(f.key, (plan.ends.get(f.key) ?? 0) + 1);
  const hostileHexes = new Set(contacts.filter((c) => c.confirmed || view.turn - c.lastSeen <= 1).map((c) => c.key));
  const orders: Record<FormationId, FormationOrder> = {};
  const committed = new Set<FormationId>();

  // Ranged: strike the most valuable contact in range.
  for (const f of own) {
    const def = UNITS[f.unitClass];
    if (def.range === 0) continue;
    const inRange = contacts
      .filter((c) => keyDistance(c.key, f.key) >= 1 && keyDistance(c.key, f.key) <= def.range && c.confirmed)
      .sort((a, b) => b.estimatedStrength - a.estimatedStrength || (a.formation < b.formation ? -1 : 1));
    if (inRange[0] && f.ammunition >= def.ammoPerAttack) {
      orders[f.id] = { type: 'attack', target: inRange[0].key, path: [] };
      committed.add(f.id);
    }
  }

  // Withdraw what is spent.
  for (const f of own) {
    if (committed.has(f.id) || !UNITS[f.unitClass].ground) continue;
    if (f.strength >= 350 && f.organization >= 20) continue;
    const home = nearestOwnSite(view, f.key, ['capital', 'city', 'depot']);
    if (!home) continue;
    if (home.key === f.key) {
      orders[f.id] = { type: 'defend' };
    } else {
      const path = pathToward(view, f, home.key, plan, hostileHexes);
      if (path.length > 0) {
        orders[f.id] = { type: 'withdraw', path };
        endAt(plan, f.key, path.at(-1)!);
      }
    }
    committed.add(f.id);
  }

  // Defend threatened sites, most threatened first.
  const threatened = [...plan.threats.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  for (const [siteId, threat] of threatened) {
    const site = view.sites[siteId]!;
    let assigned = own.filter((f) => committed.has(f.id) && f.key === site.key).reduce((a, f) => a + f.strength, 0);
    const pool = own
      .filter((f) => !committed.has(f.id) && UNITS[f.unitClass].ground && f.unitClass !== 'recon')
      .sort((a, b) => keyDistance(a.key, site.key) - keyDistance(b.key, site.key) || (a.id < b.id ? -1 : 1));
    for (const f of pool) {
      if (assigned >= threat || keyDistance(f.key, site.key) > 4) break;
      if (f.key === site.key) orders[f.id] = { type: 'defend' };
      else {
        const path = pathToward(view, f, site.key, plan, hostileHexes);
        if (path.length === 0) continue;
        orders[f.id] = { type: 'move', path };
        endAt(plan, f.key, path.at(-1)!);
      }
      committed.add(f.id);
      assigned += f.strength;
    }
  }

  // Attack adjacent enemies where the local odds are good.
  const byHex = new Map<HexKey, Contact[]>();
  for (const c of contacts) if (c.confirmed) byHex.set(c.key, [...(byHex.get(c.key) ?? []), c]);
  for (const key of [...byHex.keys()].sort()) {
    const adjacent = own.filter(
      (f) => !committed.has(f.id) && UNITS[f.unitClass].ground && UNITS[f.unitClass].range === 0 && areAdjacent(f.key, key) && f.ammunition >= UNITS[f.unitClass].ammoPerAttack,
    );
    if (adjacent.length === 0 || enterCost(view.tiles[key], adjacent[0]!.unitClass) === null) continue;
    const preview = previewAssault(view, adjacent.map((f) => f.id), key);
    if (!preview) continue;
    const mid = Math.floor((preview.share[0] + preview.share[1]) / 2);
    if (mid < 520) continue;
    for (const f of adjacent) {
      orders[f.id] = { type: 'attack', target: key, path: [] };
      committed.add(f.id);
    }
  }

  // Everyone else advances on the objective; recon scouts ahead of them.
  const goal = plan.target?.key ?? null;
  for (const f of own) {
    if (committed.has(f.id)) continue;
    if (!UNITS[f.unitClass].ground) {
      // Air: rebase to the own site nearest the objective, if that is closer than here.
      if (goal) {
        const sites = sortedKeys(view.sites)
          .map((id) => view.sites[id]!)
          .filter((s) => s.owner === self && keyDistance(s.key, f.key) <= AIR_REBASE_RANGE)
          .sort((a, b) => keyDistance(a.key, goal) - keyDistance(b.key, goal) || (a.key < b.key ? -1 : 1));
        const best = sites[0];
        if (best && best.key !== f.key && keyDistance(best.key, goal) + 1 < keyDistance(f.key, goal)) {
          orders[f.id] = { type: 'move', path: [best.key] };
        }
      }
      continue;
    }
    if (!goal) continue;
    // Spread the advance a little so formations do not all queue on one road.
    const jitter = roll(seed, view.turn, self, f.id) % 3;
    const aim = jitter === 0 ? goal : (neighborKeys(goal).filter((k) => view.tiles[k]?.terrain != null).sort()[jitter - 1] ?? goal);
    const path = pathToward(view, f, aim, plan, hostileHexes);
    if (path.length === 0) {
      orders[f.id] = { type: f.unitClass === 'artillery' ? 'hold' : 'defend' };
      continue;
    }
    const end = path.at(-1)!;
    // If the approach ends next to an enemy we can beat, make it an assault.
    const near = [...byHex.keys()].filter((k) => areAdjacent(k, end)).sort()[0];
    if (near && f.unitClass !== 'artillery' && f.unitClass !== 'recon' && f.ammunition >= UNITS[f.unitClass].ammoPerAttack) {
      const preview = previewAssault(view, [f.id], near);
      if (preview && preview.share[0] >= 500 && enterCost(view.tiles[near], f.unitClass) !== null) {
        orders[f.id] = { type: 'attack', target: near, path };
        endAt(plan, f.key, end);
        continue;
      }
    }
    orders[f.id] = { type: f.unitClass === 'recon' ? 'recon' : 'move', path };
    endAt(plan, f.key, end);
  }

  // Diplomacy: take peace with a nation that is not the current objective's owner when
  // fighting on more than one front.
  const diplomacy: NationOrders['diplomacy'] = [];
  const focus = plan.target?.owner ?? null;
  if (plan.enemies.size > 1) {
    for (const p of view.proposals) {
      if (p.to === self && p.kind === 'peace' && p.from !== focus && isHostile(view, p.from)) {
        diplomacy.push({ target: p.from, action: 'propose_peace' });
        break;
      }
    }
  }

  const research = chooseResearch(view);
  const budget = planBudget(view);
  const out: NationOrders = {
    nation: self,
    turn: view.turn,
    formations: orders,
    recruit: planRecruitment(view, memory, own),
    diplomacy,
  };
  if (research !== undefined) out.research = research;
  if (budget) out.budget = budget;
  return out;
}

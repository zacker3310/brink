import type {
  AiMemory,
  BuildOrder,
  Budget,
  Contact,
  FacilityId,
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
  Stockpile,
  TechId,
  UnitClass,
} from '@brink/contracts';
import { RESOURCES, UNIT_CLASSES } from '@brink/contracts';
import { AIR_REBASE_RANGE, EVENTS, FACILITIES, FACILITY_SLOTS, STACK_LIMIT, TECHS, UNITS, type EventEffect } from '@brink/game-data';
import { areAdjacent, findPath, keyDistance, neighborKeys, pathFromReach, reachable } from '@brink/map';
import { enterCost, movementAllowance, previewAssault, recruitCost, roll, sortedKeys, treatyIn } from '@brink/simulation';

// A deterministic utility AI. It sees only its own NationView and its own memory, and every
// order it writes goes through the same validator as a human's. Two layers:
//   strategic: where the threats are, which objective to take, what to build and research
//   tactical:  one order per formation that serves the strategic plan

export function emptyMemory(): AiMemory {
  return {
    enemySightings: { infantry: 0, mechanized: 0, armor: 0, artillery: 0, recon: 0, air: 0, drone: 0 },
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
    air: hard > soft ? 12 : 7,
    drone: hard > soft ? 12 : 8,
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

function planRecruitment(view: NationView, memory: AiMemory, own: Formation[], committed?: Stockpile): RecruitOrder[] {
  const out: RecruitOrder[] = [];
  const left = { ...view.self.stockpile };
  if (committed) for (const r of RESOURCES) left[r] -= committed[r];
  // Keep a reserve for upkeep and logistics.
  const reserve = { credits: 40, energy: 25, materials: 30, food: 25 };
  const queued = view.self.productionQueue.map((p) => p.unitClass);
  // Do not queue faster than industry can build.
  const backlog = view.self.productionQueue.reduce((a, p) => a + p.required - p.progress, 0);
  if (backlog > view.self.industrialCapacity * 3) return out;
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
    if (out.length >= 3) break;
  }
  return out;
}

/**
 * Agreements: trade with anyone it is not fighting (money for nothing), and a non-aggression pact
 * with stronger peace partners it has no plan to attack, to keep a second front shut. It answers
 * offers on the same terms. Its war target and anyone it is about to fight are left alone.
 */
function planTreaties(view: NationView, plan: Plan, war: NationOrders['diplomacy'], spare: readonly NationId[]): NationOrders['diplomacy'] {
  const self = view.self.id;
  const out: NationOrders['diplomacy'] = [];
  const vp = (n: NationId) => view.nations[n]!.victoryPoints;
  const busy = new Set(war.map((d) => d.target));
  const focus = plan.target?.owner ?? null;
  const running = (kind: 'trade' | 'nonaggression', n: NationId) => {
    const t = treatyIn(view.treaties, kind, self, n, view.turn);
    return !!t && t.until > view.turn;
  };
  const offered = (kind: string, n: NationId) => view.proposals.some((p) => p.from === self && p.to === n && p.kind === kind);
  const asked = (kind: string, n: NationId) => view.proposals.some((p) => p.from === n && p.to === self && p.kind === kind);
  for (const n of sortedKeys(view.nations)) {
    if (n === self || view.nations[n]!.eliminated || busy.has(n)) continue;
    const rel = view.relations[n];
    if (rel === 'war') continue;
    const embargoed = !!treatyIn(view.treaties, 'embargo', self, n, view.turn);
    if (!embargoed && !running('trade', n) && (asked('trade', n) || !offered('trade', n))) {
      out.push({ target: n, action: 'propose_trade' });
      continue;
    }
    const wantPact = spare.includes(n) || (n !== focus && vp(n) >= vp(self));
    if (rel === 'peace' && wantPact && !running('nonaggression', n) && (asked('nonaggression', n) || !offered('nonaggression', n))) {
      out.push({ target: n, action: 'propose_nonaggression' });
    }
  }
  return out;
}

/** Which facility fixes the scarcest resource; then growth (factory, lab); a fortress where it is pressed. */
function wantedFacility(view: NationView, memory: AiMemory, site: SiteView): FacilityId | null {
  const s = view.self.stockpile;
  const unlocked = view.self.research.unlocked;
  const building = view.self.construction.filter((c) => c.siteId === site.id).map((c) => c.facility);
  const can = (f: FacilityId) => !site.facilities.includes(f) && !building.includes(f) && (!FACILITIES[f].requires || unlocked.includes(FACILITIES[f].requires!));
  const pressed = view.turn - (memory.pressure[site.id] ?? -99) <= 2;
  const wants: FacilityId[] = [];
  if (pressed && site.kind === 'capital') wants.push('fortress');
  const scarce = (['food', 'materials', 'energy'] as const).filter((r) => s[r] < 120).sort((a, b) => s[a] - s[b]);
  const fix: Record<string, FacilityId> = { food: 'farm', materials: 'mine', energy: 'power_plant' };
  for (const r of scarce) wants.push(fix[r]!);
  wants.push('factory', 'research_lab', 'mine', 'power_plant', 'farm');
  return wants.find(can) ?? null;
}

/** One building at a time, keeping a reserve for upkeep and the next recruit. */
function planBuilds(view: NationView, memory: AiMemory): BuildOrder[] {
  if (view.self.construction.length > 0) return [];
  // Paced: two to start, one more every four turns. A war is won by armies; buildings pay off slowly.
  const standing = sortedKeys(view.sites).reduce((a, id) => a + (view.sites[id]!.owner === view.self.id ? view.sites[id]!.facilities.length : 0), 0);
  if (standing >= 2 + Math.floor(view.turn / 4)) return [];
  const left = { ...view.self.stockpile };
  const reserve = { credits: 60, energy: 25, materials: 30, food: 25 };
  const sites = sortedKeys(view.sites)
    .map((id) => view.sites[id]!)
    .filter((s) => s.owner === view.self.id)
    .sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind] || (a.id < b.id ? -1 : 1));
  for (const site of sites) {
    const building = view.self.construction.filter((c) => c.siteId === site.id).length;
    if (site.facilities.length + building >= FACILITY_SLOTS[site.kind]) continue;
    const f = wantedFacility(view, memory, site);
    if (!f) continue;
    const cost = FACILITIES[f].cost;
    if (RESOURCES.some((r) => left[r] - cost[r] < reserve[r])) return [];
    return [{ siteId: site.id, facility: f }];
  }
  return [];
}

const KIND_RANK: Record<SiteView['kind'], number> = { capital: 0, city: 1, depot: 2, objective: 3 };

function planBudget(view: NationView): Budget | undefined {
  const b = view.self.budget;
  if (view.self.stability < 45 && b.welfare < 20) return { ...b, welfare: 20 };
  if (view.self.stability > 70 && b.welfare > 5) return { ...b, welfare: 5 };
  // Idle cash buys technology: combat techs compound over a long war.
  if (view.self.stockpile.credits > 300 && b.research < 30 && b.research + b.infrastructure + b.welfare + 10 <= 60) return { ...b, research: b.research + 10 };
  return undefined;
}

/** Rough worth of an event option: resources at face value, stability dearer when it is low. */
function effectValue(view: NationView, e: EventEffect): number {
  const cash = RESOURCES.reduce((a, r) => a + Math.max(e.stockpile?.[r] ?? 0, -view.self.stockpile[r]), 0);
  const stability = (e.stability ?? 0) * (view.self.stability < 50 ? 15 : 8);
  return cash + Math.floor((e.research ?? 0) * 1.5) + stability + (e.morale ?? 0) * 6;
}

function chooseEvent(view: NationView): 0 | 1 | undefined {
  const pending = view.self.event;
  if (!pending) return undefined;
  const [a, b] = EVENTS[pending.id].options;
  return effectValue(view, b.effect) > effectValue(view, a.effect) ? 1 : 0;
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
    // Capturing ground, or starting a new war, restarts the clock on a stalled war.
    if (e.kind === 'site_captured' && e.to === view.self.id) m.lastGain = view.turn;
    if (e.kind === 'diplomacy' && e.relation === 'war' && (e.a === view.self.id || e.b === view.self.id)) m.lastGain = view.turn;
  }
  return m;
}

/**
 * Diplomacy, Diplomacy-style: never fight on two fronts if a deal can close one, and never let a
 * deal outlive its usefulness. Settles the most dangerous enemy that is not the current target,
 * accepts peace from any non-target, and once down to one war (from turn 10) turns on the weakest
 * peace partner if it has fallen well behind. A nation at peace with everyone picks a fight.
 */
/** Turns without a capture after which a war counts as stalled. */
const STALL_TURNS = 8;

function planDiplomacy(view: NationView, plan: Plan, memory: AiMemory, spare: readonly NationId[]): NationOrders['diplomacy'] {
  const self = view.self.id;
  const out: NationOrders['diplomacy'] = [];
  // Spared nations (humans on easy) are never attacked by choice, and their peace is always welcome.
  for (const p of view.proposals) {
    if (p.to === self && p.kind === 'peace' && spare.includes(p.from) && view.relations[p.from] === 'war') out.push({ target: p.from, action: 'propose_peace' });
  }
  const may = (n: NationId) => !spare.includes(n);
  const focus = plan.target?.owner ?? null;
  const alive = sortedKeys(view.nations).filter((n) => n !== self && !view.nations[n]!.eliminated);
  const vp = (n: NationId) => view.nations[n]!.victoryPoints;
  const enemies = alive.filter((n) => view.relations[n] === 'war');
  const partners = alive.filter((n) => view.relations[n] === 'peace');
  // A stalled war is a war to get out of: settle with the enemy we are stuck on and turn on the
  // weakest power instead.
  if (view.turn >= 10 && view.turn - (memory.lastGain ?? 0) >= STALL_TURNS && enemies.length > 0) {
    const facing = new Map<NationId, number>();
    for (const c of plan.contacts) facing.set(c.owner, (facing.get(c.owner) ?? 0) + c.estimatedStrength);
    const stuck = [...enemies].sort((a, b) => (facing.get(b) ?? 0) - (facing.get(a) ?? 0) || vp(b) - vp(a) || (a < b ? -1 : 1))[0]!;
    out.push({ target: stuck, action: 'propose_peace' });
    const prey = alive.filter((n) => n !== stuck).sort((a, b) => vp(a) - vp(b) || (a < b ? -1 : 1))[0];
    if (prey && may(prey) && view.relations[prey] === 'peace' && vp(prey) <= (view.nations[self]?.victoryPoints ?? 0)) out.push({ target: prey, action: 'declare_war' });
    return out;
  }
  if (enemies.length > 1) {
    const settle = enemies.filter((n) => n !== focus).sort((a, b) => vp(b) - vp(a) || (a < b ? -1 : 1))[0];
    if (settle) out.push({ target: settle, action: 'propose_peace' });
    for (const p of view.proposals) {
      if (p.to === self && p.kind === 'peace' && p.from !== focus && view.relations[p.from] === 'war' && !out.some((d) => d.target === p.from && d.action === 'propose_peace')) {
        out.push({ target: p.from, action: 'propose_peace' });
      }
    }
  }
  const weakest = [...partners].filter(may).sort((a, b) => vp(a) - vp(b) || (a < b ? -1 : 1))[0];
  const weakestAlive = [...alive].sort((a, b) => vp(a) - vp(b) || (a < b ? -1 : 1))[0];
  if (weakest && (enemies.length === 0 || (enemies.length === 1 && view.turn >= 10 && weakest === weakestAlive && vp(weakest) + 6 <= (view.nations[self]?.victoryPoints ?? 0)))) {
    out.push({ target: weakest, action: 'declare_war' });
  }
  return out;
}

/**
 * Orders for one nation's turn. Deterministic in (view, memory, seed). The returned orders are
 * legal against the authoritative world by construction: every path runs over terrain the
 * nation has seen, within the formation's allowance.
 */
export function planOrders(view: NationView, memory: AiMemory, seed: number, opts: { spare?: readonly NationId[] } = {}): NationOrders {
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

  // Combined assaults. For every confirmed enemy hex, most valuable first, gather the free
  // formations that can reach it this turn and judge them together; artillery and air in range
  // strike the same hex first, so they lower the bar the mass has to clear.
  const byHex = new Map<HexKey, Contact[]>();
  for (const c of contacts) if (c.confirmed) byHex.set(c.key, [...(byHex.get(c.key) ?? []), c]);
  const siteVp = (k: HexKey) => {
    const id = view.tiles[k]?.siteId;
    return id ? (view.sites[id]?.victoryPoints ?? 0) : 0;
  };
  const held = (k: HexKey) => byHex.get(k)!.reduce((a, c) => a + c.estimatedStrength, 0);
  const targets = [...byHex.keys()].sort((a, b) => siteVp(b) * 1000 - held(b) - (siteVp(a) * 1000 - held(a)) || (a < b ? -1 : 1));
  for (const key of targets) {
    if (enterCost(view.tiles[key], 'infantry') === null) continue;
    const ends = new Map(plan.ends);
    const group: { f: Formation; path: HexKey[] }[] = [];
    const pool = own
      .filter(
        (f) =>
          !committed.has(f.id) &&
          UNITS[f.unitClass].ground &&
          UNITS[f.unitClass].range === 0 &&
          f.unitClass !== 'recon' &&
          f.strength >= 350 &&
          f.ammunition >= UNITS[f.unitClass].ammoPerAttack,
      )
      .sort((a, b) => keyDistance(a.key, key) - keyDistance(b.key, key) || (a.id < b.id ? -1 : 1));
    for (const f of pool) {
      if (group.length >= 4) break;
      if (areAdjacent(f.key, key)) {
        group.push({ f, path: [] });
        continue;
      }
      if (keyDistance(f.key, key) > 6) continue;
      const reach = reachable(f.key, movementAllowance(f), (_from, to) => (hostileHexes.has(to) ? null : enterCost(view.tiles[to], f.unitClass)));
      const approach = neighborKeys(key)
        .filter((k) => reach[k] && !hostileHexes.has(k) && (ends.get(k) ?? 0) < STACK_LIMIT)
        .sort((x, y) => reach[x]!.cost - reach[y]!.cost || (x < y ? -1 : 1))[0];
      if (!approach) continue;
      const path = pathFromReach(reach, approach) ?? [];
      if (path.length === 0) continue;
      ends.set(f.key, (ends.get(f.key) ?? 1) - 1);
      ends.set(approach, (ends.get(approach) ?? 0) + 1);
      group.push({ f, path });
    }
    if (group.length === 0) continue;
    const preview = previewAssault(view, group.map((g) => g.f.id), key);
    if (!preview || preview.defenders === 0) continue;
    const support = own.filter(
      (f) =>
        !committed.has(f.id) &&
        UNITS[f.unitClass].range > 0 &&
        f.ammunition >= UNITS[f.unitClass].ammoPerAttack &&
        keyDistance(f.key, key) >= 1 &&
        keyDistance(f.key, key) <= UNITS[f.unitClass].range,
    );
    const bar = 520 - (support.some((f) => f.unitClass === 'artillery') ? 40 : 0) - (support.some((f) => !UNITS[f.unitClass].ground) ? 50 : 0);
    if (Math.floor((preview.share[0] + preview.share[1]) / 2) < bar) continue;
    for (const { f, path } of group) {
      orders[f.id] = { type: 'attack', target: key, path };
      committed.add(f.id);
    }
    for (const f of support) {
      orders[f.id] = { type: 'attack', target: key, path: [] };
      committed.add(f.id);
    }
    plan.ends.clear();
    for (const [k, n] of ends) plan.ends.set(k, n);
  }

  // Ranged: strike the most valuable contact in range.
  for (const f of own) {
    const def = UNITS[f.unitClass];
    if (def.range === 0 || committed.has(f.id)) continue;
    const inRange = contacts
      .filter((c) => keyDistance(c.key, f.key) >= 1 && keyDistance(c.key, f.key) <= def.range && c.confirmed)
      .sort((a, b) => b.estimatedStrength - a.estimatedStrength || (a.formation < b.formation ? -1 : 1));
    if (inRange[0] && f.ammunition >= def.ammoPerAttack) {
      orders[f.id] = { type: 'attack', target: inRange[0].key, path: [] };
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

  // One diplomatic order per target: the engine refuses a second. War on a pact partner is
  // refused too, so the pact is honoured here rather than bounced by the validator.
  const war = planDiplomacy(view, plan, memory, opts.spare ?? []).filter((d) => d.action !== 'declare_war' || !treatyIn(view.treaties, 'nonaggression', self, d.target, view.turn));
  const diplomacy = [...war, ...planTreaties(view, plan, war, opts.spare ?? [])].filter((d, i, all) => all.findIndex((x) => x.target === d.target) === i);
  // Build first (one project at a time), then recruit from what is left.
  const build = planBuilds(view, memory);
  const recruit = planRecruitment(view, memory, own, build.length ? FACILITIES[build[0]!.facility].cost : undefined);

  const research = chooseResearch(view);
  const budget = planBudget(view);
  const out: NationOrders = {
    nation: self,
    turn: view.turn,
    formations: orders,
    recruit,
    diplomacy,
  };
  if (build.length) out.build = build;
  if (research !== undefined) out.research = research;
  if (budget) out.budget = budget;
  const eventChoice = chooseEvent(view);
  if (eventChoice !== undefined) out.eventChoice = eventChoice;
  return out;
}

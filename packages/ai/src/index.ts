import type {
  AiMemory,
  CommanderOrders,
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
  SiteId,
  SiteView,
  Stockpile,
  UnitClass,
} from '@brink/contracts';
import { RESOURCES, UNIT_CLASSES } from '@brink/contracts';
import { AIR_REBASE_RANGE, EVENTS, FACILITIES, PERKS, STACK_LIMIT, UNITS, type CommanderEffect, type EventEffect } from '@brink/game-data';
import { areAdjacent, findPath, keyDistance, neighborKeys, pathFromReach, reachable } from '@brink/map';
import { enterCost, isNaval, movementAllowance, previewAssault, recruitCost, roll, sortedKeys, treatyIn } from '@brink/simulation';

import { planCards } from './doctrine';
import { landmasses } from './land';
import { chooseResearch, planCityBuilds } from './research';
import { jointOpTarget, leaderDiplomacy, type Offer } from './diplomacy-ai';
import { fundAirlifts, holdTheGates, planAirborne } from './airborne';
import { seekPassage } from './passage';

export { planCards } from './doctrine';
export * from './diplomacy-ai';
export { proposeOperations, operationById, ODDS_WORDS, type Operation, type OperationPhase } from './operations';
export { airbornePlan, type AirbornePlan } from './airborne';
export { considerPassage, passageWanted } from './passage';

// A deterministic utility AI. It sees only its own NationView and its own memory, and every
// order it writes goes through the same validator as a human's. Two layers:
//   strategic: where the threats are, which objective to take, what to build and research
//   tactical:  one order per formation that serves the strategic plan

export function emptyMemory(): AiMemory {
  return {
    enemySightings: { infantry: 0, mechanized: 0, armor: 0, artillery: 0, recon: 0, air: 0, drone: 0, fleet: 0, transport: 0, carrier: 0 },
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
  /** Hexes this nation's formations are planned to end the turn in, with counts (land and air). */
  ends: Map<HexKey, number>;
  /** The same for ships: a harbour holds its garrison and its ships, each to the limit. */
  seaEnds: Map<HexKey, number>;
}

const isHostile = (view: NationView, owner: NationId) => view.relations[owner] === 'war';

function recentContacts(view: NationView): Contact[] {
  return Object.values(view.contacts)
    .filter((c) => isHostile(view, c.owner) && view.turn - c.lastSeen <= 2)
    .sort((a, b) => (a.formation < b.formation ? -1 : 1));
}

function threatsTo(view: NationView, contacts: Contact[]): Map<string, number> {
  const out = new Map<string, number>();
  const land = landmasses(view);
  for (const id of sortedKeys(view.sites)) {
    const s = view.sites[id]!;
    if (s.owner !== view.self.id) continue;
    // A minor state's militia never leaves its own ground: it is a prize to take, not a threat to
    // guard against. Counting it pinned whole armies to the border cities next to Canada or Korea.
    // An army across the water is no threat until it has ships: troops in Korea do not march on
    // Fukuoka (they pinned Japan's whole army to its coast). A landing is one before it lands: an
    // enemy amphibious group off the coast counts as the troops it can carry.
    const t = contacts
      .filter((c) => keyDistance(c.key, s.key) <= 3 && !view.nations[c.owner]?.minor)
      .reduce((a, c) => a + (UNITS[c.unitClass].ground ? (land.get(c.key) === land.get(s.key) ? c.estimatedStrength : 0) : UNITS[c.unitClass].carries === 'ground' ? (UNITS[c.unitClass].capacity ?? 0) * 1000 : 0), 0);
    if (t > 0) out.set(id, t);
  }
  return out;
}

/** Each hex of march off a target's worth: near prizes first, a foothold before the deep strike. */
const DISTANCE_WEIGHT = 6;

/** A prize within this many hexes of one of our ports is a short hop, as good as a walk. */
const STRAIT = 2;

/** Hexes a fleet goes out of its way to catch an enemy amphibious group. */
const HUNT_RANGE = 6;

/** A city is stormed by this many formations at once, or not at all. */
const STORM_TOGETHER = 2;

/** Formations thrown at one hex in a combined assault: two hexes' worth, not one. */
const ASSAULT_GROUP = 8;

/** A walk is cheaper than a landing: what the army can reach on foot scores this much higher. */
const OVERLAND_BONUS = 40;

/**
 * Strength seen guarding a prize (0..1000 a formation) per point of its score: a full formation in
 * the way costs as much as four hexes of march. (At 100 a capital held by two divisions still drew
 * the army off a city held by none.)
 */
const GUARD_WEIGHT = 40;

/** The garrison assumed in a great power's site out of sight, 0..1000 a formation. */
const UNSEEN_GARRISON: Partial<Record<SiteView['kind'], number>> = { capital: 2000, city: 1000 };

/** What the objective already marched on is worth over a fresh one: about ten hexes of march. */
const STICKY_OBJECTIVE = 60;

/** Turns since this nation last captured a site or started a war. */
function stalled(view: NationView, memory: AiMemory): number {
  return view.turn - (memory.lastGain ?? 0);
}

function chooseTarget(view: NationView, memory: AiMemory, contacts: Contact[], own: Formation[]): SiteView | null {
  if (own.length === 0) return null;
  const centroid = (k: HexKey) => own.reduce((a, f) => a + keyDistance(f.key, k), 0) / own.length;
  // The landmass most of the army stands on.
  const land = landmasses(view);
  const count = new Map<number, number>();
  for (const f of own) {
    const l = UNITS[f.unitClass].ground && !f.aboard ? land.get(f.key) : undefined;
    if (l !== undefined) count.set(l, (count.get(l) ?? 0) + 1);
  }
  const home = [...count.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0];
  const ports = sortedKeys(view.sites)
    .map((id) => view.sites[id]!)
    .filter((p) => p.owner === view.self.id && view.tiles[p.key]?.port)
    .map((p) => p.key);
  let best: SiteView | null = null;
  let bestScore = -Infinity;
  for (const id of sortedKeys(view.sites)) {
    const s = view.sites[id]!;
    if (s.owner === view.self.id) continue;
    if (s.owner !== null && !isHostile(view, s.owner)) continue;
    // What guards it: the enemies seen in and around it, or, for a great power's city out of sight,
    // the garrison such a city has. (Unseen, a capital looked unguarded, and armies sailed for Tokyo
    // and Beijing past cities they could take.)
    const seen = contacts.filter((c) => keyDistance(c.key, s.key) <= 1).reduce((a, c) => a + c.estimatedStrength, 0);
    const prior = view.tiles[s.key]?.visibility !== 'visible' && s.owner && !view.nations[s.owner]?.minor ? (UNSEEN_GARRISON[s.kind] ?? 0) : 0;
    const guard = Math.max(seen, prior);
    const grudge = s.owner && memory.aggressors[s.owner] !== undefined ? 3 : 0;
    const weak = s.owner && view.nations[s.owner] ? -view.nations[s.owner]!.victoryPoints / 10 : 0;
    // A strait is as good as a road: a prize a short hop from one of our ports is shuttled to as
    // fast as it is walked to (Busan from Fukuoka, Taipei from Fuzhou), so an island power looks
    // across its strait before it looks across an ocean.
    const overland = home !== undefined && land.get(s.key) === home;
    const walk = overland || ports.some((k) => keyDistance(k, s.key) <= STRAIT) ? OVERLAND_BONUS : 0;
    // An expedition under way (troops aboard, or ashore near it) holds to its prize until the war
    // stalls: turning a convoy round mid-sea throws away the voyage (Japan's sailed for Taipei,
    // then Honolulu, then Beijing, and landed nowhere for long).
    const expedition = !overland && own.some((f) => UNITS[f.unitClass].ground && (!!f.aboard || (land.get(f.key) === land.get(s.key) && keyDistance(f.key, s.key) <= 4)));
    // The prize already marched on keeps the army, unless the war there has stood still too long.
    // The hold fades as the war stands still: a prize not taken in a few turns is let go before
    // the whole war counts as stalled (a staff that sat eight turns off Tokyo took nothing).
    const since = stalled(view, memory);
    const kept = s.id !== memory.objective ? 0 : expedition ? (since < STALL_TURNS ? STICKY_OBJECTIVE : 0) : Math.floor((STICKY_OBJECTIVE * Math.max(0, STALL_TURNS - since)) / STALL_TURNS);
    const score = (s.victoryPoints + grudge) * 10 - centroid(s.key) * DISTANCE_WEIGHT - guard / GUARD_WEIGHT + weak + walk + kept;
    if (score > bestScore || (score === bestScore && best && s.id < best.id)) {
      best = s;
      bestScore = score;
    }
  }
  return best;
}

/** The player's chosen objective (an operation), when it is still a prize: not ours, not a friend's, and known. */
function forcedTarget(view: NationView, id: SiteId | undefined): SiteView | null {
  const s = id ? view.sites[id] : undefined;
  if (!s || s.owner === view.self.id) return null;
  if (s.owner !== null && !isHostile(view, s.owner)) return null;
  return s;
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
  // Ships put in only at ports of their own side: someone else's port stops them dead.
  const naval = isNaval(f.unitClass);
  const self = view.self.id;
  const shut = (k: HexKey) => {
    if (!naval || view.tiles[k]?.terrain === 'water') return false;
    const owner = view.tiles[k]?.owner;
    return !owner || (owner !== self && view.relations[owner] !== 'alliance');
  };
  const res = findPath(f.key, dest, (_from, to) => (avoid.has(to) || (shut(to) && to !== dest) ? null : enterCost(view.tiles[to], f.unitClass)));
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
  const layer = isNaval(f.unitClass) ? plan.seaEnds : plan.ends;
  while (out.length > 0 && (layer.get(out.at(-1)!) ?? 0) >= STACK_LIMIT) out.pop();
  return out;
}

function endAt(plan: Plan, from: HexKey, to: HexKey, naval = false): void {
  const layer = naval ? plan.seaEnds : plan.ends;
  layer.set(from, (layer.get(from) ?? 1) - 1);
  layer.set(to, (layer.get(to) ?? 0) + 1);
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

/** What to build next, from the force mix and what the enemy fields. */
function wantedClass(memory: AiMemory, own: Formation[], queued: UnitClass[], overseas = false): UnitClass {
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
    // A war across the sea needs lift and escorts; one on land needs only a fleet to guard the coast.
    fleet: overseas ? 7 : 4,
    transport: overseas ? 9 : 2,
    carrier: overseas ? 3 : 1,
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

function planRecruitment(view: NationView, memory: AiMemory, own: Formation[], committed?: Stockpile, opts?: { overseas?: boolean }): RecruitOrder[] {
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
  const overseas = own.some((f) => f.aboard) || (opts?.overseas ?? false);
  for (const s of sites) {
    let c = wantedClass(memory, own, queued, overseas);
    // Ships are built only in ports.
    if (UNITS[c].naval && !view.tiles[s.key]?.port) c = 'infantry';
    // The reserve is kept of what the unit costs: a nation out of energy can still raise infantry,
    // which burns none. (Held to every reserve, a power that ran out of energy raised nothing for
    // the rest of the war: Japan from turn 6.) What cannot be paid for gives way to infantry.
    const short = (k: UnitClass) => {
      const cost = recruitCost(view.self, k);
      return RESOURCES.some((r) => cost[r] > 0 && left[r] - cost[r] < reserve[r]);
    };
    if (short(c)) c = 'infantry';
    if (short(c)) continue;
    const cost = recruitCost(view.self, c);
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
    if (n === self || view.nations[n]!.eliminated || view.nations[n]!.minor || busy.has(n)) continue;
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
  // The objective next turn's plan will hold to (the view is the one that plan will see).
  if (!view.self.minor) {
    const own = sortedKeys(view.formations).map((id) => view.formations[id]!);
    const target = chooseTarget(view, m, recentContacts(view), own);
    if (target) m.objective = target.id;
    else delete m.objective;
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

/** Turns without a capture before a stalled army lowers its bar for storming a city... */
const STALL_PATIENCE = 2;
/** ...by this much (of the 1000 share) for every further turn... */
const STALL_DISCOUNT = 15;
/** ...down to at most this much below the usual bar. */
const STALL_DISCOUNT_MAX = 90;

/** From this turn, a power this many points of standing ahead of the others is everyone's enemy. */
const RUNAWAY_FROM_TURN = 8;
const RUNAWAY_GAP = 8;

function planDiplomacy(view: NationView, plan: Plan, memory: AiMemory, spare: readonly NationId[]): NationOrders['diplomacy'] {
  const self = view.self.id;
  const out: NationOrders['diplomacy'] = [];
  // Spared nations (humans on easy) are never attacked by choice, and their peace is always welcome.
  for (const p of view.proposals) {
    if (p.to === self && p.kind === 'peace' && spare.includes(p.from) && view.relations[p.from] === 'war') out.push({ target: p.from, action: 'propose_peace' });
  }
  const may = (n: NationId) => !spare.includes(n);
  const focus = plan.target?.owner ?? null;
  // Minor states make no treaties: they are ground to take, not powers to bargain with.
  const alive = sortedKeys(view.nations).filter((n) => n !== self && !view.nations[n]!.eliminated && !view.nations[n]!.minor);
  const vp = (n: NationId) => view.nations[n]!.victoryPoints;
  const enemies = alive.filter((n) => view.relations[n] === 'war');
  const partners = alive.filter((n) => view.relations[n] === 'peace');
  // Balance of power: once the war has found its shape, a power running away with it gets everyone
  // else's attention. Settle with the other enemies, then turn on the leader.
  const standing = (n: NationId) => view.supremacy[n] ?? 0;
  const leader = [...alive].sort((a, b) => standing(b) - standing(a) || (a < b ? -1 : 1))[0];
  if (view.turn >= RUNAWAY_FROM_TURN && leader && may(leader) && standing(leader) >= standing(self) + RUNAWAY_GAP && alive.every((n) => n === leader || standing(leader) >= standing(n) + RUNAWAY_GAP / 2)) {
    for (const n of enemies) if (n !== leader) out.push({ target: n, action: 'propose_peace' });
    if (view.relations[leader] === 'peace') out.push({ target: leader, action: 'declare_war' });
    return out;
  }
  // A stalled war is a war to get out of: settle with the enemy we are stuck on and turn on the
  // weakest power instead.
  if (view.turn >= 10 && stalled(view, memory) >= STALL_TURNS && enemies.length > 0) {
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
 * A minor state's turn: its militia digs in where it stands and never leaves its own ground; it
 * raises one infantry formation a turn at its capital or a city while it can pay, keeping a reserve.
 * No diplomacy, no research choices: it is ground to be taken, defended.
 */
function planMinor(view: NationView): NationOrders {
  const own = sortedKeys(view.formations).map((id) => view.formations[id]!);
  const formations: Record<FormationId, FormationOrder> = {};
  for (const f of own) formations[f.id] = UNITS[f.unitClass].ground ? { type: 'defend' } : { type: 'hold' };
  const recruit: RecruitOrder[] = [];
  const reserve = { credits: 30, energy: 15, materials: 20, food: 20 };
  const cost = recruitCost(view.self, 'infantry');
  const left = view.self.stockpile;
  const queued = view.self.productionQueue.length;
  const site = sortedKeys(view.sites)
    .map((id) => view.sites[id]!)
    .filter((s) => s.owner === view.self.id && (s.kind === 'capital' || s.kind === 'city'))
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'capital' ? -1 : 1))[0];
  if (site && queued === 0 && RESOURCES.every((r) => left[r] - cost[r] >= reserve[r])) recruit.push({ siteId: site.id, unitClass: 'infantry' });
  return { nation: view.self.id, turn: view.turn, formations, recruit, diplomacy: [] };
}

/**
 * Orders for one nation's turn. Deterministic in (view, memory, seed). The returned orders are
 * legal against the authoritative world by construction: every path runs over terrain the
 * nation has seen, within the formation's allowance.
 */
export function planOrders(view: NationView, memory: AiMemory, seed: number, opts: { spare?: readonly NationId[]; target?: SiteId; incoming?: readonly Offer[] } = {}): NationOrders {
  if (view.self.minor) return planMinor(view);
  const self = view.self.id;
  const own = sortedKeys(view.formations).map((id) => view.formations[id]!);
  const contacts = recentContacts(view);
  const forced = forcedTarget(view, opts.target ?? jointOpTarget(view));
  const plan: Plan = {
    enemies: new Set(Object.keys(view.relations).filter((n) => isHostile(view, n) && !view.nations[n]!.eliminated)),
    contacts,
    threats: threatsTo(view, contacts),
    target: forced ?? chooseTarget(view, memory, contacts, own),
    ends: new Map(),
    seaEnds: new Map(),
  };
  // Passengers ride free; ships count in their own layer.
  for (const f of own) {
    if (f.aboard) continue;
    const layer = isNaval(f.unitClass) ? plan.seaEnds : plan.ends;
    layer.set(f.key, (layer.get(f.key) ?? 0) + 1);
  }
  const hostileHexes = new Set(contacts.filter((c) => c.confirmed || view.turn - c.lastSeen <= 1).map((c) => c.key));
  const orders: Record<FormationId, FormationOrder> = {};
  const committed = new Set<FormationId>();

  // Withdraw what is spent.
  for (const f of own) {
    if (committed.has(f.id) || !UNITS[f.unitClass].ground || f.aboard) continue;
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
    // The threat next to the prize (an operation's, or the army's own objective) is the prize's own
    // garrison: the answer is the assault, not a garrison sat in the city next door.
    const prize = forced ?? plan.target;
    if (prize && keyDistance(site.key, prize.key) <= 3) continue;
    let assigned = own.filter((f) => committed.has(f.id) && f.key === site.key).reduce((a, f) => a + f.strength, 0);
    const pool = own
      .filter((f) => !committed.has(f.id) && UNITS[f.unitClass].ground && !f.aboard && f.unitClass !== 'recon')
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
          !f.aboard &&
          UNITS[f.unitClass].range === 0 &&
          f.unitClass !== 'recon' &&
          f.strength >= 350 &&
          f.ammunition >= UNITS[f.unitClass].ammoPerAttack,
      )
      .sort((a, b) => keyDistance(a.key, key) - keyDistance(b.key, key) || (a.id < b.id ? -1 : 1));
    for (const f of pool) {
      if (group.length >= ASSAULT_GROUP) break;
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
    // A city that has held out while the war stood still is worth a dearer assault: the bar falls
    // with every turn without a capture, so a siege ends in a storm instead of a standing army.
    const resolve = siteVp(key) > 0 ? Math.min(STALL_DISCOUNT_MAX, Math.max(0, stalled(view, memory) - STALL_PATIENCE) * STALL_DISCOUNT) : 0;
    const bar = 520 - resolve - (support.some((f) => f.unitClass === 'artillery') ? 40 : 0) - (support.some((f) => !UNITS[f.unitClass].ground) ? 50 : 0);
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

  // Ranged: strike the most valuable contact in range (guns in a ship's hold cannot fire). A
  // garrison in a city comes first, the objective's above all: guns and planes soften a siege
  // turn after turn until the mass can storm it.
  const goal0 = plan.target?.key ?? null;
  const siege = (k: HexKey) => (k === plan.target?.key ? 100_000 : 0) + siteVp(k) * 1000;
  // An enemy amphibious group is the best target there is: its troops go down with it.
  const prey = (c: Contact) => siege(c.key) + (UNITS[c.unitClass].carries === 'ground' ? 50_000 : 0) + c.estimatedStrength;
  for (const f of own) {
    const def = UNITS[f.unitClass];
    if (def.range === 0 || committed.has(f.id) || (f.aboard && def.ground)) continue;
    const inRange = contacts
      .filter((c) => keyDistance(c.key, f.key) >= 1 && keyDistance(c.key, f.key) <= def.range && c.confirmed)
      .sort((a, b) => prey(b) - prey(a) || (a.formation < b.formation ? -1 : 1));
    // Guns on the march do not stop for every patrol: with the objective out of their reach and
    // no city or threat in range, they keep moving up to it.
    const marching = def.ground && goal0 !== null && keyDistance(f.key, goal0) > def.range && inRange[0] !== undefined && siege(inRange[0].key) === 0 && keyDistance(inRange[0].key, f.key) > 1;
    if (inRange[0] && f.ammunition >= def.ammoPerAttack && !marching) {
      orders[f.id] = { type: 'attack', target: inRange[0].key, path: [] };
      committed.add(f.id);
    }
  }

  // Everyone else advances on the objective; recon scouts ahead of them. Across the sea, the
  // navy carries them (planSea).
  const goal = plan.target?.key ?? null;
  // A war fought on foot leaves the navy idle at home: it takes its own target across the sea, the
  // best enemy site on another landmass, with the troops already aboard (the army stays on its march).
  const land = landmasses(view);
  // An operation the player launched owns the navy too: no raid of its own elsewhere.
  const raid = forced ? null : seaTarget(view, memory, contacts, own, land, goal);
  const sea = planSea(view, plan, own, orders, committed, raid?.key ?? goal, hostileHexes, !!raid);
  // Enemy cities in the army's way are stormed by everyone at their gates, when there are at least
  // STORM_TOGETHER of them (the objective first). A garrison dug in among the buildings is out of
  // sight: a move into it only bumps into it, turn after turn.
  const storming = new Map<FormationId, HexKey>();
  const gates = sortedKeys(view.sites)
    .map((id) => view.sites[id]!)
    .filter((s) => s.owner && plan.enemies.has(s.owner))
    .sort((a, b) => (a.key === goal ? -1 : b.key === goal ? 1 : keyDistance(a.key, goal ?? a.key) - keyDistance(b.key, goal ?? b.key)) || (a.id < b.id ? -1 : 1));
  for (const s of gates) {
    const tile = view.tiles[s.key];
    const by = own.filter(
      (f) =>
        !committed.has(f.id) &&
        !storming.has(f.id) &&
        !f.aboard &&
        areAdjacent(f.key, s.key) &&
        UNITS[f.unitClass].ground &&
        f.unitClass !== 'artillery' &&
        f.unitClass !== 'recon' &&
        f.ammunition >= UNITS[f.unitClass].ammoPerAttack &&
        enterCost(tile, f.unitClass) !== null,
    );
    if (by.length >= STORM_TOGETHER) for (const f of by) storming.set(f.id, s.key);
  }
  for (const f of own) {
    if (committed.has(f.id)) continue;
    if (f.aboard) {
      orders[f.id] = { type: 'hold' };
      continue;
    }
    if (isNaval(f.unitClass)) continue;
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
    const storm = storming.get(f.id);
    if (storm) {
      orders[f.id] = { type: 'attack', target: storm, path: [] };
      continue;
    }
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

  // Airborne: a prize no march and no landing reaches soon gets its troops by air (airborne.ts).
  planAirborne(view, forced ?? plan.target, !!forced, orders);

  // One diplomatic order per target: the engine refuses a second. War on a pact partner is
  // refused too, so the pact is honoured here rather than bounced by the validator.
  const war = planDiplomacy(view, plan, memory, opts.spare ?? []).filter((d) => d.action !== 'declare_war' || !treatyIn(view.treaties, 'nonaggression', self, d.target, view.turn));
  const diplomacy = [...war, ...planTreaties(view, plan, war, opts.spare ?? [])].filter((d, i, all) => all.findIndex((x) => x.target === d.target) === i);
  // Build first (one project at a time), then recruit from what is left.
  const build = planCityBuilds(view, memory);
  const recruit = planRecruitment(view, memory, own, build.length ? FACILITIES[build[0]!.facility].cost : undefined, { overseas: sea.overseas });

  const research = chooseResearch(view);
  const budget = planBudget(view);
  // Anything still without an order holds, said outright: the engine would hold it anyway, and a
  // player's staff (Plan) then leaves no unit waiting.
  for (const f of own) orders[f.id] ??= { type: 'hold' };
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
  const commanders = planCommanders(view, orders);
  if (commanders) out.commanders = commanders;
  const play = planCards(view, orders);
  if (play.length) out.play = play;
  // Passage where the war needs it, then the lifts' fuel, reserved after everything else.
  return fundAirlifts(view, seekPassage(view, memory, holdTheGates(view, leaderDiplomacy(view, memory, out, opts), opts.target), opts.target));
}

/** What a perk is worth to a general leading `f`: punch first, then staying power. */
function perkValue(e: CommanderEffect, ranged: boolean): number {
  return (
    (e.attack ?? 0) * 3 +
    (e.defense ?? 0) * 2 +
    (ranged ? (e.strike ?? 0) * 3 : 0) +
    Math.floor((e.amphibious ?? 0) / 10) +
    (e.entrench ?? 0) +
    (e.supply ?? 0) +
    (e.morale ?? 0) * 2 +
    (e.readiness ?? 0) +
    (e.vision ?? 0) * 10 +
    Math.floor((e.xp ?? 0) / 5) +
    Math.floor((e.survival ?? 0) / 10)
  );
}

/**
 * Generals lead the strongest assault formations: one in reserve takes the best unled one, and one
 * whose formation is spent moves to it. Promotions take the perk worth more. Only what the
 * validator accepts: an active general, an own land formation nobody leads, one assignment each.
 */
function planCommanders(view: NationView, orders: Record<FormationId, FormationOrder>): CommanderOrders | undefined {
  const all = view.commanders;
  if (!all) return undefined;
  const ids = sortedKeys(all);
  const led = new Set(ids.map((id) => all[id]!.formation).filter((f): f is FormationId => !!f));
  const punch = (f: Formation) => Math.floor(((UNITS[f.unitClass].softAttack + UNITS[f.unitClass].hardAttack) * f.strength) / 1000) + (orders[f.id]?.type === 'attack' ? 20 : 0);
  const open = sortedKeys(view.formations)
    .map((id) => view.formations[id]!)
    .filter((f) => UNITS[f.unitClass].ground && UNITS[f.unitClass].range === 0 && f.unitClass !== 'recon' && !led.has(f.id) && f.strength >= 500)
    .sort((a, b) => punch(b) - punch(a) || (a.id < b.id ? -1 : 1));
  const assign: NonNullable<CommanderOrders['assign']> = [];
  const perks: Record<string, 0 | 1> = {};
  for (const id of ids) {
    const c = all[id]!;
    if (c.offer) {
      const lf = c.formation ? view.formations[c.formation] : undefined;
      const ranged = !!lf && UNITS[lf.unitClass].range > 0;
      const [a, b] = c.offer.options;
      perks[id] = perkValue(PERKS[b]?.effect ?? {}, ranged) > perkValue(PERKS[a]?.effect ?? {}, ranged) ? 1 : 0;
    }
    if (c.status !== 'active') continue;
    const spent = c.formation ? (view.formations[c.formation]?.strength ?? 0) < 300 : true;
    if (!spent) continue;
    const next = open.shift();
    if (next) assign.push({ commander: id, formation: next.id });
  }
  if (assign.length === 0 && Object.keys(perks).length === 0) return undefined;
  return { ...(assign.length ? { assign } : {}), ...(Object.keys(perks).length ? { perks } : {}) };
}

/**
 * The navy's own target when the army's goal can be walked to (or there is none): the best hostile
 * site on another landmass, weighed like the army's target but from where the ships are. Null when
 * the goal is already across the sea (the navy carries the army there) or there are no ships.
 */
function seaTarget(view: NationView, memory: AiMemory, contacts: Contact[], own: Formation[], land: Map<HexKey, number>, goal: HexKey | null): SiteView | null {
  const ships = own.filter((f) => isNaval(f.unitClass));
  if (ships.length === 0) return null;
  const army = own.filter((f) => UNITS[f.unitClass].ground && !f.aboard);
  const goalLand = goal ? land.get(goal) : undefined;
  // The goal is across the sea for the bulk of the army: the navy carries them there instead.
  // (Island garrisons, Hawaii's or Guam's, do not count.)
  if (goal && army.filter((f) => land.get(f.key) === goalLand).length * 2 < army.length) return null;
  const centroid = (k: HexKey) => ships.reduce((a, f) => a + keyDistance(f.key, k), 0) / ships.length;
  let best: SiteView | null = null;
  let bestScore = -Infinity;
  for (const id of sortedKeys(view.sites)) {
    const s = view.sites[id]!;
    if (s.owner === view.self.id || (s.owner !== null && !isHostile(view, s.owner))) continue;
    const at = land.get(s.key);
    if (at === undefined || at === goalLand) continue;
    const guard = contacts.filter((c) => keyDistance(c.key, s.key) <= 1).reduce((a, c) => a + c.estimatedStrength, 0);
    const grudge = s.owner && memory.aggressors[s.owner] !== undefined ? 3 : 0;
    const score = (s.victoryPoints + grudge) * 10 - centroid(s.key) * 6 - guard / 100;
    if (score > bestScore || (score === bestScore && best && s.id < best.id)) {
      best = s;
      bestScore = score;
    }
  }
  return best;
}

/**
 * The war at sea. Armies whose goal lies on another landmass are an expedition: they march to a
 * port with a transport and board it; loaded transports sail for the beach nearest the goal and put
 * their troops ashore (storming it when the odds are good); empty ones go back for more. Fleets
 * escort toward the goal's coast; carriers take aircraft aboard and sail toward it. Every order
 * written here is one the validator accepts: paths come from the engine's own costs, boarding only
 * happens in the ship's own hex with room aboard.
 */
function planSea(
  view: NationView,
  plan: Plan,
  own: Formation[],
  orders: Record<FormationId, FormationOrder>,
  committed: Set<FormationId>,
  goal: HexKey | null,
  avoid: ReadonlySet<HexKey>,
  raid = false,
): { overseas: boolean } {
  const ships = own.filter((f) => isNaval(f.unitClass));
  if (!goal) {
    for (const s of ships) if (!committed.has(s.id)) orders[s.id] = { type: 'hold' };
    return { overseas: false };
  }
  const land = landmasses(view);
  const goalLand = land.get(goal);
  // On a raid the army ashore keeps its own war: only who is already aboard goes.
  const overseasArmy = raid ? [] : own.filter((f) => UNITS[f.unitClass].ground && !f.aboard && !committed.has(f.id) && f.unitClass !== 'artillery' && land.get(f.key) !== goalLand);
  const overseas = !raid && goalLand !== undefined && (overseasArmy.length > 0 || own.some((f) => f.aboard));
  const room = (c: Formation) => (UNITS[c.unitClass].capacity ?? 0) - own.filter((p) => p.aboard === c.id).length;
  const isWater = (k: HexKey) => view.tiles[k]?.terrain === 'water';
  const hostile = (k: HexKey) => avoid.has(k);
  // An enemy's city or port is held whether or not its garrison is seen: a garrison among the
  // buildings is out of sight from the sea, and troops sent to walk ashore into it only bump into
  // it, turn after turn (Japan's brigade sat off Honolulu for twenty turns). It is stormed, or the
  // troops land beside it.
  const held = (k: HexKey) => {
    if (hostile(k)) return true;
    const t = view.tiles[k];
    return !!t?.siteId && !!t.owner && plan.enemies.has(t.owner);
  };

  // The beach: a land hex on the goal's landmass, next to the sea, nearest the goal, no enemy on it.
  const beaches = sortedKeys(view.tiles)
    .filter((k) => goalLand !== undefined && land.get(k) === goalLand && neighborKeys(k).some(isWater))
    .sort((a, b) => keyDistance(a, goal) - keyDistance(b, goal) + (hostile(a) ? 3 : 0) - (hostile(b) ? 3 : 0) || (a < b ? -1 : 1));
  const beach = beaches[0] ?? null;
  const offshore = beach ? (neighborKeys(beach).filter(isWater).sort()[0] ?? null) : null;

  // Hexes next to an enemy ship: a ship that sails into one is stopped there (contact).
  const screened = new Set(avoid);
  for (const c of plan.contacts) {
    if (!isNaval(c.unitClass) || !plan.enemies.has(c.owner)) continue;
    for (const n of neighborKeys(c.key)) if (isWater(n)) screened.add(n);
  }
  const sail = (s: Formation, to: HexKey) => {
    // Around enemy ships and shores, not into them: contact stops a ship dead. Transports and
    // carriers also keep a hex clear of enemy ships; fleets go in to fight.
    const fighting = UNITS[s.unitClass].carries === undefined;
    let path = pathToward(view, s, to, plan, avoid);
    if (!fighting) {
      // The way round, unless it costs more than a couple of hexes of progress (a detour by way of
      // Hawaii is no escort's idea of caution).
      const safe = pathToward(view, s, to, plan, screened);
      const progress = (p: HexKey[]) => keyDistance(p.at(-1) ?? s.key, to);
      if (safe.length > 0 && progress(safe) <= progress(path) + 2) path = safe;
    }
    if (path.length) {
      orders[s.id] = { type: 'move', path };
      endAt(plan, s.key, path.at(-1)!, true);
    } else orders[s.id] = { type: 'hold' };
    committed.add(s.id);
  };

  // Loaded transports: land when the beach is next to them, else sail for it.
  for (const t of ships.filter((s) => UNITS[s.unitClass].carries === 'ground' && !committed.has(s.id))) {
    const aboard = own.filter((p) => p.aboard === t.id);
    if (aboard.length === 0 || !beach) continue;
    const shore = neighborKeys(t.key)
      .filter((k) => land.get(k) === goalLand && enterCost(view.tiles[k], 'infantry') !== null)
      .sort((a, b) => keyDistance(a, goal) - keyDistance(b, goal) || (a < b ? -1 : 1));
    // Nowhere to land here and no assault worth making: try the open beach instead of waiting
    // off a defended shore forever.
    const open = shore.some((k) => !held(k) && (plan.ends.get(k) ?? 0) < STACK_LIMIT);
    const storm = shore.find((k) => held(k));
    const worth = storm ? (previewAssault(view, aboard.map((x) => x.id), storm)?.share[0] ?? 0) >= 450 : false;
    if (shore.length > 0 && !open && !worth && offshore && offshore !== t.key) {
      sail(t, offshore);
      continue;
    }
    if (shore.length > 0) {
      for (const p of aboard) {
        // A beach this passenger can reach in one step this turn (mountains may be too much).
        const free = shore.find((k) => !held(k) && (plan.ends.get(k) ?? 0) < STACK_LIMIT && (enterCost(view.tiles[k], p.unitClass) ?? Infinity) <= movementAllowance(p));
        const enemy = shore.find((k) => held(k));
        if (free) {
          orders[p.id] = { type: 'move', path: [free] };
          endAt(plan, p.key, free);
        } else if (enemy && p.ammunition >= UNITS[p.unitClass].ammoPerAttack) {
          const preview = previewAssault(view, aboard.map((x) => x.id), enemy);
          orders[p.id] = preview && preview.share[0] >= 450 ? { type: 'attack', target: enemy, path: [] } : { type: 'hold' };
        } else orders[p.id] = { type: 'hold' };
        committed.add(p.id);
      }
      orders[t.id] = { type: 'hold' };
      committed.add(t.id);
      continue;
    }
    if (offshore) sail(t, offshore);
  }

  // Ports where the expedition gathers: own coastal sites, nearest the goal first.
  const ports = sortedKeys(view.sites)
    .map((id) => view.sites[id]!)
    .filter((s) => s.owner === view.self.id && view.tiles[s.key]?.port)
    .sort((a, b) => keyDistance(a.key, goal) - keyDistance(b.key, goal) || (a.key < b.key ? -1 : 1));

  // Empty transports: take on troops waiting in their hex, else go to where troops are.
  for (const t of ships.filter((s) => UNITS[s.unitClass].carries === 'ground' && !committed.has(s.id))) {
    if (!overseas || !beach) {
      orders[t.id] = { type: 'hold' };
      committed.add(t.id);
      continue;
    }
    let left = room(t);
    for (const f of overseasArmy) {
      if (left <= 0) break;
      if (committed.has(f.id) || f.key !== t.key) continue;
      orders[f.id] = { type: 'embark', carrier: t.id };
      committed.add(f.id);
      left--;
    }
    if (left < room(t)) {
      orders[t.id] = { type: 'hold' };
      committed.add(t.id);
      continue;
    }
    const gather = ports.find((s) => overseasArmy.some((f) => !committed.has(f.id) && keyDistance(f.key, s.key) <= 6)) ?? ports[0];
    if (gather && gather.key !== t.key) sail(t, gather.key);
    else {
      orders[t.id] = { type: 'hold' };
      committed.add(t.id);
    }
  }

  // The expedition marches to the port its transports are bound for.
  if (overseas) {
    const lift = ships.filter((s) => UNITS[s.unitClass].carries === 'ground');
    const harbour = ports.find((s) => lift.some((t) => t.key === s.key || (orders[t.id]?.type === 'move' && (orders[t.id] as { path: HexKey[] }).path.at(-1) === s.key))) ?? ports[0];
    if (harbour && lift.length > 0) {
      for (const f of overseasArmy) {
        if (committed.has(f.id) || f.key === harbour.key) continue;
        if (land.get(f.key) !== land.get(harbour.key)) continue;
        const path = pathToward(view, f, harbour.key, plan, avoid);
        if (path.length === 0) continue;
        orders[f.id] = { type: 'move', path };
        endAt(plan, f.key, path.at(-1)!);
        committed.add(f.id);
      }
    }
  }

  // Carriers take aircraft on deck, then sail with the fleets toward the goal's coast.
  for (const c of ships.filter((s) => UNITS[s.unitClass].carries === 'air' && !committed.has(s.id))) {
    let left = room(c);
    for (const a of own) {
      if (left <= 0) break;
      if (committed.has(a.id) || a.aboard || a.key !== c.key || UNITS[a.unitClass].ground || isNaval(a.unitClass)) continue;
      orders[a.id] = { type: 'embark', carrier: c.id };
      committed.add(a.id);
      left--;
    }
    if (left < room(c)) {
      orders[c.id] = { type: 'hold' };
      committed.add(c.id);
    } else if (offshore) sail(c, offshore);
  }
  // Fleets hunt enemy amphibious groups within a few hexes (sinking one drowns its troops), and
  // otherwise escort toward the goal's coast.
  const convoys = plan.contacts.filter((c) => UNITS[c.unitClass].carries === 'ground' && plan.enemies.has(c.owner));
  for (const s of ships) {
    if (committed.has(s.id)) continue;
    const hunt = UNITS[s.unitClass].carries === undefined ? convoys.filter((c) => keyDistance(c.key, s.key) <= HUNT_RANGE).sort((a, b) => keyDistance(a.key, s.key) - keyDistance(b.key, s.key) || (a.formation < b.formation ? -1 : 1))[0] : undefined;
    if (hunt) sail(s, hunt.key);
    else if (offshore && UNITS[s.unitClass].carries === undefined) sail(s, offshore);
    else {
      orders[s.id] = { type: 'hold' };
      committed.add(s.id);
    }
  }
  return { overseas };
}

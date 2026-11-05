import type {
  BlackFilesState,
  BlackFilesView,
  Formation,
  GameEvent,
  HexKey,
  NationId,
  Site,
  TechId,
  VisitorClass,
  WorldState,
} from '@brink/contracts';
import { VISITOR_CLASSES } from '@brink/contracts';
import { BLACK_FILES, STACK_LIMIT, TECHS } from '@brink/game-data';
import { keyDistance, neighborKeys, rangeKeys } from '@brink/map';
import { newFormation } from './production';
import { roll } from './rng';
import { clamp, enterCost, pairKey, sortedKeys } from './rules';

// The Black Files (MASTER-PLAN Phase 8; data in game-data `blackfiles.ts`, state in contracts
// `blackfiles.ts`). Phase 10c, after the cities grow and before eliminations:
//
//   1. Digs. A power that holds an excavation site `digTurns` turns running digs out an artefact.
//   2. Black sites. A black site taken from a power seizes one of its artefacts and leaks its programme;
//      a programme may also leak by chance (`roll(seed, turn, 'leak', nation)`).
//   3. The waking. Past `wakeAt` artefacts (or on `wakeTurn`) the Visitors wake: their incursions
//      open, each with a first wave.
//   4. The Visitors' turn: incursions grow formations, the Visitors regrow on their own ground,
//      swarms re-form and split, and ground they hold `convertTurns` running turns to crystal.
//
// Every step reads the world as the step before left it, in sorted order; nothing here depends on
// the order of submissions. Randomness only by address. The Accord's rules live in `diplomacy.ts`
// (signing and betrayal) and `victory.ts` (the joint win); shared vision in `fog.ts`.

/** Whether `nation` is the Visitors. */
export function isVisitors(world: Pick<WorldState, 'nations'>, nation: NationId | null | undefined): boolean {
  return !!nation && !!world.nations[nation]?.visitors;
}

export function isVisitorClass(c: string): c is VisitorClass {
  return (VISITOR_CLASSES as readonly string[]).includes(c);
}

/** The Visitors, dormant: a nation with nothing, at war with everyone, unseen until it wakes. */
export function dormantVisitors(world: WorldState, id: NationId = 'visitors'): void {
  world.nations[id] = {
    id,
    name: 'The Visitors',
    color: '#7df9e4',
    government: 'directorate',
    minor: true,
    visitors: true,
    stockpile: { credits: 0, energy: 0, materials: 400, food: 0 },
    population: 0,
    stability: 100,
    industrialCapacity: 0,
    researchOutput: 0,
    budget: { research: 0, infrastructure: 0, welfare: 0 },
    research: { current: null, progress: 0, unlocked: [] },
    productionQueue: [],
    construction: [],
    objectives: [],
    warLosses: 0,
    eliminated: false,
  };
  for (const n of sortedKeys(world.nations)) if (n !== id) world.relations[pairKey(n, id)] = 'war';
  // They know the ground they come up under.
  const observed: Record<HexKey, number> = {};
  const knownOwner: Record<HexKey, NationId | null> = {};
  for (const k of sortedKeys(world.tiles)) {
    observed[k] = 0;
    knownOwner[k] = world.tiles[k]!.owner;
  }
  world.intel[id] = { observed, knownOwner, lastKnown: {} };
}

/** A fresh Black Files state: no digs yet, nobody holds anything, they sleep. */
export function newBlackFiles(world: WorldState, opts: { wakeAt?: number; wakeTurn?: number | null; incursions: { key: HexKey; name: string }[]; visitors?: NationId }): BlackFilesState {
  const digs: BlackFilesState['digs'] = {};
  for (const id of sortedKeys(world.sites)) if (world.sites[id]!.anomaly === 'excavation') digs[id] = { holder: null, turns: 0, left: BLACK_FILES.digYield };
  return {
    visitors: opts.visitors ?? 'visitors',
    excavated: 0,
    wakeAt: opts.wakeAt ?? BLACK_FILES.wakeAt,
    wakeTurn: opts.wakeTurn ?? null,
    awake: null,
    incursions: opts.incursions.map((i) => ({ ...i })),
    digs,
    artefacts: {},
    leaked: [],
    accord: [],
    betrayers: [],
    held: {},
    splits: 0,
  };
}

/** Whether the Visitors are dormant: a nation not yet in the war, hidden from every view. */
export function dormant(world: Pick<WorldState, 'blackFiles'>, nation: NationId): boolean {
  const bf = world.blackFiles;
  return !!bf && bf.visitors === nation && bf.awake === null;
}

/** The black techs a power has finished. */
export function blackTechs(world: Pick<WorldState, 'nations'>, nation: NationId): TechId[] {
  return (world.nations[nation]?.research.unlocked ?? []).filter((t) => TECHS[t]?.artefact);
}

/** Whether `nation` holds a black site now. */
export function holdsBlackSite(world: Pick<WorldState, 'sites'>, nation: NationId): boolean {
  return Object.values(world.sites).some((s) => s.owner === nation && s.anomaly === 'blacksite');
}

/** Why `nation` cannot start reverse-engineering `tech`, or null. Works on a world or a view. */
export function blackResearchBlocker(
  facts: { sites: Record<string, Pick<Site, 'owner' | 'anomaly'>>; blackFiles?: Pick<BlackFilesState, 'artefacts'> | Pick<BlackFilesView, 'artefacts'> },
  nation: NationId,
  tech: TechId,
): string | null {
  if (!TECHS[tech]?.artefact) return null;
  if (!facts.blackFiles) return 'there is nothing to reverse-engineer in this campaign';
  if (!Object.values(facts.sites).some((s) => s.owner === nation && s.anomaly === 'blacksite')) return 'reverse engineering needs a black site of your own';
  if ((facts.blackFiles.artefacts[nation] ?? 0) < 1) return 'reverse engineering needs an artefact to study';
  return null;
}

/**
 * Phase 10, as a project finishes: a reverse-engineered one uses up an artefact at a black site.
 * False when it can no longer be finished (the artefact or the black site was lost): the project is
 * dropped and its points banked.
 */
export function studyArtefact(world: WorldState, nation: NationId, tech: TechId): boolean {
  if (!TECHS[tech]?.artefact) return true;
  const bf = world.blackFiles;
  if (!bf || blackResearchBlocker(world, nation, tech)) return false;
  bf.artefacts[nation] = (bf.artefacts[nation] ?? 0) - 1;
  if (bf.artefacts[nation] === 0) delete bf.artefacts[nation];
  return true;
}

/** The Black Files as `nation` may know them. */
export function blackFilesView(world: WorldState, nation: NationId): BlackFilesView | undefined {
  const bf = world.blackFiles;
  if (!bf) return undefined;
  const blackTechsKnown: Record<NationId, TechId[]> = {};
  for (const n of sortedKeys(world.nations)) {
    if (n !== nation && !bf.leaked.includes(n)) continue;
    const t = blackTechs(world, n);
    if (t.length > 0) blackTechsKnown[n] = t;
  }
  return {
    visitors: bf.awake === null ? null : bf.visitors,
    awake: bf.awake !== null,
    excavated: bf.excavated,
    wakeAt: bf.wakeAt,
    wakeTurn: bf.wakeTurn,
    digs: JSON.parse(JSON.stringify(bf.digs)) as BlackFilesView['digs'],
    artefacts: { ...bf.artefacts },
    accord: [...bf.accord],
    betrayers: [...bf.betrayers],
    leaked: [...bf.leaked],
    blackTechs: blackTechsKnown,
  };
}

const living = (world: WorldState, n: NationId) => !!world.nations[n] && !world.nations[n]!.eliminated;
const isPower = (world: WorldState, n: NationId | null): n is NationId => !!n && !!world.nations[n] && !world.nations[n]!.minor;

function leak(world: WorldState, bf: BlackFilesState, nation: NationId, events: GameEvent[]): void {
  if (bf.leaked.includes(nation)) return;
  bf.leaked = [...bf.leaked, nation].sort();
  events.push({ kind: 'black_files', what: 'leaked', nation });
}

/** Ground formations of anyone but the Visitors in `key`. */
function humansIn(world: WorldState, key: HexKey, visitors: NationId): Formation[] {
  return Object.values(world.formations).filter((f) => f.key === key && f.owner !== visitors);
}

function visitorsIn(world: WorldState, key: HexKey, visitors: NationId): Formation[] {
  return sortedKeys(world.formations)
    .map((id) => world.formations[id]!)
    .filter((f) => f.key === key && f.owner === visitors);
}

/** A free land hex for a Visitors formation at or near `centre`: no one else in it, room in the stack. */
function roomNear(world: WorldState, centre: HexKey, visitors: NationId, radius: number, cls: VisitorClass = 'walker'): HexKey | null {
  const rings: HexKey[] = [centre];
  for (let r = 1; r <= radius; r++) rings.push(...rangeKeys(centre, r).filter((k) => keyDistance(k, centre) === r).sort());
  for (const k of rings) {
    const t = world.tiles[k];
    if (!t || enterCost(t, cls) === null) continue;
    if (humansIn(world, k, visitors).length > 0) continue;
    if (visitorsIn(world, k, visitors).length >= STACK_LIMIT) continue;
    return k;
  }
  return null;
}

const NAMES: Record<VisitorClass, string> = { walker: 'Lattice', swarm: 'Swarm', emitter: 'Spire' };

function grow(world: WorldState, bf: BlackFilesState, cls: VisitorClass, key: HexKey): Formation {
  bf.splits += 1;
  const f = newFormation(world, bf.visitors, cls, key, `${NAMES[cls]} ${bf.splits}`);
  f.readiness = 100;
  f.organization = 80;
  f.morale = 100;
  // A swarm is born small and grows on crystal until it splits.
  if (cls === 'swarm') f.strength = BLACK_FILES.swarmBirth;
  return f;
}

function claim(world: WorldState, key: HexKey, to: NationId, events: GameEvent[]): void {
  const t = world.tiles[key]!;
  if (t.owner === to) return;
  events.push({ kind: 'territory', key, from: t.owner, to });
  t.owner = to;
}

/** The Visitors wake: each incursion opens at the first free hex at or near its place, with a first wave. */
function awaken(world: WorldState, bf: BlackFilesState, events: GameEvent[]): void {
  bf.awake = world.turn;
  const v = bf.visitors;
  world.nations[v]!.eliminated = false;
  events.push({ kind: 'black_files', what: 'awakening', nation: v });
  for (const inc of bf.incursions) {
    const near = rangeKeys(inc.key, 3)
      .filter((k) => k !== inc.key)
      .sort((a, b) => keyDistance(a, inc.key) - keyDistance(b, inc.key) || (a < b ? -1 : 1));
    const at = [inc.key, ...near].find((k) => {
      const t = world.tiles[k];
      return !!t && t.terrain !== 'water' && !t.siteId && humansIn(world, k, v).length === 0;
    });
    if (at) openIncursion(world, bf, at, inc.name, BLACK_FILES.firstWave, events);
  }
}

const incursionCount = (world: WorldState) => Object.values(world.sites).filter((s) => s.anomaly === 'incursion').length;

/** An incursion opens at `at`: a Visitors' site on crystal, the ground round it theirs, a wave out of it. */
function openIncursion(world: WorldState, bf: BlackFilesState, at: HexKey, name: string, wave: readonly VisitorClass[], events: GameEvent[]): void {
  const v = bf.visitors;
  const id = `incursion-${incursionCount(world) + 1}`;
  world.sites[id] = {
    id,
    name,
    kind: 'city',
    key: at,
    owner: v,
    originalOwner: v,
    population: 0,
    victoryPoints: BLACK_FILES.incursionVp,
    yields: { credits: 0, energy: 0, materials: 4, food: 0, industry: 0, research: 0 },
    facilities: [],
    anomaly: 'incursion',
  };
  const t = world.tiles[at]!;
  t.siteId = id;
  t.terrain = 'hills';
  t.crystal = true;
  claim(world, at, v, events);
  for (const k of rangeKeys(at, BLACK_FILES.incursionRadius).sort()) {
    const n = world.tiles[k];
    if (!n || n.terrain === 'water' || n.siteId || humansIn(world, k, v).length > 0) continue;
    claim(world, k, v, events);
  }
  events.push({ kind: 'black_files', what: 'incursion', nation: v, site: id, key: at });
  for (const cls of wave) {
    const k = roomNear(world, at, v, 2, cls);
    if (k) grow(world, bf, cls, k);
  }
}

/** The zone spreads: crystal held far from every incursion blooms into a new one. Null when none is far enough. */
function bloomAt(world: WorldState, v: NationId): HexKey | null {
  const sites = Object.values(world.sites).filter((s) => s.anomaly === 'incursion' && s.owner === v);
  let best: HexKey | null = null;
  let bestD = BLACK_FILES.bloomDistance - 1;
  for (const k of sortedKeys(world.tiles)) {
    const t = world.tiles[k]!;
    if (t.owner !== v || !t.crystal || t.siteId || humansIn(world, k, v).length > 0) continue;
    const d = Math.min(99, ...sites.map((s) => keyDistance(s.key, k)));
    if (d > bestD) {
      bestD = d;
      best = k;
    }
  }
  return best;
}

/** Phase 10c: digs, black sites, the waking and the Visitors' own turn. */
export function resolveBlackFiles(world: WorldState, events: GameEvent[]): void {
  const bf = world.blackFiles;
  if (!bf) return;
  const turn = world.turn;

  // 1. Digs: held by a power for `digTurns` running, an artefact comes out of the ice.
  for (const id of sortedKeys(bf.digs)) {
    const dig = bf.digs[id]!;
    const site = world.sites[id];
    const holder = site && isPower(world, site.owner) ? site.owner : null;
    if (holder !== dig.holder) {
      dig.holder = holder;
      dig.turns = holder ? 1 : 0;
    } else if (holder) dig.turns += 1;
    if (holder && dig.left > 0 && dig.turns >= BLACK_FILES.digTurns) {
      dig.left -= 1;
      dig.turns = 0;
      bf.excavated += 1;
      bf.artefacts[holder] = (bf.artefacts[holder] ?? 0) + 1;
      events.push({ kind: 'black_files', what: 'artefact', nation: holder, site: id });
    }
  }

  // 2. Black sites taken this turn: the taker seizes an artefact and the loser's programme is out.
  for (const e of [...events]) {
    if (e.kind !== 'site_captured' || world.sites[e.site]?.anomaly !== 'blacksite' || !e.from || !isPower(world, e.from) || !isPower(world, e.to)) continue;
    if ((bf.artefacts[e.from] ?? 0) > 0) {
      bf.artefacts[e.from]! -= 1;
      if (bf.artefacts[e.from] === 0) delete bf.artefacts[e.from];
      bf.artefacts[e.to] = (bf.artefacts[e.to] ?? 0) + 1;
      events.push({ kind: 'black_files', what: 'stolen', nation: e.to, other: e.from, site: e.site });
    }
    if (blackTechs(world, e.from).length > 0) leak(world, bf, e.from, events);
  }
  for (const n of sortedKeys(world.nations)) {
    if (!living(world, n) || bf.leaked.includes(n) || blackTechs(world, n).length === 0) continue;
    if (roll(world.seed, turn, 'leak', n) % 100 < BLACK_FILES.leakChance) leak(world, bf, n, events);
  }

  // 3. The waking.
  const v = bf.visitors;
  if (bf.awake === null) {
    if (bf.excavated >= bf.wakeAt || (bf.wakeTurn !== null && turn >= bf.wakeTurn)) awaken(world, bf, events);
    else return;
  }
  if (!living(world, v)) return;

  // 4a. Incursions grow: one formation every `spawnEvery` turns while few stand near.
  if (turn > bf.awake! && (turn - bf.awake!) % BLACK_FILES.spawnEvery === 0) {
    for (const id of sortedKeys(world.sites)) {
      const s = world.sites[id]!;
      if (s.anomaly !== 'incursion' || s.owner !== v) continue;
      const near = Object.values(world.formations).filter((f) => f.owner === v && keyDistance(f.key, s.key) <= 2).length;
      if (near >= BLACK_FILES.incursionCap) continue;
      const cls = BLACK_FILES.spawnMix[roll(world.seed, turn, 'spawn', id) % BLACK_FILES.spawnMix.length]!;
      const k = roomNear(world, s.key, v, 1, cls);
      if (k) grow(world, bf, cls, k);
    }
  }

  // 4b. Regrowth on their own ground and on crystal.
  for (const id of sortedKeys(world.formations)) {
    const f = world.formations[id]!;
    if (f.owner !== v) continue;
    const t = world.tiles[f.key]!;
    if (t.owner === v || t.crystal) f.strength = clamp(f.strength + BLACK_FILES.regrowth, 0, 1000);
    f.fuel = 100;
    f.ammunition = 100;
  }

  // 4c. Swarms: two in one hex re-form into one; a big one splits into a free hex next to it.
  const swarms = () =>
    sortedKeys(world.formations)
      .map((id) => world.formations[id]!)
      .filter((f) => f.owner === v && f.unitClass === 'swarm');
  for (const f of swarms()) {
    if (!world.formations[f.id]) continue;
    const mate = swarms().find((g) => g.id !== f.id && g.key === f.key && f.strength + g.strength <= BLACK_FILES.reformAt);
    if (!mate) continue;
    f.strength += mate.strength;
    delete world.formations[mate.id];
    events.push({ kind: 'destroyed', formation: mate.id, owner: v, unitClass: 'swarm', at: mate.key });
  }
  for (const f of swarms()) {
    if (f.strength < BLACK_FILES.splitAt) continue;
    const to = neighborKeys(f.key)
      .sort()
      .find((k) => {
        const t = world.tiles[k];
        return !!t && enterCost(t, 'swarm') !== null && humansIn(world, k, v).length === 0 && visitorsIn(world, k, v).length < STACK_LIMIT;
      });
    if (!to) continue;
    const half = Math.floor(f.strength / 2);
    const g = grow(world, bf, 'swarm', to);
    g.strength = f.strength - half;
    g.organization = f.organization;
    f.strength = half;
    events.push({ kind: 'black_files', what: 'split', nation: v, formation: f.id, key: to });
  }

  // 4d. Terraforming: ground held `convertTurns` running turns to crystal.
  const held: Record<HexKey, number> = {};
  for (const k of sortedKeys(world.tiles)) {
    const t = world.tiles[k]!;
    if (t.owner !== v) continue;
    held[k] = (bf.held[k] ?? 0) + 1;
    if (held[k]! >= BLACK_FILES.convertTurns && !t.crystal && t.terrain !== 'water' && !t.siteId) {
      t.crystal = true;
      t.terrain = 'hills';
      events.push({ kind: 'black_files', what: 'converted', nation: v, key: k });
    }
  }
  bf.held = held;

  // 4e. The zone spreads: every `bloomEvery` turns, crystal far from every incursion blooms into one.
  if ((turn - bf.awake!) % BLACK_FILES.bloomEvery === 0 && turn > bf.awake! && incursionCount(world) < BLACK_FILES.maxIncursions) {
    const at = bloomAt(world, v);
    if (at) openIncursion(world, bf, at, `Bloom ${incursionCount(world) + 1 - bf.incursions.length}`, BLACK_FILES.bloomWave, events);
  }
}

/**
 * Doctrine phase, Black Bag jobs: each power's agents take one artefact from their target, if it
 * held one as the phase began. A target with none, or with fewer than the agents sent for them, has
 * its programme leak instead and keeps what it has (nobody's agents outrank anybody else's).
 */
export function blackBag(world: WorldState, thefts: readonly { thief: NationId; from: NationId }[], events: GameEvent[]): void {
  const bf = world.blackFiles;
  if (!bf) return;
  const held = { ...bf.artefacts };
  const byTarget = new Map<NationId, NationId[]>();
  for (const t of thefts) byTarget.set(t.from, [...new Set([...(byTarget.get(t.from) ?? []), t.thief])].sort());
  for (const from of [...byTarget.keys()].sort()) {
    const thieves = byTarget.get(from)!;
    if ((held[from] ?? 0) < thieves.length) {
      leak(world, bf, from, events);
      continue;
    }
    for (const thief of thieves) {
      bf.artefacts[from] = (bf.artefacts[from] ?? 0) - 1;
      bf.artefacts[thief] = (bf.artefacts[thief] ?? 0) + 1;
      events.push({ kind: 'black_files', what: 'stolen', nation: thief, other: from });
    }
    if (bf.artefacts[from] === 0) delete bf.artefacts[from];
  }
}

/** Whether the Accord could be signed between `from` and `to` (both join it): they are awake, neither betrayed it, not both in. */
export function accordOpen(bf: { awake: boolean | number | null; accord: readonly NationId[]; betrayers: readonly NationId[] } | undefined, from: NationId, to: NationId): boolean {
  if (!bf || bf.awake === null || bf.awake === false || from === to) return false;
  if (bf.betrayers.includes(from) || bf.betrayers.includes(to)) return false;
  return !(bf.accord.includes(from) && bf.accord.includes(to));
}

/** Whether `owner` has a shield emitter in `key`: assaults there are absorbed (`BLACK_FILES.shieldAbsorb`). */
export function shielded(world: Pick<WorldState, 'formations'>, key: HexKey, owner: NationId): boolean {
  return Object.values(world.formations).some((f) => f.key === key && f.owner === owner && f.unitClass === 'emitter');
}

/** For tests and the AI: a hex is held by the Visitors. */
export function visitorsHold(world: WorldState, key: HexKey): boolean {
  const bf = world.blackFiles;
  return !!bf && world.tiles[key]?.owner === bf.visitors;
}


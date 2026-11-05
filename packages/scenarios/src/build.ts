import type { Formation, GovernmentId, HexKey, Nation, NationId, Site, Terrain, Tile, UnitClass, WorldState, Yields } from '@brink/contracts';
import { RULES, RULESET_VERSION, STACK_LIMIT, UNITS } from '@brink/game-data';
import { cellKey, hexKey, keyDistance, layerAt, type MapFile, type MapSite, neighborKeys, offsetToAxial } from '@brink/map';
import { computeVision, emptyIntel, grossYields, initDoctrine, mulberry32, newFormation, pairKey, sortedKeys, updateIntel } from '@brink/simulation';

// A theatre's turn-1 world from its map file (docs/mapgen.md) and the scenario's setup: who sails
// where, who raises militia, how long the war runs. Nothing here knows how many powers there are or
// how big the map is; the Pacific (pacific.ts) is one map and one setup.

/** A hex as the scenario tables name it: column, row and the site's name. */
export type Place = [col: number, row: number, name: string];

export interface NationSpec {
  id: NationId;
  name: string;
  /** The name on a map label or a small tile: 'USA', 'N. Korea'. */
  short: string;
  color: string;
  government: GovernmentId;
  /** A minor state: holds its ground, never a player (docs/pacific.md). */
  minor?: boolean;
  capital: Place;
  cities: Place[];
  depots: Place[];
  /** Added to roughness inside this country: tundra and taiga, mountains, open plains. */
  rough: number;
  /** The opening navy, at sea off the named port. */
  navy?: { port: string; ships: UnitClass[] };
  /** A minor state's militia per city, beyond the one every city has: big countries defend deeper. */
  militia?: UnitClass[];
}

/** What a scenario adds to its map: the orders of battle and the length of the war. */
export interface ScenarioSetup {
  scenarioId: string;
  maxTurns: number;
  navies?: Readonly<Record<NationId, { port: string; ships: UnitClass[] }>>;
  militia?: Readonly<Record<NationId, UnitClass[]>>;
}

const place = (s: MapSite): Place => [s.at[0], s.at[1], s.name];

/** Each nation of the map as the scenario tables describe it, in the map's order. */
export function nationSpecs(map: MapFile, setup: Pick<ScenarioSetup, 'navies' | 'militia'>): NationSpec[] {
  return map.nations.map((n) => {
    const own = map.sites.filter((s) => s.owner === n.id);
    const capital = map.sites.find((s) => s.id === n.capital)!;
    const navy = setup.navies?.[n.id];
    const militia = setup.militia?.[n.id];
    return {
      id: n.id,
      short: n.short,
      name: n.name,
      color: n.color,
      government: n.government,
      ...(n.role === 'minor' ? { minor: true } : {}),
      ...(militia ? { militia: [...militia] } : {}),
      capital: place(capital),
      cities: own.filter((s) => s.kind === 'city').map(place),
      depots: own.filter((s) => s.kind === 'depot').map(place),
      rough: n.terrainBias ?? 0,
      ...(navy ? { navy: { port: navy.port, ships: [...navy.ships] } } : {}),
    };
  });
}

function yields(y: Partial<Yields>): Yields {
  return { credits: 0, energy: 0, materials: 0, food: 0, industry: 0, research: 0, ...y };
}

interface Profile {
  vp: number;
  pop: number;
  yields: Yields;
}

const SITE_PROFILE: Record<'capital' | 'city' | 'depot', Profile> = {
  capital: { vp: 10, pop: 2400, yields: yields({ credits: 32, energy: 12, materials: 12, food: 16, industry: 34, research: 8 }) },
  city: { vp: 5, pop: 900, yields: yields({ credits: 14, energy: 6, materials: 8, food: 9, industry: 16, research: 3 }) },
  depot: { vp: 2, pop: 100, yields: yields({ credits: 2, energy: 4, materials: 4, food: 2, industry: 4 }) },
};

const OUTPOST_PROFILE: Profile = { vp: 1, pop: 40, yields: yields({ credits: 1, energy: 1, materials: 1, food: 1, industry: 1 }) };

/** A minor state's capital and cities: smaller economies, same victory points (they are the prize). */
const MINOR_PROFILE: Record<'capital' | 'city', Profile> = {
  capital: { vp: 6, pop: 1400, yields: yields({ credits: 14, energy: 6, materials: 6, food: 8, industry: 10, research: 3 }) },
  city: { vp: 4, pop: 600, yields: yields({ credits: 8, energy: 4, materials: 4, food: 5, industry: 6, research: 1 }) },
};

/** An objective: a place worth holding that produces next to nothing. */
const OBJECTIVE_PROFILE: Profile = { vp: 3, pop: 20, yields: yields({ credits: 1 }) };

function profileOf(s: MapSite, minor: boolean): Profile {
  if (s.kind === 'objective') return OBJECTIVE_PROFILE;
  if (s.kind === 'depot') return s.profile === 'outpost' ? OUTPOST_PROFILE : SITE_PROFILE.depot;
  return minor ? MINOR_PROFILE[s.kind] : SITE_PROFILE[s.kind];
}

/** Where a power's opening army stands: the same ten formations for every power. */
const STARTING_FORCES: readonly [UnitClass, 'capital' | 'city0' | 'city1' | 'depot0'][] = [
  ['infantry', 'capital'],
  ['armor', 'capital'],
  ['air', 'capital'],
  ['drone', 'city0'],
  ['infantry', 'city0'],
  ['mechanized', 'city0'],
  ['infantry', 'city1'],
  ['artillery', 'city1'],
  ['recon', 'depot0'],
  ['infantry', 'depot0'],
];

/** Soft blobs of roughness; deterministic in the seed, never used during play. */
function texture(map: MapFile, seed: number): (key: HexKey) => number {
  const { cols, rows } = map;
  const next = mulberry32(seed ^ 0x2f6b1a3d);
  // 28 blobs on the Pacific's 800 hexes; as many to the hex on any other map.
  const count = Math.max(1, Math.round((28 * cols * rows) / 800));
  const blobs = Array.from({ length: count }, () => ({
    col: next() % cols,
    row: next() % rows,
    radius: 2 + (next() % 3),
    kind: (['forest', 'hills', 'forest', 'plains', 'hills', 'forest'] as const)[next() % 6]!,
  }));
  const noise = new Map<HexKey, number>();
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) noise.set(cellKey([col, row]), next() % 100);
  const centres = blobs.map((b) => ({ ...b, key: cellKey([b.col, b.row]) }));
  return (key) => {
    let v = noise.get(key) ?? 0;
    for (const b of centres) {
      if (keyDistance(key, b.key) <= b.radius) v += b.kind === 'hills' ? 40 : b.kind === 'forest' ? 25 : -30;
    }
    return v;
  };
}

function terrainFor(rough: number): Terrain {
  if (rough > 125) return 'mountains';
  if (rough > 98) return 'hills';
  if (rough > 70) return 'forest';
  return 'plains';
}

function unitClassName(c: UnitClass): string {
  return { infantry: 'Infantry', mechanized: 'Mechanized', armor: 'Armored', artillery: 'Artillery', recon: 'Recon', air: 'Aviation', drone: 'Drone Company', fleet: 'Fleet', transport: 'Amphibious Group', carrier: 'Carrier Group' }[c];
}

const ordinal = (c: number) => `${c}${['th', 'st', 'nd', 'rd'][c] ?? 'th'}`;

/** The turn-1 world of a map, for a seed. The map must be valid (`parseMap`). */
export function buildScenario(map: MapFile, seed: number, setup: ScenarioSetup): WorldState {
  const all = nationSpecs(map, setup);
  const powers = all.filter((n) => !n.minor);
  const minors = all.filter((n) => n.minor);
  const spec = new Map(all.map((n) => [n.id, n]));
  const capitalOf = new Map(map.nations.map((n) => [n.id, n.capital]));
  const siteIds = (n: NationId, kind: MapSite['kind']) => map.sites.filter((s) => s.owner === n && s.kind === kind).map((s) => s.id);

  const rough = texture(map, seed);
  const tiles: Record<HexKey, Tile> = {};
  for (let row = 0; row < map.rows; row++) {
    for (let col = 0; col < map.cols; col++) {
      const a = offsetToAxial(col, row);
      const key = hexKey(a.q, a.r);
      const owner = layerAt(map.layers.owner, col, row);
      const ground = layerAt(map.layers.terrain, col, row);
      const terrain: Terrain = ground === 'seeded' ? terrainFor(rough(key) + (owner ? spec.get(owner)!.rough : 0)) : ground;
      tiles[key] = { key, q: a.q, r: a.r, terrain, river: false, infrastructure: 0, owner, siteId: null };
    }
  }

  const sites: Record<string, Site> = {};
  for (const s of map.sites) {
    const key = cellKey(s.at);
    const profile = profileOf(s, s.owner ? !!spec.get(s.owner)!.minor : false);
    sites[s.id] = { id: s.id, name: s.name, kind: s.kind, key, owner: s.owner, originalOwner: s.owner, population: profile.pop, victoryPoints: s.victoryPoints ?? profile.vp, yields: { ...profile.yields }, facilities: [] };
    const t = tiles[key]!;
    t.siteId = s.id;
    const open = s.kind === 'depot' || s.kind === 'objective';
    t.terrain = open ? 'plains' : 'urban';
    t.infrastructure = open ? 2 : 3;
  }

  // No city is walled in: the ground next to a site is at worst hills, so its garrison can always
  // march out (a capital ringed by mountains kept its army home on turn 1).
  for (const id of sortedKeys(sites)) {
    for (const k of neighborKeys(sites[id]!.key)) {
      const t = tiles[k];
      if (t && t.terrain === 'mountains' && !t.siteId) t.terrain = 'hills';
    }
  }

  // Every site on the coast is a port: ships enter it, build there, and supply puts to sea from it.
  for (const id of sortedKeys(sites)) {
    const t = tiles[sites[id]!.key]!;
    if (neighborKeys(t.key).some((k) => tiles[k]?.terrain === 'water')) t.port = true;
  }

  const nations: Record<NationId, Nation> = {};
  for (const n of all) {
    nations[n.id] = {
      id: n.id,
      name: n.name,
      color: n.color,
      government: n.government,
      ...(n.minor ? { minor: true } : {}),
      stockpile: n.minor ? { credits: 120, energy: 60, materials: 80, food: 80 } : { credits: 320, energy: 140, materials: 180, food: 160 },
      population: 0,
      stability: 65,
      industrialCapacity: 0,
      researchOutput: 0,
      budget: { research: 10, infrastructure: 10, welfare: 5 },
      research: { current: null, progress: 0, unlocked: [] },
      productionQueue: [],
      construction: [],
      objectives: [],
      warLosses: 0,
      eliminated: false,
    };
  }
  // A power's objectives: the minor states' capitals, the prizes of the war.
  for (const n of powers) nations[n.id]!.objectives = minors.map((m) => capitalOf.get(m.id)!);

  // Every pair starts at war: the powers with each other, the minors with everyone (they only defend).
  // Minor states are at peace with one another: they have no quarrel but survival.
  const relations: Record<string, 'war' | 'peace' | 'alliance'> = {};
  const ids = all.map((n) => n.id).sort();
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++) {
      const a = spec.get(ids[i]!)!;
      const b = spec.get(ids[j]!)!;
      relations[pairKey(a.id, b.id)] = a.minor && b.minor ? 'peace' : 'war';
    }

  const world: WorldState = {
    schema: 2,
    rulesetVersion: RULESET_VERSION,
    scenarioId: setup.scenarioId,
    turn: 1,
    maxTurns: setup.maxTurns,
    seed: seed >>> 0,
    nextId: 1,
    tiles,
    sites,
    nations,
    formations: {},
    relations,
    proposals: [],
    treaties: [],
    intel: {},
    victory: null,
  };

  const raise = (n: NationSpec, unitClass: UnitClass, site: string, counts: Map<UnitClass, number>, readiness = 80): Formation => {
    const c = (counts.get(unitClass) ?? 0) + 1;
    counts.set(unitClass, c);
    const f: Formation = newFormation(world, n.id, unitClass, sites[site]!.key, `${n.name} ${ordinal(c)} ${unitClassName(unitClass)}`);
    f.readiness = readiness;
    f.organization = 70;
    return f;
  };
  for (const n of powers) {
    const counts = new Map<UnitClass, number>();
    const cities = siteIds(n.id, 'city');
    const depots = siteIds(n.id, 'depot');
    if (cities.length < 2 || depots.length < 1) throw new Error(`${map.id}: power ${n.id} needs two cities and a depot for its opening army (has ${cities.length} and ${depots.length})`);
    const where = { capital: capitalOf.get(n.id)!, city0: cities[0]!, city1: cities[1]!, depot0: depots[0]! };
    for (const [unitClass, at] of STARTING_FORCES) raise(n, unitClass, where[at], counts);
    // Garrisons for the far-flung cities and bases beyond the template's two and one.
    for (let i = 2; i < cities.length; i++) raise(n, 'infantry', cities[i]!, counts);
    // Outpost garrisons: a reinforced company, not a division.
    for (let i = 1; i < depots.length; i++) {
      const f = raise(n, 'infantry', depots[i]!, counts);
      if (map.sites.find((s) => s.id === depots[i])!.profile === 'outpost') f.strength = 500;
    }
    if (n.navy) {
      // At sea off the home port: the nearest open sea hexes, a full stack of ships to each (sorted,
      // so every seed agrees).
      const port = Object.values(sites).find((s) => s.name === n.navy!.port);
      if (!port || port.owner !== n.id) throw new Error(`${map.id}: ${n.id}'s navy port ${n.navy.port} is not one of its sites`);
      if (!tiles[port.key]!.port) throw new Error(`${port.name} is not a port`);
      const sea = seaNear(tiles, port.key, Math.ceil(n.navy.ships.length / STACK_LIMIT));
      n.navy.ships.forEach((c, i) => {
        const key = sea[Math.floor(i / STACK_LIMIT)]!;
        const c2 = (counts.get(c) ?? 0) + 1;
        counts.set(c, c2);
        const f = newFormation(world, n.id, c, key, `${n.name} ${ordinal(c2)} ${unitClassName(c)}`);
        f.readiness = 80;
        f.organization = 70;
        // Ready to go from turn 1: transports sail with their marines aboard, carriers with the
        // nation's helicopters and drones on deck.
        if (c === 'transport') {
          for (let m = 0; m < 2; m++) {
            const k2 = (counts.get('infantry') ?? 0) + 1;
            counts.set('infantry', k2);
            const marines = newFormation(world, n.id, 'infantry', key, `${n.name} ${k2}${['th', 'st', 'nd', 'rd'][k2 % 10 < 4 && (k2 < 11 || k2 > 13) ? k2 % 10 : 0] ?? 'th'} Marine Regiment`);
            marines.readiness = 80;
            marines.organization = 70;
            marines.aboard = f.id;
          }
        }
        if (c === 'carrier') {
          // The carrier's own air wing: a helicopter wing and a drone company on deck. The air bases
          // ashore keep theirs.
          for (const wing of ['air', 'drone'] as const) {
            const k2 = (counts.get(wing) ?? 0) + 1;
            counts.set(wing, k2);
            const w = newFormation(world, n.id, wing, key, `${n.name} ${ordinal(k2)} ${unitClassName(wing)} (carrier)`);
            w.readiness = 80;
            w.organization = 70;
            w.aboard = f.id;
          }
        }
      });
    }
  }
  for (const n of minors) {
    // Militia: infantry in every city, a recon screen at the capital, not yet at full readiness.
    const counts = new Map<UnitClass, number>();
    const capital = capitalOf.get(n.id)!;
    raise(n, 'infantry', capital, counts, 60);
    raise(n, 'recon', capital, counts, 60);
    for (const city of siteIds(n.id, 'city')) {
      raise(n, 'infantry', city, counts, 60);
      for (const c of n.militia ?? []) raise(n, c, city, counts, 60);
    }
  }
  parity(world, powers, capitalOf, raise);
  for (const n of all) {
    nations[n.id]!.industrialCapacity = grossYields(world, n.id).industry;
    nations[n.id]!.population = Object.values(sites)
      .filter((s) => s.owner === n.id)
      .reduce((a, s) => a + s.population, 0);
  }

  // Every power owns an atlas: the land and its borders are known from the start (as of turn 0).
  // Armies are not: enemy units show only once seen.
  for (const id of ids) {
    const intel = emptyIntel();
    for (const key of sortedKeys(world.tiles)) {
      intel.observed[key] = 0;
      intel.knownOwner[key] = world.tiles[key]!.owner;
    }
    world.intel[id] = intel;
    updateIntel(world, id, computeVision(world, id), 0);
  }
  // Every power opens with its doctrine: a hand of three and its first Command Points.
  initDoctrine(world);
  return world;
}

/**
 * Every power starts level (docs/pacific.md): however big its country, each starts with the same
 * victory points, the same output and an army of the same weight. Victory points and yields are
 * scaled across each power's own sites, so where its strength lies is unchanged; armies are topped
 * up with garrisons in its own cities.
 */
function parity(world: WorldState, specs: readonly NationSpec[], capitalOf: ReadonlyMap<NationId, string>, raise: (n: NationSpec, c: UnitClass, site: string, counts: Map<UnitClass, number>) => void): void {
  const powers = specs.map((n) => n.id);
  const sitesOf = (p: NationId) => sortedKeys(world.sites).map((id) => world.sites[id]!).filter((s) => s.owner === p);
  const mean = (f: (p: NationId) => number) => Math.round(powers.reduce((a, p) => a + f(p), 0) / powers.length);
  const capital = (p: NationId) => world.sites[capitalOf.get(p)!]!;

  // Victory points: each power's sites scaled to the mean, the remainder on its capital.
  const vp = (p: NationId) => sitesOf(p).reduce((a, s) => a + s.victoryPoints, 0);
  const vpTarget = mean(vp);
  for (const p of powers) {
    const total = vp(p);
    for (const s of sitesOf(p)) if (s.kind !== 'capital') s.victoryPoints = Math.max(1, Math.round((s.victoryPoints * vpTarget) / total));
    capital(p).victoryPoints = Math.max(1, capital(p).victoryPoints + vpTarget - vp(p));
  }

  // Output: every yield of every site scaled so the power's raw output (its cities' own yields,
  // before its government's bent) meets the mean. A government's trade stays its own: the
  // Commonwealth's richer treasury pays for its modest army, the Directorate's industry for its
  // brittle home front.
  const output = (p: NationId) => sitesOf(p).reduce((a, s) => a + s.yields.credits + s.yields.energy + s.yields.materials + s.yields.food + s.yields.industry, 0);
  const outTarget = mean(output);
  for (const p of powers) {
    const pct = Math.round((outTarget * 100) / output(p));
    for (const s of sitesOf(p)) for (const k of sortedKeys(s.yields) as (keyof Yields)[]) s.yields[k] = Math.floor((s.yields[k] * pct) / 100);
    // What the rounding lost (or gained) the capital's industry makes up, so the totals match exactly.
    capital(p).yields.industry = Math.max(0, capital(p).yields.industry + outTarget - output(p));
  }

  // Land pays too: a credit a turn for every `RULES.hexesPerCredit` hexes held. A small power was a
  // quarter poorer in credits than its rivals for all the parity above (ruleset 2.6.0). Every power
  // below the best-landed is paid the difference on its cities' treasuries, the remainder on its
  // capital; nobody's is cut.
  const land = (p: NationId) => Math.floor(Object.values(world.tiles).filter((t) => t.owner === p).length / RULES.hexesPerCredit);
  const most = Math.max(...powers.map(land));
  for (const p of powers) {
    const gap = most - land(p);
    const towns = sitesOf(p).filter((s) => s.kind === 'city');
    const each = towns.length ? Math.floor(gap / (towns.length + 1)) : 0;
    for (const s of towns) s.yields.credits += each;
    capital(p).yields.credits += gap - each * towns.length;
  }

  // Army: the lighter powers raise garrisons (infantry, then mechanized, then artillery) in their
  // own cities, capital first, until they weigh what the heaviest does.
  const weight = (p: NationId) => Object.values(world.formations).filter((f) => f.owner === p).reduce((a, f) => a + f.strength, 0);
  const heaviest = Math.max(...powers.map(weight));
  const kinds: UnitClass[] = ['infantry', 'mechanized', 'artillery'];
  for (const n of specs) {
    const counts = new Map<UnitClass, number>();
    for (const f of Object.values(world.formations)) if (f.owner === n.id) counts.set(f.unitClass, (counts.get(f.unitClass) ?? 0) + 1);
    const places = sitesOf(n.id).filter((s) => s.kind !== 'depot').map((s) => s.id);
    let i = 0;
    for (let guard = 0; guard < 40 && weight(n.id) + 500 < heaviest; guard++) {
      const site = places.find((id) => Object.values(world.formations).filter((f) => f.key === world.sites[id]!.key && !f.aboard && !UNITS[f.unitClass].naval).length < STACK_LIMIT);
      if (!site) break;
      raise(n, kinds[i++ % kinds.length]!, site, counts);
    }
  }
}

/** The `count` open sea hexes nearest a port, nearest first, ties by key. */
function seaNear(tiles: Record<HexKey, Tile>, from: HexKey, count: number): HexKey[] {
  const out: HexKey[] = [];
  const seen = new Set<HexKey>([from]);
  let ring: HexKey[] = [from];
  while (out.length < count && ring.length > 0) {
    const next: HexKey[] = [];
    for (const k of ring)
      for (const m of neighborKeys(k)) {
        if (seen.has(m) || tiles[m]?.terrain !== 'water') continue;
        seen.add(m);
        next.push(m);
      }
    next.sort();
    out.push(...next);
    ring = next;
  }
  if (out.length < count) throw new Error(`no room at sea off ${from}`);
  return out.slice(0, count);
}

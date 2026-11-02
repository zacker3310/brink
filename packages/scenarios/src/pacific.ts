import type { Formation, GovernmentId, HexKey, Nation, NationId, Site, SiteKind, Terrain, Tile, UnitClass, WorldState, Yields } from '@brink/contracts';
import { RULESET_VERSION, STACK_LIMIT } from '@brink/game-data';
import { hexKey, keyDistance, keyOf, neighborKeys, offsetToAxial } from '@brink/map';
import { computeVision, emptyIntel, grossYields, mulberry32, newFormation, pairKey, sortedKeys, updateIntel } from '@brink/simulation';

// The Pacific: four real powers (the United States, Russia, China, Japan) around a compressed ocean,
// seven independent states between them, and island chains to fight over. The map runs from Moscow
// in the west to Washington in the east: all of Russia and all of the United States, with the
// ocean squeezed so the war is on land and sea alike. The geography is drawn
// below as a character grid, so coastlines and borders never change; the seed varies only the ground
// inside each country (forest, hills, mountains). Design: docs/pacific.md.

export const PACIFIC_ID = 'pacific';
export const COLS = 42;
export const ROWS = 20;
export const MAX_TURNS = 30;

/**
 * One character per hex, odd rows offset half a hex to the right (the engine's offset layout).
 * `.` sea. Powers: R Russia, C China, J Japan, U United States (coast to coast, Alaska, the
 * Aleutians, Hawaii, Guam). Minor states: K Canada, M Mexico, N North Korea, S South Korea, T Taiwan,
 * Z Kazakhstan, G Mongolia.
 */
const GRID: readonly string[] = [
  'RRRRRRRRRRRRRRRRRRRRRRRRR.UUUUUKKKKKKKKKK.', // 0  Siberia, the Bering Strait, Alaska, the Yukon
  'RRRRRRRRRRRRRRRRRRRRRRRRR.UUUUUUKKKKKKKKK.', // 1  St Petersburg, Yakutsk
  'RRRRRRRRRRRRRRRRRRR..RRR..UUUUUUKKKKKKKKK.', // 2  the Sea of Okhotsk, Kamchatka
  'RRRRRRRRRRRRRRRRRR...RR....UUUUUKKKKKKKKK.', // 3  Moscow, Anchorage
  'RRRRRRRRRRRRRRRRRR.R.R.....U....KKKKKKKKK.', // 4  Sakhalin, the Alaska Peninsula
  'RRRRRRRRRRRRRRRRRR....R.U.U.....KKKKKKKKK.', // 5  the Kurils, the Aleutians
  'ZZZZZZZRRGGGGGCCRR..JJ......KKKKKKKKKKKKK.', // 6  Kazakhstan, Mongolia, Vladivostok, Hokkaido, Vancouver
  'ZZZZZZZCGGGGGCCCNN.JJJ......UUUUUUUUUUUUU.', // 7  Korea, Honshu, Seattle
  'ZZZZZZCCCCCCCCCC.S..JJ......UUUUUUUUUUUUU.', // 8  Seoul, Tokyo, New York
  'ZZZZZZCCCCCCCCCC.SS.J.......UUUUUUUUUUUUU.', // 9
  'CCCCCCCCCCCCCCCC....J.......UUUUUUUUUUUUU.', // 10 Shanghai, Kyushu, Washington
  'CCCCCCCCCCCCCCCC............UUUUUUUUUUUUU.', // 11
  'CCCCCCCCCCCCCCCC........UU..UUUUUUUUUUUUU.', // 12 Hawaii
  'CCCCCCCCCCCCCCC.T...........UUUUUUUUUUUUU.', // 13 Taiwan
  'CCCCCCCCCCCCCCC.T...........UUUUUUUUUUUUU.', // 14
  'CCCCCCCCCCCCCCC......U.......MMMMMMMMMM...', // 15 Guam, Baja
  'CCCCCCCCCCCCCC...............MMMMMMMM.....', // 16
  'CCCCCCCCCCCCC.................MMMMMM......', // 17 Mexico City
  'CCCCCCCCCCCC...................MMMMM......', // 18
  '..CCCCCCCC......................MMM.......', // 19
];

const REGION: Record<string, NationId> = { R: 'russia', C: 'china', J: 'japan', U: 'usa', K: 'canada', M: 'mexico', N: 'nkorea', S: 'skorea', T: 'taiwan', Z: 'kazakhstan', G: 'mongolia' };

type Place = [col: number, row: number, name: string];

interface NationSpec {
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

/** The four powers a player can lead. */
export const NATIONS: readonly NationSpec[] = [
  {
    id: 'usa',
    short: 'USA',
    name: 'United States',
    color: '#4f8fe0',
    government: 'commonwealth',
    capital: [40, 10, 'Washington'],
    // The west coast first: the opening army stands where the Pacific war is.
    cities: [
      [28, 10, 'San Francisco'],
      [28, 13, 'Los Angeles'],
      [28, 7, 'Seattle'],
      [25, 12, 'Honolulu'],
      [40, 8, 'New York'],
      [35, 8, 'Chicago'],
    ],
    // The far-flung bases: a frontier town in Alaska and two island outposts.
    depots: [
      [28, 3, 'Anchorage'],
      [21, 15, 'Guam'],
      [24, 5, 'Adak'],
      [34, 12, 'Houston'],
    ],
    rough: 10,
    navy: { port: 'San Francisco', ships: ['fleet', 'transport', 'transport', 'carrier'] },
  },
  {
    id: 'russia',
    short: 'Russia',
    name: 'Russia',
    color: '#d0543e',
    government: 'directorate',
    capital: [2, 3, 'Moscow'],
    // The Far East first: the opening army stands on the Pacific front, Moscow keeps its guard.
    cities: [
      [17, 6, 'Vladivostok'],
      [16, 4, 'Khabarovsk'],
      [1, 1, 'St Petersburg'],
      [22, 3, 'Petropavlovsk'],
      [9, 4, 'Novosibirsk'],
    ],
    depots: [
      [19, 4, 'Sakhalin'],
      [13, 1, 'Yakutsk'],
      [5, 2, 'Yekaterinburg'],
    ],
    rough: 30,
    navy: { port: 'Vladivostok', ships: ['fleet', 'transport', 'carrier'] },
  },
  {
    id: 'china',
    short: 'China',
    name: 'China',
    color: '#e0b43c',
    government: 'union',
    capital: [12, 8, 'Beijing'],
    cities: [
      [15, 10, 'Shanghai'],
      [14, 15, 'Guangzhou'],
      [14, 6, 'Harbin'],
      [8, 12, 'Chengdu'],
      [9, 10, "Xi'an"],
    ],
    depots: [
      [11, 11, 'Wuhan'],
      [2, 11, 'Urumqi'],
    ],
    rough: -10,
    navy: { port: 'Shanghai', ships: ['fleet', 'transport', 'transport', 'carrier'] },
  },
  {
    id: 'japan',
    short: 'Japan',
    name: 'Japan',
    color: '#e8e8ee',
    government: 'federation',
    capital: [21, 8, 'Tokyo'],
    cities: [
      [20, 9, 'Osaka'],
      [20, 6, 'Sapporo'],
      [20, 10, 'Fukuoka'],
    ],
    depots: [[21, 7, 'Sendai']],
    rough: 35,
    // An island nation's navy: two carrier groups and the lift to put an army ashore.
    navy: { port: 'Tokyo', ships: ['carrier', 'carrier', 'fleet', 'transport', 'transport'] },
  },
];

/** The independent states between the powers. */
export const MINORS: readonly NationSpec[] = [
  { id: 'canada', short: 'Canada', name: 'Canada', color: '#b9424f', government: 'commonwealth', minor: true, militia: ['infantry', 'mechanized'], capital: [38, 5, 'Ottawa'], cities: [[28, 6, 'Vancouver'], [33, 5, 'Calgary'], [32, 2, 'Whitehorse']], depots: [], rough: 25 },
  { id: 'mexico', short: 'Mexico', name: 'Mexico', color: '#3e9a62', government: 'union', minor: true, militia: ['infantry', 'infantry'], capital: [33, 17, 'Mexico City'], cities: [[29, 15, 'Tijuana'], [31, 16, 'Guadalajara'], [36, 15, 'Monterrey']], depots: [], rough: 30 },
  { id: 'nkorea', short: 'N. Korea', name: 'North Korea', color: '#8a5ab8', government: 'directorate', minor: true, capital: [16, 7, 'Pyongyang'], cities: [[17, 7, 'Wonsan']], depots: [], rough: 45 },
  { id: 'skorea', short: 'S. Korea', name: 'South Korea', color: '#3fa7b5', government: 'federation', minor: true, capital: [17, 8, 'Seoul'], cities: [[18, 9, 'Busan']], depots: [], rough: 30 },
  { id: 'taiwan', short: 'Taiwan', name: 'Taiwan', color: '#c97ab0', government: 'federation', minor: true, capital: [16, 13, 'Taipei'], cities: [[16, 14, 'Kaohsiung']], depots: [], rough: 40 },
  { id: 'kazakhstan', short: 'Kazakh.', name: 'Kazakhstan', color: '#8fae3a', government: 'directorate', minor: true, militia: ['infantry'], capital: [3, 7, 'Astana'], cities: [[4, 9, 'Almaty']], depots: [], rough: 0 },
  { id: 'mongolia', short: 'Mongolia', name: 'Mongolia', color: '#a8744a', government: 'federation', minor: true, capital: [11, 7, 'Ulaanbaatar'], cities: [[9, 6, 'Khovd']], depots: [], rough: 15 },
];

const ALL: readonly NationSpec[] = [...NATIONS, ...MINORS];

/** A nation's short name for map labels and small tiles; the full name if it is not one of ours. */
export function shortName(name: string): string {
  return ALL.find((n) => n.name === name)?.short ?? name;
}

/** Victory points by site name where a place is worth more than its size: what the war is about. */
const PRIZE: Record<string, number> = {
  Taipei: 9,
  Seoul: 8,
  'Mexico City': 8,
  Ottawa: 8,
  Pyongyang: 6,
  // The United States' many cities count for a little less, so it starts level with Russia and
  // China on the scoreboard rather than ahead. (Japan stays small: a richer Japan is only a juicier
  // target for Russia.)
  'New York': 3,
  Chicago: 3,
  Honolulu: 4,
  Houston: 1,
};

/** Island outposts: a runway and a harbour, worth little in themselves; their worth is where they are. */
const OUTPOSTS = new Set(['Guam', 'Adak']);

const at = (col: number, row: number): HexKey => keyOf(offsetToAxial(col, row));

function yields(y: Partial<Yields>): Yields {
  return { credits: 0, energy: 0, materials: 0, food: 0, industry: 0, research: 0, ...y };
}

const SITE_PROFILE: Record<'capital' | 'city' | 'depot', { vp: number; pop: number; yields: Yields }> = {
  capital: { vp: 10, pop: 2400, yields: yields({ credits: 32, energy: 12, materials: 12, food: 16, industry: 34, research: 8 }) },
  city: { vp: 5, pop: 900, yields: yields({ credits: 14, energy: 6, materials: 8, food: 9, industry: 16, research: 3 }) },
  depot: { vp: 2, pop: 100, yields: yields({ credits: 2, energy: 4, materials: 4, food: 2, industry: 4 }) },
};

const OUTPOST_PROFILE = { vp: 1, pop: 40, yields: yields({ credits: 1, energy: 1, materials: 1, food: 1, industry: 1 }) };

/** A minor state's capital and cities: smaller economies, same victory points (they are the prize). */
const MINOR_PROFILE: Record<'capital' | 'city', { vp: number; pop: number; yields: Yields }> = {
  capital: { vp: 6, pop: 1400, yields: yields({ credits: 14, energy: 6, materials: 6, food: 8, industry: 10, research: 3 }) },
  city: { vp: 4, pop: 600, yields: yields({ credits: 8, energy: 4, materials: 4, food: 5, industry: 6, research: 1 }) },
};

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

/** Owner of a grid cell, or null for sea. */
function regionAt(col: number, row: number): NationId | null {
  const ch = GRID[row]?.[col];
  if (ch === undefined) throw new Error(`grid has no cell ${col},${row}`);
  return ch === '.' ? null : (REGION[ch] ?? null);
}

function texture(seed: number): (key: HexKey) => number {
  // Soft blobs of roughness; deterministic in the seed, never used during play.
  const next = mulberry32(seed ^ 0x2f6b1a3d);
  const blobs = Array.from({ length: 28 }, () => ({
    col: next() % COLS,
    row: next() % ROWS,
    radius: 2 + (next() % 3),
    kind: (['forest', 'hills', 'forest', 'plains', 'hills', 'forest'] as const)[next() % 6]!,
  }));
  const noise = new Map<HexKey, number>();
  for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) noise.set(at(col, row), next() % 100);
  return (key) => {
    let v = noise.get(key) ?? 0;
    for (const b of blobs) {
      if (keyDistance(key, at(b.col, b.row)) <= b.radius) v += b.kind === 'hills' ? 40 : b.kind === 'forest' ? 25 : -30;
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

/** The one theatre. Kept as a list so saves and the setup screen read theatres as before. */
export interface Theatre {
  id: string;
  name: string;
  summary: string;
  /** Wars you must have won to play it. */
  unlock: number;
}

export const THEATRES: readonly Theatre[] = [
  { id: PACIFIC_ID, name: 'The Pacific', summary: 'Moscow to Washington: four powers, seven nations caught between them, and an ocean of islands.', unlock: 0 },
];

export function theatreOf(id: string): Theatre | undefined {
  return THEATRES.find((t) => t.id === id);
}

export function createPacificScenario(seed: number): WorldState {
  const rough = texture(seed);
  const tiles: Record<HexKey, Tile> = {};
  const spec = new Map(ALL.map((n) => [n.id, n]));
  for (let row = 0; row < ROWS; row++) {
    if (GRID[row]!.length !== COLS) throw new Error(`grid row ${row} is ${GRID[row]!.length} wide, not ${COLS}`);
    for (let col = 0; col < COLS; col++) {
      const a = offsetToAxial(col, row);
      const key = hexKey(a.q, a.r);
      const owner = regionAt(col, row);
      const terrain: Terrain = owner === null ? 'water' : terrainFor(rough(key) + spec.get(owner)!.rough);
      tiles[key] = { key, q: a.q, r: a.r, terrain, river: false, infrastructure: 0, owner, siteId: null };
    }
  }

  const sites: Record<string, Site> = {};
  const placeSite = (id: string, [col, row, name]: Place, kind: SiteKind, owner: NationId, profile: { vp: number; pop: number; yields: Yields }) => {
    if (regionAt(col, row) !== owner) throw new Error(`${name} at ${col},${row} is not on ${owner} ground`);
    const key = at(col, row);
    if (tiles[key]!.siteId) throw new Error(`${name} at ${col},${row} shares a hex with ${tiles[key]!.siteId}`);
    const vp = PRIZE[name] ?? profile.vp;
    sites[id] = { id, name, kind, key, owner, originalOwner: owner, population: profile.pop, victoryPoints: vp, yields: { ...profile.yields }, facilities: [] };
    const t = tiles[key]!;
    t.siteId = id;
    t.terrain = kind === 'depot' ? 'plains' : 'urban';
    t.infrastructure = kind === 'depot' ? 2 : 3;
  };

  for (const n of ALL) {
    const profile = n.minor ? MINOR_PROFILE : SITE_PROFILE;
    placeSite(`${n.id}-capital`, n.capital, 'capital', n.id, profile.capital);
    n.cities.forEach((p, i) => placeSite(`${n.id}-city${i}`, p, 'city', n.id, profile.city));
    n.depots.forEach((p, i) => placeSite(`${n.id}-depot${i}`, p, 'depot', n.id, OUTPOSTS.has(p[2]) ? OUTPOST_PROFILE : SITE_PROFILE.depot));
  }

  // Every site on the coast is a port: ships enter it, build there, and supply puts to sea from it.
  for (const id of sortedKeys(sites)) {
    const t = tiles[sites[id]!.key]!;
    if (neighborKeys(t.key).some((k) => tiles[k]?.terrain === 'water')) t.port = true;
  }

  const nations: Record<NationId, Nation> = {};
  for (const n of ALL) {
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
  // A power's objectives: the capitals of the minor states it is at war with, the prizes of the war.
  for (const n of NATIONS) nations[n.id]!.objectives = MINORS.filter((m) => !(n.id === 'usa' && (m.id === 'canada' || m.id === 'mexico'))).map((m) => `${m.id}-capital`);

  // Every pair starts at war: the powers with each other, the minors with everyone (they only defend).
  const relations: Record<string, 'war' | 'peace' | 'alliance'> = {};
  const ids = ALL.map((n) => n.id).sort();
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const a = spec.get(ids[i]!)!;
    const b = spec.get(ids[j]!)!;
    // Minor states are at peace with one another: they have no quarrel but survival. Canada and
    // Mexico are at peace with the United States: its war is across the ocean, not on its doorstep.
    const neighbours = (x: NationSpec, y: NationSpec) => x.id === 'usa' && (y.id === 'canada' || y.id === 'mexico');
    relations[pairKey(a.id, b.id)] = (a.minor && b.minor) || neighbours(a, b) || neighbours(b, a) ? 'peace' : 'war';
  }

  const world: WorldState = {
    schema: 2,
    rulesetVersion: RULESET_VERSION,
    scenarioId: PACIFIC_ID,
    turn: 1,
    maxTurns: MAX_TURNS,
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

  const raise = (n: NationSpec, unitClass: UnitClass, site: string, counts: Map<UnitClass, number>, readiness = 80) => {
    const c = (counts.get(unitClass) ?? 0) + 1;
    counts.set(unitClass, c);
    const f: Formation = newFormation(world, n.id, unitClass, sites[site]!.key, `${n.name} ${c}${['th', 'st', 'nd', 'rd'][c] ?? 'th'} ${unitClassName(unitClass)}`);
    f.readiness = readiness;
    f.organization = 70;
  };
  for (const n of NATIONS) {
    const counts = new Map<UnitClass, number>();
    const where = { capital: `${n.id}-capital`, city0: `${n.id}-city0`, city1: `${n.id}-city1`, depot0: `${n.id}-depot0` };
    for (const [unitClass, place] of STARTING_FORCES) raise(n, unitClass, where[place], counts);
    // Garrisons for the far-flung cities and bases beyond the template's two and one.
    for (let i = 2; i < n.cities.length; i++) raise(n, 'infantry', `${n.id}-city${i}`, counts);
    // Outpost garrisons: a reinforced company, not a division.
    for (let i = 1; i < n.depots.length; i++) {
      raise(n, 'infantry', `${n.id}-depot${i}`, counts);
      const last = Object.values(world.formations).at(-1)!;
      if (OUTPOSTS.has(n.depots[i]![2])) last.strength = 500;
    }
    if (n.navy) {
      // At sea off the home port: the nearest open sea hexes, a full stack of ships to each (sorted,
      // so every seed agrees).
      const port = Object.values(sites).find((s) => s.name === n.navy!.port)!;
      if (!tiles[port.key]!.port) throw new Error(`${port.name} is not a port`);
      const sea = seaNear(tiles, port.key, Math.ceil(n.navy.ships.length / STACK_LIMIT));
      n.navy.ships.forEach((c, i) => {
        const key = sea[Math.floor(i / STACK_LIMIT)]!;
        const c2 = (counts.get(c) ?? 0) + 1;
        counts.set(c, c2);
        const f = newFormation(world, n.id, c, key, `${n.name} ${c2}${['th', 'st', 'nd', 'rd'][c2] ?? 'th'} ${unitClassName(c)}`);
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
            const w = newFormation(world, n.id, wing, key, `${n.name} ${k2}${['th', 'st', 'nd', 'rd'][k2] ?? 'th'} ${unitClassName(wing)} (carrier)`);
            w.readiness = 80;
            w.organization = 70;
            w.aboard = f.id;
          }
        }
      });
    }
  }
  for (const n of MINORS) {
    // Militia: infantry in every city, a recon screen at the capital, not yet at full readiness.
    const counts = new Map<UnitClass, number>();
    raise(n, 'infantry', `${n.id}-capital`, counts, 60);
    raise(n, 'recon', `${n.id}-capital`, counts, 60);
    n.cities.forEach((_, i) => {
      raise(n, 'infantry', `${n.id}-city${i}`, counts, 60);
      for (const c of n.militia ?? []) raise(n, c, `${n.id}-city${i}`, counts, 60);
    });
  }
  for (const n of ALL) {
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
  return world;
}

/** The `count` open sea hexes nearest a port, nearest first, ties by key. */
function seaNear(tiles: Record<HexKey, Tile>, from: HexKey, count: number): HexKey[] {
  const out: HexKey[] = [];
  const seen = new Set<HexKey>([from]);
  let ring: HexKey[] = [from];
  while (out.length < count && ring.length > 0) {
    const next: HexKey[] = [];
    for (const k of ring) for (const m of neighborKeys(k)) {
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

function unitClassName(c: UnitClass): string {
  return { infantry: 'Infantry', mechanized: 'Mechanized', armor: 'Armored', artillery: 'Artillery', recon: 'Recon', air: 'Aviation', drone: 'Drone Company', fleet: 'Fleet', transport: 'Amphibious Group', carrier: 'Carrier Group' }[c];
}

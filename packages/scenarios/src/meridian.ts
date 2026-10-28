import type { Formation, GovernmentId, HexKey, Nation, NationId, Site, SiteKind, Terrain, Tile, UnitClass, WorldState, Yields } from '@brink/contracts';
import { RULESET_VERSION } from '@brink/game-data';
import { hexKey, keyDistance, keyOf, neighborKeys, offsetToAxial } from '@brink/map';
import { computeVision, emptyIntel, grossYields, mulberry32, newFormation, pairKey, sortedKeys, updateIntel } from '@brink/simulation';

// The Meridian Crisis: four fictional states around a contested central basin. Geography is
// hand-placed (capitals, cities, the river, the ridges); the seed varies the ground texture
// between them, so every seed gives a fair, recognisable map.

export const MERIDIAN_ID = 'meridian-crisis';
export const COLS = 18;
export const ROWS = 13;
export const MAX_TURNS = 30;

interface NationSpec {
  id: NationId;
  name: string;
  color: string;
  government: GovernmentId;
  capital: [number, number, string];
  cities: [number, number, string][];
  depot: [number, number, string];
}

export const NATIONS: readonly NationSpec[] = [
  {
    id: 'aster',
    name: 'Aster Commonwealth',
    color: '#3fa796',
    government: 'commonwealth',
    capital: [2, 2, 'Port Aster'],
    cities: [
      [6, 1, 'Larkhaven'],
      [1, 5, 'Wexmoor'],
    ],
    depot: [5, 4, 'Fenwick Depot'],
  },
  {
    id: 'korva',
    name: 'Korva Directorate',
    color: '#c9733a',
    government: 'directorate',
    capital: [15, 2, 'Korvagrad'],
    cities: [
      [11, 1, 'Steelreach'],
      [16, 5, 'Halvik'],
    ],
    depot: [12, 4, 'Ironmere Depot'],
  },
  {
    id: 'selmar',
    name: 'Selmar Federation',
    color: '#9b6bc4',
    government: 'federation',
    capital: [2, 10, 'Selmar'],
    cities: [
      [6, 11, 'Quillon'],
      [1, 7, 'Ardent'],
    ],
    depot: [5, 8, 'Thorne Depot'],
  },
  {
    id: 'drevan',
    name: 'Drevan Union',
    color: '#b5a642',
    government: 'union',
    capital: [15, 10, 'Drevansk'],
    cities: [
      [11, 11, 'Morrow'],
      [16, 7, 'Kessel'],
    ],
    depot: [12, 8, 'Garrow Depot'],
  },
];

const OBJECTIVES: [number, number, string, Partial<Yields>][] = [
  [8, 6, 'Vessa', { credits: 16, energy: 4, materials: 4, food: 4, industry: 10, research: 6 }],
  [9, 3, 'Halden Fields', { energy: 18, credits: 4 }],
  [9, 9, 'Corrin Mines', { materials: 18, credits: 4 }],
];

const at = (col: number, row: number): HexKey => keyOf(offsetToAxial(col, row));

function yields(y: Partial<Yields>): Yields {
  return { credits: 0, energy: 0, materials: 0, food: 0, industry: 0, research: 0, ...y };
}

const SITE_PROFILE: Record<Exclude<SiteKind, 'objective'>, { vp: number; pop: number; yields: Yields }> = {
  capital: { vp: 10, pop: 2400, yields: yields({ credits: 32, energy: 12, materials: 12, food: 16, industry: 34, research: 8 }) },
  city: { vp: 5, pop: 900, yields: yields({ credits: 14, energy: 6, materials: 8, food: 9, industry: 16, research: 3 }) },
  depot: { vp: 2, pop: 100, yields: yields({ credits: 2, energy: 4, materials: 4, food: 2, industry: 4 }) },
};

const STARTING_FORCES: readonly [UnitClass, 'capital' | 'city0' | 'city1' | 'depot'][] = [
  ['infantry', 'capital'],
  ['armor', 'capital'],
  ['air', 'capital'],
  ['drone', 'city0'],
  ['infantry', 'city0'],
  ['mechanized', 'city0'],
  ['infantry', 'city1'],
  ['artillery', 'city1'],
  ['recon', 'depot'],
  ['infantry', 'depot'],
];

function texture(seed: number): (key: HexKey) => number {
  // A few soft blobs of "roughness"; deterministic in the seed, never used during play.
  const next = mulberry32(seed ^ 0x5bd1e995);
  const blobs = Array.from({ length: 9 }, () => ({
    col: next() % COLS,
    row: next() % ROWS,
    radius: 2 + (next() % 3),
    kind: (['forest', 'forest', 'hills', 'forest', 'hills', 'plains', 'forest', 'hills', 'plains'] as const)[next() % 9]!,
  }));
  const noise = new Map<HexKey, number>();
  for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) noise.set(at(col, row), next() % 100);
  return (key) => {
    let v = noise.get(key) ?? 0;
    for (const b of blobs) {
      const d = keyDistance(key, at(b.col, b.row));
      if (d <= b.radius) v += b.kind === 'hills' ? 40 : b.kind === 'forest' ? 25 : -30;
    }
    return v;
  };
}

function terrainFor(col: number, row: number, rough: number): Terrain {
  // The Spine: a broken north-south ridge that splits east from west, with two passes.
  const spine = col === 8 || col === 9;
  const pass = row === 3 || row === 6 || row === 9;
  if (spine && !pass) return rough > 60 ? 'mountains' : 'hills';
  // The Meridian Sound: water cutting into the basin from north and south.
  if ((row === 0 || row === 12) && (col === 8 || col === 9)) return 'water';
  if ((col === 0 || col === 17) && (row === 0 || row === 12)) return 'water';
  if (rough > 120) return 'mountains';
  if (rough > 95) return 'hills';
  if (rough > 70) return 'forest';
  return 'plains';
}

/**
 * Theatres: the same four powers and cities on different ground. The Meridian is the classic map;
 * the others unlock as you win wars.
 */
export interface Theatre {
  id: string;
  name: string;
  summary: string;
  /** Added to every hex's roughness: more ridges and woods above zero, open ground below. */
  rough: number;
  /** Rows the rivers run along. */
  rivers: readonly number[];
  /** Wars you must have won to play it. */
  unlock: number;
}

export const THEATRES: readonly Theatre[] = [
  { id: MERIDIAN_ID, name: 'The Meridian Crisis', summary: 'The classic basin: one river, one ridge, two passes.', rough: 0, rivers: [6], unlock: 0 },
  { id: 'highland-front', name: 'The Highland Front', summary: 'Ridges and pine forest: slow going, deadly for armour, a gift to infantry.', rough: 38, rivers: [6], unlock: 1 },
  { id: 'varn-delta', name: 'The Varn Delta', summary: 'Flat, open, cut by three rivers: every advance is a crossing.', rough: -28, rivers: [3, 6, 9], unlock: 2 },
];

export function theatreOf(id: string): Theatre | undefined {
  return THEATRES.find((t) => t.id === id);
}

/** The rivers run east-west, so north and south must cross them. */
function hasRiver(t: Theatre, col: number, row: number): boolean {
  return t.rivers.includes(row) && col >= 2 && col <= 15;
}

export function createMeridianScenario(seed: number, theatreId: string = MERIDIAN_ID): WorldState {
  const theatre = theatreOf(theatreId);
  if (!theatre) throw new Error(`unknown theatre: ${theatreId}`);
  const rough = texture(seed);
  const tiles: Record<HexKey, Tile> = {};
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const a = offsetToAxial(col, row);
      const key = hexKey(a.q, a.r);
      tiles[key] = { key, q: a.q, r: a.r, terrain: terrainFor(col, row, rough(key) + theatre.rough), river: hasRiver(theatre, col, row), infrastructure: 0, owner: null, siteId: null };
    }
  }

  const sites: Record<string, Site> = {};
  const placeSite = (id: string, name: string, kind: SiteKind, key: HexKey, owner: NationId | null, profile: { vp: number; pop: number; yields: Yields }) => {
    sites[id] = { id, name, kind, key, owner, originalOwner: owner, population: profile.pop, victoryPoints: profile.vp, yields: { ...profile.yields } };
    const t = tiles[key]!;
    t.siteId = id;
    t.terrain = kind === 'depot' ? 'plains' : 'urban';
    t.river = false;
    t.infrastructure = kind === 'depot' ? 2 : 3;
    for (const k of neighborKeys(key)) {
      const n = tiles[k];
      if (!n) continue;
      if (n.terrain === 'water' || n.terrain === 'mountains') n.terrain = 'plains';
      n.infrastructure = Math.max(n.infrastructure, kind === 'capital' ? 2 : 1);
    }
  };

  const capitals: [NationId, HexKey][] = [];
  for (const n of NATIONS) {
    const cap = at(n.capital[0], n.capital[1]);
    capitals.push([n.id, cap]);
    placeSite(`${n.id}-capital`, n.capital[2], 'capital', cap, n.id, SITE_PROFILE.capital);
    n.cities.forEach(([c, r, name], i) => placeSite(`${n.id}-city${i}`, name, 'city', at(c, r), n.id, SITE_PROFILE.city));
    placeSite(`${n.id}-depot`, n.depot[2], 'depot', at(n.depot[0], n.depot[1]), n.id, SITE_PROFILE.depot);
  }
  OBJECTIVES.forEach(([c, r, name, y], i) => {
    const kind: SiteKind = i === 0 ? 'city' : 'objective';
    placeSite(`objective${i}`, name, kind, at(c, r), null, { vp: i === 0 ? 8 : 6, pop: i === 0 ? 600 : 50, yields: yields(y) });
  });

  // Territory: nearest capital, except the central basin which nobody holds yet.
  const centre = at(8, 6);
  for (const key of sortedKeys(tiles)) {
    const t = tiles[key]!;
    if (t.terrain === 'water' || keyDistance(key, centre) <= 2) continue;
    const ranked = [...capitals].sort((a, b) => keyDistance(key, a[1]) - keyDistance(key, b[1]) || (a[0] < b[0] ? -1 : 1));
    const best = ranked[0]!;
    const second = ranked[1]!;
    // Hexes equidistant between two capitals stay unclaimed borderland.
    if (keyDistance(key, best[1]) === keyDistance(key, second[1])) continue;
    t.owner = best[0];
  }
  for (const id of sortedKeys(sites)) {
    const s = sites[id]!;
    tiles[s.key]!.owner = s.owner;
  }

  const nations: Record<NationId, Nation> = {};
  for (const n of NATIONS) {
    nations[n.id] = {
      id: n.id,
      name: n.name,
      color: n.color,
      government: n.government,
      stockpile: { credits: 320, energy: 140, materials: 180, food: 160 },
      population: 0,
      stability: 65,
      industrialCapacity: 0,
      researchOutput: 0,
      budget: { research: 10, infrastructure: 10, welfare: 5 },
      research: { current: null, progress: 0, unlocked: [] },
      productionQueue: [],
      objectives: OBJECTIVES.map((_, i) => `objective${i}`),
      warLosses: 0,
      eliminated: false,
    };
  }

  const relations: Record<string, 'war' | 'peace' | 'alliance'> = {};
  const ids = NATIONS.map((n) => n.id).sort();
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) relations[pairKey(ids[i]!, ids[j]!)] = 'war';

  const world: WorldState = {
    schema: 1,
    rulesetVersion: RULESET_VERSION,
    scenarioId: theatre.id,
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
    intel: {},
    victory: null,
  };

  for (const n of NATIONS) {
    const where = { capital: `${n.id}-capital`, city0: `${n.id}-city0`, city1: `${n.id}-city1`, depot: `${n.id}-depot` };
    const counts = new Map<UnitClass, number>();
    for (const [unitClass, place] of STARTING_FORCES) {
      const c = (counts.get(unitClass) ?? 0) + 1;
      counts.set(unitClass, c);
      const f: Formation = newFormation(world, n.id, unitClass, sites[where[place]]!.key, `${n.name.split(' ')[0]} ${c}${['th', 'st', 'nd', 'rd'][c] ?? 'th'} ${unitClassName(unitClass)}`);
      f.readiness = 80;
      f.organization = 70;
    }
    const gross = grossYields(world, n.id);
    nations[n.id]!.industrialCapacity = gross.industry;
    nations[n.id]!.population = Object.values(sites).filter((s) => s.owner === n.id).reduce((a, s) => a + s.population, 0);
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

function unitClassName(c: UnitClass): string {
  return { infantry: 'Infantry', mechanized: 'Mechanized', armor: 'Armored', artillery: 'Artillery', recon: 'Recon', air: 'Aviation', drone: 'Drone Company' }[c];
}


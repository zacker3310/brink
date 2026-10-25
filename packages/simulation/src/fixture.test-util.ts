import type { Formation, NationId, NationOrders, Relation, Site, SiteKind, Terrain, UnitClass, WorldState } from '@brink/contracts';
import { RULESET_VERSION } from '@brink/game-data';
import { hexKey } from '@brink/map';
import { emptyIntel } from './fog';
import { pairKey } from './rules';

/** A small axial-rectangle world: q in [0, cols), r in [0, rows). Everything plains, unowned. */
export function makeWorld(cols = 8, rows = 6, nations: NationId[] = ['a', 'b']): WorldState {
  const world: WorldState = {
    schema: 1,
    rulesetVersion: RULESET_VERSION,
    scenarioId: 'fixture',
    turn: 1,
    maxTurns: 30,
    seed: 42,
    nextId: 1,
    tiles: {},
    sites: {},
    nations: {},
    formations: {},
    relations: {},
    proposals: [],
    intel: {},
    victory: null,
  };
  for (let q = 0; q < cols; q++) {
    for (let r = 0; r < rows; r++) {
      const key = hexKey(q, r);
      world.tiles[key] = { key, q, r, terrain: 'plains', river: false, infrastructure: 0, owner: null, siteId: null };
    }
  }
  for (const id of nations) {
    world.nations[id] = {
      id,
      name: `Nation ${id.toUpperCase()}`,
      color: '#888888',
      government: 'union',
      stockpile: { credits: 500, energy: 200, materials: 200, food: 200 },
      population: 0,
      stability: 60,
      industrialCapacity: 40,
      researchOutput: 0,
      budget: { research: 0, infrastructure: 0, welfare: 0 },
      research: { current: null, progress: 0, unlocked: [] },
      productionQueue: [],
      objectives: [],
      warLosses: 0,
      eliminated: false,
    };
    world.intel[id] = emptyIntel();
  }
  for (let i = 0; i < nations.length; i++)
    for (let j = i + 1; j < nations.length; j++) world.relations[pairKey(nations[i]!, nations[j]!)] = 'war';
  // Every nation needs a city or it is eliminated at the end of the turn.
  const corners = [hexKey(0, 0), hexKey(cols - 1, rows - 1), hexKey(cols - 1, 0), hexKey(0, rows - 1)];
  nations.forEach((id, i) => site(world, `${id}-home`, corners[i]!, id, 'city', 5));
  return world;
}

export function setRelation(world: WorldState, a: NationId, b: NationId, r: Relation): void {
  world.relations[pairKey(a, b)] = r;
}

export function setTerrain(world: WorldState, key: string, terrain: Terrain, river = false): void {
  world.tiles[key]!.terrain = terrain;
  world.tiles[key]!.river = river;
}

export function own(world: WorldState, owner: NationId, keys: string[]): void {
  for (const k of keys) world.tiles[k]!.owner = owner;
}

export function site(world: WorldState, id: string, key: string, owner: NationId | null, kind: SiteKind = 'city', vp = 5): Site {
  const s: Site = {
    id,
    name: id,
    kind,
    key,
    owner,
    originalOwner: owner,
    population: 500,
    victoryPoints: vp,
    yields: { credits: 10, energy: 5, materials: 5, food: 5, industry: 10, research: 2 },
  };
  world.sites[id] = s;
  world.tiles[key]!.siteId = id;
  world.tiles[key]!.owner = owner;
  return s;
}

export function unit(world: WorldState, id: string, owner: NationId, unitClass: UnitClass, key: string, over: Partial<Formation> = {}): Formation {
  const f: Formation = {
    id,
    name: id,
    owner,
    unitClass,
    key,
    strength: 1000,
    organization: 80,
    morale: 70,
    readiness: 100,
    fuel: 100,
    ammunition: 100,
    experience: 0,
    entrenchment: 0,
    supplyPriority: 'normal',
    supply: 100,
    lastOrder: 'hold',
    ...over,
  };
  world.formations[id] = f;
  return f;
}

export function orders(world: WorldState, nation: NationId, formations: NationOrders['formations'] = {}, extra: Partial<NationOrders> = {}): NationOrders {
  return { nation, turn: world.turn, formations, recruit: [], diplomacy: [], ...extra };
}

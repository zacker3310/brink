import type {
  Formation,
  HexKey,
  Nation,
  NationId,
  Relation,
  Resource,
  Stockpile,
  Terrain,
  Treaty,
  TreatyKind,
  UnitClass,
  WorldState,
} from '@brink/contracts';
import { RESOURCES } from '@brink/contracts';
import { DIFFICULTY_EDGE, FORTRESS_ENTRENCHMENT, GOVERNMENTS, RIVER_MOVE_COST, TECHS, TERRAIN, UNITS, type Modifiers } from '@brink/game-data';
import { areAdjacent } from '@brink/map';

export function sortedKeys<T extends object>(obj: T): (keyof T & string)[] {
  return (Object.keys(obj) as (keyof T & string)[]).sort();
}

/** Deep copy of plain JSON data. */
export function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** floor(value * percent / 100), the one place percentages are applied. */
export function pct(value: number, percent: number): number {
  return Math.floor((value * percent) / 100);
}

export function pairKey(a: NationId, b: NationId): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function relationOf(relations: Record<string, Relation>, a: NationId, b: NationId): Relation {
  if (a === b) return 'alliance';
  return relations[pairKey(a, b)] ?? 'peace';
}

export function zeroStockpile(): Stockpile {
  return { credits: 0, energy: 0, materials: 0, food: 0 };
}

export type FullModifiers = Required<Omit<Modifiers, 'income'>> & { income: Record<Resource, number> };

/** Government plus unlocked technologies, summed. */
export function nationModifiers(nation: Pick<Nation, 'government' | 'research'> & { edge?: Nation['edge'] }): FullModifiers {
  const out: FullModifiers = {
    income: { credits: 0, energy: 0, materials: 0, food: 0 },
    industry: 0,
    research: 0,
    stability: 0,
    attack: 0,
    homeDefense: 0,
    recruitDiscount: 0,
    supplyCapacity: 0,
    supplyRange: 0,
    vision: 0,
    combinedArms: 0,
    ranged: 0,
    armorDefense: 0,
  };
  const sources: Modifiers[] = [GOVERNMENTS[nation.government].modifiers];
  if (nation.edge) sources.push(DIFFICULTY_EDGE[nation.edge]);
  for (const t of [...nation.research.unlocked].sort()) {
    const def = TECHS[t];
    if (def) sources.push(def.modifiers);
  }
  for (const m of sources) {
    for (const r of RESOURCES) out.income[r] += m.income?.[r] ?? 0;
    out.industry += m.industry ?? 0;
    out.research += m.research ?? 0;
    out.stability += m.stability ?? 0;
    out.attack += m.attack ?? 0;
    out.homeDefense += m.homeDefense ?? 0;
    out.recruitDiscount += m.recruitDiscount ?? 0;
    out.supplyCapacity += m.supplyCapacity ?? 0;
    out.supplyRange += m.supplyRange ?? 0;
    out.vision += m.vision ?? 0;
    out.combinedArms += m.combinedArms ?? 0;
    out.ranged += m.ranged ?? 0;
    out.armorDefense += m.armorDefense ?? 0;
  }
  return out;
}

export function recruitCost(nation: Pick<Nation, 'government' | 'research'>, unitClass: UnitClass): Stockpile {
  const discount = nationModifiers(nation).recruitDiscount;
  const base = UNITS[unitClass].cost;
  const out = zeroStockpile();
  for (const r of RESOURCES) out[r] = pct(base[r], 100 - discount);
  return out;
}

/** The parts of a tile movement depends on. Satisfied by both Tile and TileView. */
export interface TerrainInfo {
  terrain: Terrain | null;
  river: boolean;
  infrastructure: number;
}

/** Movement points for a ground formation to enter `tile`; null when it cannot. */
export function enterCost(tile: TerrainInfo | undefined, unitClass: UnitClass): number | null {
  if (!tile || tile.terrain === null) return null;
  const def = TERRAIN[tile.terrain];
  if (def.moveCost === null) return null;
  let cost = def.moveCost + (tile.river ? RIVER_MOVE_COST : 0);
  // Armor cannot climb mountains at road-free speed.
  if (tile.terrain === 'mountains' && (unitClass === 'armor' || unitClass === 'mechanized')) cost += 2;
  cost -= tile.infrastructure;
  return Math.max(1, cost);
}

/** Movement points this turn, given readiness and fuel. */
export function movementAllowance(f: Pick<Formation, 'unitClass' | 'readiness' | 'fuel'>): number {
  const def = UNITS[f.unitClass];
  let mp = pct(def.movement, 50 + Math.floor(f.readiness / 2));
  if (def.motorized && f.fuel < 10) mp = Math.floor(mp / 2);
  return Math.max(def.movement > 0 ? 1 : 0, mp);
}

/** Total cost of a contiguous path starting next to `from`; null when any step is illegal. */
export function pathCost(
  tiles: Record<HexKey, TerrainInfo>,
  unitClass: UnitClass,
  from: HexKey,
  path: readonly HexKey[],
): number | null {
  let prev = from;
  let total = 0;
  for (const k of path) {
    if (!areAdjacent(prev, k)) return null;
    const c = enterCost(tiles[k], unitClass);
    if (c === null) return null;
    total += c;
    prev = k;
  }
  return total;
}

export function visionRadius(unitClass: UnitClass, mods: FullModifiers, onRecon: boolean): number {
  return UNITS[unitClass].vision + mods.vision + (onRecon ? 1 : 0);
}

export function isRanged(unitClass: UnitClass): boolean {
  return UNITS[unitClass].range > 0;
}

/** The treaty of `kind` between `a` and `b` in force on `turn`, if any. Works on a world or a view. */
export function treatyIn(treaties: readonly Treaty[], kind: TreatyKind, a: NationId, b: NationId, turn: number): Treaty | undefined {
  const [x, y] = a < b ? [a, b] : [b, a];
  return treaties.find((t) => t.kind === kind && t.a === x && t.b === y && t.from <= turn && turn <= t.until);
}

/** Entrenchment a formation cannot fall below: a ground unit in its own nation's fortress. */
export function fortressFloor(world: WorldState, f: Formation): number {
  const id = world.tiles[f.key]?.siteId;
  const site = id ? world.sites[id] : undefined;
  return site && site.owner === f.owner && site.facilities.includes('fortress') && UNITS[f.unitClass].ground ? FORTRESS_ENTRENCHMENT : 0;
}

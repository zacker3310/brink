import type { GovernmentId, NationId, Stockpile, UnitClass, WorldState } from '@brink/contracts';
import { RULES, type Modifiers } from '@brink/game-data';
import { keyDistance, neighborKeys } from '@brink/map';
import { grossYields, sortedKeys } from '@brink/simulation';

// Read-only facts about a fresh scenario for the setup screens. Everything here is derived
// from the real starting world, so the dossier can never drift from what the engine plays.

export const CLASS_ORDER: readonly UnitClass[] = ['infantry', 'mechanized', 'armor', 'artillery', 'recon', 'air', 'drone'];

export interface Dossier {
  hexes: number;
  cities: number;
  victoryPoints: number;
  /** Percent of all victory points on the map. */
  vpShare: number;
  forces: Record<UnitClass, number>;
  formations: number;
  income: Stockpile;
  industry: number;
  research: number;
  /** Rival nations whose ground touches ours. */
  fronts: NationId[];
  /** Hexes from the capital to the nearest objective. */
  toObjective: number;
  population: number;
  stability: number;
}

export function dossier(world: WorldState, id: NationId): Dossier {
  const tiles = sortedKeys(world.tiles).map((k) => world.tiles[k]!);
  const own = tiles.filter((t) => t.owner === id);
  const sites = sortedKeys(world.sites).map((k) => world.sites[k]!);
  const mine = sites.filter((s) => s.owner === id);
  const totalVp = sites.reduce((n, s) => n + s.victoryPoints, 0);
  const vp = mine.reduce((n, s) => n + s.victoryPoints, 0);

  const forces = Object.fromEntries(CLASS_ORDER.map((c) => [c, 0])) as Record<UnitClass, number>;
  let formations = 0;
  for (const k of sortedKeys(world.formations)) {
    const f = world.formations[k]!;
    if (f.owner !== id) continue;
    forces[f.unitClass] += 1;
    formations += 1;
  }

  const fronts = new Set<NationId>();
  for (const t of own) {
    for (const n of neighborKeys(t.key)) {
      const o = world.tiles[n]?.owner;
      if (o && o !== id) fronts.add(o);
    }
  }

  const capital = mine.find((s) => s.kind === 'capital');
  const objectives = sites.filter((s) => s.kind === 'objective');
  const toObjective = capital && objectives.length ? Math.min(...objectives.map((o) => keyDistance(capital.key, o.key))) : 0;

  const y = grossYields(world, id);
  const nation = world.nations[id]!;
  return {
    hexes: own.length,
    cities: mine.filter((s) => s.kind === 'capital' || s.kind === 'city').length,
    victoryPoints: vp,
    vpShare: totalVp ? Math.round((vp * 100) / totalVp) : 0,
    forces,
    formations,
    income: y.income,
    industry: y.industry,
    research: y.research,
    fronts: [...fronts].sort(),
    toObjective,
    population: nation.population,
    stability: nation.stability,
  };
}

export interface Trait {
  label: string;
  value: string;
  good: boolean;
}

const RESOURCE_LABEL = { credits: 'Credits', energy: 'Energy', materials: 'Materials', food: 'Food' } as const;

/** A government's modifiers as signed, human-readable traits, strongest first. */
export function traits(mods: Modifiers): Trait[] {
  const out: (Trait & { weight: number })[] = [];
  const pctTrait = (label: string, v: number | undefined, unit = '%') => {
    if (v) out.push({ label, value: `${v > 0 ? '+' : ''}${v}${unit}`, good: v > 0, weight: Math.abs(v) });
  };
  for (const [r, v] of Object.entries(mods.income ?? {}) as [keyof typeof RESOURCE_LABEL, number][]) pctTrait(`${RESOURCE_LABEL[r]} income`, v);
  pctTrait('Industry', mods.industry);
  pctTrait('Research', mods.research);
  pctTrait('Attack', mods.attack);
  pctTrait('Home defense', mods.homeDefense);
  pctTrait('Recruit cost', mods.recruitDiscount && -mods.recruitDiscount);
  pctTrait('Supply capacity', mods.supplyCapacity);
  pctTrait('Supply range', mods.supplyRange, ' hex');
  pctTrait('Stability', mods.stability, '');
  pctTrait('Vision', mods.vision, ' hex');
  // A recruit-cost cut is good even though the number is negative.
  for (const t of out) if (t.label === 'Recruit cost') t.good = true;
  return out.sort((a, b) => b.weight - a.weight).map(({ weight: _w, ...t }) => t);
}

/** One line on how the government wants to fight, for the roster. */
export const DOCTRINE: Record<GovernmentId, string> = {
  commonwealth: 'Buy the war. Outspend, out-research, and let rivals bleed each other.',
  directorate: 'Strike first and hard. Win before the home front cracks.',
  federation: 'Out-think the enemy. Reach further, field better kit sooner.',
  union: 'Make every hex cost blood. Mass, dig in, counterpunch.',
};

const ADJECTIVES = ['Iron', 'Silent', 'Crimson', 'Northern', 'Broken', 'Pale', 'Hollow', 'Burning', 'Last', 'Winter', 'Granite', 'Black', 'Distant', 'Sudden', 'Amber', 'Bitter'];
const NOUNS = ['Meridian', 'Anvil', 'Lantern', 'Harvest', 'Spear', 'Tempest', 'Bastion', 'Horizon', 'Requiem', 'Gambit', 'Vigil', 'Sabre', 'Tide', 'Crown', 'Ember', 'Rampart'];

/** A stable codename for a seed, so a shared seed has a name people remember. */
export function operationName(seed: number): string {
  // Integer hash; same seed, same name, everywhere.
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return `${ADJECTIVES[h % ADJECTIVES.length]} ${NOUNS[(h >>> 8) % NOUNS.length]}`;
}

export const VICTORY_SHARE = RULES.victoryShare;

export function randomSeed(): number {
  return 1 + Math.floor(Math.random() * 99999);
}

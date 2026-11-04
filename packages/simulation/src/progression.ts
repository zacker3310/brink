import type { FacilityId, GameEvent, HexKey, Nation, NationId, NationView, Resource, SiteKind, Stockpile, TechId, WorldState, Yields } from '@brink/contracts';
import { RESOURCES } from '@brink/contracts';
import { CITY_GROWTH, DOCTRINE, FACILITIES, FACILITY_SLOTS, LEVEL_SLOT_AT, LEVEL_YIELDS, TECHS, type CardSupportAsset } from '@brink/game-data';
import { keyDistance } from '@brink/map';
import { isCoastal } from './doctrine';
import { nationModifiers, pct, sortedKeys } from './rules';

// Civ-style progression: the research tree's reach beyond plain modifiers, and city development.
// Cities grow a little every turn they are held in good order (`growCities`, the development
// phase right after the economy); each level adds yields, and levels 3 and 5 a facility slot.
// Facilities from research put support over nearby battles and stiffen a site's defenders.

/** A capital or a city: the sites that grow. */
export function grows(kind: SiteKind): boolean {
  return kind === 'capital' || kind === 'city';
}

/** City level, 1..5, for a development total. */
export function cityLevel(development: number | undefined): number {
  const d = development ?? 0;
  let level = 1;
  CITY_GROWTH.levels.forEach((need, i) => {
    if (d >= need) level = i + 1;
  });
  return level;
}

/** Where a city stands toward its next level: points into this level and the span of it (0 at the top). */
export function levelProgress(development: number | undefined): { level: number; into: number; span: number } {
  const d = development ?? 0;
  const level = cityLevel(d);
  const from = CITY_GROWTH.levels[level - 1] ?? 0;
  const to = CITY_GROWTH.levels[level];
  return { level, into: d - from, span: to === undefined ? 0 : to - from };
}

/** Facility slots at a site: by kind, plus one at each of the levels in `LEVEL_SLOT_AT`. */
export function facilitySlots(site: { kind: SiteKind; development?: number }): number {
  const level = grows(site.kind) ? cityLevel(site.development) : 1;
  return FACILITY_SLOTS[site.kind] + LEVEL_SLOT_AT.filter((l) => level >= l).length;
}

/** What the site's level adds to its yields (nothing at level 1, nor at a depot or objective). */
export function levelYields(site: { kind: SiteKind; development?: number }): Yields {
  const above = grows(site.kind) ? cityLevel(site.development) - 1 : 0;
  return {
    credits: above * (LEVEL_YIELDS.credits ?? 0),
    energy: above * (LEVEL_YIELDS.energy ?? 0),
    materials: above * (LEVEL_YIELDS.materials ?? 0),
    food: above * (LEVEL_YIELDS.food ?? 0),
    industry: above * (LEVEL_YIELDS.industry ?? 0),
    research: above * (LEVEL_YIELDS.research ?? 0),
  };
}

/** What a facility costs `nation`, after research discounts. */
export function facilityCost(nation: Pick<Nation, 'government' | 'research'> & { edge?: Nation['edge'] }, facility: FacilityId): Stockpile {
  const discount = Math.min(50, nationModifiers(nation).buildDiscount);
  const base = FACILITIES[facility].cost;
  const out = { credits: 0, energy: 0, materials: 0, food: 0 };
  for (const r of RESOURCES) out[r] = pct(base[r], 100 - discount);
  return out;
}

/** What a build check needs to know of the board. A `WorldState` and a `NationView` both fit. */
export interface BuildBoard {
  sites: Record<string, { name: string; kind: SiteKind; key: HexKey; owner: NationId | null; facilities: FacilityId[]; development?: number } | undefined>;
  tiles: Record<HexKey, { port?: boolean } | undefined>;
}

/** Why `nation` cannot start `facility` at `siteId` now, ignoring cost, or null. The engine's check, also run on a view. */
export function buildBlocker(board: BuildBoard, nation: Pick<Nation, 'id' | 'research' | 'construction'>, siteId: string, facility: FacilityId): string | null {
  const site = board.sites[siteId];
  const def = FACILITIES[facility];
  if (!site) return 'no such site';
  if (!def) return 'unknown facility';
  if (site.owner !== nation.id) return `${site.name} is not under your control`;
  const building = nation.construction.filter((c) => c.siteId === siteId);
  if (site.facilities.includes(facility) || building.some((c) => c.facility === facility)) return `${site.name} already has a ${def.name.toLowerCase()}`;
  if (site.facilities.length + building.length >= facilitySlots(site)) return `${site.name} has no room for another facility`;
  if (def.port && !board.tiles[site.key]?.port) return `a ${def.name.toLowerCase()} needs a port`;
  if (def.requires && !nation.research.unlocked.includes(def.requires)) return `${def.name} needs ${TECHS[def.requires]?.name ?? def.requires}`;
  return null;
}

/**
 * Give every capital and city that has none its development (0): worlds made before city
 * development. Keyed on the field, not the ruleset, so running it twice changes nothing.
 */
export function initProgression(world: WorldState): void {
  for (const id of sortedKeys(world.sites)) {
    const s = world.sites[id]!;
    if (grows(s.kind) && s.development === undefined) s.development = 0;
  }
}

/** Development a site gains this turn, before the owner's state is checked. */
export function growthOf(world: Pick<WorldState, 'nations'>, site: { kind: SiteKind; owner: NationId | null; facilities: FacilityId[] }): number {
  if (!grows(site.kind) || !site.owner) return 0;
  const n = world.nations[site.owner];
  if (!n || n.minor || n.eliminated) return 0;
  const base = CITY_GROWTH.base + CITY_GROWTH.perFacility * site.facilities.length + (site.kind === 'capital' ? CITY_GROWTH.capital : 0);
  return pct(base, 100 + nationModifiers(n).growth);
}

/**
 * The development phase, right after the economy. A city that changed hands this turn keeps half
 * its development. Every capital and city held by a power whose stability is in order and whose
 * people ate this turn grows; a new level is announced to its owner. Each site's change reads
 * only that site and its owner, so the whole phase is one snapshot.
 */
export function growCities(world: WorldState, shortages: Record<NationId, readonly Resource[]>, events: GameEvent[]): void {
  const captured = new Set<string>();
  for (const e of events) if (e.kind === 'site_captured') captured.add(e.site);
  for (const id of sortedKeys(world.sites)) {
    const s = world.sites[id]!;
    if (!grows(s.kind)) continue;
    const before = s.development ?? 0;
    let dev = captured.has(id) ? pct(before, CITY_GROWTH.keptOnCapture) : before;
    const owner = s.owner ? world.nations[s.owner] : undefined;
    const settled = !!owner && owner.stability >= CITY_GROWTH.minStability && !(shortages[owner.id] ?? []).includes('food');
    if (settled) dev = Math.min(CITY_GROWTH.max, dev + growthOf(world, s));
    if (dev === before && s.development !== undefined) continue;
    s.development = dev;
    const level = cityLevel(dev);
    if (owner && level > cityLevel(before) && !captured.has(id)) events.push({ kind: 'city_grew', nation: owner.id, site: id, level });
  }
}

/** Movement points research adds to a formation (ships; armour on land). Read with the cards' march bonus. */
export function techMovement(unlocked: readonly TechId[], f: { unitClass: string; aboard?: string }): number {
  if (f.aboard) return 0;
  const naval = f.unitClass === 'fleet' || f.unitClass === 'carrier' || f.unitClass === 'transport';
  const armour = f.unitClass === 'armor' || f.unitClass === 'mechanized';
  if (!naval && !armour) return 0;
  let mp = 0;
  for (const t of [...unlocked].sort()) {
    const m = TECHS[t]?.modifiers;
    if (m) mp += (naval ? m.navalMove : m.armorMove) ?? 0;
  }
  return mp;
}

/** Doctrine cards a power holds: the base hand and what research adds. */
export function handSizeOf(nation: Pick<Nation, 'government' | 'research'> & { edge?: Nation['edge'] }): number {
  return DOCTRINE.handSize + nationModifiers(nation).handSize;
}

/** Percent added to the defense of `owner`'s formations in a site's hex by what stands there. */
export function siteDefense(site: { owner: NationId | null; facilities: readonly FacilityId[] } | undefined): { owner: NationId; percent: number } | undefined {
  if (!site?.owner) return undefined;
  const percent = site.facilities.reduce((a, f) => a + (FACILITIES[f]?.defense ?? 0), 0);
  return percent > 0 ? { owner: site.owner, percent } : undefined;
}

export type SupportList = { id: CardSupportAsset; missions: number }[];

function listOf(m: Map<CardSupportAsset, number>): SupportList {
  return [...m.keys()].sort().map((id) => ({ id, missions: m.get(id)! }));
}

/**
 * Off-map support research and facilities bring to a hand-fought battle at `target`, read from
 * the player's view. Blue: what its technologies put over every battle (naval ones only on the
 * coast), and its airbases and missile batteries within reach. Red: the enemy's airbases and
 * batteries within reach that the player can see now (a site's facilities are known only then).
 */
export function progressionSupport(view: Pick<NationView, 'self' | 'sites' | 'tiles' | 'relations'>, target: HexKey): { blue: SupportList; red: SupportList } {
  const blue = new Map<CardSupportAsset, number>();
  const red = new Map<CardSupportAsset, number>();
  const add = (m: Map<CardSupportAsset, number>, id: CardSupportAsset, n: number) => m.set(id, (m.get(id) ?? 0) + n);
  const coastal = isCoastal(view, target);
  for (const t of [...view.self.research.unlocked].sort()) {
    for (const s of TECHS[t]?.support ?? []) if (!s.coastal || coastal) add(blue, s.asset, s.missions);
  }
  for (const id of sortedKeys(view.sites)) {
    const site = view.sites[id]!;
    const mine = site.owner === view.self.id;
    const enemy = !!site.owner && view.relations[site.owner] === 'war';
    if (!mine && !enemy) continue;
    for (const f of site.facilities) {
      const s = FACILITIES[f]?.support;
      if (s && keyDistance(site.key, target) <= s.reach) add(mine ? blue : red, s.asset, s.missions);
    }
  }
  return { blue: listOf(blue), red: listOf(red) };
}

/** Research points a turn for a nation's own sites at a research budget share, as the economy reckons it. */
export function researchRate(view: Pick<NationView, 'self' | 'sites'>, share = view.self.budget.research): number {
  let points = 0;
  let credits = 0;
  for (const id of sortedKeys(view.sites)) {
    const s = view.sites[id]!;
    if (s.owner !== view.self.id) continue;
    const lv = levelYields(s);
    points += s.yields.research + lv.research + s.facilities.reduce((a, f) => a + (FACILITIES[f].yields.research ?? 0), 0);
    credits += s.yields.credits + lv.credits;
  }
  const mods = nationModifiers(view.self);
  return Math.max(1, pct(points + Math.floor(pct(credits, share) / 2), 100 + mods.research));
}

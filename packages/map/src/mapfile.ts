import type { GovernmentId, HexKey, NationId, SiteKind, Terrain } from '@brink/contracts';
import { keyOf, neighbors, offsetToAxial } from './hex';

// The authored map format (docs/mapgen.md): a theatre as plain, versioned JSON. The geography is a
// set of character layers, one character per hex in the engine's odd-row offset layout, each with
// its own legend; nations, sites, sea zones, straits and resources are lists that refer to hexes by
// `[col, row]`. A map file holds the ground and who stands on it at the start. What a scenario does
// with it (orders of battle, prizes, the turn limit) stays in the scenario's code.
//
// `validateMap` reports every problem it finds with a path into the file, so `pnpm map:check` can
// say exactly what to fix; `parseMap` is the loader's gate and throws on the first file that fails.

export const MAP_FORMAT = 'brink-map';
/** Bump when the format changes shape; `validateMap` refuses versions it does not read. */
export const MAP_VERSION = 1;

/** Largest map the format admits. Phase 4 aims at 160 x 80; this leaves headroom, not a promise. */
export const MAX_COLS = 400;
export const MAX_ROWS = 200;
/** Powers a map may name (MASTER-PLAN Phase 4: 2 to 12). */
export const MIN_POWERS = 2;
export const MAX_POWERS = 12;

/** A hex in offset coordinates: column, then row. */
export type Cell = readonly [col: number, row: number];

/** One character per hex, `rows` strings of `cols` characters; each character is read through `legend`. */
export interface MapLayer<V> {
  legend: Record<string, V>;
  rows: string[];
}

/** Ground the seed rolls (forest, hills, mountains or plains), or ground the author fixes. */
export type MapTerrain = Terrain | 'seeded';

export type MapRole = 'power' | 'minor';

export interface MapNation {
  id: NationId;
  name: string;
  /** The name on a map label or a small tile: 'USA', 'N. Korea'. */
  short: string;
  color: string;
  government: GovernmentId;
  /** A power can be played; a minor state holds its ground and never plays. */
  role: MapRole;
  /** The id of this nation's capital, one of `sites`. */
  capital: string;
  /** Added to the seeded roughness inside this nation: positive is wilder ground, negative open plains. */
  terrainBias?: number;
}

export interface MapSite {
  id: string;
  kind: SiteKind;
  name: string;
  at: Cell;
  /** Who holds it at the start; it must stand on that nation's ground. Null on unowned ground. */
  owner: NationId | null;
  /** Victory points where a place is worth more (or less) than its kind: what a war is about. */
  victoryPoints?: number;
  /** An island outpost: a runway and a harbour, a depot that yields little and has a small garrison. */
  profile?: 'outpost';
  /**
   * Black Files: an excavation (an objective a power holds turns running to dig out an artefact) or a
   * black site (a power's laboratory where artefacts are studied). Inert in a campaign without them.
   */
  anomaly?: 'excavation' | 'blacksite';
}

export interface MapSeaZone {
  id: string;
  name: string;
}

export type StraitKind = 'strait' | 'canal' | 'land-bridge';

/** A chokepoint: a narrow sea (or land crossing) whose hexes control passage between zones. */
export interface MapStrait {
  id: string;
  name: string;
  kind: StraitKind;
  hexes: Cell[];
  /** The sea zones it joins; each must touch one of its hexes. */
  joins?: string[];
}

export type ResourceKind = 'oil' | 'rare-earths' | 'chips' | 'food';

export interface MapResource {
  kind: ResourceKind;
  at: Cell;
  name?: string;
}

/** A hint for the battle arena and the renderer: what the ground looks like, not how it plays. */
export type Biome = 'sea' | 'ice' | 'tundra' | 'boreal' | 'temperate' | 'steppe' | 'desert' | 'subtropical' | 'tropical' | 'highland';

export interface MapFile {
  format: typeof MAP_FORMAT;
  version: typeof MAP_VERSION;
  id: string;
  name: string;
  cols: number;
  rows: number;
  /** Odd rows sit half a hex to the right: the engine's `offsetToAxial`. */
  layout: 'odd-r';
  /** Where the map came from: hand-authored, converted, or baked from coastline data (and its licence). */
  source?: string;
  layers: {
    owner: MapLayer<NationId | null>;
    terrain: MapLayer<MapTerrain>;
    seaZone?: MapLayer<string | null>;
    biome?: MapLayer<Biome>;
  };
  nations: MapNation[];
  sites: MapSite[];
  seaZones?: MapSeaZone[];
  straits?: MapStrait[];
  resources?: MapResource[];
}

export const TERRAINS: readonly Terrain[] = ['plains', 'forest', 'hills', 'mountains', 'urban', 'water'];
export const GOVERNMENTS: readonly GovernmentId[] = ['commonwealth', 'directorate', 'federation', 'union'];
export const SITE_KINDS: readonly SiteKind[] = ['capital', 'city', 'depot', 'objective'];
export const STRAIT_KINDS: readonly StraitKind[] = ['strait', 'canal', 'land-bridge'];
export const RESOURCE_KINDS: readonly ResourceKind[] = ['oil', 'rare-earths', 'chips', 'food'];
export const BIOMES: readonly Biome[] = ['sea', 'ice', 'tundra', 'boreal', 'temperate', 'steppe', 'desert', 'subtropical', 'tropical', 'highland'];

export interface MapError {
  /** Where in the file: `layers.owner.rows[3]`, `sites[12].at`. */
  path: string;
  message: string;
}

/** The engine's hex key for a cell. */
export function cellKey([col, row]: Cell): HexKey {
  return keyOf(offsetToAxial(col, row));
}

/** The legend's value for the character at a cell. The map must be valid. */
export function layerAt<V>(layer: MapLayer<V>, col: number, row: number): V {
  const ch = layer.rows[row]?.[col];
  if (ch === undefined || !(ch in layer.legend)) throw new Error(`layer has no cell ${col},${row}`);
  return layer.legend[ch] as V;
}

export function ownerAt(map: MapFile, col: number, row: number): NationId | null {
  return layerAt(map.layers.owner, col, row);
}

export function terrainAt(map: MapFile, col: number, row: number): MapTerrain {
  return layerAt(map.layers.terrain, col, row);
}

export function isWater(map: MapFile, col: number, row: number): boolean {
  return terrainAt(map, col, row) === 'water';
}

/** The offset neighbours of a cell that lie on the map. */
export function cellNeighbors(map: Pick<MapFile, 'cols' | 'rows'>, [col, row]: Cell): Cell[] {
  const out: Cell[] = [];
  for (const a of neighbors(offsetToAxial(col, row))) {
    const r = a.r;
    const c = a.q + (r - (r & 1)) / 2;
    if (c >= 0 && c < map.cols && r >= 0 && r < map.rows) out.push([c, r]);
  }
  return out;
}

export class MapFormatError extends Error {
  constructor(
    readonly source: string,
    readonly errors: readonly MapError[],
  ) {
    super(`${source}: ${errors.length} problem${errors.length === 1 ? '' : 's'}\n${errors.map((e) => `  ${e.path}: ${e.message}`).join('\n')}`);
    this.name = 'MapFormatError';
  }
}

/** The map, checked; throws a `MapFormatError` listing every problem. */
export function parseMap(value: unknown, source = 'map'): MapFile {
  const errors = validateMap(value);
  if (errors.length) throw new MapFormatError(source, errors);
  return value as MapFile;
}

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const ID = /^[a-z][a-z0-9-]*$/;
const COLOR = /^#[0-9a-fA-F]{6}$/;

/** Every problem with a map file, or none. Never throws, whatever it is given. */
export function validateMap(value: unknown): MapError[] {
  const errors: MapError[] = [];
  const err = (path: string, message: string) => errors.push({ path, message });
  if (!isObject(value)) return [{ path: '', message: 'a map file is a JSON object' }];
  const m = value;

  if (m.format !== MAP_FORMAT) err('format', `must be "${MAP_FORMAT}", not ${JSON.stringify(m.format)}`);
  if (!isInt(m.version)) err('version', 'must be an integer');
  else if (m.version > MAP_VERSION) err('version', `${m.version} is newer than this build reads (${MAP_VERSION})`);
  else if (m.version !== MAP_VERSION) err('version', `${m.version} is not a version this build reads (${MAP_VERSION})`);
  if (typeof m.id !== 'string' || !ID.test(m.id)) err('id', 'must be a lowercase id: letters, digits and dashes, starting with a letter');
  if (typeof m.name !== 'string' || !m.name.trim()) err('name', 'must be a non-empty string');
  if (m.source !== undefined && typeof m.source !== 'string') err('source', 'must be a string');
  if (m.layout !== 'odd-r') err('layout', `must be "odd-r", not ${JSON.stringify(m.layout)}`);
  const cols = isInt(m.cols) && m.cols >= 1 && m.cols <= MAX_COLS ? m.cols : null;
  const rows = isInt(m.rows) && m.rows >= 1 && m.rows <= MAX_ROWS ? m.rows : null;
  if (cols === null) err('cols', `must be an integer from 1 to ${MAX_COLS}`);
  if (rows === null) err('rows', `must be an integer from 1 to ${MAX_ROWS}`);
  // Without the size nothing else can be placed: stop here.
  if (cols === null || rows === null) return errors;

  const inBounds = (v: unknown, path: string): Cell | null => {
    if (!Array.isArray(v) || v.length !== 2 || !isInt(v[0]) || !isInt(v[1])) {
      err(path, 'must be [col, row], two integers');
      return null;
    }
    const [c, r] = v as [number, number];
    if (c < 0 || c >= cols || r < 0 || r >= rows) {
      err(path, `[${c}, ${r}] is off the ${cols} x ${rows} map`);
      return null;
    }
    return [c, r];
  };

  // Nations first: the owner layer's legend refers to them.
  const nationIds = new Set<string>();
  const nations: Json[] = [];
  if (!Array.isArray(m.nations) || m.nations.length === 0) err('nations', 'must be a non-empty list');
  else
    m.nations.forEach((n, i) => {
      const p = `nations[${i}]`;
      if (!isObject(n)) return err(p, 'must be an object');
      nations.push(n);
      if (typeof n.id !== 'string' || !ID.test(n.id)) err(`${p}.id`, 'must be a lowercase id');
      else if (nationIds.has(n.id)) err(`${p}.id`, `"${n.id}" is already a nation`);
      else nationIds.add(n.id);
      for (const f of ['name', 'short'] as const) if (typeof n[f] !== 'string' || !(n[f] as string).trim()) err(`${p}.${f}`, 'must be a non-empty string');
      if (typeof n.color !== 'string' || !COLOR.test(n.color)) err(`${p}.color`, 'must be a #rrggbb colour');
      if (!GOVERNMENTS.includes(n.government as GovernmentId)) err(`${p}.government`, `must be one of ${GOVERNMENTS.join(', ')}`);
      if (n.role !== 'power' && n.role !== 'minor') err(`${p}.role`, 'must be "power" or "minor"');
      if (typeof n.capital !== 'string') err(`${p}.capital`, 'must name a site id');
      if (n.terrainBias !== undefined && (!isInt(n.terrainBias) || Math.abs(n.terrainBias) > 200)) err(`${p}.terrainBias`, 'must be an integer from -200 to 200');
    });
  const powers = nations.filter((n) => n.role === 'power').length;
  if (Array.isArray(m.nations) && (powers < MIN_POWERS || powers > MAX_POWERS)) err('nations', `has ${powers} powers; a map needs ${MIN_POWERS} to ${MAX_POWERS}`);

  // Layers.
  const layers = isObject(m.layers) ? m.layers : null;
  if (!layers) err('layers', 'must be an object with owner and terrain layers');
  const grid = <V>(name: string, required: boolean, valueOk: (v: unknown) => boolean, valueHint: string): MapLayer<V> | null => {
    const l = layers?.[name];
    const p = `layers.${name}`;
    let ok = true;
    const bad = (path: string, message: string) => {
      err(path, message);
      ok = false;
    };
    if (l === undefined) {
      if (required) err(p, 'is required');
      return null;
    }
    if (!isObject(l)) {
      err(p, 'must be an object with a legend and rows');
      return null;
    }
    if (!isObject(l.legend)) bad(`${p}.legend`, 'must be an object from one character to a value');
    else
      for (const [ch, v] of Object.entries(l.legend)) {
        if ([...ch].length !== 1) bad(`${p}.legend`, `key ${JSON.stringify(ch)} must be one character`);
        if (!valueOk(v)) bad(`${p}.legend.${ch}`, `${JSON.stringify(v)} is not ${valueHint}`);
      }
    if (!Array.isArray(l.rows) || l.rows.length !== rows) {
      err(`${p}.rows`, `must be a list of ${rows} strings`);
      return null;
    }
    l.rows.forEach((row, r) => {
      if (typeof row !== 'string') return bad(`${p}.rows[${r}]`, 'must be a string');
      if (row.length !== cols) bad(`${p}.rows[${r}]`, `is ${row.length} wide, not ${cols}`);
      if (!isObject(l.legend)) return;
      for (let c = 0; c < row.length; c++) {
        if (!(row[c]! in (l.legend as Json))) bad(`${p}.rows[${r}]`, `col ${c}: ${JSON.stringify(row[c])} is not in the legend`);
      }
    });
    return ok ? (l as unknown as MapLayer<V>) : null;
  };
  const owner = grid<NationId | null>('owner', true, (v) => v === null || (typeof v === 'string' && nationIds.has(v)), 'null or a nation id');
  const terrain = grid<MapTerrain>('terrain', true, (v) => v === 'seeded' || TERRAINS.includes(v as Terrain), `"seeded" or one of ${TERRAINS.join(', ')}`);
  const zoneIds = new Set<string>();
  if (m.seaZones !== undefined) {
    if (!Array.isArray(m.seaZones)) err('seaZones', 'must be a list');
    else
      m.seaZones.forEach((z, i) => {
        if (!isObject(z) || typeof z.id !== 'string' || !ID.test(z.id)) return err(`seaZones[${i}].id`, 'must be a lowercase id');
        if (zoneIds.has(z.id)) err(`seaZones[${i}].id`, `"${z.id}" is already a sea zone`);
        zoneIds.add(z.id);
        if (typeof z.name !== 'string' || !z.name.trim()) err(`seaZones[${i}].name`, 'must be a non-empty string');
      });
  }
  const seaZone = grid<string | null>('seaZone', false, (v) => v === null || (typeof v === 'string' && zoneIds.has(v)), 'null or a sea zone id');
  const biome = grid<Biome>('biome', false, (v) => BIOMES.includes(v as Biome), `one of ${BIOMES.join(', ')}`);
  if (layers) for (const k of Object.keys(layers)) if (!['owner', 'terrain', 'seaZone', 'biome'].includes(k)) err(`layers.${k}`, 'is not a layer this format knows');
  if (seaZone && m.seaZones === undefined) err('seaZones', 'must list the zones the seaZone layer uses');

  // Cell by cell: the layers must agree.
  const water = (c: number, r: number) => (terrain ? layerAt(terrain, c, r) === 'water' : false);
  const holder = (c: number, r: number) => (owner ? layerAt(owner, c, r) : null);
  const used = new Set<string>();
  if (owner && terrain) {
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const w = water(c, r);
        const o = holder(c, r);
        if (w && o !== null) err(`layers.owner.rows[${r}]`, `col ${c}: sea cannot be owned (held by ${o})`);
        if (seaZone) {
          const z = layerAt(seaZone, c, r);
          if (z !== null) used.add(z);
          if (w && z === null) err(`layers.seaZone.rows[${r}]`, `col ${c}: open sea belongs to no sea zone`);
          if (!w && z !== null) err(`layers.seaZone.rows[${r}]`, `col ${c}: land cannot be in sea zone ${z}`);
        }
        if (biome) {
          const b = layerAt(biome, c, r);
          if (w !== (b === 'sea')) err(`layers.biome.rows[${r}]`, `col ${c}: ${w ? 'sea' : 'land'} cannot have the ${b} biome`);
        }
      }
    for (const z of zoneIds) if (seaZone && !used.has(z)) err('seaZones', `"${z}" has no hexes in the seaZone layer`);
  }

  // Sites.
  const siteIds = new Map<string, Json>();
  const taken = new Map<string, string>();
  if (!Array.isArray(m.sites)) err('sites', 'must be a list');
  else
    m.sites.forEach((s, i) => {
      const p = `sites[${i}]`;
      if (!isObject(s)) return err(p, 'must be an object');
      if (typeof s.id !== 'string' || !ID.test(s.id)) err(`${p}.id`, 'must be a lowercase id');
      else if (siteIds.has(s.id)) err(`${p}.id`, `"${s.id}" is already a site`);
      else siteIds.set(s.id, s);
      const name = typeof s.name === 'string' && s.name.trim() ? s.name : null;
      if (!name) err(`${p}.name`, 'must be a non-empty string');
      if (!SITE_KINDS.includes(s.kind as SiteKind)) err(`${p}.kind`, `must be one of ${SITE_KINDS.join(', ')}`);
      if (s.owner !== null && !(typeof s.owner === 'string' && nationIds.has(s.owner))) err(`${p}.owner`, `${JSON.stringify(s.owner)} is not a nation on this map`);
      if (s.victoryPoints !== undefined && (!isInt(s.victoryPoints) || s.victoryPoints < 1)) err(`${p}.victoryPoints`, 'must be a positive integer');
      if (s.profile !== undefined && !(s.profile === 'outpost' && s.kind === 'depot')) err(`${p}.profile`, 'only a depot can be an "outpost"');
      if (s.anomaly !== undefined) {
        if (s.anomaly !== 'excavation' && s.anomaly !== 'blacksite') err(`${p}.anomaly`, 'must be "excavation" or "blacksite"');
        else if (s.kind !== 'objective') err(`${p}.anomaly`, `an ${s.anomaly} is an objective, not a ${String(s.kind)}`);
        else if (s.anomaly === 'blacksite' && s.owner === null) err(`${p}.anomaly`, 'a black site belongs to a nation');
      }
      const at = inBounds(s.at, `${p}.at`);
      if (!at || !owner || !terrain) return;
      const [c, r] = at;
      const label = name ?? `site ${i}`;
      if (water(c, r)) err(`${p}.at`, `${label} at [${c}, ${r}] is at sea`);
      else if (holder(c, r) !== s.owner) err(`${p}.at`, `${label} at [${c}, ${r}] stands on ${holder(c, r) ?? 'unowned'} ground, not ${s.owner ?? 'unowned'}`);
      const k = `${c},${r}`;
      if (taken.has(k)) err(`${p}.at`, `${label} shares [${c}, ${r}] with ${taken.get(k)}`);
      else taken.set(k, label);
    });
  for (const [i, n] of nations.entries()) {
    if (typeof n.id !== 'string' || typeof n.capital !== 'string') continue;
    const cap = siteIds.get(n.capital);
    if (!cap) err(`nations[${i}].capital`, `"${n.capital}" is not a site`);
    else if (cap.kind !== 'capital' || cap.owner !== n.id) err(`nations[${i}].capital`, `"${n.capital}" is not a capital held by ${n.id}`);
    const capitals = [...siteIds.values()].filter((s) => s.kind === 'capital' && s.owner === n.id).length;
    if (capitals !== 1) err(`nations[${i}]`, `${n.id} holds ${capitals} capitals; a nation holds exactly one`);
  }

  // Straits and chokepoints.
  const ids = new Set<string>();
  if (m.straits !== undefined) {
    if (!Array.isArray(m.straits)) err('straits', 'must be a list');
    else
      m.straits.forEach((s, i) => {
        const p = `straits[${i}]`;
        if (!isObject(s)) return err(p, 'must be an object');
        if (typeof s.id !== 'string' || !ID.test(s.id)) err(`${p}.id`, 'must be a lowercase id');
        else if (ids.has(s.id)) err(`${p}.id`, `"${s.id}" is already a strait`);
        else ids.add(s.id);
        if (typeof s.name !== 'string' || !s.name.trim()) err(`${p}.name`, 'must be a non-empty string');
        if (!STRAIT_KINDS.includes(s.kind as StraitKind)) err(`${p}.kind`, `must be one of ${STRAIT_KINDS.join(', ')}`);
        if (!Array.isArray(s.hexes) || s.hexes.length === 0) return err(`${p}.hexes`, 'must be a non-empty list of [col, row]');
        const cells: Cell[] = [];
        s.hexes.forEach((h, j) => {
          const at = inBounds(h, `${p}.hexes[${j}]`);
          if (!at || !terrain) return;
          cells.push(at);
          if (s.kind === 'strait' && !water(at[0], at[1])) err(`${p}.hexes[${j}]`, `[${at[0]}, ${at[1]}] is land; a strait is sea`);
          if (s.kind === 'land-bridge' && water(at[0], at[1])) err(`${p}.hexes[${j}]`, `[${at[0]}, ${at[1]}] is sea; a land bridge is land`);
        });
        if (s.joins === undefined) return;
        if (!Array.isArray(s.joins) || s.joins.length < 2) return err(`${p}.joins`, 'must list two or more sea zones');
        s.joins.forEach((z, j) => {
          if (typeof z !== 'string' || !zoneIds.has(z)) return err(`${p}.joins[${j}]`, `${JSON.stringify(z)} is not a sea zone`);
          if (!seaZone) return;
          const touches = cells.some((cell) => [cell, ...cellNeighbors({ cols, rows }, cell)].some(([c, r]) => layerAt(seaZone, c, r) === z));
          if (!touches) err(`${p}.joins[${j}]`, `"${z}" does not touch the strait`);
        });
      });
  }

  // Resources.
  if (m.resources !== undefined) {
    if (!Array.isArray(m.resources)) err('resources', 'must be a list');
    else
      m.resources.forEach((x, i) => {
        const p = `resources[${i}]`;
        if (!isObject(x)) return err(p, 'must be an object');
        if (!RESOURCE_KINDS.includes(x.kind as ResourceKind)) err(`${p}.kind`, `must be one of ${RESOURCE_KINDS.join(', ')}`);
        if (x.name !== undefined && typeof x.name !== 'string') err(`${p}.name`, 'must be a string');
        const at = inBounds(x.at, `${p}.at`);
        if (at && terrain && water(at[0], at[1])) err(`${p}.at`, `[${at[0]}, ${at[1]}] is at sea`);
      });
  }

  for (const k of Object.keys(m)) {
    if (!['format', 'version', 'id', 'name', 'cols', 'rows', 'layout', 'source', 'layers', 'nations', 'sites', 'seaZones', 'straits', 'resources'].includes(k)) err(k, 'is not a field this format knows');
  }
  return errors;
}

/** One-line summary of a valid map, for the checker's report. */
export function describeMap(map: MapFile): string {
  const powers = map.nations.filter((n) => n.role === 'power').length;
  return `${map.cols} x ${map.rows}, ${powers} powers, ${map.nations.length - powers} minor states, ${map.sites.length} sites, ${map.seaZones?.length ?? 0} sea zones, ${map.straits?.length ?? 0} straits, ${map.resources?.length ?? 0} resources`;
}

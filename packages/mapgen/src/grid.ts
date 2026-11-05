import type { NationId } from '@brink/contracts';
import { type Biome, MAP_FORMAT, MAP_VERSION, type MapFile, type MapNation, type MapResource, type MapSeaZone, type MapSite, type MapStrait, type MapTerrain } from '@brink/map';

// A character-grid map (one character per hex: sea, or the nation that holds it) to the map format.
// The Pacific was authored this way inline in its scenario; this is how it became a file, and how any
// further hand-drawn grid can.

/** One character per biome in the biome layer. */
export const BIOME_CHAR: Readonly<Record<Biome, string>> = {
  sea: '~',
  ice: 'i',
  tundra: 't',
  boreal: 'b',
  temperate: 'm',
  steppe: 's',
  desert: 'd',
  subtropical: 'u',
  tropical: 'r',
  highland: 'h',
};

/** One character per terrain in the terrain layer; `*` is ground the seed rolls. */
export const TERRAIN_CHAR: Readonly<Record<MapTerrain, string>> = {
  water: '~',
  seeded: '*',
  plains: 'p',
  forest: 'f',
  hills: 'h',
  mountains: 'm',
  urban: 'u',
};

export interface GridSpec {
  id: string;
  name: string;
  source?: string;
  grid: readonly string[];
  /** The character for open sea. */
  sea: string;
  /** Every land character to the nation holding it (null for unowned land). */
  regions: Readonly<Record<string, NationId | null>>;
  nations: MapNation[];
  sites: MapSite[];
  /** Ground for a land cell; seeded unless given. */
  terrain?: (col: number, row: number, owner: NationId | null) => MapTerrain;
  seaZones?: { zones: MapSeaZone[]; at: (col: number, row: number) => string };
  biome?: (col: number, row: number, owner: NationId | null) => Biome;
  straits?: MapStrait[];
  resources?: MapResource[];
}

const ZONE_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** The grid as a map file. The owner layer keeps the grid's own characters, so it reads as drawn. */
export function gridToMap(spec: GridSpec): MapFile {
  const rows = spec.grid.length;
  const cols = spec.grid[0]?.length ?? 0;
  const ownerOf = (col: number, row: number): NationId | null => {
    const ch = spec.grid[row]![col]!;
    if (ch === spec.sea) return null;
    if (!(ch in spec.regions)) throw new Error(`grid cell ${col},${row}: ${JSON.stringify(ch)} is not a region`);
    return spec.regions[ch]!;
  };
  const isSea = (col: number, row: number) => spec.grid[row]![col] === spec.sea;
  spec.grid.forEach((line, row) => {
    if (line.length !== cols) throw new Error(`grid row ${row} is ${line.length} wide, not ${cols}`);
    for (let col = 0; col < cols; col++) ownerOf(col, row);
  });
  const mapRows = (f: (col: number, row: number) => string) => spec.grid.map((line, row) => [...line].map((_, col) => f(col, row)).join(''));

  const usedTerrain = new Set<MapTerrain>();
  const terrainRows = mapRows((c, r) => {
    const t: MapTerrain = isSea(c, r) ? 'water' : (spec.terrain?.(c, r, ownerOf(c, r)) ?? 'seeded');
    usedTerrain.add(t);
    return TERRAIN_CHAR[t];
  });
  const terrainLegend: Record<string, MapTerrain> = {};
  for (const t of Object.keys(TERRAIN_CHAR) as MapTerrain[]) if (usedTerrain.has(t)) terrainLegend[TERRAIN_CHAR[t]] = t;

  const ownerLegend: Record<string, NationId | null> = { [spec.sea]: null };
  for (const ch of Object.keys(spec.regions).sort()) ownerLegend[ch] = spec.regions[ch]!;

  const map: MapFile = {
    format: MAP_FORMAT,
    version: MAP_VERSION,
    id: spec.id,
    name: spec.name,
    cols,
    rows,
    layout: 'odd-r',
    ...(spec.source ? { source: spec.source } : {}),
    layers: {
      owner: { legend: ownerLegend, rows: [...spec.grid] },
      terrain: { legend: terrainLegend, rows: terrainRows },
    },
    nations: spec.nations,
    sites: spec.sites,
  };

  if (spec.seaZones) {
    const { zones, at } = spec.seaZones;
    if (zones.length > ZONE_CHARS.length) throw new Error(`at most ${ZONE_CHARS.length} sea zones`);
    const charOf = new Map(zones.map((z, i) => [z.id, ZONE_CHARS[i]!]));
    const legend: Record<string, string | null> = { '-': null };
    zones.forEach((z, i) => (legend[ZONE_CHARS[i]!] = z.id));
    map.layers.seaZone = {
      legend,
      rows: mapRows((c, r) => {
        if (!isSea(c, r)) return '-';
        const ch = charOf.get(at(c, r));
        if (!ch) throw new Error(`sea at ${c},${r} is in no declared zone (${at(c, r)})`);
        return ch;
      }),
    };
    map.seaZones = zones;
  }
  if (spec.biome) {
    const biome = spec.biome;
    const used = new Set<Biome>();
    const biomeRows = mapRows((c, r) => {
      const b: Biome = isSea(c, r) ? 'sea' : biome(c, r, ownerOf(c, r));
      used.add(b);
      return BIOME_CHAR[b];
    });
    const legend: Record<string, Biome> = {};
    for (const b of Object.keys(BIOME_CHAR) as Biome[]) if (used.has(b)) legend[BIOME_CHAR[b]] = b;
    map.layers.biome = { legend, rows: biomeRows };
  }
  if (spec.straits) map.straits = spec.straits;
  if (spec.resources) map.resources = spec.resources;
  return map;
}

/**
 * A map file as JSON text: two-space indentation, but every `[col, row]` pair and every layer row on
 * one line, so a diff of the file reads like a diff of the map.
 */
export function mapToJson(map: MapFile): string {
  const text = JSON.stringify(map, null, 2);
  // Collapse short numeric arrays ([col, row]) onto one line.
  return text.replace(/\[\s+(-?\d+),\s+(-?\d+)\s+\]/g, '[$1, $2]') + '\n';
}

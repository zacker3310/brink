import type { GovernmentId, NationId } from '@brink/contracts';
import { type Biome, type Cell, cellKey, cellNeighbors, keyDistance, MAP_FORMAT, MAP_VERSION, type MapFile, type MapNation, type MapResource, type MapSite, type MapStrait, RESOURCE_KINDS } from '@brink/map';
import { type Box, bakeLand, type BakeOptions, type Polygon, prng } from './coastline';
import { BIOME_CHAR } from './grid';

// A theatre map from coastlines (docs/mapgen.md): bake the land, place the nations' capitals far
// apart, grow their borders over the land from the capitals, then lay out cities, depots, sea zones,
// straits, biomes and resources. Real theatres pass Natural Earth polygons and hand-place what
// matters; the generator gives a playable first cut and the 2-to-12-power test maps.

export interface TheatreNation {
  id: NationId;
  name: string;
  short: string;
  color: string;
  government: GovernmentId;
}

export interface TheatreSpec {
  id: string;
  name: string;
  source: string;
  seed: number;
  cols: number;
  rows: number;
  box: Box;
  coastline: readonly Polygon[];
  bake?: BakeOptions;
  powers: readonly TheatreNation[];
  minors: readonly TheatreNation[];
  /** Cities and depots per power beyond the capital (default 3 and 1); minor states get one city. */
  citiesPerPower?: number;
  depotsPerPower?: number;
  /** The side of a square block of sea that makes one sea zone (default 16 hexes). */
  zoneBlock?: number;
}

const dist = (a: Cell, b: Cell) => keyDistance(cellKey(a), cellKey(b));
const byCell = (a: Cell, b: Cell) => a[1] - b[1] || a[0] - b[0];

/** Land cells far from everything chosen so far: the next pick maximises its distance to the nearest. */
function spread(candidates: readonly Cell[], chosen: Cell[], count: number, minGap: number): Cell[] {
  const picked: Cell[] = [];
  for (let i = 0; i < count; i++) {
    let best: Cell | null = null;
    let bestD = -1;
    for (const c of candidates) {
      const all = [...chosen, ...picked];
      const d = all.length ? Math.min(...all.map((o) => dist(c, o))) : 0;
      if (d >= minGap && d > bestD) {
        best = c;
        bestD = d;
      }
    }
    if (!best) break;
    picked.push(best);
  }
  return picked;
}

function components(mask: boolean[][], grid: { cols: number; rows: number }): Cell[][] {
  const seen = mask.map((r) => r.map(() => false));
  const out: Cell[][] = [];
  for (let row = 0; row < grid.rows; row++)
    for (let col = 0; col < grid.cols; col++) {
      if (!mask[row]![col] || seen[row]![col]) continue;
      const comp: Cell[] = [];
      const queue: Cell[] = [[col, row]];
      seen[row]![col] = true;
      while (queue.length) {
        const c = queue.shift()!;
        comp.push(c);
        for (const [nc, nr] of cellNeighbors(grid, c)) {
          if (mask[nr]![nc] && !seen[nr]![nc]) {
            seen[nr]![nc] = true;
            queue.push([nc, nr]);
          }
        }
      }
      out.push(comp);
    }
  return out.sort((a, b) => b.length - a.length || byCell(a[0]!, b[0]!));
}

export function generateTheatre(spec: TheatreSpec): MapFile {
  const grid = { cols: spec.cols, rows: spec.rows };
  const mask = bakeLand(spec.coastline, spec.box, grid, spec.bake);
  const land: Cell[] = [];
  for (let row = 0; row < spec.rows; row++) for (let col = 0; col < spec.cols; col++) if (mask[row]![col]) land.push([col, row]);
  const next = prng(spec.seed);
  const nations = [...spec.powers, ...spec.minors];
  if (!nations.length) throw new Error('a theatre needs nations');

  // Capitals: on the larger landmasses, inland by a hex (not walled by sea), as far apart as can be.
  // Powers first, so they spread over the whole map; minor states then fill the gaps between them.
  const comps = components(mask, grid);
  const big = comps.filter((c) => c.length >= 12).flat().sort(byCell);
  const coastal = (c: Cell) => cellNeighbors(grid, c).some(([cc, rr]) => !mask[rr]![cc]);
  const inland = big.filter((c) => cellNeighbors(grid, c).length === 6);
  const firstPick = inland[Math.floor(next() * inland.length)];
  if (!firstPick) throw new Error(`${spec.id}: no landmass big enough for a capital`);
  const capitals: Cell[] = [firstPick, ...spread(inland, [firstPick], spec.powers.length - 1, 4)];
  capitals.push(...spread(inland, [...capitals], spec.minors.length, 3));
  if (capitals.length < nations.length) throw new Error(`${spec.id}: room for ${capitals.length} capitals, not ${nations.length}`);

  // Borders: every land hex to the capital nearest over land (ties to the earlier nation); land no
  // capital can walk to goes to the nearest capital as the crow flies (islands have owners too).
  const owner: (number | null)[][] = mask.map((r) => r.map(() => null));
  let frontier: [Cell, number][] = capitals.map((c, i) => [c, i]);
  for (const [[c, r], i] of frontier) owner[r]![c] = i;
  while (frontier.length) {
    const nextRing: [Cell, number][] = [];
    for (const [cell, i] of frontier)
      for (const [c, r] of cellNeighbors(grid, cell)) {
        if (!mask[r]![c] || owner[r]![c] !== null) continue;
        owner[r]![c] = i;
        nextRing.push([[c, r], i]);
      }
    frontier = nextRing;
  }
  for (const [c, r] of land)
    if (owner[r]![c] === null) {
      let best = 0;
      capitals.forEach((cap, i) => {
        if (dist([c, r], cap) < dist([c, r], capitals[best]!)) best = i;
      });
      owner[r]![c] = best;
    }

  // Sites: the capital, then cities and depots spread across the nation's own ground, never next to
  // another site. A power's first city is on the coast where it has one: its navy's port.
  const sites: MapSite[] = [];
  const taken: Cell[] = [];
  const cities = spec.citiesPerPower ?? 3;
  const depots = spec.depotsPerPower ?? 1;
  nations.forEach((n, i) => {
    const cap = capitals[i]!;
    const mine = land.filter(([c, r]) => owner[r]![c] === i);
    const free = (cs: Cell[]) => cs.filter((c) => taken.every((t) => dist(c, t) >= 2));
    sites.push({ id: `${n.id}-capital`, kind: 'capital', name: `${n.name} City`, at: cap, owner: n.id });
    taken.push(cap);
    const isPower = i < spec.powers.length;
    const want = isPower ? cities : 1;
    const shore = isPower ? spread(free(mine.filter(coastal)), [cap], 1, 2) : [];
    const cityCells = [...shore, ...spread(free(mine), [cap, ...shore], want - shore.length, 2)];
    if (cityCells.length < want) throw new Error(`${spec.id}: ${n.id} has room for ${cityCells.length} cities, not ${want}`);
    cityCells.forEach((c, k) => {
      sites.push({ id: `${n.id}-city${k}`, kind: 'city', name: k === 0 && shore.length ? `${n.short} Port` : `${n.short} Town ${k + 1}`, at: c, owner: n.id });
      taken.push(c);
    });
    if (isPower) {
      const depotCells = spread(free(mine), [cap, ...cityCells], depots, 2);
      if (depotCells.length < depots) throw new Error(`${spec.id}: ${n.id} has room for ${depotCells.length} depots, not ${depots}`);
      depotCells.forEach((c, k) => {
        sites.push({ id: `${n.id}-depot${k}`, kind: 'depot', name: `${n.short} Depot${k ? ` ${k + 1}` : ''}`, at: c, owner: n.id });
        taken.push(c);
      });
    }
  });
  // Site names are unique per map: number any repeats.
  const seenNames = new Map<string, number>();
  for (const s of sites) {
    const k = seenNames.get(s.name) ?? 0;
    seenNames.set(s.name, k + 1);
    if (k) s.name = `${s.name} ${k + 1}`;
  }

  // Sea zones: square blocks of open sea.
  const block = spec.zoneBlock ?? 16;
  const zoneOf = (c: number, r: number) => `sea-${Math.floor(c / block)}-${Math.floor(r / block)}`;
  const zoneIds: string[] = [];
  for (let row = 0; row < spec.rows; row++) for (let col = 0; col < spec.cols; col++) if (!mask[row]![col] && !zoneIds.includes(zoneOf(col, row))) zoneIds.push(zoneOf(col, row));
  zoneIds.sort();
  const ZONE = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  if (zoneIds.length > ZONE.length) throw new Error(`${spec.id}: ${zoneIds.length} sea zones; use a bigger zoneBlock`);
  const zoneChar = new Map(zoneIds.map((z, i) => [z, ZONE[i]!]));

  // Biomes by latitude, with steppe and desert inland in the dry belt.
  const latOf = (row: number) => spec.box.north - ((row + 0.5) / spec.rows) * (spec.box.north - spec.box.south);
  const biomeOf = (c: number, r: number): Biome => {
    if (!mask[r]![c]) return 'sea';
    const lat = Math.abs(latOf(r));
    if (lat > 70) return 'ice';
    if (lat > 60) return 'tundra';
    if (lat > 48) return 'boreal';
    if (lat > 34) return coastal([c, r]) ? 'temperate' : 'steppe';
    if (lat > 20) return coastal([c, r]) ? 'subtropical' : 'desert';
    return 'tropical';
  };

  // Straits: open sea pinched between land on opposite sides, in short runs.
  const pinched = (c: number, r: number) => {
    if (mask[r]![c]) return false;
    const ns = cellNeighbors(grid, [c, r]);
    if (ns.length < 6) return false;
    // Neighbours come E, NE, NW, W, SW, SE: opposite pairs are three apart.
    return [0, 1, 2].some((d) => mask[ns[d]![1]]![ns[d]![0]] && mask[ns[d + 3]![1]]![ns[d + 3]![0]]);
  };
  const straits: MapStrait[] = [];
  const used = new Set<string>();
  for (let row = 0; row < spec.rows && straits.length < 8; row++)
    for (let col = 0; col < spec.cols && straits.length < 8; col++) {
      if (!pinched(col, row) || used.has(`${col},${row}`)) continue;
      const run: Cell[] = [[col, row]];
      used.add(`${col},${row}`);
      for (const [c, r] of cellNeighbors(grid, [col, row]))
        if (pinched(c, r) && !used.has(`${c},${r}`) && run.length < 3) {
          run.push([c, r]);
          used.add(`${c},${r}`);
        }
      const touching = new Set<string>();
      for (const cell of run) for (const [c, r] of [cell, ...cellNeighbors(grid, cell)]) if (!mask[r]![c]) touching.add(zoneOf(c, r));
      const joins = [...touching].sort();
      straits.push({ id: `strait-${straits.length + 1}`, name: `Strait ${straits.length + 1}`, kind: 'strait', hexes: run, ...(joins.length >= 2 ? { joins } : {}) });
    }

  // Resources: one of each kind in turn on open ground, scattered.
  const open = land.filter((c) => taken.every((t) => dist(c, t) >= 1));
  const resources: MapResource[] = spread(open, [...taken], Math.min(open.length, nations.length), 2).map((at, i) => ({ kind: RESOURCE_KINDS[i % RESOURCE_KINDS.length]!, at }));

  const ownerChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  if (nations.length > ownerChars.length) throw new Error('at most 26 nations');
  const ownerLegend: Record<string, NationId | null> = { '.': null };
  nations.forEach((n, i) => (ownerLegend[ownerChars[i]!] = n.id));
  const rowsOf = (f: (c: number, r: number) => string) => Array.from({ length: spec.rows }, (_, r) => Array.from({ length: spec.cols }, (_, c) => f(c, r)).join(''));
  const biomeRows = rowsOf((c, r) => BIOME_CHAR[biomeOf(c, r)]);
  const biomeLegend: Record<string, Biome> = {};
  for (const [b, ch] of Object.entries(BIOME_CHAR) as [Biome, string][]) if (biomeRows.some((row) => row.includes(ch))) biomeLegend[ch] = b;
  const zoneLegend: Record<string, string | null> = { '-': null };
  for (const z of zoneIds) zoneLegend[zoneChar.get(z)!] = z;

  const mapNations: MapNation[] = nations.map((n, i) => ({
    id: n.id,
    name: n.name,
    short: n.short,
    color: n.color,
    government: n.government,
    role: i < spec.powers.length ? 'power' : 'minor',
    capital: `${n.id}-capital`,
    terrainBias: Math.round(next() * 40) - 10,
  }));

  return {
    format: MAP_FORMAT,
    version: MAP_VERSION,
    id: spec.id,
    name: spec.name,
    cols: spec.cols,
    rows: spec.rows,
    layout: 'odd-r',
    source: spec.source,
    layers: {
      owner: { legend: ownerLegend, rows: rowsOf((c, r) => (mask[r]![c] ? ownerChars[owner[r]![c]!]! : '.')) },
      terrain: { legend: { '~': 'water', '*': 'seeded' }, rows: rowsOf((c, r) => (mask[r]![c] ? '*' : '~')) },
      seaZone: { legend: zoneLegend, rows: rowsOf((c, r) => (mask[r]![c] ? '-' : zoneChar.get(zoneOf(c, r))!)) },
      biome: { legend: biomeLegend, rows: biomeRows },
    },
    nations: mapNations,
    sites,
    seaZones: zoneIds.map((z) => ({ id: z, name: `Sea ${z.slice(4).replace('-', '.')}` })),
    straits,
    resources,
  };
}

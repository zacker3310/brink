// Coastlines to hexes (docs/mapgen.md). A coastline is a set of polygons in longitude and latitude,
// as Natural Earth's public-domain land and country layers give them (GeoJSON Polygon and
// MultiPolygon). Baking projects a box of the globe onto a hex grid and asks of each hex whether it
// is land. This runs offline, once per theatre; floating point is fine here, because what comes out
// is characters in a map file, never state the engine computes with.

export type LonLat = readonly [lon: number, lat: number];
/** A closed ring; the last point need not repeat the first. */
export type Ring = readonly LonLat[];
/** An outer ring and its holes (lakes, inland seas). */
export type Polygon = readonly Ring[];

export interface Box {
  west: number;
  east: number;
  south: number;
  north: number;
}

export interface Grid {
  cols: number;
  rows: number;
}

/** The longitude and latitude of a hex's centre, equirectangular over the box (odd rows half a hex east). */
export function hexCentre(box: Box, grid: Grid, col: number, row: number, dx = 0, dy = 0): LonLat {
  const x = (col + 0.5 + (row & 1) * 0.5 + dx) / (grid.cols + 0.5);
  const y = (row + 0.5 + dy) / grid.rows;
  return [box.west + x * (box.east - box.west), box.north - y * (box.north - box.south)];
}

/** Even-odd rule: inside the outer ring and in none of its holes. */
export function inPolygon(p: LonLat, poly: Polygon): boolean {
  let inside = false;
  for (const ring of poly) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]!;
      const [xj, yj] = ring[j]!;
      if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

function bounds(poly: Polygon): Box {
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  for (const [lon, lat] of poly[0] ?? []) {
    west = Math.min(west, lon);
    east = Math.max(east, lon);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }
  return { west, east, south, north };
}

/** Seven sample points per hex: the centre and six around it, a third of a hex out. */
const SAMPLES: readonly (readonly [number, number])[] = [[0, 0], ...Array.from({ length: 6 }, (_, i) => [Math.cos((Math.PI / 3) * i) / 3, Math.sin((Math.PI / 3) * i) / 3] as const)];

export interface BakeOptions {
  /** Samples of seven that must be land for the hex to be land (default 4, a majority). */
  threshold?: number;
  /** Keep an island too small to win any hex: its centre's hex becomes land (default true). */
  keepIslands?: boolean;
}

/** Which hexes are land: `mask[row][col]`. */
export function bakeLand(polys: readonly Polygon[], box: Box, grid: Grid, opts: BakeOptions = {}): boolean[][] {
  const threshold = opts.threshold ?? 4;
  const boxes = polys.map(bounds);
  const mask = Array.from({ length: grid.rows }, () => Array<boolean>(grid.cols).fill(false));
  const won = new Set<number>();
  for (let row = 0; row < grid.rows; row++)
    for (let col = 0; col < grid.cols; col++) {
      let land = 0;
      const hits = new Set<number>();
      for (const [dx, dy] of SAMPLES) {
        const p = hexCentre(box, grid, col, row, dx, dy);
        const i = polys.findIndex((poly, k) => p[0] >= boxes[k]!.west && p[0] <= boxes[k]!.east && p[1] >= boxes[k]!.south && p[1] <= boxes[k]!.north && inPolygon(p, poly));
        if (i >= 0) {
          land++;
          hits.add(i);
        }
      }
      if (land >= threshold) {
        mask[row]![col] = true;
        for (const i of hits) won.add(i);
      }
    }
  // An island too small to win a hex of its own still gets the one under its middle.
  if (opts.keepIslands ?? true)
    polys.forEach((_, i) => {
      if (won.has(i)) return;
      const b = boxes[i]!;
      const c = hexAt(box, grid, [(b.west + b.east) / 2, (b.south + b.north) / 2]);
      if (c) mask[c[1]]![c[0]] = true;
    });
  return mask;
}

/** The hex whose centre is nearest a point, or null off the box. */
export function hexAt(box: Box, grid: Grid, [lon, lat]: LonLat): [number, number] | null {
  const y = ((box.north - lat) / (box.north - box.south)) * grid.rows - 0.5;
  const row = Math.round(y);
  if (row < 0 || row >= grid.rows) return null;
  const x = ((lon - box.west) / (box.east - box.west)) * (grid.cols + 0.5) - 0.5 - (row & 1) * 0.5;
  const col = Math.round(x);
  if (col < 0 || col >= grid.cols) return null;
  return [col, row];
}

/** The polygons of a GeoJSON FeatureCollection, Feature or geometry (Polygon and MultiPolygon). */
export function polygonsOf(geojson: unknown): Polygon[] {
  const out: Polygon[] = [];
  const visit = (g: unknown) => {
    if (typeof g !== 'object' || g === null) return;
    const o = g as { type?: string; features?: unknown[]; geometry?: unknown; coordinates?: unknown };
    if (o.type === 'FeatureCollection') for (const f of o.features ?? []) visit(f);
    else if (o.type === 'Feature') visit(o.geometry);
    else if (o.type === 'Polygon') out.push(o.coordinates as Polygon);
    else if (o.type === 'MultiPolygon') for (const p of o.coordinates as Polygon[]) out.push(p);
  };
  visit(geojson);
  return out;
}

/** A small deterministic generator for synthetic coastlines (not the engine's: this never runs in play). */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Synthetic continents: wobbly blobs scattered over the box, so the generator can be built and
 * tested without coastline data. Each is a ring of `points` around a centre, its radius varied by
 * three seeded harmonics.
 */
export function syntheticCoastline(seed: number, box: Box, count: number, points = 48): Polygon[] {
  const next = prng(seed);
  const w = box.east - box.west;
  const h = box.north - box.south;
  const out: Polygon[] = [];
  for (let i = 0; i < count; i++) {
    const cx = box.west + w * (0.1 + 0.8 * next());
    const cy = box.south + h * (0.15 + 0.7 * next());
    const r = Math.min(w, h) * (0.1 + 0.14 * next());
    const harmonics = [2, 3, 5].map((k) => ({ k, amp: 0.12 + 0.18 * next(), phase: next() * Math.PI * 2 }));
    const ring: LonLat[] = [];
    for (let p = 0; p < points; p++) {
      const t = (p / points) * Math.PI * 2;
      const f = 1 + harmonics.reduce((a, hm) => a + hm.amp * Math.sin(hm.k * t + hm.phase), 0);
      ring.push([cx + Math.cos(t) * r * f * 1.6, cy + Math.sin(t) * r * f]);
    }
    out.push([ring]);
  }
  return out;
}

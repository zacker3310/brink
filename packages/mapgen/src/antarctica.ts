import type { NationId } from '@brink/contracts';
import { type Biome, type MapFile, type MapNation, type MapSite, type MapTerrain, neighbors, offsetToAxial } from '@brink/map';
import { gridToMap } from './grid';

// The Antarctica theatre (Black Files, MASTER-PLAN Phase 8), drawn from a polar projection rather than
// baked from coastline data: the continent seen from above the South Pole, Greenwich at the top,
// the Antarctic Peninsula reaching up and left for Tierra del Fuego across the Drake Passage.
// East Antarctica is the great lobe on the right, West Antarctica the smaller one on the left, the
// Ross and Weddell Seas the two bays, their ice shelves the plains that fill them.
//
// The powers hold sectors as the treaty claims are drawn: wedges from the coast toward the pole.
// The plateau round the pole and Ellsworth Land are nobody's: that is where the digs are.
// Station names are the real stations' where a power has one in its sector, invented where not;
// the black sites are invented. `pnpm --filter @brink/mapgen map:antarctica` writes the file, and
// a test checks the committed file is what this makes.

export const ANTARCTICA_ID = 'antarctica';

const COLS = 44;
const ROWS = 38;
/** Hex-width units: a column is 1 wide, a row 0.866 high, odd rows half a column east. */
const X = (col: number, row: number) => col + (row & 1 ? 0.5 : 0);
const Y = (row: number) => row * 0.8660254;
const CX = X(26, 0);
const CY = Y(22);

/** Bearing (degrees east of Greenwich, -180..180, clockwise from the top) and distance from the pole. */
function polar(col: number, row: number): { theta: number; r: number } {
  const dx = X(col, row) - CX;
  const dy = Y(row) - CY;
  return { theta: (Math.atan2(dx, -dy) * 180) / Math.PI, r: Math.hypot(dx, dy) };
}

function at(theta: number, r: number): { x: number; y: number } {
  const t = (theta * Math.PI) / 180;
  return { x: CX + Math.sin(t) * r, y: CY - Math.cos(t) * r };
}

const angle = (a: number, b: number) => {
  const d = (((a - b) % 360) + 540) % 360 - 180;
  return Math.abs(d);
};

/** A dip of `depth` within `width` degrees of `centre`. */
const bay = (theta: number, centre: number, width: number, depth: number) => {
  const d = angle(theta, centre);
  return d < width ? depth * (1 - d / width) : 0;
};

/** How far the grounded ice reaches at a bearing, and how far the shelves carry it on. */
function coast(theta: number): { ground: number; shelf: number } {
  const east = theta > -30 && theta < 165;
  const blend = east ? 12.5 : 9;
  const wobble = 0.8 * Math.sin((3 * theta * Math.PI) / 180) + 0.5 * Math.sin((7 * theta * Math.PI) / 180 + 1);
  const ross = bay(theta, 180, 22, 5.5);
  const weddell = bay(theta, -42, 18, 4.5);
  const amery = bay(theta, 70, 6, 2);
  const ground = blend + wobble - ross - weddell - amery;
  return { ground, shelf: ground + 0.55 * (ross + weddell + amery) };
}

const dist2seg = (px: number, py: number, a: { x: number; y: number }, b: { x: number; y: number }) => {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((px - a.x) * vx + (py - a.y) * vy) / (vx * vx + vy * vy)));
  return Math.hypot(px - (a.x + t * vx), py - (a.y + t * vy));
};

const PENINSULA = [at(-66, 8), at(-60, 13), at(-57, 19)];
const FUEGO = at(-66, 28.5);

type Cell = 'sea' | 'ice' | 'shelf' | 'fuego';

function cellOf(col: number, row: number): Cell {
  const x = X(col, row);
  const y = Y(row);
  if (Math.hypot(x - FUEGO.x, y - FUEGO.y) < 7.2) return 'fuego';
  const { theta, r } = polar(col, row);
  if (dist2seg(x, y, PENINSULA[0]!, PENINSULA[1]!) < 1.4 || dist2seg(x, y, PENINSULA[1]!, PENINSULA[2]!) < 1.1) return 'ice';
  const c = coast(theta);
  if (r <= c.ground) return 'ice';
  if (r <= c.shelf) return 'shelf';
  return 'sea';
}

/** Who claims a hex of the continent: the sectors, the neutral plateau, unclaimed Ellsworth Land. */
function claimOf(col: number, row: number, cell: Cell): NationId | null {
  if (cell === 'fuego') return 'chile';
  const { theta, r } = polar(col, row);
  if (r < 4.6) return null;
  if (theta >= -82 && theta < -20) return 'uk';
  if (theta >= -20 && theta < 30) return 'norway';
  if (theta >= 30 && theta < 85) return 'china';
  if (theta >= 85 && theta < 125) return 'russia';
  if (theta >= 125 && theta < 165) return 'australia';
  if (theta >= 165 || theta < -112) return 'usa';
  return null;
}

/** Deterministic texture: no seed in the map file, only in the scenario. */
function noise(col: number, row: number): number {
  let h = (col * 374761393 + row * 668265263) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h ^ (h >>> 16)) % 100;
}

/** The Transantarctic Mountains: from the Ross Sea's western shore past the pole to the Weddell's. */
const RANGE = [at(160, 9.5), at(150, 4), at(-60, 3.5), at(-38, 7)];
/** Mountains of the peninsula's spine, Marie Byrd Land, the Gamburtsevs under the ice and Queen Maud Land's. */
const MASSIFS = [
  { c: at(-60, 13), r: 1.2 },
  { c: at(-130, 7), r: 1.6 },
  { c: at(75, 6.5), r: 1.2 },
  { c: at(10, 10), r: 1.3 },
];

function terrainOf(col: number, row: number, cell: Cell): MapTerrain {
  if (cell === 'sea') return 'water';
  if (cell === 'shelf') return 'plains';
  const x = X(col, row);
  const y = Y(row);
  const n = noise(col, row);
  if (cell === 'fuego') return n < 30 ? 'hills' : n < 55 ? 'forest' : 'plains';
  const range = Math.min(dist2seg(x, y, RANGE[0]!, RANGE[1]!), dist2seg(x, y, RANGE[1]!, RANGE[2]!), dist2seg(x, y, RANGE[2]!, RANGE[3]!));
  if (range < 0.7) return n < 70 ? 'mountains' : 'hills';
  if (range < 1.5 && n < 50) return 'hills';
  if (MASSIFS.some((m) => Math.hypot(x - m.c.x, y - m.c.y) < m.r)) return n < 60 ? 'mountains' : 'hills';
  return n < 14 ? 'hills' : 'plains';
}

const NATIONS: MapNation[] = [
  { id: 'usa', name: 'United States', short: 'USA', color: '#4f8fe0', government: 'commonwealth', role: 'power', capital: 'usa-capital' },
  { id: 'russia', name: 'Russia', short: 'Russia', color: '#d0543e', government: 'directorate', role: 'power', capital: 'russia-capital' },
  { id: 'china', name: 'China', short: 'China', color: '#e0b43c', government: 'union', role: 'power', capital: 'china-capital' },
  { id: 'uk', name: 'United Kingdom', short: 'UK', color: '#9a6fd6', government: 'commonwealth', role: 'power', capital: 'uk-capital' },
  { id: 'australia', name: 'Australia', short: 'Australia', color: '#38b07a', government: 'federation', role: 'power', capital: 'australia-capital' },
  { id: 'norway', name: 'Norway', short: 'Norway', color: '#c46a7a', government: 'commonwealth', role: 'minor', capital: 'norway-capital' },
  { id: 'chile', name: 'Chile', short: 'Chile', color: '#d9924a', government: 'union', role: 'minor', capital: 'chile-capital' },
];

interface Want {
  id: string;
  name: string;
  kind: MapSite['kind'];
  owner: NationId | null;
  theta: number;
  r: number;
  coastal?: boolean;
  anomaly?: MapSite['anomaly'];
  victoryPoints?: number;
}

const WANTS: Want[] = [
  { id: 'usa-capital', name: 'McMurdo Station', kind: 'capital', owner: 'usa', theta: 166, r: 8, coastal: true },
  { id: 'usa-byrd', name: 'Byrd Station', kind: 'city', owner: 'usa', theta: -122, r: 6.5 },
  { id: 'usa-siple', name: 'Siple Station', kind: 'city', owner: 'usa', theta: -145, r: 8, coastal: true },
  { id: 'usa-little-america', name: 'Little America', kind: 'depot', owner: 'usa', theta: -172, r: 6 },
  { id: 'usa-kestrel', name: 'Site Kestrel', kind: 'objective', owner: 'usa', theta: 176, r: 5.2, anomaly: 'blacksite' },

  { id: 'russia-capital', name: 'Mirny Observatory', kind: 'capital', owner: 'russia', theta: 95, r: 12.5, coastal: true },
  { id: 'russia-vostok', name: 'Vostok Station', kind: 'city', owner: 'russia', theta: 108, r: 6 },
  { id: 'russia-leningradskaya', name: 'Leningradskaya', kind: 'city', owner: 'russia', theta: 118, r: 11, coastal: true },
  { id: 'russia-komsomolskaya', name: 'Komsomolskaya', kind: 'depot', owner: 'russia', theta: 98, r: 9 },
  { id: 'russia-object', name: 'Object 17', kind: 'objective', owner: 'russia', theta: 112, r: 8.5, anomaly: 'blacksite' },

  { id: 'china-capital', name: 'Zhongshan Station', kind: 'capital', owner: 'china', theta: 76, r: 10.5, coastal: true },
  { id: 'china-kunlun', name: 'Kunlun Station', kind: 'city', owner: 'china', theta: 72, r: 5.5 },
  { id: 'china-taishan', name: 'Taishan Station', kind: 'city', owner: 'china', theta: 45, r: 10.5, coastal: true },
  { id: 'china-qinling', name: 'Qinling Depot', kind: 'depot', owner: 'china', theta: 38, r: 7.5 },
  { id: 'china-station-9', name: 'Station 9', kind: 'objective', owner: 'china', theta: 58, r: 8, anomaly: 'blacksite' },

  { id: 'uk-capital', name: 'Rothera Station', kind: 'capital', owner: 'uk', theta: -61, r: 12, coastal: true },
  { id: 'uk-halley', name: 'Halley Station', kind: 'city', owner: 'uk', theta: -28, r: 9, coastal: true },
  { id: 'uk-fossil-bluff', name: 'Fossil Bluff', kind: 'city', owner: 'uk', theta: -75, r: 8 },
  { id: 'uk-signy', name: 'Signy Depot', kind: 'depot', owner: 'uk', theta: -57, r: 17, coastal: true },
  { id: 'uk-halley-annex', name: 'Halley Annex', kind: 'objective', owner: 'uk', theta: -38, r: 6, anomaly: 'blacksite' },

  { id: 'australia-capital', name: 'Casey Station', kind: 'capital', owner: 'australia', theta: 130, r: 12, coastal: true },
  { id: 'australia-commonwealth-bay', name: 'Commonwealth Bay', kind: 'city', owner: 'australia', theta: 150, r: 11, coastal: true },
  { id: 'australia-edgeworth', name: 'Edgeworth Station', kind: 'city', owner: 'australia', theta: 140, r: 6.5 },
  { id: 'australia-wilkes', name: 'Wilkes Depot', kind: 'depot', owner: 'australia', theta: 128, r: 8.5 },
  { id: 'australia-law-dome', name: 'Law Dome Annex', kind: 'objective', owner: 'australia', theta: 158, r: 8, anomaly: 'blacksite' },

  { id: 'norway-capital', name: 'Troll Station', kind: 'capital', owner: 'norway', theta: 3, r: 9 },
  { id: 'chile-capital', name: 'Punta Arenas', kind: 'capital', owner: 'chile', theta: -69, r: 30 },
  { id: 'chile-puerto-williams', name: 'Puerto Williams', kind: 'city', owner: 'chile', theta: -63, r: 23.5, coastal: true },

  // The digs: where the ice is thickest and nobody's.
  { id: 'dig-pole', name: 'Amundsen Shaft', kind: 'objective', owner: null, theta: 0, r: 0, anomaly: 'excavation', victoryPoints: 4 },
  { id: 'dig-ellsworth', name: 'Ellsworth Anomaly', kind: 'objective', owner: null, theta: -97, r: 6.5, anomaly: 'excavation', victoryPoints: 4 },
  { id: 'dig-dome-argus', name: 'Dome Argus Bore', kind: 'objective', owner: null, theta: 80, r: 2.8, anomaly: 'excavation', victoryPoints: 4 },
  { id: 'dig-recovery', name: 'Recovery Lakes Cut', kind: 'objective', owner: null, theta: -12, r: 3.2, anomaly: 'excavation', victoryPoints: 4 },
];

const inside = (c: number, r: number) => c >= 0 && c < COLS && r >= 0 && r < ROWS;

function neighbourCells(col: number, row: number): [number, number][] {
  const a = offsetToAxial(col, row);
  return neighbors(a)
    .map((n) => [n.q + (n.r - (n.r & 1)) / 2, n.r] as [number, number])
    .filter(([c, r]) => inside(c, r));
}

export function generateAntarctica(): MapFile {
  const cells: Cell[][] = [];
  for (let row = 0; row < ROWS; row++) {
    cells.push([]);
    for (let col = 0; col < COLS; col++) cells[row]!.push(cellOf(col, row));
  }
  const CH: Record<string, string> = { usa: 'U', russia: 'R', china: 'C', uk: 'K', australia: 'A', norway: 'N', chile: 'L' };
  const grid = cells.map((line, row) => line.map((cell, col) => (cell === 'sea' ? '~' : (CH[claimOf(col, row, cell) ?? ''] ?? '.'))).join(''));
  const ownerAt = (col: number, row: number) => {
    const ch = grid[row]![col]!;
    return ch === '~' ? undefined : (Object.keys(CH).find((k) => CH[k] === ch) ?? null);
  };
  const sea = (c: number, r: number) => cells[r]![c] === 'sea';

  const taken = new Set<string>();
  const sites: MapSite[] = WANTS.map((w) => {
    const p = at(w.theta, w.r);
    let best: [number, number] | null = null;
    let bd = Infinity;
    for (let row = 0; row < ROWS; row++)
      for (let col = 0; col < COLS; col++) {
        if (sea(col, row) || ownerAt(col, row) !== w.owner || taken.has(`${col},${row}`)) continue;
        const ns = neighbourCells(col, row);
        if (ns.some(([c, r]) => taken.has(`${c},${r}`))) continue;
        if (w.coastal && !ns.some(([c, r]) => sea(c, r))) continue;
        if (terrainOf(col, row, cells[row]![col]!) === 'mountains') continue;
        const d = Math.hypot(X(col, row) - p.x, Y(row) - p.y);
        if (d < bd) {
          bd = d;
          best = [col, row];
        }
      }
    if (!best) throw new Error(`antarctica: no place for ${w.name}`);
    taken.add(`${best[0]},${best[1]}`);
    return {
      id: w.id,
      kind: w.kind,
      name: w.name,
      at: best,
      owner: w.owner,
      ...(w.victoryPoints ? { victoryPoints: w.victoryPoints } : {}),
      ...(w.anomaly ? { anomaly: w.anomaly } : {}),
    };
  });

  const zoneOf = (col: number, row: number): string => {
    const { theta, r } = polar(col, row);
    const x = X(col, row);
    const y = Y(row);
    if (dist2seg(x, y, at(-62, 19.5), at(-64, 22.5)) < 4 && r > 17) return 'drake-passage';
    if (angle(theta, 180) < 28 && r < 15) return 'ross-sea';
    if (angle(theta, -42) < 22 && r < 15) return 'weddell-sea';
    return 'southern-ocean';
  };
  const drake: [number, number][] = [];
  for (let row = 0; row < ROWS; row++)
    for (let col = 0; col < COLS; col++) {
      if (sea(col, row) && zoneOf(col, row) === 'drake-passage') drake.push([col, row]);
    }

  const biome = (col: number, row: number): Biome => (cells[row]![col] === 'fuego' ? 'tundra' : 'ice');
  return gridToMap({
    id: ANTARCTICA_ID,
    name: 'Antarctica',
    source: 'Hand-drawn from a polar projection by packages/mapgen/src/antarctica.ts (no coastline data). Station names are the real stations’ or invented; black sites invented.',
    grid,
    sea: '~',
    regions: { U: 'usa', R: 'russia', C: 'china', K: 'uk', A: 'australia', N: 'norway', L: 'chile', '.': null },
    nations: NATIONS,
    sites,
    terrain: (c, r) => terrainOf(c, r, cells[r]![c]!),
    biome,
    seaZones: {
      zones: [
        { id: 'southern-ocean', name: 'Southern Ocean' },
        { id: 'ross-sea', name: 'Ross Sea' },
        { id: 'weddell-sea', name: 'Weddell Sea' },
        { id: 'drake-passage', name: 'Drake Passage' },
      ],
      at: zoneOf,
    },
    straits: [{ id: 'drake', name: 'Drake Passage', kind: 'strait', hexes: drake, joins: ['drake-passage', 'southern-ocean'] }],
    resources: [
      { kind: 'rare-earths', at: sites.find((s) => s.id === 'russia-vostok')!.at, name: 'Lake Vostok cores' },
      { kind: 'oil', at: sites.find((s) => s.id === 'usa-little-america')!.at, name: 'Ross shelf basin' },
      { kind: 'food', at: sites.find((s) => s.id === 'chile-capital')!.at, name: 'Magallanes fisheries' },
    ],
  });
}

import { BRIDGE, BUILDING, H, OPEN, ROAD, ROCK, RUBBLE, TREES, W, WALL, WATER, type BattleMap, type Biome, type Cell, type Point } from '@brink/arena/v2';
import type { Terrain } from '@brink/contracts';
import { clamp, fbm, lattice, stream } from './noise';

// Plausible battle maps for developing the renderer before the real generator lands: a ridge the
// defender holds, a river with bridges, villages along the main road, woods, hedges and fieldworks;
// in town, a street grid of panel blocks, shops and works. Dev preview only.

const KIND = { house: 0, apartment: 1, industrial: 2, shop: 3 } as const;
const WALLK = { hedge: 0, stone: 1, sandbag: 2, hesco: 3 } as const;
const TREEK = { broadleaf: 0, conifer: 1, birch: 2, scrub: 3 } as const;

export function sampleMap(biome: Biome, seed: number): BattleMap {
  const rnd = stream(seed ^ 0x5a3e);
  const t = lattice(seed ^ 0x11);
  const n = W * H;
  const cells: Cell[] = new Array<Cell>(n).fill(OPEN);
  const elev = new Array<number>(n).fill(0);
  const storeys = new Array<number>(n).fill(0);
  const hp = new Array<number>(n).fill(0);
  const variant = new Array<number>(n).fill(0);
  const crater = new Array<number>(n).fill(0);
  const at = (x: number, y: number) => y * W + x;
  const ok = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H;
  const urban = biome === 'urban';

  // Relief: the defender's ridge across the upper field with a saddle for the road, rolling hills.
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const ridge = 3.3 * Math.exp(-(((y - 15 + Math.sin(x * 0.35) * 1.5) / 4.5) ** 2)) * (0.75 + 0.25 * Math.sin(x * 0.27 + 1));
      const saddle = 1 - 0.45 * Math.exp(-(((x - 15) / 3) ** 2));
      const hills = (fbm(t, x * 0.12, y * 0.12, 3) - 0.45) * 2.6;
      const flat = urban ? 0.35 : biome === 'steppe' ? 0.7 : 1;
      elev[at(x, y)] = Math.round(clamp((ridge * saddle + Math.max(0, hills)) * flat, 0, 4));
    }

  const set = (x: number, y: number, c: Cell, v = 0) => {
    if (!ok(x, y)) return;
    cells[at(x, y)] = c;
    variant[at(x, y)] = v;
  };
  const line = (pts: Point[], paint: (x: number, y: number) => void) => {
    for (let k = 0; k < pts.length - 1; k++) {
      let x = pts[k]!.x;
      let y = pts[k]!.y;
      const b = pts[k + 1]!;
      paint(x, y);
      while (x !== b.x || y !== b.y) {
        // Four-connected steps, so roads and walls join edge to edge.
        if (Math.abs(b.x - x) * 1.0 > Math.abs(b.y - y) * 1.0) x += Math.sign(b.x - x);
        else y += Math.sign(b.y - y);
        paint(x, y);
      }
    }
  };

  // River.
  const river = biome !== 'desert';
  const riverY = (x: number) => Math.round(28 + Math.sin(x * 0.22 + seed) * 2.2 + Math.sin(x * 0.07) * 1.5);
  if (river) {
    for (let x = 0; x < W; x++) {
      const yc = riverY(x);
      for (const y of [yc, yc + 1]) set(x, y, WATER);
    }
    // Banks lie low.
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const d = Math.min(Math.abs(y - riverY(x)), Math.abs(y - riverY(x) - 1));
        if (d <= 3) elev[at(x, y)] = Math.min(elev[at(x, y)]!, d <= 1 ? 0 : 1);
      }
  }

  // Roads: the main road north through the saddle, a lateral at the ridge foot, a farm track.
  const roads: Point[][] = urban
    ? []
    : [
        [
          { x: 15, y: 44 },
          { x: 14, y: 36 },
          { x: 15, y: 26 },
          { x: 15, y: 20 },
          { x: 16, y: 12 },
          { x: 15, y: 0 },
        ],
        [
          { x: 0, y: 21 },
          { x: 15, y: 20 },
          { x: 29, y: 22 },
        ],
        [
          { x: 15, y: 38 },
          { x: 6, y: 35 },
          { x: 6, y: 24 },
          { x: 7, y: 16 },
        ],
      ];
  if (urban) {
    for (const y of [3, 9, 15, 21, 33, 39]) roads.push([
      { x: 0, y },
      { x: 29, y },
    ]);
    for (const x of [3, 10, 17, 24]) roads.push([
      { x, y: 0 },
      { x, y: 44 },
    ]);
  }
  for (const r of roads) line(r, (x, y) => set(x, y, cells[at(x, y)] === WATER ? BRIDGE : ROAD));
  // Bridges need roads to run onto: in town only the avenues that cross the river keep their bridges.
  for (let i = 0; i < n; i++) if (cells[i] === BRIDGE) elev[i] = 0;

  const building = (x: number, y: number, kind: number, s: number, look: number) => {
    if (!ok(x, y) || cells[at(x, y)] !== OPEN) return;
    set(x, y, BUILDING, kind | (look << 2));
    storeys[at(x, y)] = s;
    hp[at(x, y)] = 40 * s;
  };
  const blob = (cx: number, cy: number, r: number, c: Cell, v: number, keep = 0.85) => {
    for (let y = Math.floor(cy - r); y <= cy + r; y++)
      for (let x = Math.floor(cx - r); x <= cx + r; x++) {
        if (!ok(x, y) || cells[at(x, y)] !== OPEN) continue;
        if (Math.hypot(x - cx, y - cy) > r + (rnd() - 0.5)) continue;
        if (rnd() > keep) continue;
        set(x, y, c, v);
        if (c === TREES) hp[at(x, y)] = 2;
      }
  };

  if (!urban) {
    // The objective village on the ridge, along the main road.
    const houseLook = () => Math.floor(rnd() * 60);
    for (let y = 6; y <= 15; y++) {
      if (rnd() < 0.75) building(13 + (rnd() < 0.3 ? -1 : 0), y, KIND.house, 1 + (rnd() < 0.3 ? 1 : 0), houseLook());
      if (rnd() < 0.75) building(18 + (rnd() < 0.3 ? 1 : 0), y, KIND.house, 1 + (rnd() < 0.3 ? 1 : 0), houseLook());
    }
    building(17, 11, KIND.shop, 2, 3);
    building(17, 10, KIND.shop, 1, 3);
    // A small block of flats and a works yard.
    const flatsLook = Math.floor(rnd() * 60);
    for (const x of [19, 20, 21, 22]) building(x, 8, KIND.apartment, biome === 'desert' ? 3 : 4, flatsLook);
    const worksLook = Math.floor(rnd() * 60);
    for (const [x, y] of [
      [20, 13],
      [21, 13],
      [22, 13],
      [20, 14],
      [21, 14],
      [22, 14],
    ] as const)
      building(x, y, KIND.industrial, 1, worksLook);
    // A hamlet on the attackers' side.
    for (let y = 35; y <= 40; y++) if (rnd() < 0.6) building(rnd() < 0.5 ? 12 : 16, y, KIND.house, 1, houseLook());
    // Shelled houses.
    for (const [x, y] of [
      [13, 9],
      [18, 13],
    ] as const)
      if (cells[at(x, y)] === BUILDING) {
        cells[at(x, y)] = RUBBLE;
        hp[at(x, y)] = 0;
      }
    // Woods and tree lines.
    const wood = biome === 'desert' ? TREEK.scrub : biome === 'winter' ? TREEK.conifer : TREEK.broadleaf;
    blob(5, 10, 3.2, TREES, wood);
    blob(25, 17, 2.8, TREES, biome === 'desert' ? TREEK.scrub : TREEK.birch);
    blob(24, 36, 2.4, TREES, wood);
    blob(4, 40, 1.8, TREES, biome === 'desert' ? TREEK.scrub : TREEK.conifer);
    if (biome !== 'desert') for (let x = 1; x < 13; x++) if (rnd() < 0.8) set(x, 22, TREES, TREEK.broadleaf);
    // Hedges between the fields, fieldworks on the ridge.
    if (biome === 'temperate' || biome === 'winter') {
      line(
        [
          { x: 18, y: 33 },
          { x: 27, y: 33 },
          { x: 27, y: 40 },
        ],
        (x, y) => cells[at(x, y)] === OPEN && set(x, y, WALL, WALLK.hedge),
      );
      line(
        [
          { x: 2, y: 30 },
          { x: 9, y: 30 },
        ],
        (x, y) => cells[at(x, y)] === OPEN && set(x, y, WALL, WALLK.hedge),
      );
    } else {
      line(
        [
          { x: 19, y: 32 },
          { x: 27, y: 32 },
        ],
        (x, y) => cells[at(x, y)] === OPEN && set(x, y, WALL, WALLK.stone),
      );
    }
    line(
      [
        { x: 8, y: 17 },
        { x: 12, y: 17 },
      ],
      (x, y) => cells[at(x, y)] === OPEN && set(x, y, WALL, WALLK.sandbag),
    );
    line(
      [
        { x: 19, y: 17 },
        { x: 23, y: 17 },
        { x: 23, y: 19 },
      ],
      (x, y) => cells[at(x, y)] === OPEN && set(x, y, WALL, WALLK.hesco),
    );
    // Outcrops on the ridge.
    const rocks = biome === 'desert' ? 14 : 5;
    for (let k = 0; k < rocks; k++) {
      const x = Math.floor(rnd() * W);
      const y = 12 + Math.floor(rnd() * 10);
      if (cells[at(x, y)] === OPEN && elev[at(x, y)]! >= 2) set(x, y, ROCK);
    }
  } else {
    // Town: blocks of panel flats round courtyards, shops on the avenue, works by the river.
    const blocks: [number, number, number, number][] = [];
    const xs = [0, 4, 11, 18, 25];
    const xe = [2, 9, 16, 23, 29];
    const ys = [0, 4, 10, 16, 22, 34, 40];
    const ye = [2, 8, 14, 20, 24, 38, 44];
    for (let a = 0; a < xs.length; a++) for (let b = 0; b < ys.length; b++) blocks.push([xs[a]!, ys[b]!, xe[a]!, ye[b]!]);
    for (const [x0, y0, x1, y1] of blocks) {
      const look = Math.floor(rnd() * 60);
      const r = rnd();
      if (y0 >= 34 && x0 <= 4) {
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (rnd() < 0.85) building(x, y, KIND.industrial, 1 + (rnd() < 0.3 ? 1 : 0), look);
        continue;
      }
      if (r < 0.15) {
        blob((x0 + x1) / 2, (y0 + y1) / 2, 2.2, TREES, TREEK.broadleaf, 0.7);
        continue;
      }
      // Perimeter rows of flats, courtyard in the middle.
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const edge = y === y0 || y === y1 || ((x === x0 || x === x1) && rnd() < 0.5);
          if (!edge) {
            if (rnd() < 0.12) blob(x, y, 0.4, TREES, TREEK.broadleaf);
            continue;
          }
          const shop = (x === x0 && x0 === 11) || (x === x1 && x1 === 16);
          if (shop) building(x, y, KIND.shop, 1 + (rnd() < 0.5 ? 1 : 0), look);
          else building(x, y, KIND.apartment, 3 + (rnd() < 0.6 ? 1 : 0), look);
        }
    }
    // Shell damage.
    for (let k = 0; k < 10; k++) {
      const i = Math.floor(rnd() * n);
      if (cells[i] === BUILDING) {
        cells[i] = RUBBLE;
        hp[i] = 0;
      }
    }
    // Barricades.
    line(
      [
        { x: 11, y: 21 },
        { x: 16, y: 21 },
      ],
      (x, y) => cells[at(x, y)] === ROAD && set(x, y, WALL, WALLK.sandbag),
    );
  }

  // Old craters on open ground.
  for (let k = 0; k < 14; k++) {
    const x = Math.floor(rnd() * W);
    const y = 8 + Math.floor(rnd() * 32);
    if (cells[at(x, y)] === OPEN) crater[at(x, y)] = 1;
  }
  for (let i = 0; i < n; i++) if (cells[i] === WALL) hp[i] = 1;

  const terrain: Terrain = urban ? 'urban' : biome === 'desert' || biome === 'winter' ? 'hills' : 'plains';
  const blueSpawn: Point[] = [];
  const redSpawn: Point[] = [];
  for (let y = 40; y < H; y++) for (let x = 8; x < 22; x++) if (cells[at(x, y)] === OPEN) blueSpawn.push({ x, y });
  for (let y = 4; y < 16; y++) for (let x = 6; x < 24; x++) if (cells[at(x, y)] === OPEN) redSpawn.push({ x, y });
  return {
    w: W,
    h: H,
    biome,
    terrain,
    cells,
    elev,
    storeys,
    hp,
    variant,
    crater,
    mode: 'capture',
    zone: urban ? { x: 14, y: 12, r: 3.5 } : { x: 15, y: 10, r: 3.5 },
    blueSpawn,
    redSpawn,
  };
}

/** Knock down the buildings round a point and shell the ground (the after picture). */
export function shell(map: BattleMap, cx: number, cy: number, r: number, seed: number): { changed: Point[]; craters: Point[] } {
  const rnd = stream(seed ^ 0xbadf00d);
  const changed: Point[] = [];
  const craters: Point[] = [];
  for (let y = cy - r; y <= cy + r; y++)
    for (let x = cx - r; x <= cx + r; x++) {
      if (x < 0 || y < 0 || x >= map.w || y >= map.h) continue;
      const i = y * map.w + x;
      const c = map.cells[i];
      if (c === BUILDING && rnd() < 0.7) {
        map.cells[i] = RUBBLE;
        map.hp[i] = 0;
        changed.push({ x, y });
      } else if (c === TREES && rnd() < 0.6) {
        map.cells[i] = OPEN;
        map.hp[i] = 0;
        changed.push({ x, y });
      } else if (c === WALL && rnd() < 0.6) {
        map.cells[i] = OPEN;
        changed.push({ x, y });
      } else if ((c === OPEN || c === ROAD) && rnd() < 0.25) {
        map.crater[i] = 1;
        craters.push({ x, y });
      }
    }
  return { changed, craters };
}

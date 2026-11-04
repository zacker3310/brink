import type { FacilityId, HexKey, NationView, SiteView, Terrain } from '@brink/contracts';
import { hexCorners, hexToPixel, keyOf, neighborKeys, parseKey, pixelToHex, type Point } from '@brink/map';

// The painted theatre: a hand-painted fantasy-map look (think a MOBA or an MMO world map) drawn
// procedurally into one canvas, then baked into a single texture. No blur filters (Safari's 2D
// canvas lacks them): soft edges come from stamped radial blobs, and every stroke is seeded per
// hex so the land is the same every time it is drawn.

export interface Painted {
  canvas: HTMLCanvasElement;
  /** World position of the canvas's top-left corner. */
  x: number;
  y: number;
  /** World units per canvas pixel. */
  unit: number;
}

type Rgb = [number, number, number];

const P = {
  plains: { base: [104, 150, 58], light: [150, 196, 82], dark: [72, 118, 44], tuft: [176, 210, 98] },
  forest: { base: [58, 102, 50], light: [96, 150, 64], dark: [34, 70, 36], tuft: [120, 170, 72] },
  hills: { base: [140, 146, 74], light: [190, 182, 106], dark: [104, 104, 56], tuft: [206, 196, 120] },
  mountains: { base: [118, 120, 128], light: [176, 180, 190], dark: [74, 78, 88], tuft: [210, 214, 222] },
  urban: { base: [150, 140, 116], light: [190, 180, 152], dark: [110, 100, 80], tuft: [206, 196, 170] },
  water: { base: [30, 98, 126], light: [72, 160, 180], dark: [18, 64, 92], tuft: [120, 200, 206] },
} satisfies Record<Terrain, Record<string, Rgb>>;

const CANOPY: Rgb[] = [
  [44, 96, 44],
  [56, 114, 50],
  [70, 128, 56],
  [38, 86, 52],
];

const rgba = (c: Rgb, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function rng(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  let s = h >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Painting order: what lies under what where two kinds of ground meet. */
const LAYER: Terrain[] = ['water', 'plains', 'urban', 'hills', 'forest', 'mountains'];

/** Something standing on the land, drawn back to front. With `x`, it is left out where that spot is sea. */
type Prop = { x?: number; y: number; draw: (g: CanvasRenderingContext2D) => void };

/** The open sea beyond the painted canvas: the canvas fades to exactly this at its edges. */
export const SEA = 0x0a2433;
const SEA_CSS = '#0a2433';

/** Height of each kind of ground, for the hillshade: light from the north-west across the land. */
const ELEV: Record<Terrain, number> = { water: -1, plains: 0, urban: 0.1, forest: 0.4, hills: 1.3, mountains: 2.8 };

/**
 * The coastline: every edge between a land hex and anything that is not land, chained into closed
 * loops (land on the same side of each), then roughened and smoothed so the shore wanders like a
 * real one instead of following the hex grid. It strays a few pixels either way: a hex's ground is
 * still plainly its own.
 */
function coastPath(land: Set<HexKey>, centre: (k: HexKey) => Point, size: number): Path2D {
  const pk = (p: Point) => `${Math.round(p.x * 50)},${Math.round(p.y * 50)}`;
  const out = new Map<string, [Point, Point][]>();
  for (const key of [...land].sort()) {
    const p = centre(key);
    const cs = hexCorners(p, size);
    for (let i = 0; i < 6; i++) {
      const a = cs[i]!;
      const b = cs[(i + 1) % 6]!;
      // The neighbour across this edge: the centre mirrored through the edge's midpoint.
      const across = keyOf(pixelToHex({ x: a.x + b.x - p.x, y: a.y + b.y - p.y }, size));
      if (land.has(across)) continue;
      const list = out.get(pk(a)) ?? [];
      list.push([a, b]);
      out.set(pk(a), list);
    }
  }
  const path = new Path2D();
  for (const start of [...out.keys()].sort()) {
    for (;;) {
      const first = out.get(start)?.pop();
      if (!first) break;
      const loop: Point[] = [first[0]];
      let cur = first;
      for (let guard = 0; guard < 100000; guard++) {
        const next = out.get(pk(cur[1]))?.pop();
        if (!next) break;
        loop.push(next[0]);
        cur = next;
      }
      const smooth = chaikin(chaikin(roughen(loop, size)));
      path.moveTo(smooth[0]!.x, smooth[0]!.y);
      for (const q of smooth.slice(1)) path.lineTo(q.x, q.y);
      path.closePath();
    }
  }
  return path;
}

/** Three points along every edge, pushed in or out by a seeded amount, fixed at the corners. */
function roughen(loop: Point[], size: number): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i]!;
    const b = loop[(i + 1) % loop.length]!;
    const r = rng(`coast${Math.round(a.x + b.x)},${Math.round(a.y + b.y)}`);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    out.push(a);
    for (const t of [0.25, 0.5, 0.75]) {
      const d = (r() * 2 - 1) * size * 0.24 * Math.sin(Math.PI * t);
      out.push({ x: a.x + dx * t + nx * d, y: a.y + dy * t + ny * d });
    }
  }
  return out;
}

/** One round of corner cutting on a closed loop. */
function chaikin(loop: Point[]): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i]!;
    const b = loop[(i + 1) % loop.length]!;
    out.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 }, { x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
  }
  return out;
}

/** A tile of fine grain, like the tooth of paper: laid over the whole map so it reads as printed. */
let grain: HTMLCanvasElement | null = null;
function grainTile(): HTMLCanvasElement {
  if (grain) return grain;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const img = g.createImageData(128, 128);
  const r = rng('grain');
  for (let i = 0; i < 128 * 128; i++) {
    // Fibres run mostly one way: a little horizontal correlation.
    const prev = i % 128 ? img.data[(i - 1) * 4]! : 128;
    const v = Math.round(prev * 0.45 + (96 + r() * 64) * 0.55);
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  grain = c;
  return c;
}

export interface PaintOptions {
  /** Lay the grain of paper over the map, like a printed campaign map on a table. */
  paper?: boolean;
}

export function paintTheatre(v: NationView, keys: HexKey[], size: number, opts: PaintOptions = {}): Painted {
  const known = keys.filter((k) => v.tiles[k]!.terrain && v.tiles[k]!.visibility !== 'unknown');
  const centers = new Map<HexKey, Point>(keys.map((k) => [k, hexToPixel(parseKey(k), size)]));
  const xs = keys.map((k) => centers.get(k)!.x);
  const ys = keys.map((k) => centers.get(k)!.y);
  // The theatre is a continent: open sea all round it, wide enough to pan over.
  const pad = size * 7;
  const x0 = Math.min(...xs) - pad;
  const y0 = Math.min(...ys) - pad;
  const w = Math.max(...xs) + pad - x0;
  const h = Math.max(...ys) + pad - y0;
  // Pixels per world unit: as sharp as a 4096 texture allows (every phone GPU takes one), and no
  // more than 8 megapixels in all, well inside what iOS lets a canvas use.
  const k = Math.min(3, 4096 / Math.max(w, h), Math.sqrt(8_000_000 / (w * h)));
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(w * k);
  canvas.height = Math.ceil(h * k);
  const main = canvas.getContext('2d')!;
  let g = main;
  g.setTransform(k, 0, 0, k, -x0 * k, -y0 * k);

  const terrain = (key: HexKey): Terrain | null => (v.tiles[key]?.visibility !== 'unknown' ? (v.tiles[key]?.terrain ?? null) : null);
  const c = (key: HexKey) => centers.get(key) ?? hexToPixel(parseKey(key), size);
  const hexPath = (key: HexKey, grow = 0) => {
    const pts = hexCorners(c(key), size + grow);
    g.beginPath();
    g.moveTo(pts[0]!.x, pts[0]!.y);
    for (const p of pts.slice(1)) g.lineTo(p.x, p.y);
    g.closePath();
  };
  const blob = (x: number, y: number, r: number, col: string, a: number) => {
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, col.replace('A', String(a)));
    grad.addColorStop(1, col.replace('A', '0'));
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  };
  // Beyond the theatre's edge the land runs on a few hexes, fading into the dark, so the map ends
  // in shadow rather than in a straight, ruled coastline.
  const beyond = new Map<HexKey, { t: Terrain; ring: number }>();
  {
    let frontier = known.filter((key) => terrain(key) !== 'water');
    for (let ring = 1; ring <= 3; ring++) {
      const next: HexKey[] = [];
      for (const key of frontier) {
        const t = terrain(key) ?? beyond.get(key)?.t ?? 'plains';
        for (const n of neighborKeys(key)) {
          if (v.tiles[n] || beyond.has(n)) continue;
          beyond.set(n, { t: t === 'urban' ? 'plains' : t, ring });
          next.push(n);
        }
      }
      frontier = next.sort();
    }
  }
  const ground = (key: HexKey): Terrain | null => terrain(key) ?? beyond.get(key)?.t ?? null;
  const landKeys = [...known.filter((key) => terrain(key) !== 'water'), ...[...beyond.keys()].sort()];
  const land = new Set(landKeys);
  const coast = coastPath(land, c, size);

  // 1. The sea: deep at the margins, fading to exactly the open sea beyond the canvas.
  const sea = g.createRadialGradient(x0 + w / 2, y0 + h / 2, Math.min(w, h) * 0.2, x0 + w / 2, y0 + h / 2, Math.max(w, h) * 0.62);
  sea.addColorStop(0, '#1a5f7a');
  sea.addColorStop(0.55, '#134a62');
  sea.addColorStop(1, SEA_CSS);
  g.fillStyle = sea;
  g.fillRect(x0, y0, w, h);
  // Depth: how far each stretch of open water lies from any land. The deep ocean darkens.
  {
    const dist = new Map<HexKey, number>();
    let frontier = known.filter((key) => land.has(key));
    for (const key of frontier) dist.set(key, 0);
    for (let d = 1; frontier.length && d < 8; d++) {
      const next: HexKey[] = [];
      for (const key of frontier) {
        for (const n of neighborKeys(key)) {
          if (dist.has(n) || !v.tiles[n]) continue;
          dist.set(n, d);
          next.push(n);
        }
      }
      frontier = next;
    }
    for (const key of keys) {
      if (land.has(key)) continue;
      const d = dist.get(key) ?? 8;
      if (d < 3) continue;
      const p = c(key);
      blob(p.x, p.y, size * 1.6, 'rgba(6,26,40,A)', Math.min(0.5, (d - 2) * 0.12));
    }
    // Light on the swell: broad patches of lighter and darker water.
    const r = rng('swell');
    for (let i = 0; i < 40; i++) {
      const x = x0 + r() * w;
      const y = y0 + r() * h;
      blob(x, y, size * (2 + r() * 4), r() < 0.5 ? 'rgba(80,170,190,A)' : 'rgba(4,20,32,A)', 0.1);
    }
    g.strokeStyle = 'rgba(150,215,225,0.13)';
    g.lineWidth = 0.8;
    for (let i = 0; i < 600; i++) {
      const x = x0 + r() * w;
      const y = y0 + r() * h;
      g.beginPath();
      g.moveTo(x - 4, y);
      g.quadraticCurveTo(x, y - 2, x + 4, y);
      g.stroke();
    }
  }
  // Shallows: bands of lighter water stepping out from the shore, then a ring of surf.
  g.lineJoin = 'round';
  g.lineCap = 'round';
  // Many thin steps of little contrast each, so the shelf reads as a gradient, not contour rings.
  const shelf: [number, string][] = [];
  for (let i = 0; i < 12; i++) {
    const u = i / 11;
    const rgb = mix([28, 98, 128], [86, 184, 190], u);
    shelf.push([80 - u * 66, rgba(rgb, 0.08 + u * 0.1)]);
  }
  for (const [width, col] of [...shelf, [10, 'rgba(232,246,240,0.5)'], [7.5, 'rgba(110,200,198,0.95)']] as const) {
    g.strokeStyle = col;
    g.lineWidth = width;
    g.stroke(coast);
  }

  // 2. The land, painted on a sheet of its own and then cut out along the coastline in one go:
  // clipping thousands of strokes to the coast one by one is many times slower.
  const sheet = document.createElement('canvas');
  sheet.width = canvas.width;
  sheet.height = canvas.height;
  g = sheet.getContext('2d')!;
  g.setTransform(k, 0, 0, k, -x0 * k, -y0 * k);
  g.lineJoin = 'round';
  g.lineCap = 'round';
  // Under everything, a neutral ground, so where the shore bulges past a hex edge there is land.
  g.fillStyle = rgba(mix(P.plains.base, P.hills.base, 0.4));
  g.fill(coast, 'evenodd');
  // Base colour per hex, slightly grown so no seam shows, then soft blobs so kinds of ground blend.
  for (const t of LAYER) {
    if (t === 'water') continue;
    for (const key of landKeys) {
      if (ground(key) !== t) continue;
      hexPath(key, 1.5);
      g.fillStyle = rgba(P[t].base);
      g.fill();
    }
  }
  // Each hex's colour spills softly past its edges, so neighbours blend instead of tiling.
  for (const t of LAYER) {
    if (t === 'water') continue;
    for (const key of landKeys) {
      if (ground(key) !== t) continue;
      const p = c(key);
      const grad = g.createRadialGradient(p.x, p.y, size * 0.55, p.x, p.y, size * 1.3);
      grad.addColorStop(0, rgba(P[t].base, 0.9));
      grad.addColorStop(1, rgba(P[t].base, 0));
      g.fillStyle = grad;
      g.beginPath();
      g.arc(p.x, p.y, size * 1.3, 0, Math.PI * 2);
      g.fill();
    }
  }
  for (const t of LAYER) {
    if (t === 'water') continue;
    for (const key of landKeys) {
      if (ground(key) !== t) continue;
      const r = rng(`blob${key}`);
      const p = c(key);
      for (let i = 0; i < 9; i++) {
        const a = r() * Math.PI * 2;
        const d = r() * size * 0.75;
        const bx = p.x + Math.cos(a) * d;
        const by = p.y + Math.sin(a) * d;
        const br = size * (0.45 + r() * 0.45);
        const col = mix(P[t].dark, P[t].light, 0.25 + r() * 0.5);
        const grad = g.createRadialGradient(bx, by, 0, bx, by, br);
        grad.addColorStop(0, rgba(col, 0.7));
        grad.addColorStop(1, rgba(col, 0));
        g.fillStyle = grad;
        g.beginPath();
        g.arc(bx, by, br, 0, Math.PI * 2);
        g.fill();
      }
    }
  }
  // Lowland near the sea runs paler and drier toward the beach.
  g.strokeStyle = 'rgba(206,196,128,0.22)';
  g.lineWidth = 16;
  g.stroke(coast);

  // Light and shade at the scale of the land: sunlit downs and cloud-dark valleys across many hexes.
  {
    const r = rng('relief');
    for (let i = 0; i < 46; i++) {
      const x = x0 + pad + r() * (w - pad * 2);
      const y = y0 + pad + r() * (h - pad * 2);
      const rad = size * (2 + r() * 3);
      const lit = r() < 0.5;
      const grad = g.createRadialGradient(x, y, 0, x, y, rad);
      grad.addColorStop(0, lit ? 'rgba(255,240,180,0.13)' : 'rgba(8,28,24,0.16)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(x, y, rad, 0, Math.PI * 2);
      g.fill();
    }
  }
  // Hillshade: every hex lit by how its ground slopes toward the light in the north-west, so
  // ranges stand up off the map with a bright face and a shadowed one.
  {
    const lx = -0.62;
    const ly = -0.78;
    for (const key of landKeys) {
      const t = ground(key)!;
      const e = ELEV[t];
      const p = c(key);
      let gx = 0;
      let gy = 0;
      for (const n of neighborKeys(key)) {
        const tn = ground(n);
        const en = tn ? ELEV[tn] : -1;
        const q = c(n);
        gx += ((en - e) * (q.x - p.x)) / size;
        gy += ((en - e) * (q.y - p.y)) / size;
      }
      // Rising toward the light: a face turned away from it, in shadow.
      const lit = -(gx * lx + gy * ly);
      if (lit > 0.05) blob(p.x + lx * size * 0.3, p.y + ly * size * 0.3, size * 1.15, 'rgba(255,238,190,A)', Math.min(0.26, lit * 0.05));
      else if (lit < -0.05) blob(p.x - lx * size * 0.3, p.y - ly * size * 0.3, size * 1.15, 'rgba(14,26,30,A)', Math.min(0.34, -lit * 0.065));
      // High ground also carries its own relief: a lit shoulder and a dark flank inside the hex.
      if (t === 'mountains' || t === 'hills') {
        const s = t === 'mountains' ? 1 : 0.6;
        blob(p.x + lx * size * 0.35, p.y + ly * size * 0.35, size * 0.75, 'rgba(255,246,220,A)', 0.22 * s);
        blob(p.x - lx * size * 0.4, p.y - ly * size * 0.4, size * 0.8, 'rgba(18,22,34,A)', 0.3 * s);
      }
    }
  }

  // 3. Brushwork: grass tufts, rock flecks, cobbles.
  for (const key of known) {
    const t = terrain(key)!;
    if (t === 'water') continue;
    const r = rng(`dab${key}`);
    const p = c(key);
    for (let i = 0; i < 34; i++) {
      const a = r() * Math.PI * 2;
      const d = Math.sqrt(r()) * size * 0.95;
      const x = p.x + Math.cos(a) * d;
      const y = p.y + Math.sin(a) * d;
      if (t === 'mountains') {
        g.fillStyle = rgba(r() < 0.5 ? P.mountains.dark : P.mountains.light, 0.35);
        g.fillRect(x, y, 1.6, 1.1);
      } else if (t === 'urban') {
        g.fillStyle = rgba(r() < 0.5 ? P.urban.dark : P.urban.light, 0.4);
        g.fillRect(x - 1.2, y - 0.8, 2.4, 1.6);
      } else {
        const col = r() < 0.6 ? P[t].tuft : P[t].dark;
        g.strokeStyle = rgba(col, 0.55);
        g.lineWidth = 0.6;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x - 1 + r() * 0.6, y - 2.4 - r());
        g.moveTo(x, y);
        g.lineTo(x + 1 + r() * 0.6, y - 2.2 - r());
        g.stroke();
      }
    }
  }

  // 5. Roads on developed ground, then rivers over them (with fords where they cross).
  for (const key of known) {
    const t = v.tiles[key]!;
    if (t.infrastructure < 2 || t.terrain === 'water') continue;
    for (const n of neighborKeys(key)) {
      const u = v.tiles[n];
      if (!u || n < key || u.infrastructure < 2 || !terrain(n) || u.terrain === 'water') continue;
      const a = c(key);
      const b = c(n);
      const r = rng(`road${key}${n}`);
      const mx = (a.x + b.x) / 2 + (r() - 0.5) * 8;
      const my = (a.y + b.y) / 2 + (r() - 0.5) * 8;
      for (const [width, col] of [
        [4.2, 'rgba(92,72,44,0.55)'],
        [2.6, 'rgba(196,168,116,0.9)'],
      ] as const) {
        g.strokeStyle = col;
        g.lineWidth = width;
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(a.x, a.y);
        g.quadraticCurveTo(mx, my, b.x, b.y);
        g.stroke();
      }
    }
  }
  for (const key of known) {
    if (!v.tiles[key]!.river) continue;
    for (const n of neighborKeys(key)) {
      if (n < key || !v.tiles[n]?.river || !terrain(n)) continue;
      const a = c(key);
      const b = c(n);
      const r = rng(`river${key}${n}`);
      const mx = (a.x + b.x) / 2 + (r() - 0.5) * 12;
      const my = (a.y + b.y) / 2 + (r() - 0.5) * 12;
      for (const [width, col] of [
        [9, 'rgba(70,92,48,0.6)'],
        [6.5, 'rgba(24,82,108,1)'],
        [4, 'rgba(48,132,160,1)'],
        [1.2, 'rgba(180,232,236,0.55)'],
      ] as const) {
        g.strokeStyle = col;
        g.lineWidth = width;
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(a.x, a.y);
        g.quadraticCurveTo(mx, my, b.x, b.y);
        g.stroke();
      }
    }
  }

  g.globalCompositeOperation = 'destination-in';
  g.globalAlpha = 1;
  g.fillStyle = '#000';
  g.fill(coast, 'evenodd');
  g = main;
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.drawImage(sheet, 0, 0);
  g.restore();
  // Let the sheet go at once: on a phone canvas memory is scarce.
  sheet.width = sheet.height = 0;

  // A beach of pale sand all along the shore.
  g.strokeStyle = 'rgba(226,208,150,0.9)';
  g.lineWidth = 2.6;
  g.stroke(coast);
  g.strokeStyle = 'rgba(120,100,60,0.35)';
  g.lineWidth = 0.7;
  g.stroke(coast);

  // 6. Props, painted back to front so nearer ones overlap: trees, peaks, hills, towns, castles.
  // They keep to the rim of the hex; the middle is a clearing where the army counter stands.
  const props: Prop[] = [];
  for (const key of known) {
    const t = v.tiles[key]!;
    const p = c(key);
    const r = rng(`prop${key}`);
    const site = t.siteId ? v.sites[t.siteId] : undefined;
    if (site) {
      // A port's quays face the nearest open water.
      const sea = t.port ? neighborKeys(key).find((n) => terrain(n) === 'water' || (!v.tiles[n] && !beyond.has(n))) : undefined;
      const seaward = sea ? Math.atan2(c(sea).y - p.y, c(sea).x - p.x) : null;
      props.push(...siteProps(site, p, size, r, seaward));
      continue;
    }
    if (t.terrain === 'forest') {
      for (let i = 0; i < 11; i++) {
        const a = r() * Math.PI * 2;
        const d = size * (0.42 + r() * 0.5);
        const x = p.x + Math.cos(a) * d;
        const y = p.y + Math.sin(a) * d * 0.9;
        const s = 3.4 + r() * 2.6;
        const col = CANOPY[Math.floor(r() * CANOPY.length)]!;
        props.push({ x, y, draw: (gg) => tree(gg, x, y, s, col) });
      }
    } else if (t.terrain === 'plains' && r() < 0.5) {
      // A copse here and there, so the farmland is not a lawn.
      const a = r() * Math.PI * 2;
      const x = p.x + Math.cos(a) * size * 0.65;
      const y = p.y + Math.sin(a) * size * 0.6;
      for (let i = 0; i < 3; i++) {
        const tx = x + (r() - 0.5) * 8;
        const ty = y + (r() - 0.5) * 5;
        const s = 2.6 + r() * 1.6;
        const col = CANOPY[Math.floor(r() * CANOPY.length)]!;
        props.push({ x: tx, y: ty, draw: (gg) => tree(gg, tx, ty, s, col) });
      }
    } else if (t.terrain === 'hills') {
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + r();
        const x = p.x + Math.cos(a) * size * 0.55;
        const y = p.y + Math.sin(a) * size * 0.5;
        const s = 7 + r() * 4;
        props.push({ x, y, draw: (gg) => hill(gg, x, y, s) });
      }
    } else if (t.terrain === 'mountains') {
      const peaks = [
        [-0.45, -0.25, 1.15],
        [0.4, -0.3, 0.95],
        [-0.05, 0.42, 0.85],
        [0.55, 0.4, 0.7],
      ] as const;
      for (const [dx, dy, s] of peaks) {
        const x = p.x + dx * size + (r() - 0.5) * 4;
        const y = p.y + dy * size + (r() - 0.5) * 3;
        const hgt = size * 0.55 * s;
        props.push({ x, y, draw: (gg) => peak(gg, x, y, hgt, r() < 0.5) });
      }
    } else if (t.terrain === 'urban') {
      for (let i = 0; i < 7; i++) {
        const a = r() * Math.PI * 2;
        const d = size * (0.45 + r() * 0.4);
        const x = p.x + Math.cos(a) * d;
        const y = p.y + Math.sin(a) * d * 0.85;
        const roof = r() < 0.6 ? '#b45a3c' : '#4f6078';
        props.push({ x, y, draw: (gg) => house(gg, x, y, 3 + r() * 1.5, roof) });
      }
    }
  }

  // Only what stands on land: the shore wanders, and a tree must not stand in the surf.
  // Asking the path itself point by point is far too slow for thousands of props: read a small
  // mask of the land instead (one pixel per two world units).
  const mw = Math.ceil(w / 2);
  const mh = Math.ceil(h / 2);
  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = mw;
  maskCanvas.height = mh;
  const mg = maskCanvas.getContext('2d', { willReadFrequently: true })!;
  mg.setTransform(0.5, 0, 0, 0.5, -x0 * 0.5, -y0 * 0.5);
  mg.fillStyle = '#fff';
  mg.fill(coast, 'evenodd');
  const mask = mg.getImageData(0, 0, mw, mh).data;
  const ashore = (x: number, y: number) => {
    const mx = Math.floor((x - x0) / 2);
    const my = Math.floor((y - y0) / 2);
    return mx >= 0 && my >= 0 && mx < mw && my < mh && mask[(my * mw + mx) * 4 + 3]! > 127;
  };
  const standing = props.filter((pr) => pr.x === undefined || ashore(pr.x, pr.y));
  standing.sort((a, b) => a.y - b.y);
  for (const pr of standing) pr.draw(g);

  // Beyond the theatre, the land sinks into shadow ring by ring.
  for (const [key, b] of [...beyond].sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
    const p = c(key);
    blob(p.x, p.y, size * 1.5, 'rgba(10,36,51,A)', [0.4, 0.62, 0.85][b.ring - 1]!);
  }

  // 7. Light: warm from the top left, cool toward the bottom right.
  const light = g.createLinearGradient(x0, y0, x0 + w, y0 + h);
  light.addColorStop(0, 'rgba(255,236,190,0.10)');
  light.addColorStop(0.5, 'rgba(255,236,190,0)');
  light.addColorStop(1, 'rgba(10,20,40,0.16)');
  g.fillStyle = light;
  g.fillRect(x0, y0, w, h);
  // Land nobody has seen yet: dark ground under soft-edged cloud (the fog banks drift over it).
  for (const key of keys) {
    if (terrain(key)) continue;
    hexPath(key, 0.5);
    g.fillStyle = '#18232b';
    g.fill();
  }
  for (const key of keys) {
    if (terrain(key)) continue;
    const p = c(key);
    blob(p.x, p.y, size * 1.5, 'rgba(24,35,43,A)', 0.85);
  }
  // Paper: warm inks on parchment (before the margins, which still fade to the open sea).
  if (opts.paper) {
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = 'rgba(236,214,168,0.55)';
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.globalCompositeOperation = 'saturation';
    g.fillStyle = 'rgba(128,128,128,0.28)';
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.restore();
  }
  // A vignette, then the margins fade into the open sea, so the canvas has no visible edge.
  const cx = x0 + w / 2;
  const cy = y0 + h / 2;
  const vig = g.createRadialGradient(cx, cy, Math.min(w, h) * 0.35, cx, cy, Math.max(w, h) * 0.72);
  vig.addColorStop(0, 'rgba(10,36,51,0)');
  vig.addColorStop(1, 'rgba(10,36,51,0.6)');
  g.fillStyle = vig;
  g.fillRect(x0, y0, w, h);
  const fade = pad * 0.85;
  for (const [ax, ay, bx, by, rx, ry, rw, rh] of [
    [x0, 0, x0 + fade, 0, x0, y0, fade, h],
    [x0 + w, 0, x0 + w - fade, 0, x0 + w - fade, y0, fade, h],
    [0, y0, 0, y0 + fade, x0, y0, w, fade],
    [0, y0 + h, 0, y0 + h - fade, x0, y0 + h - fade, w, fade],
  ] as const) {
    const edgeFade = g.createLinearGradient(ax, ay, bx, by);
    edgeFade.addColorStop(0, 'rgba(10,36,51,1)');
    edgeFade.addColorStop(1, 'rgba(10,36,51,0)');
    g.fillStyle = edgeFade;
    g.fillRect(rx, ry, rw, rh);
  }
  // The tooth of paper over everything, faint. The paper style goes further: the whole map
  // printed in warm inks on a sheet of parchment, laid on the table.
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'overlay';
  g.globalAlpha = opts.paper ? 0.55 : 0.22;
  g.fillStyle = g.createPattern(grainTile(), 'repeat')!;
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.restore();

  return { canvas, x: x0, y: y0, unit: 1 / k };
}

function shadow(g: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, a = 0.32) {
  g.fillStyle = `rgba(10,18,10,${a})`;
  g.beginPath();
  g.ellipse(x + rx * 0.35, y + ry * 0.4, rx, ry, 0, 0, Math.PI * 2);
  g.fill();
}

/** A round-canopied tree: shadow, trunk, three lobes lit from the top left. */
function tree(g: CanvasRenderingContext2D, x: number, y: number, s: number, col: Rgb) {
  shadow(g, x, y + s * 0.2, s * 1.1, s * 0.45);
  g.fillStyle = '#4a3220';
  g.fillRect(x - s * 0.12, y - s * 0.4, s * 0.24, s * 0.6);
  const lobes: [number, number, number][] = [
    [-0.45, -0.9, 0.62],
    [0.45, -0.95, 0.6],
    [0, -1.35, 0.7],
  ];
  for (const [dx, dy, r] of lobes) {
    const lx = x + dx * s;
    const ly = y + dy * s;
    const grad = g.createRadialGradient(lx - r * s * 0.35, ly - r * s * 0.4, 0, lx, ly, r * s);
    grad.addColorStop(0, rgba(mix(col, [190, 230, 120], 0.45)));
    grad.addColorStop(0.6, rgba(col));
    grad.addColorStop(1, rgba(mix(col, [10, 30, 16], 0.5)));
    g.fillStyle = grad;
    g.beginPath();
    g.arc(lx, ly, r * s, 0, Math.PI * 2);
    g.fill();
  }
}

function hill(g: CanvasRenderingContext2D, x: number, y: number, s: number) {
  shadow(g, x, y, s * 1.1, s * 0.35, 0.25);
  const grad = g.createRadialGradient(x - s * 0.4, y - s * 0.6, 0, x, y - s * 0.2, s * 1.2);
  grad.addColorStop(0, 'rgba(214,206,130,1)');
  grad.addColorStop(0.55, 'rgba(150,152,80,1)');
  grad.addColorStop(1, 'rgba(92,96,52,1)');
  g.fillStyle = grad;
  g.beginPath();
  g.moveTo(x - s, y);
  g.bezierCurveTo(x - s * 0.7, y - s * 0.9, x + s * 0.5, y - s * 1.0, x + s, y);
  g.closePath();
  g.fill();
  g.strokeStyle = 'rgba(70,72,36,0.45)';
  g.lineWidth = 0.6;
  g.stroke();
}

/** A rock peak: a lit face and a shaded face, snow on the taller ones. */
function peak(g: CanvasRenderingContext2D, x: number, y: number, hgt: number, snow: boolean) {
  const half = hgt * 0.75;
  shadow(g, x, y, half * 1.1, hgt * 0.18, 0.3);
  g.fillStyle = '#9a9ea8';
  g.beginPath();
  g.moveTo(x - half, y);
  g.lineTo(x - hgt * 0.08, y - hgt);
  g.lineTo(x + hgt * 0.1, y);
  g.closePath();
  g.fill();
  g.fillStyle = '#5a5e6a';
  g.beginPath();
  g.moveTo(x - hgt * 0.08, y - hgt);
  g.lineTo(x + half, y);
  g.lineTo(x + hgt * 0.1, y);
  g.closePath();
  g.fill();
  if (snow || hgt > 14) {
    g.fillStyle = '#f2f4f7';
    g.beginPath();
    g.moveTo(x - hgt * 0.08, y - hgt);
    g.lineTo(x - hgt * 0.3, y - hgt * 0.62);
    g.lineTo(x - hgt * 0.12, y - hgt * 0.7);
    g.lineTo(x + hgt * 0.02, y - hgt * 0.58);
    g.lineTo(x + hgt * 0.2, y - hgt * 0.66);
    g.closePath();
    g.fill();
  }
}

function house(g: CanvasRenderingContext2D, x: number, y: number, s: number, roof: string) {
  shadow(g, x, y, s * 1.2, s * 0.4, 0.3);
  g.fillStyle = '#d9cdb0';
  g.fillRect(x - s, y - s * 1.1, s * 2, s * 1.1);
  g.fillStyle = '#a89878';
  g.fillRect(x, y - s * 1.1, s, s * 1.1);
  g.fillStyle = roof;
  g.beginPath();
  g.moveTo(x - s * 1.2, y - s * 1.1);
  g.lineTo(x, y - s * 2);
  g.lineTo(x + s * 1.2, y - s * 1.1);
  g.closePath();
  g.fill();
  g.fillStyle = 'rgba(0,0,0,0.22)';
  g.beginPath();
  g.moveTo(x, y - s * 2);
  g.lineTo(x + s * 1.2, y - s * 1.1);
  g.lineTo(x, y - s * 1.1);
  g.closePath();
  g.fill();
}

function tower(g: CanvasRenderingContext2D, x: number, y: number, s: number, roof: string) {
  shadow(g, x, y, s * 0.9, s * 0.3, 0.32);
  const grad = g.createLinearGradient(x - s * 0.6, 0, x + s * 0.6, 0);
  grad.addColorStop(0, '#e2d8c0');
  grad.addColorStop(1, '#9c8e70');
  g.fillStyle = grad;
  g.fillRect(x - s * 0.55, y - s * 2.6, s * 1.1, s * 2.6);
  g.fillStyle = roof;
  g.beginPath();
  g.moveTo(x - s * 0.75, y - s * 2.6);
  g.lineTo(x, y - s * 3.8);
  g.lineTo(x + s * 0.75, y - s * 2.6);
  g.closePath();
  g.fill();
}

/** How big a place looks: one step per 300 thousand people, as on its banner. */
export function sizeClass(site: SiteView): number {
  return Math.max(1, Math.min(10, Math.round(site.population / 300)));
}

/**
 * Capitals are walled castles, cities walled towns, depots supply yards, objectives a landmark.
 * A town grows with its people (a wider wall, more towers, a spill of houses outside it) and shows
 * what has been built there: smoking chimneys, a cooling tower, fields, a pithead, a domed
 * laboratory, a star fort; a port has quays and boats on its seaward side.
 */
function siteProps(site: SiteView, p: Point, size: number, r: () => number, seaward: number | null): Prop[] {
  const out: Prop[] = [];
  const roof = '#b4503a';
  if (site.kind === 'capital' || site.kind === 'city') {
    const n = sizeClass(site);
    const capital = site.kind === 'capital';
    const ring = Math.min(0.84, 0.56 + n * 0.03 + (capital ? 0.06 : 0));
    const has = (f: FacilityId) => site.facilities.includes(f);
    const fort = has('fortress');
    // Facilities sit outside the wall, each at its own bearing, clear of the quays.
    const bearings = [Math.PI * 0.8, Math.PI * 0.2, Math.PI * 1.15, Math.PI * 1.85, Math.PI * 0.5].filter(
      (b) => seaward === null || Math.abs(Math.atan2(Math.sin(b - seaward), Math.cos(b - seaward))) > 0.7,
    );
    let slot = 0;
    const spot = (d: number) => {
      const b = bearings[slot++ % Math.max(1, bearings.length)] ?? 0;
      return { x: p.x + Math.cos(b) * size * d, y: p.y + Math.sin(b) * size * d * 0.85 };
    };
    // Suburbs spill past the wall as the town grows.
    for (let i = 0; i < Math.min(16, 3 + n * 2); i++) {
      const a = r() * Math.PI * 2;
      const d = size * (ring + 0.08 + r() * 0.2);
      const x = p.x + Math.cos(a) * d;
      const y = p.y + Math.sin(a) * d * 0.85;
      const s = 1.8 + r() * 0.8;
      const col = r() < 0.7 ? roof : '#4f6078';
      out.push({ x, y, draw: (g) => house(g, x, y, s, col) });
    }
    // Curtain wall around the clearing; a fortress has a star of bastions instead. Inside, streets
    // run from the gates to the square.
    out.push({
      y: p.y - size,
      draw: (g) => {
        g.lineCap = 'round';
        for (const [width, col] of [
          [2.6, 'rgba(70,58,40,0.35)'],
          [1.4, 'rgba(222,208,170,0.75)'],
        ] as const) {
          g.strokeStyle = col;
          g.lineWidth = width;
          g.beginPath();
          for (let i = 0; i < 4; i++) {
            const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
            g.moveTo(p.x + Math.cos(a) * size * 0.2, p.y + Math.sin(a) * size * 0.2 * 0.82);
            g.lineTo(p.x + Math.cos(a) * size * ring, p.y + Math.sin(a) * size * ring * 0.82);
          }
          g.moveTo(p.x + size * ring * 0.5, p.y);
          g.ellipse(p.x, p.y, size * ring * 0.5, size * ring * 0.5 * 0.82, 0, 0, Math.PI * 2);
          g.stroke();
        }
        g.beginPath();
        if (fort) {
          for (let i = 0; i <= 10; i++) {
            const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
            const d = size * ring * (i % 2 ? 0.82 : 1.06);
            const x = p.x + Math.cos(a) * d;
            const y = p.y + Math.sin(a) * d * 0.82;
            if (i) g.lineTo(x, y);
            else g.moveTo(x, y);
          }
          g.fillStyle = 'rgba(70,82,52,0.35)';
          g.fill();
        } else g.ellipse(p.x, p.y + 1, size * ring, size * ring * 0.82, 0, 0, Math.PI * 2);
        g.strokeStyle = 'rgba(60,50,36,0.6)';
        g.lineWidth = fort ? 4 : 3.4;
        g.stroke();
        g.translate(0, -1);
        g.strokeStyle = fort ? '#c9c0a4' : '#d8cdb0';
        g.lineWidth = fort ? 2.4 : 2;
        g.stroke();
        g.translate(0, 1);
      },
    });
    const towers = capital ? 6 : Math.min(6, 3 + Math.floor(n / 3));
    for (let i = 0; i < towers; i++) {
      const a = (i / towers) * Math.PI * 2 + 0.3;
      const x = p.x + Math.cos(a) * size * ring;
      const y = p.y + Math.sin(a) * size * ring * 0.82;
      out.push({ y, draw: (g) => tower(g, x, y, (capital ? 3.2 : 2.5) + n * 0.08, capital ? '#c8a03a' : roof) });
    }
    // Houses inside the walls, around the square where the garrison stands.
    const inside = Math.min(12, 4 + n);
    for (let i = 0; i < inside; i++) {
      const a = (i / inside) * Math.PI * 2 + r() * 0.4;
      const d = size * ring * (0.62 + r() * 0.2);
      const x = p.x + Math.cos(a) * d;
      const y = p.y + Math.sin(a) * d * 0.82;
      const s = 2 + r() * 0.8;
      const col = r() < 0.7 ? roof : '#4f6078';
      out.push({ y, draw: (g) => house(g, x, y, s, col) });
    }
    // A capital flies its banner over the keep, at the back of the square.
    if (capital) {
      const x = p.x;
      const y = p.y - size * ring * 0.6;
      out.push({ y, draw: (g) => keep(g, x, y) });
    }
    if (seaward !== null) {
      const x = p.x + Math.cos(seaward) * size * (ring + 0.12);
      const y = p.y + Math.sin(seaward) * size * (ring + 0.12) * 0.85;
      out.push({ y, draw: (g) => quay(g, x, y, seaward) });
    }
    const works: [FacilityId, (g: CanvasRenderingContext2D, x: number, y: number) => void][] = [
      ['factory', factory],
      ['power_plant', coolingTower],
      ['farm', fields],
      ['mine', pithead],
      ['research_lab', dome],
    ];
    for (const [id, draw] of works) {
      if (!has(id)) continue;
      const q = spot(ring + (id === 'farm' ? 0.2 : 0.16));
      out.push({ x: q.x, y: q.y, draw: (g) => draw(g, q.x, q.y) });
    }
  } else if (site.kind === 'depot') {
    for (let i = 0; i < 4; i++) {
      const x = p.x - size * 0.55 + (i % 2) * 7;
      const y = p.y + size * 0.35 + Math.floor(i / 2) * 5;
      out.push({ y, draw: (g) => house(g, x, y, 2.6, '#6d7458') });
    }
  } else {
    // A landmark: a ring of standing stones.
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const x = p.x + Math.cos(a) * size * 0.72;
      const y = p.y + Math.sin(a) * size * 0.6;
      out.push({
        y,
        draw: (g) => {
          shadow(g, x, y, 2.4, 0.9, 0.3);
          g.fillStyle = '#b8b2a2';
          g.fillRect(x - 1.3, y - 6, 2.6, 6);
          g.fillStyle = '#7d7768';
          g.fillRect(x + 0.2, y - 6, 1.1, 6);
        },
      });
    }
  }
  return out;
}

/** A capital's keep: a tall block with a gold-roofed tower and a pennant. */
function keep(g: CanvasRenderingContext2D, x: number, y: number) {
  shadow(g, x, y, 5, 1.6, 0.35);
  g.fillStyle = '#e4dac2';
  g.fillRect(x - 4.5, y - 6, 9, 6);
  g.fillStyle = '#a89878';
  g.fillRect(x + 1, y - 6, 3.5, 6);
  tower(g, x - 1, y - 4, 2.6, '#c8a03a');
  g.strokeStyle = '#3a2a1a';
  g.lineWidth = 0.6;
  g.beginPath();
  g.moveTo(x - 1, y - 14);
  g.lineTo(x - 1, y - 19);
  g.stroke();
  g.fillStyle = '#d23c2c';
  g.beginPath();
  g.moveTo(x - 1, y - 19);
  g.lineTo(x + 3.5, y - 17.6);
  g.lineTo(x - 1, y - 16.2);
  g.closePath();
  g.fill();
}

/** Quays reaching out to sea, with two boats moored. */
function quay(g: CanvasRenderingContext2D, x: number, y: number, a: number) {
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  g.lineCap = 'butt';
  for (const off of [-3.2, 3.2]) {
    const sx = x - uy * off;
    const sy = y + ux * off;
    g.strokeStyle = 'rgba(40,30,20,0.5)';
    g.lineWidth = 2.4;
    g.beginPath();
    g.moveTo(sx + 0.6, sy + 0.8);
    g.lineTo(sx + ux * 8 + 0.6, sy + uy * 8 + 0.8);
    g.stroke();
    g.strokeStyle = '#b89a6a';
    g.lineWidth = 1.6;
    g.beginPath();
    g.moveTo(sx, sy);
    g.lineTo(sx + ux * 8, sy + uy * 8);
    g.stroke();
  }
  for (const [d, off] of [
    [6, 0],
    [9.5, -5.5],
  ] as const) {
    const bx = x + ux * d - uy * off;
    const by = y + uy * d + ux * off;
    g.fillStyle = 'rgba(8,30,40,0.35)';
    g.beginPath();
    g.ellipse(bx + 0.6, by + 0.8, 2.6, 1.1, a, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#e8e2d2';
    g.beginPath();
    g.ellipse(bx, by, 2.4, 0.95, a, 0, Math.PI * 2);
    g.fill();
  }
  g.lineCap = 'round';
}

/** Soft puffs rising from (x, y): smoke or steam. */
function plume(g: CanvasRenderingContext2D, x: number, y: number, rgb: string, n: number, a0: number) {
  for (let i = 0; i < n; i++) {
    const sx = x + i * 1.6;
    const sy = y - i * 1.9;
    const r = 1.8 + i * 0.7;
    const s = g.createRadialGradient(sx, sy, 0, sx, sy, r);
    s.addColorStop(0, `rgba(${rgb},${a0 - i * (a0 / (n + 1))})`);
    s.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = s;
    g.beginPath();
    g.arc(sx, sy, r, 0, Math.PI * 2);
    g.fill();
  }
}

/** A works with a saw-tooth roof and two chimneys trailing smoke. */
function factory(g: CanvasRenderingContext2D, x: number, y: number) {
  shadow(g, x, y, 6, 1.6, 0.32);
  g.fillStyle = '#8a7e6c';
  g.fillRect(x - 5, y - 4, 10, 4);
  g.fillStyle = '#5c5448';
  for (let i = 0; i < 3; i++) {
    g.beginPath();
    g.moveTo(x - 5 + i * 3.4, y - 4);
    g.lineTo(x - 5 + i * 3.4, y - 6.2);
    g.lineTo(x - 1.6 + i * 3.4, y - 4);
    g.closePath();
    g.fill();
  }
  g.fillStyle = '#6e4a3a';
  for (const cx of [x + 2.6, x + 4.2]) g.fillRect(cx - 0.6, y - 10, 1.2, 6);
  plume(g, x + 3.6, y - 11, '196,196,192', 4, 0.55);
}

/** A power station's cooling tower with its plume of steam. */
function coolingTower(g: CanvasRenderingContext2D, x: number, y: number) {
  shadow(g, x, y, 4.5, 1.4, 0.32);
  const grad = g.createLinearGradient(x - 3.5, 0, x + 3.5, 0);
  grad.addColorStop(0, '#e6e2d8');
  grad.addColorStop(1, '#8e8a80');
  g.fillStyle = grad;
  g.beginPath();
  g.moveTo(x - 3.6, y);
  g.quadraticCurveTo(x - 1.6, y - 4, x - 2.4, y - 8);
  g.lineTo(x + 2.4, y - 8);
  g.quadraticCurveTo(x + 1.6, y - 4, x + 3.6, y);
  g.closePath();
  g.fill();
  plume(g, x, y - 10, '250,250,250', 3, 0.6);
}

/** Strip fields in three crops. */
function fields(g: CanvasRenderingContext2D, x: number, y: number) {
  const cols = ['rgba(214,190,96,0.85)', 'rgba(150,170,70,0.85)', 'rgba(196,160,80,0.85)'];
  for (let i = 0; i < 3; i++) {
    g.fillStyle = cols[i]!;
    g.beginPath();
    g.moveTo(x - 6 + i * 4, y - 3);
    g.lineTo(x - 2 + i * 4, y - 3);
    g.lineTo(x - 4 + i * 4, y + 3);
    g.lineTo(x - 8 + i * 4, y + 3);
    g.closePath();
    g.fill();
  }
  g.strokeStyle = 'rgba(90,70,40,0.35)';
  g.lineWidth = 0.4;
  for (let i = 0; i < 6; i++) {
    g.beginPath();
    g.moveTo(x - 7 + i * 2, y + 3);
    g.lineTo(x - 5 + i * 2, y - 3);
    g.stroke();
  }
}

/** A pithead: a headframe over a spoil heap. */
function pithead(g: CanvasRenderingContext2D, x: number, y: number) {
  shadow(g, x, y, 5, 1.4, 0.3);
  g.fillStyle = '#4a4440';
  g.beginPath();
  g.moveTo(x - 6, y);
  g.quadraticCurveTo(x - 3.5, y - 4, x - 1, y);
  g.closePath();
  g.fill();
  g.strokeStyle = '#3a2e26';
  g.lineWidth = 0.9;
  g.beginPath();
  g.moveTo(x + 0.5, y);
  g.lineTo(x + 2.5, y - 8);
  g.lineTo(x + 4.5, y);
  g.moveTo(x + 1.2, y - 3);
  g.lineTo(x + 3.8, y - 3);
  g.stroke();
  g.fillStyle = '#3a2e26';
  g.beginPath();
  g.arc(x + 2.5, y - 8, 1.1, 0, Math.PI * 2);
  g.fill();
}

/** A laboratory under a white dome. */
function dome(g: CanvasRenderingContext2D, x: number, y: number) {
  shadow(g, x, y, 5, 1.4, 0.3);
  g.fillStyle = '#c8c0ac';
  g.fillRect(x - 4.5, y - 2.5, 9, 2.5);
  const grad = g.createRadialGradient(x - 1.2, y - 5, 0, x, y - 3, 4);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(1, '#9aa6b4');
  g.fillStyle = grad;
  g.beginPath();
  g.arc(x, y - 2.5, 3.4, Math.PI, 0);
  g.closePath();
  g.fill();
}

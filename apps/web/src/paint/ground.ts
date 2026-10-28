import type { HexKey, NationView, SiteView, Terrain } from '@brink/contracts';
import { hexCorners, hexToPixel, neighborKeys, parseKey, type Point } from '@brink/map';

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

type Prop = { y: number; draw: (g: CanvasRenderingContext2D) => void };

export function paintTheatre(v: NationView, keys: HexKey[], size: number): Painted {
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
  const g = canvas.getContext('2d')!;
  g.setTransform(k, 0, 0, k, -x0 * k, -y0 * k);

  const terrain = (key: HexKey): Terrain | null => (v.tiles[key]?.visibility !== 'unknown' ? (v.tiles[key]?.terrain ?? null) : null);
  const c = (key: HexKey) => centers.get(key)!;
  const hexPath = (key: HexKey, grow = 0) => {
    const pts = hexCorners(c(key), size + grow);
    g.beginPath();
    g.moveTo(pts[0]!.x, pts[0]!.y);
    for (const p of pts.slice(1)) g.lineTo(p.x, p.y);
    g.closePath();
  };

  // 1. The sea: deep at the margins, shallower toward the coast.
  const sea = g.createRadialGradient(x0 + w / 2, y0 + h / 2, Math.min(w, h) * 0.25, x0 + w / 2, y0 + h / 2, Math.max(w, h) * 0.7);
  sea.addColorStop(0, '#1d6b86');
  sea.addColorStop(0.6, '#134d66');
  sea.addColorStop(1, '#0a2433');
  g.fillStyle = sea;
  g.fillRect(x0, y0, w, h);
  {
    const r = rng('sea');
    g.strokeStyle = 'rgba(150,215,225,0.16)';
    g.lineWidth = 0.8;
    for (let i = 0; i < 500; i++) {
      const x = x0 + r() * w;
      const y = y0 + r() * h;
      g.beginPath();
      g.moveTo(x - 4, y);
      g.quadraticCurveTo(x, y - 2, x + 4, y);
      g.stroke();
    }
  }
  // Shallows and surf around the edge of the land, so it stands as a coast, not a cut.
  for (const key of keys) {
    for (const n of neighborKeys(key)) {
      if (v.tiles[n]) continue;
      const [a, b] = sharedEdge(c(key), hexToPixel(parseKey(n), size), size);
      for (const [width, col] of [
        [22, 'rgba(70,160,175,0.35)'],
        [11, 'rgba(110,190,190,0.45)'],
      ] as const) {
        g.strokeStyle = col;
        g.lineWidth = width;
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(a.x, a.y);
        g.lineTo(b.x, b.y);
        g.stroke();
      }
    }
  }

  // 2. Base colour per hex, slightly grown so no seam shows, then soft blobs so kinds of ground blend.
  for (const t of LAYER) {
    for (const key of known) {
      if (terrain(key) !== t) continue;
      hexPath(key, 1.5);
      g.fillStyle = rgba(P[t].base);
      g.fill();
    }
  }
  // Each hex's colour spills softly past its edges, so neighbours blend instead of tiling.
  for (const t of LAYER) {
    for (const key of known) {
      if (terrain(key) !== t) continue;
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
    for (const key of known) {
      if (terrain(key) !== t) continue;
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

  // 3. Brushwork: grass tufts, rock flecks, cobbles, ripples.
  for (const key of known) {
    const t = terrain(key)!;
    const r = rng(`dab${key}`);
    const p = c(key);
    const n = t === 'water' ? 10 : 34;
    for (let i = 0; i < n; i++) {
      const a = r() * Math.PI * 2;
      const d = Math.sqrt(r()) * size * 0.95;
      const x = p.x + Math.cos(a) * d;
      const y = p.y + Math.sin(a) * d;
      if (t === 'water') {
        g.strokeStyle = rgba(P.water.tuft, 0.35);
        g.lineWidth = 0.7;
        g.beginPath();
        g.moveTo(x - 3, y);
        g.quadraticCurveTo(x, y - 1.6, x + 3, y);
        g.stroke();
      } else if (t === 'mountains') {
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

  // 4. Coasts: sand where land meets water, then a band of surf on the water side.
  for (const key of known) {
    if (terrain(key) !== 'water') continue;
    for (const n of neighborKeys(key)) {
      const u = terrain(n);
      if (!u || u === 'water') continue;
      const [a, b] = sharedEdge(c(key), c(n), size);
      g.lineCap = 'round';
      g.strokeStyle = 'rgba(214,196,140,0.85)';
      g.lineWidth = 4.5;
      g.beginPath();
      g.moveTo(a.x, a.y);
      g.lineTo(b.x, b.y);
      g.stroke();
      // Surf: a wavy white line a little out to sea.
      const dx = c(key).x - (a.x + b.x) / 2;
      const dy = c(key).y - (a.y + b.y) / 2;
      const len = Math.hypot(dx, dy) || 1;
      const ox = (dx / len) * 4;
      const oy = (dy / len) * 4;
      g.strokeStyle = 'rgba(230,246,242,0.7)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(a.x + ox, a.y + oy);
      const mx = (a.x + b.x) / 2 + ox * 1.5;
      const my = (a.y + b.y) / 2 + oy * 1.5;
      g.quadraticCurveTo(mx, my, b.x + ox, b.y + oy);
      g.stroke();
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

  // 6. Props, painted back to front so nearer ones overlap: trees, peaks, hills, towns, castles.
  // They keep to the rim of the hex; the middle is a clearing where the army counter stands.
  const props: Prop[] = [];
  for (const key of known) {
    const t = v.tiles[key]!;
    const p = c(key);
    const r = rng(`prop${key}`);
    const site = t.siteId ? v.sites[t.siteId] : undefined;
    if (site) {
      props.push(...siteProps(site, p, size, r));
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
        props.push({ y, draw: (gg) => tree(gg, x, y, s, col) });
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
        props.push({ y: ty, draw: (gg) => tree(gg, tx, ty, s, col) });
      }
    } else if (t.terrain === 'hills') {
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + r();
        const x = p.x + Math.cos(a) * size * 0.55;
        const y = p.y + Math.sin(a) * size * 0.5;
        const s = 7 + r() * 4;
        props.push({ y, draw: (gg) => hill(gg, x, y, s) });
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
        props.push({ y, draw: (gg) => peak(gg, x, y, hgt, r() < 0.5) });
      }
    } else if (t.terrain === 'urban') {
      for (let i = 0; i < 7; i++) {
        const a = r() * Math.PI * 2;
        const d = size * (0.45 + r() * 0.4);
        const x = p.x + Math.cos(a) * d;
        const y = p.y + Math.sin(a) * d * 0.85;
        const roof = r() < 0.6 ? '#b45a3c' : '#4f6078';
        props.push({ y, draw: (gg) => house(gg, x, y, 3 + r() * 1.5, roof) });
      }
    }
  }
  props.sort((a, b) => a.y - b.y);
  for (const pr of props) pr.draw(g);

  // 7. Light: warm from the top left, a vignette at the edges, and the unseen kept dark.
  const light = g.createLinearGradient(x0, y0, x0 + w, y0 + h);
  light.addColorStop(0, 'rgba(255,236,190,0.10)');
  light.addColorStop(0.5, 'rgba(255,236,190,0)');
  light.addColorStop(1, 'rgba(10,20,40,0.18)');
  g.fillStyle = light;
  g.fillRect(x0, y0, w, h);
  // Land nobody has seen yet stays dark (the fog clouds drift over it).
  for (const key of keys) {
    if (terrain(key)) continue;
    hexPath(key, 1.5);
    g.fillStyle = '#121a1e';
    g.fill();
  }
  const cx = x0 + w / 2;
  const cy = y0 + h / 2;
  const vig = g.createRadialGradient(cx, cy, Math.min(w, h) * 0.35, cx, cy, Math.max(w, h) * 0.7);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.55)');
  g.fillStyle = vig;
  g.fillRect(x0, y0, w, h);

  return { canvas, x: x0, y: y0, unit: 1 / k };
}

/** The two corners of `a`'s hex nearest neighbour `b`. */
function sharedEdge(a: Point, b: Point, size: number): [Point, Point] {
  const [p, q] = hexCorners(a, size)
    .map((pt) => ({ pt, d: (pt.x - b.x) ** 2 + (pt.y - b.y) ** 2 }))
    .sort((x, y) => x.d - y.d);
  return [p!.pt, q!.pt];
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

/** Capitals are walled castles, cities walled towns, depots supply yards, objectives a landmark. */
function siteProps(site: SiteView, p: Point, size: number, r: () => number): Prop[] {
  const out: Prop[] = [];
  const roof = '#b4503a';
  if (site.kind === 'capital' || site.kind === 'city') {
    const ring = site.kind === 'capital' ? 0.78 : 0.7;
    // Curtain wall around the clearing.
    out.push({
      y: p.y - size,
      draw: (g) => {
        g.strokeStyle = 'rgba(60,50,36,0.6)';
        g.lineWidth = 3.4;
        g.beginPath();
        g.ellipse(p.x, p.y + 1, size * ring, size * ring * 0.82, 0, 0, Math.PI * 2);
        g.stroke();
        g.strokeStyle = '#d8cdb0';
        g.lineWidth = 2;
        g.beginPath();
        g.ellipse(p.x, p.y, size * ring, size * ring * 0.82, 0, 0, Math.PI * 2);
        g.stroke();
      },
    });
    const n = site.kind === 'capital' ? 6 : 4;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + 0.3;
      const x = p.x + Math.cos(a) * size * ring;
      const y = p.y + Math.sin(a) * size * ring * 0.82;
      out.push({ y, draw: (g) => tower(g, x, y, site.kind === 'capital' ? 3.2 : 2.6, roof) });
    }
    // Houses inside the walls, around the square where the garrison stands.
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + r() * 0.4;
      const d = size * ring * (0.62 + r() * 0.2);
      const x = p.x + Math.cos(a) * d;
      const y = p.y + Math.sin(a) * d * 0.82;
      out.push({ y, draw: (g) => house(g, x, y, 2 + r() * 0.8, r() < 0.7 ? roof : '#4f6078') });
    }
    for (let i = 0; i < 8; i++) {
      const a = r() * Math.PI * 2;
      const d = size * (0.85 + r() * 0.15);
      const x = p.x + Math.cos(a) * d;
      const y = p.y + Math.sin(a) * d * 0.85;
      out.push({ y, draw: (g) => house(g, x, y, 2.4 + r(), r() < 0.7 ? roof : '#4f6078') });
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

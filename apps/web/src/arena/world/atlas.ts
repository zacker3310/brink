import * as THREE from 'three';
import type { UVRect } from './geom';
import { hex, lattice, noise2, fbm, stream, type RGB } from './noise';

// One texture for every building, bridge and heap of rubble, so they all draw in one call: a 4 x 4
// grid of regions. A facade region is one cell wide and four storeys tall (its bottom strip is the
// plinth); a roof region is one world unit square. A second, smaller map marks the window panes
// with a random number each, so the shader can light a few of them at night, differently per wall.

export const REGION = {
  plasterA: 0,
  plasterB: 1,
  brick: 2,
  desert: 3,
  panel: 4,
  silicate: 5,
  panelDamaged: 6,
  shed: 7,
  factory: 8,
  shop: 9,
  interior: 10,
  roofTile: 11,
  roofSheet: 12,
  roofFlat: 13,
  roofSnow: 14,
  misc: 15,
} as const;
export type Region = (typeof REGION)[keyof typeof REGION];

/** Storey height painted into each facade region (world units). */
export const STOREY: Record<Region, number> = {
  0: 0.3,
  1: 0.3,
  2: 0.3,
  3: 0.3,
  4: 0.3,
  5: 0.3,
  6: 0.3,
  7: 0.42,
  8: 0.42,
  9: 0.32,
  10: 0.3,
  11: 1,
  12: 1,
  13: 1,
  14: 1,
  15: 1,
};
/** The plinth below the ground floor in every facade region. */
export const PLINTH = 0.06;
/** Regions that take a building's tint (plaster and panels); the rest keep their own colour. */
export const TINTED = new Set<Region>([0, 1, 3, 4, 6, 9]);

/** UV rectangle of a region, or of a part of it (fractions, v from the top). */
export function regionRect(r: Region, u0 = 0, v0 = 0, u1 = 1, v1 = 1, pad = 0.004): UVRect {
  const col = r % 4;
  const row = Math.floor(r / 4);
  const s = 0.25;
  const x0 = col * s + pad;
  const y0 = row * s + pad;
  const w = s - pad * 2;
  return [x0 + u0 * w, y0 + v0 * w, x0 + u1 * w, y0 + v1 * w];
}

/** The misc region's four parts. */
export const MISC = {
  concrete: regionRect(REGION.misc, 0.02, 0.02, 0.48, 0.48),
  glazing: regionRect(REGION.misc, 0.52, 0.02, 0.98, 0.48),
  awning: regionRect(REGION.misc, 0.02, 0.52, 0.48, 0.98),
  metal: regionRect(REGION.misc, 0.52, 0.52, 0.98, 0.98),
};

/** UVs on a facade for a wall spanning u (cell widths, centred) and heights above the base. */
export function facadeRect(r: Region, uFrom: number, uTo: number, y0: number, y1: number): UVRect {
  const tall = STOREY[r] * 4;
  const v = (h: number) => 1 - Math.min(1, Math.max(0, (h + PLINTH) / tall));
  return regionRect(r, uFrom, v(y1), uTo, v(y0));
}

interface Painter {
  g: CanvasRenderingContext2D;
  e: CanvasRenderingContext2D;
  /** Region size in pixels on the colour map, and the emissive map's scale to it. */
  R: number;
  k: number;
  rnd: () => number;
  t: Float32Array;
}

const rgb = (c: RGB, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

/** Fill a region with a base colour and soft noise (stains, damp, dust). */
function base(p: Painter, x0: number, y0: number, w: number, h: number, color: string, amount: number, freq = 6): void {
  const { g, t } = p;
  g.fillStyle = color;
  g.fillRect(x0, y0, w, h);
  const img = g.getImageData(x0, y0, w, h);
  const d = img.data;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const n = fbm(t, (x / w) * freq + x0 * 0.01, (y / h) * freq + y0 * 0.01, 3) - 0.5;
      const f = noise2(t, x * 0.9 + x0, y * 0.9 + y0) - 0.5;
      const k = 1 + n * amount + f * amount * 0.35;
      const i = (y * w + x) * 4;
      d[i] = d[i]! * k;
      d[i + 1] = d[i + 1]! * k;
      d[i + 2] = d[i + 2]! * k;
    }
  g.putImageData(img, x0, y0);
}

/** Vertical grime streaks running down from a line. */
function streaks(p: Painter, x0: number, y0: number, w: number, h: number, n: number, alpha: number): void {
  const { g, rnd } = p;
  for (let i = 0; i < n; i++) {
    const x = x0 + rnd() * w;
    const y = y0 + rnd() * h * 0.6;
    const len = h * (0.1 + rnd() * 0.5);
    const grad = g.createLinearGradient(0, y, 0, y + len);
    grad.addColorStop(0, `rgba(30,26,20,${alpha * (0.5 + rnd())})`);
    grad.addColorStop(1, 'rgba(30,26,20,0)');
    g.fillStyle = grad;
    g.fillRect(x, y, 1 + rnd() * 3, len);
  }
}

/** A window: frame, dark glass with a sky reflection, sill; marked on the emissive map. */
function windowAt(p: Painter, x: number, y: number, w: number, h: number, frame: string, opts: { panes?: number; broken?: number; curtain?: boolean; litable?: boolean } = {}): void {
  const { g, e, k, rnd } = p;
  const f = Math.max(1, w * 0.08);
  g.fillStyle = 'rgba(20,18,16,0.55)';
  g.fillRect(x - f, y - f, w + f * 2, h + f * 2.5);
  g.fillStyle = frame;
  g.fillRect(x - f * 0.6, y - f * 0.6, w + f * 1.2, h + f * 1.2);
  const glass = g.createLinearGradient(x, y, x + w * 0.6, y + h);
  const sky = 60 + rnd() * 40;
  glass.addColorStop(0, `rgb(${sky * 0.8},${sky * 0.9},${sky})`);
  glass.addColorStop(0.5, '#262b2f');
  glass.addColorStop(1, '#14181b');
  const broken = rnd() < (opts.broken ?? 0);
  g.fillStyle = broken ? '#0b0c0d' : glass;
  g.fillRect(x, y, w, h);
  if (opts.curtain && !broken && rnd() < 0.6) {
    g.fillStyle = `rgba(${170 + rnd() * 50},${150 + rnd() * 40},${120 + rnd() * 40},0.35)`;
    g.fillRect(x + w * 0.05, y + h * 0.05, w * (0.25 + rnd() * 0.2), h * 0.9);
  }
  // Mullions.
  g.fillStyle = frame;
  const panes = opts.panes ?? 2;
  for (let i = 1; i < panes; i++) g.fillRect(x + (w * i) / panes - f * 0.3, y, f * 0.6, h);
  g.fillRect(x, y + h * 0.33, w, f * 0.5);
  // Sill shadow.
  g.fillStyle = 'rgba(200,196,186,0.8)';
  g.fillRect(x - f, y + h + f * 0.4, w + f * 2, f * 0.9);
  if (!broken && opts.litable !== false) {
    e.fillStyle = `rgb(${Math.floor(rnd() * 255)},255,0)`;
    e.fillRect(x * k, y * k, w * k, h * k);
  }
}

function brickCourses(p: Painter, x0: number, y0: number, w: number, h: number, course: number, color: RGB, spread: number): void {
  const { g, rnd } = p;
  g.fillStyle = rgb(color);
  g.fillRect(x0, y0, w, h);
  for (let y = 0; y < h; y += course) {
    const off = (Math.floor(y / course) % 2) * course;
    for (let x = -off; x < w; x += course * 2) {
      const v = 1 + (rnd() - 0.5) * spread;
      g.fillStyle = rgb([color[0] * v, color[1] * v, color[2] * v]);
      g.fillRect(x0 + x, y0 + y, course * 2 - 1, course - 1);
    }
  }
}

function region(p: Painter, r: Region): [number, number] {
  return [(r % 4) * p.R, Math.floor(r / 4) * p.R];
}

/** Rows of windows per storey across a facade, with a door on the ground floor. */
function facade(p: Painter, r: Region, opts: { wall: () => void; cols: number[]; ww: number; wh: number; sill: number; frame: string; door?: number; panes?: number; broken?: number; groundShop?: boolean }): void {
  const [x0, y0] = region(p, r);
  const { g, R } = p;
  g.save();
  g.beginPath();
  g.rect(x0, y0, R, R);
  g.clip();
  opts.wall();
  const sh = STOREY[r];
  const tall = sh * 4;
  const Y = (h: number) => y0 + R - ((h + PLINTH) / tall) * R;
  const X = (u: number) => x0 + u * R;
  // Plinth.
  g.fillStyle = 'rgba(40,36,30,0.35)';
  g.fillRect(x0, Y(0.02), R, R - (Y(0.02) - y0));
  for (let s = 0; s < 4; s++) {
    const floor = s * sh;
    // A faint band at each floor.
    g.fillStyle = 'rgba(0,0,0,0.08)';
    g.fillRect(x0, Y(floor + 0.004), R, Math.max(1, (0.008 / tall) * R));
    if (s === 0 && opts.door !== undefined) {
      const u = opts.door;
      const dw = 0.09;
      const dh = 0.2;
      g.fillStyle = 'rgba(15,13,11,0.6)';
      g.fillRect(X(u - dw / 2) - 1, Y(dh) - 1, dw * R + 2, Y(0) - Y(dh) + 1);
      g.fillStyle = ['#4a3a2c', '#3f4a4c', '#5a5348', '#2f3a33'][Math.floor(p.rnd() * 4)]!;
      g.fillRect(X(u - dw / 2), Y(dh), dw * R, Y(0) - Y(dh));
    }
    for (const u of opts.cols) {
      if (s === 0 && opts.door !== undefined && Math.abs(u - opts.door) < 0.1) continue;
      if (s === 0 && opts.groundShop) continue;
      windowAt(p, X(u - opts.ww / 2), Y(floor + opts.sill + opts.wh), opts.ww * R, Y(floor + opts.sill) - Y(floor + opts.sill + opts.wh), opts.frame, { panes: opts.panes, broken: opts.broken, curtain: true });
    }
  }
  streaks(p, x0, y0, R, R, 26, 0.05);
  // Damp and dirt splashed up the base.
  const dirt = g.createLinearGradient(0, Y(0.12), 0, Y(-0.05));
  dirt.addColorStop(0, 'rgba(50,42,32,0)');
  dirt.addColorStop(1, 'rgba(50,42,32,0.35)');
  g.fillStyle = dirt;
  g.fillRect(x0, Y(0.12), R, Y(-0.05) - Y(0.12));
  g.restore();
}

/** Chipped plaster showing brick, bullet pocks and a few shell scars. */
function damage(p: Painter, r: Region, amount: number): void {
  const [x0, y0] = region(p, r);
  const { g, rnd, R } = p;
  g.save();
  g.beginPath();
  g.rect(x0, y0, R, R);
  g.clip();
  for (let i = 0; i < 6 * amount; i++) {
    const x = x0 + rnd() * R;
    const y = y0 + rnd() * R * 0.9;
    const s = R * (0.012 + rnd() * 0.03);
    g.fillStyle = 'rgba(112,92,78,0.4)';
    g.beginPath();
    g.ellipse(x, y, s, s * (0.5 + rnd() * 0.5), rnd() * 3, 0, Math.PI * 2);
    g.fill();
  }
  for (let i = 0; i < 90 * amount; i++) {
    const x = x0 + rnd() * R;
    const y = y0 + rnd() * R;
    g.fillStyle = `rgba(28,24,20,${0.3 + rnd() * 0.4})`;
    g.fillRect(x, y, 1 + rnd() * 1.5, 1 + rnd() * 1.5);
  }
  g.restore();
}

function shellHole(p: Painter, x: number, y: number, s: number): void {
  const { g, rnd } = p;
  g.fillStyle = 'rgba(150,146,138,0.9)';
  g.beginPath();
  for (let a = 0; a < Math.PI * 2; a += 0.5) g.lineTo(x + Math.cos(a) * s * (1.1 + rnd() * 0.5), y + Math.sin(a) * s * (1.1 + rnd() * 0.5));
  g.fill();
  g.fillStyle = '#0d0d0d';
  g.beginPath();
  for (let a = 0; a < Math.PI * 2; a += 0.45) g.lineTo(x + Math.cos(a) * s * (0.6 + rnd() * 0.4), y + Math.sin(a) * s * (0.6 + rnd() * 0.4));
  g.fill();
  g.strokeStyle = 'rgba(70,50,40,0.9)';
  g.lineWidth = 1;
  for (let i = 0; i < 4; i++) {
    g.beginPath();
    g.moveTo(x + (rnd() - 0.5) * s, y + (rnd() - 0.5) * s);
    g.lineTo(x + (rnd() - 0.5) * s * 2.4, y + (rnd() - 0.5) * s * 2.4);
    g.stroke();
  }
}

function soot(p: Painter, x: number, y: number, w: number, h: number): void {
  const grad = p.g.createLinearGradient(0, y + h, 0, y - h * 1.6);
  grad.addColorStop(0, 'rgba(12,11,10,0.85)');
  grad.addColorStop(1, 'rgba(12,11,10,0)');
  p.g.fillStyle = grad;
  p.g.beginPath();
  p.g.moveTo(x, y + h);
  p.g.lineTo(x + w, y + h);
  p.g.lineTo(x + w * 1.3, y - h * 1.6);
  p.g.lineTo(x - w * 0.3, y - h * 1.6);
  p.g.fill();
}

export interface Atlas {
  map: THREE.CanvasTexture;
  emissive: THREE.CanvasTexture;
  canvas: HTMLCanvasElement;
  emissiveCanvas: HTMLCanvasElement;
}

export function paintAtlas(size: number, seed: number): Atlas {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ecanvas = document.createElement('canvas');
  ecanvas.width = ecanvas.height = size / 2;
  const g = canvas.getContext('2d', { willReadFrequently: true })!;
  const e = ecanvas.getContext('2d')!;
  e.fillStyle = '#000';
  e.fillRect(0, 0, size / 2, size / 2);
  const R = size / 4;
  const p: Painter = { g, e, R, k: 0.5, rnd: stream(seed ^ 0xa71a5), t: lattice(seed ^ 0x3e) };
  const at = (r: Region) => region(p, r);
  const plaster = (r: Region, color: string) => () => {
    const [x0, y0] = at(r);
    base(p, x0, y0, R, R, color, 0.22, 5);
  };

  facade(p, REGION.plasterA, { wall: plaster(REGION.plasterA, '#cbc5b9'), cols: [0.27, 0.73], door: 0.5, ww: 0.15, wh: 0.14, sill: 0.08, frame: '#d9d5cc', panes: 2 });
  damage(p, REGION.plasterA, 1);
  facade(p, REGION.plasterB, { wall: plaster(REGION.plasterB, '#c7c1b4'), cols: [0.2, 0.5, 0.8], door: 0.8, ww: 0.12, wh: 0.15, sill: 0.08, frame: '#cfcabd', panes: 2 });
  damage(p, REGION.plasterB, 1.5);
  facade(p, REGION.brick, {
    wall: () => {
      const [x0, y0] = at(REGION.brick);
      brickCourses(p, x0, y0, R, R, Math.max(2, R / 96), hex('#8a5546'), 0.16);
    },
    cols: [0.3, 0.7],
    door: 0.3,
    ww: 0.14,
    wh: 0.15,
    sill: 0.08,
    frame: '#e0dcd2',
    panes: 2,
  });
  damage(p, REGION.brick, 0.6);
  facade(p, REGION.desert, { wall: plaster(REGION.desert, '#ddd0b6'), cols: [0.22, 0.5, 0.78], door: 0.5, ww: 0.1, wh: 0.1, sill: 0.11, frame: '#5f6b6a', panes: 1, broken: 0.12 });
  {
    // Air conditioners and drain stains.
    const [x0, y0] = at(REGION.desert);
    for (let i = 0; i < 5; i++) {
      g.fillStyle = '#9a9890';
      g.fillRect(x0 + p.rnd() * R * 0.85, y0 + p.rnd() * R * 0.8, R * 0.06, R * 0.04);
    }
    streaks(p, x0, y0, R, R * 0.4, 14, 0.12);
  }
  damage(p, REGION.desert, 1.2);
  const panel = (r: Region, damaged: boolean) => {
    facade(p, r, {
      wall: () => {
        const [x0, y0] = at(r);
        base(p, x0, y0, R, R, damaged ? '#c7c2b8' : '#d0cbc1', 0.18, 7);
        // Panel joints.
        const tall = STOREY[r] * 4;
        g.fillStyle = 'rgba(40,38,34,0.55)';
        for (const u of [0, 1 / 3, 2 / 3, 1]) g.fillRect(x0 + u * R - 1, y0, 2, R);
        for (let s = 0; s <= 4; s++) g.fillRect(x0, y0 + R - ((s * STOREY[r] + PLINTH) / tall) * R - 1, R, 2);
      },
      cols: [1 / 6, 0.5, 5 / 6],
      ww: 0.12,
      wh: 0.15,
      sill: 0.08,
      frame: '#d6d2c8',
      panes: 2,
      broken: damaged ? 0.45 : 0.05,
    });
  };
  panel(REGION.panel, false);
  damage(p, REGION.panel, 0.5);
  panel(REGION.panelDamaged, true);
  {
    const [x0, y0] = at(REGION.panelDamaged);
    damage(p, REGION.panelDamaged, 3);
    for (let i = 0; i < 3; i++) soot(p, x0 + (0.1 + p.rnd() * 0.7) * R, y0 + (0.2 + p.rnd() * 0.6) * R, R * 0.12, R * 0.08);
    for (let i = 0; i < 3; i++) shellHole(p, x0 + (0.1 + p.rnd() * 0.8) * R, y0 + (0.1 + p.rnd() * 0.75) * R, R * (0.04 + p.rnd() * 0.04));
  }
  facade(p, REGION.silicate, {
    wall: () => {
      const [x0, y0] = at(REGION.silicate);
      brickCourses(p, x0, y0, R, R, Math.max(2, R / 110), hex('#d6ccb6'), 0.08);
    },
    cols: [0.2, 0.5, 0.8],
    ww: 0.11,
    wh: 0.15,
    sill: 0.08,
    frame: '#e4e0d6',
    panes: 2,
    broken: 0.08,
  });
  damage(p, REGION.silicate, 0.8);
  // Industrial shed: corrugated sheeting, a band of high windows, roller doors.
  {
    const r = REGION.shed;
    const [x0, y0] = at(r);
    base(p, x0, y0, R, R, '#c4c6c2', 0.2, 4);
    const rib = Math.max(3, R / 48);
    for (let x = 0; x < R; x += rib) {
      g.fillStyle = 'rgba(0,0,0,0.13)';
      g.fillRect(x0 + x, y0, rib * 0.4, R);
      g.fillStyle = 'rgba(255,255,255,0.08)';
      g.fillRect(x0 + x + rib * 0.5, y0, rib * 0.2, R);
    }
    const tall = STOREY[r] * 4;
    const Y = (h: number) => y0 + R - ((h + PLINTH) / tall) * R;
    for (let s = 0; s < 4; s++) {
      g.fillStyle = '#6f7670';
      g.fillRect(x0, Y(s * 0.42 + 0.36), R, Y(s * 0.42 + 0.3) - Y(s * 0.42 + 0.36));
      for (let x = 0; x < R; x += R / 8) {
        g.fillStyle = 'rgba(25,28,26,0.7)';
        g.fillRect(x0 + x, Y(s * 0.42 + 0.36), 2, Y(s * 0.42 + 0.3) - Y(s * 0.42 + 0.36));
      }
    }
    // Roller door.
    g.fillStyle = '#7e7c74';
    g.fillRect(x0 + 0.3 * R, Y(0.27), 0.4 * R, Y(0) - Y(0.27));
    for (let h = 0; h < 0.27; h += 0.012) {
      g.fillStyle = 'rgba(0,0,0,0.2)';
      g.fillRect(x0 + 0.3 * R, Y(h), 0.4 * R, 1);
    }
    streaks(p, x0, y0, R, R, 40, 0.1);
    // Rust runs.
    for (let i = 0; i < 20; i++) {
      g.fillStyle = `rgba(120,60,30,${0.1 + p.rnd() * 0.2})`;
      g.fillRect(x0 + p.rnd() * R, y0 + p.rnd() * R, 2, R * 0.1 * (1 + p.rnd() * 3));
    }
  }
  // Old brick factory: tall windows of small panes.
  facade(p, REGION.factory, {
    wall: () => {
      const [x0, y0] = at(REGION.factory);
      brickCourses(p, x0, y0, R, R, Math.max(2, R / 110), hex('#7a4a3b'), 0.18);
    },
    cols: [0.25, 0.75],
    ww: 0.2,
    wh: 0.27,
    sill: 0.07,
    frame: '#4a4d48',
    panes: 4,
    broken: 0.35,
  });
  damage(p, REGION.factory, 1);
  // Shop: shopfront and sign below, flats above.
  {
    const r = REGION.shop;
    facade(p, r, { wall: plaster(r, '#d4cec2'), cols: [0.27, 0.73], ww: 0.15, wh: 0.14, sill: 0.08, frame: '#d8d4cb', panes: 2, groundShop: true });
    const [x0, y0] = at(r);
    const tall = STOREY[r] * 4;
    const Y = (h: number) => y0 + R - ((h + PLINTH) / tall) * R;
    const glass = g.createLinearGradient(0, Y(0.22), 0, Y(0.03));
    glass.addColorStop(0, '#53606a');
    glass.addColorStop(1, '#1b2024');
    g.fillStyle = '#3a3a38';
    g.fillRect(x0 + 0.1 * R, Y(0.23), 0.8 * R, Y(0.02) - Y(0.23));
    g.fillStyle = glass;
    g.fillRect(x0 + 0.12 * R, Y(0.22), 0.76 * R, Y(0.03) - Y(0.22));
    e.fillStyle = `rgb(${Math.floor(p.rnd() * 255)},255,0)`;
    e.fillRect((x0 + 0.12 * R) * 0.5, Y(0.22) * 0.5, 0.76 * R * 0.5, (Y(0.03) - Y(0.22)) * 0.5);
    // Half-drawn shutter.
    g.fillStyle = '#8b8a84';
    g.fillRect(x0 + 0.5 * R, Y(0.22), 0.38 * R, (Y(0.03) - Y(0.22)) * 0.6);
    for (let h = 0.22; h > 0.1; h -= 0.01) {
      g.fillStyle = 'rgba(0,0,0,0.2)';
      g.fillRect(x0 + 0.5 * R, Y(h), 0.38 * R, 1);
    }
    // Faded sign.
    const signs = ['#7b3a32', '#2f4f6b', '#6b6a2f', '#3d5a45'];
    g.fillStyle = signs[Math.floor(p.rnd() * signs.length)]!;
    g.fillRect(x0 + 0.08 * R, Y(0.3), 0.84 * R, Y(0.245) - Y(0.3));
    g.fillStyle = 'rgba(230,226,214,0.75)';
    for (let i = 0; i < 7; i++) g.fillRect(x0 + (0.14 + i * 0.1) * R, Y(0.29), 0.06 * R, Y(0.255) - Y(0.29));
    damage(p, r, 1);
  }
  // Exposed interior: floor slabs, wallpapered rooms, dark doorways.
  {
    const r = REGION.interior;
    const [x0, y0] = at(r);
    const tall = STOREY[r] * 4;
    const Y = (h: number) => y0 + R - ((h + PLINTH) / tall) * R;
    const papers = ['#a49e80', '#8e9c8a', '#ad9888', '#7f8a96', '#9a8f78'];
    g.fillStyle = '#5e5b55';
    g.fillRect(x0, y0, R, R);
    for (let s = 0; s < 4; s++) {
      let u = 0;
      while (u < 1) {
        const w = 0.25 + p.rnd() * 0.35;
        g.fillStyle = papers[Math.floor(p.rnd() * papers.length)]!;
        g.fillRect(x0 + u * R, Y(s * 0.3 + 0.3), w * R, Y(s * 0.3 + 0.03) - Y(s * 0.3 + 0.3));
        // Doorway.
        if (p.rnd() < 0.5) {
          g.fillStyle = '#1a1816';
          g.fillRect(x0 + (u + w * 0.4) * R, Y(s * 0.3 + 0.22), 0.08 * R, Y(s * 0.3 + 0.03) - Y(s * 0.3 + 0.22));
        }
        g.fillStyle = 'rgba(40,36,30,0.5)';
        g.fillRect(x0 + (u + w) * R - 2, Y(s * 0.3 + 0.3), 4, Y(s * 0.3) - Y(s * 0.3 + 0.3));
        u += w;
      }
      // Slab edge.
      g.fillStyle = '#8f8c86';
      g.fillRect(x0, Y(s * 0.3 + 0.03), R, Y(s * 0.3) - Y(s * 0.3 + 0.03));
    }
    damage(p, r, 3);
    for (let i = 0; i < 3; i++) soot(p, x0 + p.rnd() * R * 0.8, y0 + (0.2 + p.rnd() * 0.6) * R, R * 0.2, R * 0.1);
  }
  // Roofs.
  {
    const [x0, y0] = at(REGION.roofTile);
    base(p, x0, y0, R, R, '#7c5a4b', 0.32, 6);
    const row = Math.max(3, R / 34);
    for (let y = 0; y < R; y += row) {
      g.fillStyle = 'rgba(30,16,10,0.35)';
      g.fillRect(x0, y0 + y, R, Math.max(1, row * 0.25));
      const off = (Math.floor(y / row) % 2) * row * 0.5;
      for (let x = -off; x < R; x += row) {
        g.fillStyle = 'rgba(30,16,10,0.25)';
        g.fillRect(x0 + x, y0 + y, 1, row);
      }
    }
    // Moss and soot.
    for (let i = 0; i < 30; i++) {
      g.fillStyle = `rgba(${60 + p.rnd() * 30},${70 + p.rnd() * 20},${40},${0.15 + p.rnd() * 0.2})`;
      g.beginPath();
      g.arc(x0 + p.rnd() * R, y0 + p.rnd() * R, R * (0.02 + p.rnd() * 0.05), 0, Math.PI * 2);
      g.fill();
    }
  }
  {
    const [x0, y0] = at(REGION.roofSheet);
    base(p, x0, y0, R, R, '#8f8d86', 0.28, 5);
    const rib = Math.max(3, R / 40);
    for (let x = 0; x < R; x += rib) {
      g.fillStyle = 'rgba(0,0,0,0.12)';
      g.fillRect(x0 + x, y0, rib * 0.35, R);
      g.fillStyle = 'rgba(255,255,255,0.07)';
      g.fillRect(x0 + x + rib * 0.5, y0, rib * 0.2, R);
    }
    for (let y = 0; y < R; y += R / 4) {
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fillRect(x0, y0 + y, R, 2);
    }
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(${150 + p.rnd() * 40},${150 + p.rnd() * 30},${90},${0.15 + p.rnd() * 0.2})`;
      g.beginPath();
      g.arc(x0 + p.rnd() * R, y0 + p.rnd() * R, R * (0.01 + p.rnd() * 0.02), 0, Math.PI * 2);
      g.fill();
    }
  }
  {
    const [x0, y0] = at(REGION.roofFlat);
    base(p, x0, y0, R, R, '#56544f', 0.35, 4);
    for (let i = 0; i < 14; i++) {
      const v = 80 + p.rnd() * 22;
      g.fillStyle = `rgba(${v},${v},${v - 5},0.3)`;
      g.fillRect(x0 + p.rnd() * R * 0.8, y0 + p.rnd() * R * 0.8, R * (0.08 + p.rnd() * 0.2), R * (0.06 + p.rnd() * 0.15));
    }
    // Damp stains where water ponds.
    for (let i = 0; i < 8; i++) {
      g.fillStyle = 'rgba(30,30,28,0.12)';
      g.beginPath();
      g.ellipse(x0 + p.rnd() * R, y0 + p.rnd() * R, R * 0.06, R * 0.04, p.rnd() * 3, 0, Math.PI * 2);
      g.fill();
    }
  }
  {
    const [x0, y0] = at(REGION.roofSnow);
    base(p, x0, y0, R, R, '#e6eaed', 0.08, 5);
    const row = Math.max(3, R / 34);
    for (let y = 0; y < R; y += row) {
      g.fillStyle = 'rgba(120,130,140,0.08)';
      g.fillRect(x0, y0 + y, R, 1);
    }
    for (let i = 0; i < 6; i++) {
      g.fillStyle = 'rgba(110,105,100,0.18)';
      g.beginPath();
      g.ellipse(x0 + p.rnd() * R, y0 + p.rnd() * R, R * 0.05, R * 0.03, 0, 0, Math.PI * 2);
      g.fill();
    }
  }
  {
    const [x0, y0] = at(REGION.misc);
    const h = R / 2;
    // Concrete.
    base(p, x0, y0, h, h, '#9d9a93', 0.3, 5);
    g.fillStyle = 'rgba(0,0,0,0.12)';
    for (let y = 0; y < h; y += h / 6) g.fillRect(x0, y0 + y, h, 1);
    streaks(p, x0, y0, h, h, 12, 0.08);
    // Glazing.
    g.fillStyle = '#5c6366';
    g.fillRect(x0 + h, y0, h, h);
    for (let y = 0; y < h; y += h / 4)
      for (let x = 0; x < h; x += h / 6) {
        const broken = p.rnd() < 0.25;
        g.fillStyle = broken ? '#121314' : `rgb(${72 + p.rnd() * 26},${76 + p.rnd() * 26},${80 + p.rnd() * 26})`;
        g.fillRect(x0 + h + x + 2, y0 + y + 2, h / 6 - 4, h / 4 - 4);
      }
    // Awning stripes.
    const pairs = [
      ['#7a5148', '#aaa496'],
      ['#4a5a62', '#a8a496'],
      ['#5d6447', '#aea999'],
    ];
    const pr = pairs[Math.floor(p.rnd() * pairs.length)]!;
    for (let x = 0; x < h; x += h / 8) {
      g.fillStyle = Math.floor(x / (h / 8)) % 2 ? pr[0]! : pr[1]!;
      g.fillRect(x0 + x, y0 + h, h / 8 + 1, h);
    }
    base(p, x0, y0 + h, h, h, 'rgba(0,0,0,0)', 0.25, 4);
    streaks(p, x0, y0 + h, h, h, 10, 0.12);
    // Metal.
    base(p, x0 + h, y0 + h, h, h, '#8c8e8a', 0.3, 5);
    for (let i = 0; i < 12; i++) {
      g.fillStyle = `rgba(120,64,34,${0.15 + p.rnd() * 0.25})`;
      g.fillRect(x0 + h + p.rnd() * h, y0 + h + p.rnd() * h, 2, h * 0.2);
    }
  }

  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.flipY = false;
  map.anisotropy = 8;
  const emissive = new THREE.CanvasTexture(ecanvas);
  emissive.colorSpace = THREE.NoColorSpace;
  emissive.flipY = false;
  emissive.minFilter = THREE.LinearFilter;
  emissive.generateMipmaps = false;
  return { map, emissive, canvas, emissiveCanvas: ecanvas };
}

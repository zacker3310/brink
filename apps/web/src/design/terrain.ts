import { Texture } from 'pixi.js';
import type { Terrain } from '@brink/contracts';

// Ground as seen from a reconnaissance satellite: one seamless, repeating image per terrain type,
// mapped in world space so neighbouring hexes of the same ground read as one landscape. Field
// patchwork on the plains, canopy in the forests, relief on hills and ridges, street grids in
// towns. Generated once with Canvas 2D; no image assets.

/** World pixels per tile repeat. */
const TILE = 192;
/** Texture pixels per world pixel. */
const RES = 2;

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Ctx = CanvasRenderingContext2D;

/** Draw `fn` at every wrap offset so shapes crossing the tile edge continue on the other side. */
function wrapped(fn: (dx: number, dy: number) => void) {
  for (const dx of [-TILE, 0, TILE]) for (const dy of [-TILE, 0, TILE]) fn(dx, dy);
}

function speckle(c: Ctx, r: () => number, colors: string[], n: number, size: number, alpha: number) {
  c.globalAlpha = alpha;
  for (let i = 0; i < n; i++) {
    c.fillStyle = colors[i % colors.length]!;
    const s = size * (0.4 + r());
    c.fillRect(r() * TILE, r() * TILE, s, s);
  }
  c.globalAlpha = 1;
}

function blobs(c: Ctx, r: () => number, color: string, n: number, min: number, max: number, alpha: number) {
  c.fillStyle = color;
  c.globalAlpha = alpha;
  for (let i = 0; i < n; i++) {
    const x = r() * TILE;
    const y = r() * TILE;
    const rad = min + r() * (max - min);
    wrapped((dx, dy) => {
      c.beginPath();
      c.ellipse(x + dx, y + dy, rad, rad * (0.6 + r() * 0.4), r() * Math.PI, 0, Math.PI * 2);
      c.fill();
    });
  }
  c.globalAlpha = 1;
}

function plains(c: Ctx) {
  const r = rng(11);
  c.fillStyle = '#5f6a43';
  c.fillRect(0, 0, TILE, TILE);
  // Field patchwork: rotated parcels in harvest, pasture and fallow tones.
  const tones = ['#6b7448', '#78784c', '#56633d', '#83805a', '#62703f', '#6f6a45'];
  for (let i = 0; i < 70; i++) {
    const x = r() * TILE;
    const y = r() * TILE;
    const w = 9 + r() * 16;
    const h = 7 + r() * 11;
    const rot = (r() - 0.5) * 0.5;
    const tone = tones[Math.floor(r() * tones.length)]!;
    const rows = r() > 0.5;
    wrapped((dx, dy) => {
      c.save();
      c.translate(x + dx, y + dy);
      c.rotate(rot);
      c.fillStyle = tone;
      c.globalAlpha = 0.55;
      c.fillRect(-w / 2, -h / 2, w, h);
      if (rows) {
        c.strokeStyle = 'rgba(0,0,0,0.08)';
        c.lineWidth = 0.6;
        for (let k = -w / 2; k < w / 2; k += 2.2) {
          c.beginPath();
          c.moveTo(k, -h / 2);
          c.lineTo(k, h / 2);
          c.stroke();
        }
      }
      // Hedgerow.
      c.strokeStyle = 'rgba(35,48,28,0.55)';
      c.lineWidth = 0.9;
      c.strokeRect(-w / 2, -h / 2, w, h);
      c.restore();
    });
  }
  c.globalAlpha = 1;
  blobs(c, r, '#3d4c2c', 18, 1.5, 3.5, 0.7);
  speckle(c, r, ['#4f5a36', '#8a8660'], 900, 1.2, 0.35);
}

function forest(c: Ctx) {
  const r = rng(23);
  c.fillStyle = '#2b3a23';
  c.fillRect(0, 0, TILE, TILE);
  // Canopy: crowns with a sunlit north-west side and shadow to the south-east.
  for (let i = 0; i < 520; i++) {
    const x = r() * TILE;
    const y = r() * TILE;
    const rad = 2.4 + r() * 3.2;
    const g = 50 + Math.floor(r() * 30);
    wrapped((dx, dy) => {
      if (x + dx < -8 || x + dx > TILE + 8 || y + dy < -8 || y + dy > TILE + 8) return;
      c.fillStyle = 'rgba(8,14,6,0.45)';
      c.beginPath();
      c.arc(x + dx + 1.2, y + dy + 1.4, rad, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = `rgb(${g - 18},${g + 12},${g - 26})`;
      c.beginPath();
      c.arc(x + dx, y + dy, rad, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = 'rgba(160,190,110,0.18)';
      c.beginPath();
      c.arc(x + dx - rad * 0.35, y + dy - rad * 0.35, rad * 0.45, 0, Math.PI * 2);
      c.fill();
    });
  }
}

function hills(c: Ctx) {
  const r = rng(37);
  c.fillStyle = '#69663f';
  c.fillRect(0, 0, TILE, TILE);
  // Rolling ground: contour lines around low rises, scrub on the slopes.
  c.strokeStyle = 'rgba(40,36,20,0.28)';
  c.lineWidth = 0.7;
  for (let i = 0; i < 9; i++) {
    const x = r() * TILE;
    const y = r() * TILE;
    const base = 6 + r() * 6;
    const rot = r() * Math.PI;
    wrapped((dx, dy) => {
      for (let k = 0; k < 4; k++) {
        c.beginPath();
        c.ellipse(x + dx, y + dy, base + k * 5, (base + k * 5) * 0.62, rot, 0, Math.PI * 2);
        c.stroke();
      }
      c.fillStyle = 'rgba(200,190,140,0.12)';
      c.beginPath();
      c.ellipse(x + dx - 2, y + dy - 2, base, base * 0.62, rot, 0, Math.PI * 2);
      c.fill();
    });
  }
  blobs(c, r, '#3d4a2a', 90, 1.2, 3, 0.6);
  blobs(c, r, '#827a52', 40, 2, 5, 0.25);
  speckle(c, r, ['#58553a', '#8d8662'], 900, 1.2, 0.35);
}

function mountains(c: Ctx) {
  const r = rng(41);
  c.fillStyle = '#6a655c';
  c.fillRect(0, 0, TILE, TILE);
  // Ridgelines: sharp lit faces and dark gullies, snow on the crests.
  for (let i = 0; i < 60; i++) {
    const x = r() * TILE;
    const y = r() * TILE;
    const len = 12 + r() * 22;
    const ang = -0.6 + (r() - 0.5) * 0.8;
    const w = 3 + r() * 5;
    const snow = r() > 0.55;
    wrapped((dx, dy) => {
      c.save();
      c.translate(x + dx, y + dy);
      c.rotate(ang);
      c.fillStyle = 'rgba(205,198,185,0.55)';
      c.beginPath();
      c.moveTo(-len / 2, 0);
      c.lineTo(0, -w);
      c.lineTo(len / 2, 0);
      c.closePath();
      c.fill();
      c.fillStyle = 'rgba(30,27,24,0.55)';
      c.beginPath();
      c.moveTo(-len / 2, 0);
      c.lineTo(0, w * 0.9);
      c.lineTo(len / 2, 0);
      c.closePath();
      c.fill();
      if (snow) {
        c.fillStyle = 'rgba(240,240,236,0.85)';
        c.beginPath();
        c.moveTo(-len * 0.12, -w * 0.3);
        c.lineTo(0, -w * 0.95);
        c.lineTo(len * 0.14, -w * 0.25);
        c.closePath();
        c.fill();
      }
      c.restore();
    });
  }
  speckle(c, r, ['#4d4943', '#9a9384'], 900, 1.2, 0.4);
}

function urban(c: Ctx) {
  const r = rng(53);
  c.fillStyle = '#4d4f4c';
  c.fillRect(0, 0, TILE, TILE);
  // Street grid with blocks of roofs; each roof casts a short shadow.
  const step = 24;
  for (let bx = 0; bx < TILE; bx += step) {
    for (let by = 0; by < TILE; by += step) {
      for (let i = 0; i < 4; i++) {
        const w = 5 + r() * 7;
        const h = 5 + r() * 7;
        const x = bx + 3 + r() * (step - w - 6);
        const y = by + 3 + r() * (step - h - 6);
        const tone = 110 + Math.floor(r() * 70);
        c.fillStyle = 'rgba(0,0,0,0.45)';
        c.fillRect(x + 1.5, y + 1.8, w, h);
        c.fillStyle = r() > 0.8 ? `rgb(${tone + 30},${tone - 20},${tone - 40})` : `rgb(${tone},${tone},${tone - 8})`;
        c.fillRect(x, y, w, h);
      }
    }
  }
  c.strokeStyle = 'rgba(25,25,24,0.9)';
  c.lineWidth = 2.2;
  for (let k = 0; k <= TILE; k += step) {
    c.beginPath();
    c.moveTo(k, 0);
    c.lineTo(k, TILE);
    c.moveTo(0, k);
    c.lineTo(TILE, k);
    c.stroke();
  }
  blobs(c, r, '#3c5030', 10, 2, 4, 0.7);
}

function water(c: Ctx) {
  const r = rng(67);
  const g = c.createLinearGradient(0, 0, TILE, TILE);
  g.addColorStop(0, '#1d3a4a');
  g.addColorStop(0.5, '#1a3443');
  g.addColorStop(1, '#1d3a4a');
  c.fillStyle = g;
  c.fillRect(0, 0, TILE, TILE);
  c.strokeStyle = 'rgba(160,200,215,0.07)';
  c.lineWidth = 0.8;
  for (let i = 0; i < 70; i++) {
    const x = r() * TILE;
    const y = r() * TILE;
    const len = 6 + r() * 12;
    c.beginPath();
    c.moveTo(x, y);
    c.quadraticCurveTo(x + len / 2, y - 1.5, x + len, y);
    c.stroke();
  }
}

const PAINT: Record<Terrain, (c: Ctx) => void> = { plains, forest, hills, mountains, urban, water };

const cache = new Map<Terrain, Texture>();

/** A repeating ground texture for `terrain`, to fill hexes with in global texture space. */
export function terrainTexture(terrain: Terrain): Texture {
  const hit = cache.get(terrain);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = TILE * RES;
  const c = canvas.getContext('2d')!;
  c.scale(RES, RES);
  PAINT[terrain](c);
  const t = Texture.from(canvas);
  t.source.style.addressMode = 'repeat';
  t.source.style.update?.();
  cache.set(terrain, t);
  return t;
}

/** World-to-texture mapping for global fills: one repeat every TILE world pixels. */
export const TERRAIN_TILE = TILE;

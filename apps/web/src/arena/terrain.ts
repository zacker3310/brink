import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ARENA_H, ARENA_W, BRIDGE, CRATE, idx, inside, TREE, WALL, WATER, type Level } from '@brink/arena';
import type { Terrain } from '@brink/contracts';
import { prop, type Library } from './assets';

// The battlefield, built from the level: a ground texture generated for the terrain (grass, dirt,
// rock, asphalt, with tyre tracks, craters and stones), trees, boulders, city blocks with lit
// windows, Hesco walls and shipping containers from real models, a river with moving water and
// concrete bridges. One cell is one world unit; cell (x, y) is centred on (x + 0.5, y + 0.5).

/** Cells of ground drawn beyond the field on each side. */
export const MARGIN = 6;
const PX = 48;

// --- Noise ---------------------------------------------------------------------------------------

function lattice(seed: number): Float32Array {
  const out = new Float32Array(256 * 256);
  let s = seed >>> 0 || 1;
  for (let i = 0; i < out.length; i++) {
    s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x297a2d39) >>> 0;
    out[i] = (s >>> 8) / 16777216;
  }
  return out;
}

function noise2(t: Float32Array, x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = t[(yi & 255) * 256 + (xi & 255)]!;
  const b = t[(yi & 255) * 256 + ((xi + 1) & 255)]!;
  const c = t[((yi + 1) & 255) * 256 + (xi & 255)]!;
  const d = t[((yi + 1) & 255) * 256 + ((xi + 1) & 255)]!;
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(t: Float32Array, x: number, y: number, octaves: number): number {
  let sum = 0;
  let amp = 0.5;
  let f = 1;
  for (let i = 0; i < octaves; i++) {
    sum += noise2(t, x * f + i * 17.3, y * f - i * 9.1) * amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return sum / (1 - Math.pow(0.5, octaves));
}

type RGB = [number, number, number];
const hexRgb = (h: string): RGB => [Number.parseInt(h.slice(1, 3), 16), Number.parseInt(h.slice(3, 5), 16), Number.parseInt(h.slice(5, 7), 16)];
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Ground palettes: two cover tones, bare earth, a dark accent, and stones. */
const PALETTE: Record<Terrain, { a: string; b: string; earth: string; dark: string; stone: string }> = {
  plains: { a: '#5d6a35', b: '#7a7b45', earth: '#6e5c43', dark: '#46512a', stone: '#8a857a' },
  forest: { a: '#3c4826', b: '#4d5630', earth: '#584833', dark: '#2e381e', stone: '#77736a' },
  hills: { a: '#77724a', b: '#8d8457', earth: '#7a6748', dark: '#5b5a38', stone: '#8c877d' },
  mountains: { a: '#6f6b63', b: '#858077', earth: '#6a5d4b', dark: '#4c4944', stone: '#a29d94' },
  urban: { a: '#3e3f41', b: '#4a4b4c', earth: '#5b5a55', dark: '#2f3032', stone: '#77766f' },
  water: { a: '#5d6a35', b: '#7a7b45', earth: '#6e5c43', dark: '#46512a', stone: '#8a857a' },
};

/** Distance in cells to the nearest cell of a kind, capped, for banks and sidewalks. */
function distanceField(level: Level, match: (c: number) => boolean, cap: number): Float32Array {
  const w = ARENA_W + MARGIN * 2;
  const h = ARENA_H + MARGIN * 2;
  const out = new Float32Array(w * h).fill(cap);
  for (let y = 0; y < ARENA_H; y++)
    for (let x = 0; x < ARENA_W; x++) {
      if (!match(level.cells[idx(x, y)]!)) continue;
      for (let dy = -cap; dy <= cap; dy++)
        for (let dx = -cap; dx <= cap; dx++) {
          const gx = x + MARGIN + dx;
          const gy = y + MARGIN + dy;
          if (gx < 0 || gy < 0 || gx >= w || gy >= h) continue;
          const d = Math.max(0, Math.hypot(dx, dy) - 0.5);
          if (d < out[gy * w + gx]!) out[gy * w + gx] = d;
        }
    }
  // Water runs off the edges of the field: carry its rows out into the margin.
  for (let y = 0; y < ARENA_H; y++) {
    const left = out[(y + MARGIN) * w + MARGIN]!;
    const right = out[(y + MARGIN) * w + MARGIN + ARENA_W - 1]!;
    for (let x = 0; x < MARGIN; x++) {
      out[(y + MARGIN) * w + x] = Math.min(out[(y + MARGIN) * w + x]!, left);
      out[(y + MARGIN) * w + w - 1 - x] = Math.min(out[(y + MARGIN) * w + w - 1 - x]!, right);
    }
  }
  return out;
}

function sampleField(f: Float32Array, x: number, y: number): number {
  const w = ARENA_W + MARGIN * 2;
  const h = ARENA_H + MARGIN * 2;
  const gx = Math.max(0, Math.min(w - 1.001, x + MARGIN - 0.5));
  const gy = Math.max(0, Math.min(h - 1.001, y + MARGIN - 0.5));
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const fx = gx - x0;
  const fy = gy - y0;
  const at = (xx: number, yy: number) => f[Math.min(h - 1, yy) * w + Math.min(w - 1, xx)]!;
  return at(x0, y0) * (1 - fx) * (1 - fy) + at(x0 + 1, y0) * fx * (1 - fy) + at(x0, y0 + 1) * (1 - fx) * fy + at(x0 + 1, y0 + 1) * fx * fy;
}

export interface Ground {
  map: THREE.CanvasTexture;
  bump: THREE.CanvasTexture;
}

/** Paint the ground for the whole field and its margin: colour and a matching bump map. */
export function paintGround(level: Level, seed: number): Ground {
  const t = lattice(seed);
  const pal = PALETTE[level.terrain] ?? PALETTE.plains;
  const A = hexRgb(pal.a);
  const B = hexRgb(pal.b);
  const E = hexRgb(pal.earth);
  const D = hexRgb(pal.dark);
  const S = hexRgb(pal.stone);
  const MUD = hexRgb('#4a4130');
  const BED = hexRgb('#2c3a34');
  const urban = level.terrain === 'urban' || level.cells.some((c, i) => c === WALL && level.style[i] === 'building');
  const water = distanceField(level, (c) => c === WATER, 3);
  // The large-scale colour and relief are worked out at a quarter of the final resolution and
  // scaled up; grain, stones and marks are then added at full resolution.
  const LOW = PX / 4;
  const lw = (ARENA_W + MARGIN * 2) * LOW;
  const lh = (ARENA_H + MARGIN * 2) * LOW;
  const lowC = document.createElement('canvas');
  lowC.width = lw;
  lowC.height = lh;
  const lowB = document.createElement('canvas');
  lowB.width = lw;
  lowB.height = lh;
  const img = lowC.getContext('2d')!.createImageData(lw, lh);
  const bimg = lowB.getContext('2d')!.createImageData(lw, lh);
  const px = img.data;
  const bp = bimg.data;
  for (let j = 0; j < lh; j++) {
    const y = j / LOW - MARGIN;
    for (let i = 0; i < lw; i++) {
      const x = i / LOW - MARGIN;
      const big = fbm(t, x * 0.32, y * 0.32, 4);
      const mid = fbm(t, x * 1.9 + 40, y * 1.9 - 20, 3);
      const fine = noise2(t, x * 9 + 7, y * 9 + 3);
      let c: RGB;
      let height = big * 0.4 + mid * 0.35 + fine * 0.25;
      if (urban) {
        // Asphalt, patched and stained.
        c = mix(A, B, smooth(0.35, 0.7, big));
        c = mix(c, D, smooth(0.62, 0.8, mid) * 0.5);
        c = mix(c, E, smooth(0.8, 0.95, fine) * 0.25);
      } else {
        c = mix(A, B, smooth(0.3, 0.72, big));
        c = mix(c, D, smooth(0.55, 0.85, mid) * 0.55);
        const bare = smooth(0.58, 0.78, fbm(t, x * 0.8 - 11, y * 0.8 + 5, 3));
        c = mix(c, E, bare * 0.85);
        height -= bare * 0.1;
        if (level.terrain === 'mountains') {
          const snow = smooth(0.7, 0.78, fbm(t, x * 0.5 + 3, y * 0.5 + 9, 4));
          c = mix(c, hexRgb('#dfe3e6'), snow * 0.85);
        }
        // Stones.
        if (fine > 0.84 && mid > 0.48) {
          c = mix(c, S, 0.75);
          height += 0.35;
        }
      }
      // River banks: mud, then the dark bed under the water.
      const dw = sampleField(water, x, y);
      if (dw < 1.6) c = mix(c, MUD, smooth(1.6, 0.4, dw) * 0.85);
      if (dw < 0.25) c = mix(c, BED, 0.9);
      // Outside the field the ground falls into shade, so the board reads.
      const out = Math.max(0, -x, x - ARENA_W, -y, y - ARENA_H);
      const shade = 1 - Math.min(0.42, out * 0.09);
      const k = (j * lw + i) * 4;
      px[k] = c[0] * shade;
      px[k + 1] = c[1] * shade;
      px[k + 2] = c[2] * shade;
      px[k + 3] = 255;
      bp[k] = bp[k + 1] = bp[k + 2] = Math.max(0, Math.min(255, height * 200));
      bp[k + 3] = 255;
    }
  }
  lowC.getContext('2d')!.putImageData(img, 0, 0);
  lowB.getContext('2d')!.putImageData(bimg, 0, 0);
  const W = lw * 4;
  const H = lh * 4;
  const color = document.createElement('canvas');
  color.width = W;
  color.height = H;
  const bump = document.createElement('canvas');
  bump.width = W;
  bump.height = H;
  const cx = color.getContext('2d')!;
  const bx = bump.getContext('2d')!;
  cx.imageSmoothingQuality = 'high';
  bx.imageSmoothingQuality = 'high';
  cx.drawImage(lowC, 0, 0, W, H);
  bx.drawImage(lowB, 0, 0, W, H);
  // Grain: a tile of per-pixel noise laid over everything.
  const tile = document.createElement('canvas');
  tile.width = tile.height = 128;
  const tg = tile.getContext('2d')!;
  const timg = tg.createImageData(128, 128);
  let r = seed >>> 0 || 7;
  for (let k = 0; k < timg.data.length; k += 4) {
    r = (Math.imul(r, 1103515245) + 12345) >>> 0;
    const v = 128 + (((r >>> 16) & 255) - 128) * 0.55;
    timg.data[k] = timg.data[k + 1] = timg.data[k + 2] = v;
    timg.data[k + 3] = 255;
  }
  tg.putImageData(timg, 0, 0);
  for (const g of [cx, bx]) {
    g.globalCompositeOperation = 'overlay';
    g.globalAlpha = g === cx ? 0.35 : 0.6;
    g.fillStyle = g.createPattern(tile, 'repeat')!;
    g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
  }
  // City pavements: concrete slabs round every building.
  if (urban) {
    for (let y = 0; y < ARENA_H; y++)
      for (let x = 0; x < ARENA_W; x++) {
        const i = idx(x, y);
        if (level.cells[i] !== WALL || level.style[i] !== 'building') continue;
        const [sx, sy] = [(x + MARGIN - 0.3) * PX, (y + MARGIN - 0.3) * PX];
        cx.fillStyle = '#6f6d67';
        cx.fillRect(sx, sy, PX * 1.6, PX * 1.6);
        cx.strokeStyle = 'rgba(30,30,30,0.35)';
        cx.lineWidth = 1;
        for (let k = 0; k <= 6; k++) {
          cx.beginPath();
          cx.moveTo(sx + (k * PX * 1.6) / 6, sy);
          cx.lineTo(sx + (k * PX * 1.6) / 6, sy + PX * 1.6);
          cx.moveTo(sx, sy + (k * PX * 1.6) / 6);
          cx.lineTo(sx + PX * 1.6, sy + (k * PX * 1.6) / 6);
          cx.stroke();
        }
      }
  }

  // Scars of earlier fighting: tyre tracks and craters (not in the city).
  const rnd = mulberry(seed ^ 0x51ed);
  const at = (x: number, y: number) => [(x + MARGIN) * PX, (y + MARGIN) * PX] as const;
  if (!urban) {
    cx.lineCap = 'round';
    for (let n = 0; n < 5; n++) {
      const x0 = rnd() * ARENA_W;
      const len = 6 + rnd() * 12;
      const bend = (rnd() - 0.5) * 6;
      for (const side of [-0.16, 0.16]) {
        cx.beginPath();
        const [ax, ay] = at(x0 + side, ARENA_H + 2);
        const [qx, qy] = at(x0 + bend + side, ARENA_H - len / 2);
        const [ex, ey] = at(x0 + bend * 0.4 + side, ARENA_H - len);
        cx.moveTo(ax, ay);
        cx.quadraticCurveTo(qx, qy, ex, ey);
        cx.strokeStyle = 'rgba(40,32,22,0.28)';
        cx.lineWidth = PX * 0.11;
        cx.stroke();
      }
    }
  }
  for (let n = 0; n < (urban ? 4 : 9); n++) {
    const [x, y] = at(rnd() * ARENA_W, rnd() * ARENA_H);
    const r = PX * (0.25 + rnd() * 0.4);
    const grad = cx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(18,15,12,0.75)');
    grad.addColorStop(0.65, 'rgba(40,33,25,0.45)');
    grad.addColorStop(0.85, 'rgba(120,105,85,0.25)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    cx.fillStyle = grad;
    cx.beginPath();
    cx.arc(x, y, r, 0, Math.PI * 2);
    cx.fill();
    const bg = bx.createRadialGradient(x, y, 0, x, y, r);
    bg.addColorStop(0, 'rgba(0,0,0,0.8)');
    bg.addColorStop(0.8, 'rgba(255,255,255,0.35)');
    bg.addColorStop(1, 'rgba(0,0,0,0)');
    bx.fillStyle = bg;
    bx.beginPath();
    bx.arc(x, y, r, 0, Math.PI * 2);
    bx.fill();
  }
  const map = new THREE.CanvasTexture(color);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  const bumpTex = new THREE.CanvasTexture(bump);
  return { map, bump: bumpTex };
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- Vegetation and rock -------------------------------------------------------------------------

/** A noisy blob: an icosphere pushed in and out, coloured darker underneath. */
function blob(radius: number, detail: number, wobble: number, rnd: () => number, base: THREE.Color, under: THREE.Color, sx = 1, sy = 1, sz = 1): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(radius, detail);
  const pos = g.attributes.position!;
  const colors = new Float32Array(pos.count * 3);
  const t = lattice(Math.floor(rnd() * 1e9));
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(pos, i);
    const n = noise2(t, v.x * 9 + 50, v.y * 9 + v.z * 7 + 50);
    v.multiplyScalar(1 + (n - 0.5) * wobble);
    v.set(v.x * sx, v.y * sy, v.z * sz);
    pos.setXYZ(i, v.x, v.y, v.z);
    const h = (v.y / (radius * sy) + 1) / 2;
    c.copy(under).lerp(base, Math.min(1, h * 1.2)).multiplyScalar(0.85 + n * 0.3);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  // Duplicated seam vertices moved apart: recompute normals from the new shape.
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
}

function broadleaf(rnd: () => number): { crown: THREE.BufferGeometry; trunk: THREE.BufferGeometry } {
  const parts: THREE.BufferGeometry[] = [];
  const base = new THREE.Color().setHSL(0.2 + rnd() * 0.07, 0.42, 0.2 + rnd() * 0.05, THREE.SRGBColorSpace);
  const under = base.clone().multiplyScalar(0.45);
  for (let i = 0; i < 6; i++) {
    const r = 0.14 + rnd() * 0.1;
    const g = blob(r, 1, 0.5, rnd, base, under);
    g.translate((rnd() - 0.5) * 0.28, 0.5 + rnd() * 0.25, (rnd() - 0.5) * 0.28);
    parts.push(g);
  }
  const trunk = new THREE.CylinderGeometry(0.025, 0.04, 0.5, 6);
  trunk.translate(0, 0.25, 0);
  return { crown: mergeGeometries(parts)!, trunk };
}

function conifer(rnd: () => number): { crown: THREE.BufferGeometry; trunk: THREE.BufferGeometry } {
  const parts: THREE.BufferGeometry[] = [];
  const base = new THREE.Color().setHSL(0.3 + rnd() * 0.05, 0.38, 0.14 + rnd() * 0.04, THREE.SRGBColorSpace);
  const under = base.clone().multiplyScalar(0.5);
  const tiers = 4;
  for (let i = 0; i < tiers; i++) {
    const r = 0.26 - i * 0.05;
    const g = new THREE.ConeGeometry(r, 0.34, 9, 2);
    const pos = g.attributes.position!;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let k = 0; k < pos.count; k++) {
      const jitter = 1 + (rnd() - 0.5) * 0.3;
      pos.setX(k, pos.getX(k) * jitter);
      pos.setZ(k, pos.getZ(k) * jitter);
      c.copy(under).lerp(base, (pos.getY(k) + 0.17) / 0.34).multiplyScalar(0.85 + rnd() * 0.3);
      colors.set([c.r, c.g, c.b], k * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.computeVertexNormals();
    g.translate(0, 0.3 + i * 0.17, 0);
    parts.push(g);
  }
  const trunk = new THREE.CylinderGeometry(0.02, 0.035, 0.4, 6);
  trunk.translate(0, 0.2, 0);
  return { crown: mergeGeometries(parts)!, trunk };
}

function boulder(rnd: () => number): THREE.BufferGeometry {
  const base = new THREE.Color().setHSL(0.08, 0.06, 0.42 + rnd() * 0.08, THREE.SRGBColorSpace);
  const g = blob(0.42, 2, 0.55, rnd, base, base.clone().multiplyScalar(0.55), 1, 0.75 + rnd() * 0.3, 1);
  g.translate(0, 0.22, 0);
  return g.toNonIndexed();
}

/** Instances of a few shared shapes, each removable later by cell (a tree knocked down). */
class Forest {
  readonly group = new THREE.Group();
  private readonly byCell = new Map<number, { mesh: THREE.InstancedMesh; i: number }[]>();
  constructor(
    private readonly shapes: { geo: THREE.BufferGeometry; mat: THREE.Material }[][],
    placements: { cell: number; shape: number; m: THREE.Matrix4; tint?: THREE.Color }[],
    shadows = true,
  ) {
    shapes.forEach((parts, s) => {
      const mine = placements.filter((p) => p.shape === s);
      if (!mine.length) return;
      for (const part of parts) {
        const mesh = new THREE.InstancedMesh(part.geo, part.mat, mine.length);
        mesh.castShadow = shadows;
        mesh.receiveShadow = true;
        mine.forEach((p, i) => {
          mesh.setMatrixAt(i, p.m);
          if (p.tint) mesh.setColorAt(i, p.tint);
          const list = this.byCell.get(p.cell) ?? [];
          list.push({ mesh, i });
          this.byCell.set(p.cell, list);
        });
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
        this.group.add(mesh);
      }
    });
  }

  remove(cell: number): boolean {
    const list = this.byCell.get(cell);
    if (!list) return false;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (const { mesh, i } of list) {
      mesh.setMatrixAt(i, zero);
      mesh.instanceMatrix.needsUpdate = true;
    }
    this.byCell.delete(cell);
    return true;
  }
}

/** Instanced copies of a model's meshes, one set per placement. */
function instanced(model: THREE.Object3D, placements: { cell: number; m: THREE.Matrix4; tint?: THREE.Color }[]): Forest {
  model.updateMatrixWorld(true);
  const parts: { geo: THREE.BufferGeometry; mat: THREE.Material; local: THREE.Matrix4 }[] = [];
  model.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) parts.push({ geo: mesh.geometry, mat: mesh.material as THREE.Material, local: mesh.matrixWorld.clone() });
  });
  const shapes = [parts.map((p) => ({ geo: p.geo.clone().applyMatrix4(p.local), mat: p.mat }))];
  return new Forest(shapes, placements.map((p) => ({ ...p, shape: 0 })));
}

/** Grass blades on a transparent card. */
function grassTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d')!;
  for (let i = 0; i < 26; i++) {
    const x = 6 + Math.random() * 52;
    const h = 24 + Math.random() * 38;
    const lean = (Math.random() - 0.5) * 18;
    const v = 150 + Math.floor(Math.random() * 90);
    g.strokeStyle = `rgb(${v},${v},${Math.floor(v * 0.75)})`;
    g.lineWidth = 1.5 + Math.random() * 1.5;
    g.beginPath();
    g.moveTo(x, 64);
    g.quadraticCurveTo(x + lean * 0.3, 64 - h * 0.6, x + lean, 64 - h);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Two crossed cards, about a metre wide and most of one tall. */
function grassTuft(): THREE.BufferGeometry {
  const a = new THREE.PlaneGeometry(0.16, 0.1);
  a.translate(0, 0.05, 0);
  const b = a.clone().rotateY(Math.PI / 2);
  return mergeGeometries([a, b])!;
}

// --- Buildings -----------------------------------------------------------------------------------

function facadeTexture(rnd: () => number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d')!;
  const tones = ['#8b877e', '#9c968a', '#7e7a72', '#a59b8a', '#6f706d', '#8d8173'];
  const wall = tones[Math.floor(rnd() * tones.length)]!;
  g.fillStyle = wall;
  g.fillRect(0, 0, 128, 128);
  // Weathering streaks.
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(0,0,0,${0.03 + rnd() * 0.05})`;
    g.fillRect(rnd() * 128, rnd() * 128, 1 + rnd() * 3, 10 + rnd() * 40);
  }
  // One storey: a band and two windows.
  g.fillStyle = 'rgba(0,0,0,0.18)';
  g.fillRect(0, 118, 128, 10);
  for (const x of [16, 72]) {
    const lit = rnd() < 0.18;
    g.fillStyle = '#1b2026';
    g.fillRect(x - 2, 30, 44, 64);
    const glass = g.createLinearGradient(x, 32, x + 40, 92);
    glass.addColorStop(0, lit ? '#d9b46a' : '#4b5d6b');
    glass.addColorStop(1, lit ? '#8a6a35' : '#1e2a33');
    g.fillStyle = glass;
    g.fillRect(x, 32, 40, 60);
    g.fillStyle = 'rgba(30,30,30,0.9)';
    g.fillRect(x + 19, 32, 2, 60);
    g.fillRect(x, 60, 40, 2);
    if (rnd() < 0.2) {
      // A blown-out window.
      g.fillStyle = '#0c0d0e';
      g.fillRect(x, 32, 40, 60);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

function roofTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#3d3c3a';
  g.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 500; i++) {
    const v = 40 + Math.floor(Math.random() * 50);
    g.fillStyle = `rgb(${v},${v},${v - 4})`;
    g.fillRect(Math.random() * 64, Math.random() * 64, 1.5, 1.5);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** Storeys are about three metres; a cell is about eight. */
const STOREY = 3.2 / 8;

function building(w: number, d: number, h: number, facade: THREE.Texture, roof: THREE.Material, rnd: () => number): THREE.Group {
  const g = new THREE.Group();
  const floors = Math.max(1, Math.round(h / STOREY));
  const side = (len: number) => {
    const t = facade.clone();
    t.needsUpdate = true;
    t.repeat.set(Math.max(1, Math.round(len * 2.2)), floors);
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.9, metalness: 0.02 });
  };
  const x = side(w);
  const z = side(d);
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, floors * STOREY, d), [z, z, roof, roof, x, x]);
  body.position.y = (floors * STOREY) / 2;
  g.add(body);
  // A parapet and rooftop plant.
  const lip = new THREE.MeshStandardMaterial({ color: 0x6a6760, roughness: 0.9 });
  const top = floors * STOREY;
  for (const [pw, pd, px, pz] of [
    [w, 0.04, 0, d / 2 - 0.02],
    [w, 0.04, 0, -d / 2 + 0.02],
    [0.04, d, w / 2 - 0.02, 0],
    [0.04, d, -w / 2 + 0.02, 0],
  ] as const) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(pw, 0.06, pd), lip);
    p.position.set(px, top + 0.03, pz);
    g.add(p);
  }
  for (let i = 0; i < 1 + Math.floor(rnd() * 3); i++) {
    const unit = new THREE.Mesh(new THREE.BoxGeometry(0.12 + rnd() * 0.15, 0.08 + rnd() * 0.08, 0.12 + rnd() * 0.15), new THREE.MeshStandardMaterial({ color: 0x8e8f8c, roughness: 0.6, metalness: 0.4 }));
    unit.position.set((rnd() - 0.5) * (w - 0.4), top + 0.06, (rnd() - 0.5) * (d - 0.4));
    g.add(unit);
  }
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return g;
}

// --- Water ---------------------------------------------------------------------------------------

function rippleNormals(): THREE.CanvasTexture {
  const n = 128;
  const t = lattice(99);
  const h = new Float32Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) h[y * n + x] = fbm(t, (x / n) * 8, (y / n) * 8, 3);
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d')!;
  const img = g.createImageData(n, n);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const dx = h[y * n + ((x + 1) % n)]! - h[y * n + ((x + n - 1) % n)]!;
      const dy = h[((y + 1) % n) * n + x]! - h[((y + n - 1) % n) * n + x]!;
      const v = new THREE.Vector3(-dx * 6, -dy * 6, 1).normalize();
      const k = (y * n + x) * 4;
      img.data[k] = (v.x * 0.5 + 0.5) * 255;
      img.data[k + 1] = (v.y * 0.5 + 0.5) * 255;
      img.data[k + 2] = (v.z * 0.5 + 0.5) * 255;
      img.data[k + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// --- The field -----------------------------------------------------------------------------------

export interface Field {
  group: THREE.Group;
  /** Knock down whatever stands in a cell (a tree or a container hit by a shell). */
  clear(x: number, y: number): void;
  update(t: number): void;
  dispose(): void;
}

export function buildField(level: Level, seed: number, lib: Library | null): Field {
  const group = new THREE.Group();
  const rnd = mulberry(seed ^ 0xa11ce);
  const ground = paintGround(level, seed);
  const gw = ARENA_W + MARGIN * 2;
  const gh = ARENA_H + MARGIN * 2;
  const groundMesh = new THREE.Mesh(new THREE.PlaneGeometry(gw, gh), new THREE.MeshStandardMaterial({ map: ground.map, bumpMap: ground.bump, bumpScale: 1.6, roughness: 0.96, metalness: 0 }));
  groundMesh.rotation.x = -Math.PI / 2;
  groundMesh.position.set(ARENA_W / 2, 0, ARENA_H / 2);
  groundMesh.receiveShadow = true;
  group.add(groundMesh);
  // Beyond the painted margin: plain dark ground into the haze.
  const pal = PALETTE[level.terrain] ?? PALETTE.plains;
  const far = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: new THREE.Color(pal.a).multiplyScalar(0.55), roughness: 1 }));
  far.rotation.x = -Math.PI / 2;
  far.position.set(ARENA_W / 2, -0.02, ARENA_H / 2);
  group.add(far);

  // The faint tactical grid over the field.
  const pts: number[] = [];
  for (let x = 0; x <= ARENA_W; x++) pts.push(x, 0.012, 0, x, 0.012, ARENA_H);
  for (let y = 0; y <= ARENA_H; y++) pts.push(0, 0.012, y, ARENA_W, 0.012, y);
  const gridGeo = new THREE.BufferGeometry();
  gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const grid = new THREE.LineSegments(gridGeo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.07, depthWrite: false }));
  group.add(grid);

  const cellM = (x: number, y: number, s: number, ry: number, ox = 0, oz = 0) => new THREE.Matrix4().compose(new THREE.Vector3(x + 0.5 + ox, 0, y + 0.5 + oz), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(s, s, s));

  // Trees: broadleaf in the lowlands, conifers up high, a mix in forest.
  const leafMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 });
  const barkMat = new THREE.MeshStandardMaterial({ color: 0x3b2f24, roughness: 1 });
  const variants = [broadleaf(rnd), broadleaf(rnd), broadleaf(rnd), conifer(rnd), conifer(rnd), conifer(rnd)];
  const shapes = variants.map((v) => [
    { geo: v.crown, mat: leafMat },
    { geo: v.trunk, mat: barkMat },
  ]);
  const treePlaces: { cell: number; shape: number; m: THREE.Matrix4 }[] = [];
  const coniferous = level.terrain === 'mountains' || level.terrain === 'hills' ? 0.8 : level.terrain === 'forest' ? 0.45 : 0.1;
  const tree = (cell: number, x: number, y: number, count: number) => {
    for (let k = 0; k < count; k++) {
      const shape = rnd() < coniferous ? 3 + Math.floor(rnd() * 3) : Math.floor(rnd() * 3);
      treePlaces.push({ cell, shape, m: cellM(x, y, 0.85 + rnd() * 0.5, rnd() * Math.PI * 2, (rnd() - 0.5) * 0.6, (rnd() - 0.5) * 0.6) });
    }
  };
  // Boulders for rock walls.
  const rocks = [boulder(rnd), boulder(rnd), boulder(rnd)];
  const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true });
  const rockPlaces: { cell: number; shape: number; m: THREE.Matrix4 }[] = [];
  const hescoPlaces: { cell: number; m: THREE.Matrix4; tint?: THREE.Color }[] = [];
  const crates: { cell: number; m: THREE.Matrix4; tint?: THREE.Color }[] = [];
  const buildingCells = new Set<number>();

  for (let y = 0; y < ARENA_H; y++)
    for (let x = 0; x < ARENA_W; x++) {
      const i = idx(x, y);
      const c = level.cells[i];
      const style = level.style[i];
      if (c === TREE) tree(i, x, y, 2 + Math.floor(rnd() * 2));
      else if (c === WALL && style === 'rock') {
        for (let k = 0; k < 2; k++) rockPlaces.push({ cell: i, shape: Math.floor(rnd() * 3), m: cellM(x, y, 0.8 + rnd() * 0.5, rnd() * 6, (rnd() - 0.5) * 0.3, (rnd() - 0.5) * 0.3) });
      } else if (c === WALL && (style === 'hesco' || style === 'sandbag')) {
        // A 3 x 3 block of Hesco baskets fills the cell.
        // Four Hesco baskets fill the cell.
        for (const a of [-1, 1]) for (const b of [-1, 1]) hescoPlaces.push({ cell: i, m: cellM(x, y, 1, (rnd() - 0.5) * 0.1, a * 0.235, b * 0.235), tint: new THREE.Color().setHSL(0.11, 0.32, 0.6 + rnd() * 0.08, THREE.SRGBColorSpace) });
      } else if (c === WALL) buildingCells.add(i);
      else if (c === CRATE) {
        // Shipping containers in the colours of the big lines.
        const paint = ['#9a3b2c', '#2f5a86', '#3f6b45', '#b9b4a8', '#c2862f', '#6a6f72'][Math.floor(rnd() * 6)]!;
        crates.push({ cell: i, m: cellM(x, y, 1, (rnd() < 0.5 ? 0 : Math.PI / 2) + (rnd() - 0.5) * 0.3), tint: new THREE.Color(paint).multiplyScalar(2.2) });
      }
    }

  // Ground cover: tufts of grass and low scrub everywhere it can grow.
  if (level.terrain !== 'urban') {
    const tufts: { cell: number; shape: number; m: THREE.Matrix4; tint: THREE.Color }[] = [];
    const scrub: { cell: number; shape: number; m: THREE.Matrix4 }[] = [];
    const green = new THREE.Color(pal.b);
    const many = level.terrain === 'mountains' ? 900 : 2200;
    for (let n = 0; n < many; n++) {
      const x = rnd() * (ARENA_W + 4) - 2;
      const y = rnd() * (ARENA_H + 4) - 2;
      const cx = Math.floor(x);
      const cy = Math.floor(y);
      if (inside(cx, cy)) {
        const c = level.cells[idx(cx, cy)];
        if (c === WALL || c === WATER || c === BRIDGE || c === CRATE) continue;
      }
      const m = new THREE.Matrix4().compose(new THREE.Vector3(x, 0, y), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * Math.PI), new THREE.Vector3().setScalar(0.7 + rnd() * 0.8));
      if (rnd() < 0.06) scrub.push({ cell: -1, shape: Math.floor(rnd() * 3), m });
      else tufts.push({ cell: -1, shape: 0, m, tint: green.clone().multiplyScalar(0.75 + rnd() * 0.6).lerp(new THREE.Color(pal.earth), rnd() * 0.4) });
    }
    group.add(new Forest([[{ geo: grassTuft(), mat: new THREE.MeshStandardMaterial({ map: grassTexture(), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 1 }) }]], tufts, false).group);
    const scrubMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
    const bushes = [0, 1, 2].map(() => {
      const base = new THREE.Color().setHSL(0.2 + rnd() * 0.06, 0.35, 0.18 + rnd() * 0.05, THREE.SRGBColorSpace);
      const g = blob(0.09, 1, 0.5, rnd, base, base.clone().multiplyScalar(0.5), 1.3, 0.7, 1.1);
      g.translate(0, 0.05, 0);
      return [{ geo: g, mat: scrubMat }];
    });
    group.add(new Forest(bushes, scrub).group);
  }

  // Scenery beyond the field: woods along the edges, never on the board itself.
  if (level.terrain !== 'urban') {
    for (let n = 0; n < 140; n++) {
      const side = Math.floor(rnd() * 4);
      const along = rnd();
      const depth = 0.8 + rnd() * (MARGIN - 1.5);
      const x = side === 0 ? -depth : side === 1 ? ARENA_W + depth - 1 : along * (ARENA_W + 2 * MARGIN) - MARGIN;
      const y = side === 2 ? -depth : side === 3 ? ARENA_H + depth - 1 : along * (ARENA_H + 2 * MARGIN) - MARGIN;
      if (side < 2 && (y < -MARGIN || y > ARENA_H + MARGIN - 1)) continue;
      // Keep the attackers' entry road clear.
      if (side === 3 && Math.abs(x - ARENA_W / 2) < 2.5) continue;
      if (level.cells[idx(Math.max(0, Math.min(ARENA_W - 1, Math.floor(x))), Math.max(0, Math.min(ARENA_H - 1, Math.floor(y))))] === WATER && rnd() < 0.8) continue;
      tree(-1, x, y, 1);
    }
  }
  const forest = new Forest(shapes, treePlaces);
  group.add(forest.group);
  const boulders = new Forest(
    rocks.map((geo) => [{ geo, mat: rockMat }]),
    rockPlaces,
  );
  group.add(boulders.group);

  const removable: Forest[] = [forest];
  if (lib) {
    if (hescoPlaces.length) {
      const h = instanced(prop(lib.hesco, 3.8), hescoPlaces);
      group.add(h.group);
    }
    if (crates.length) {
      const c = instanced(prop(lib.container, 6.6), crates);
      group.add(c.group);
      removable.push(c);
    }
    // A watch tower over an objective, off the board.
    if (level.zone && level.mode === 'capture' && level.terrain !== 'urban') {
      const t = prop(lib.tower, 10);
      t.position.set(-1.4, 0, 2.5);
      group.add(t);
    }
  } else {
    const hesco = new THREE.MeshStandardMaterial({ color: 0x8a7f5f, roughness: 0.95 });
    const boxGeo = new THREE.BoxGeometry(0.3, 0.32, 0.3);
    boxGeo.translate(0, 0.16, 0);
    if (hescoPlaces.length) group.add(new Forest([[{ geo: boxGeo, mat: hesco }]], hescoPlaces.map((p) => ({ ...p, shape: 0 }))).group);
    const crateGeo = new THREE.BoxGeometry(0.8, 0.33, 0.32);
    crateGeo.translate(0, 0.165, 0);
    const crate = new Forest([[{ geo: crateGeo, mat: new THREE.MeshStandardMaterial({ color: 0x7b3f2a, roughness: 0.7, metalness: 0.3 }) }]], crates.map((p) => ({ ...p, shape: 0 })));
    group.add(crate.group);
    removable.push(crate);
  }

  // City blocks: whole rectangles become one building, anything else a building per cell.
  const roof = new THREE.MeshStandardMaterial({ map: roofTexture(), roughness: 0.95 });
  const facades = [facadeTexture(rnd), facadeTexture(rnd), facadeTexture(rnd), facadeTexture(rnd)];
  const seen = new Set<number>();
  for (const start of [...buildingCells].sort((a, b) => a - b)) {
    if (seen.has(start)) continue;
    const comp: number[] = [];
    const q = [start];
    seen.add(start);
    while (q.length) {
      const c = q.pop()!;
      comp.push(c);
      const cx = c % ARENA_W;
      const cy = Math.floor(c / ARENA_W);
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (!inside(nx, ny)) continue;
        const ni = idx(nx, ny);
        if (buildingCells.has(ni) && !seen.has(ni)) {
          seen.add(ni);
          q.push(ni);
        }
      }
    }
    const xs = comp.map((c) => c % ARENA_W);
    const ys = comp.map((c) => Math.floor(c / ARENA_W));
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs);
    const y0 = Math.min(...ys);
    const y1 = Math.max(...ys);
    const height = comp.reduce((s, c) => s + level.height[c]!, 0) / comp.length;
    const facade = facades[Math.floor(rnd() * facades.length)]!;
    const blocks = comp.length === (x1 - x0 + 1) * (y1 - y0 + 1) ? [[x0, y0, x1 - x0 + 1, y1 - y0 + 1]] : comp.map((c) => [c % ARENA_W, Math.floor(c / ARENA_W), 1, 1]);
    for (const [bx, by, bw, bd] of blocks) {
      const b = building(bw! - 0.06, bd! - 0.06, 0.55 + height * 0.55, facade, roof, rnd);
      b.position.set(bx! + bw! / 2, 0, by! + bd! / 2);
      group.add(b);
    }
  }

  // Water and bridges.
  let water: THREE.Mesh | null = null;
  const ripple = rippleNormals();
  const waterCells: [number, number][] = [];
  for (let y = 0; y < ARENA_H; y++) for (let x = 0; x < ARENA_W; x++) if (level.cells[idx(x, y)] === WATER || level.cells[idx(x, y)] === BRIDGE) waterCells.push([x, y]);
  if (waterCells.length) {
    const quads: THREE.BufferGeometry[] = [];
    const rows = new Set(waterCells.map(([, y]) => y));
    for (const y of rows) {
      // The river runs on past the field's edges.
      const q = new THREE.PlaneGeometry(ARENA_W + MARGIN * 2, 1);
      q.rotateX(-Math.PI / 2);
      q.translate(ARENA_W / 2, 0, y + 0.5);
      quads.push(q);
    }
    ripple.repeat.set(6, 1);
    water = new THREE.Mesh(mergeGeometries(quads)!, new THREE.MeshStandardMaterial({ color: 0x1d3433, roughness: 0.06, metalness: 0.2, normalMap: ripple, normalScale: new THREE.Vector2(0.35, 0.35), transparent: true, opacity: 0.9, envMapIntensity: 1.4 }));
    water.position.y = 0.02;
    water.receiveShadow = true;
    group.add(water);
    const deck = new THREE.MeshStandardMaterial({ color: 0x84817a, roughness: 0.85 });
    const rail = new THREE.MeshStandardMaterial({ color: 0x5c5a55, roughness: 0.7, metalness: 0.4 });
    for (const [x, y] of waterCells) {
      if (level.cells[idx(x, y)] !== BRIDGE) continue;
      const d = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.1, 1.02), deck);
      d.position.set(x + 0.5, 0.0, y + 0.5);
      d.castShadow = d.receiveShadow = true;
      group.add(d);
      for (const side of [-1, 1]) {
        if (inside(x + side, y) && level.cells[idx(x + side, y)] === BRIDGE) continue;
        const r = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.1, 1.02), rail);
        r.position.set(x + 0.5 + side * 0.48, 0.1, y + 0.5);
        r.castShadow = true;
        group.add(r);
      }
    }
  }

  return {
    group,
    clear(x, y) {
      const i = idx(x, y);
      for (const f of removable) f.remove(i);
    },
    update(t) {
      if (water) {
        ripple.offset.set(t * 0.02, t * 0.035);
      }
    },
    dispose() {
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose?.();
      });
      ground.map.dispose();
      ground.bump.dispose();
    },
  };
}

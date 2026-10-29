import * as THREE from 'three';

// The one texture the effects use, made in code: a 2 x 2 atlas of billowing puffs. Each puff is a
// union of spheres roughened by noise, read as a height field, so a sprite can be lit like a volume.
//   R, G  the puff's surface normal (x, y), from the height field
//   B     turbulence: fine detail for smoke, and the burn pattern flames erode through
//   A     density

export const ATLAS_FRAMES = 4;
const FRAME = 192;
const SIZE = FRAME * 2;

// Value noise from a random lattice (a table lookup is far cheaper than hashing on a phone).
const GRID = 128;
let lattice: Float32Array | null = null;

function noise(x: number, y: number, seed: number): number {
  if (!lattice) {
    lattice = new Float32Array(GRID * GRID);
    let s = 0x2f6b1d;
    for (let i = 0; i < lattice.length; i++) {
      s = (Math.imul(s, 1664525) + 1013904223) | 0;
      lattice[i] = (s >>> 8) / 16777216;
    }
  }
  x += seed * 13.37;
  y += seed * 7.91;
  const fx0 = Math.floor(x);
  const fy0 = Math.floor(y);
  const fx = x - fx0;
  const fy = y - fy0;
  const ix = fx0 & (GRID - 1);
  const iy = fy0 & (GRID - 1);
  const ix1 = (ix + 1) & (GRID - 1);
  const iy1 = (iy + 1) & (GRID - 1);
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = lattice[iy * GRID + ix]!;
  const b = lattice[iy * GRID + ix1]!;
  const c = lattice[iy1 * GRID + ix]!;
  const d = lattice[iy1 * GRID + ix1]!;
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function fbm(x: number, y: number, seed: number, octaves: number): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += noise(x, y, seed + o * 17) * amp;
    norm += amp;
    x = x * 2.03 + 1.7;
    y = y * 2.03 - 0.9;
    amp *= 0.5;
  }
  return sum / norm;
}

interface Blob {
  x: number;
  y: number;
  r: number;
}

function blobs(seed: number, n: number): Blob[] {
  let s = seed * 9301 + 49297;
  const rnd = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  const out: Blob[] = [];
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 0.1 + rnd() * 0.1;
    const d = Math.sqrt(rnd()) * (0.42 - r);
    out.push({ x: Math.cos(a) * d, y: Math.sin(a) * d, r });
  }
  return out;
}

let cached: Uint8Array<ArrayBuffer> | null = null;

function build(): Uint8Array<ArrayBuffer> {
  const data = new Uint8Array(SIZE * SIZE * 4);
  const h = new Float32Array(FRAME * FRAME);
  const dn = new Float32Array(FRAME * FRAME);
  for (let f = 0; f < ATLAS_FRAMES; f++) {
    const wispy = f >= 2;
    const bl = blobs(f + 3, 11);
    const nb = bl.length;
    const bx = new Float32Array(bl.map((b) => b.x));
    const by = new Float32Array(bl.map((b) => b.y));
    const br2 = new Float32Array(bl.map((b) => 1 / (b.r * b.r)));
    const seed = 101 + f * 31;
    // The silhouette: a round puff whose rim noise breaks into wisps. The surface: a dome with
    // billows from a field of small blobs, so the lighting finds lumps without hard sphere edges.
    for (let j = 0; j < FRAME; j++) {
      for (let i = 0; i < FRAME; i++) {
        const u = (i + 0.5) / FRAME - 0.5;
        const v = (j + 0.5) / FRAME - 0.5;
        const k = j * FRAME + i;
        const r = Math.sqrt(u * u + v * v) / 0.47;
        if (r >= 1.25) {
          h[k] = 0;
          dn[k] = 0;
          continue;
        }
        const lump = fbm(u * 3.2 + f * 3, v * 3.2, seed, 3);
        const fine = fbm(u * 9 + 5, v * 9 - 3, seed + 7, 3);
        const edge = 1 - r + (lump - 0.5) * 0.7 + (fine - 0.5) * (wispy ? 0.45 : 0.25);
        let d = Math.min(1, Math.max(0, (edge - 0.04) / (wispy ? 0.6 : 0.45)));
        d = d * d * (3 - 2 * d);
        // Nothing may reach the quad's edge, or the sprite shows its square.
        const win = Math.min(1, Math.max(0, (1.06 - r) / 0.2));
        dn[k] = (wispy ? d * (0.55 + 0.45 * fine) : d) * win * win * (3 - 2 * win);
        let field = 0;
        for (let b = 0; b < nb; b++) {
          const dx = u - bx[b]!;
          const dy = v - by[b]!;
          const q = 1 - (dx * dx + dy * dy) * br2[b]!;
          if (q > 0) field += q * q;
        }
        // Both terms meet zero with a gentle slope, so no hard ring shows in the lighting.
        const dome = Math.max(0, 1 - (r * r) / 1.5625);
        h[k] = 0.3 * dome * (0.8 + 0.4 * lump) + 0.07 * (field / (1 + field));
      }
    }
    const ox = (f % 2) * FRAME;
    const oy = Math.floor(f / 2) * FRAME;
    const step = 2 / FRAME;
    for (let j = 0; j < FRAME; j++) {
      for (let i = 0; i < FRAME; i++) {
        const o = ((oy + j) * SIZE + ox + i) * 4;
        const k = j * FRAME + i;
        const dens = dn[k]!;
        if (dens <= 0) {
          data[o] = 128;
          data[o + 1] = 128;
          continue;
        }
        const l = h[j * FRAME + Math.max(0, i - 1)]!;
        const r = h[j * FRAME + Math.min(FRAME - 1, i + 1)]!;
        const d = h[Math.max(0, j - 1) * FRAME + i]!;
        const t = h[Math.min(FRAME - 1, j + 1) * FRAME + i]!;
        let nx = -(r - l) / step;
        let ny = -(t - d) / step;
        const len = Math.sqrt(nx * nx + ny * ny + 1);
        nx /= len;
        ny /= len;
        const u = (i + 0.5) / FRAME - 0.5;
        const v = (j + 0.5) / FRAME - 0.5;
        const turb = Math.min(1, Math.max(0, (fbm(u * 6 - 2, v * 6 + 4, seed + 13, 4) - 0.22) * 1.8));
        data[o] = Math.round((nx * 0.5 + 0.5) * 255);
        data[o + 1] = Math.round((ny * 0.5 + 0.5) * 255);
        data[o + 2] = Math.round(turb * 255);
        data[o + 3] = Math.round(dens * 255);
      }
    }
  }
  return data;
}

/** The puff atlas. The pixels are made once a page; each call wraps them in a new texture. */
export function puffAtlas(): THREE.DataTexture {
  cached ??= build();
  const tex = new THREE.DataTexture(cached, SIZE, SIZE, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.colorSpace = THREE.NoColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

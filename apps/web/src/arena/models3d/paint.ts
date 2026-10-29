import * as THREE from 'three';
import { METRE } from '../quality';

// Paint: camouflage, wear and grime generated on canvases at runtime (cached per scheme), and the
// paint shader that lays them on the models. The camouflage is projected three ways in the part's own
// frame (triplanar), so blotches keep their real size on every face without hand-made UVs; dust and
// mud rise from the ground up by each vertex's height; tints, roughness and metalness come per vertex.

export type Paint = 'us_tan' | 'nato_green' | 'ru_green' | 'ru_summer' | 'winter' | 'desert';
/** Paints plus the aircraft finishes, which ignore the ground camouflage. */
export type Scheme = Paint | 'helo_drab' | 'heli_black' | 'ru_heli_grey' | 'ru_heli_camo' | 'ru_heli_green' | 'drone_grey';

export function paintFor(faction: 'west' | 'east', arsenal: 'us' | 'europe' | 'russia' | 'legacy', biome: 'temperate' | 'steppe' | 'desert' | 'winter' | 'urban'): Paint {
  if (biome === 'winter') return 'winter';
  const west = arsenal === 'us' || arsenal === 'europe' || (faction === 'west' && arsenal !== 'russia' && arsenal !== 'legacy');
  if (west) {
    if (arsenal === 'us') return biome === 'temperate' ? 'nato_green' : 'us_tan';
    return biome === 'desert' ? 'desert' : 'nato_green';
  }
  if (biome === 'desert') return 'desert';
  if (arsenal === 'russia') return biome === 'urban' ? 'ru_green' : 'ru_summer';
  return 'ru_green';
}

interface SchemeDef {
  base: number;
  /** Blotch colours and their share of the surface, drawn in order. */
  blotches: { color: number; share: number; size: number; stretch?: number; band?: boolean }[];
  /** Brushed whitewash over the base (winter). */
  wash?: number;
  dust: number;
  /** Paint mottle strength. */
  mottle: number;
  /** How worn: chips and streaks. */
  wear: number;
  /** Lighter underside for aircraft. */
  belly?: number;
}

const SCHEMES: Record<Scheme, SchemeDef> = {
  us_tan: { base: 0xa8946f, blotches: [], dust: 0xa59373, mottle: 0.07, wear: 1 },
  nato_green: {
    base: 0x434b33,
    blotches: [
      { color: 0x4d3f30, share: 0.42, size: 1.1 },
      { color: 0x1f201c, share: 0.2, size: 0.8, stretch: 2 },
    ],
    dust: 0x7b6c56,
    mottle: 0.06,
    wear: 1,
  },
  ru_green: { base: 0x4d5634, blotches: [], dust: 0x786b53, mottle: 0.09, wear: 1.2 },
  ru_summer: {
    base: 0x4c5533,
    blotches: [
      { color: 0x958457, share: 0.32, size: 1.2, stretch: 1.8 },
      { color: 0x22231d, share: 0.13, size: 0.9, stretch: 2, band: true },
    ],
    dust: 0x7f7257,
    mottle: 0.08,
    wear: 1.2,
  },
  winter: { base: 0x4a5233, blotches: [], wash: 0xcfd0ca, dust: 0x6e675b, mottle: 0.05, wear: 1.4 },
  desert: { base: 0xb39d74, blotches: [{ color: 0xa18a64, share: 0.3, size: 1.5 }], dust: 0xb8a37d, mottle: 0.06, wear: 0.9 },
  helo_drab: { base: 0x363b30, blotches: [], dust: 0x5d574a, mottle: 0.05, wear: 0.5 },
  heli_black: { base: 0x1f2120, blotches: [], dust: 0x4e4a42, mottle: 0.04, wear: 0.4 },
  ru_heli_grey: { base: 0x434a48, blotches: [{ color: 0x363c3a, share: 0.25, size: 1.4 }], dust: 0x5a564c, mottle: 0.05, wear: 0.6 },
  ru_heli_camo: {
    base: 0x707672,
    blotches: [{ color: 0x474d4b, share: 0.42, size: 1.5 }],
    dust: 0x5a564c,
    mottle: 0.05,
    wear: 0.6,
  },
  ru_heli_green: {
    base: 0x4f5636,
    blotches: [{ color: 0x6e5c40, share: 0.4, size: 1.6 }],
    dust: 0x5f5848,
    mottle: 0.06,
    wear: 0.7,
  },
  drone_grey: { base: 0x8d918c, blotches: [], dust: 0x6a665c, mottle: 0.04, wear: 0.4 },
};

/** Metres of surface one tile of camouflage covers. */
const TILE_M = 8;
const SIZE = 512;

// --- Noise -------------------------------------------------------------------------------------------

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

/** Tileable fractal value noise over a square of `size`, values 0..1; `bx` x `by` cells at the base. */
function fbm(size: number, seed: number, base: number, octaves: number, by = base): Float32Array {
  const out = new Float32Array(size * size);
  const rnd = mulberry(seed);
  let amp = 1;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const cx = base << o;
    const cy = by << o;
    const lattice = new Float32Array(cx * cy);
    for (let i = 0; i < lattice.length; i++) lattice[i] = rnd();
    for (let y = 0; y < size; y++) {
      const fy = (y / size) * cy;
      const y0 = Math.floor(fy);
      const ty = fy - y0;
      const sy = ty * ty * (3 - 2 * ty);
      const r0 = (y0 % cy) * cx;
      const r1 = ((y0 + 1) % cy) * cx;
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * cx;
        const x0 = Math.floor(fx);
        const tx = fx - x0;
        const sx = tx * tx * (3 - 2 * tx);
        const c0 = x0 % cx;
        const c1 = (x0 + 1) % cx;
        const a = lattice[r0 + c0]! + (lattice[r0 + c1]! - lattice[r0 + c0]!) * sx;
        const b = lattice[r1 + c0]! + (lattice[r1 + c1]! - lattice[r1 + c0]!) * sx;
        out[y * size + x] = out[y * size + x]! + (a + (b - a) * sy) * amp;
      }
    }
    total += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] = out[i]! / total;
  return out;
}

let grimeNoise: Float32Array | null = null;
let blotchNoise: Float32Array | null = null;

function makeCanvas(w: number, h: number): { ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D; el: HTMLCanvasElement | OffscreenCanvas } {
  if (typeof document !== 'undefined') {
    const el = document.createElement('canvas');
    el.width = w;
    el.height = h;
    return { ctx: el.getContext('2d', { willReadFrequently: true })!, el };
  }
  const el = new OffscreenCanvas(w, h);
  return { ctx: el.getContext('2d', { willReadFrequently: true })!, el };
}

const css = (hex: number, a = 1) => `rgba(${(hex >> 16) & 255},${(hex >> 8) & 255},${hex & 255},${a})`;

function mix(a: number, b: number, t: number): number {
  const r = ((a >> 16) & 255) * (1 - t) + ((b >> 16) & 255) * t;
  const g = ((a >> 8) & 255) * (1 - t) + ((b >> 8) & 255) * t;
  const bl = (a & 255) * (1 - t) + (b & 255) * t;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
}

// --- Camouflage --------------------------------------------------------------------------------------

const camoCache = new Map<Scheme, THREE.DataTexture>();

/**
 * The scheme's tileable camouflage: colour in RGB, grime in alpha (the shader's dust and streak mask).
 */
export function camoTexture(scheme: Scheme): THREE.DataTexture {
  const hit = camoCache.get(scheme);
  if (hit) return hit;
  const def = SCHEMES[scheme];
  const rnd = mulberry(0x5eed + scheme.length * 977 + scheme.charCodeAt(0) * 31 + scheme.charCodeAt(3) * 7);
  grimeNoise ??= fbm(SIZE, 17, 4, 6);
  blotchNoise ??= fbm(SIZE, 91, 3, 5);
  const { ctx } = makeCanvas(SIZE, SIZE);
  ctx.fillStyle = css(def.base);
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Hard-edged patches from thresholded noise: organic interlocking shapes with exact coverage.
  if (def.blotches.length) {
    const img0 = ctx.getImageData(0, 0, SIZE, SIZE);
    def.blotches.forEach((b, k) => {
      const cells = Math.max(2, Math.round(TILE_M / (2.4 * b.size)));
      const n = fbm(SIZE, 300 + k * 71 + scheme.length * 13, Math.round(cells * (b.stretch ?? 1.5)), 5, cells);
      const sample = Float32Array.from({ length: 8192 }, (_, i) => n[(i * 32) % n.length]!).sort();
      const mid = sample[4096]!;
      const band = b.band === true;
      let cut: number;
      if (band) {
        const dev = Float32Array.from(sample, (v) => Math.abs(v - mid)).sort();
        cut = dev[Math.floor(b.share * dev.length)]!;
      } else cut = sample[Math.floor((1 - b.share) * sample.length)]!;
      const r = (b.color >> 16) & 255;
      const g = (b.color >> 8) & 255;
      const bl = b.color & 255;
      for (let i = 0; i < SIZE * SIZE; i++) {
        const v = n[i]!;
        if (band ? Math.abs(v - mid) < cut : v > cut) {
          img0.data[i * 4] = r;
          img0.data[i * 4 + 1] = g;
          img0.data[i * 4 + 2] = bl;
        }
      }
    });
    ctx.putImageData(img0, 0, 0);
  }

  // Whitewash: brushed strokes, thick in places and thin where the green shows through.
  if (def.wash !== undefined) {
    for (let i = 0; i < 1400; i++) {
      const x = rnd() * SIZE;
      const y = rnd() * SIZE;
      const len = 20 + rnd() * 90;
      const a = (rnd() - 0.5) * 0.9 + (rnd() < 0.5 ? 0 : Math.PI / 2);
      const w = 6 + rnd() * 18;
      ctx.strokeStyle = css(mix(def.wash, def.base, rnd() * 0.25), 0.25 + rnd() * 0.5);
      ctx.lineWidth = w;
      ctx.lineCap = 'round';
      for (const dx of [-SIZE, 0, SIZE])
        for (const dy of [-SIZE, 0, SIZE]) {
          ctx.beginPath();
          ctx.moveTo(x + dx, y + dy);
          ctx.lineTo(x + dx + Math.cos(a) * len, y + dy + Math.sin(a) * len);
          ctx.stroke();
        }
    }
  }

  // Rain streaks and grime runs.
  for (let i = 0; i < 260 * def.wear; i++) {
    const x = rnd() * SIZE;
    const y = rnd() * SIZE;
    const len = 10 + rnd() * 60;
    ctx.strokeStyle = css(0x1a1712, 0.04 + rnd() * 0.07);
    ctx.lineWidth = 1 + rnd() * 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rnd() - 0.5) * 3, y + len);
    ctx.stroke();
  }

  // Chips: worn paint (lighter) and bare or rusty steel (darker).
  for (let i = 0; i < 320 * def.wear; i++) {
    const x = rnd() * SIZE;
    const y = rnd() * SIZE;
    const s = 0.6 + rnd() * 1.8;
    const dark = rnd() < 0.55;
    ctx.fillStyle = dark ? css(rnd() < 0.5 ? 0x3b352c : 0x4f3b2a, 0.25 + rnd() * 0.3) : css(mix(def.base, 0xd8d0bc, 0.3), 0.25 + rnd() * 0.25);
    ctx.fillRect(x, y, s * (1 + rnd() * 2), s);
  }

  const img = ctx.getImageData(0, 0, SIZE, SIZE);
  const data = new Uint8Array(SIZE * SIZE * 4);
  for (let i = 0; i < SIZE * SIZE; i++) {
    // Large soft mottle: paint fades and the coat varies.
    const m = 1 + (blotchNoise[i]! - 0.5) * 2 * def.mottle + (grimeNoise[(i * 7) % (SIZE * SIZE)]! - 0.5) * def.mottle;
    data[i * 4] = Math.min(255, img.data[i * 4]! * m);
    data[i * 4 + 1] = Math.min(255, img.data[i * 4 + 1]! * m);
    data[i * 4 + 2] = Math.min(255, img.data[i * 4 + 2]! * m);
    data[i * 4 + 3] = Math.round(grimeNoise[i]! * 255);
  }
  const tex = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  camoCache.set(scheme, tex);
  return tex;
}

export function dustOf(scheme: Scheme): number {
  return SCHEMES[scheme].dust;
}

// --- Track links -------------------------------------------------------------------------------------

export type TrackKind = 'pads' | 'steel' | 'rubber';
const trackCache = new Map<string, THREE.CanvasTexture>();
/** Links drawn on one repeat of the track texture. */
export const LINKS_PER_REPEAT = 4;

/** Track links seen from outside: u across the track, v along it (four links a repeat). */
export function trackTexture(kind: TrackKind, scheme: Scheme): THREE.CanvasTexture {
  const key = `${kind}:${scheme}`;
  const hit = trackCache.get(key);
  if (hit) return hit;
  const w = 128;
  const h = 256;
  const { ctx, el } = makeCanvas(w, h);
  const rnd = mulberry(kind.length * 131 + scheme.length * 7);
  const lh = h / LINKS_PER_REPEAT;
  ctx.fillStyle = '#1c1b18';
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < LINKS_PER_REPEAT; i++) {
    const y = i * lh;
    if (kind === 'pads') {
      // Rubber pads either side of the centre guide, steel end connectors at the edges.
      ctx.fillStyle = '#2b2a27';
      ctx.fillRect(10, y + 4, 48, lh - 10);
      ctx.fillRect(70, y + 4, 48, lh - 10);
      ctx.fillStyle = '#4b4943';
      ctx.fillRect(0, y + lh * 0.3, 10, lh * 0.4);
      ctx.fillRect(118, y + lh * 0.3, 10, lh * 0.4);
      ctx.fillRect(58, y + lh * 0.25, 12, lh * 0.5);
      ctx.fillStyle = '#121110';
      ctx.fillRect(0, y + lh - 5, w, 5);
    } else if (kind === 'steel') {
      // Cast steel links with a raised grouser bar and lightening holes.
      ctx.fillStyle = '#4a4740';
      ctx.fillRect(2, y + 3, w - 4, lh - 7);
      ctx.fillStyle = '#6a665d';
      ctx.fillRect(4, y + lh * 0.38, w - 8, lh * 0.22);
      ctx.fillStyle = '#26241f';
      for (const x of [22, 52, 76, 106]) ctx.fillRect(x - 6, y + 9, 12, lh * 0.22);
      ctx.fillStyle = '#100f0d';
      ctx.fillRect(0, y + lh - 4, w, 4);
    } else {
      // Rubber band track: chevron lugs.
      ctx.fillStyle = '#262523';
      ctx.fillRect(0, y, w, lh);
      ctx.fillStyle = '#34322e';
      ctx.beginPath();
      ctx.moveTo(6, y + lh * 0.7);
      ctx.lineTo(64, y + lh * 0.3);
      ctx.lineTo(122, y + lh * 0.7);
      ctx.lineTo(122, y + lh * 0.9);
      ctx.lineTo(64, y + lh * 0.5);
      ctx.lineTo(6, y + lh * 0.9);
      ctx.fill();
    }
  }
  // Mud packed in from the edges and in the gaps.
  const dust = SCHEMES[scheme].dust;
  for (let i = 0; i < 380; i++) {
    const edge = rnd() < 0.6;
    const x = edge ? (rnd() < 0.5 ? rnd() * 22 : w - rnd() * 22) : rnd() * w;
    const y = rnd() * h;
    ctx.fillStyle = css(mix(dust, 0x2a241c, rnd() * 0.5), 0.25 + rnd() * 0.45);
    ctx.beginPath();
    ctx.arc(x, y, 1.5 + rnd() * 5, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(el as HTMLCanvasElement);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  trackCache.set(key, tex);
  return tex;
}

// --- Rotor blur --------------------------------------------------------------------------------------

let blurTex: THREE.CanvasTexture | null = null;

/** A spinning rotor seen as a disc: faint radial streaks, a denser band at the blade tips. */
export function rotorBlurTexture(): THREE.CanvasTexture {
  if (blurTex) return blurTex;
  const s = 256;
  const { ctx, el } = makeCanvas(s, s);
  const g = ctx.createRadialGradient(s / 2, s / 2, s * 0.04, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(30,30,28,0.0)');
  g.addColorStop(0.12, 'rgba(30,30,28,0.2)');
  g.addColorStop(0.8, 'rgba(36,36,34,0.13)');
  g.addColorStop(0.9, 'rgba(80,78,70,0.26)');
  g.addColorStop(0.97, 'rgba(40,40,36,0.08)');
  g.addColorStop(1, 'rgba(40,40,36,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const rnd = mulberry(7);
  for (let i = 0; i < 40; i++) {
    const r = s * (0.08 + rnd() * 0.4);
    ctx.strokeStyle = `rgba(20,20,18,${0.03 + rnd() * 0.05})`;
    ctx.lineWidth = 1 + rnd() * 3;
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  blurTex = new THREE.CanvasTexture(el as HTMLCanvasElement);
  blurTex.colorSpace = THREE.SRGBColorSpace;
  return blurTex;
}

// --- Materials ---------------------------------------------------------------------------------------

export interface PaintOpts {
  scheme: Scheme;
  /** Wheel angle source (the model's wheel proxy), read every frame. */
  spin?: THREE.Object3D;
  /** Road wheel radius in world units: other wheels turn faster by the ratio. */
  spinRef?: number;
  /** Height in metres the dust and mud reach. */
  dustTop?: number;
  /** 0 clean (aircraft) .. 1 hard used. */
  dust?: number;
}

const VERT_HEAD = /* glsl */ `
attribute vec4 tint;
attribute vec4 aux;
attribute vec4 hub;
uniform float spin;
uniform float spinRef;
varying vec4 vTint;
varying vec4 vAux;
varying vec3 vObjP;
varying vec3 vObjN;
`;

const FRAG_HEAD = /* glsl */ `
uniform sampler2D camoMap;
uniform float camoScale;
uniform vec3 dustColor;
uniform float dustTop;
uniform float dustAmount;
varying vec4 vTint;
varying vec4 vAux;
varying vec3 vObjP;
varying vec3 vObjN;
`;

/** The paint material: one per unit, so a hit flash or a wreck darkens only that unit. */
export function paintMaterial(o: PaintOpts): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0.12 });
  const def = SCHEMES[o.scheme];
  const proxy = o.spin;
  const uniforms: Record<string, THREE.IUniform> = {
    camoMap: { value: camoTexture(o.scheme) },
    camoScale: { value: 1 / (TILE_M * METRE) },
    dustColor: { value: new THREE.Color(def.dust) },
    dustTop: { value: o.dustTop ?? 1.1 },
    dustAmount: { value: o.dust ?? 0.85 },
    spin: proxy ? { get value() { return proxy.rotation.x; } } : { value: 0 },
    spinRef: { value: o.spinRef ?? 1 },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = VERT_HEAD + shader.vertexShader
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
        float wheelA = hub.x > 0.5 ? spin * spinRef / max(hub.w, 1e-4) : 0.0;
        float wc = cos(wheelA);
        float ws = sin(wheelA);
        objectNormal.yz = vec2(wc * objectNormal.y - ws * objectNormal.z, ws * objectNormal.y + wc * objectNormal.z);`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vec2 wd = transformed.yz - hub.yz;
        if (hub.x > 0.5) transformed.yz = hub.yz + vec2(wc * wd.x - ws * wd.y, ws * wd.x + wc * wd.y);
        vTint = tint;
        vAux = aux;
        vObjP = transformed;
        vObjN = objectNormal;`,
      );
    shader.fragmentShader = FRAG_HEAD + shader.fragmentShader
      .replace(
        '#include <map_fragment>',
        `vec3 tn = normalize(vObjN);
        vec3 tw = pow(abs(tn), vec3(4.0));
        tw /= (tw.x + tw.y + tw.z + 1e-5);
        vec3 tp = vObjP * camoScale;
        vec4 camo = texture2D(camoMap, tp.zy) * tw.x + texture2D(camoMap, tp.xz + 0.37) * tw.y + texture2D(camoMap, tp.xy + 0.71) * tw.z;
        float grime = camo.a;
        vec3 surf = mix(vTint.rgb, camo.rgb * vTint.rgb, vTint.a);
        float hgt = vAux.x * 5.0;
        float dust = smoothstep(dustTop, 0.0, hgt) * (0.35 + 1.0 * grime);
        dust += max(tn.y, 0.0) * 0.3 * smoothstep(0.4, 0.75, grime);
        dust = clamp(dust * dustAmount, 0.0, 0.92);
        surf = mix(surf, dustColor, dust);
        surf *= vAux.y * (0.92 + 0.16 * grime);
        diffuseColor.rgb *= surf;`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        if (vAux.z > 0.003) roughnessFactor = vAux.z;
        roughnessFactor = mix(roughnessFactor, 0.97, dust * 0.8);`,
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
        if (vAux.w > 0.003) metalnessFactor = vAux.w;
        metalnessFactor *= 1.0 - dust;`,
      );
  };
  mat.customProgramCacheKey = () => 'brink-paint-1';
  return mat;
}

/** Track material for one unit (its own texture offset, scrolled by the scene). */
export function trackMaterial(kind: TrackKind, scheme: Scheme): THREE.MeshStandardMaterial {
  const tex = trackTexture(kind, scheme).clone();
  tex.needsUpdate = true;
  return new THREE.MeshStandardMaterial({ map: tex, bumpMap: tex, bumpScale: 2.5, roughness: 0.78, metalness: kind === 'rubber' ? 0.05 : 0.45 });
}

/** The blur disc of a spinning rotor: invisible at rest, fades in with speed. */
export function blurMaterial(tint: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    map: rotorBlurTexture(),
    color: tint,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
    roughness: 0.7,
    metalness: 0,
  });
}

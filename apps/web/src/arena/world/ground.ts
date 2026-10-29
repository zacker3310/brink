import * as THREE from 'three';
import { BUILDING, RUBBLE, TREES, WALL, ROCK, type BattleMap, type Biome } from '@brink/arena/v2';
import { MARGIN, type Heightfield, type Layout } from './height';
import { clamp, css, fbm, hash, hex, lattice, mix, noise2, ridged, smooth, stream, wadi, type RGB } from './noise';

// The ground's paint. Three layers make it hold up from a drone at any height:
// - a macro colour map over the field and its margin (fields and crops, banks, verges, lots,
//   tracks, craters), painted per biome at a few pixels a cell;
// - a mask at the same scale saying what each spot is made of: soft cover (grass, dry grass,
//   sand, snow), rough ground (earth, gravel, mud) or hard surface (asphalt, concrete, rock);
// - a tileable detail texture with a pattern for each of those three, laid at two scales in world
//   space and mixed by the mask in the shader, which also lights its relief and wets it in rain.

/** Detail texture world size: one tile spans this many cells; a second sample is laid wider. */
const DETAIL_TILE = 2.4;
const DETAIL_WIDE = 9.7;

// --- Detail ------------------------------------------------------------------------------------

/** A tileable RGBA detail texture: R soft cover, G rough ground, B hard surface, A puddle shapes. */
export function detailTexture(biome: Biome, size: number, seed: number): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  const t = lattice(seed ^ 0xd37a11);
  const t2 = lattice(seed ^ 0x2b1);
  const rnd = stream(seed ^ 0x51);
  // Tile-relative coordinates: P lattice units across the tile so the sum tiles.
  const soft = new Float32Array(size * size);
  const rough = new Float32Array(size * size);
  const hard = new Float32Array(size * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const i = y * size + x;
      const grain = noise2(t, u * 128, v * 128, 128);
      const fine = noise2(t2, u * 64, v * 64, 64);
      const clump = fbm(t, u * 8, v * 8, 3, 8);
      let s: number;
      if (biome === 'desert') {
        // Wind ripples, warped, over fine sand.
        const warp = fbm(t2, u * 4, v * 4, 2, 4);
        const ripple = Math.sin((v * 22 + u * 3 + warp * 1.6) * Math.PI * 2);
        s = 0.5 + ripple * 0.09 + (grain - 0.5) * 0.24 + (clump - 0.5) * 0.2;
      } else if (biome === 'winter') {
        // Wind crust and soft drift lines; a rare glint.
        const warp = fbm(t2, u * 4, v * 4, 2, 4);
        const drift = Math.sin((v * 9 + warp * 2.2) * Math.PI * 2);
        s = 0.5 + drift * 0.07 + (fine - 0.5) * 0.16 + (clump - 0.5) * 0.14 + (grain > 0.9 ? 0.12 : 0);
      } else if (biome === 'steppe') {
        // Dry, wind-laid grass: streaks along one way.
        const streak = noise2(t2, u * 32, v * 128, 32);
        s = 0.5 + (streak - 0.5) * 0.42 + (grain - 0.5) * 0.24 + (clump - 0.5) * 0.3;
      } else {
        // Grass: blades and clumps with dark gaps.
        const blades = noise2(t2, u * 128, v * 64, 64);
        s = 0.5 + (blades - 0.5) * 0.36 + (grain - 0.5) * 0.3 + (clump - 0.5) * 0.34;
      }
      soft[i] = s;
      // Earth and gravel: clods, pebbles with light tops.
      const peb = noise2(t, u * 96 + 7, v * 96 + 3, 32);
      const pebble = smooth(0.66, 0.74, peb) * 0.3 - smooth(0.6, 0.66, peb) * smooth(0.74, 0.66, peb) * 0.18;
      rough[i] = 0.5 + (fbm(t2, u * 16, v * 16, 3, 16) - 0.5) * 0.45 + (grain - 0.5) * 0.25 + pebble;
      // Asphalt and concrete: speckle, cracks, patches.
      const crack = ridged(t, u * 12 + 3, v * 12 + 9, 16);
      hard[i] = 0.52 + (grain - 0.5) * 0.24 + (fine - 0.5) * 0.12 - smooth(0.93, 0.985, crack) * 0.3 + (clump - 0.5) * 0.12;
    }
  // Speckles of light grit on every surface.
  for (let n = 0; n < size * size * 0.01; n++) {
    const i = Math.floor(rnd() * size * size);
    rough[i] = rough[i]! + 0.18;
    hard[i] = hard[i]! + 0.12;
  }
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const k = i * 4;
      data[k] = clamp(soft[i]!) * 255;
      data[k + 1] = clamp(rough[i]!) * 255;
      data[k + 2] = clamp(hard[i]!) * 255;
      data[k + 3] = fbm(t2, (x / size) * 4 + 0.5, (y / size) * 4 + 0.5, 3, 4) * 255;
    }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

// --- Palettes ----------------------------------------------------------------------------------

interface Crop {
  base: string;
  alt: string;
  /** Soft, rough, hard weights. */
  mask: [number, number, number];
  /** Pass bands and tramlines. */
  bands: number;
  tram: number;
}

interface Palette {
  crops: Crop[];
  /** Field margins and verges. */
  verge: string;
  /** Dry crests. */
  crest: string;
  /** Damp hollows. */
  hollow: string;
  bare: string;
  mud: string;
  bed: string;
  wood: string;
  /** Hard standing round buildings. */
  yard: string;
  rock: string;
  /** Parcel size in cells. */
  parcel: number;
}

const PALETTES: Record<Biome, Palette> = {
  temperate: {
    crops: [
      { base: '#a39468', alt: '#8f8360', mask: [1, 0.25, 0], bands: 0.12, tram: 0.35 },
      { base: '#5d6a3b', alt: '#67723f', mask: [1, 0.1, 0], bands: 0.1, tram: 0.3 },
      { base: '#5a4937', alt: '#4b3d2f', mask: [0.1, 1, 0], bands: 0.22, tram: 0.15 },
      { base: '#6c7146', alt: '#7a7650', mask: [1, 0.3, 0], bands: 0.04, tram: 0 },
      { base: '#717a48', alt: '#5f6a3c', mask: [1, 0.15, 0], bands: 0.08, tram: 0.25 },
      { base: '#8b8159', alt: '#7a7152', mask: [1, 0.4, 0], bands: 0.15, tram: 0.3 },
    ],
    verge: '#636a3e',
    crest: '#8a8257',
    hollow: '#4f5a33',
    bare: '#6b5a44',
    mud: '#4e4434',
    bed: '#2f3530',
    wood: '#3d4027',
    yard: '#6c675c',
    rock: '#7f7a70',
    parcel: 5.5,
  },
  steppe: {
    crops: [
      { base: '#a39163', alt: '#97875c', mask: [1, 0.2, 0], bands: 0.06, tram: 0.25 },
      { base: '#3f362d', alt: '#342c25', mask: [0.05, 1, 0], bands: 0.25, tram: 0.1 },
      { base: '#5c5243', alt: '#4f463a', mask: [0.3, 1, 0], bands: 0.18, tram: 0.25 },
      { base: '#b09f72', alt: '#a39266', mask: [1, 0.25, 0], bands: 0.14, tram: 0.35 },
      { base: '#8e8559', alt: '#857c55', mask: [1, 0.2, 0], bands: 0.03, tram: 0 },
    ],
    verge: '#7d7652',
    crest: '#ab9d70',
    hollow: '#6a6b44',
    bare: '#4a4036',
    mud: '#3f382f',
    bed: '#2d302b',
    wood: '#4a4632',
    yard: '#6e685c',
    rock: '#827d72',
    parcel: 8,
  },
  desert: {
    crops: [
      { base: '#c1a57a', alt: '#b99e74', mask: [1, 0.2, 0], bands: 0, tram: 0 },
      { base: '#a48e6c', alt: '#97825f', mask: [0.25, 1, 0.1], bands: 0, tram: 0 },
      { base: '#cbb489', alt: '#bea67c', mask: [1, 0.1, 0], bands: 0, tram: 0 },
      { base: '#8f7c62', alt: '#857358', mask: [0.1, 0.6, 0.6], bands: 0, tram: 0 },
    ],
    verge: '#b49d76',
    crest: '#ccb58a',
    hollow: '#ae9670',
    bare: '#9c8566',
    mud: '#8b775c',
    bed: '#5a5444',
    wood: '#7b7150',
    yard: '#a49680',
    rock: '#8d7a63',
    parcel: 7,
  },
  winter: {
    crops: [
      { base: '#dfe4e7', alt: '#d3d9dd', mask: [1, 0.05, 0], bands: 0.05, tram: 0.25 },
      { base: '#d6dcdf', alt: '#c7cdd0', mask: [1, 0.15, 0], bands: 0.12, tram: 0.3 },
      { base: '#e4e8ea', alt: '#dce1e4', mask: [1, 0, 0], bands: 0.03, tram: 0 },
      { base: '#cfd4d5', alt: '#bfc4c4', mask: [1, 0.3, 0], bands: 0.2, tram: 0.2 },
    ],
    verge: '#c8cccb',
    crest: '#c9cdcd',
    hollow: '#e6eaec',
    bare: '#4c443a',
    mud: '#5a5248',
    bed: '#3b4246',
    wood: '#b9bebf',
    yard: '#a9acab',
    rock: '#7b7c7a',
    parcel: 6,
  },
  urban: {
    crops: [
      { base: '#5d6240', alt: '#666a46', mask: [1, 0.3, 0], bands: 0, tram: 0 },
      { base: '#6a5f4e', alt: '#5e5446', mask: [0.2, 1, 0.1], bands: 0, tram: 0 },
      { base: '#4c4c4a', alt: '#555451', mask: [0, 0.1, 1], bands: 0, tram: 0 },
      { base: '#77706a', alt: '#6c665f', mask: [0, 0.8, 0.5], bands: 0, tram: 0 },
      { base: '#6f6c66', alt: '#64625d', mask: [0, 0.2, 1], bands: 0, tram: 0 },
    ],
    verge: '#5f6342',
    crest: '#6f6d58',
    hollow: '#565c3c',
    bare: '#655949',
    mud: '#4d4436',
    bed: '#2c312d',
    wood: '#43452d',
    yard: '#6f6c66',
    rock: '#7a766e',
    parcel: 3.6,
  },
};

// --- Painting ----------------------------------------------------------------------------------

export interface Paint {
  /** Full-resolution colour canvas (also the source of runtime patches). */
  color: HTMLCanvasElement;
  mask: HTMLCanvasElement;
  /** Pixels per cell of the colour canvas. */
  px: number;
  /** The field's colour before marks, at `midPx` a cell (for tinting grass to the ground). */
  mid: Uint8ClampedArray;
  midPx: number;
  midW: number;
  midH: number;
}

/** A soft dark track: a pair of ruts along a curve. */
export interface Polyline {
  pts: { x: number; z: number }[];
  width: number;
  asphalt: boolean;
}

export function paintGround(map: BattleMap, layout: Layout, hf: Heightfield, roads: Polyline[], seed: number, maxSize: number, midPx: number): Paint {
  const biome = map.biome;
  const pal = PALETTES[biome] ?? PALETTES.temperate;
  const crops = pal.crops.map((c) => ({ ...c, b: hex(c.base), a: hex(c.alt) }));
  const ew = layout.ew;
  const eh = layout.eh;
  const px = Math.max(8, Math.floor(maxSize / Math.max(ew, eh)));
  const t = lattice(seed ^ 0x9a1);
  const t2 = lattice(seed ^ 0x77e);
  // Fields run along one way across the whole map, like a real land survey.
  const theta = (hash(seed, 3) - 0.5) * 0.9;
  const ca = Math.cos(theta);
  const sa = Math.sin(theta);
  const S = pal.parcel;

  const mw = ew * midPx;
  const mh = eh * midPx;
  const mid = document.createElement('canvas');
  mid.width = mw;
  mid.height = mh;
  const maskC = document.createElement('canvas');
  maskC.width = mw;
  maskC.height = mh;
  const img = mid.getContext('2d')!.createImageData(mw, mh);
  const mimg = maskC.getContext('2d')!.createImageData(mw, mh);
  const P = img.data;
  const Q = mimg.data;
  const VERGE = hex(pal.verge);
  const CREST = hex(pal.crest);
  const HOLLOW = hex(pal.hollow);
  const BARE = hex(pal.bare);
  const MUD = hex(pal.mud);
  const BED = hex(pal.bed);
  const WOOD = hex(pal.wood);
  const YARD = hex(pal.yard);
  const ROCKC = hex(pal.rock);
  const GARDEN = hex(biome === 'winter' ? '#d4d9da' : biome === 'desert' ? '#7a7448' : '#5a6237');
  const c: RGB = [0, 0, 0];
  const cellAt = (x: number, z: number) => {
    const cx = Math.floor(x);
    const cy = Math.floor(z);
    if (cx < 0 || cy < 0 || cx >= map.w || cy >= map.h) return -1;
    return map.cells[cy * map.w + cx]!;
  };
  for (let j = 0; j < mh; j++) {
    const z = (j + 0.5) / midPx - MARGIN;
    for (let i = 0; i < mw; i++) {
      const x = (i + 0.5) / midPx - MARGIN;
      // Parcels: a stretched Voronoi so fields are long and straight-edged.
      const rx = (x * ca + z * sa) / 1.9;
      const rz = -x * sa + z * ca;
      const gx = Math.floor(rx / S);
      const gz = Math.floor(rz / S);
      let d1 = 1e9;
      let d2 = 1e9;
      let site = 0;
      for (let oy = -1; oy <= 1; oy++)
        for (let ox = -1; ox <= 1; ox++) {
          const sx = gx + ox;
          const sz = gz + oy;
          const hx = (sx + 0.5 + (hash(seed, sx, sz, 1) - 0.5) * 0.85) * S;
          const hz = (sz + 0.5 + (hash(seed, sx, sz, 2) - 0.5) * 0.85) * S;
          const dx = rx - hx;
          const dz = rz - hz;
          const d = dx * dx + dz * dz;
          if (d < d1) {
            d2 = d1;
            d1 = d;
            site = sx * 7919 + sz * 104729;
          } else if (d < d2) d2 = d;
        }
      const edge = Math.sqrt(d2) - Math.sqrt(d1);
      const crop = crops[Math.floor(hash(seed, site, 5) * crops.length)]!;
      const across = hash(seed, site, 6) < 0.6;
      const along = across ? rx * 1.9 : rz;
      const big = fbm(t, x * 0.18, z * 0.18, 3);
      const midN = fbm(t2, x * 0.9, z * 0.9, 3);
      const fine = noise2(t, x * 4.1, z * 4.1);
      // Crop colour with pass bands and tramlines.
      mix(crop.b, crop.a, smooth(0.25, 0.75, midN), c);
      if (crop.bands > 0) {
        const band = Math.sin((along / 0.46) * Math.PI) * 0.5 + 0.5;
        const k = 1 - crop.bands * 0.7 * (band - 0.5);
        c[0] *= k;
        c[1] *= k;
        c[2] *= k;
      }
      if (crop.tram > 0) {
        const f = Math.abs((((along / 1.8) % 1) + 1) % 1 - 0.5);
        const line = smooth(0.06, 0.02, Math.abs(f - 0.04)) + smooth(0.06, 0.02, Math.abs(f - 0.0));
        const k = 1 - crop.tram * 0.5 * Math.min(1, line);
        c[0] *= k;
        c[1] *= k;
        c[2] *= k;
      }
      let ms = crop.mask[0];
      let mr = crop.mask[1];
      let mhd = crop.mask[2];
      // Field margins: grassy strips along the parcel edges.
      const vergeK = biome === 'urban' ? smooth(0.22, 0.05, edge) * 0.5 : smooth(0.32, 0.08, edge);
      if (vergeK > 0) {
        mix(c, VERGE, vergeK, c);
        ms = ms + (1 - ms) * vergeK;
        mr *= 1 - vergeK * 0.5;
      }
      // Lie of the land: dry crests, damp hollows, bare steep banks.
      const here = hf.at(x, z);
      const around = (hf.at(x - 1.2, z) + hf.at(x + 1.2, z) + hf.at(x, z - 1.2) + hf.at(x, z + 1.2)) / 4;
      const crest = smooth(0.02, 0.12, here - around);
      const hollow = smooth(0.02, 0.12, around - here);
      const slope = hf.slopeAt(x, z);
      mix(c, CREST, crest * 0.45, c);
      mix(c, HOLLOW, hollow * 0.4, c);
      const bare = smooth(0.12, 0.3, slope + (big - 0.5) * 0.15) * 0.75 + smooth(0.62, 0.8, big * 0.6 + fine * 0.4) * 0.35;
      if (bare > 0) {
        mix(c, BARE, bare, c);
        mr = mr + (1 - mr) * bare;
        ms *= 1 - bare * 0.6;
      }
      // Woods floor, darker and soft.
      const dt = layout.sample(layout.distTrees, x, z);
      const woodK = smooth(1.1, 0.2, dt);
      if (woodK > 0) mix(c, WOOD, woodK * 0.75, c);
      // Village gardens round houses (not in towns or deserts away from water).
      const db = layout.sample(layout.distBuilding, x, z);
      if (biome !== 'urban') {
        const g = smooth(2.6, 1.2, db);
        if (g > 0) {
          // Plots under snow show only as faint furrows; elsewhere crops and dug earth alternate.
          const plot = hash(Math.floor(rx * 1.3), Math.floor(rz * 0.6), seed) < 0.5;
          if (biome === 'winter') mix(c, plot ? GARDEN : VERGE, g * 0.25, c);
          else mix(c, plot ? GARDEN : BARE, g * 0.6, c);
        }
      }
      // Hard standing round buildings: yards, pavements, aprons.
      const yardK = smooth(biome === 'urban' ? 0.9 : 0.45, 0.05, db);
      if (yardK > 0) {
        mix(c, YARD, yardK * (biome === 'winter' ? 0.4 : 0.85), c);
        mhd = mhd + (1 - mhd) * yardK;
        ms *= 1 - yardK;
      }
      // River banks: mud, then the bed.
      const dw = layout.sample(layout.distWater, x, z);
      const muddy = smooth(1.5, 0.5, dw + (fine - 0.5) * 0.6);
      if (muddy > 0) {
        mix(c, MUD, muddy * 0.8, c);
        mr = mr + (1 - mr) * muddy;
        ms *= 1 - muddy * 0.7;
      }
      // Desert wadis: pale silt and cracked mud in the beds.
      if (biome === 'desert') {
        const bed = wadi(x, z, seed) * (1 - smooth(1.0, 0.1, db));
        if (bed > 0) {
          mix(c, hex(fine > 0.55 ? '#d3c29c' : '#bfa985'), bed * 0.85, c);
          mr = mr + (1 - mr) * bed * 0.7;
          ms *= 1 - bed * 0.5;
        }
      }
      // Only a river has a bed: dry hollows and building pads elsewhere sit below the smoothed level.
      const under = dw < 2 ? hf.surfaceAt(x, z) - hf.at(x, z) : -1;
      if (under > -0.02) mix(c, BED, smooth(-0.02, 0.08, under), c);
      // Rocky ground round outcrops.
      const cell = cellAt(x, z);
      if (cell === ROCK) {
        mix(c, ROCKC, 0.55, c);
        mhd = Math.max(mhd, 0.6);
      } else if (cell === RUBBLE) {
        mix(c, hex('#77706a'), 0.7, c);
        mr = 1;
        ms = 0;
      }
      // Big soft mottling everywhere.
      const mott = 0.9 + big * 0.2 + (fine - 0.5) * 0.06;
      // Outside the field the land fades a little toward the haze.
      const out = Math.max(-x, x - map.w, -z, z - map.h, 0);
      const fade = 1 - Math.min(0.12, out * 0.018);
      const k = (j * mw + i) * 4;
      P[k] = clamp(c[0] * mott * fade, 0, 255);
      P[k + 1] = clamp(c[1] * mott * fade, 0, 255);
      P[k + 2] = clamp(c[2] * mott * fade, 0, 255);
      P[k + 3] = 255;
      const sum = Math.max(0.001, ms + mr + mhd);
      Q[k] = (ms / sum) * 255;
      Q[k + 1] = (mr / sum) * 255;
      Q[k + 2] = (mhd / sum) * 255;
      Q[k + 3] = 255;
    }
  }
  mid.getContext('2d')!.putImageData(img, 0, 0);
  maskC.getContext('2d')!.putImageData(mimg, 0, 0);

  // Full resolution: scale up, then crisp marks.
  const W = ew * px;
  const H = eh * px;
  const color = document.createElement('canvas');
  color.width = W;
  color.height = H;
  const g = color.getContext('2d')!;
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(mid, 0, 0, W, H);
  const mg = maskC.getContext('2d')!;
  const toPx = (x: number, z: number): [number, number] => [(x + MARGIN) * px, (z + MARGIN) * px];
  const toMid = (x: number, z: number): [number, number] => [(x + MARGIN) * midPx, (z + MARGIN) * midPx];
  const rnd = stream(seed ^ 0x7ac);

  // Road verges: worn earth and gravel a little wider than the carriageway.
  const vergeColor = biome === 'winter' ? '#9a9a94' : biome === 'desert' ? '#a8916c' : biome === 'urban' ? '#5d5a54' : '#6d604c';
  g.lineCap = 'round';
  g.lineJoin = 'round';
  mg.lineCap = 'round';
  mg.lineJoin = 'round';
  for (const r of roads) {
    for (const [ctx, toP, scale, style, width, alpha] of [
      [g, toPx, px, vergeColor, r.width + 0.32, 0.55],
      [mg, toMid, midPx, r.asphalt ? 'rgb(0,90,165)' : 'rgb(20,230,0)', r.width + 0.2, 1],
    ] as const) {
      ctx.strokeStyle = style;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = width * scale;
      ctx.beginPath();
      r.pts.forEach((p, n) => {
        const [qx, qy] = toP(p.x, p.z);
        if (n === 0) ctx.moveTo(qx, qy);
        else ctx.lineTo(qx, qy);
      });
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  // Vehicle tracks across the open country (not in towns).
  if (biome !== 'urban') {
    const trackColor = biome === 'winter' ? 'rgba(70,62,52,0.55)' : biome === 'desert' ? 'rgba(120,98,70,0.35)' : 'rgba(52,42,30,0.32)';
    g.strokeStyle = trackColor;
    g.lineWidth = px * 0.05;
    for (let n = 0; n < 7; n++) {
      const x0 = rnd() * map.w;
      const z0 = map.h + 1 + rnd() * 4;
      const len = 8 + rnd() * 18;
      const bend = (rnd() - 0.5) * 10;
      const x1 = x0 + bend * 0.5;
      const z1 = z0 - len;
      for (const side of [-0.13, 0.13]) {
        g.beginPath();
        const [ax, ay] = toPx(x0 + side, z0);
        const [qx, qy] = toPx(x0 + bend + side, z0 - len / 2);
        const [ex, ey] = toPx(x1 + side, z1);
        g.moveTo(ax, ay);
        g.quadraticCurveTo(qx, qy, ex, ey);
        g.stroke();
      }
    }
  }

  // Town pavements and courtyards: concrete slabs round blocks.
  if (biome === 'urban') {
    g.strokeStyle = 'rgba(30,30,28,0.25)';
    g.lineWidth = Math.max(1, px * 0.02);
    for (let y = 0; y < map.h; y++)
      for (let x = 0; x < map.w; x++) {
        if (map.cells[y * map.w + x] !== BUILDING) continue;
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= map.w || ny >= map.h) continue;
          const nc = map.cells[ny * map.w + nx];
          if (nc === BUILDING) continue;
          // A pavement strip along the wall.
          const [sx, sy] = toPx(x + (dx === 1 ? 1 : dx === -1 ? -0.22 : 0), y + (dy === 1 ? 1 : dy === -1 ? -0.22 : 0));
          const w = dx === 0 ? px : px * 0.22;
          const h = dy === 0 ? px : px * 0.22;
          g.fillStyle = 'rgba(128,124,116,0.75)';
          g.fillRect(sx, sy, w, h);
          const slabs = 5;
          for (let k = 1; k < slabs; k++) {
            g.beginPath();
            if (dx === 0) {
              g.moveTo(sx + (k * w) / slabs, sy);
              g.lineTo(sx + (k * w) / slabs, sy + h);
            } else {
              g.moveTo(sx, sy + (k * h) / slabs);
              g.lineTo(sx + w, sy + (k * h) / slabs);
            }
            g.stroke();
          }
        }
      }
  }

  // Shade under walls and hedges, and bits of stone round them.
  for (let y = 0; y < map.h; y++)
    for (let x = 0; x < map.w; x++) {
      const cell = map.cells[y * map.w + x];
      if (cell !== WALL && cell !== TREES) continue;
      const [cx, cy] = toPx(x + 0.5, y + 0.5);
      const r = px * (cell === TREES ? 0.75 : 0.45);
      const grad = g.createRadialGradient(cx, cy, 0, cx, cy, r);
      const dark = biome === 'winter' ? 'rgba(120,130,140,0.25)' : 'rgba(25,24,15,0.3)';
      grad.addColorStop(0, dark);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.fillRect(cx - r, cy - r, r * 2, r * 2);
    }

  // Grain over everything.
  const tile = document.createElement('canvas');
  tile.width = tile.height = 128;
  const tg = tile.getContext('2d')!;
  const timg = tg.createImageData(128, 128);
  let r = seed >>> 0 || 7;
  for (let k = 0; k < timg.data.length; k += 4) {
    r = (Math.imul(r, 1103515245) + 12345) >>> 0;
    const v = 128 + (((r >>> 16) & 255) - 128) * 0.4;
    timg.data[k] = timg.data[k + 1] = timg.data[k + 2] = v;
    timg.data[k + 3] = 255;
  }
  tg.putImageData(timg, 0, 0);
  g.globalCompositeOperation = 'overlay';
  g.globalAlpha = 0.22;
  g.fillStyle = g.createPattern(tile, 'repeat')!;
  g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = 'source-over';
  g.globalAlpha = 1;

  return { color, mask: maskC, px, mid: P, midPx, midW: mw, midH: mh };
}

// --- Marks painted at runtime -------------------------------------------------------------------

/** A shell crater: dark scoured centre, a ring of thrown earth, rays of ejecta. */
export function paintCrater(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, biome: Biome, rnd: () => number): void {
  const earth = biome === 'winter' ? '#4a4239' : biome === 'desert' ? '#8a7457' : '#3b3226';
  const ejecta = biome === 'winter' ? 'rgba(92,82,70,0.55)' : biome === 'desert' ? 'rgba(150,128,96,0.5)' : 'rgba(84,70,52,0.5)';
  // Ejecta rays.
  g.save();
  g.translate(cx, cy);
  for (let i = 0; i < 14; i++) {
    const a = rnd() * Math.PI * 2;
    const len = r * (1.4 + rnd() * 1.3);
    g.rotate(a);
    const grad = g.createLinearGradient(0, 0, len, 0);
    grad.addColorStop(0, ejecta);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(r * 0.5, -r * 0.12);
    g.lineTo(len, 0);
    g.lineTo(r * 0.5, r * 0.12);
    g.fill();
    g.rotate(-a);
  }
  g.restore();
  // Spatter of clods.
  for (let i = 0; i < 40; i++) {
    const a = rnd() * Math.PI * 2;
    const d = r * (0.9 + rnd() * 1.4);
    g.fillStyle = rnd() < 0.5 ? ejecta : 'rgba(40,34,26,0.5)';
    g.fillRect(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 1 + rnd() * r * 0.08, 1 + rnd() * r * 0.08);
  }
  // Thrown-up rim and the pit.
  const rim = g.createRadialGradient(cx, cy, r * 0.3, cx, cy, r * 1.25);
  rim.addColorStop(0, 'rgba(0,0,0,0)');
  rim.addColorStop(0.55, ejecta);
  rim.addColorStop(0.8, ejecta);
  rim.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = rim;
  g.beginPath();
  g.arc(cx, cy, r * 1.25, 0, Math.PI * 2);
  g.fill();
  const pit = g.createRadialGradient(cx, cy, 0, cx, cy, r * 0.75);
  pit.addColorStop(0, 'rgba(16,13,10,0.9)');
  pit.addColorStop(0.6, css(hex(earth), 0.85));
  pit.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = pit;
  g.beginPath();
  g.arc(cx, cy, r * 0.75, 0, Math.PI * 2);
  g.fill();
}

/** Soot under a burnt-out wreck. */
export function paintScorch(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, rnd: () => number): void {
  const grad = g.createRadialGradient(cx, cy, 0, cx, cy, r);
  grad.addColorStop(0, 'rgba(10,9,8,0.85)');
  grad.addColorStop(0.5, 'rgba(18,16,14,0.6)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fill();
  for (let i = 0; i < 18; i++) {
    const a = rnd() * Math.PI * 2;
    const d = r * (0.3 + rnd() * 0.8);
    g.fillStyle = `rgba(12,10,9,${0.2 + rnd() * 0.4})`;
    g.beginPath();
    g.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, r * (0.05 + rnd() * 0.15), 0, Math.PI * 2);
    g.fill();
  }
}

// --- The mesh and its material ------------------------------------------------------------------

export interface GroundUniforms {
  uDetail: { value: THREE.Texture };
  uMask: { value: THREE.Texture };
  uScale: { value: THREE.Vector2 };
  uDetailAmp: { value: number };
  uBump: { value: number };
  uWet: { value: number };
  uIce: { value: number };
  /** The field's rectangle (x0, z0, x1, z1): beyond it the ground melts into the haze. */
  uField: { value: THREE.Vector4 };
}

/** The ground's grid over the field and margin, from the heightfield. */
export function groundGeometry(hf: Heightfield): THREE.BufferGeometry {
  const { nx, nz, res } = hf;
  const pos = new Float32Array(nx * nz * 3);
  const uv = new Float32Array(nx * nz * 2);
  const ew = hf.layout.ew;
  const eh = hf.layout.eh;
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const p = j * nx + i;
      pos[p * 3] = i / res - MARGIN;
      pos[p * 3 + 1] = hf.h[p]!;
      pos[p * 3 + 2] = j / res - MARGIN;
      uv[p * 2] = i / res / ew;
      uv[p * 2 + 1] = j / res / eh;
    }
  const index = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let k = 0;
  for (let j = 0; j < nz - 1; j++)
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      const b = a + 1;
      const c = a + nx;
      const d = c + 1;
      // Split each quad along the shorter diagonal for a truer surface.
      if (Math.abs(hf.h[a]! - hf.h[d]!) < Math.abs(hf.h[b]! - hf.h[c]!)) {
        index.set([a, c, d, a, d, b], k);
      } else {
        index.set([a, c, b, b, c, d], k);
      }
      k += 6;
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(hf.normals.slice(), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(index, 1));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

/** The ground's material: macro map and mask, detail by mask at two scales, wet and icy states. */
export function groundMaterial(map: THREE.Texture, mask: THREE.Texture, detail: THREE.Texture, biome: Biome, field: THREE.Vector4): { material: THREE.MeshStandardMaterial; uniforms: GroundUniforms } {
  const uniforms: GroundUniforms = {
    uDetail: { value: detail },
    uMask: { value: mask },
    uScale: { value: new THREE.Vector2(1 / DETAIL_TILE, 1 / DETAIL_WIDE) },
    uDetailAmp: { value: biome === 'winter' ? 0.55 : 0.95 },
    uBump: { value: biome === 'winter' ? 0.5 : 1.1 },
    uWet: { value: 0 },
    uIce: { value: biome === 'winter' ? 1 : 0 },
    uField: { value: field },
  };
  const material = new THREE.MeshStandardMaterial({ map, roughness: biome === 'winter' ? 0.78 : 0.97, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vWorldXZ;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWorldXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec2 vWorldXZ;
uniform sampler2D uDetail;
uniform sampler2D uMask;
uniform vec2 uScale;
uniform float uDetailAmp;
uniform float uBump;
uniform float uWet;
uniform float uIce;
uniform vec4 uField;
float gDetail;
float gPuddle;
vec3 groundBump(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDir) {
  vec3 sx = normalize(dFdx(surf_pos.xyz));
  vec3 sy = normalize(dFdy(surf_pos.xyz));
  vec3 r1 = cross(sy, surf_norm);
  vec3 r2 = cross(surf_norm, sx);
  float det = dot(sx, r1) * faceDir;
  vec3 grad = sign(det) * (dHdxy.x * r1 + dHdxy.y * r2);
  return normalize(abs(det) * surf_norm - grad);
}`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
{
  vec4 dA = texture2D(uDetail, vWorldXZ * uScale.x);
  vec4 dB = texture2D(uDetail, vWorldXZ * uScale.y + vec2(0.37, 0.61));
  vec3 m = texture2D(uMask, vMapUv).rgb;
  vec3 w = m / max(m.r + m.g + m.b, 0.001);
  float a = dot(w, dA.rgb);
  float b = dot(w, dB.rgb);
  gDetail = a * 0.75 + b * 0.25;
  diffuseColor.rgb *= max(0.2, 1.0 + (a - 0.5) * uDetailAmp + (b - 0.5) * uDetailAmp * 0.7);
  gPuddle = smoothstep(0.6, 0.67, dB.a) * clamp(w.g * 1.2 + w.b * 0.6, 0.0, 1.0);
  float wetP = gPuddle * max(uWet, uIce);
  diffuseColor.rgb *= 1.0 - uWet * 0.3;
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.5, gPuddle * uWet);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.55, 0.62, 0.66), gPuddle * uIce * 0.75);
}`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.6, uWet * 0.7);
roughnessFactor = mix(roughnessFactor, 0.07, gPuddle * max(uWet, uIce));`,
      )
      .replace(
        '#include <fog_fragment>',
        `#include <fog_fragment>
#ifdef USE_FOG
{
  float outside = max(max(uField.x - vWorldXZ.x, vWorldXZ.x - uField.z), max(uField.y - vWorldXZ.y, vWorldXZ.y - uField.w));
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, smoothstep(1.5, ${(MARGIN - 0.5).toFixed(1)}, outside));
}
#endif`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
{
  float flat_ = 1.0 - gPuddle * max(uWet, uIce);
  vec2 dH = vec2(dFdx(gDetail), dFdy(gDetail)) * uBump * flat_;
  normal = groundBump(-vViewPosition, normal, dH, faceDirection);
}`,
      );
  };
  material.customProgramCacheKey = () => 'brink-ground';
  return { material, uniforms };
}

/** The ground's colour under a world point, as a linear colour. */
export function groundColour(paint: Paint, x: number, z: number, out: THREE.Color): THREE.Color {
  const i = clamp(Math.floor((x + MARGIN) * paint.midPx), 0, paint.midW - 1);
  const j = clamp(Math.floor((z + MARGIN) * paint.midPx), 0, paint.midH - 1);
  const k = (j * paint.midW + i) * 4;
  return out.setRGB(paint.mid[k]! / 255, paint.mid[k + 1]! / 255, paint.mid[k + 2]! / 255, THREE.SRGBColorSpace);
}

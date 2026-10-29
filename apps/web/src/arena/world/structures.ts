import * as THREE from 'three';
import { BRIDGE, BUILDING, BUILDING_KINDS, ROAD, RUBBLE, type BattleMap, type Biome } from '@brink/arena/v2';
import { LEVEL } from '../quality';
import { facadeRect, MISC, PLINTH, regionRect, REGION, STOREY, TINTED, type Atlas, type Region } from './atlas';
import { Geo, extractRange, hideRange, mergeChunks, type Chunk, type UVRect, type V3 } from './geom';
import type { Heightfield } from './height';
import { hash, stream } from './noise';
import type { Bridge } from './roads';

// Buildings, bridges and rubble: one merged mesh over the atlas (one draw call), with each cell's
// vertex range kept so a building can be lifted out and collapsed into its own rubble. Houses
// stand alone with pitched roofs and chimneys; panel blocks, sheds and shop terraces join their
// neighbours of the same kind into long blocks, with the party walls between sections painted
// as exposed rooms for when a neighbour comes down.

type Kind = (typeof BUILDING_KINDS)[number];

/** Prefab concrete: grey, beige, a little dirty. */
const PANEL_TINTS = ['#c2bdb3', '#c9bfac', '#b9b7b1', '#c6c1b4', '#b3aea3'];

const TINTS: Record<Biome, string[]> = {
  temperate: ['#e9dfc8', '#e6d9ae', '#ebe8e1', '#cbd6d8', '#d2dac2', '#e6cec2', '#d9cfba'],
  steppe: ['#ebe1c5', '#e8dba8', '#e9e6dc', '#c9d6dc', '#d6dcc0', '#dfe0d6'],
  desert: ['#e2d0ad', '#d9c094', '#e8e0cc', '#d6c7a8', '#cdb89a'],
  winter: ['#e6dcc6', '#e3d6ac', '#e8e6e0', '#c9d3d6', '#d6c4b8'],
  urban: ['#d8d2c6', '#cfc6b4', '#e0dcd2', '#c8ccc8', '#d6cbb5', '#c9c3b9'],
};

interface Section {
  kind: Kind;
  region: Region;
  roof: Region;
  tint: V3;
  roofTint: V3;
  block: number;
}

export interface StructureUniforms {
  uLit: { value: number };
  uGlow: { value: number };
}

interface Collapse {
  mesh: THREE.Mesh;
  t: number;
  dur: number;
  base: number;
  depth: number;
  tilt: THREE.Vector2;
  cell: number;
  rubbleAdded: boolean;
}

const BRIDGE_KEY = 1_000_000;

export class Structures {
  readonly group = new THREE.Group();
  readonly mesh: THREE.Mesh;
  readonly rubble: THREE.Mesh;
  readonly material: THREE.MeshStandardMaterial;
  readonly uniforms: StructureUniforms = { uLit: { value: 0 }, uGlow: { value: 0 } };
  /** Top of each cell's structure (building roof, rubble heap), world units. */
  readonly tops: Float32Array;
  private ranges = new Map<number, [number, number]>();
  private readonly rubbleChunks = new Map<number, Chunk>();
  private readonly sections = new Map<number, Section>();
  private readonly collapses: Collapse[] = [];
  private readonly bridgeOf = new Map<number, number>();
  private readonly cast: boolean;

  constructor(
    private readonly map: BattleMap,
    private readonly hf: Heightfield,
    private readonly bridges: Bridge[],
    atlas: Atlas,
    private readonly seed: number,
    cast: boolean,
    /** Balconies and rooftop clutter (off on Low). */
    private readonly detail = true,
  ) {
    this.cast = cast;
    this.tops = new Float32Array(map.w * map.h);
    this.material = new THREE.MeshStandardMaterial({ map: atlas.map, emissiveMap: atlas.emissive, emissive: 0xffffff, vertexColors: true, roughness: 0.9, metalness: 0 });
    const u = this.uniforms;
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, u);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 aRand;\nvarying float vRand;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRand = aRand.x;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vRand;\nuniform float uLit;\nuniform float uGlow;').replace(
        '#include <emissivemap_fragment>',
        `{
  vec4 ew = texture2D(emissiveMap, vEmissiveMapUv);
  float pick = fract(ew.r * 3.7 + vRand);
  float lit = ew.g * step(pick, uLit);
  vec3 warm = mix(vec3(1.0, 0.52, 0.2), vec3(0.55, 0.68, 1.0), step(0.9, fract(ew.r * 13.0 + vRand * 5.0)));
  totalEmissiveRadiance = warm * lit * uGlow;
}`,
      );
    };
    this.material.customProgramCacheKey = () => 'brink-structures';

    this.classify();
    const chunks: { key: number; chunk: Chunk }[] = [];
    for (let i = 0; i < map.cells.length; i++) {
      if (map.cells[i] === BUILDING) {
        const g = new Geo();
        this.tops[i] = this.building(g, i);
        chunks.push({ key: i, chunk: g.slice(0) });
      } else if (map.cells[i] === RUBBLE) {
        this.addRubbleChunk(i, false);
      }
    }
    bridges.forEach((b, n) => {
      const g = new Geo();
      this.bridge(g, b);
      chunks.push({ key: BRIDGE_KEY + n, chunk: g.slice(0) });
      for (const c of b.cells) this.bridgeOf.set(c, n);
    });
    const merged = mergeChunks(chunks);
    this.ranges = merged.ranges;
    this.mesh = new THREE.Mesh(merged.geometry, this.material);
    this.mesh.castShadow = cast;
    this.mesh.receiveShadow = true;
    this.mesh.name = 'structures';
    this.rubble = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
    this.rubble.castShadow = cast;
    this.rubble.receiveShadow = true;
    this.rubble.name = 'rubble';
    this.rebuildRubble();
    this.group.add(this.mesh, this.rubble);
  }

  // --- Layout ------------------------------------------------------------------------------------

  private kindAt(i: number): Kind {
    return BUILDING_KINDS[(this.map.variant[i] ?? 0) & 3]!;
  }

  /** Join neighbouring sections of the same kind into blocks; pick each block's look. */
  private classify(): void {
    const map = this.map;
    const biome = map.biome;
    const seen = new Set<number>();
    for (let i = 0; i < map.cells.length; i++) {
      if ((map.cells[i] !== BUILDING && map.cells[i] !== RUBBLE) || seen.has(i)) continue;
      const kind = this.kindAt(i);
      const comp = [i];
      seen.add(i);
      if (kind !== 'house' && map.cells[i] === BUILDING) {
        for (let q = 0; q < comp.length; q++) {
          const c = comp[q]!;
          for (const j of this.neighbours(c)) {
            if (j < 0 || seen.has(j) || map.cells[j] !== BUILDING || this.kindAt(j) !== kind) continue;
            seen.add(j);
            comp.push(j);
          }
        }
      }
      const block = Math.min(...comp);
      const look = (map.variant[block] ?? 0) >> 2;
      const h = (n: number) => hash(this.seed, block, n);
      let region: Region;
      if (kind === 'house') region = biome === 'desert' ? REGION.desert : biome === 'urban' ? ([REGION.plasterB, REGION.brick] as const)[look % 2]! : ([REGION.plasterA, REGION.plasterB, REGION.brick] as const)[look % 3]!;
      else if (kind === 'apartment') region = biome === 'desert' ? REGION.desert : biome === 'urban' && look % 4 === 3 ? REGION.panelDamaged : ([REGION.panel, REGION.silicate] as const)[look % 2]!;
      else if (kind === 'industrial') region = biome === 'desert' ? REGION.shed : ([REGION.shed, REGION.factory] as const)[look % 2]!;
      else region = REGION.shop;
      let roof: Region;
      if (biome === 'winter') roof = REGION.roofSnow;
      else if (kind === 'house' && biome !== 'desert') roof = biome === 'steppe' ? (h(1) < 0.75 ? REGION.roofSheet : REGION.roofTile) : h(1) < 0.45 ? REGION.roofTile : REGION.roofSheet;
      else if (kind === 'industrial') roof = REGION.roofSheet;
      else roof = REGION.roofFlat;
      const panel = region === REGION.panel || region === REGION.panelDamaged;
      const tints = panel ? PANEL_TINTS : (TINTS[biome] ?? TINTS.temperate);
      const tc = new THREE.Color(tints[Math.floor(h(2) * tints.length)]!);
      // Dust and years of weather.
      const wear = (panel ? 0.64 : 0.74) + h(3) * 0.16;
      const tint: V3 = TINTED.has(region) ? [tc.r * wear, tc.g * wear, tc.b * wear] : [wear, wear, wear];
      // Roofs: faded tile, grey asbestos sheet, painted metal gone dull.
      const sheets: V3[] = [
        [0.82, 0.82, 0.8],
        [0.66, 0.74, 0.64],
        [0.78, 0.6, 0.56],
        [0.74, 0.66, 0.58],
        [0.7, 0.72, 0.74],
      ];
      const roofTint: V3 = roof === REGION.roofSheet ? sheets[Math.floor(h(4) * sheets.length)]! : roof === REGION.roofTile ? [0.8 + h(5) * 0.12, 0.78 + h(5) * 0.1, 0.76 + h(5) * 0.1] : [0.85, 0.85, 0.85];
      for (const c of comp) this.sections.set(c, { kind, region, roof, tint, roofTint, block });
    }
  }

  /** North, east, south, west neighbours (-1 off the field). */
  private neighbours(i: number): [number, number, number, number] {
    const w = this.map.w;
    const x = i % w;
    const y = Math.floor(i / w);
    return [y > 0 ? i - w : -1, x < w - 1 ? i + 1 : -1, y < this.map.h - 1 ? i + w : -1, x > 0 ? i - 1 : -1];
  }

  private joined(i: number, j: number): boolean {
    if (j < 0 || this.map.cells[j] !== BUILDING) return false;
    const a = this.sections.get(i);
    const b = this.sections.get(j);
    return !!a && !!b && a.block === b.block && a.kind !== 'house';
  }

  private pad(i: number): number {
    return (this.map.elev[i] ?? 0) * LEVEL;
  }

  // --- Buildings ---------------------------------------------------------------------------------

  /** Build one building cell into `g`; returns its top. */
  private building(g: Geo, i: number): number {
    const s = this.sections.get(i)!;
    const storeys = Math.max(1, Math.min(4, this.map.storeys[i] || 1));
    if (s.kind === 'house') return this.house(g, i, s, storeys);
    return this.section(g, i, s, storeys);
  }

  private house(g: Geo, i: number, s: Section, storeys: number): number {
    const map = this.map;
    const rnd = stream(hash(this.seed, i, 77) * 4294967296);
    const x = i % map.w;
    const y = Math.floor(i / map.w);
    const base = this.pad(i);
    // Face the road if one is beside the house.
    const nb = this.neighbours(i);
    const dirs: [number, number][] = [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ];
    let front = dirs[Math.floor(rnd() * 4)]!;
    for (let k = 0; k < 4; k++) {
      const j = nb[k]!;
      if (j >= 0 && (map.cells[j] === ROAD || map.cells[j] === BRIDGE)) front = dirs[k]!;
    }
    const w = 0.62 + rnd() * 0.18;
    const d = 0.5 + rnd() * 0.14;
    const T = storeys * STOREY[s.region];
    // Towards the road, leaving a garden behind.
    const push = 0.5 - d / 2 - 0.1;
    const cx = x + 0.5 + front[0] * push + (rnd() - 0.5) * 0.06;
    const cz = y + 0.5 + front[1] * push + (rnd() - 0.5) * 0.06;
    const theta = Math.atan2(front[0], front[1]);
    const m = new THREE.Matrix4().makeRotationY(theta).setPosition(cx, base, cz);
    g.setMatrix(m);
    g.color = s.tint;
    const r = s.region;
    const wallFace = (ax: number, az: number, bx: number, bz: number, len: number) => {
      g.rand = rnd();
      g.wall(ax, az, bx, bz, -PLINTH, T, facadeRect(r, 0.5 - len / 2, 0.5 + len / 2, -PLINTH, T));
    };
    wallFace(-w / 2, -d / 2, w / 2, -d / 2, w);
    wallFace(w / 2, -d / 2, w / 2, d / 2, d);
    wallFace(w / 2, d / 2, -w / 2, d / 2, w);
    wallFace(-w / 2, d / 2, -w / 2, -d / 2, d);
    let top = T;
    if (map.biome === 'desert') {
      // Flat roof, a parapet and a water tank.
      g.color = [0.95, 0.95, 0.95];
      g.flat(-w / 2, -d / 2, w / 2, d / 2, T, regionRect(REGION.roofFlat, 0, 0, w, d));
      g.color = s.tint;
      this.parapet(g, -w / 2, -d / 2, w / 2, d / 2, T, [true, true, true, true], r);
      g.color = [0.9, 0.9, 0.9];
      g.box(w * 0.2, -d * 0.15, 0.09, 0.09, T, T + 0.08, MISC.metal);
      top = T + 0.08;
    } else {
      const rh = 0.14 + d * 0.28;
      const o = 0.04;
      const drop = (o * rh) / (d / 2);
      const roofR = s.roof;
      g.color = s.roofTint;
      const sl = Math.hypot(d / 2 + o, rh + drop);
      const rr = regionRect(roofR, 0, 0, Math.min(1, w + 2 * o), Math.min(1, sl));
      g.quad([-w / 2 - o, T - drop, d / 2 + o], [w / 2 + o, T - drop, d / 2 + o], [w / 2 + o, T + rh, 0], [-w / 2 - o, T + rh, 0], rr);
      g.quad([w / 2 + o, T - drop, -d / 2 - o], [-w / 2 - o, T - drop, -d / 2 - o], [-w / 2 - o, T + rh, 0], [w / 2 + o, T + rh, 0], rr);
      // Gables carry the wall up.
      g.color = s.tint;
      const gr = facadeRect(r, 0.5 - d / 2, 0.5 + d / 2, T, T + rh);
      const v0 = gr[3];
      const v1 = gr[1];
      g.tri([w / 2, T, d / 2], [w / 2, T, -d / 2], [w / 2, T + rh, 0], [gr[0], v0], [gr[2], v0], [(gr[0] + gr[2]) / 2, v1]);
      g.tri([-w / 2, T, -d / 2], [-w / 2, T, d / 2], [-w / 2, T + rh, 0], [gr[0], v0], [gr[2], v0], [(gr[0] + gr[2]) / 2, v1]);
      // Chimney.
      g.color = [0.85, 0.85, 0.85];
      const chx = w * (rnd() < 0.5 ? 0.24 : -0.24);
      g.box(chx, -d * 0.16, 0.06, 0.06, T + rh * 0.3, T + rh + 0.06, regionRect(REGION.brick, 0.1, 0.1, 0.25, 0.3));
      top = T + rh;
    }
    g.setMatrix(null);
    return base + top;
  }

  /** A low wall round a flat roof on the given sides (north, east, south, west). */
  private parapet(g: Geo, x0: number, z0: number, x1: number, z1: number, T: number, sides: boolean[], r: Region): void {
    const h = 0.045;
    const t = 0.022;
    const rr = facadeRect(r, 0.1, 0.2, -0.06, -0.06 + h);
    if (sides[0]) g.box((x0 + x1) / 2, z0 + t / 2, x1 - x0, t, T, T + h, rr);
    if (sides[1]) g.box(x1 - t / 2, (z0 + z1) / 2, t, z1 - z0, T, T + h, rr);
    if (sides[2]) g.box((x0 + x1) / 2, z1 - t / 2, x1 - x0, t, T, T + h, rr);
    if (sides[3]) g.box(x0 + t / 2, (z0 + z1) / 2, t, z1 - z0, T, T + h, rr);
  }

  /** A section of a joined block (panel flats, a shed, a shop terrace). */
  private section(g: Geo, i: number, s: Section, storeys: number): number {
    const map = this.map;
    const rnd = stream(hash(this.seed, i, 91) * 4294967296);
    const x = i % map.w;
    const y = Math.floor(i / map.w);
    const base = this.pad(i);
    const nb = this.neighbours(i);
    const join = nb.map((j) => this.joined(i, j));
    const inset = s.kind === 'apartment' ? 0.14 : s.kind === 'industrial' ? 0.05 : 0.1;
    const x0 = x + (join[3] ? 0 : inset);
    const x1 = x + 1 - (join[1] ? 0 : inset);
    const z0 = y + (join[0] ? 0 : inset);
    const z1 = y + 1 - (join[2] ? 0 : inset);
    const sh = STOREY[s.region];
    const T = Math.max(1, storeys) * sh;
    const baseM = new THREE.Matrix4().makeTranslation(0, base, 0);
    g.setMatrix(baseM);
    // Walls: facades outside; exposed rooms where a section of the same block stands beside.
    const sides: [number, number, number, number][] = [
      [x0, z0, x1, z0],
      [x1, z0, x1, z1],
      [x1, z1, x0, z1],
      [x0, z1, x0, z0],
    ];
    for (let k = 0; k < 4; k++) {
      const [ax, az, bx, bz] = sides[k]!;
      const len = Math.hypot(bx - ax, bz - az);
      g.rand = rnd();
      if (join[k]) {
        const other = nb[k]!;
        const ot = Math.max(1, Math.min(4, map.storeys[other] || 1)) * sh;
        g.color = [0.9, 0.9, 0.9];
        g.wall(ax, az, bx, bz, -PLINTH, Math.min(T, ot), facadeRect(REGION.interior, 0.5 - len / 2, 0.5 + len / 2, -PLINTH, Math.min(T, ot)));
        if (T > ot) {
          g.color = s.tint;
          g.wall(ax, az, bx, bz, ot, T, facadeRect(s.region, 0.5 - len / 2, 0.5 + len / 2, ot, T));
        }
      } else {
        g.color = s.tint;
        g.wall(ax, az, bx, bz, -PLINTH, T, facadeRect(s.region, 0.5 - len / 2, 0.5 + len / 2, -PLINTH, T));
      }
    }
    let top = T;
    if (s.kind === 'industrial' && s.region === REGION.shed && (map.variant[s.block]! >> 4) % 2 === 0) {
      // Sawtooth roof, glazing to the north.
      const th = 0.12;
      const n = Math.max(1, Math.round((z1 - z0) * 3));
      const tw = (z1 - z0) / n;
      for (let k = 0; k < n; k++) {
        const za = z0 + k * tw;
        const zb = za + tw;
        g.color = s.roofTint;
        g.quad([x0, T, zb], [x1, T, zb], [x1, T + th, za], [x0, T + th, za], regionRect(s.roof, 0, 0, Math.min(1, x1 - x0), Math.min(1, Math.hypot(tw, th))));
        g.wall(x0, za, x1, za, T, T + th, MISC.glazing);
        g.color = s.tint;
        const side = facadeRect(s.region, 0.2, 0.2 + tw, T, T + th);
        if (!join[1]) g.tri([x1, T, zb], [x1, T, za], [x1, T + th, za], [side[0], side[3]], [side[2], side[3]], [side[2], side[1]]);
        if (!join[3]) g.tri([x0, T, za], [x0, T, zb], [x0, T + th, za], [side[2], side[3]], [side[0], side[3]], [side[2], side[1]]);
      }
      top = T + th;
    } else if (s.kind === 'industrial') {
      // A low-pitched roof over each bay.
      const rh = 0.08;
      const zm = (z0 + z1) / 2;
      g.color = s.roofTint;
      const rr = regionRect(s.roof, 0, 0, Math.min(1, x1 - x0), Math.min(1, (z1 - z0) / 2 + 0.02));
      g.quad([x0, T, z1], [x1, T, z1], [x1, T + rh, zm], [x0, T + rh, zm], rr);
      g.quad([x1, T, z0], [x0, T, z0], [x0, T + rh, zm], [x1, T + rh, zm], rr);
      g.color = s.tint;
      const side = facadeRect(s.region, 0.2, 0.2 + (z1 - z0), T, T + rh);
      if (!join[1]) g.tri([x1, T, z1], [x1, T, z0], [x1, T + rh, zm], [side[0], side[3]], [side[2], side[3]], [(side[0] + side[2]) / 2, side[1]]);
      if (!join[3]) g.tri([x0, T, z0], [x0, T, z1], [x0, T + rh, zm], [side[0], side[3]], [side[2], side[3]], [(side[0] + side[2]) / 2, side[1]]);
      top = T + rh;
      // Now and then a works chimney.
      if (s.block === i && hash(this.seed, i, 5) < 0.4) {
        g.color = [0.85, 0.85, 0.85];
        const c = new THREE.CylinderGeometry(0.035, 0.06, 1.1, 8, 1, true);
        c.translate(x0 + 0.2, T + 0.55, z0 + 0.25);
        g.add(c, regionRect(REGION.brick, 0.2, 0.1, 0.5, 0.9));
        c.dispose();
        top = Math.max(top, T + 1.1);
      }
    } else {
      // Flat roof with a parapet on the outside edges.
      g.color = s.roofTint;
      const ou = rnd() * 0.3;
      const ov = rnd() * 0.3;
      g.flat(x0, z0, x1, z1, T, regionRect(s.roof, ou, ov, ou + Math.min(0.7, x1 - x0), ov + Math.min(0.7, z1 - z0)));
      g.color = s.tint;
      this.parapet(g, x0, z0, x1, z1, T, join.map((j) => !j), s.region);
      top = T + 0.045;
      if (s.kind === 'apartment' && this.detail) {
        g.color = [0.85, 0.85, 0.85];
        // Lift motor rooms and vents.
        if (rnd() < 0.4) g.box(x0 + (x1 - x0) * (0.3 + rnd() * 0.4), z0 + (z1 - z0) * (0.3 + rnd() * 0.4), 0.16, 0.12, T, T + 0.1, MISC.concrete);
        for (let k = 0; k < 2; k++) if (rnd() < 0.6) g.box(x0 + 0.1 + rnd() * (x1 - x0 - 0.2), z0 + 0.1 + rnd() * (z1 - z0 - 0.2), 0.04, 0.04, T, T + 0.05, MISC.concrete);
        if (rnd() < 0.25) g.box(x0 + 0.2 + rnd() * 0.5, z0 + 0.2 + rnd() * 0.4, 0.006, 0.006, T, T + 0.18, MISC.metal);
        // Balconies on the long faces.
        for (let k = 0; k < 4; k++) {
          if (join[k]) continue;
          const [ax, az, bx, bz] = sides[k]!;
          const len = Math.hypot(bx - ax, bz - az);
          if (len < 0.8) continue;
          const nx = (bz - az) / len;
          const nz = -(bx - ax) / len;
          // A frame on the wall: x along it, z out of it.
          const frame = new THREE.Matrix4().makeBasis(new THREE.Vector3(nz, 0, -nx), new THREE.Vector3(0, 1, 0), new THREE.Vector3(nx, 0, nz)).setPosition((ax + bx) / 2, 0, (az + bz) / 2);
          g.setMatrix(baseM.clone().multiply(frame));
          const hw = 0.085;
          const d = 0.07;
          for (let st = 1; st < storeys; st++) {
            if (rnd() < 0.2) continue;
            const yb = st * sh;
            // Slab: top and front edge (the drone never sees under it).
            g.color = [0.82, 0.82, 0.8];
            g.flat(-hw, 0, hw, d, yb, MISC.concrete);
            g.wall(hw, d, -hw, d, yb - 0.012, yb, MISC.concrete);
            if (rnd() < 0.35) {
              // Glazed in, as most of them are.
              g.color = [0.9, 0.9, 0.9];
              g.wall(hw, d, -hw, d, yb, yb + 0.2, MISC.glazing);
              g.wall(hw, 0, hw, d, yb, yb + 0.2, MISC.glazing);
              g.wall(-hw, d, -hw, 0, yb, yb + 0.2, MISC.glazing);
              g.flat(-hw, 0, hw, d, yb + 0.2, MISC.metal);
            } else {
              g.color = [0.6, 0.6, 0.58];
              g.wall(hw, d, -hw, d, yb, yb + 0.045, MISC.metal);
            }
          }
          g.setMatrix(baseM);
        }
      }
      if (s.kind === 'shop') {
        // Awnings over shopfronts that face a street.
        for (let k = 0; k < 4; k++) {
          const j = nb[k]!;
          if (join[k] || j < 0 || (map.cells[j] !== ROAD && map.cells[j] !== BRIDGE)) continue;
          if (rnd() < 0.3) continue;
          const [ax, az, bx, bz] = sides[k]!;
          const len = Math.hypot(bx - ax, bz - az);
          const nx = (bz - az) / len;
          const nz = -(bx - ax) / len;
          const shrink = 0.08;
          const pax = ax + ((bx - ax) / len) * shrink;
          const paz = az + ((bz - az) / len) * shrink;
          const pbx = bx - ((bx - ax) / len) * shrink;
          const pbz = bz - ((bz - az) / len) * shrink;
          const out = 0.11;
          const yh = 0.235;
          const yl = 0.19;
          g.color = [0.85, 0.85, 0.85];
          g.quad([pbx + nx * out, yl, pbz + nz * out], [pax + nx * out, yl, paz + nz * out], [pax, yh, paz], [pbx, yh, pbz], MISC.awning);
          g.wall(pax + nx * out, paz + nz * out, pbx + nx * out, pbz + nz * out, yl - 0.025, yl, MISC.awning);
        }
      }
    }
    g.setMatrix(null);
    return base + top;
  }

  // --- Bridges -----------------------------------------------------------------------------------

  private bridge(g: Geo, b: Bridge): void {
    const along = (s: number, a: number): [number, number] => (b.axis === 'z' ? [a, s] : [s, a]);
    const n = 10;
    const deck = (k: number) => {
      const s = b.from + ((b.to - b.from) * k) / n;
      const f = k / n;
      return { s, h: b.h0 + (b.h1 - b.h0) * f + Math.sin(f * Math.PI) * 0.03 };
    };
    const thick = 0.07;
    g.color = [0.82, 0.81, 0.78];
    for (let k = 0; k < n; k++) {
      const p = deck(k);
      const q = deck(k + 1);
      for (const [a0, a1, top] of [
        [b.across0, b.across1, true],
        [b.across1, b.across0, false],
      ] as const) {
        const [x00, z00] = along(p.s, a0);
        const [x01, z01] = along(p.s, a1);
        const [x10, z10] = along(q.s, a0);
        const [x11, z11] = along(q.s, a1);
        if (top) {
          // Deck top, wound to face up whichever way the bridge runs.
          const pts: V3[] = [
            [x00, p.h, z00],
            [x01, p.h, z01],
            [x11, q.h, z11],
            [x10, q.h, z10],
          ];
          const n0 = (pts[1]![0] - pts[0]![0]) * (pts[2]![2] - pts[0]![2]) - (pts[1]![2] - pts[0]![2]) * (pts[2]![0] - pts[0]![0]);
          if (n0 > 0) pts.reverse();
          g.quad(pts[0]!, pts[1]!, pts[2]!, pts[3]!, MISC.concrete);
        } else {
          // Underside.
          const pts: V3[] = [
            [x00, p.h - thick, z00],
            [x01, p.h - thick, z01],
            [x11, q.h - thick, z11],
            [x10, q.h - thick, z10],
          ];
          const n0 = (pts[1]![0] - pts[0]![0]) * (pts[2]![2] - pts[0]![2]) - (pts[1]![2] - pts[0]![2]) * (pts[2]![0] - pts[0]![0]);
          if (n0 < 0) pts.reverse();
          g.quad(pts[0]!, pts[1]!, pts[2]!, pts[3]!, MISC.concrete);
        }
      }
      // Sides and parapets, both faces.
      for (const a of [b.across0, b.across1]) {
        const [xa, za] = along(p.s, a);
        const [xb, zb] = along(q.s, a);
        for (const flip of [false, true]) {
          const P: V3[] = [
            [xa, p.h - thick, za],
            [xb, q.h - thick, zb],
            [xb, q.h + 0.055, zb],
            [xa, p.h + 0.055, za],
          ];
          if (flip) g.quad(P[1]!, P[0]!, P[3]!, P[2]!, MISC.concrete);
          else g.quad(P[0]!, P[1]!, P[2]!, P[3]!, MISC.concrete);
        }
      }
    }
    // Piers between spans, down to the river bed.
    g.color = [0.7, 0.69, 0.66];
    for (let s = Math.ceil(b.from + 0.6); s < b.to - 0.5; s += 1) {
      const [px, pz] = along(s, (b.across0 + b.across1) / 2);
      const top = deckAt0(b, s) - thick;
      const bed = this.hf.at(px, pz) - 0.05;
      g.box(px, pz, b.axis === 'z' ? b.across1 - b.across0 - 0.1 : 0.08, b.axis === 'z' ? 0.08 : b.across1 - b.across0 - 0.1, bed, top, MISC.concrete);
    }
  }

  // --- Rubble ------------------------------------------------------------------------------------

  private rubbleGeo(i: number): Chunk {
    const map = this.map;
    const g = new Geo();
    const rnd = stream(hash(this.seed, i, 313) * 4294967296);
    const x = i % map.w;
    const y = Math.floor(i / map.w);
    const cx = x + 0.5;
    const cz = y + 0.5;
    const base = map.cells[i] === BUILDING ? this.pad(i) : this.hf.at(cx, cz);
    const s = this.sections.get(i);
    const storeys = Math.max(1, Math.min(4, map.storeys[i] || (s ? 2 : 1)));
    const brick = s?.region === REGION.brick || s?.region === REGION.factory || s?.region === REGION.silicate;
    const house = s?.kind === 'house';
    const reach = house ? 0.38 : 0.46;
    const peak = 0.05 + storeys * 0.04;
    // Broken concrete, brick, dust, plaster in the building's own colour, charred timber.
    const wall: V3 = s ? [s.tint[0] * 0.75, s.tint[1] * 0.75, s.tint[2] * 0.75] : [0.5, 0.48, 0.45];
    const palette: V3[] = [
      [0.46, 0.45, 0.42],
      [0.36, 0.34, 0.31],
      [0.55, 0.53, 0.49],
      brick ? [0.5, 0.3, 0.24] : [0.42, 0.39, 0.35],
      brick ? [0.42, 0.26, 0.2] : wall,
      [0.17, 0.16, 0.15],
    ];
    const pick = () => palette[Math.floor(rnd() * palette.length)]!;
    // The heap: a lumpy low dome, slumped off centre.
    const seg = 12;
    const rings = [0, 0.12, 0.24, 0.36, 0.5];
    const hts = [1, 0.85, 0.6, 0.3, 0.0];
    const ox = (rnd() - 0.5) * 0.14;
    const oz = (rnd() - 0.5) * 0.14;
    const P: V3[][] = rings.map((r, k) =>
      Array.from({ length: k === 0 ? 1 : seg }, (_, a) => {
        const ang = (a / seg) * Math.PI * 2 + k * 0.3;
        const rr = (r / 0.5) * reach * (0.8 + rnd() * 0.4);
        const lump = k === 0 ? 1 : 0.55 + rnd() * 0.9;
        return [cx + ox * (1 - k / 4) + Math.cos(ang) * rr, base + peak * hts[k]! * lump - (k === 4 ? 0.03 : 0), cz + oz * (1 - k / 4) + Math.sin(ang) * rr] as V3;
      }),
    );
    const uvc = MISC.concrete;
    const uvs: [number, number][] = [
      [uvc[0], uvc[1]],
      [uvc[2], uvc[1]],
      [(uvc[0] + uvc[2]) / 2, uvc[3]],
    ];
    for (let a = 0; a < seg; a++) {
      g.color = pick();
      g.tri(P[0]![0]!, P[1]![(a + 1) % seg]!, P[1]![a]!, uvs[0]!, uvs[1]!, uvs[2]!);
      for (let k = 1; k < rings.length - 1; k++) {
        const a0 = P[k]![a]!;
        const a1 = P[k]![(a + 1) % seg]!;
        const b0 = P[k + 1]![a]!;
        const b1 = P[k + 1]![(a + 1) % seg]!;
        g.color = pick();
        g.tri(a0, a1, b1, uvs[0]!, uvs[1]!, uvs[2]!);
        g.color = pick();
        g.tri(a0, b1, b0, uvs[0]!, uvs[1]!, uvs[2]!);
      }
    }
    // Slabs, beams and blocks thrown about; rebar out of the bigger ones.
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const pos = new THREE.Vector3();
    const one = new THREE.Vector3(1, 1, 1);
    for (let k = 0; k < 10 + storeys * 3; k++) {
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd()) * reach * 0.95;
      const h = base + peak * Math.max(0.05, 1 - r / reach) * 0.85;
      e.set((rnd() - 0.5) * 1.3, rnd() * Math.PI, (rnd() - 0.5) * 1.3);
      q.setFromEuler(e);
      m.compose(pos.set(cx + ox + Math.cos(a) * r, h, cz + oz + Math.sin(a) * r), q, one);
      g.setMatrix(m);
      g.color = pick();
      const size = rnd();
      if (size < 0.3) g.box(0, 0, 0.18, 0.12, -0.012, 0.012, MISC.concrete);
      else if (size < 0.5) g.box(0, 0, 0.22, 0.025, -0.015, 0.015, MISC.concrete);
      else g.box(0, 0, 0.05 + rnd() * 0.05, 0.04 + rnd() * 0.04, -0.02, 0.02, MISC.concrete);
      if (size < 0.3 && rnd() < 0.6) {
        g.color = [0.3, 0.2, 0.16];
        g.box(0.07, 0, 0.004, 0.004, 0, 0.07 + rnd() * 0.08, MISC.metal);
        g.box(-0.05, 0.03, 0.004, 0.004, 0, 0.05 + rnd() * 0.06, MISC.metal);
      }
    }
    // A house's roof comes down in pieces on top of the heap.
    if (s && house && this.map.biome !== 'desert') {
      for (let k = 0; k < 2; k++) {
        e.set((rnd() - 0.5) * 0.9, rnd() * Math.PI, (rnd() - 0.5) * 0.9);
        q.setFromEuler(e);
        m.compose(pos.set(cx + ox + (rnd() - 0.5) * 0.25, base + peak * 0.7, cz + oz + (rnd() - 0.5) * 0.25), q, one);
        g.setMatrix(m);
        g.color = [s.roofTint[0] * 0.8, s.roofTint[1] * 0.8, s.roofTint[2] * 0.8];
        const w = 0.22 + rnd() * 0.12;
        const d = 0.15 + rnd() * 0.08;
        g.flat(-w / 2, -d / 2, w / 2, d / 2, 0, regionRect(s.roof, 0, 0, w, d));
        g.quad([w / 2, -0.004, -d / 2], [w / 2, -0.004, d / 2], [-w / 2, -0.004, d / 2], [-w / 2, -0.004, -d / 2], regionRect(s.roof, 0, 0, w, d));
      }
    }
    g.setMatrix(null);
    // Walls still standing at one corner, broken off jagged.
    if (s && rnd() < 0.9) {
      const corner = Math.floor(rnd() * 4);
      const off = house ? 0.33 : 0.42;
      const hmax = Math.min(storeys, 2) * STOREY[s.region] * (0.55 + rnd() * 0.6);
      // Two runs from the corner, along each side.
      const sx = corner === 0 || corner === 3 ? -1 : 1;
      const sz = corner < 2 ? -1 : 1;
      const runs: [number, number, number, number][] = [
        [cx + sx * off, cz + sz * off, -sx, 0],
        [cx + sx * off, cz + sz * off, 0, -sz],
      ];
      g.color = s.tint;
      for (const [x0, z0, dx, dz] of runs) {
        const len = 0.2 + rnd() * 0.35;
        const steps = 5;
        const hs: number[] = [];
        for (let k = 0; k <= steps; k++) hs.push(k === steps ? hmax * 0.15 * rnd() : hmax * (1 - (k / steps) * 0.7) * (0.6 + rnd() * 0.4));
        for (let k = 0; k < steps; k++) {
          const ax = x0 + dx * len * (k / steps);
          const az = z0 + dz * len * (k / steps);
          const bx = x0 + dx * len * ((k + 1) / steps);
          const bz = z0 + dz * len * ((k + 1) / steps);
          const ua = 0.1 + len * (k / steps);
          const ub = 0.1 + len * ((k + 1) / steps);
          const ra = facadeRect(s.region, ua, ua, -PLINTH, hs[k]!);
          const rb = facadeRect(s.region, ub, ub, -PLINTH, hs[k + 1]!);
          const A0: V3 = [ax, base - 0.05, az];
          const B0: V3 = [bx, base - 0.05, bz];
          const A1: V3 = [ax, base + hs[k]!, az];
          const B1: V3 = [bx, base + hs[k + 1]!, bz];
          g.tri(B0, A0, A1, [rb[0], rb[3]], [ra[0], ra[3]], [ra[0], ra[1]]);
          g.tri(B0, A1, B1, [rb[0], rb[3]], [ra[0], ra[1]], [rb[0], rb[1]]);
          g.tri(A0, B0, B1, [ra[0], ra[3]], [rb[0], rb[3]], [rb[0], rb[1]]);
          g.tri(A0, B1, A1, [ra[0], ra[3]], [rb[0], rb[1]], [ra[0], ra[1]]);
        }
      }
    }
    this.tops[i] = base + peak;
    return g.slice(0);
  }

  private addRubbleChunk(i: number, rebuild = true): void {
    this.rubbleChunks.set(i, this.rubbleGeo(i));
    if (rebuild) this.rebuildRubble();
  }

  private rebuildRubble(): void {
    const list = [...this.rubbleChunks.entries()].sort((a, b) => a[0] - b[0]).map(([key, chunk]) => ({ key, chunk }));
    const { geometry } = mergeChunks(list);
    this.rubble.geometry.dispose();
    this.rubble.geometry = geometry;
  }

  // --- Changes -----------------------------------------------------------------------------------

  /** Bring the drawing in line with the map for one cell. */
  setCell(i: number, cell: number): void {
    const wasBuilding = this.ranges.has(i);
    if (wasBuilding && cell !== BUILDING) this.collapse(i, cell === RUBBLE);
    else if (cell === RUBBLE && !this.rubbleChunks.has(i)) this.addRubbleChunk(i);
    else if (cell !== RUBBLE && cell !== BUILDING && this.rubbleChunks.has(i)) {
      this.rubbleChunks.delete(i);
      this.rebuildRubble();
      this.tops[i] = 0;
    }
    const b = this.bridgeOf.get(i);
    if (b !== undefined && cell !== BRIDGE) {
      const key = BRIDGE_KEY + b;
      const r = this.ranges.get(key);
      if (r) {
        hideRange(this.mesh.geometry, r[0], r[1]);
        this.ranges.delete(key);
      }
    }
  }

  private collapse(i: number, toRubble: boolean): void {
    const r = this.ranges.get(i)!;
    this.ranges.delete(i);
    const geo = extractRange(this.mesh.geometry, r[0], r[1]);
    hideRange(this.mesh.geometry, r[0], r[1]);
    const x = (i % this.map.w) + 0.5;
    const z = Math.floor(i / this.map.w) + 0.5;
    const base = this.pad(i);
    geo.translate(-x, -base, -z);
    const mesh = new THREE.Mesh(geo, this.mesh.material);
    mesh.position.set(x, base, z);
    mesh.castShadow = this.cast;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    const rnd = stream(hash(this.seed, i, 9) * 4294967296);
    const depth = Math.max(0.3, this.tops[i]! - base + 0.1);
    this.collapses.push({ mesh, t: 0, dur: 1.5, base, depth, tilt: new THREE.Vector2((rnd() - 0.5) * 0.25, (rnd() - 0.5) * 0.25), cell: i, rubbleAdded: !toRubble });
  }

  /** True while a building is still coming down. */
  get busy(): boolean {
    return this.collapses.length > 0;
  }

  update(dt: number): void {
    for (let k = this.collapses.length - 1; k >= 0; k--) {
      const c = this.collapses[k]!;
      c.t = Math.min(c.dur, c.t + dt);
      const f = c.t / c.dur;
      // Slumps, then drops faster and faster into its own heap.
      const sink = f * f * c.depth;
      c.mesh.position.y = c.base - sink;
      c.mesh.rotation.set(c.tilt.x * f, 0, c.tilt.y * f);
      c.mesh.scale.set(1 + f * 0.06, 1 - f * 0.35, 1 + f * 0.06);
      if (!c.rubbleAdded && f > 0.35) {
        c.rubbleAdded = true;
        this.addRubbleChunk(c.cell);
      }
      if (c.t >= c.dur) {
        this.group.remove(c.mesh);
        c.mesh.geometry.dispose();
        this.collapses.splice(k, 1);
      }
    }
  }

  /** Finish every collapse now (tests, skipping). */
  settle(): void {
    for (const c of this.collapses) c.t = c.dur;
    this.update(0);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.rubble.geometry.dispose();
    for (const c of this.collapses) c.mesh.geometry.dispose();
    this.material.dispose();
  }
}

function deckAt0(b: Bridge, s: number): number {
  const f = (s - b.from) / (b.to - b.from);
  return b.h0 + (b.h1 - b.h0) * f + Math.sin(f * Math.PI) * 0.03;
}

export type { UVRect };

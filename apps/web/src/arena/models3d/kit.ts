import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { METRE } from '../quality';

// The geometry kit the models are built with. Everything is authored in metres, nose to +z, y up,
// +x to the vehicle's left; `finish` scales to world units. Each part carries a style that the paint
// shader reads per vertex: a tint, how much camouflage shows, roughness and metalness overrides and
// its height above the ground (for dust), so one draw call holds painted steel, rubber and glass.

export type V2 = [number, number];
export type V3 = [number, number, number];

export interface Style {
  /** sRGB hex: a shade on painted parts, the colour itself on unpainted ones. */
  tint: number;
  /** 1 shows the camouflage, 0 the tint alone. */
  paint: number;
  rough?: number;
  metal?: number;
  /** Baked darkening, 1 none. */
  ao?: number;
  /** Faces meeting at less than this many degrees are smoothed. */
  crease?: number;
}

export const S = {
  paint: { tint: 0xffffff, paint: 1 },
  shade: { tint: 0xc4c4c4, paint: 1, ao: 0.9 },
  deep: { tint: 0x8c8c8c, paint: 1, ao: 0.75 },
  smooth: { tint: 0xffffff, paint: 1, crease: 55 },
  rubber: { tint: 0x1d1d1b, paint: 0, rough: 0.95 },
  tyre: { tint: 0x222220, paint: 0, rough: 0.95, crease: 50 },
  steel: { tint: 0x45443f, paint: 0, rough: 0.42, metal: 0.75 },
  gunsteel: { tint: 0x2e2e2b, paint: 0, rough: 0.5, metal: 0.6 },
  black: { tint: 0x161615, paint: 0, rough: 0.7 },
  glass: { tint: 0x0d1418, paint: 0, rough: 0.1, metal: 0.55 },
  lens: { tint: 0x1d3038, paint: 0, rough: 0.06, metal: 0.7 },
  canvas: { tint: 0x5b5541, paint: 0, rough: 0.97 },
  tarp: { tint: 0x4a4a36, paint: 0, rough: 0.97 },
  wood: { tint: 0x5e4a33, paint: 0, rough: 0.95 },
  track: { tint: 0x34312b, paint: 0, rough: 0.8, metal: 0.4 },
  light: { tint: 0xb9c2c4, paint: 0, rough: 0.1, metal: 0.3 },
  red: { tint: 0x6a1d18, paint: 0, rough: 0.6 },
} satisfies Record<string, Style>;

/** A painted part a shade darker or lighter (1 is the plain coat). */
export function shade(k: number, extra: Partial<Style> = {}): Style {
  const v = Math.round(Math.min(1, Math.max(0, k)) * 255);
  return { tint: (v << 16) | (v << 8) | v, paint: 1, ...extra };
}

export function solid(tint: number, extra: Partial<Style> = {}): Style {
  return { tint, paint: 0, ...extra };
}

// --- Transforms ------------------------------------------------------------------------------------

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();

/** Position, then rotation (radians, XYZ), then scale. */
export function T(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx): THREE.Matrix4 {
  _q.setFromEuler(_e.set(rx, ry, rz));
  return new THREE.Matrix4().compose(_v.set(x, y, z), _q, _s.set(sx, sy, sz));
}

/** Mirror across x = 0. */
export const MIRROR = new THREE.Matrix4().makeScale(-1, 1, 1);

// --- Primitives (all in metres) -------------------------------------------------------------------------

export function box(w: number, h: number, d: number): THREE.BufferGeometry {
  return new THREE.BoxGeometry(w, h, d);
}

/** A box with its edges cut at 45 degrees by `c`. */
export function chamfer(w: number, h: number, d: number, c: number): THREE.BufferGeometry {
  const x = w / 2, y = h / 2, z = d / 2;
  const p: V3[] = [];
  for (const sx of [-1, 1])
    for (const sy of [-1, 1])
      for (const sz of [-1, 1]) {
        p.push([sx * (x - c), sy * y, sz * (z - c)]);
        p.push([sx * x, sy * (y - c), sz * (z - c)]);
        p.push([sx * (x - c), sy * (y - c), sz * z]);
      }
  return convex(p);
}

export function convex(points: V3[]): THREE.BufferGeometry {
  return new ConvexGeometry(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
}

/** Points and their mirror across x = 0. */
export function sym(points: V3[]): V3[] {
  const out: V3[] = [];
  for (const p of points) {
    out.push(p);
    if (Math.abs(p[0]) > 1e-6) out.push([-p[0], p[1], p[2]]);
  }
  return out;
}

/** A cylinder along `axis`, centred. */
export function cyl(r0: number, r1: number, len: number, segs: number, axis: 'x' | 'y' | 'z' = 'y', open = false): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r1, r0, len, segs, 1, open);
  if (axis === 'x') g.rotateZ(-Math.PI / 2);
  if (axis === 'z') g.rotateX(Math.PI / 2);
  return g;
}

/** A rod between two points. */
export function rod(a: V3, b: V3, r: number, segs = 6): THREE.BufferGeometry {
  const va = new THREE.Vector3(...a);
  const vb = new THREE.Vector3(...b);
  const len = va.distanceTo(vb);
  const g = new THREE.CylinderGeometry(r, r, len, segs, 1, true);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
  g.applyMatrix4(new THREE.Matrix4().compose(va.add(vb).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
  return g;
}

/** A square bar between two points (slats, rails, frames). */
export function bar(a: V3, b: V3, w: number, h = w): THREE.BufferGeometry {
  const va = new THREE.Vector3(...a);
  const vb = new THREE.Vector3(...b);
  const len = va.distanceTo(vb);
  const g = new THREE.BoxGeometry(w, len, h);
  const dir = vb.clone().sub(va).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  g.applyMatrix4(new THREE.Matrix4().compose(va.add(vb).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
  return g;
}

/** A solid of revolution: profile (radius, height) revolved about `axis`, height along it. */
export function lathe(profile: V2[], segs: number, axis: 'x' | 'y' | 'z' = 'y', phi0 = 0, phiLen = Math.PI * 2): THREE.BufferGeometry {
  const g = new THREE.LatheGeometry(
    profile.map(([r, h]) => new THREE.Vector2(Math.max(r, 0), h)),
    segs,
    phi0,
    phiLen,
  );
  if (axis === 'x') g.rotateZ(-Math.PI / 2);
  if (axis === 'z') g.rotateX(Math.PI / 2);
  return g;
}

/** An outline in the side plane (z, y) extruded across x from x0 to x1. */
export function sideSlab(outline: V2[], x0: number, x1: number, bevel = 0): THREE.BufferGeometry {
  const shape = new THREE.Shape(outline.map(([z, y]) => new THREE.Vector2(z, y)));
  const depth = Math.max(0.001, x1 - x0 - 2 * bevel);
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 1, curveSegments: 4 });
  // Shape x -> z, shape y -> y, depth -> x.
  g.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, x0 + bevel, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1));
  return fixWinding(g);
}

/** An outline in plan (x, z) extruded up from y0 to y1. */
export function planSlab(outline: V2[], y0: number, y1: number, bevel = 0): THREE.BufferGeometry {
  const shape = new THREE.Shape(outline.map(([x, z]) => new THREE.Vector2(x, z)));
  const depth = Math.max(0.001, y1 - y0 - 2 * bevel);
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 1, curveSegments: 4 });
  // Shape x -> x, shape y -> z, depth -> y.
  g.applyMatrix4(new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, 1, y0 + bevel, 0, 1, 0, 0, 0, 0, 0, 1));
  return fixWinding(g);
}

/** An outline in the cross plane (x, y) extruded along z from z0 to z1. */
export function crossSlab(outline: V2[], z0: number, z1: number, bevel = 0): THREE.BufferGeometry {
  const shape = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y)));
  const depth = Math.max(0.001, z1 - z0 - 2 * bevel);
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 1, curveSegments: 4 });
  g.translate(0, 0, z0 + bevel);
  return fixWinding(g);
}

/**
 * Skin a solid through rings of points (each ring the same count, in a consistent order), capping
 * both ends. Works along any axis: the winding is fixed afterwards by the signed volume.
 */
export function loft(rings: V3[][], caps: [boolean, boolean] = [true, true]): THREE.BufferGeometry {
  const pos: number[] = [];
  const n = rings[0]!.length;
  const tri = (a: V3, b: V3, c: V3) => pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  for (let i = 0; i + 1 < rings.length; i++) {
    const r0 = rings[i]!;
    const r1 = rings[i + 1]!;
    for (let j = 0; j < n; j++) {
      const k = (j + 1) % n;
      tri(r0[j]!, r0[k]!, r1[k]!);
      tri(r0[j]!, r1[k]!, r1[j]!);
    }
  }
  const cap = (r: V3[], flip: boolean) => {
    const c: V3 = [0, 0, 0];
    for (const p of r) {
      c[0] += p[0] / n;
      c[1] += p[1] / n;
      c[2] += p[2] / n;
    }
    for (let j = 0; j < n; j++) {
      const k = (j + 1) % n;
      if (flip) tri(c, r[k]!, r[j]!);
      else tri(c, r[j]!, r[k]!);
    }
  };
  if (caps[0]) cap(rings[0]!, true);
  if (caps[1]) cap(rings[rings.length - 1]!, false);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return fixWinding(g);
}

/** A ring in the cross plane at `z` from (x, y) points. */
export function ringZ(z: number, pts: V2[]): V3[] {
  return pts.map(([x, y]) => [x, y, z]);
}

/** A ring in plan at height `y` from (x, z) points. */
export function ringY(y: number, pts: V2[]): V3[] {
  return pts.map(([x, z]) => [x, y, z]);
}

/** A closed outline from its left half (x >= 0, ordered top to bottom), mirrored to the right. */
export function mirrorRing(half: V2[]): V2[] {
  const right = half.filter(([x]) => x > 1e-6).map(([x, y]) => [-x, y] as V2).reverse();
  return [...half, ...right];
}

/** A superellipse outline (n = 2 an ellipse, larger is boxier), centred, `segs` points, CCW. */
export function superellipse(rx: number, ry: number, n: number, segs: number, cy = 0, rxBottom = rx, ryBottom = ry): V2[] {
  const out: V2[] = [];
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const top = s >= 0;
    const ex = Math.sign(c) * Math.pow(Math.abs(c), 2 / n) * (top ? rx : rxBottom);
    const ey = Math.sign(s) * Math.pow(Math.abs(s), 2 / n) * (top ? ry : ryBottom);
    out.push([ex, cy + ey]);
  }
  return out;
}

/** Turn the triangles outward if the signed volume says they face in. */
export function fixWinding(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  const p = geo.attributes.position!.array as Float32Array;
  let vol = 0;
  for (let i = 0; i < p.length; i += 9) {
    const ax = p[i]!, ay = p[i + 1]!, az = p[i + 2]!;
    const bx = p[i + 3]!, by = p[i + 4]!, bz = p[i + 5]!;
    const cx = p[i + 6]!, cy = p[i + 7]!, cz = p[i + 8]!;
    vol += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  if (vol < 0) {
    for (let i = 0; i < p.length; i += 9) {
      for (let k = 0; k < 3; k++) {
        const t = p[i + 3 + k]!;
        p[i + 3 + k] = p[i + 6 + k]!;
        p[i + 6 + k] = t;
      }
    }
  }
  geo.deleteAttribute('normal');
  geo.deleteAttribute('uv');
  return geo;
}

/** Reverse every triangle (a mirrored part). */
export function flipWinding(g: THREE.BufferGeometry): void {
  const p = g.attributes.position!.array as Float32Array;
  for (let i = 0; i < p.length; i += 9) {
    for (let k = 0; k < 3; k++) {
      const t = p[i + 3 + k]!;
      p[i + 3 + k] = p[i + 6 + k]!;
      p[i + 6 + k] = t;
    }
  }
}

/** Normals smoothed across edges flatter than `deg`, kept sharp across steeper ones. */
export function creaseNormals(g: THREE.BufferGeometry, deg: number): void {
  const p = g.attributes.position!.array as Float32Array;
  const tris = p.length / 9;
  const fn = new Float32Array(tris * 3);
  for (let t = 0; t < tris; t++) {
    const i = t * 9;
    const ux = p[i + 3]! - p[i]!, uy = p[i + 4]! - p[i + 1]!, uz = p[i + 5]! - p[i + 2]!;
    const vx = p[i + 6]! - p[i]!, vy = p[i + 7]! - p[i + 1]!, vz = p[i + 8]! - p[i + 2]!;
    // Area weighted: the cross product is left unnormalised.
    fn[t * 3] = uy * vz - uz * vy;
    fn[t * 3 + 1] = uz * vx - ux * vz;
    fn[t * 3 + 2] = ux * vy - uy * vx;
  }
  const key = (i: number) => `${Math.round(p[i]! * 1e4)},${Math.round(p[i + 1]! * 1e4)},${Math.round(p[i + 2]! * 1e4)}`;
  const at = new Map<string, number[]>();
  for (let v = 0; v < tris * 3; v++) {
    const k = key(v * 3);
    const list = at.get(k);
    if (list) list.push(Math.floor(v / 3));
    else at.set(k, [Math.floor(v / 3)]);
  }
  const cos = Math.cos((deg * Math.PI) / 180);
  const out = new Float32Array(p.length);
  const unit = (t: number): V3 => {
    const x = fn[t * 3]!, y = fn[t * 3 + 1]!, z = fn[t * 3 + 2]!;
    const l = Math.hypot(x, y, z);
    return l > 1e-12 ? [x / l, y / l, z / l] : [0, 0, 0];
  };
  for (let v = 0; v < tris * 3; v++) {
    const t = Math.floor(v / 3);
    const own = unit(t);
    let sx = 0, sy = 0, sz = 0;
    for (const o of at.get(key(v * 3)) ?? []) {
      const u = unit(o);
      if (u[0] * own[0] + u[1] * own[1] + u[2] * own[2] >= cos) {
        sx += fn[o * 3]!;
        sy += fn[o * 3 + 1]!;
        sz += fn[o * 3 + 2]!;
      }
    }
    let l = Math.hypot(sx, sy, sz);
    if (l < 1e-12) {
      [sx, sy, sz] = own;
      l = Math.hypot(sx, sy, sz) || 1;
      if (l === 1 && sx === 0 && sy === 0 && sz === 0) sy = 1;
    }
    out[v * 3] = sx / l;
    out[v * 3 + 1] = sy / l;
    out[v * 3 + 2] = sz / l;
  }
  g.setAttribute('normal', new THREE.BufferAttribute(out, 3));
}

// --- Parts: geometry collected by draw call ---------------------------------------------------------

const _c = new THREE.Color();

export class Parts {
  readonly geos: THREE.BufferGeometry[] = [];
  /**
   * `base`: how high this frame's origin sits above the ground, in metres (the dust reads it). Every
   * part carries the wheel attribute, so a missing one never reads a stale value on the GPU.
   */
  constructor(public base = 0) {}

  add(g: THREE.BufferGeometry, s: Style, m?: THREE.Matrix4, wheel?: { y: number; z: number; r: number }): this {
    const geo = g.index ? g.toNonIndexed() : g.clone();
    for (const name of Object.keys(geo.attributes)) if (name !== 'position') geo.deleteAttribute(name);
    geo.morphAttributes = {};
    if (m) geo.applyMatrix4(m);
    if (m && m.determinant() < 0) flipWinding(geo);
    creaseNormals(geo, s.crease ?? 38);
    const n = geo.attributes.position!.count;
    const pos = geo.attributes.position!.array as Float32Array;
    _c.setHex(s.tint);
    const tint = new Uint8Array(n * 4);
    const aux = new Uint8Array(n * 4);
    const r = Math.round(_c.r * 255), gg = Math.round(_c.g * 255), b = Math.round(_c.b * 255);
    const pw = Math.round(s.paint * 255);
    const ao = Math.round((s.ao ?? 1) * 255);
    const ro = Math.round((s.rough ?? 0) * 255);
    const me = Math.round((s.metal ?? 0) * 255);
    for (let i = 0; i < n; i++) {
      tint[i * 4] = r;
      tint[i * 4 + 1] = gg;
      tint[i * 4 + 2] = b;
      tint[i * 4 + 3] = pw;
      const h = (pos[i * 3 + 1]! + this.base) / 5;
      aux[i * 4] = Math.round(Math.min(1, Math.max(0, h)) * 255);
      aux[i * 4 + 1] = ao;
      aux[i * 4 + 2] = ro;
      aux[i * 4 + 3] = me;
    }
    geo.setAttribute('tint', new THREE.BufferAttribute(tint, 4, true));
    geo.setAttribute('aux', new THREE.BufferAttribute(aux, 4, true));
    const hub = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      if (wheel) {
        hub[i * 4] = 1;
        hub[i * 4 + 1] = wheel.y;
        hub[i * 4 + 2] = wheel.z;
        hub[i * 4 + 3] = wheel.r;
      } else hub[i * 4 + 3] = 1;
    }
    geo.setAttribute('hub', new THREE.BufferAttribute(hub, 4));
    this.geos.push(geo);
    return this;
  }

  /** Add a part and its mirror across x = 0. */
  pair(g: THREE.BufferGeometry, s: Style, m: THREE.Matrix4): this {
    this.add(g, s, m);
    return this.add(g, s, MIRROR.clone().multiply(m));
  }

  /** Move another collection in, by a transform (the gun onto the turret on far models). */
  absorb(other: Parts, m: THREE.Matrix4): this {
    for (const g of other.geos) {
      const c = g.clone();
      c.applyMatrix4(m);
      // Moved wheels stop turning: a far model's wheels are static.
      const hub = c.attributes.hub!.array as Float32Array;
      for (let i = 0; i < hub.length; i += 4) hub[i] = 0;
      this.geos.push(c);
    }
    return this;
  }

  get tris(): number {
    let t = 0;
    for (const g of this.geos) t += g.attributes.position!.count / 3;
    return t;
  }

  /** One geometry in world units, or null when empty. */
  build(): THREE.BufferGeometry | null {
    if (!this.geos.length) return null;
    const g = mergeGeometries(this.geos, false);
    if (!g) throw new Error('models3d: parts do not merge');
    g.scale(METRE, METRE, METRE);
    const hub = g.attributes.hub as THREE.BufferAttribute | undefined;
    if (hub) {
      const a = hub.array as Float32Array;
      for (let i = 0; i < a.length; i += 4) {
        a[i + 1] = a[i + 1]! * METRE;
        a[i + 2] = a[i + 2]! * METRE;
        a[i + 3] = a[i + 3]! * METRE;
      }
    }
    const indexed = mergeVertices(g, 1e-5);
    indexed.computeBoundingSphere();
    indexed.computeBoundingBox();
    return indexed;
  }
}

// --- Detail control ---------------------------------------------------------------------------------

/** Level of detail helpers: segment counts and whether small parts are drawn. */
export class Lod {
  constructor(readonly lod: 0 | 1) {}
  get hi(): boolean {
    return this.lod === 0;
  }
  /** Segments around a round part. */
  seg(n: number, min = 4): number {
    return this.lod === 0 ? n : Math.max(min, Math.round(n / 2.5));
  }
}

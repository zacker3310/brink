import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import type { TypeId } from '@brink/arena/v2';
import { METRE } from '../quality';
import { DIMS, SOLDIER_DIMS, isFoot } from './dims';
import { newDraft, type Draft } from './draft';
import { LINKS_PER_REPEAT, blurMaterial, paintMaterial, trackMaterial, type Paint, type Scheme, type TrackKind } from './paint';
import { BUILDERS, SCHEME_OF } from './roster';
import { wrapApache } from './apache';
import { addRim } from './rim';
import { disposeOutlines, stencilled } from './outline';

// Arena v2 unit models, built in code from each designation's real dimensions and silhouette.
// Geometry is cached per type and level of detail; each unit gets its own materials (hit flash,
// wreck darkening, track scroll and wheel spin are per unit).

export type { Paint } from './paint';
export { paintFor } from './paint';
export { isFoot, kitFor, DIMS, type SoldierKit } from './dims';
export { buildProjectile } from './projectiles';
export { SoldierCrowd, type Pose } from './soldiers';
export { rimOff, setRimLight } from './rim';
export { setOutline, setOutlineView, stencilled, type OutlineRole } from './outline';

export interface UnitModel {
  /** Nose to +z, sits on y = 0, centred, real size x METRE. */
  root: THREE.Group;
  /** Yaw pivot (or the whole body for things without a turret). */
  turret: THREE.Object3D;
  /** Pitch pivot on the turret: a negative rotation.x raises the barrel. Null on far models. */
  gun: THREE.Object3D | null;
  /** Primary muzzle in the gun's (or turret's) local frame. */
  muzzle: THREE.Vector3;
  /** Spin rates in rad/s at hover, signed by the real direction. */
  rotors: { obj: THREE.Object3D; axis: 'y' | 'x'; rate: number }[];
  /**
   * Turn these about their local x when driving: `rotation.x += distance / wheelRadius` rolls every
   * wheel, sprocket and roller without slip (they turn in the shader, in one draw call).
   */
  wheels: THREE.Object3D[];
  /** Road wheel radius in world units. */
  wheelRadius: number;
  /** Track materials: scroll `map.offset.y += distance * trackScroll` when driving forward. */
  tracks: THREE.Material[];
  /** Texture repeats per world unit of travel. */
  trackScroll: number;
  /** The unit's own materials (hit flash, wreck darkening). */
  paint: THREE.Material[];
  /** Thermal view: hidden proxies over the engine deck, exhaust and barrel to show white-hot (0..1). */
  heat: { obj: THREE.Object3D; level: number }[];
  /** Flight height in world units for aircraft (0 for ground). */
  lift: number;
  /** Real size in metres. */
  dims: [number, number, number];
  /** Draw calls and triangles as built. */
  stats: { calls: number; tris: number };
  dispose(): void;
}

interface Template {
  body: THREE.BufferGeometry | null;
  track: THREE.BufferGeometry | null;
  trackKind: TrackKind;
  trackScroll: number;
  turret: THREE.BufferGeometry | null;
  turretAt: THREE.Vector3;
  gun: THREE.BufferGeometry | null;
  gunAt: THREE.Vector3;
  gunPitch: number;
  muzzle: THREE.Vector3;
  rotors: { geo: THREE.BufferGeometry | null; disc: THREE.BufferGeometry | null; blurTint: number; at: THREE.Vector3; tilt: THREE.Euler; axis: 'y' | 'x'; rate: number; parent: 'body' | 'turret' }[];
  heat: { geo: THREE.BufferGeometry; at: THREE.Vector3; level: number; parent: 'body' | 'turret' | 'gun' }[];
  wheelR: number;
  lift: number;
  dustTop: number;
  dust: number;
  dims: [number, number, number];
}

const cache = new Map<string, Template>();
const heatMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

const v = (p: [number, number, number]) => new THREE.Vector3(p[0] * METRE, p[1] * METRE, p[2] * METRE);

function template(type: TypeId, lod: 0 | 1, scheme: Scheme): Template {
  const key = `${type}:${lod}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const build = BUILDERS[type];
  const d: Draft = newDraft(lod, scheme, DIMS[type] ?? SOLDIER_DIMS);
  if (build) build(d);
  if (lod === 1 && d.gun) {
    // Far away the gun is part of the turret (or the body).
    const m = new THREE.Matrix4().makeRotationX(-d.gunPitch).setPosition(d.gunAt[0], d.gunAt[1], d.gunAt[2]);
    (d.turret ?? d.body).absorb(d.gun, m);
    const mz = new THREE.Vector3(...d.muzzle).applyMatrix4(m);
    d.muzzle = [mz.x, mz.y, mz.z];
    d.gun = null;
  }
  if (lod === 1) {
    // Far away only the main rotor turns; the rest (tail rotors, radar heads) is fixed in place.
    const keep = d.rotors.filter((r) => r.parent === 'body' && r.blur > 0).slice(0, 1);
    for (const r of d.rotors) {
      if (keep.includes(r)) continue;
      const m = new THREE.Matrix4().compose(new THREE.Vector3(...r.at), new THREE.Quaternion().setFromEuler(new THREE.Euler(...(r.tilt ?? [0, 0, 0]))), new THREE.Vector3(1, 1, 1));
      (r.parent === 'turret' && d.turret ? d.turret : d.body).absorb(r.parts, m);
    }
    d.rotors = keep;
  }
  let track: THREE.BufferGeometry | null = null;
  if (d.belts.length) {
    const parts = d.belts.map((b) => b.geo);
    track = parts.length === 1 ? parts[0]! : mergeTrack(parts);
    track.scale(METRE, METRE, METRE);
    track.computeBoundingSphere();
  }
  const t: Template = {
    body: d.body.build(),
    track,
    trackKind: d.trackKind,
    trackScroll: 1 / (LINKS_PER_REPEAT * d.pitch * METRE),
    turret: d.turret?.build() ?? null,
    turretAt: v(d.turretAt),
    gun: d.gun?.build() ?? null,
    gunAt: v(d.gunAt),
    gunPitch: d.gunPitch,
    muzzle: v(d.muzzle),
    rotors: d.rotors.map((r) => {
      let disc: THREE.BufferGeometry | null = null;
      if (r.blur > 0 && lod === 0) {
        disc = new THREE.CircleGeometry(r.blur * METRE, 40);
        if (r.axis === 'y') disc.rotateX(-Math.PI / 2);
        else disc.rotateY(Math.PI / 2);
      }
      return {
        geo: r.parts.build(),
        disc,
        blurTint: r.blurTint ?? 0x2a2a28,
        at: v(r.at),
        tilt: new THREE.Euler(...(r.tilt ?? [0, 0, 0])),
        axis: r.axis,
        rate: r.rate,
        parent: r.parent,
      };
    }),
    heat: d.heat.map((h) => ({ geo: new THREE.BoxGeometry(h.size[0] * METRE, h.size[1] * METRE, h.size[2] * METRE), at: v(h.at), level: h.level, parent: h.parent })),
    wheelR: d.wheelR * METRE,
    lift: d.lift,
    dustTop: d.dustTop,
    dust: d.dust,
    dims: d.dims,
  };
  cache.set(key, t);
  return t;
}

function mergeTrack(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (const g of parts) {
    const base = pos.length / 3;
    pos.push(...(g.attributes.position!.array as Float32Array));
    nor.push(...(g.attributes.normal!.array as Float32Array));
    uv.push(...(g.attributes.uv!.array as Float32Array));
    for (const i of g.index!.array) idx.push(i + base);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, shadows: boolean): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = shadows;
  m.receiveShadow = shadows;
  return m;
}

/** Watch a rotor's angle and fade its blur disc in with speed. */
function blurDriver(disc: THREE.Mesh, rotor: THREE.Object3D, axis: 'y' | 'x', mat: THREE.MeshStandardMaterial): void {
  let last = rotor.rotation[axis];
  let at = performance.now();
  let rate = 0;
  disc.onBeforeRender = () => {
    const now = performance.now();
    const dt = (now - at) / 1000;
    if (dt < 0.008) return;
    const a = rotor.rotation[axis];
    rate = rate * 0.6 + (Math.abs(a - last) / dt) * 0.4;
    last = a;
    at = now;
    const k = Math.min(1, Math.max(0, (rate - 4) / 14));
    mat.opacity = k * 0.95;
  };
}

/**
 * A unit's model. `apache`: the loaded AH-64 GLTF (public/art/models/heli.glb), wrapped in place of
 * the coded one when given. Foot units return an empty model: their soldiers are a `SoldierCrowd`.
 * `side`: the rim light in that side's colour, and the stencil mark that keeps outlines to its edge.
 */
export function buildModel(type: TypeId, opts: { paint: Paint; lod: 0 | 1; apache?: GLTF; side?: 'blue' | 'red' }): UnitModel {
  const m = assemble(type, opts);
  if (opts.side)
    for (const mat of m.paint) {
      addRim(mat, opts.side);
      stencilled(mat);
    }
  return m;
}

function assemble(type: TypeId, opts: { paint: Paint; lod: 0 | 1; apache?: GLTF }): UnitModel {
  if (type === 'ah64e' && opts.apache) return wrapApache(opts.apache, opts.lod);
  const scheme = SCHEME_OF[type] ?? opts.paint;
  const t = template(type, opts.lod, scheme);
  const root = new THREE.Group();
  root.name = type;
  const wheel = new THREE.Object3D();
  wheel.name = 'wheels';
  root.add(wheel);
  const paint = paintMaterial({ scheme, spin: wheel, spinRef: t.wheelR, dustTop: t.dustTop, dust: t.dust });
  const mats: THREE.Material[] = [paint];
  const tracks: THREE.Material[] = [];
  const flying = t.lift > 0;
  const hull = new THREE.Group();
  root.add(hull);
  if (t.body) hull.add(mesh(t.body, paint, true));
  if (t.track) {
    const tm = trackMaterial(t.trackKind, scheme);
    tracks.push(tm);
    mats.push(tm);
    hull.add(mesh(t.track, tm, true));
  }
  let turret: THREE.Object3D = hull;
  let gun: THREE.Object3D | null = null;
  if (t.turret) {
    turret = new THREE.Group();
    turret.name = 'turret';
    turret.position.copy(t.turretAt);
    turret.add(mesh(t.turret, paint, true));
    hull.add(turret);
  }
  if (t.gun) {
    gun = new THREE.Group();
    gun.name = 'gun';
    gun.position.copy(t.gunAt);
    gun.rotation.x = -t.gunPitch;
    gun.add(mesh(t.gun, paint, true));
    turret.add(gun);
  }
  const rotors: UnitModel['rotors'] = [];
  for (const r of t.rotors) {
    const mount = new THREE.Group();
    mount.position.copy(r.at);
    mount.rotation.copy(r.tilt);
    (r.parent === 'turret' ? turret : hull).add(mount);
    const spin = new THREE.Group();
    spin.name = 'rotor';
    mount.add(spin);
    if (r.geo) spin.add(mesh(r.geo, paint, true));
    if (r.disc) {
      const bm = blurMaterial(r.blurTint);
      mats.push(bm);
      const disc = new THREE.Mesh(r.disc, bm);
      disc.name = 'blur';
      disc.renderOrder = 2;
      spin.add(disc);
      blurDriver(disc, spin, r.axis, bm);
    }
    rotors.push({ obj: spin, axis: r.axis, rate: r.rate });
  }
  const heat: UnitModel['heat'] = [];
  for (const h of t.heat) {
    const m = new THREE.Mesh(h.geo, heatMat);
    m.visible = false;
    m.name = 'heat';
    m.position.copy(h.at);
    (h.parent === 'gun' ? (gun ?? turret) : h.parent === 'turret' ? turret : hull).add(m);
    heat.push({ obj: m, level: h.level });
  }
  const muzzle = t.muzzle.clone();
  let calls = 0;
  let tris = 0;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || o.name === 'heat') return;
    calls++;
    const g = m.geometry;
    tris += (g.index ? g.index.count : g.attributes.position!.count) / 3;
  });
  return {
    root,
    turret,
    gun,
    muzzle,
    rotors,
    wheels: t.body && !flying ? [wheel] : [],
    wheelRadius: t.wheelR,
    tracks,
    trackScroll: t.trackScroll,
    paint: mats,
    heat,
    lift: t.lift,
    dims: t.dims,
    stats: { calls, tris },
    dispose() {
      for (const m of mats) {
        const map = (m as THREE.MeshStandardMaterial).map;
        if (tracks.includes(m) && map) map.dispose();
        m.dispose();
      }
      root.removeFromParent();
    },
  };
}

/** Free every cached model geometry (when leaving the battle). */
export function disposeModels(): void {
  for (const t of cache.values()) {
    t.body?.dispose();
    t.track?.dispose();
    t.turret?.dispose();
    t.gun?.dispose();
    for (const r of t.rotors) {
      r.geo?.dispose();
      r.disc?.dispose();
    }
    for (const h of t.heat) h.geo.dispose();
  }
  cache.clear();
  disposeOutlines();
}

/** Types with a vehicle or aircraft model (foot units are soldiers). */
export function modelTypes(): TypeId[] {
  return (Object.keys(DIMS) as TypeId[]).filter((t) => !isFoot(t));
}

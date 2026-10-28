import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import type { UnitClass } from '@brink/contracts';
import { buildUnit, type UnitMesh } from './models';

// The battle's real 3D models (public/art/models, credits in public/art/CREDITS.md): a T-72 main
// battle tank, an AH-64 Apache, a quadcopter strike drone, Mixamo riflemen with a rifle-aiming
// pose, Hesco barriers, shipping containers and a watch tower; and a Poly Haven sky for image-based
// light. Loaded once, on the first battle, then shared. If they cannot load (offline on a first
// visit), the battle falls back to the primitive models in `models.ts`.

const BASE = `${import.meta.env.BASE_URL}art/`;
/** World units per metre: a cell is about eight metres of ground. */
export const METRE = 1 / 8;

export interface Library {
  tank: GLTF;
  heli: GLTF;
  drone: GLTF;
  soldiers: GLTF[];
  aim: THREE.AnimationClip | null;
  hesco: GLTF;
  container: GLTF;
  tower: GLTF;
  env: THREE.DataTexture;
}

let library: Promise<Library> | null = null;

export function loadLibrary(): Promise<Library> {
  if (library) return library;
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const glb = (name: string) => loader.loadAsync(`${BASE}models/${name}.glb`);
  library = Promise.all([
    glb('tank'),
    glb('heli'),
    glb('drone'),
    Promise.all([glb('soldier0'), glb('soldier1'), glb('soldier2')]),
    glb('rifle_aim'),
    glb('hesco'),
    glb('container'),
    glb('tower'),
    new EXRLoader().loadAsync(`${BASE}env/park.exr`),
  ]).then(([tank, heli, drone, soldiers, aim, hesco, container, tower, env]) => {
    env.mapping = THREE.EquirectangularReflectionMapping;
    return { tank, heli, drone, soldiers, aim: aim.animations[0] ?? null, hesco, container, tower, env };
  });
  // A failed load is retried on the next battle.
  library.catch(() => {
    library = null;
  });
  return library;
}

/** Scale so the longest horizontal side is `metres`, sit on the ground, centre on the origin. */
export function normalise(obj: THREE.Object3D, metres: number): THREE.Object3D {
  obj.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  obj.scale.multiplyScalar((metres * METRE) / Math.max(size.x, size.z));
  obj.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(obj);
  const c = box.getCenter(new THREE.Vector3());
  obj.position.x -= c.x;
  obj.position.z -= c.z;
  obj.position.y -= box.min.y;
  obj.updateMatrixWorld(true);
  return obj;
}

function shadows(o: THREE.Object3D, receive = false): void {
  o.traverse((m) => {
    if ((m as THREE.Mesh).isMesh) {
      m.castShadow = true;
      m.receiveShadow = receive;
    }
  });
}

/** Give every mesh its own material, so one unit's hit flash or wreck does not paint the rest. */
function ownMaterials(o: THREE.Object3D): THREE.MeshStandardMaterial[] {
  const out: THREE.MeshStandardMaterial[] = [];
  o.traverse((m) => {
    const mesh = m as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map((x) => (x as THREE.MeshStandardMaterial).clone());
    mesh.material = Array.isArray(mesh.material) ? mats : mats[0]!;
    out.push(...mats);
  });
  return out;
}

/** The T-72's steel, for parts built onto its chassis. */
function steelOf(lib: Library): THREE.MeshStandardMaterial {
  let mat: THREE.MeshStandardMaterial | null = null;
  lib.tank.scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && !mat) mat = (o as THREE.Mesh).material as THREE.MeshStandardMaterial;
  });
  const m = (mat as THREE.MeshStandardMaterial | null)?.clone() ?? new THREE.MeshStandardMaterial({ color: 0x6b6243 });
  // A plain coat for boxes: an atlas texture smears on them.
  m.map = null;
  m.color.set(0x5f5a3e);
  m.roughness = 0.8;
  m.metalness = 0.25;
  return m;
}

const gunMetal = new THREE.MeshStandardMaterial({ color: 0x2a2c26, roughness: 0.55, metalness: 0.6 });

function box(g: THREE.Object3D, mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w * METRE, h * METRE, d * METRE), mat);
  m.position.set(x * METRE, y * METRE, z * METRE);
  g.add(m);
  return m;
}

/** A barrel along +z (the models' forward), in metres. */
function tube(g: THREE.Object3D, mat: THREE.Material, r: number, len: number, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r * METRE, r * METRE * 1.1, len * METRE, 12), mat);
  m.rotation.x = Math.PI / 2;
  m.position.set(x * METRE, y * METRE, (z + len / 2) * METRE);
  g.add(m);
  return m;
}

/**
 * A T-72, nose to +z, with its turret on a pivot at the turret ring so it can traverse.
 * `keepTurret` false: the bare chassis, and the pivot is where a new turret goes.
 */
function tankModel(lib: Library, metres: number, keepTurret: boolean): { root: THREE.Group; pivot: THREE.Group; deck: number } {
  const t = normalise(lib.tank.scene.clone(true), metres);
  const root = new THREE.Group();
  root.add(t);
  root.updateMatrixWorld(true);
  const turret = t.getObjectByName('turret');
  const hull = t.getObjectByName('hull');
  const pivot = new THREE.Group();
  const deck = hull ? new THREE.Box3().setFromObject(hull).max.y : 0.25;
  if (turret) {
    const ring = new THREE.Box3().setFromObject(turret).getCenter(new THREE.Vector3());
    pivot.position.set(ring.x, keepTurret ? 0 : deck, ring.z);
    root.add(pivot);
    root.updateMatrixWorld(true);
    if (keepTurret) pivot.attach(turret);
    else turret.removeFromParent();
  } else root.add(pivot);
  return { root, pivot, deck };
}

export interface RealUnit extends UnitMesh {
  mixer: THREE.AnimationMixer | null;
  /** Where shots leave from, in the turret's frame. */
  muzzle: THREE.Vector3;
}

/**
 * A unit's model, facing +z, sized for the field (vehicles a touch larger than life so they read on
 * a phone). The caller turns +z to the unit's heading.
 */
export function realUnit(lib: Library, cls: UnitClass): RealUnit {
  const steel = steelOf(lib);
  let root = new THREE.Group();
  let turret: THREE.Object3D = new THREE.Group();
  const rotors: THREE.Object3D[] = [];
  let lift = 0;
  let mixer: THREE.AnimationMixer | null = null;
  const muzzle = new THREE.Vector3(0, 0.2, 0.6);

  if (cls === 'armor') {
    const t = tankModel(lib, 10.5, true);
    root = t.root;
    turret = t.pivot;
    muzzle.set(0, 2.1 * METRE, 6.2 * METRE);
  } else if (cls === 'mechanized') {
    // A heavy IFV on the T-72 chassis: a low two-man turret with a 30 mm autocannon.
    const t = tankModel(lib, 9.5, false);
    root = t.root;
    turret = t.pivot;
    const top = new THREE.Group();
    turret.add(top);
    box(top, steel, 2.2, 0.8, 2.4, 0, 0.4, 0);
    box(top, steel, 1.8, 0.5, 0.9, 0, 0.3, -1.5);
    tube(top, gunMetal, 0.08, 2.8, 0.35, 0.55, 0.9);
    box(top, gunMetal, 0.5, 0.45, 0.6, -0.65, 0.95, -0.2);
    box(top, gunMetal, 0.35, 0.35, 0.8, 0.85, 0.6, 0.3);
    muzzle.set(0.35 * METRE, (t.deck / METRE + 0.55) * METRE, 3.7 * METRE);
  } else if (cls === 'artillery') {
    // A 2S19-style 152 mm self-propelled howitzer on the same chassis.
    const t = tankModel(lib, 10, false);
    root = t.root;
    turret = t.pivot;
    const top = new THREE.Group();
    turret.add(top);
    box(top, steel, 3.4, 1.5, 3.6, 0, 0.75, -0.3);
    box(top, steel, 2.6, 0.7, 1.0, 0, 0.6, -2.5);
    box(top, gunMetal, 0.6, 0.4, 0.6, 0.9, 1.7, -0.6);
    const mount = new THREE.Group();
    mount.position.set(0, 0.9 * METRE, 1.4 * METRE);
    mount.rotation.x = -0.28;
    top.add(mount);
    tube(mount, gunMetal, 0.14, 7.2, 0, 0, 0);
    tube(mount, gunMetal, 0.22, 0.8, 0, 0, 7.0);
    muzzle.set(0, 3.0 * METRE, 8.4 * METRE);
  } else if (cls === 'recon') {
    // A BRDM-2 style armoured scout car, in the T-72's paint.
    const dark = steel.clone();
    dark.color.multiplyScalar(0.8);
    box(root, steel, 2.3, 1.1, 5.0, 0, 1.15, -0.1);
    const nose = box(root, dark, 2.1, 0.7, 1.4, 0, 1.25, 2.6);
    nose.rotation.x = 0.45;
    box(root, dark, 1.7, 0.14, 0.9, 0, 1.75, 1.4);
    for (const x of [-1.15, 1.15])
      for (const z of [-1.8, 1.7]) {
        const w = new THREE.Mesh(new THREE.CylinderGeometry(0.55 * METRE, 0.55 * METRE, 0.4 * METRE, 16), gunMetal);
        w.rotation.z = Math.PI / 2;
        w.position.set(x * METRE, 0.55 * METRE, z * METRE);
        root.add(w);
      }
    turret.position.set(0, 1.7 * METRE, -0.4 * METRE);
    const tur = new THREE.Mesh(new THREE.CylinderGeometry(0.62 * METRE, 0.72 * METRE, 0.6 * METRE, 12), steel);
    tur.position.y = 0.3 * METRE;
    turret.add(tur);
    tube(turret, gunMetal, 0.06, 1.8, 0, 0.35, 0.3);
    root.add(turret);
    root.scale.setScalar(1.25);
    muzzle.set(0, 0.35 * METRE, 2.1 * METRE);
  } else if (cls === 'infantry') {
    // A fireteam of four in a loose wedge, rifles up.
    const spots: [number, number][] = [
      [0, 1.6],
      [-1.5, 0],
      [1.5, -0.2],
      [0.2, -1.6],
    ];
    turret = new THREE.Group();
    root.add(turret);
    mixer = new THREE.AnimationMixer(turret);
    spots.forEach(([x, z], i) => {
      const s = SkeletonUtils.clone(lib.soldiers[i % lib.soldiers.length]!.scene);
      normaliseHeight(s, 1.8 * 1.35);
      s.position.x += x * METRE * 1.6;
      s.position.z += z * METRE * 1.6;
      s.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) o.frustumCulled = false;
      });
      turret.add(s);
      if (lib.aim) {
        const action = mixer!.clipAction(lib.aim, s);
        action.time = i * 0.37;
        action.play();
      }
    });
    muzzle.set(0, 1.4 * METRE * 1.35, 0.4);
  } else if (cls === 'air') {
    const h = normalise(lib.heli.scene.clone(true), 17.7 * 0.62);
    // The Apache's nose is along +x in its file; turn it to +z.
    h.rotation.y = -Math.PI / 2;
    turret = new THREE.Group();
    turret.add(h);
    root.add(turret);
    const rotor = h.getObjectByName('heli_rotor');
    const tail = h.getObjectByName('heli_tail');
    if (rotor) rotors.push(rotor);
    if (tail) rotors.push(tail);
    lift = 2.0;
    muzzle.set(0, 0, 1.0);
  } else {
    const d = normalise(lib.drone.scene.clone(true), 3 * 2.6);
    turret = new THREE.Group();
    turret.add(d);
    root.add(turret);
    lift = 1.3;
    muzzle.set(0, 0, 0.3);
  }
  shadows(root);
  const paint = ownMaterials(root);
  return { root, turret, rotors, lift, paint, mixer, muzzle };
}

function normaliseHeight(o: THREE.Object3D, metres: number): void {
  o.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(o);
  const h = box.max.y - box.min.y || 1;
  o.scale.multiplyScalar((metres * METRE) / h);
  o.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(o);
  o.position.y -= b.min.y;
}

/** The primitive model, when the real ones are not available. */
export function fallbackUnit(cls: UnitClass, color: string): RealUnit {
  const m = buildUnit(cls, color);
  m.root.position.y = 0;
  // These are built nose to +x: turn them to +z like the real ones.
  m.root.rotation.y = -Math.PI / 2;
  const root = new THREE.Group();
  root.add(m.root);
  return { ...m, root, mixer: null, muzzle: new THREE.Vector3(0.6, 0.2, 0) };
}

/** A prop scaled to `metres` along its longest side (Hesco, containers, the tower). */
export function prop(src: GLTF, metres: number): THREE.Object3D {
  const o = normalise(src.scene.clone(true), metres);
  shadows(o, true);
  return o;
}

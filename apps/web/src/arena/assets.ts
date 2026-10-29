import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

// The battle's sourced 3D models (public/art/models, credits in public/art/CREDITS.md), both CC BY
// 4.0: the AH-64D Apache (rotors separated) and the Hesco barrier. Everything else on the field is
// built in code (models3d/, world/). Loaded once, on the first
// battle, then shared and cached offline by the service worker; if they cannot load (offline on a
// first visit), the battle uses its code-built Apache and walls instead.

const BASE = `${import.meta.env.BASE_URL}art/`;

export interface Library {
  heli: GLTF;
  hesco: GLTF;
}

let library: Promise<Library> | null = null;

export function loadLibrary(): Promise<Library> {
  if (library) return library;
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const glb = (name: string) => loader.loadAsync(`${BASE}models/${name}.glb`);
  library = Promise.all([glb('heli'), glb('hesco')]).then(([heli, hesco]) => ({ heli, hesco }));
  // A failed load is retried on the next battle.
  library.catch(() => {
    library = null;
  });
  return library;
}

/** Scale so the longest horizontal side is `metres` (at `perMetre` world units a metre), sit on the ground, centre on the origin. */
export function normalise(obj: THREE.Object3D, metres: number, perMetre: number): THREE.Object3D {
  obj.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  obj.scale.multiplyScalar((metres * perMetre) / Math.max(size.x, size.z));
  obj.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(obj);
  const c = box.getCenter(new THREE.Vector3());
  obj.position.x -= c.x;
  obj.position.z -= c.z;
  obj.position.y -= box.min.y;
  obj.updateMatrixWorld(true);
  return obj;
}

import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { LEVEL, METRE } from '../quality';
import type { UnitModel } from './index';

// The CC BY 4.0 AH-64D model (public/art/models/heli.glb, rotors separated), wrapped like the coded
// models: normalised to the AH-64E's real size, nose to +z, its two rotors spinning about local y and
// x, with the Longbow radome added over the mast.

/** Length with the rotors turning, metres. */
const LENGTH = 17.73;

export function wrapApache(g: GLTF, _lod: 0 | 1): UnitModel {
  const src = g.scene.clone(true);
  // The file's nose is along +x: turn it to +z, then scale so its longest side is the real length.
  const holder = new THREE.Group();
  src.rotation.y = -Math.PI / 2;
  holder.add(src);
  holder.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(holder);
  const size = box.getSize(new THREE.Vector3());
  holder.scale.setScalar((LENGTH * METRE) / Math.max(size.x, size.z));
  holder.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(holder);
  const c = box.getCenter(new THREE.Vector3());
  holder.position.set(-c.x, -box.min.y, -c.z);
  const root = new THREE.Group();
  root.name = 'ah64e';
  root.add(holder);
  root.updateMatrixWorld(true);

  // Own materials, so one helicopter's hit flash leaves the others alone.
  const paint: THREE.Material[] = [];
  src.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = true;
    m.receiveShadow = true;
    const mats = (Array.isArray(m.material) ? m.material : [m.material]).map((x) => x.clone());
    m.material = Array.isArray(m.material) ? mats : mats[0]!;
    paint.push(...mats);
  });

  const rotors: UnitModel['rotors'] = [];
  const main = src.getObjectByName('heli_rotor');
  const tail = src.getObjectByName('heli_tail');
  if (main) rotors.push({ obj: main, axis: 'y', rate: 30.3 });
  if (tail) {
    // The tail rotor turns about its own z: give it a pivot whose x is that axis.
    const q = tail.getWorldQuaternion(new THREE.Quaternion());
    const pivot = new THREE.Group();
    pivot.position.copy(tail.getWorldPosition(new THREE.Vector3()));
    pivot.quaternion.copy(q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2)));
    root.add(pivot);
    root.updateMatrixWorld(true);
    pivot.attach(tail);
    rotors.push({ obj: pivot, axis: 'x', rate: 147 });
  }

  // Longbow fire control radar dome on the mast above the main rotor.
  const dome = new THREE.Mesh(
    new THREE.LatheGeometry(
      [
        new THREE.Vector2(0.001, 0),
        new THREE.Vector2(0.5, 0.05),
        new THREE.Vector2(0.56, 0.3),
        new THREE.Vector2(0.4, 0.5),
        new THREE.Vector2(0.001, 0.56),
      ].map((p) => p.multiplyScalar(METRE)),
      16,
    ),
    new THREE.MeshStandardMaterial({ color: 0x3a3f35, roughness: 0.75, metalness: 0.1 }),
  );
  paint.push(dome.material);
  dome.castShadow = true;
  if (main) {
    const hub = new THREE.Box3().setFromObject(main);
    const at = hub.getCenter(new THREE.Vector3());
    dome.position.set(at.x, hub.max.y + 0.35 * METRE, at.z);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.12 * METRE, 0.12 * METRE, 0.4 * METRE, 8), dome.material);
    mast.position.set(at.x, hub.max.y + 0.15 * METRE, at.z);
    root.add(mast);
  }
  root.add(dome);

  const heat: UnitModel['heat'] = [];
  const exhaust = new THREE.Mesh(new THREE.BoxGeometry(2.4 * METRE, 0.5 * METRE, 0.6 * METRE), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  exhaust.visible = false;
  exhaust.name = 'heat';
  exhaust.position.set(0, 2.3 * METRE, -1.5 * METRE);
  root.add(exhaust);
  heat.push({ obj: exhaust, level: 1 });

  let calls = 0;
  let tris = 0;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || o.name === 'heat') return;
    const groups = Math.max(1, m.geometry.groups.length);
    calls += groups;
    tris += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position!.count) / 3;
  });

  return {
    root,
    turret: root,
    gun: null,
    muzzle: new THREE.Vector3(0, 0.9 * METRE, 5.5 * METRE),
    rotors,
    wheels: [],
    wheelRadius: 0.3 * METRE,
    tracks: [],
    trackScroll: 0,
    paint,
    heat,
    lift: 2.5 * LEVEL,
    dims: [15.06, 14.63, 4.95],
    stats: { calls, tris },
    dispose() {
      for (const m of paint) m.dispose();
      dome.geometry.dispose();
      exhaust.geometry.dispose();
      root.removeFromParent();
    },
  };
}

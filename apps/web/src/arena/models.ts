import * as THREE from 'three';
import type { UnitClass } from '@brink/contracts';

// Arena vehicles, built from primitives so they load instantly on a phone: a main battle tank, an
// IFV, a self-propelled howitzer, a wheeled scout car, a rifle squad, an attack helicopter and a
// strike drone. Painted in their nation's field colour with a bright recognition panel on top.

export interface UnitMesh {
  root: THREE.Group;
  /** Turns with the weapon (turret, gun, the squad's facing). */
  turret: THREE.Object3D;
  /** Spins (rotors). */
  rotors: THREE.Object3D[];
  /** Height the model flies at. */
  lift: number;
  /** Materials to flash when hit. */
  paint: THREE.MeshStandardMaterial[];
}

const dark = new THREE.MeshStandardMaterial({ color: 0x1c1d1a, roughness: 0.9 });
const metal = new THREE.MeshStandardMaterial({ color: 0x2b2d2a, roughness: 0.6, metalness: 0.4 });
const glass = new THREE.MeshStandardMaterial({ color: 0x1f2b33, roughness: 0.2, metalness: 0.6 });
const skin = new THREE.MeshStandardMaterial({ color: 0xc69c7a, roughness: 0.8 });

/** Field paint: the nation colour pushed toward olive drab, so it reads military but still says who. */
function fieldColor(nation: string): THREE.Color {
  const c = new THREE.Color(nation);
  const olive = new THREE.Color(0x5b6236);
  return olive.lerp(c, 0.42);
}

function box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function cyl(r: number, len: number, mat: THREE.Material, seg = 10): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), mat);
  m.castShadow = true;
  return m;
}

/** A gun barrel along +x from the turret centre. */
function barrel(len: number, r: number, mat: THREE.Material, y: number, x0 = 0): THREE.Mesh {
  const b = cyl(r, len, mat, 8);
  b.rotation.z = Math.PI / 2;
  b.position.set(x0 + len / 2, y, 0);
  return b;
}

function tracks(g: THREE.Group, len: number, width: number, h: number): void {
  for (const s of [-1, 1]) {
    g.add(box(len, h, 0.16, dark, 0, h / 2, (s * (width - 0.16)) / 2));
    for (let i = 0; i < 5; i++) {
      const w = cyl(h * 0.42, 0.17, metal, 8);
      w.rotation.x = Math.PI / 2;
      w.position.set(-len / 2 + 0.1 + (i * (len - 0.2)) / 4, h * 0.42, (s * (width - 0.16)) / 2);
      g.add(w);
    }
  }
}

function panel(color: THREE.Color, w: number, d: number, y: number, x = 0): THREE.Mesh {
  const m = box(w, 0.02, d, new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35, roughness: 0.5 }), x, y, 0);
  m.castShadow = false;
  return m;
}

export function buildUnit(cls: UnitClass, nation: string): UnitMesh {
  const root = new THREE.Group();
  const turret = new THREE.Group();
  const rotors: THREE.Object3D[] = [];
  const body = new THREE.MeshStandardMaterial({ color: fieldColor(nation), roughness: 0.82, metalness: 0.12 });
  const bright = new THREE.Color(nation);
  const paint = [body];
  let lift = 0;

  if (cls === 'armor') {
    tracks(root, 1.0, 0.66, 0.2);
    root.add(box(0.98, 0.18, 0.5, body, 0, 0.27, 0));
    root.add(box(0.2, 0.1, 0.5, body, 0.48, 0.24, 0)); // glacis
    turret.position.set(-0.05, 0.36, 0);
    turret.add(box(0.46, 0.17, 0.42, body, 0, 0.08, 0));
    turret.add(box(0.14, 0.08, 0.14, metal, -0.08, 0.2, 0.1)); // commander's hatch
    turret.add(barrel(0.66, 0.035, metal, 0.09, 0.2));
    turret.add(panel(bright, 0.22, 0.24, 0.17, -0.05));
  } else if (cls === 'mechanized') {
    tracks(root, 0.96, 0.6, 0.18);
    root.add(box(0.94, 0.3, 0.5, body, 0, 0.32, 0));
    root.add(box(0.22, 0.14, 0.5, body, 0.42, 0.3, 0));
    root.add(box(0.12, 0.2, 0.36, metal, -0.48, 0.3, 0)); // rear ramp
    turret.position.set(0.05, 0.48, 0);
    turret.add(box(0.28, 0.12, 0.28, body, 0, 0.06, 0));
    turret.add(barrel(0.42, 0.02, metal, 0.07, 0.12));
    turret.add(panel(bright, 0.3, 0.3, 0.005, -0.3));
  } else if (cls === 'artillery') {
    tracks(root, 1.04, 0.66, 0.2);
    root.add(box(1.0, 0.2, 0.54, body, 0, 0.28, 0));
    turret.position.set(-0.12, 0.38, 0);
    turret.add(box(0.56, 0.3, 0.48, body, 0, 0.15, 0));
    const gun = barrel(0.8, 0.045, metal, 0, 0);
    const mount = new THREE.Group();
    mount.position.set(0.24, 0.2, 0);
    mount.rotation.z = 0.32;
    mount.add(gun);
    turret.add(mount);
    turret.add(panel(bright, 0.24, 0.3, 0.31, -0.1));
  } else if (cls === 'recon') {
    root.add(box(0.82, 0.22, 0.42, body, 0, 0.3, 0));
    root.add(box(0.22, 0.12, 0.42, body, 0.38, 0.28, 0));
    root.add(box(0.2, 0.08, 0.36, glass, 0.26, 0.42, 0));
    for (const x of [-0.26, 0.26])
      for (const z of [-0.23, 0.23]) {
        const w = cyl(0.13, 0.1, dark, 12);
        w.rotation.x = Math.PI / 2;
        w.position.set(x, 0.13, z);
        root.add(w);
      }
    turret.position.set(-0.08, 0.42, 0);
    turret.add(cyl(0.1, 0.1, body, 10));
    turret.add(barrel(0.3, 0.014, metal, 0.04, 0.05));
    turret.add(panel(bright, 0.16, 0.16, 0.06));
  } else if (cls === 'infantry') {
    // A fireteam of three.
    const fatigue = new THREE.MeshStandardMaterial({ color: fieldColor(nation).multiplyScalar(0.85), roughness: 0.9 });
    paint.push(fatigue);
    for (const [x, z] of [
      [0.12, 0],
      [-0.12, -0.17],
      [-0.12, 0.17],
    ] as const) {
      const man = new THREE.Group();
      man.position.set(x, 0, z);
      man.add(box(0.1, 0.16, 0.14, fatigue, 0, 0.26, 0));
      man.add(box(0.08, 0.16, 0.12, dark, 0, 0.09, 0));
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), skin);
      head.position.y = 0.39;
      man.add(head);
      const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), fatigue);
      helmet.position.y = 0.4;
      man.add(helmet);
      man.add(barrel(0.2, 0.012, dark, 0.27, 0.02));
      turret.add(man);
    }
    turret.add(panel(bright, 0.12, 0.12, 0.47, 0.12));
  } else if (cls === 'air') {
    lift = 1.7;
    const hull = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.5, 4, 10), body);
    hull.rotation.z = Math.PI / 2;
    hull.position.y = 0.2;
    hull.castShadow = true;
    turret.add(hull);
    turret.add(box(0.2, 0.1, 0.2, glass, 0.26, 0.3, 0));
    const tail = box(0.62, 0.07, 0.07, body, -0.55, 0.24, 0);
    turret.add(tail);
    turret.add(box(0.12, 0.2, 0.03, body, -0.84, 0.34, 0));
    turret.add(box(0.16, 0.03, 0.6, body, 0, 0.16, 0)); // stub wings
    for (const z of [-0.28, 0.28]) {
      const pod = cyl(0.04, 0.22, metal, 8);
      pod.rotation.z = Math.PI / 2;
      pod.position.set(0.02, 0.11, z);
      turret.add(pod);
    }
    const rotor = new THREE.Group();
    rotor.position.y = 0.43;
    for (const r of [0, Math.PI / 2]) {
      const blade = box(1.5, 0.015, 0.06, dark, 0, 0, 0);
      blade.rotation.y = r;
      rotor.add(blade);
    }
    turret.add(rotor);
    rotors.push(rotor);
    const tailRotor = new THREE.Group();
    tailRotor.position.set(-0.86, 0.34, 0.04);
    tailRotor.add(box(0.03, 0.3, 0.01, dark));
    turret.add(tailRotor);
    rotors.push(tailRotor);
    turret.add(panel(bright, 0.2, 0.14, 0.36, -0.05));
  } else {
    // Strike drone: an X-frame quadcopter.
    lift = 1.25;
    turret.add(box(0.16, 0.06, 0.16, body, 0, 0, 0));
    for (const a of [Math.PI / 4, -Math.PI / 4]) {
      const arm = box(0.5, 0.03, 0.04, dark);
      arm.rotation.y = a;
      turret.add(arm);
    }
    for (const [x, z] of [
      [0.18, 0.18],
      [0.18, -0.18],
      [-0.18, 0.18],
      [-0.18, -0.18],
    ] as const) {
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.01, 12), new THREE.MeshStandardMaterial({ color: 0x111111, transparent: true, opacity: 0.45 }));
      disc.position.set(x, 0.04, z);
      turret.add(disc);
      rotors.push(disc);
    }
    turret.add(panel(bright, 0.1, 0.1, 0.035));
  }
  root.add(turret);
  root.position.y = lift;
  return { root, turret, rotors, lift, paint };
}

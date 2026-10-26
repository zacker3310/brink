import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

const RES = 4; // texture px per world px
const loader = new GLTFLoader();
const draco = new DRACOLoader();
draco.setDecoderPath('./node_modules/three/examples/jsm/libs/draco/gltf/');
loader.setDRACOLoader(draco);
loader.setMeshoptDecoder(MeshoptDecoder);
const cache = new Map();
const load = (url) => {
  if (!cache.has(url)) cache.set(url, loader.loadAsync(url));
  return cache.get(url);
};

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

/** Scale `obj` so its longest horizontal side is `metres`, sit it on the ground, centre it. */
function normalise(obj, metres) {
  obj.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  obj.scale.multiplyScalar(metres / Math.max(size.x, size.z));
  obj.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(obj);
  const c = box.getCenter(new THREE.Vector3());
  obj.position.x -= c.x;
  obj.position.z -= c.z;
  obj.position.y -= box.min.y;
  obj.updateMatrixWorld(true);
  return obj;
}

/** Repaint a vehicle in flat military paint: wheels and tyres black, everything else `color`. */
function paint(obj, color) {
  const body = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.15 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x151614, roughness: 0.95 });
  obj.traverse((o) => {
    if (!o.isMesh) return;
    let wheel = false;
    for (let p = o; p; p = p.parent) if (/wheel/i.test(p.name)) wheel = true;
    o.material = wheel ? rubber : body;
  });
  return obj;
}

/** Darken a model's own materials toward `color` (keeps its texture detail). */
function shade(obj, color, amount = 0.7) {
  const col = new THREE.Color(color);
  obj.traverse((o) => {
    if (!o.isMesh) return;
    o.material = o.material.clone();
    o.material.color.lerp(col, amount);
  });
  return obj;
}

async function soldier(i, t = 0.6) {
  const g = await load(`./assets/im/sol_${i % 3}.glb`);
  const anim = await load('./assets/im/anim_rifle_aiming_idle.glb');
  const s = SkeletonUtils.clone(g.scene);
  const mixer = new THREE.AnimationMixer(s);
  mixer.clipAction(anim.animations[0]).play();
  mixer.setTime(t + i * 0.37);
  s.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
  return s;
}

/** A towed 155 mm howitzer in firing position, built from primitives. */
function howitzer() {
  const g = new THREE.Group();
  const olive = new THREE.MeshStandardMaterial({ color: 0x4d5236, roughness: 0.8, metalness: 0.2 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1d1f1a, roughness: 0.9 });
  const add = (geo, mat, x, y, z, ry = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.y = ry; m.rotation.z = rz; m.castShadow = true; g.add(m); return m; };
  add(new THREE.CylinderGeometry(0.11, 0.13, 5.6, 12), olive, 2.2, 1.35, 0, 0, Math.PI / 2 - 0.12);
  add(new THREE.BoxGeometry(0.35, 0.3, 0.3), dark, 5.0, 1.68, 0);
  add(new THREE.BoxGeometry(2.0, 0.55, 0.8), olive, 0.2, 1.05, 0);
  add(new THREE.BoxGeometry(1.0, 0.9, 1.6), olive, -0.2, 0.75, 0);
  for (const s of [-1, 1]) {
    add(new THREE.BoxGeometry(4.0, 0.18, 0.28), olive, -2.0, 0.25, s * 0.95, s * 0.32);
    add(new THREE.CylinderGeometry(0.5, 0.5, 0.35, 16), dark, 0.1, 0.5, s * 1.05).rotation.x = Math.PI / 2;
  }
  return g;
}

/** The T-72's own painted steel, to dress other vehicles built on its chassis. */
async function tankSteel() {
  const g = await load('./assets/im/tank.glb');
  let mat = null;
  g.scene.traverse((o) => { if (o.isMesh && !mat) mat = o.material; });
  return mat;
}

/** A T-72 facing east with its turret removed (the chassis the 2S19 and heavy IFVs are built on),
 * and the ring where that turret sat, so new turrets go exactly there. */
async function chassis() {
  const t = normalise((await load('./assets/im/tank.glb')).scene.clone(), 9.5);
  const g = east(t);
  g.updateMatrixWorld(true);
  const ring = new THREE.Box3().setFromObject(t.getObjectByName('turret')).getCenter(new THREE.Vector3());
  const hull = new THREE.Box3().setFromObject(t.getObjectByName('hull'));
  t.getObjectByName('turret').visible = false;
  return { g, ring, deck: hull.max.y };
}

const boxOn = (g, mat, w, h, d, x, y, z, ry = 0) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.rotation.y = ry;
  g.add(m);
  return m;
};
const tube = (g, mat, r, len, x, y, z) => {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 12), mat);
  m.rotation.z = Math.PI / 2;
  m.position.set(x + len / 2, y, z);
  g.add(m);
  return m;
};

/** Render a group lying on the ground (or flying) to a transparent PNG data URL. */
function shoot(group, worldPx, { shadow = true, margin = 1.25 } = {}) {
  const scene = new THREE.Scene();
  scene.add(group);
  group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
  scene.add(new THREE.HemisphereLight(0xdfe8f0, 0x3a3326, 1.1));
  const sun = new THREE.DirectionalLight(0xfff2dc, 2.6);
  sun.position.set(-30, 60, -30);
  sun.castShadow = shadow;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.radius = 4;
  const box = new THREE.Box3().setFromObject(group);
  const size = box.getSize(new THREE.Vector3());
  const span = Math.max(size.x, size.z) * margin;
  Object.assign(sun.shadow.camera, { left: -span, right: span, top: span, bottom: -span, near: 1, far: 200 });
  sun.target.position.set(0, 0, 0);
  scene.add(sun, sun.target);
  if (shadow) {
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(span * 4, span * 4), new THREE.ShadowMaterial({ opacity: 0.5 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0.01;
    ground.receiveShadow = true;
    scene.add(ground);
  }
  const px = Math.round(worldPx * RES * margin);
  renderer.setSize(px, px, false);
  const half = span / 2;
  const cam = new THREE.OrthographicCamera(-half, half, half, -half, 0.1, 500);
  cam.position.set(0, 200, 0);
  cam.up.set(0, 0, -1);
  cam.lookAt(0, 0, 0);
  renderer.setClearColor(0x000000, 0);
  renderer.render(scene, cam);
  return { url: renderer.domElement.toDataURL('image/png'), px, metres: span };
}

/** Face +z forward models east (+x on the image). */
const east = (o, yaw = Math.PI / 2) => { const g = new THREE.Group(); o.rotation.y += yaw; g.add(o); return g; };

window.renderAll = async () => {
  const out = {};
  // Armour: T-72 main battle tank.
  const tank = normalise((await load('./assets/im/tank.glb')).scene.clone(), 9.5);
  out.armor = shoot(east(tank), 32);
  // Aviation: AH-64D airframe and its rotor, separately so the rotor can turn.
  const heliG = await load('./assets/im/heli.glb');
  // Normalise the whole aircraft (rotor disc included) to the Apache's 17.7 m, then split it.
  const heli = normalise(heliG.scene.clone(), 17.7);
  const underRotor = (o) => { for (let p = o; p; p = p.parent) if (p.name === 'heli_rotor') return true; return false; };
  const body = heli.clone();
  body.traverse((o) => { if (o.isMesh) o.visible = !underRotor(o); });
  out.air = shoot(east(body, 0), 44, { shadow: false, margin: 1.05 });
  const rotor = heli.clone();
  rotor.traverse((o) => { if (o.isMesh) o.visible = underRotor(o); });
  out.air_rotor = shoot(east(rotor, 0), 44, { shadow: false, margin: 1.05 });
  // Drone: a quadcopter, oversized so it reads on the map.
  const drone = shade(normalise((await load('./assets/tz/drone.glb')).scene.clone(), 3), 0x2b2f2c, 0.75);
  out.drone = shoot(drone, 11, { shadow: false });
  // Solid paint matched to the T-72's hull, for parts built here (an atlas texture would smear on boxes).
  const steel = new THREE.MeshStandardMaterial({ color: 0x6b6243, roughness: 0.8, metalness: 0.15 });
  const steelDark = new THREE.MeshStandardMaterial({ color: 0x514b34, roughness: 0.85, metalness: 0.15 });
  const gun = new THREE.MeshStandardMaterial({ color: 0x2c2f26, roughness: 0.7, metalness: 0.4 });
  // Recon: a BRDM-style armoured scout car in the T-72's paint.
  const scout = new THREE.Group();
  boxOn(scout, steel, 4.6, 1.0, 2.2, -0.2, 1.05, 0);
  boxOn(scout, steelDark, 1.3, 0.6, 2.0, 2.4, 1.15, 0).rotation.z = -0.45;
  boxOn(scout, steelDark, 0.9, 0.12, 1.6, 1.3, 1.6, 0);
  const tur = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.7, 0.55, 10), steel);
  tur.position.set(-0.3, 1.85, 0);
  scout.add(tur);
  tube(scout, gun, 0.07, 1.6, -0.1, 1.9, 0);
  for (const x of [-1.9, 1.7]) for (const z of [-1.2, 1.2]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.35, 14), gun);
    w.rotation.x = Math.PI / 2; w.position.set(x, 0.55, z); scout.add(w);
  }
  out.recon = shoot(scout, 24);
  // Mechanised: a heavy IFV on the T-72 chassis with an autocannon turret, and its dismounts.
  const mech = new THREE.Group();
  const ifv = await chassis();
  mech.add(ifv.g);
  const it = new THREE.Group();
  boxOn(it, steel, 2.0, 0.7, 1.8, 0, 0, 0);
  boxOn(it, steelDark, 0.8, 0.5, 1.8, -1.2, -0.05, 0);
  tube(it, gun, 0.06, 2.6, 0.9, 0.12, 0.35);
  boxOn(it, gun, 0.5, 0.35, 0.4, -0.2, 0.45, -0.55);
  it.position.set(ifv.ring.x - 0.3, ifv.deck + 0.3, ifv.ring.z);
  mech.add(it);
  for (const [i, x, z] of [[0, -4.6, -2.2], [1, -5.2, 0.4], [2, -4.4, 2.5], [3, -6.2, -0.9]]) {
    const s = await soldier(i); s.position.set(x, 0, z); s.rotation.y = Math.PI / 2; mech.add(s);
  }
  out.mechanized = shoot(mech, 34);
  // Self-propelled gun: a 2S19-style 152 mm howitzer on the T-72 chassis.
  const spg = new THREE.Group();
  const ch = await chassis();
  spg.add(ch.g);
  const st = new THREE.Group();
  boxOn(st, steel, 3.4, 1.3, 3.0, 0, 0, 0);
  boxOn(st, steelDark, 0.9, 0.6, 2.6, -2.1, 0.0, 0);
  boxOn(st, steelDark, 0.9, 0.2, 0.9, 0.6, 0.75, -0.7);
  tube(st, gun, 0.13, 7.0, 1.6, 0.15, 0);
  tube(st, gun, 0.2, 0.7, 8.4, 0.15, 0);
  boxOn(st, gun, 0.5, 0.35, 0.5, -0.4, 0.85, 0.8);
  st.position.set(ch.ring.x - 0.6, ch.deck + 0.6, ch.ring.z);
  spg.add(st);
  out.artillery = shoot(spg, 40);
  // Infantry: a rifle section in a wedge, point man east.
  const inf = new THREE.Group();
  const wedge = [[4, 0], [2, -2], [2, 2], [0, -4], [0, 4], [-2, -1.5], [-2, 1.5], [-3.6, 0]];
  for (let i = 0; i < wedge.length; i++) {
    const s = await soldier(i); s.position.set(wedge[i][0], 0, wedge[i][1]); s.rotation.y = Math.PI / 2 + (i % 2 ? 0.15 : -0.15); inf.add(s);
  }
  inf.scale.setScalar(1.7);
  out.infantry = shoot(inf, 30);
  // Artillery: two towed howitzers and their crews.
  const art = new THREE.Group();
  for (const [z, k] of [[-3.2, 0], [3.2, 1]]) {
    const h = howitzer(); h.position.set(0, 0, z); art.add(h);
    for (const [i, x, dz] of [[k * 3, -2.6, 1.1], [k * 3 + 1, -1.2, -1.2]]) { const s = await soldier(i); s.position.set(x, 0, z + dz); s.rotation.y = Math.PI / 2; art.add(s); }
  }
  out.battery = shoot(art, 32);
  // Depot: containers, a tent, a watch tower and a Hesco wall.
  const depot = new THREE.Group();
  const put = async (file, metres, x, z, ry = 0) => { const o = normalise((await load(file)).scene.clone(), metres); o.rotation.y = ry; o.position.x += x; o.position.z += z; depot.add(o); };
  await put('./assets/im/container_rust.glb', 6.1, -5, -4, Math.PI / 2);
  await put('./assets/im/container_top.glb', 6.1, -5, -1, Math.PI / 2);
  await put('./assets/im/container_open.glb', 6.1, 1, -5);
  await put('./assets/im/tent.glb', 10, 4, 3.5, Math.PI / 2);
  await put('./assets/im/watch_tower.glb', 4.6, -6, 6);
  for (let i = 0; i < 9; i++) await put('./assets/im/hesco.glb', 1.6, -9 + i * 1.6, -9.5);
  for (let i = 0; i < 9; i++) await put('./assets/im/hesco.glb', 1.6, 9.5, -9 + i * 1.6);
  out.depot = shoot(depot, 30);
  return out;
};
window.ready = true;

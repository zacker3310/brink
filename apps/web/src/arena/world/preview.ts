import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import type { Biome, TimeOfDay, Weather } from '@brink/arena/v2';
import { QUALITY, type Quality } from '../quality';
import { buildWorld, type World } from './index';
import { sampleMap, shell } from './sample';

// Dev preview of the battlefield (world.html, not part of the production build). Query:
// biome, time, weather, quality, thermal=1, seed, view (village | river | overview | attack),
// x, z, dist, az, el (degrees), shell=1 to knock the village down, zone (capture progress),
// tone (agx | aces | neutral), loop=0 to draw only on request. Drag to orbit, wheel to zoom.

const q = new URLSearchParams(location.search);
const pick = <T extends string>(key: string, options: readonly T[], fallback: T): T => {
  const v = q.get(key);
  return v && (options as readonly string[]).includes(v) ? (v as T) : fallback;
};
const biome = pick<Biome>('biome', ['temperate', 'steppe', 'desert', 'winter', 'urban'], 'temperate');
const time = pick<TimeOfDay>('time', ['dawn', 'day', 'dusk', 'night'], 'day');
const weather = pick<Weather>('weather', ['clear', 'overcast', 'rain', 'fog', 'snow'], 'clear');
const quality = pick<Quality>('quality', ['low', 'balanced', 'high'], 'high');
const seed = Number(q.get('seed') ?? 7) || 7;
const preset = QUALITY[quality];

const renderer = new THREE.WebGLRenderer({ antialias: preset.antialias, powerPreference: 'high-performance', preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, preset.pixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = preset.shadowMap > 0;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(36, window.innerWidth / window.innerHeight, 0.3, 400);

const map = sampleMap(biome, seed);

async function hesco(): Promise<GLTF | undefined> {
  try {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    return await loader.loadAsync(`${import.meta.env.BASE_URL}art/models/hesco.glb`);
  } catch {
    return undefined;
  }
}

const views: Record<string, { x: number; z: number; dist: number }> = {
  village: { x: map.zone ? map.zone.x + 0.5 : 15, z: map.zone ? map.zone.y + 1.5 : 11, dist: 21 },
  river: { x: 13, z: 28, dist: 20 },
  overview: { x: 15, z: 23, dist: 66 },
  attack: { x: 15, z: 35, dist: 24 },
};

let world: World;
const t0 = performance.now();

async function main(): Promise<void> {
  const lib = { hesco: await hesco() };
  world = buildWorld(renderer, scene, map, { biome, time, weather }, quality, seed, lib);
  const built = performance.now() - t0;
  world.setThermal(q.get('thermal') === '1');
  const tone = q.get('tone');
  if (tone) renderer.toneMapping = tone === 'aces' ? THREE.ACESFilmicToneMapping : tone === 'neutral' ? THREE.NeutralToneMapping : THREE.AgXToneMapping;
  if (q.get('shell') === '1' && map.zone) {
    const { changed, craters } = shell(map, map.zone.x, map.zone.y, 4, seed);
    for (const c of changed) world.setCell(c.x, c.y, map);
    for (const c of craters) world.addCrater(c.x, c.y);
    world.scorch(map.zone.x + 1, map.zone.y + 2);
  }
  if (map.zone) world.setZone(Number(q.get('zone') ?? 0.4));

  const v = views[q.get('view') ?? 'village'] ?? views.village!;
  const dist = Number(q.get('dist') ?? v.dist);
  const az = THREE.MathUtils.degToRad(Number(q.get('az') ?? 0));
  const el = THREE.MathUtils.degToRad(Number(q.get('el') ?? 50));
  const target = new THREE.Vector3(Number(q.get('x') ?? v.x), 0, Number(q.get('z') ?? v.z));
  target.y = world.heightAt(target.x, target.z);
  camera.position.set(target.x + Math.sin(az) * Math.cos(el) * dist, target.y + Math.sin(el) * dist, target.z + Math.cos(az) * Math.cos(el) * dist);
  camera.lookAt(target);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(target);
  controls.maxPolarAngle = THREE.MathUtils.degToRad(80);
  controls.update();

  let last = performance.now();
  const frame = () => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    world.update(dt, camera);
    renderer.render(scene, camera);
  };
  // three renders shadow maps before it resets its counters: count the whole frame by hand.
  const step = (dt: number, n: number) => {
    let total = { calls: 0, triangles: 0 };
    for (let k = 0; k < n; k++) {
      world.update(dt, camera);
      renderer.info.autoReset = false;
      renderer.info.reset();
      renderer.render(scene, camera);
      renderer.info.autoReset = true;
      total = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
    }
    renderer.render(scene, camera);
    const main = renderer.info.render;
    return { ...total, mainCalls: main.calls, mainTriangles: main.triangles, lines: main.lines, points: main.points };
  };
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
  await world.ready;
  // Settle collapses and the first frames before anyone looks.
  const info = { ...step(0.25, 8), built: Math.round(built), geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures };
  console.log('world', JSON.stringify({ biome, time, weather, quality, ...info }));
  Object.assign(window, { __world: { world, renderer, map, step, info: () => ({ ...renderer.info.render }), ready: true, built } });
  if (q.get('loop') !== '0') renderer.setAnimationLoop(frame);
}

void main();

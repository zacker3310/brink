import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import type { TypeId } from '@brink/arena/v2';
import { METRE } from '../quality';
import { DIMS, SoldierCrowd, buildModel, buildProjectile, modelTypes, type Paint, type Pose, type SoldierKit, type UnitModel } from './index';

// Dev preview (models.html): every unit type on a ground plane under a sun and sky light, labels,
// soldiers in every kit and pose, and the per-type draw calls and triangles at both levels of detail.
// URL: ?view=sheet | close&type=m1a2 | soldiers | lods&type=t72b3, &paint=, &yaw=, &pitch=, &dist=.

const q = new URLSearchParams(location.search);
const view = q.get('view') ?? 'sheet';
const paint = (q.get('paint') ?? '') as Paint | '';
const W = innerWidth;
const H = innerHeight;

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(W, H);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.92;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xa7b0b3);
scene.fog = new THREE.Fog(0xa7b0b3, 40, 140);
const camera = new THREE.PerspectiveCamera(Number(q.get('fov') ?? 35), W / H, 0.01, 400);

const hemi = new THREE.HemisphereLight(0xc2c8c6, 0x5b5242, 0.55);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff0dc, 2.3);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
renderer.shadowMap.autoUpdate = false;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.01;
scene.add(sun, sun.target);

function ground(size: number): THREE.Mesh {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d')!;
  g.fillStyle = '#6f6b52';
  g.fillRect(0, 0, 512, 512);
  let s = 3;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 9000; i++) {
    const v = rnd();
    g.fillStyle = v < 0.45 ? `rgba(84,86,58,${0.3 + rnd() * 0.4})` : v < 0.8 ? `rgba(118,108,82,${0.2 + rnd() * 0.4})` : `rgba(60,58,44,${0.3 + rnd() * 0.3})`;
    g.fillRect(rnd() * 512, rnd() * 512, 1 + rnd() * 4, 1 + rnd() * 4);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(size / 3, size / 3);
  tex.anisotropy = 8;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }));
  m.rotation.x = -Math.PI / 2;
  m.receiveShadow = true;
  return m;
}

function label(text: string, size = 0.16): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.font = '600 34px system-ui, sans-serif';
  const w = g.measureText(text).width + 24;
  g.fillStyle = 'rgba(12,14,14,0.72)';
  g.fillRect((512 - w) / 2, 6, w, 52);
  g.fillStyle = '#e8ebe6';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 256, 33);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sp.scale.set(size * 8, size, 1);
  sp.renderOrder = 10;
  return sp;
}

const NAMES: Partial<Record<TypeId, string>> = {
  m1a2: 'M1A2 SEPv3', leo2a7: 'Leopard 2A7', cr3: 'Challenger 3', t72b3: 'T-72B3', t90m: 'T-90M', t80bvm: 'T-80BVM',
  m2a3: 'M2A3 Bradley', bmp3: 'BMP-3', cv90: 'CV9035', stryker: 'M1126 Stryker', m10: 'M10 Booker', sprut: '2S25M Sprut-SDM1',
  m1134: 'M1134 Stryker ATGM', kornetd: 'Kornet-D (Tigr-M)', gepard: 'Gepard 1A2', tunguska: 'Tunguska-M1', paladin: 'M109A7 Paladin',
  msta: '2S19M2 Msta-S', m88: 'M88A2 Hercules', brem: 'BREM-1M', ah64e: 'AH-64E', ka52: 'Ka-52', mi35: 'Mi-35M', ah6: 'AH-6M',
  uh60: 'UH-60M', mi8: 'Mi-8AMTSh', raven: 'RQ-11B Raven', orlan: 'Orlan-10',
};

const WEST: TypeId[] = ['m1a2', 'leo2a7', 'cr3', 'm2a3', 'cv90', 'stryker', 'm10', 'm1134', 'gepard', 'paladin', 'm88', 'ah64e', 'ah6', 'uh60', 'raven'];
function paintOf(t: TypeId): Paint {
  if (paint) return paint;
  if (t === 'leo2a7' || t === 'cr3' || t === 'cv90' || t === 'gepard') return 'nato_green';
  if (WEST.includes(t)) return 'us_tan';
  if (t === 't90m' || t === 'msta' || t === 'tunguska') return 'ru_summer';
  return 'ru_green';
}

const units: UnitModel[] = [];
const crowd = new SoldierCrowd({ max: 400, shadows: true });
scene.add(crowd.group);

function place(m: UnitModel, x: number, z: number, yaw = 0): void {
  m.root.position.set(x, m.lift, z);
  m.root.rotation.y = yaw;
  // ?aim=1 traverses every turret and elevates every gun, to check the pivots.
  if (q.get('aim') && m.turret !== m.root && m.turret.parent !== m.root) m.turret.rotation.y = 0.7;
  if (q.get('aim') && m.gun) m.gun.rotation.x = -0.3;
  scene.add(m.root);
  units.push(m);
}

let apache: GLTF | null = null;

async function loadApache(): Promise<GLTF | null> {
  try {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    return await loader.loadAsync('/art/models/heli.glb');
  } catch {
    return null;
  }
}

/** An outdoor light probe: hazy sky above, warm horizon, earth below (the park HDRI tints lilac). */
function skyEnv(): void {
  const sky = new THREE.Scene();
  const geo = new THREE.SphereGeometry(10, 32, 16);
  const col: number[] = [];
  const pos = geo.attributes.position!;
  const top = new THREE.Color(0x7d98b3);
  const hor = new THREE.Color(0xd9d6cc);
  const earth = new THREE.Color(0x5e5646);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 10;
    if (y > 0) c.copy(hor).lerp(top, Math.pow(y, 0.6));
    else c.copy(hor).lerp(earth, Math.min(1, -y * 4));
    col.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  sky.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  const sunDisc = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff2dd).multiplyScalar(30) }));
  sunDisc.position.set(5, 7, 5).normalize().multiplyScalar(9);
  sky.add(sunDisc);
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(sky, 0.02).texture;
  scene.environmentIntensity = Number(q.get('env') ?? 0.5);
}

const ROWS: TypeId[][] = [
  ['m1a2', 'leo2a7', 'cr3', 't72b3', 't90m', 't80bvm'],
  ['m2a3', 'bmp3', 'cv90', 'stryker', 'm1134', 'kornetd'],
  ['m10', 'sprut', 'gepard', 'tunguska', 'paladin', 'msta', 'm88', 'brem'],
  ['ah64e', 'ka52', 'mi35', 'ah6', 'uh60', 'mi8', 'raven', 'orlan'],
];

const KITS: SoldierKit[] = ['rifle', 'saw', 'grenadier', 'rpg', 'at4', 'javelin', 'kornet', 'gustaf', 'manpads', 'sniper', 'mortar', 'medic', 'sapper', 'operator', 'pkm'];
const POSES: Pose[] = ['stand', 'walk', 'run', 'kneel', 'prone', 'aim', 'fire', 'throw', 'dead', 'wounded'];

/** Rows of soldiers: every kit aiming, then every pose, for each faction. */
function soldierRows(x0: number, z0: number, gap: number): void {
  for (const [fi, faction] of (['west', 'east'] as const).entries()) {
    const zk = z0 + fi * gap * 4;
    KITS.forEach((kit, i) => {
      const id = `k${fi}-${i}`;
      crowd.add(id, faction, kit, x0 + i * gap, zk, Math.PI);
      crowd.set(id, { pose: kit === 'kornet' || kit === 'mortar' ? 'kneel' : 'aim' });
    });
    POSES.forEach((pose, i) => {
      const id = `p${fi}-${i}`;
      crowd.add(id, faction, i % 3 === 1 ? 'saw' : 'rifle', x0 + i * gap * 1.5, zk + gap * 1.8, Math.PI);
      crowd.set(id, { pose, speed: 0 });
    });
  }
}

function frameTo(target: THREE.Vector3, yawDeg: number, pitchDeg: number, dist: number): void {
  const yaw = (yawDeg * Math.PI) / 180;
  const pitch = (pitchDeg * Math.PI) / 180;
  camera.position.set(target.x + Math.sin(yaw) * Math.cos(pitch) * dist, target.y + Math.sin(pitch) * dist, target.z + Math.cos(yaw) * Math.cos(pitch) * dist);
  camera.lookAt(target);
  sun.position.set(target.x + 6, target.y + 12, target.z + 7);
  sun.target.position.copy(target);
  const r = Math.max(4, dist * 0.8);
  const sc = sun.shadow.camera;
  sc.left = -r;
  sc.right = r;
  sc.top = r;
  sc.bottom = -r;
  sc.near = 0.5;
  sc.far = 60;
  sc.updateProjectionMatrix();
}

function statsTable(): string {
  const lines = ['type            LOD0 calls  tris   LOD1 calls  tris'];
  const out: Record<string, { lod0: { calls: number; tris: number }; lod1: { calls: number; tris: number } }> = {};
  for (const t of modelTypes()) {
    const a = buildModel(t, { paint: paintOf(t), lod: 0 });
    const b = buildModel(t, { paint: paintOf(t), lod: 1 });
    out[t] = { lod0: a.stats, lod1: b.stats };
    lines.push(`${t.padEnd(14)}  ${String(a.stats.calls).padStart(6)}  ${String(a.stats.tris).padStart(6)}   ${String(b.stats.calls).padStart(6)}  ${String(b.stats.tris).padStart(6)}`);
    a.dispose();
    b.dispose();
  }
  const s = crowd.stats();
  lines.push(`soldiers (all)   calls ${s.calls}, tris per soldier ${s.trisPer}`);
  (window as unknown as { __stats: unknown }).__stats = { models: out, soldiers: s };
  return lines.join('\n');
}

async function setup(): Promise<void> {
  skyEnv();
  apache = await loadApache();
  const lod = (Number(q.get('lod') ?? 0) === 1 ? 1 : 0) as 0 | 1;
  if (view === 'sheet') {
    scene.add(ground(120));
    ROWS.forEach((row, ri) => {
      const air = ri === 3;
      const z = 2.4 - ri * 1.7 - (air ? 0.5 : 0);
      row.forEach((t, i) => {
        const gap = air ? 1.9 : 1.25;
        const x = (i - (row.length - 1) / 2) * gap;
        const m = buildModel(t, { paint: paintOf(t), lod });
        if (m.lift) m.lift = t === 'raven' || t === 'orlan' ? 0.6 : 0.45;
        place(m, x, z, Math.PI * 0.12);
        const l = label(NAMES[t] ?? t, Number(q.get('ls') ?? 0.1));
        l.position.set(x, 0.62 + m.lift, z + 0.55);
        scene.add(l);
      });
    });
    if (apache && q.get('glb')) {
      const m = buildModel('ah64e', { paint: 'us_tan', lod, apache });
      m.lift = 0.45;
      place(m, 0, -6.6, Math.PI * 0.12);
      const l = label('AH-64E (GLB)', Number(q.get('ls') ?? 0.1));
      l.position.set(0, 1.1, -6.0);
      scene.add(l);
    }
    soldierRows(-0.9, 3.5, 0.13);
    frameTo(new THREE.Vector3(Number(q.get('tx') ?? 0), 0, Number(q.get('tz') ?? -0.2)), Number(q.get('yaw') ?? 0), Number(q.get('pitch') ?? 50), Number(q.get('dist') ?? 15));
  } else if (view === 'row') {
    // A few types side by side, in 2 rows if many: ?types=a,b,c
    scene.add(ground(60));
    const types = (q.get('types') ?? 'm1a2').split(',') as TypeId[];
    const cols = Number(q.get('cols') ?? Math.min(types.length, 3));
    const gx = Number(q.get('gx') ?? 1.5);
    const gz = Number(q.get('gz') ?? 1.6);
    types.forEach((t, i) => {
      const cx = i % cols;
      const cz = Math.floor(i / cols);
      const x = (cx - (cols - 1) / 2) * gx;
      const z = -cz * gz;
      const m = buildModel(t, { paint: paintOf(t), lod, apache: q.get('glb') ? (apache ?? undefined) : undefined });
      if (m.lift) m.lift = Number(q.get('lift') ?? 0.3);
      place(m, x, z, (Number(q.get('rot') ?? 0) * Math.PI) / 180);
      if (q.get('labels') !== '0') {
        const l = label(NAMES[t] ?? t, 0.09);
        l.position.set(x, 0.62 + m.lift, z + 0.4);
        scene.add(l);
      }
    });
    const rows = Math.ceil(types.length / cols);
    frameTo(new THREE.Vector3(0, 0.2, (-(rows - 1) * gz) / 2), Number(q.get('yaw') ?? 35), Number(q.get('pitch') ?? 24), Number(q.get('dist') ?? 5.5));
  } else if (view === 'grid') {
    // One close viewport per type, 3 x 2: ?types=a,b,c,d,e,f&yaw=&pitch=
    scene.add(ground(400));
    const types = (q.get('types') ?? 'm1a2').split(',') as TypeId[];
    const yaw = (Number(q.get('yaw') ?? 35) * Math.PI) / 180;
    const pitch = (Number(q.get('pitch') ?? 20) * Math.PI) / 180;
    grid = types.map((t, i) => {
      const x = i * 30;
      const m = buildModel(t, { paint: paintOf(t), lod, apache: q.get('glb') ? (apache ?? undefined) : undefined });
      if (m.lift) m.lift = Number(q.get('lift') ?? 0.35);
      place(m, x, 0);
      const dims = DIMS[t] ?? [8, 4, 3];
      const r = Math.max(dims[0], dims[1]) * METRE * Number(q.get('k') ?? 1.55);
      const target = new THREE.Vector3(x, dims[2] * METRE * 0.4 + m.lift, 0);
      const c = new THREE.PerspectiveCamera(30, W / 3 / (H / 2), 0.01, 200);
      c.position.set(x + Math.sin(yaw) * Math.cos(pitch) * r, target.y + Math.sin(pitch) * r, Math.cos(yaw) * Math.cos(pitch) * r);
      c.lookAt(target);
      const l = label(NAMES[t] ?? t, 0.035 * r);
      l.position.set(x, target.y + r * 0.33, 0);
      scene.add(l);
      return { cam: c, target };
    });
    frameTo(new THREE.Vector3(0, 0, 0), 35, 20, 3);
  } else if (view === 'quad') {
    scene.add(ground(40));
    const t = (q.get('type') ?? 'm1a2') as TypeId;
    const dims = DIMS[t] ?? [8, 4, 3];
    const m = buildModel(t, { paint: paintOf(t), lod, apache: q.get('glb') ? (apache ?? undefined) : undefined });
    if (m.lift) m.lift = Number(q.get('lift') ?? 0.25);
    place(m, 0, 0);
    const target = new THREE.Vector3(0, dims[2] * METRE * 0.42 + (m.lift ? m.lift : 0), 0);
    const r = Math.max(dims[0], dims[1]) * METRE;
    const views: [number, number, number][] = [
      [35, 18, 1.3],
      [215, 24, 1.3],
      [90, 2, 1.2],
      [0, 4, 1.05],
      [0, 89, 1.1],
      [30, 50, 4.5],
    ];
    quad = views.map(([yaw, pitch, k]) => {
      const c = new THREE.PerspectiveCamera(30, (W / 3) / (H / 2), 0.01, 200);
      const a = (yaw * Math.PI) / 180;
      const b = (pitch * Math.PI) / 180;
      c.position.set(target.x + Math.sin(a) * Math.cos(b) * r * k * 1.5, target.y + Math.sin(b) * r * k * 1.5, target.z + Math.cos(a) * Math.cos(b) * r * k * 1.5);
      c.lookAt(target);
      return c;
    });
    frameTo(target, 35, 20, r * 2);
  } else if (view === 'close' || view === 'lods') {
    scene.add(ground(40));
    const t = (q.get('type') ?? 'm1a2') as TypeId;
    const dims = DIMS[t] ?? [8, 4, 3];
    if (view === 'lods') {
      const a = buildModel(t, { paint: paintOf(t), lod: 0 });
      const b = buildModel(t, { paint: paintOf(t), lod: 1 });
      if (a.lift) a.lift = b.lift = 0.3;
      place(a, -dims[0] * METRE * 0.65, 0);
      place(b, dims[0] * METRE * 0.65, 0);
    } else {
      const m = buildModel(t, { paint: paintOf(t), lod, apache: q.get('glb') ? (apache ?? undefined) : undefined });
      if (m.lift) m.lift = Number(q.get('lift') ?? 0.25);
      place(m, 0, 0);
    }
    const target = new THREE.Vector3(0, Number(q.get('ty') ?? dims[2] * METRE * 0.45), 0);
    frameTo(target, Number(q.get('yaw') ?? 35), Number(q.get('pitch') ?? 20), Number(q.get('dist') ?? Math.max(dims[0], dims[1]) * METRE * (view === 'lods' ? 2.6 : 1.6)));
  } else if (view === 'soldiers') {
    scene.add(ground(40));
    soldierRows(-0.85, -0.45, 0.12);
    frameTo(new THREE.Vector3(Number(q.get('tx') ?? 0), 0.08, Number(q.get('tz') ?? 0.1)), Number(q.get('yaw') ?? 160), Number(q.get('pitch') ?? 22), Number(q.get('dist') ?? 2.3));
  } else if (view === 'soldier') {
    // A few soldiers large: ?poses=stand,aim&kits=rifle,rpg&faction=east
    scene.add(ground(20));
    const poses = (q.get('poses') ?? 'stand,walk,run,aim,kneel').split(',') as Pose[];
    const kits = (q.get('kits') ?? 'rifle').split(',') as SoldierKit[];
    const faction = q.get('faction') === 'east' ? 'east' : 'west';
    let i = 0;
    for (const kit of kits)
      for (const pose of poses) {
        const id = `s${i}`;
        crowd.add(id, faction, kit, (i - (kits.length * poses.length - 1) / 2) * 0.16, 0, 0);
        crowd.set(id, { pose });
        i++;
      }
    frameTo(new THREE.Vector3(0, 0.09, 0), Number(q.get('yaw') ?? 30), Number(q.get('pitch') ?? 10), Number(q.get('dist') ?? 0.9));
  } else if (view === 'projectiles') {
    scene.add(ground(10));
    const kinds = ['fpv', 'switchblade', 'lancet', 'atgm', 'rocket', 'shell'] as const;
    kinds.forEach((k, i) => {
      const o = buildProjectile(k);
      o.scale.setScalar(8);
      o.position.set((i - 2.5) * 0.5, 0.25, 0);
      scene.add(o);
      const l = label(k, 0.06);
      l.position.set((i - 2.5) * 0.5, 0.45, 0);
      scene.add(l);
    });
    frameTo(new THREE.Vector3(0, 0.2, 0), 25, 22, 3.4);
  }
  const el = document.getElementById('stats')!;
  if (q.get('stats') !== '0') {
    el.textContent = statsTable();
    if (q.get('stats') === '1') el.classList.remove('hidden');
    console.log(el.textContent);
  }
}

let quad: THREE.PerspectiveCamera[] | null = null;
let grid: { cam: THREE.PerspectiveCamera; target: THREE.Vector3 }[] | null = null;
const clock = new THREE.Clock();
let frames = 0;
function tick(): void {
  const dt = Math.min(clock.getDelta(), 0.05);
  for (const u of units) {
    for (const r of u.rotors) r.obj.rotation[r.axis] += r.rate * (q.get('still') ? 0 : 1) * Math.max(dt, 1 / 30);
  }
  crowd.update(dt);
  renderer.shadowMap.needsUpdate = true;
  if (grid) {
    renderer.setScissorTest(true);
    grid.forEach(({ cam, target }, i) => {
      const x = (i % 3) * (W / 3);
      const y = (1 - Math.floor(i / 3)) * (H / 2);
      // Each viewport gets the sun's shadow round its own model.
      frameTo(target, 35, 20, 3);
      renderer.shadowMap.needsUpdate = true;
      renderer.setViewport(x, y, W / 3, H / 2);
      renderer.setScissor(x, y, W / 3, H / 2);
      renderer.render(scene, cam);
    });
    renderer.setScissorTest(false);
  } else if (quad) {
    renderer.setScissorTest(true);
    quad.forEach((c, i) => {
      const x = (i % 3) * (W / 3);
      const y = (1 - Math.floor(i / 3)) * (H / 2);
      renderer.setViewport(x, y, W / 3, H / 2);
      renderer.setScissor(x, y, W / 3, H / 2);
      renderer.render(scene, c);
    });
    renderer.setScissorTest(false);
  } else renderer.render(scene, camera);
  frames++;
  if (frames === 6) (window as unknown as { __ready: boolean }).__ready = true;
  // Headless captures stop drawing once ready, so the screenshot is not waiting on a frame.
  if (frames < 6 || q.get('live')) requestAnimationFrame(tick);
}

setup().then(() => requestAnimationFrame(tick));

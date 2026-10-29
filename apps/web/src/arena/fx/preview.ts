import * as THREE from 'three';
import { Effects } from './effects';
import type { Biome, Quality } from './palette';

// Dev preview of the battle effects (apps/web/fx.html): a stand-in field of boxes, a tank-sized
// block, a button for every effect and a demo loop. The production build never includes it.
// URL: ?q=low|balanced|high &night=1 &biome=winter &manual=1 (no clock: drive it with fxp.step) &ui=0

const params = new URLSearchParams(location.search);
const pick = <T extends string>(v: string | null, all: readonly T[], d: T): T => (all.includes(v as T) ? (v as T) : d);
let quality: Quality = pick(params.get('q'), ['low', 'balanced', 'high'] as const, 'high');
let night = params.get('night') === '1';
let biome: Biome = pick(params.get('biome'), ['temperate', 'steppe', 'desert', 'winter', 'urban'] as const, 'temperate');
let thermal = false;
const manual = params.get('manual') === '1';
if (params.get('ui') === '0') document.body.classList.add('hide');

// Mirrors arena/quality.ts.
const PIXEL: Record<Quality, number> = { low: 1, balanced: 1.6, high: 2 };
const SHADOW: Record<Quality, number> = { low: 0, balanced: 1024, high: 2048 };

const heightAt = (x: number, z: number) => 0.1 * Math.sin(x * 0.31 + 0.4) * Math.cos(z * 0.23) + 0.05 * Math.sin(x * 0.83 + z * 0.61);

const GROUND: Record<Biome, [number, number, number]> = {
  temperate: [0x56553a, 0x48492f, 0x6a5d47],
  steppe: [0x857955, 0x766c4b, 0x9a8b66],
  desert: [0xb39b74, 0xa58d68, 0xc4ad86],
  winter: [0xd5dade, 0xc3cacf, 0x8d8a84],
  urban: [0x67645e, 0x5a5853, 0x77736b],
};

const host = document.getElementById('view')!;
let renderer!: THREE.WebGLRenderer;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 200);
const hemi = new THREE.HemisphereLight(0xcfd8e0, 0x4a4234, 1);
const sun = new THREE.DirectionalLight(0xffeedd, 3);
sun.position.set(-14, 22, 9);
sun.shadow.camera.left = sun.shadow.camera.bottom = -14;
sun.shadow.camera.right = sun.shadow.camera.top = 14;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
scene.add(hemi, sun, sun.target);

function makeRenderer(): void {
  renderer?.dispose();
  renderer?.domElement.remove();
  renderer = new THREE.WebGLRenderer({ antialias: quality !== 'low', powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, PIXEL[quality]));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = SHADOW[quality] > 0;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  sun.castShadow = SHADOW[quality] > 0;
  sun.shadow.mapSize.set(SHADOW[quality] || 512, SHADOW[quality] || 512);
  sun.shadow.map?.dispose();
  sun.shadow.map = null;
  host.appendChild(renderer.domElement);
  renderer.domElement.style.filter = thermal ? 'grayscale(1) contrast(1.25) brightness(0.9)' : '';
  resize();
}

// --- The field: a ground plane and boxes standing in for terrain ---------------------------------

const groundGeo = new THREE.PlaneGeometry(70, 70, 140, 140).rotateX(-Math.PI / 2);
const ground = new THREE.Mesh(groundGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
ground.receiveShadow = true;
scene.add(ground);

function paintGround(): void {
  const p = groundGeo.attributes.position!;
  const cols = new Float32Array(p.count * 3);
  const [a, b, c] = GROUND[biome].map((h) => new THREE.Color(h));
  const tmp = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const z = p.getZ(i);
    p.setY(i, heightAt(x, z));
    const n = 0.5 + 0.25 * Math.sin(x * 1.7 + Math.sin(z * 0.9) * 2) + 0.25 * Math.sin(z * 2.3 + Math.cos(x * 1.1) * 1.5);
    const m = 0.5 + 0.5 * Math.sin(x * 0.37 + z * 0.29 + Math.sin(x * 2.9) * 0.4);
    tmp.copy(a!).lerp(b!, n).lerp(c!, Math.max(0, m - 0.6) * 1.6);
    cols[i * 3] = tmp.r;
    cols[i * 3 + 1] = tmp.g;
    cols[i * 3 + 2] = tmp.b;
  }
  groundGeo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  p.needsUpdate = true;
  groundGeo.computeVertexNormals();
}

function box(w: number, h: number, d: number, color: number, x: number, z: number, y = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, roughness: 0.95 }));
  m.position.set(x, heightAt(x, z) + y + h / 2, z);
  m.castShadow = true;
  m.receiveShadow = true;
  scene.add(m);
  return m;
}

box(3, 0.25, 0.5, 0x5e5340, -3, 1.6);
box(0.8, 0.45, 0.7, 0x6b6558, 4.5, -4.5);
box(1.1, 0.35, 0.8, 0x625d52, -5.5, -3);
box(0.35, 0.3, 2.2, 0x8a7d5c, 2.2, -0.2);
for (let i = 0; i < 9; i++) box(0.7, 1.4 + (i % 3) * 0.3, 0.7, 0x2f3826, -9 + i * 2.1, -10 - (i % 2) * 0.8);
const building = box(1, 1.1, 1, 0x8b857b, 3.6, -1.6);

function tank(color: number, x: number, z: number, yaw: number): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x23241f, roughness: 0.95 });
  const part = (geo: THREE.BufferGeometry, m: THREE.Material, px: number, py: number, pz: number) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(px, py, pz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
    return mesh;
  };
  part(new THREE.BoxGeometry(0.72, 0.13, 0.34), mat, 0, 0.13, 0);
  part(new THREE.BoxGeometry(0.76, 0.1, 0.09), dark, 0, 0.06, 0.15);
  part(new THREE.BoxGeometry(0.76, 0.1, 0.09), dark, 0, 0.06, -0.15);
  part(new THREE.BoxGeometry(0.34, 0.1, 0.26), mat, -0.04, 0.245, 0);
  part(new THREE.CylinderGeometry(0.013, 0.016, 0.46, 8).rotateZ(Math.PI / 2), mat, 0.36, 0.26, 0);
  g.position.set(x, heightAt(x, z), z);
  g.rotation.y = yaw;
  scene.add(g);
  return g;
}

const shooter = tank(0x8f7b55, 0, 4, Math.PI / 2);
const target = tank(0x4c5638, -0.5, -2.6, -Math.PI / 2);
// An orange air-recognition panel on the target's turret, so it is obvious when the smoke hides it.
const panel = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.012, 0.14), new THREE.MeshStandardMaterial({ color: 0xff6a1a, roughness: 0.7 }));
panel.position.set(-0.04, 0.3, 0);
target.add(panel);
const targetPaint = (target.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;

const heli = new THREE.Group();
{
  const mat = new THREE.MeshStandardMaterial({ color: 0x3c4232, roughness: 0.8 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.15, 0.15), mat);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.05), mat);
  tail.position.set(-0.45, 0.04, 0);
  const rotor = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.004, 28), new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.25 }));
  rotor.position.y = 0.11;
  for (const m of [body, tail]) m.castShadow = true;
  heli.add(body, tail, rotor);
  heli.visible = false;
  scene.add(heli);
}
const heliHome = new THREE.Vector3(3, 0, 1.6);

const mover = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.15, 0.3), new THREE.MeshStandardMaterial({ color: 0x55603f, roughness: 0.9 }));
mover.castShadow = true;
mover.visible = false;
scene.add(mover);

// --- Effects --------------------------------------------------------------------------------------

let fx!: Effects;

function makeEffects(): void {
  fx?.dispose();
  fx = new Effects(scene, quality, { biome, night, heightAt });
  fx.setArsenals('us', 'russia');
  fx.setSeed(7);
  fx.setThermal(thermal);
}

function applyLook(): void {
  const haze = night ? 0x0a0e15 : biome === 'winter' ? 0xb4bcc2 : biome === 'desert' ? 0xb9ae9a : 0x98a1a3;
  scene.background = new THREE.Color(haze);
  scene.fog = new THREE.Fog(haze, 22, 70);
  hemi.color.setHex(night ? 0x2a3a58 : 0xcfd8e0);
  hemi.groundColor.setHex(night ? 0x07090b : 0x4a4234);
  hemi.intensity = night ? 0.7 : 1;
  sun.color.setHex(night ? 0x9fb2d0 : 0xffeedd);
  sun.intensity = night ? 0.5 : 3;
  fx.setNight(night);
  if (renderer) renderer.domElement.style.filter = thermal ? 'grayscale(1) contrast(1.25) brightness(0.9)' : '';
}

// --- Camera views ---------------------------------------------------------------------------------

const VIEWS: Record<string, [number, number, number, number, number, number]> = {
  field: [3, 7, 9.5, -0.1, 0, 0.4],
  tank: [0.45, 1.3, 7.6, -0.15, 0.2, 1.6],
  target: [0.2, 1.7, 1.4, -0.45, 0.45, -2.6],
  blast: [1.6, 3, 5.6, 0.9, 0.8, -2.2],
  drone: [0.1, 8.5, 2.2, -0.5, 0, -1.9],
  smoke: [1.4, 1.5, 5.8, -0.5, 0.5, -2.2],
  heli: [6.2, 2.4, 5.6, 3, 0.45, 1.5],
  building: [6.8, 2.4, 2.8, 3.6, 0.7, -1.6],
  wide: [1.5, 11, 13, 1, 0, -2.5],
  missile: [-5.6, 2.8, 10.6, -2.1, 1.3, 1.2],
};
let view = params.get('view') ?? 'field';

function setView(name: string): void {
  const v = VIEWS[name] ?? VIEWS.field!;
  view = name;
  camera.position.set(v[0], v[1], v[2]);
  camera.lookAt(v[3], v[4], v[5]);
  camera.updateMatrixWorld(true);
}

function resize(): void {
  const w = host.clientWidth || 1;
  const h = host.clientHeight || 1;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', () => resize());

// --- Actions --------------------------------------------------------------------------------------

let clock = 0;
const due: { at: number; fn: () => void }[] = [];
const after = (t: number, fn: () => void) => due.push({ at: clock + t, fn });
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const onGround = (x: number, z: number, y = 0) => V(x, heightAt(x, z) + y, z);
const muzzleOf = () => shooter.localToWorld(V(0.6, 0.26, 0));
const targetAt = (y = 0.2) => target.localToWorld(V(0, y, 0));
let screen: string | null = null;
let washing = false;
let driving = false;
let driveT = 0;
let seedN = 1;

const ACTIONS: Record<string, () => void> = {
  gun: () => {
    const m = muzzleOf();
    const t = targetAt(0.18);
    fx.muzzle(m, t.clone().sub(m), '120');
    fx.tracer(m, t, '120', 'blue', 0.22);
    after(0.22, () => fx.hit(t, V(0, 0.2, 1), 'pen'));
  },
  howitzer: () => {
    const m = muzzleOf();
    fx.muzzle(m, V(-0.2, 0.6, -1), '152');
  },
  mg: () => {
    for (let i = 0; i < 14; i++) {
      after(i * 0.09, () => {
        const m = muzzleOf();
        const t = onGround(-0.5 + (Math.random() - 0.5) * 1.6, -2.6 + (Math.random() - 0.5) * 1.4, 0.01);
        const armour = i % 5 === 2;
        if (armour) t.copy(targetAt(0.16));
        fx.muzzle(m, t.clone().sub(m), '7.62');
        fx.tracer(m, t, '7.62', 'blue', 0.32);
        after(0.32, () => fx.hit(t, armour ? V(0, 0.3, 1) : V(0, 1, 0), armour ? 'bounce' : 'small'));
      });
    }
  },
  redmg: () => {
    for (let i = 0; i < 12; i++) {
      after(i * 0.1, () => {
        const m = target.localToWorld(V(0.6, 0.26, 0));
        const t = onGround((Math.random() - 0.5) * 1.6, 4 + (Math.random() - 0.5) * 1.2, 0.01);
        fx.muzzle(m, t.clone().sub(m), '12.7');
        fx.tracer(m, t, '12.7', 'red', 0.3);
        after(0.3, () => fx.hit(t, V(0, 1, 0), 'small'));
      });
    }
  },
  cannon: () => {
    for (let i = 0; i < 5; i++) {
      after(i * 0.16, () => {
        const m = muzzleOf();
        const t = onGround(-0.5 + (Math.random() - 0.5) * 1.4, -2.4 + (Math.random() - 0.5) * 1.2);
        fx.muzzle(m, t.clone().sub(m), '30');
        fx.tracer(m, t, '30', 'blue', 0.3);
        after(0.3, () => fx.explosion(t, 0.22, 'he'));
      });
    }
  },
  javelin: () => {
    const from = onGround(-4, 5.5, 0.15);
    const t = targetAt(0.28);
    fx.missile(from, t, 'atgm', 2.6, { top: true });
    after(2.6, () => {
      fx.explosion(t, 0.35, 'he');
      fx.hit(t, V(0, 1, 0), 'pen');
    });
  },
  kornet: () => {
    const from = target.localToWorld(V(-5, 0.2, 3));
    const t = muzzleOf().add(V(0, -0.08, 0.3));
    fx.missile(from, t, 'atgm', 1.6);
    after(1.6, () => {
      fx.explosion(t, 0.3, 'he');
      fx.hit(t, V(0, 0.2, -1), 'bounce');
    });
  },
  rpg: () => {
    const from = onGround(2.6, 0.6, 0.15);
    const t = targetAt(0.15);
    fx.muzzle(from, t.clone().sub(from), 'rocket');
    fx.missile(from, t, 'rocket', 0.55);
    after(0.55, () => fx.explosion(t, 0.3, 'he'));
  },
  manpads: () => {
    heli.visible = true;
    const h = heli.position.clone();
    const from = onGround(-3, 3, 0.2);
    fx.missile(from, h, 'manpads', 1.6);
    after(1.6, () => fx.explosion(h, 0.6, 'airburst'));
  },
  hellfire: () => {
    heli.visible = true;
    const from = heli.position.clone().add(V(0.1, -0.05, 0.15));
    const t = targetAt(0.2);
    fx.missile(from, t, 'hellfire', 1.5);
    after(1.5, () => {
      fx.explosion(t, 0.45, 'he');
      fx.hit(t, V(0, 1, 0), 'pen');
    });
  },
  shell: () => {
    const t = onGround(1.8, -1);
    fx.shell(V(14, 1, 20), t, 2);
    after(2, () => fx.explosion(t, 1, 'shell'));
  },
  mortar: () => {
    const t = onGround(-2.2, -3.2);
    fx.shell(V(-10, 0.5, 16), t, 2.2);
    after(2.2, () => fx.explosion(t, 0.6, 'shell'));
  },
  rockets: () => fx.explosion(onGround(0.5, -3.5), 1, 'rockets'),
  bombs: () => fx.explosion(onGround(2.2, -4.5), 2.4, 'bombs'),
  mine: () => fx.explosion(onGround(-1.6, 1), 0.7, 'mine'),
  airburst: () => fx.explosion(onGround(-1, -1.6, 1.4), 0.8, 'airburst'),
  he30: () => fx.explosion(onGround(0.6, -2), 0.25, 'he'),
  pen: () => fx.hit(targetAt(0.22), V(0, 0.2, 1), 'pen'),
  bounce: () => fx.hit(targetAt(0.2), V(0.3, 0.3, 1), 'bounce'),
  catastrophic: () => {
    const at = targetAt(0.15);
    fx.catastrophic(at);
    targetPaint.color.setHex(0x161512);
    panel.visible = false;
    after(0.3, () => fx.burn('target', targetAt(0.2), 1));
  },
  burn: () => fx.burn(`wreck-${seedN++}`, onGround(2.4, 2.2, 0.1), 1),
  stopburn: () => {
    fx.stopBurn('target');
    for (let i = 1; i < seedN; i++) fx.stopBurn(`wreck-${i}`);
  },
  smoke: () => {
    if (screen) fx.clearSmoke(screen);
    const cells = [];
    for (let y = -3; y <= -1; y++) for (let x = -2; x <= 0; x++) cells.push({ x, y });
    screen = fx.smoke(cells);
  },
  clear: () => {
    if (screen) fx.clearSmoke(screen);
    screen = null;
  },
  fpv: () => {
    const t = targetAt(0.28);
    fx.drone(onGround(-6, 6, 0.3), t, 3, 'fpv');
    after(3, () => {
      fx.explosion(t, 0.3, 'he');
      fx.hit(t, V(0, 1, 0), 'pen');
    });
  },
  lancet: () => {
    const t = muzzleOf().add(V(0, 0.02, 0.3));
    fx.drone(V(-8, 2.5, -10), t, 4, 'lancet');
    after(4, () => fx.explosion(t, 0.45, 'he'));
  },
  wash: () => {
    washing = !washing;
    heli.visible = washing || heli.visible;
    if (!washing) fx.stopRotorWash('heli');
  },
  dust: () => {
    driving = !driving;
    driveT = 0;
    mover.visible = driving;
  },
  collapse: () => {
    building.visible = false;
    fx.collapse(V(building.position.x, heightAt(building.position.x, building.position.z), building.position.z), 1.2);
  },
};

const DEMO: [number, string][] = [
  [0, 'gun'],
  [1.4, 'mg'],
  [3, 'redmg'],
  [4.4, 'cannon'],
  [5.8, 'javelin'],
  [9, 'shell'],
  [11.6, 'rockets'],
  [14.5, 'kornet'],
  [16.6, 'mine'],
  [17.8, 'airburst'],
  [19.2, 'bombs'],
  [21.5, 'rpg'],
  [22.5, 'bounce'],
  [23.6, 'catastrophic'],
  [26, 'smoke'],
  [27, 'fpv'],
  [31, 'hellfire'],
  [33, 'clear'],
  [34, 'wash'],
  [36, 'manpads'],
  [39, 'wash'],
  [39.5, 'dust'],
  [42, 'collapse'],
  [45, 'dust'],
  [46, 'howitzer'],
  [47.5, 'lancet'],
];
const DEMO_LEN = 54;
let demo = params.get('demo') === '1';
let demoT = 0;
let demoI = 0;

function reset(): void {
  fx.clear();
  fx.setSeed(7);
  due.length = 0;
  screen = null;
  washing = false;
  driving = false;
  mover.visible = false;
  heli.visible = false;
  building.visible = true;
  targetPaint.color.setHex(0x4c5638);
  panel.visible = true;
  demoT = 0;
  demoI = 0;
}

// --- Frame ----------------------------------------------------------------------------------------

let updateMs = 0;

function advance(dt: number): void {
  clock += dt;
  if (demo) {
    demoT += dt;
    while (demoI < DEMO.length && demoT >= DEMO[demoI]![0]) ACTIONS[DEMO[demoI++]![1]]!();
    if (demoT >= DEMO_LEN) {
      reset();
      demo = true;
      night = !night;
      applyLook();
    }
  }
  for (let i = due.length - 1; i >= 0; i--) {
    if (clock >= due[i]!.at) {
      const d = due.splice(i, 1)[0]!;
      d.fn();
    }
  }
  const hx = heliHome.x + Math.sin(clock * 0.7) * 0.15;
  const hz = heliHome.z + Math.cos(clock * 0.5) * 0.1;
  heli.position.set(hx, heightAt(hx, hz) + 0.75 + Math.sin(clock * 1.9) * 0.05, hz);
  heli.rotation.y = 0.6;
  if (washing) fx.rotorWash('heli', heli.position, 1, params.get('water') === '1' ? 'water' : 'ground');
  if (driving) {
    driveT += dt;
    const a = driveT * 0.45;
    const x = -3 + Math.cos(a) * 2.6;
    const z = -0.8 + Math.sin(a) * 1.6;
    mover.position.set(x, heightAt(x, z) + 0.1, z);
    mover.rotation.y = -a - Math.PI / 2;
    const back = V(-Math.sin(a), 0, Math.cos(a)).multiplyScalar(-0.35);
    fx.dust(mover.position.clone().add(back), 1);
  }
  const t0 = performance.now();
  fx.update(dt, camera);
  const ms = performance.now() - t0;
  updateMs = updateMs * 0.95 + ms * 0.05;
}

const statsEl = document.getElementById('stats')!;

function render(): void {
  renderer.render(scene, camera);
  const s = fx.stats();
  statsEl.textContent = `${quality}${night ? ' night' : ' day'}${thermal ? ' thermal' : ''} ${biome}\nsprites ${s.particles} (smoke ${s.smoke}, fire ${s.glow})  debris ${s.debris}\nfx draw calls ${s.drawCalls}  total ${renderer.info.render.calls}\nupdate ${updateMs.toFixed(2)} ms`;
}

let last = performance.now();
function loop(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  advance(dt);
  render();
  requestAnimationFrame(loop);
}

// --- UI -------------------------------------------------------------------------------------------

const ui = document.getElementById('ui')!;
function button(label: string, fn: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  b.addEventListener('click', fn);
  ui.appendChild(b);
  return b;
}

for (const name of Object.keys(ACTIONS)) button(name, () => ACTIONS[name]!());
const demoBtn = button('demo loop', () => {
  demo = !demo;
  if (demo) reset();
  demoBtn.classList.toggle('on', demo);
});
button('day / night', () => {
  night = !night;
  applyLook();
});
button('thermal', () => {
  thermal = !thermal;
  fx.setThermal(thermal);
  applyLook();
});
button('reset', () => reset());
const viewSel = document.createElement('select');
for (const v of Object.keys(VIEWS)) viewSel.add(new Option(`view: ${v}`, v));
viewSel.value = view;
viewSel.addEventListener('change', () => setView(viewSel.value));
ui.appendChild(viewSel);
const qSel = document.createElement('select');
for (const q of ['low', 'balanced', 'high']) qSel.add(new Option(`quality: ${q}`, q));
qSel.value = quality;
qSel.addEventListener('change', () => {
  quality = qSel.value as Quality;
  makeRenderer();
  fx.setQuality(quality);
});
ui.appendChild(qSel);
const bSel = document.createElement('select');
for (const b of ['temperate', 'steppe', 'desert', 'winter', 'urban']) bSel.add(new Option(`biome: ${b}`, b));
bSel.value = biome;
bSel.addEventListener('change', () => {
  biome = bSel.value as Biome;
  fx.setBiome(biome);
  paintGround();
  applyLook();
});
ui.appendChild(bSel);

// --- Hooks for headless capture and the CPU probe ---------------------------------------------------

interface Bench {
  quality: Quality;
  live: number;
  frames: number;
  mean: number;
  p95: number;
  max: number;
}

const api = {
  /** Advance the film in fixed 60 Hz steps, then draw once. */
  step(seconds: number): void {
    const n = Math.max(1, Math.round(seconds * 60));
    for (let i = 0; i < n; i++) advance(1 / 60);
    render();
  },
  run(name: string): void {
    ACTIONS[name]?.();
  },
  /** Run the effects' update alone, n times (the allocation probe). */
  stepFx(dt: number, n: number): void {
    for (let i = 0; i < n; i++) fx.update(dt, camera);
  },
  view(name: string): void {
    setView(name);
    render();
  },
  /** Aim the camera at a point from a distance, a heading and a pitch (degrees). */
  look(x: number, y: number, z: number, dist: number, yaw: number, pitch: number): void {
    const p = (pitch * Math.PI) / 180;
    const h = (yaw * Math.PI) / 180;
    camera.position.set(x + Math.sin(h) * Math.cos(p) * dist, y + Math.sin(p) * dist, z + Math.cos(h) * Math.cos(p) * dist);
    camera.lookAt(x, y, z);
    camera.updateMatrixWorld(true);
    render();
  },
  reset(): void {
    reset();
    render();
  },
  night(on: boolean): void {
    night = on;
    applyLook();
  },
  thermal(on: boolean): void {
    thermal = on;
    fx.setThermal(on);
    applyLook();
  },
  stats: () => ({ ...fx.stats(), totalCalls: renderer.info.render.calls, busy: fx.busy, updateMs }),
  /** Fill the budget with burning wrecks and a smoke screen, then time `update` alone. */
  bench(q: Quality, frames = 600): Bench {
    quality = q;
    fx.setQuality(q);
    reset();
    demo = false;
    ACTIONS.smoke!();
    let burns = 0;
    let t = 0;
    const cap = q === 'low' ? 120 : q === 'balanced' ? 300 : 700;
    // Add fires until the sprites stay near the cap, then let it settle.
    while (t < 40) {
      for (let i = 0; i < 30; i++) advance(1 / 60);
      t += 0.5;
      if (fx.stats().particles < cap * 0.96 && burns < 24) {
        const a = burns * 2.4;
        fx.burn(`bench-${burns++}`, onGround(Math.cos(a) * (2 + burns * 0.3), Math.sin(a) * (2 + burns * 0.3), 0.1), 1);
      } else if (t > 14) break;
    }
    // Fire into it as a battle would: a burst every 40 frames, a shell every 120.
    const times = new Float64Array(frames);
    const blastAt = onGround(1.5, -1);
    let live = 0;
    let samples = 0;
    for (let i = 0; i < frames; i++) {
      if (i % 40 === 0) ACTIONS.mg!();
      if (i % 120 === 60) fx.explosion(blastAt, 1, 'shell');
      clock += 1 / 60;
      for (let k = due.length - 1; k >= 0; k--) if (clock >= due[k]!.at) due.splice(k, 1)[0]!.fn();
      const t0 = performance.now();
      fx.update(1 / 60, camera);
      times[i] = performance.now() - t0;
      if (i % 30 === 0) {
        live += fx.stats().particles;
        samples++;
      }
    }
    times.sort();
    const mean = times.reduce((s, x) => s + x, 0) / frames;
    render();
    return { quality: q, live: Math.round(live / samples), frames, mean, p95: times[Math.floor(frames * 0.95)]!, max: times[frames - 1]! };
  },
};
(window as unknown as { fxp: typeof api }).fxp = api;

// --- Start ----------------------------------------------------------------------------------------

paintGround();
makeEffects();
makeRenderer();
applyLook();
setView(view);
demoBtn.classList.toggle('on', demo);
render();
if (!manual) requestAnimationFrame(loop);

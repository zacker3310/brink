import * as THREE from 'three';
import { H, W, typeOf, type Battle, type BattleEvent, type Point, type Side, type TypeId, type Unit, type UnitType } from '@brink/arena';
import { BattleAudio } from './audio';
import { Effects } from './fx';
import { buildModel, buildProjectile, kitFor, paintFor, SoldierCrowd, type UnitModel } from './models3d';
import { LEVEL, METRE, QUALITY, type ArenaSettings, type Quality } from './quality';
import { buildWorld, thermalMaterialFor, type World } from './world';
import type { Library } from './assets';

// The battle drawn in three.js: the world (ground, buildings, weather, light), the units (built in
// code; soldiers drawn one by one), the effects and the sound, all driven by the engine's event log
// played back as a film. The film shows only what the player's side saw. The camera is a tactical
// orbit (pan, pinch, twist, tilt) with short action cams on big hits.

export interface Overlay {
  selected: string | null;
  /** Cells the selected unit can move to. */
  reach: number[];
  /** Cells it can reach only by dashing. */
  dash: number[];
  /** The route to the cell under the pointer. */
  path: Point[] | null;
  /** Enemies the selected unit can fire at. */
  targets: string[];
  /** An area strike being aimed: its centre cell and radius. */
  area: { at: Point; r: number } | null;
  /** Last known enemy positions. */
  ghosts: { x: number; y: number; type: TypeId; age: number }[];
}

interface Step {
  dur: number;
  t: number;
  started: boolean;
  start?: () => void;
  tick?: (k: number, dt: number) => void;
  end?: () => void;
}

interface View {
  id: string;
  side: Side;
  type: TypeId;
  t: UnitType;
  holder: THREE.Group;
  models: [UnitModel | null, UnitModel | null];
  lod: 0 | 1;
  /** Soldiers in the crowd, by index into the unit's men. */
  men: string[];
  ring: THREE.Mesh;
  x: number;
  z: number;
  facing: number;
  aim: number;
  alive: boolean;
  /** Shown to the player (always for blue; red while seen). */
  shown: boolean;
  /** Inside a carrier. */
  aboard: boolean;
  wreck: boolean;
  speed: number;
  flash: number;
  fall: number;
  hunker: boolean;
  /** Last pose given to its soldiers, so idle frames do not churn. */
  pose: 'stand' | 'walk' | 'run' | 'kneel' | 'prone' | 'aim' | 'fire';
  /** Where it was last frame, to roll its wheels and tracks by the distance driven. */
  lastX: number;
  lastZ: number;
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const lerpAngle = (a: number, b: number, k: number) => a + wrap(b - a) * k;
const ease = (k: number) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
/** Grid heading to a three.js yaw for a model that faces +z. */
const yawOf = (facing: number) => Math.PI / 2 - facing;

/** Main rotor blades and rpm, for the blade slap. */
const ROTOR: Partial<Record<TypeId, [number, number]>> = { ah64e: [4, 289], ka52: [3, 257], mi35: [5, 240], ah6: [6, 475], uh60: [4, 258], mi8: [5, 192] };

const BLUE_RING = 0x7fb2e5;
const RED_RING = 0xe0705e;

/** Where each soldier of a unit stands in its cell: a loose wedge facing its heading. */
function slot(i: number, n: number, facing: number, spread: number): [number, number] {
  if (n <= 1) return [0, 0];
  const row = Math.floor((i + 1) / 2);
  const side = i === 0 ? 0 : i % 2 ? -1 : 1;
  const fwd = -row * 0.13 * spread;
  const lat = side * row * 0.12 * spread;
  const c = Math.cos(facing);
  const s = Math.sin(facing);
  return [fwd * c - lat * s, fwd * s + lat * c];
}

export interface StageOptions {
  quality: Quality;
  settings: ArenaSettings;
  lib: Library | null;
  arsenal: { blue: 'us' | 'europe' | 'russia' | 'legacy'; red: 'us' | 'europe' | 'russia' | 'legacy' };
}

export class BattleStage {
  readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(34, 1, 0.1, 400);
  private readonly world: World;
  private readonly fx: Effects;
  private readonly crowd: SoldierCrowd;
  readonly audio: BattleAudio;
  private readonly views = new Map<string, View>();
  private readonly steps: Step[] = [];
  private readonly tiles: THREE.InstancedMesh;
  private readonly dashTiles: THREE.InstancedMesh;
  private readonly areaTiles: THREE.InstancedMesh;
  private readonly targetRings: THREE.InstancedMesh;
  private readonly ghostMarks: THREE.InstancedMesh;
  private readonly selRing: THREE.Mesh;
  private pathLine: THREE.Mesh | null = null;
  private readonly ray = new THREE.Raycaster();
  private overlay: Overlay = { selected: null, reach: [], dash: [], path: null, targets: [], area: null, ghosts: [] };
  private hud: [number, number] = [0.12, 0.26];
  // Orbit camera: a focus on the ground, a heading round it, a tilt and a distance.
  private readonly focus = new THREE.Vector3(W / 2, 0, H - 8);
  private readonly wantFocus = new THREE.Vector3(W / 2, 0, H - 8);
  private yaw = 0;
  private wantYaw = 0;
  private tilt = THREE.MathUtils.degToRad(52);
  private wantTilt = THREE.MathUtils.degToRad(52);
  private dist = 22;
  private wantDist = 22;
  private shake = 0;
  private clock = 0;
  private thermal = false;
  /** An action cam in progress: where to look from and at, and for how long. */
  private cam: { from: THREE.Vector3; at: THREE.Vector3; t: number; dur: number } | null = null;
  private readonly preset;
  /** Frame timing (ms of our own work per frame), for the performance probe. */
  private readonly frameMs: number[] = [];
  private readonly saved = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();

  constructor(
    private readonly host: HTMLElement,
    private readonly battle: Battle,
    private readonly opts: StageOptions,
  ) {
    this.preset = QUALITY[opts.quality];
    this.renderer = new THREE.WebGLRenderer({ antialias: this.preset.antialias, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.preset.pixelRatio));
    this.renderer.shadowMap.enabled = this.preset.shadowMap > 0;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.setAttribute('data-testid', 'arena-canvas');
    this.renderer.domElement.style.touchAction = 'none';
    // setSize(..., false) leaves CSS alone: pin it to the host or a 2x screen shows a quarter of the field.
    Object.assign(this.renderer.domElement.style, { width: '100%', height: '100%', display: 'block' });
    host.appendChild(this.renderer.domElement);

    const lib = opts.lib;
    this.world = buildWorld(this.renderer, this.scene, battle.map, battle.conditions, opts.quality, battle.seed, lib ? { hesco: lib.hesco, container: lib.container, tower: lib.tower } : undefined);
    const sun = this.world.lights.sun;
    if (this.preset.shadowMap > 0) {
      sun.castShadow = true;
      sun.shadow.mapSize.set(this.preset.shadowMap, this.preset.shadowMap);
    }
    const night = battle.conditions.time === 'night';
    this.fx = new Effects(this.scene, opts.quality, { biome: battle.conditions.biome, night, heightAt: (x, z) => this.world.heightAt(x, z) });
    this.fx.setArsenals?.(opts.arsenal.blue, opts.arsenal.red);
    this.crowd = new SoldierCrowd({ max: 420, shadows: this.preset.soldierShadows, scale: 1.7 });
    this.scene.add(this.crowd.group);
    this.audio = new BattleAudio({ radio: opts.settings.radio });
    this.audio.setNight(night);
    this.audio.ambience(battle.conditions.biome, battle.conditions.weather);

    const tileGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const tile = (color: number, opacity: number, n: number) => {
      const m = new THREE.InstancedMesh(tileGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }), n);
      m.count = 0;
      m.renderOrder = 2;
      m.frustumCulled = false;
      this.scene.add(m);
      return m;
    };
    this.tiles = tile(BLUE_RING, 0.17, W * H);
    this.dashTiles = tile(BLUE_RING, 0.07, W * H);
    this.areaTiles = tile(RED_RING, 0.55, 49);
    const ringGeo = new THREE.RingGeometry(0.42, 0.5, 40).rotateX(-Math.PI / 2);
    this.targetRings = new THREE.InstancedMesh(ringGeo, new THREE.MeshBasicMaterial({ color: RED_RING, transparent: true, opacity: 0.95, depthWrite: false }), 40);
    this.targetRings.count = 0;
    this.targetRings.renderOrder = 3;
    this.targetRings.frustumCulled = false;
    this.scene.add(this.targetRings);
    const ghostGeo = new THREE.RingGeometry(0.28, 0.34, 4, 1).rotateX(-Math.PI / 2).rotateY(Math.PI / 4);
    this.ghostMarks = new THREE.InstancedMesh(ghostGeo, new THREE.MeshBasicMaterial({ color: RED_RING, transparent: true, opacity: 0.6, depthWrite: false }), 64);
    this.ghostMarks.count = 0;
    this.ghostMarks.renderOrder = 3;
    this.ghostMarks.frustumCulled = false;
    this.scene.add(this.ghostMarks);
    this.selRing = new THREE.Mesh(new THREE.RingGeometry(0.46, 0.56, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthWrite: false }));
    this.selRing.visible = false;
    this.selRing.renderOrder = 4;
    this.scene.add(this.selRing);

    const seen = new Set(Object.keys(battle.intel.blue).filter((id) => battle.intel.blue[id]!.now));
    for (const u of battle.units) this.addUnit(u, u.side === 'blue' || seen.has(u.id));
    // Open over the attackers' line, close enough to read the models.
    const blue = battle.units.filter((u) => u.side === 'blue');
    const cx = blue.reduce((s, u) => s + u.x + 0.5, 0) / Math.max(1, blue.length);
    const cz = blue.reduce((s, u) => s + u.y + 0.5, 0) / Math.max(1, blue.length);
    this.wantFocus.set(cx, 0, cz - 4);
    this.focus.copy(this.wantFocus);
    this.resize();
  }

  // --- Units -------------------------------------------------------------------------------------

  private paint(side: Side) {
    const arsenal = this.opts.arsenal[side];
    return paintFor(arsenal === 'us' || arsenal === 'europe' ? 'west' : 'east', arsenal, this.battle.conditions.biome);
  }

  private addUnit(u: Unit, shown: boolean): void {
    const t = typeOf(u.type);
    const holder = new THREE.Group();
    this.scene.add(holder);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.4, 0.45, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: u.side === 'blue' ? BLUE_RING : RED_RING, transparent: true, opacity: 0.55, depthWrite: false }));
    ring.position.y = 0.03;
    ring.renderOrder = 1;
    holder.add(ring);
    const v: View = { id: u.id, side: u.side, type: u.type, t, holder, models: [null, null], lod: 0, men: [], ring, x: u.x + 0.5, z: u.y + 0.5, facing: u.facing, aim: u.aim, alive: u.alive, shown, aboard: !!u.carrier, wreck: false, speed: 0, flash: 0, fall: 0, hunker: u.hunker, pose: 'kneel', lastX: u.x + 0.5, lastZ: u.y + 0.5 };
    if (t.mobility === 'foot') {
      const faction = t.faction;
      u.men.forEach((m, i) => {
        if (m.state === 'dead') return;
        const id = `${u.id}#${i}`;
        const [ox, oz] = slot(i, u.men.length, u.facing, 1);
        this.crowd.add(id, faction, kitFor(u.type, m.role), v.x + ox, v.z + oz, yawOf(u.facing));
        v.men.push(id);
      });
    } else {
      const lod: 0 | 1 = this.preset.detailCells > 0 ? 0 : 1;
      v.lod = lod;
      v.models[lod] = buildModel(u.type, { paint: this.paint(u.side), lod, ...(this.opts.lib && u.type === 'ah64e' ? { apache: this.opts.lib.heli } : {}) });
      holder.add(v.models[lod]!.root);
    }
    this.views.set(u.id, v);
    this.place(v);
    this.setShown(v, shown && !v.aboard);
  }

  private model(v: View): UnitModel | null {
    return v.models[v.lod];
  }

  /** Swap a vehicle between its full and simple model by distance from the camera focus. */
  private setLod(v: View, lod: 0 | 1): void {
    if (v.lod === lod || v.t.mobility === 'foot' || v.wreck) return;
    const old = this.model(v);
    if (!v.models[lod]) v.models[lod] = buildModel(v.type, { paint: this.paint(v.side), lod, ...(this.opts.lib && v.type === 'ah64e' ? { apache: this.opts.lib.heli } : {}) });
    if (old) v.holder.remove(old.root);
    v.lod = lod;
    v.holder.add(v.models[lod]!.root);
    if (this.thermal) this.thermalUnit(v, true);
  }

  private setShown(v: View, on: boolean): void {
    const show = on && !v.aboard;
    v.holder.visible = show;
    for (const id of v.men) this.crowd.set(id, { y: show ? undefined : -50 });
  }

  private ground(x: number, z: number): number {
    return this.world.heightAt(x, z);
  }

  /** Put a unit's holder (and its soldiers) where its view says. */
  private place(v: View): void {
    const lift = this.model(v)?.lift ?? 0;
    v.holder.position.set(v.x, this.ground(v.x, v.z) + (v.fall > 0 ? Math.max(0, lift * (1 - v.fall)) : lift), v.z);
    v.holder.rotation.y = yawOf(v.facing);
    const m = this.model(v);
    if (m) m.turret.rotation.y = wrap(v.aim - v.facing) * -1;
    if (v.t.mobility === 'foot' && v.shown && !v.aboard) {
      const n = v.men.length;
      v.men.forEach((id, i) => {
        const [ox, oz] = slot(i, n, v.facing, 1);
        const x = v.x + ox;
        const z = v.z + oz;
        this.crowd.set(id, { x, z, y: this.ground(x, z), facing: yawOf(v.facing) });
      });
    }
  }

  private posePeople(v: View, pose: View['pose'], speed = 0): void {
    if (v.pose === pose && !speed) return;
    v.pose = pose;
    for (const id of v.men) this.crowd.set(id, { pose, speed });
  }

  // --- Camera ------------------------------------------------------------------------------------

  /** The HUD covers the top and bottom of the screen; keep the battlefield framed between them. */
  setHud(top: number, bottom: number): void {
    this.hud = [top, bottom];
  }

  resize(): void {
    const w = this.host.clientWidth || 1;
    const h = this.host.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.applyCamera(0);
  }

  private get maxDist(): number {
    return this.camera.aspect < 1 ? 70 : 52;
  }

  private placeCamera(): void {
    // The focus sits a little above the middle of the screen, between the HUD bars.
    const band = (this.hud[1] - this.hud[0]) * 0.5;
    const half = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const shift = this.dist * band * half;
    const fx = this.focus.x - Math.sin(this.yaw) * shift;
    const fz = this.focus.z - Math.cos(this.yaw) * shift;
    const gy = this.ground(this.focus.x, this.focus.z);
    const r = Math.cos(this.tilt) * this.dist;
    this.camera.position.set(fx + Math.sin(this.yaw) * r, gy + Math.sin(this.tilt) * this.dist, fz + Math.cos(this.yaw) * r);
    if (this.shake > 0) this.camera.position.add(new THREE.Vector3((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake));
    this.camera.lookAt(fx, gy, fz);
    this.camera.updateMatrixWorld(true);
  }

  private applyCamera(dt: number): void {
    const k = dt <= 0 ? 1 : 1 - Math.exp(-dt * 6);
    this.wantFocus.x = Math.max(0, Math.min(W, this.wantFocus.x));
    this.wantFocus.z = Math.max(0, Math.min(H, this.wantFocus.z));
    this.focus.lerp(this.wantFocus, k);
    this.yaw = lerpAngle(this.yaw, this.wantYaw, k);
    this.tilt += (this.wantTilt - this.tilt) * k;
    this.dist += (this.wantDist - this.dist) * k;
    if (this.cam) {
      // An action cam: low and close, then back to the planning view.
      const c = this.cam;
      const p = Math.min(1, c.t / c.dur);
      const blend = p < 0.15 ? p / 0.15 : p > 0.85 ? (1 - p) / 0.15 : 1;
      this.placeCamera();
      const plan = this.camera.position.clone();
      const look = new THREE.Vector3();
      this.camera.getWorldDirection(look);
      const planAt = plan.clone().add(look.multiplyScalar(this.dist));
      this.camera.position.lerpVectors(plan, c.from, ease(blend));
      this.camera.lookAt(planAt.lerp(c.at, ease(blend)));
      this.camera.updateMatrixWorld(true);
      return;
    }
    this.placeCamera();
  }

  /** Drag the board by a screen distance (pixels). */
  panBy(dx: number, dy: number): void {
    const h = this.host.clientHeight || 1;
    const perPx = (2 * this.dist * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) / h;
    const c = Math.cos(this.yaw);
    const s = Math.sin(this.yaw);
    const mx = -dx * perPx;
    const mz = (-dy * perPx) / Math.max(0.4, Math.sin(this.tilt));
    this.wantFocus.x += mx * c + mz * s;
    this.wantFocus.z += -mx * s + mz * c;
    this.focus.copy(this.wantFocus);
  }

  /** Zoom in (factor below 1) or out. */
  zoomBy(factor: number): void {
    this.wantDist = Math.max(6, Math.min(this.maxDist, this.wantDist * factor));
  }

  /** Orbit round the focus (radians) and tilt (radians, positive looks more straight down). */
  orbitBy(yaw: number, tilt = 0): void {
    this.wantYaw = wrap(this.wantYaw + yaw);
    this.wantTilt = Math.max(THREE.MathUtils.degToRad(28), Math.min(THREE.MathUtils.degToRad(82), this.wantTilt + tilt));
  }

  /** Bring a point into view if it is near the edge or off screen; `centre` always centres it. */
  follow(x: number, z: number, centre = false): void {
    const p = new THREE.Vector3(x, this.ground(x, z), z).project(this.camera);
    const top = 1 - this.hud[0] * 2;
    const bottom = -1 + this.hud[1] * 2;
    const margin = 0.25;
    if (centre || Math.abs(p.x) > 1 - margin || p.y > top - margin || p.y < bottom + margin || p.z > 1) this.wantFocus.set(x, 0, z);
  }

  focusOn(cell: Point): void {
    this.follow(cell.x + 0.5, cell.y + 0.5);
  }

  /** The cell under a screen point, or null off the field. */
  pick(clientX: number, clientY: number): Point | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    // March along the ray to the heightfield.
    const o = this.ray.ray.origin;
    const d = this.ray.ray.direction;
    let prev = 0;
    for (let s = 0; s < 400; s += 0.25) {
      const x = o.x + d.x * s;
      const y = o.y + d.y * s;
      const z = o.z + d.z * s;
      const g = this.ground(x, z);
      if (y <= g) {
        // Refine between the last two samples.
        let lo = prev;
        let hi = s;
        for (let i = 0; i < 8; i++) {
          const m = (lo + hi) / 2;
          if (o.y + d.y * m <= this.ground(o.x + d.x * m, o.z + d.z * m)) hi = m;
          else lo = m;
        }
        const cx = Math.floor(o.x + d.x * hi);
        const cy = Math.floor(o.z + d.z * hi);
        return cx >= 0 && cy >= 0 && cx < W && cy < H ? { x: cx, y: cy } : null;
      }
      prev = s;
    }
    return null;
  }

  /** A cell's centre on screen, `h` world units above the ground. */
  toScreen(x: number, y: number, h = 0): Point {
    const p = new THREE.Vector3(x + 0.5, this.ground(x + 0.5, y + 0.5) + h, y + 0.5).project(this.camera);
    const r = this.renderer.domElement.getBoundingClientRect();
    return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height };
  }

  unitScreen(id: string): Point | null {
    const v = this.views.get(id);
    if (!v || !v.holder.visible) return null;
    return this.toScreen(v.x - 0.5, v.z - 0.5, (this.model(v)?.lift ?? 0) + 0.3);
  }

  // --- Overlay -------------------------------------------------------------------------------------

  setOverlay(o: Overlay): void {
    this.overlay = o;
    const m = new THREE.Matrix4();
    const put = (mesh: THREE.InstancedMesh, cells: number[]) => {
      let n = 0;
      for (const i of cells) {
        if (n >= mesh.instanceMatrix.count) break;
        const x = (i % W) + 0.5;
        const z = Math.floor(i / W) + 0.5;
        m.makeTranslation(x, this.ground(x, z) + 0.04, z);
        mesh.setMatrixAt(n++, m);
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
    };
    put(this.tiles, o.reach);
    put(this.dashTiles, o.dash);
    if (o.area) {
      const cells: number[] = [];
      for (let dy = -o.area.r; dy <= o.area.r; dy++)
        for (let dx = -o.area.r; dx <= o.area.r; dx++) {
          const x = o.area.at.x + dx;
          const y = o.area.at.y + dy;
          if (x >= 0 && y >= 0 && x < W && y < H) cells.push(y * W + x);
        }
      put(this.areaTiles, cells);
    } else this.areaTiles.count = 0;
    let n = 0;
    for (const id of o.targets) {
      const v = this.views.get(id);
      if (!v || !v.holder.visible || n >= 40) continue;
      m.makeTranslation(v.x, this.ground(v.x, v.z) + (this.model(v)?.lift ?? 0) + 0.05, v.z);
      this.targetRings.setMatrixAt(n++, m);
    }
    this.targetRings.count = n;
    this.targetRings.instanceMatrix.needsUpdate = true;
    n = 0;
    for (const g of o.ghosts) {
      if (n >= 64) break;
      const x = g.x + 0.5;
      const z = g.y + 0.5;
      m.makeTranslation(x, this.ground(x, z) + 0.05, z);
      this.ghostMarks.setMatrixAt(n++, m);
    }
    this.ghostMarks.count = n;
    this.ghostMarks.instanceMatrix.needsUpdate = true;
    if (this.pathLine) {
      this.scene.remove(this.pathLine);
      this.pathLine.geometry.dispose();
      this.pathLine = null;
    }
    if (o.path && o.path.length > 1) {
      const pts = o.path.map((p) => new THREE.Vector3(p.x + 0.5, this.ground(p.x + 0.5, p.y + 0.5) + 0.08, p.y + 0.5));
      const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
      this.pathLine = new THREE.Mesh(new THREE.TubeGeometry(curve, pts.length * 6, 0.035, 5, false), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false }));
      this.pathLine.renderOrder = 5;
      this.scene.add(this.pathLine);
    }
    const sel = o.selected ? this.views.get(o.selected) : undefined;
    this.selRing.visible = !!sel && sel.holder.visible;
    if (sel) this.selRing.position.set(sel.x, this.ground(sel.x, sel.z) + 0.06, sel.z);
  }

  // --- Night and thermal -------------------------------------------------------------------------

  get night(): boolean {
    return this.battle.conditions.time === 'night';
  }

  setThermal(on: boolean): void {
    if (this.thermal === on) return;
    this.thermal = on;
    this.world.setThermal(on);
    this.fx.setThermal(on);
    for (const v of this.views.values()) this.thermalUnit(v, on);
  }

  private thermalUnit(v: View, on: boolean): void {
    const m = this.model(v);
    if (!m) return;
    const hot = new Map<THREE.Object3D, number>();
    for (const h of m.heat) {
      hot.set(h.obj, h.level);
      // The engine deck, exhaust and barrel proxies only show in the thermal view.
      h.obj.visible = on && !v.wreck;
    }
    m.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      if (on) {
        if (!this.saved.has(mesh)) this.saved.set(mesh, mesh.material);
        let level = v.wreck ? 0.8 : 0.45;
        for (let p: THREE.Object3D | null = mesh; p; p = p.parent) if (hot.has(p)) level = Math.max(level, hot.get(p)!);
        mesh.material = thermalMaterialFor(level);
      } else if (this.saved.has(mesh)) {
        mesh.material = this.saved.get(mesh)!;
        this.saved.delete(mesh);
      }
    });
  }

  // --- The film ----------------------------------------------------------------------------------

  get busy(): boolean {
    return this.steps.length > 0 || this.cam !== null;
  }

  play(events: readonly BattleEvent[]): void {
    for (const e of events) this.queue(e);
  }

  /** Skip to the end of what is queued (fast-forward). */
  skip(): void {
    for (let n = 0; n < 5000 && this.steps.length; n++) {
      const s = this.steps[0]!;
      if (!s.started) {
        s.started = true;
        s.start?.();
      }
      s.tick?.(1, 0);
      s.end?.();
      this.steps.shift();
    }
    this.cam = null;
  }

  private step(dur: number, s: Omit<Step, 'dur' | 't' | 'started'>): void {
    this.steps.push({ dur, t: 0, started: false, ...s });
  }

  private now(fn: () => void): void {
    this.step(0, { start: fn });
  }

  private worldOf(p: Point, h = 0.15): THREE.Vector3 {
    return new THREE.Vector3(p.x + 0.5, this.ground(p.x + 0.5, p.y + 0.5) + h, p.y + 0.5);
  }

  private muzzleOf(v: View): THREE.Vector3 {
    const m = this.model(v);
    if (!m) return new THREE.Vector3(v.x, this.ground(v.x, v.z) + 0.18, v.z);
    const holder = m.gun ?? m.turret;
    v.holder.updateMatrixWorld(true);
    return holder.localToWorld(m.muzzle.clone());
  }

  private centreOf(v: View): THREE.Vector3 {
    return new THREE.Vector3(v.x, this.ground(v.x, v.z) + (this.model(v)?.lift ?? 0) + (v.t.mobility === 'foot' ? 0.1 : 0.14), v.z);
  }

  private actionCam(at: THREE.Vector3, from?: THREE.Vector3): void {
    if (!this.opts.settings.actionCams || this.cam) return;
    const dir = from ? at.clone().sub(from).setY(0).normalize() : new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)).negate();
    const eye = at.clone().sub(dir.multiplyScalar(3.2)).add(new THREE.Vector3(0, 1.1, 0));
    eye.y = Math.max(eye.y, this.ground(eye.x, eye.z) + 0.6);
    this.cam = { from: eye, at: at.clone(), t: 0, dur: 1.6 };
  }

  private queue(e: BattleEvent): void {
    const v = 'unit' in e ? this.views.get(e.unit) : undefined;
    switch (e.type) {
      case 'turn':
        this.step(0.2, {});
        break;
      case 'move': {
        if (!v) break;
        if (v.side === 'red' && !e.seen.some(Boolean)) {
          // Unseen: it is somewhere else now, out of sight.
          this.now(() => {
            const last = e.path.at(-1)!;
            v.x = last.x + 0.5;
            v.z = last.y + 0.5;
            this.place(v);
          });
          break;
        }
        const pts = e.path.map((p) => new THREE.Vector2(p.x + 0.5, p.y + 0.5));
        const foot = v.t.mobility === 'foot';
        const per = foot ? (e.dash ? 0.2 : 0.26) : v.t.mobility === 'heli' || v.t.mobility === 'drone' ? 0.1 : v.t.mobility === 'wheeled' ? 0.13 : 0.16;
        let dust = 0;
        const len = pts.length - 1;
        this.step(per * len + 0.1, {
          start: () => {
            this.follow(pts.at(-1)!.x, pts.at(-1)!.y);
            if (foot) this.posePeople(v, e.dash ? 'run' : 'walk', 1);
          },
          tick: (k, dt) => {
            const f = ease(k) * len;
            const i = Math.min(len - 1, Math.floor(f));
            const a = pts[i]!;
            const b = pts[i + 1]!;
            const t = f - i;
            v.x = a.x + (b.x - a.x) * t;
            v.z = a.y + (b.y - a.y) * t;
            const shown = v.side === 'blue' || !!e.seen[Math.round(f)];
            if (v.holder.visible !== shown) this.setShown(v, shown);
            v.shown = shown;
            const dir = Math.atan2(b.y - a.y, b.x - a.x);
            v.facing = lerpAngle(v.facing, dir, Math.min(1, dt * 12));
            v.aim = lerpAngle(v.aim, dir, Math.min(1, dt * 8));
            v.speed = dt > 0 ? 1 : 0;
            dust -= dt;
            if (dust <= 0 && !foot && shown && v.t.mobility !== 'heli' && v.t.mobility !== 'drone') {
              dust = 0.09;
              this.fx.dust(new THREE.Vector3(v.x - Math.cos(v.facing) * 0.4, this.ground(v.x, v.z) + 0.05, v.z - Math.sin(v.facing) * 0.4), 1);
            }
            if (!foot) this.audio.engine(v.id, v.t.engine === 'turbine' ? 'turbine' : 'diesel', v.x - 0.5, v.z - 0.5, 0.9);
            this.place(v);
          },
          end: () => {
            const last = pts.at(-1)!;
            v.x = last.x;
            v.z = last.y;
            v.speed = 0;
            if (foot) this.posePeople(v, 'kneel');
            this.place(v);
            if (!foot) this.audio.engine(v.id, v.t.engine === 'turbine' ? 'turbine' : 'diesel', v.x - 0.5, v.z - 0.5, 0.2);
          },
        });
        break;
      }
      case 'face':
        if (!v) break;
        this.step(0.25, {
          tick: (_k, dt) => {
            v.facing = lerpAngle(v.facing, e.facing, Math.min(1, dt * 10));
            v.aim = lerpAngle(v.aim, e.facing, Math.min(1, dt * 10));
            this.place(v);
          },
        });
        break;
      case 'fire':
        this.queueFire(e, v);
        break;
      case 'intercept': {
        const target = this.views.get(e.by);
        this.now(() => {
          if (!e.seen) return;
          const p = this.worldOf({ x: e.x, y: e.y }, 0.8);
          this.fx.explosion(p, 0.4, 'airburst');
          this.audio.impact('small', e.x, e.y);
          if (target) target.flash = 0.4;
        });
        break;
      }
      case 'impact':
        if (!v) break;
        this.step(e.pen ? 0.35 : 0.2, {
          start: () => {
            if (!e.seen && v.side === 'red') return;
            const c = this.centreOf(v);
            this.fx.hit(c, new THREE.Vector3(0, 1, 0), e.pen ? 'pen' : 'bounce');
            this.audio.impact(e.pen ? 'ke_hit' : 'bounce', e.x, e.y);
            v.flash = e.pen ? 1 : 0.5;
            if (e.pen) this.shake = Math.max(this.shake, 0.06);
          },
        });
        break;
      case 'casualties':
        if (!v) break;
        this.now(() => {
          // The fallen go down where they stand; the wounded lie and move.
          let killed = e.killed;
          let wounded = e.wounded;
          const u = this.battle.units.find((x) => x.id === v.id);
          for (const id of [...v.men].reverse()) {
            if (!killed && !wounded) break;
            if (killed) {
              this.crowd.set(id, { pose: 'dead' });
              killed--;
            } else {
              this.crowd.set(id, { pose: 'wounded' });
              wounded--;
            }
            v.men = v.men.filter((m) => m !== id);
          }
          void u;
        });
        break;
      case 'suppressed':
        if (!v || v.t.mobility !== 'foot') break;
        this.now(() => this.posePeople(v, e.level === 'pinned' || e.level === 'broken' ? 'prone' : 'kneel'));
        break;
      case 'destroyed':
        if (!v) break;
        this.step(e.how === 'wiped' || e.how === 'expended' ? 0.1 : 0.7, {
          start: () => {
            v.alive = false;
            const c = this.centreOf(v);
            const seen = e.seen || v.side === 'blue';
            if (v.t.mobility === 'foot') {
              for (const id of v.men) this.crowd.set(id, { pose: 'dead' });
              v.men = [];
              v.ring.visible = false;
              return;
            }
            if (!seen) {
              v.holder.visible = false;
              return;
            }
            this.setShown(v, true);
            v.ring.visible = false;
            if (e.how === 'destroyed' || e.how === 'shot_down') {
              this.fx.catastrophic(c);
              this.fx.burn(v.id, c, v.t.armour && v.t.armour.hf[0] >= 300 ? 1.2 : 0.8);
              this.audio.impact('big', e.x, e.y);
              this.shake = Math.max(this.shake, 0.14);
              this.actionCam(c);
            }
            if (e.how === 'shot_down' || e.how === 'landed') v.fall = 0.001;
            this.wreck(v);
            this.audio.stop(v.id);
            this.fx.stopRotorWash(v.id);
          },
        });
        break;
      case 'boom':
        this.step(0.3, {
          start: () => {
            const p = this.worldOf({ x: e.x, y: e.y }, 0.02);
            const kind = e.kind === 'bombs' ? 'bombs' : e.kind === 'rockets' ? 'rockets' : e.kind === 'mine' ? 'mine' : e.kind === 'smoke' ? 'he' : 'shell';
            this.fx.explosion(p, e.size, kind);
            this.audio.impact(e.kind === 'bombs' ? 'bombs' : e.kind === 'rockets' ? 'rockets' : e.kind === 'mine' ? 'mine' : 'shell', e.x, e.y);
            this.shake = Math.max(this.shake, 0.05 * e.size);
          },
        });
        break;
      case 'smoke':
        this.now(() => {
          this.fx.smoke(e.cells);
          if (e.side === 'blue') this.audio.impact('small', e.cells[0]?.x ?? 0, e.cells[0]?.y ?? 0);
        });
        break;
      case 'crater':
        this.now(() => this.world.addCrater(e.x, e.y));
        break;
      case 'terrain':
        this.now(() => {
          this.world.setCell(e.x, e.y, this.battle.map);
          if (e.cell === 6) {
            this.fx.collapse(this.worldOf({ x: e.x, y: e.y }, 0.1), 1);
            this.audio.impact('building', e.x, e.y);
          }
        });
        break;
      case 'embark':
        if (!v) break;
        this.step(0.4, {
          start: () => this.posePeople(v, 'run', 1),
          end: () => {
            v.aboard = true;
            this.setShown(v, false);
          },
        });
        break;
      case 'dismount': {
        const carrier = this.views.get(e.carrier);
        this.step(0.5, {
          start: () => {
            for (const d of e.units) {
              const p = this.views.get(d.id);
              if (!p) continue;
              p.aboard = false;
              p.x = (carrier?.x ?? d.x + 0.5);
              p.z = (carrier?.z ?? d.y + 0.5);
              p.shown = p.side === 'blue' || e.seen;
              this.setShown(p, p.shown);
              this.posePeople(p, 'run', 1);
            }
          },
          tick: (k) => {
            for (const d of e.units) {
              const p = this.views.get(d.id);
              if (!p || !carrier) continue;
              p.x = carrier.x + (d.x + 0.5 - carrier.x) * k;
              p.z = carrier.z + (d.y + 0.5 - carrier.z) * k;
              this.place(p);
            }
          },
          end: () => {
            for (const d of e.units) {
              const p = this.views.get(d.id);
              if (!p) continue;
              p.x = d.x + 0.5;
              p.z = d.y + 0.5;
              this.posePeople(p, 'kneel');
              this.place(p);
            }
          },
        });
        break;
      }
      case 'split':
      case 'merge':
        this.now(() => this.resync());
        break;
      case 'treat':
      case 'repair':
        this.step(0.3, {});
        break;
      case 'mine':
        break;
      case 'spotted':
        if (e.side !== 'blue') break;
        this.now(() => {
          const s = this.views.get(e.unit);
          if (!s) return;
          s.shown = true;
          s.x = e.x + 0.5;
          s.z = e.y + 0.5;
          this.place(s);
          this.setShown(s, true);
        });
        break;
      case 'lost':
        if (e.side !== 'blue') break;
        this.now(() => {
          const s = this.views.get(e.unit);
          if (!s || !s.alive) return;
          s.shown = false;
          this.setShown(s, false);
        });
        break;
      case 'ability':
        if (e.id === 'airstrike') this.step(0.6, { start: () => this.audio.incoming(e.x, e.y, 0.6) });
        break;
      case 'radio':
        if (e.side === 'blue') this.now(() => this.audio.radio(e.call, { dir: this.direction(e.unit) }));
        break;
      case 'capture':
        this.now(() => this.world.setZone(e.rounds / 2));
        break;
      case 'end':
        this.step(0.6, {});
        break;
    }
  }

  /** Where a contact is, relative to the attackers' advance (north is front). */
  private direction(id: string): 'front' | 'left' | 'right' | 'rear' {
    const v = this.views.get(id);
    if (!v) return 'front';
    const blue = [...this.views.values()].filter((x) => x.side === 'blue' && x.alive);
    const cx = blue.reduce((s, x) => s + x.x, 0) / Math.max(1, blue.length);
    const cz = blue.reduce((s, x) => s + x.z, 0) / Math.max(1, blue.length);
    const a = Math.atan2(v.z - cz, v.x - cx);
    const rel = wrap(a + Math.PI / 2);
    return Math.abs(rel) < Math.PI / 4 ? 'front' : Math.abs(rel) > (3 * Math.PI) / 4 ? 'rear' : rel > 0 ? 'right' : 'left';
  }

  private queueFire(e: Extract<BattleEvent, { type: 'fire' }>, v: View | undefined): void {
    const target = e.target ? this.views.get(e.target) : undefined;
    const to = target ? this.centreOf(target) : this.worldOf(e.to, 0.05);
    if (!e.hit && target) {
      // A miss goes past: land it a little beyond.
      to.add(new THREE.Vector3((Math.random() - 0.5) * 0.8, 0, (Math.random() - 0.5) * 0.8));
    }
    const offMap = !v;
    const shooterShown = offMap ? false : v!.side === 'blue' || e.seen;
    const from = v ? this.muzzleOf(v) : this.worldOf(e.from, 8);
    const want = v ? Math.atan2(e.to.y + 0.5 - v.z, e.to.x + 0.5 - v.x) : 0;
    const kind = e.kind;
    const d = from.distanceTo(to);
    const foot = v?.t.mobility === 'foot';
    if (v && shooterShown) {
      this.step(0.18, {
        start: () => {
          this.follow((v.x + to.x) / 2, (v.z + to.z) / 2);
          if (foot) this.posePeople(v, 'aim');
          if (v.side === 'red' && !v.holder.visible) this.setShown(v, true);
        },
        tick: (_k, dt) => {
          v.aim = lerpAngle(v.aim, want, Math.min(1, dt * 14));
          if (foot || v.t.mobility === 'heli' || v.t.mobility === 'drone') v.facing = lerpAngle(v.facing, want, Math.min(1, dt * 10));
          this.place(v);
        },
        end: () => {
          v.aim = want;
          this.place(v);
        },
      });
    }
    const side: Side = v?.side ?? (e.unit.startsWith('support') ? (e.from.y > H / 2 ? 'blue' : 'red') : 'red');
    let flight = 0.12;
    if (kind === 'atgm' || kind === 'manpads') flight = Math.min(1.6, 0.35 + d * 0.06);
    else if (kind === 'rocket') flight = Math.min(1.2, 0.2 + d * 0.05);
    else if (kind === 'mortar' || kind === 'howitzer') flight = Math.min(2.2, 0.8 + d * 0.04);
    else if (kind === 'fpv' || kind === 'loiter') flight = Math.min(2.4, 0.9 + d * 0.07);
    else if (kind === 'cannon') flight = 0.12 + d * 0.006;
    else flight = 0.25;
    this.step(flight, {
      start: () => {
        if (shooterShown && v) {
          const dir = to.clone().sub(from).normalize();
          this.fx.muzzle(from, dir, e.calibre);
          if (foot) this.posePeople(v, 'fire');
          v.flash = Math.max(v.flash, 0.15);
        }
        if (shooterShown || offMap || (target && target.holder.visible)) this.audio.shot(e.calibre, (v?.x ?? to.x) - 0.5, (v?.z ?? to.z) - 0.5, { night: this.night });
        const shownTo = target ? target.holder.visible : true;
        if (!shooterShown && !shownTo && !offMap) return;
        if (kind === 'atgm' || kind === 'manpads') this.fx.missile(from, to, kind === 'manpads' ? 'manpads' : e.weapon.toLowerCase().includes('hellfire') ? 'hellfire' : 'atgm', flight, { top: !!typeOf(v?.type ?? 'm1a2').weapons.find((w) => w.id === e.weapon)?.top });
        else if (kind === 'rocket') this.fx.missile(from, to, 'rocket', flight);
        else if (kind === 'mortar' || kind === 'howitzer') {
          this.fx.shell(from, to, flight);
          this.audio.incoming(e.to.x, e.to.y, flight);
        } else if (kind === 'fpv' || kind === 'loiter') {
          const model = buildProjectile(e.weapon.includes('switch') || v?.type === 'switchblade' ? 'switchblade' : v?.type === 'lancet' ? 'lancet' : 'fpv');
          this.fx.drone(from, to, flight, v?.type === 'switchblade' ? 'switchblade' : v?.type === 'lancet' ? 'lancet' : 'fpv', model);
          this.audio.drone(`d${this.clock}`, 'fpv', e.to.x, e.to.y);
        } else {
          const bursts = kind === 'mg' || kind === 'small_arms' ? 5 : kind === 'autocannon' ? 3 : 1;
          for (let i = 0; i < bursts; i++) this.fx.tracer(from, to.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.25, 0, (Math.random() - 0.5) * 0.25)), e.calibre, side, flight);
        }
        if ((kind === 'atgm' || kind === 'fpv' || kind === 'loiter') && e.hit && target && this.opts.settings.actionCams && (target.t.armour?.hf[0] ?? 0) >= 300) this.actionCam(to, from);
      },
      end: () => {
        if (foot && v) this.posePeople(v, 'aim');
        if (!e.hit && !(kind === 'mortar' || kind === 'howitzer')) this.fx.hit(to, new THREE.Vector3(0, 1, 0), 'small');
      },
    });
  }

  private wreck(v: View): void {
    v.wreck = true;
    const m = this.model(v);
    if (!m) return;
    for (const mat of m.paint) {
      const s = mat as THREE.MeshStandardMaterial;
      if (s.color) s.color.multiplyScalar(0.28);
      s.roughness = 1;
    }
    this.world.scorch(Math.floor(v.x), Math.floor(v.z));
  }

  /** Re-read units from the battle (after splits, merges and anything the film cannot show). */
  resync(): void {
    for (const u of this.battle.units) {
      let v = this.views.get(u.id);
      if (!v) {
        this.addUnit(u, u.side === 'blue' || !!this.battle.intel.blue[u.id]?.now);
        v = this.views.get(u.id)!;
      }
      if (v.t.mobility === 'foot' && u.alive) {
        const live = u.men.map((m, i) => ({ m, i })).filter(({ m }) => m.state !== 'dead');
        const fit = live.filter(({ m }) => m.state === 'fit').map(({ i }) => `${u.id}#${i}`);
        // Soldiers that left this unit (a split) move to the other half.
        for (const id of v.men) if (!fit.includes(id)) this.crowd.remove(id);
        for (const id of fit) if (!v.men.includes(id)) this.crowd.add(id, v.t.faction, kitFor(u.type, u.men[Number(id.split('#')[1])]!.role), v.x, v.z, yawOf(v.facing));
        v.men = fit;
        v.type = u.type;
      }
      v.x = u.x + 0.5;
      v.z = u.y + 0.5;
      v.facing = u.facing;
      v.aim = u.aim;
      v.aboard = !!u.carrier;
      this.place(v);
      this.setShown(v, (u.side === 'blue' || !!this.battle.intel.blue[u.id]?.now) && u.alive);
    }
    for (const [id, v] of this.views) if (!this.battle.units.some((u) => u.id === id)) {
      for (const s of v.men) this.crowd.remove(s);
      this.scene.remove(v.holder);
      this.views.delete(id);
    }
  }

  // --- Frame ---------------------------------------------------------------------------------------

  frame(dt: number): void {
    const t0 = performance.now();
    this.clock += dt;
    // Play the film: one step at a time.
    let budget = dt;
    while (this.steps.length && budget >= 0) {
      const s = this.steps[0]!;
      if (!s.started) {
        s.started = true;
        s.start?.();
      }
      const take = Math.min(budget, s.dur - s.t);
      s.t += take;
      budget -= take;
      s.tick?.(s.dur > 0 ? Math.min(1, s.t / s.dur) : 1, take);
      if (s.t >= s.dur - 1e-6) {
        s.end?.();
        this.steps.shift();
        if (s.dur > 0) break;
      } else break;
    }
    if (this.cam) {
      this.cam.t += dt;
      if (this.cam.t >= this.cam.dur) this.cam = null;
    }
    for (const v of this.views.values()) {
      const m = this.model(v);
      if (v.t.mobility === 'foot' || !m) continue;
      // Detail by distance from what the camera looks at.
      const near = Math.hypot(v.x - this.focus.x, v.z - this.focus.z) <= this.preset.detailCells;
      this.setLod(v, near ? 0 : 1);
      const mm = this.model(v)!;
      // Roll the wheels and tracks by the distance driven this frame (forward is along the hull).
      const moved = (v.x - v.lastX) * Math.cos(v.facing) + (v.z - v.lastZ) * Math.sin(v.facing);
      v.lastX = v.x;
      v.lastZ = v.z;
      if (v.alive && !v.wreck) {
        for (const r of mm.rotors) r.obj.rotation[r.axis] += r.rate * dt;
        if (moved) {
          for (const w of mm.wheels) w.rotation.x += moved / Math.max(0.001, mm.wheelRadius);
          for (const tr of mm.tracks) {
            const map = (tr as THREE.MeshStandardMaterial).map;
            if (map) map.offset.y += moved * mm.trackScroll;
          }
        }
        if (v.t.mobility === 'heli' && v.holder.visible) {
          this.fx.rotorWash(v.id, new THREE.Vector3(v.x, this.ground(v.x, v.z), v.z), 0.8);
          const [blades, rpm] = ROTOR[v.type] ?? [4, 280];
          this.audio.rotor(v.id, blades, rpm, v.x - 0.5, v.z - 0.5, { coaxial: v.type === 'ka52' });
        }
      }
      if (v.fall > 0 && v.fall < 1) {
        v.fall = Math.min(1, v.fall + dt * 1.4);
        v.holder.rotation.z = v.fall * 0.6;
        this.place(v);
      }
      if (v.flash > 0) {
        v.flash = Math.max(0, v.flash - dt * 3);
        for (const mat of mm.paint) {
          const s = mat as THREE.MeshStandardMaterial;
          if (s.emissive) s.emissive.setRGB(v.flash * 0.6, v.flash * 0.3, v.flash * 0.1);
        }
      }
    }
    this.shake = Math.max(0, this.shake - dt * 0.6);
    this.applyCamera(dt);
    this.world.update(dt, this.camera);
    this.fx.update(dt, this.camera);
    this.crowd.update(dt);
    this.audio.setListener({ x: this.focus.x - 0.5, y: this.focus.z - 0.5, zoom: Math.min(1, this.dist / this.maxDist) });
    this.audio.update(dt);
    this.renderer.render(this.scene, this.camera);
    this.frameMs.push(performance.now() - t0);
    if (this.frameMs.length > 600) this.frameMs.shift();
  }

  /** Our own work per frame (ms) and what the GPU was asked to draw, for the performance probe. */
  perf(): { p50: number; p95: number; frames: number; calls: number; triangles: number; quality: Quality } {
    const s = [...this.frameMs].sort((a, b) => a - b);
    const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0;
    return { p50: q(0.5), p95: q(0.95), frames: s.length, calls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles, quality: this.opts.quality };
  }

  dispose(): void {
    this.audio.dispose();
    this.fx.dispose();
    this.crowd.dispose();
    this.world.dispose();
    for (const v of this.views.values()) for (const m of v.models) m?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

export { LEVEL, METRE };

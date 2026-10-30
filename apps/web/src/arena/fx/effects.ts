import * as THREE from 'three';
import { Debris } from './debris';
import {
  BIOME,
  FLASH,
  FX_BUDGET,
  GRAVITY,
  MAX_DEBRIS,
  MAX_PARTICLES,
  PROPELLANT,
  SMOKE_BLACK,
  SMOKE_GREY,
  SMOKE_OILY,
  SMOKE_WHITE,
  SPARK,
  SPRAY,
  TRAIL,
  calibreClass,
  tracerOf,
  type Arsenal,
  type Biome,
  type BiomeColours,
  type DroneKind,
  type ExplosionKind,
  type FxBudget,
  type HitKind,
  type MissileKind,
  type Quality,
  type Side,
  type Surface,
} from './palette';
import { FxMesh, GlowSystem, GlowTpl, SmokeSystem, SmokeTpl, type FrameCtx } from './particles';
import { puffAtlas } from './textures';

// The battle's effects: shots, tracers, missiles, shells, drones, explosions, hits, burning wrecks,
// smoke screens, dust and rotor wash. Everything is drawn by two instanced meshes (smoke and fire
// sorted together in one, debris and projectile bodies in the other), capped by the quality preset,
// with no allocation per frame.
// The scene calls the methods as its film plays and `update` once a frame before rendering.

export interface EffectsOptions {
  biome: Biome;
  night: boolean;
  /** Ground height (world units) under a point. */
  heightAt: (x: number, z: number) => number;
}

/** The last big hit, for the scene's camera shake: `time` is on the effects clock (`Effects.time`). */
export interface BigHit {
  time: number;
  size: number;
}

const FLAME = GlowTpl.FLAME;
const GLOW = GlowTpl.GLOW;
const STREAK = GlowTpl.STREAK;
const GROUND = GlowTpl.GROUND;

const K_HE = 0;
const K_SHELL = 1;
const K_BOMBS = 2;
const K_MINE = 3;
const K_AIRBURST = 4;
const K_ROCKET = 5;
const KIND_CODE: Record<ExplosionKind, number> = { he: K_HE, shell: K_SHELL, rockets: K_ROCKET, bombs: K_BOMBS, mine: K_MINE, airburst: K_AIRBURST };

const FLASH_LIGHT = [1, 0.72, 0.45] as const;
const FIRE_LIGHT = [1, 0.5, 0.2] as const;
const EMBER = [1, 0.42, 0.12] as const;
const FIRE_GLOW = [1, 0.45, 0.14] as const;
const BODY = [0.09, 0.1, 0.08] as const;
const METAL = [0.13, 0.12, 0.1] as const;
const CONCRETE = [0.33, 0.31, 0.28] as const;
const WP = [0.95, 0.95, 0.9] as const;

interface Burn {
  id: string;
  x: number;
  y: number;
  z: number;
  size: number;
  /** Seconds since stopBurn, or -1 while burning. */
  dying: number;
  flame: number;
  smoke: number;
  ember: number;
  seed: number;
}

interface Screen {
  owner: number;
  handle: string;
  cells: Float32Array;
  acc: Float32Array;
  until: number;
  /** Seconds since clearSmoke, or -1. */
  clearing: number;
}

interface Wash {
  id: string;
  x: number;
  y: number;
  z: number;
  strength: number;
  surface: Surface;
  last: number;
  acc: number;
  ring: number;
}

const T_COOKOFF = 0;
const T_COLLAPSE = 1;

interface Timed {
  active: boolean;
  kind: number;
  x: number;
  y: number;
  z: number;
  size: number;
  t: number;
  dur: number;
  a: number;
  b: number;
  c: number;
  pop: number;
}

const P_MISSILE = 0;
const P_SHELL = 1;
const P_DRONE = 2;

interface Projectile {
  active: boolean;
  type: number;
  missile: MissileKind;
  drone: DroneKind;
  top: boolean;
  p0: THREE.Vector3;
  p1: THREE.Vector3;
  p2: THREE.Vector3;
  p3: THREE.Vector3;
  /** Drones: the dive's control points (cruise ends at p3, dive ends at d3). */
  d1: THREE.Vector3;
  d2: THREE.Vector3;
  d3: THREE.Vector3;
  split: number;
  pos: THREE.Vector3;
  prev: THREE.Vector3;
  t: number;
  dur: number;
  accel: number;
  trail: number;
  spacing: number;
  seed: number;
  model: THREE.Object3D | null;
}

const MAX_PROJECTILES = 48;
const MAX_DELAYED = 64;
const MAX_FLASHES = 16;
/** A light flash this strong or more is a bright flash (an autocannon's muzzle and up; a machine gun's is not). */
const BRIGHT_FLASH = 5;
const MAX_CANDIDATES = 48;

function bezier(out: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, t: number): THREE.Vector3 {
  const u = 1 - t;
  const k0 = u * u * u;
  const k1 = 3 * u * u * t;
  const k2 = 3 * u * t * t;
  const k3 = t * t * t;
  return out.set(a.x * k0 + b.x * k1 + c.x * k2 + d.x * k3, a.y * k0 + b.y * k1 + c.y * k2 + d.y * k3, a.z * k0 + b.z * k1 + c.z * k2 + d.z * k3);
}

export class Effects {
  /** The last big hit (explosions, catastrophic kills, penetrations), for camera shake. */
  readonly lastBigHit: BigHit = { time: -1, size: 0 };

  private readonly scene: THREE.Scene;
  private readonly heightAt: (x: number, z: number) => number;
  private biome: BiomeColours;
  private biomeName: Biome;
  private night: boolean;
  private thermal = false;
  private budget: FxBudget;
  private readonly atlas: THREE.DataTexture;
  private readonly smokeSys: SmokeSystem;
  private readonly glowSys: GlowSystem;
  private readonly fxMesh: FxMesh;
  private readonly debris: Debris;
  private readonly st = new SmokeTpl();
  private readonly gt = new GlowTpl();
  private readonly lights: THREE.PointLight[] = [];
  /** When the last bright flash went off (ms, real time). */
  private brightAt = -Infinity;
  private readonly ctx: FrameCtx;
  private clock = 0;
  private lastDt = 1 / 60;
  /** 0 with room to spare, 1 when the sprite budget is full: long-running emitters thin out and grow their sprites. */
  private pressure = 0;
  private frame = 0;
  private seed = 0x2545f491;
  private windX = 0.28;
  private windZ = 0.1;
  private tracerBlue: readonly number[] = tracerOf('us');
  private tracerRed: readonly number[] = tracerOf('russia');

  private readonly burns: Burn[] = [];
  private readonly screens: Screen[] = [];
  private readonly washes: Wash[] = [];
  private readonly timed: Timed[] = [];
  private readonly projectiles: Projectile[] = [];
  private nextOwner = 1;

  // Explosions waiting their turn (rocket ripples, airburst fragments).
  private readonly dT = new Float32Array(MAX_DELAYED);
  private readonly dX = new Float32Array(MAX_DELAYED);
  private readonly dY = new Float32Array(MAX_DELAYED);
  private readonly dZ = new Float32Array(MAX_DELAYED);
  private readonly dS = new Float32Array(MAX_DELAYED);
  private readonly dK = new Uint8Array(MAX_DELAYED);
  private delayed = 0;

  // Brief lights (shots, blasts) competing for the point-light pool.
  private readonly fX = new Float32Array(MAX_FLASHES);
  private readonly fY = new Float32Array(MAX_FLASHES);
  private readonly fZ = new Float32Array(MAX_FLASHES);
  private readonly fI = new Float32Array(MAX_FLASHES);
  private readonly fT = new Float32Array(MAX_FLASHES);
  private readonly fK = new Float32Array(MAX_FLASHES);
  private readonly fR = new Float32Array(MAX_FLASHES);
  private flashNext = 0;
  private readonly cX = new Float32Array(MAX_CANDIDATES);
  private readonly cY = new Float32Array(MAX_CANDIDATES);
  private readonly cZ = new Float32Array(MAX_CANDIDATES);
  private readonly cI = new Float32Array(MAX_CANDIDATES);
  private readonly cD = new Float32Array(MAX_CANDIDATES);
  private readonly cFire = new Uint8Array(MAX_CANDIDATES);
  private readonly cS = new Float32Array(MAX_CANDIDATES);

  private readonly v1 = new THREE.Vector3();
  private readonly v2 = new THREE.Vector3();
  private readonly v3 = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly q = new THREE.Quaternion();
  private readonly m4 = new THREE.Matrix4();
  private readonly fwd = new THREE.Vector3(0, 0, 1);

  constructor(scene: THREE.Scene, quality: Quality, opts: EffectsOptions) {
    this.scene = scene;
    this.heightAt = opts.heightAt;
    this.biomeName = opts.biome;
    this.biome = BIOME[opts.biome];
    this.night = opts.night;
    this.budget = FX_BUDGET[quality];
    this.atlas = puffAtlas();
    this.smokeSys = new SmokeSystem(MAX_PARTICLES);
    this.glowSys = new GlowSystem(MAX_PARTICLES);
    this.fxMesh = new FxMesh(MAX_PARTICLES, this.atlas);
    this.debris = new Debris(MAX_DEBRIS + 24, this.budget.debris);
    scene.add(this.fxMesh.mesh, this.debris.mesh);
    this.ctx = { dt: 0, frame: 0, windX: 0, windZ: 0, camX: 0, camY: 0, camZ: 0, fwdX: 0, fwdY: 0, fwdZ: -1, heightAt: opts.heightAt };
    for (let i = 0; i < MAX_PROJECTILES; i++) {
      const v = () => new THREE.Vector3();
      this.projectiles.push({ active: false, type: 0, missile: 'atgm', drone: 'fpv', top: false, p0: v(), p1: v(), p2: v(), p3: v(), d1: v(), d2: v(), d3: v(), split: 1, pos: v(), prev: v(), t: 0, dur: 1, accel: 0, trail: 0, spacing: 0.1, seed: 0, model: null });
    }
    for (let i = 0; i < 12; i++) this.timed.push({ active: false, kind: 0, x: 0, y: 0, z: 0, size: 1, t: 0, dur: 1, a: 0, b: 0, c: 0, pop: 0 });
    this.setLightCount(this.budget.flashLights);
    this.setNight(opts.night);
  }

  // --- Settings ---------------------------------------------------------------------------------

  /** Seconds on the effects clock (what `lastBigHit.time` is measured on). */
  get time(): number {
    return this.clock;
  }

  /** Anything short-lived still playing: projectiles, ripples, flashes, sparks, flying debris. */
  get busy(): boolean {
    if (this.delayed > 0 || this.glowSys.busyCount > 0 || this.debris.flying > 0) return true;
    for (const p of this.projectiles) if (p.active) return true;
    for (const t of this.timed) if (t.active) return true;
    return false;
  }

  /** Live sprites and draw calls, for the quality HUD and tests. */
  stats(): { particles: number; smoke: number; glow: number; debris: number; drawCalls: number; lights: number } {
    const calls = (this.fxMesh.mesh.visible ? 1 : 0) + (this.debris.mesh.visible ? 1 : 0);
    return { particles: this.smokeSys.live + this.glowSys.live, smoke: this.smokeSys.live, glow: this.glowSys.live, debris: this.debris.mesh.count, drawCalls: calls, lights: this.lights.length };
  }

  setQuality(quality: Quality): void {
    this.budget = FX_BUDGET[quality];
    this.debris.setLimit(this.budget.debris);
    this.setLightCount(this.budget.flashLights);
  }

  setBiome(biome: Biome): void {
    this.biomeName = biome;
    this.biome = BIOME[biome];
  }

  /** NATO arsenals fire red tracers, Russian ones green. */
  setArsenals(blue: Arsenal, red: Arsenal): void {
    this.tracerBlue = tracerOf(blue);
    this.tracerRed = tracerOf(red);
  }

  /** Wind in world units a second: smoke drifts and columns lean with it. */
  setWind(x: number, z: number): void {
    this.windX = x;
    this.windZ = z;
  }

  /** The sun (or moon) for lighting smoke: a direction toward it and its colour. */
  setSun(dir: THREE.Vector3, colour?: THREE.Color): void {
    (this.fxMesh.material.uniforms.uSunDir!.value as THREE.Vector3).copy(dir).normalize();
    if (colour) (this.fxMesh.material.uniforms.uSunCol!.value as THREE.Color).copy(colour);
  }

  /** Sky and ground light on smoke (top and underside). */
  setAmbient(sky: THREE.Color, ground: THREE.Color): void {
    (this.fxMesh.material.uniforms.uSky!.value as THREE.Color).copy(sky);
    (this.fxMesh.material.uniforms.uGround!.value as THREE.Color).copy(ground);
  }

  setNight(night: boolean): void {
    this.night = night;
    const u = this.fxMesh.material.uniforms;
    if (night) {
      (u.uSunCol!.value as THREE.Color).setRGB(0.06, 0.07, 0.1);
      (u.uSky!.value as THREE.Color).setRGB(0.028, 0.033, 0.05);
      (u.uGround!.value as THREE.Color).setRGB(0.01, 0.01, 0.012);
      (u.uFire!.value as THREE.Color).setRGB(1.9, 0.72, 0.22);
    } else {
      (u.uSunCol!.value as THREE.Color).setRGB(1.45, 1.36, 1.22);
      (u.uSky!.value as THREE.Color).setRGB(0.42, 0.46, 0.52);
      (u.uGround!.value as THREE.Color).setRGB(0.2, 0.18, 0.15);
      (u.uFire!.value as THREE.Color).setRGB(0.55, 0.22, 0.07);
    }
  }

  /** Thermal view: fire and fresh blasts white-hot, smoke grey and see-through. */
  setThermal(on: boolean): void {
    this.thermal = on;
    this.fxMesh.material.uniforms.uThermal!.value = on ? 1 : 0;
  }

  /** Reseed the effects' own random numbers (the preview uses this for repeatable frames). */
  setSeed(seed: number): void {
    this.seed = seed | 0;
  }

  private setLightCount(n: number): void {
    while (this.lights.length > n) {
      const l = this.lights.pop()!;
      this.scene.remove(l);
      l.dispose();
    }
    while (this.lights.length < n) {
      const l = new THREE.PointLight(0xffa860, 0, 5, 2);
      this.lights.push(l);
      this.scene.add(l);
    }
  }

  // --- Small helpers ----------------------------------------------------------------------------

  private r(): number {
    let t = (this.seed = (this.seed + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  private rr(a: number, b: number): number {
    return a + (b - a) * this.r();
  }

  /** A sprite count scaled by the quality's density, at least one. */
  private cnt(n: number): number {
    return Math.max(1, Math.round(n * this.budget.density));
  }

  /** Fewer sprites on lower presets are drawn bigger so the cover holds. */
  private get cover(): number {
    return 1 + (1 - this.budget.density) * 0.55;
  }

  /** Room for one more sprite: under budget, or by evicting a sprite worth less. */
  private room(imp: number): boolean {
    const s = this.smokeSys;
    const g = this.glowSys;
    const total = s.live + g.live;
    if (total < this.budget.particles) return true;
    let best = -1;
    let bestSmoke = true;
    let bestScore = imp;
    for (let k = 0; k < 10; k++) {
      const fromSmoke = this.r() * total < s.live;
      const sys = fromSmoke ? s : g;
      const slot = sys.sample(this.r());
      if (slot < 0) continue;
      const sc = sys.score(slot);
      if (sc < bestScore) {
        bestScore = sc;
        best = slot;
        bestSmoke = fromSmoke;
      }
    }
    if (best < 0) return false;
    (bestSmoke ? s : g).kill(best);
    return true;
  }

  private puff(x: number, y: number, z: number): number {
    if (!this.room(this.st.imp)) return -1;
    return this.smokeSys.emit(this.st, x, y, z, this.heightAt(x, z), this.r(), this.r());
  }

  private glow(x: number, y: number, z: number, gy = y - 10): number {
    if (!this.room(this.gt.imp)) return -1;
    return this.glowSys.emit(this.gt, x, y, z, gy, this.r(), this.r());
  }

  private flash(x: number, y: number, z: number, intensity: number, decay: number, range: number): void {
    if (this.lights.length === 0) return;
    // Bright flashes no more than three a second, in real time whatever the film's speed (WCAG 2.3.1).
    if (intensity >= BRIGHT_FLASH) {
      const now = performance.now();
      if (now - this.brightAt < 1000 / 3) return;
      this.brightAt = now;
    }
    const i = this.flashNext;
    this.flashNext = (i + 1) % MAX_FLASHES;
    this.fX[i] = x;
    this.fY[i] = y;
    this.fZ[i] = z;
    this.fI[i] = intensity;
    this.fT[i] = this.clock;
    this.fK[i] = decay;
    this.fR[i] = range;
  }

  private bigHit(size: number): void {
    this.lastBigHit.time = this.clock;
    this.lastBigHit.size = size;
  }

  private projectile(): Projectile | null {
    for (const p of this.projectiles) if (!p.active) return p;
    return null;
  }

  private timer(kind: number, x: number, y: number, z: number, size: number, dur: number): Timed | null {
    for (const t of this.timed) {
      if (t.active) continue;
      t.active = true;
      t.kind = kind;
      t.x = x;
      t.y = y;
      t.z = z;
      t.size = size;
      t.t = 0;
      t.dur = dur;
      t.a = t.b = t.c = 0;
      t.pop = 0.2;
      return t;
    }
    return null;
  }

  // --- Shots ------------------------------------------------------------------------------------

  /** Muzzle flash scaled by calibre, a blast dust ring under big guns, a puff of propellant smoke. */
  muzzle(at: THREE.Vector3, dir: THREE.Vector3, calibre: string): void {
    const cls = calibreClass(calibre);
    if (cls === 'none') return;
    const d = this.v1.copy(dir);
    if (d.lengthSq() < 1e-8) d.set(0, 0, 1);
    d.normalize();
    const big = cls === 'gun' || cls === 'arty';
    const k = cls === 'small' ? 0.05 : cls === 'hmg' ? 0.09 : cls === 'auto' ? 0.16 : cls === 'gun' ? 0.42 : cls === 'arty' ? 0.6 : 0.2;
    const boost = this.night ? 1.4 : 1;
    const g = this.gt;

    if (cls !== 'launcher') {
      g.reset(FLAME);
      g.s0 = k * 0.8;
      g.s1 = k * 1.4;
      g.life = big ? 0.09 : 0.05;
      g.inten = 1.4 * boost;
      g.heat = 0.95;
      g.cool = 0.8;
      g.vx = d.x * k * 5;
      g.vy = d.y * k * 5;
      g.vz = d.z * k * 5;
      g.imp = 2;
      this.glow(at.x + d.x * k * 0.6, at.y + d.y * k * 0.6, at.z + d.z * k * 0.6);
      // The forward cone of burning gas.
      g.reset(STREAK).colour(FLASH, 0.8);
      g.s0 = g.s1 = k * 0.6;
      g.lenMax = k * 1.1;
      g.ax = d.x;
      g.ay = d.y;
      g.az = d.z;
      g.life = big ? 0.05 : 0.035;
      g.inten = 1.2 * boost;
      g.fade = 2;
      g.imp = 2;
      this.glow(at.x + d.x * k * 1.2, at.y + d.y * k * 1.2, at.z + d.z * k * 1.2);
      if (cls === 'arty') {
        // Muzzle brake: flame jets out to both sides.
        const sx = -d.z;
        const sz = d.x;
        for (let side = -1; side <= 1; side += 2) {
          g.reset(STREAK).colour(FLASH, 0.8);
          g.s0 = g.s1 = k * 0.4;
          g.lenMax = k * 1.1;
          g.ax = sx * side;
          g.ay = 0.15;
          g.az = sz * side;
          g.life = 0.06;
          g.inten = 1.2 * boost;
          g.fade = 2;
          g.imp = 1.8;
          this.glow(at.x + sx * side * k * 1.1, at.y + 0.02, at.z + sz * side * k * 1.1);
          g.reset(FLAME);
          g.s0 = k * 0.3;
          g.s1 = k * 0.6;
          g.life = 0.07;
          g.inten = 1.2 * boost;
          g.vx = sx * side * k * 5;
          g.vz = sz * side * k * 5;
          g.imp = 1.6;
          this.glow(at.x + sx * side * k * 0.5, at.y, at.z + sz * side * k * 0.5);
        }
      }
    }
    g.reset(GLOW).colour(FLASH);
    g.s0 = k * 2.4;
    g.s1 = k * 3.4;
    g.life = big ? 0.1 : 0.05;
    g.inten = this.night ? 1.1 : 0.3;
    g.fade = 2;
    g.imp = 1.5;
    this.glow(at.x, at.y, at.z);
    const li = cls === 'arty' ? 22 : cls === 'gun' ? 14 : cls === 'auto' ? 5 : cls === 'hmg' ? 2.5 : cls === 'launcher' ? 6 : 0;
    if (li > 0) this.flash(at.x, at.y, at.z, li, 22, big ? 6 : 3);

    const s = this.st;
    if (cls === 'launcher') {
      // Back-blast: a launch flash and a cloud of smoke (and dust, near the ground) thrown out behind.
      const grounded = at.y - this.heightAt(at.x, at.z) < 0.6;
      for (let i = 0, n = this.cnt(grounded ? 6 : 3); i < n; i++) {
        const c = grounded && i % 2 === 0 ? this.biome.dust : PROPELLANT;
        s.reset().colour(c, c);
        const sp = this.rr(1.4, 2.8);
        s.vx = -d.x * sp + this.rr(-0.5, 0.5);
        s.vy = -d.y * sp + this.rr(0.05, 0.4);
        s.vz = -d.z * sp + this.rr(-0.5, 0.5);
        s.s0 = 0.08;
        s.s1 = this.rr(0.45, 0.7) * this.cover;
        s.grow = 0.5;
        s.life = this.rr(1.6, 2.6);
        s.drag = 2.6;
        s.alpha = 0.5;
        s.dens = 0.5;
        s.hot = 0.6;
        s.imp = 0.8;
        this.puff(at.x - d.x * 0.15, at.y, at.z - d.z * 0.15);
      }
      return;
    }
    if (cls !== 'small' || this.r() < 0.25) {
      const n = big ? this.cnt(4) : 1;
      for (let i = 0; i < n; i++) {
        s.reset().colour(PROPELLANT, SMOKE_GREY, 1, 1.4);
        const sp = k * this.rr(3, 7);
        s.vx = d.x * sp;
        s.vy = d.y * sp + 0.05;
        s.vz = d.z * sp;
        s.s0 = k * 0.6;
        s.s1 = k * (big ? this.rr(2.6, 3.6) : 2.2) * this.cover;
        s.grow = 0.7;
        s.life = big ? this.rr(2.8, 4.2) : 1.4;
        s.drag = 3;
        s.buoy = 0.04;
        s.alpha = big ? 0.55 : 0.32;
        s.dens = 0.45;
        s.hot = 0.5;
        s.imp = 0.8;
        this.puff(at.x + d.x * k * (1 + i), at.y + d.y * k * (1 + i), at.z + d.z * k * (1 + i));
      }
    }
    const gy = this.heightAt(at.x, at.z);
    if (big && at.y - gy < 0.8) {
      // The blast slaps the ground: a ring of dust racing out, mostly forward and to the sides.
      s.reset().colour(this.biome.dust);
      s.flat = true;
      s.ring = 0.12;
      s.s0 = s.s1 = k * 6;
      s.life = 0.55;
      s.fadeIn = 0.02;
      s.fadeOut = 0.4;
      s.alpha = 0.35;
      s.dens = 0.2;
      s.wind = 0;
      s.imp = 0.7;
      this.puff(at.x + d.x * k, gy + 0.03, at.z + d.z * k);
      const yaw = Math.atan2(d.z, d.x);
      for (let i = 0, n = this.cnt(14); i < n; i++) {
        const a = yaw + this.rr(-2.1, 2.1);
        const fwd = Math.cos(a - yaw);
        const sp = this.rr(1.8, 3.4) * (0.7 + 0.5 * Math.max(0, fwd)) * (cls === 'arty' ? 1.3 : 1);
        s.reset().colour(i % 3 ? this.biome.dust : this.biome.dirt, this.biome.dust, 0.95, 1.05);
        s.vx = Math.cos(a) * sp;
        s.vz = Math.sin(a) * sp;
        s.vy = this.rr(0.1, 0.4);
        s.s0 = 0.18;
        s.s1 = this.rr(0.7, 1.1) * this.cover;
        s.grow = 0.6;
        s.life = this.rr(2.2, 3.4);
        s.fadeOut = 1.6;
        s.drag = 2.4;
        s.alpha = 0.55;
        s.dens = 0.6;
        s.hot = 0.4;
        s.imp = 0.7;
        this.puff(at.x + Math.cos(a) * 0.25, gy + 0.1, at.z + Math.sin(a) * 0.25);
      }
    }
  }

  /** A tracer round in flight: red for NATO arsenals, green for Russian; bright at night, faint by day. */
  tracer(from: THREE.Vector3, to: THREE.Vector3, calibre: string, side: Side, seconds: number): void {
    const cls = calibreClass(calibre);
    const c = side === 'blue' ? this.tracerBlue : this.tracerRed;
    const t = Math.max(0.03, seconds);
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const w = cls === 'small' ? 0.014 : cls === 'hmg' ? 0.02 : cls === 'auto' ? 0.03 : 0.04;
    const g = this.gt;
    g.reset(STREAK).colour(c);
    g.vx = dx / t;
    g.vy = dy / t;
    g.vz = dz / t;
    g.life = t;
    g.fade = 0;
    g.imp = 2.2;
    if (this.night) {
      g.s0 = g.s1 = w * 1.7;
      g.stretch = 0.07;
      g.lenMax = Math.min(1.4, dist * 0.35);
      g.inten = 3.2;
    } else {
      g.s0 = g.s1 = w;
      g.stretch = 0.035;
      g.lenMax = Math.min(0.6, dist * 0.2);
      g.inten = 1.1;
    }
    this.glow(from.x, from.y, from.z);
    if (this.night) {
      // A soft halo travels with it.
      g.reset(GLOW).colour(c);
      g.vx = dx / t;
      g.vy = dy / t;
      g.vz = dz / t;
      g.s0 = g.s1 = w * 16;
      g.life = t;
      g.fade = 0;
      g.inten = 0.35;
      g.imp = 1.4;
      this.glow(from.x, from.y, from.z);
    }
  }

  /** A guided missile or rocket: body, motor flare and a smoke trail. Top attack climbs, then dives. */
  missile(from: THREE.Vector3, to: THREE.Vector3, kind: MissileKind, seconds: number, opts?: { top?: boolean }): void {
    const p = this.projectile();
    if (!p) return;
    const top = !!opts?.top;
    p.active = true;
    p.type = P_MISSILE;
    p.missile = kind;
    p.top = top;
    p.model = null;
    p.t = 0;
    p.dur = Math.max(0.1, seconds);
    p.seed = this.r() * 100;
    p.p0.copy(from);
    p.p3.copy(to);
    p.pos.copy(from);
    p.prev.copy(from);
    p.trail = 0;
    const d = this.v1.subVectors(to, from);
    const dist = d.length();
    const up = this.up;
    if (top) {
      // Javelin profile: a soft launch, a steep climb, then a dive onto the roof.
      const apex = Math.min(3, Math.max(0.8, dist * 0.3));
      p.p1.copy(from).addScaledVector(d, 0.12).addScaledVector(up, apex * 1.35);
      p.p2.copy(to).addScaledVector(d, -0.1).addScaledVector(up, apex * 1.25);
      p.accel = 1;
    } else if (kind === 'manpads') {
      p.p1.copy(from).addScaledVector(d, 0.2).addScaledVector(up, dist * 0.12);
      p.p2.copy(to).addScaledVector(d, -0.3).addScaledVector(up, dist * 0.04);
      p.accel = 0.3;
    } else if (kind === 'hellfire') {
      p.p1.copy(from).addScaledVector(d, 0.3).addScaledVector(up, dist * 0.06);
      p.p2.copy(to).addScaledVector(d, -0.25).addScaledVector(up, dist * 0.12);
      p.accel = 0.5;
    } else {
      const loft = kind === 'rocket' ? 0.07 : 0.04;
      p.p1.copy(from).addScaledVector(d, 1 / 3).addScaledVector(up, dist * loft);
      p.p2.copy(from).addScaledVector(d, 2 / 3).addScaledVector(up, dist * loft);
      p.accel = kind === 'rocket' ? 0 : 0.6;
    }
    const n = kind === 'atgm' ? (top ? 60 : 46) : 64;
    p.spacing = Math.max(0.08, (dist * 1.25) / Math.max(12, n * this.budget.density));
    // Launch: flash and a puff at the tube.
    this.v2.copy(p.p1).sub(from).normalize();
    this.muzzle(from, this.v2, 'atgm');
  }

  /** A lobbed artillery or mortar round: a dark body on a high arc with a faint base-bleed trail. */
  shell(from: THREE.Vector3, to: THREE.Vector3, seconds: number): void {
    const p = this.projectile();
    if (!p) return;
    p.active = true;
    p.type = P_SHELL;
    p.model = null;
    p.t = 0;
    p.dur = Math.max(0.1, seconds);
    p.p0.copy(from);
    p.p3.copy(to);
    p.pos.copy(from);
    p.prev.copy(from);
    p.trail = 0;
    const dist = from.distanceTo(to);
    // p1.y holds the apex height above the straight line.
    p.p1.set(0, Math.max(1.5, dist * 0.38), 0);
    p.spacing = Math.max(0.25, dist / Math.max(6, 16 * this.budget.density));
    p.accel = 0;
  }

  /** A strike drone: cruise toward the target, then dive. A given model is flown and hidden on arrival. */
  drone(from: THREE.Vector3, to: THREE.Vector3, seconds: number, kind: DroneKind, model?: THREE.Object3D): void {
    const p = this.projectile();
    if (!p) return;
    p.active = true;
    p.type = P_DRONE;
    p.drone = kind;
    p.model = model ?? null;
    p.t = 0;
    p.dur = Math.max(0.2, seconds);
    p.seed = this.r() * 100;
    p.pos.copy(from);
    p.prev.copy(from);
    const d = this.v1.subVectors(to, from);
    d.y = 0;
    const flat = Math.max(0.01, d.length());
    d.multiplyScalar(1 / flat);
    const cruise = kind === 'fpv' ? 0.5 : kind === 'switchblade' ? 1.6 : 2.6;
    const back = kind === 'fpv' ? 0.9 : kind === 'switchblade' ? 1.3 : 0.5;
    p.split = kind === 'fpv' ? 0.8 : kind === 'switchblade' ? 0.72 : 0.66;
    const base = Math.max(this.heightAt(from.x, from.z), this.heightAt(to.x, to.z));
    // Cruise: climb out, run in at height, end above and short of the target.
    p.p0.copy(from);
    p.p3.copy(to).addScaledVector(d, -Math.min(back, flat * 0.4));
    p.p3.y = base + cruise;
    p.p1.copy(from).addScaledVector(d, flat * 0.2);
    p.p1.y = base + cruise * 1.1;
    p.p2.copy(p.p3).addScaledVector(d, -flat * 0.25);
    p.p2.y = base + cruise;
    // Dive: tip over and drop onto the target, steepest for the Lancet.
    p.d1.copy(p.p3).addScaledVector(d, back * 0.35);
    p.d2.copy(to);
    p.d2.y += kind === 'fpv' ? 0.25 : cruise * 0.45;
    p.d3.copy(to);
    p.accel = 0;
    if (p.model) p.model.visible = true;
  }

  // --- Impacts ----------------------------------------------------------------------------------

  /** An explosion by kind and size (about the blast radius in cells: 0.25 for 30 mm HE, 1 for 152 mm, 2.5 for bombs). */
  explosion(at: THREE.Vector3, size: number, kind: ExplosionKind): void {
    const code = KIND_CODE[kind];
    if (code === K_ROCKET) {
      // A salvo: a ripple of blasts walking over the area.
      const n = Math.round((7 + size * 6) * (0.6 + 0.4 * this.budget.density));
      const radius = 0.8 + size * 1.2;
      const span = 0.9 + size * 0.5;
      for (let i = 0; i < n; i++) {
        const a = this.r() * Math.PI * 2;
        const rad = Math.sqrt(this.r()) * radius;
        const x = at.x + Math.cos(a) * rad;
        const z = at.z + Math.sin(a) * rad;
        this.later((i / n) * span + this.rr(0, 0.12), x, this.heightAt(x, z), z, this.rr(0.5, 0.75), K_SHELL);
      }
      this.bigHit(size);
      return;
    }
    this.blast(at.x, at.y, at.z, size, code);
  }

  private later(t: number, x: number, y: number, z: number, size: number, kind: number): void {
    if (this.delayed >= MAX_DELAYED) return;
    const i = this.delayed++;
    this.dT[i] = t;
    this.dX[i] = x;
    this.dY[i] = y;
    this.dZ[i] = z;
    this.dS[i] = size;
    this.dK[i] = kind;
  }

  private blast(x: number, y: number, z: number, size: number, kind: number): void {
    const gy = this.heightAt(x, z);
    const air = kind === K_AIRBURST;
    const low = !air && y - gy < 0.35 + size * 0.2;
    const by = air ? y : Math.max(y, gy);
    const b = this.biome;
    this.bigHit(size);
    this.flash(x, by + 0.3 * size, z, 3 + 20 * size, 14, 1.5 + size * 3);
    const g = this.gt;
    const s = this.st;

    // Flash.
    g.reset(GLOW).colour(FLASH);
    g.s0 = size * 2;
    g.s1 = size * 2.8;
    g.life = 0.12 + size * 0.04;
    g.inten = this.night ? 2 : 0.6;
    g.fade = 2;
    g.imp = 2;
    this.glow(x, by + size * 0.3, z);

    // Fireball: brief for shells, rolling for bombs.
    const fireN = kind === K_BOMBS ? 6 + 3 * size : kind === K_SHELL ? 3 + 4 * size : kind === K_MINE ? 2 + 2 * size : 3 + 5 * size;
    const fireLife = kind === K_BOMBS ? 0.5 : kind === K_SHELL || kind === K_MINE ? 0.2 : kind === K_AIRBURST ? 0.18 : 0.28;
    for (let i = 0, n = this.cnt(fireN); i < n; i++) {
      g.reset(FLAME);
      const a = this.r() * Math.PI * 2;
      const sp = this.rr(0.6, 1.6) * size;
      g.vx = Math.cos(a) * sp;
      g.vz = Math.sin(a) * sp;
      g.vy = this.rr(0.4, 1.4) * size * (kind === K_BOMBS ? 1.3 : 1);
      g.drag = 3;
      g.s0 = size * this.rr(0.35, 0.55) * (kind === K_BOMBS ? 0.65 : 1);
      g.s1 = size * this.rr(0.8, 1.2) * (kind === K_BOMBS ? 0.7 : 1);
      g.life = fireLife * this.rr(0.7, 1.3);
      g.inten = this.night ? 1.8 : 1.3;
      g.heat = this.rr(0.8, 0.95);
      g.cool = 1;
      g.rotV = 2;
      g.imp = 1.8;
      this.glow(x + Math.cos(a) * size * 0.15, by + size * this.rr(0.1, 0.35), z + Math.sin(a) * size * 0.15);
    }

    if (air) {
      // Airburst: a dark puff hanging in the air, fragments raining down, dust kicked up below.
      for (let i = 0, n = this.cnt(4 + 4 * size); i < n; i++) {
        s.reset().colour(SMOKE_BLACK, SMOKE_GREY, 1.4, 1.1);
        s.vx = this.rr(-0.6, 0.6) * size;
        s.vy = this.rr(-0.2, 0.4) * size;
        s.vz = this.rr(-0.6, 0.6) * size;
        s.s0 = size * 0.3;
        s.s1 = size * this.rr(1, 1.5) * this.cover;
        s.grow = 0.8;
        s.life = this.rr(4, 6);
        s.drag = 2;
        s.alpha = 0.75;
        s.dens = 0.8;
        s.emis = 1;
        s.emisK = 8;
        s.hot = 0.9;
        s.wind = 1;
        s.imp = 1.1;
        this.puff(x, y, z);
      }
      this.sparks(x, y, z, this.cnt(10 + 10 * size), 0, -1, 0, 1.1, 3, 6, SPARK, 0.5, 0.9, true);
      for (let i = 0, n = this.cnt(6 + 6 * size); i < n; i++) {
        const a = this.r() * Math.PI * 2;
        const rad = Math.sqrt(this.r()) * (1 + size * 1.2);
        const px = x + Math.cos(a) * rad;
        const pz = z + Math.sin(a) * rad;
        s.reset().colour(b.dust);
        s.vy = this.rr(0.6, 1.2);
        s.s0 = 0.05;
        s.s1 = this.rr(0.25, 0.4);
        s.grow = 0.4;
        s.life = this.rr(1, 1.6);
        s.fadeIn = this.rr(0.15, 0.35);
        s.drag = 3;
        s.alpha = 0.55;
        s.dens = 0.4;
        s.imp = 0.6;
        this.puff(px, this.heightAt(px, pz) + 0.05, pz);
      }
      return;
    }

    // Column of earth thrown up: tall and dark for shells and mines, a squat cloud for small HE.
    const colN = kind === K_SHELL ? 7 + 9 * size : kind === K_MINE ? 6 + 6 * size : kind === K_BOMBS ? 10 + 6 * size : 2 + 4 * size;
    const lift = kind === K_MINE ? 6.5 : kind === K_SHELL ? 4.6 : kind === K_BOMBS ? 4.2 : 2.2;
    const spread = kind === K_MINE ? 0.12 : kind === K_SHELL ? 0.25 : 0.45;
    if (low || kind === K_HE) {
      for (let i = 0, n = this.cnt(colN); i < n; i++) {
        const dirt = i % 3 !== 2;
        const c0 = kind === K_HE && i % 2 ? SMOKE_GREY : dirt ? b.dirt : b.dust;
        s.reset().colour(c0, b.dust, 1, 1.1);
        const a = this.r() * Math.PI * 2;
        const h = this.r();
        s.vx = Math.cos(a) * spread * this.rr(0.5, 1.5) * Math.sqrt(size);
        s.vz = Math.sin(a) * spread * this.rr(0.5, 1.5) * Math.sqrt(size);
        s.vy = lift * (0.35 + 0.75 * h) * Math.sqrt(size);
        s.drag = 2.4;
        s.buoy = 0.03;
        s.s0 = size * 0.25;
        s.s1 = size * this.rr(0.8, 1.25) * this.cover * (0.8 + h * 0.5);
        s.grow = 0.9;
        s.life = this.rr(3.5, 5.5) * (kind === K_HE ? 0.7 : 1);
        s.fadeOut = 2.4;
        s.alpha = kind === K_HE ? 0.7 : 0.88;
        s.dens = 1;
        s.emis = 1;
        s.emisK = 7;
        s.hot = 0.85;
        s.wind = 0.8;
        s.rotV = 0.4;
        s.imp = 1.1;
        this.puff(x + Math.cos(a) * 0.06, gy + 0.1, z + Math.sin(a) * 0.06);
      }
    }
    if (kind === K_BOMBS || kind === K_HE) {
      // Black smoke rolling up out of the fireball.
      for (let i = 0, n = this.cnt(kind === K_BOMBS ? 6 + 4 * size : 1 + 2 * size); i < n; i++) {
        s.reset().colour(SMOKE_BLACK, SMOKE_GREY, 1, 0.9);
        // Hot gas keeps rising: low drag and real buoyancy, so it climbs as a column, not a ball.
        s.vx = this.rr(-0.3, 0.3) * size;
        s.vy = this.rr(0.5, 1.2) * size;
        s.vz = this.rr(-0.3, 0.3) * size;
        s.drag = 0.7;
        s.buoy = 0.25;
        s.s0 = size * 0.3;
        s.s1 = size * this.rr(0.8, 1.15) * this.cover;
        s.grow = 1.6;
        s.life = this.rr(4, 6.5);
        s.fadeOut = 2.5;
        s.alpha = 0.8;
        s.dens = 1;
        s.emis = 1.2;
        s.emisK = 4;
        s.hot = 1;
        s.imp = 1;
        this.puff(x, by + size * 0.3, z);
      }
    }
    if (low) {
      // Crater dust racing out low, and the shock ring for the big ones.
      for (let i = 0, n = this.cnt(kind === K_HE ? 2 + 3 * size : 6 + 6 * size); i < n; i++) {
        const a = this.r() * Math.PI * 2;
        const sp = this.rr(1.4, 2.8) * Math.sqrt(size);
        s.reset().colour(b.dust, b.dust, 1, 1.05);
        s.vx = Math.cos(a) * sp;
        s.vz = Math.sin(a) * sp;
        s.vy = this.rr(0.05, 0.3);
        s.drag = 2.2;
        s.s0 = size * 0.3;
        s.s1 = size * this.rr(0.9, 1.4) * this.cover;
        s.grow = 1;
        s.life = this.rr(3, 5.5);
        s.fadeOut = 2.5;
        s.alpha = 0.6;
        s.dens = 0.6;
        s.hot = 0.5;
        s.wind = 1;
        s.imp = 0.8;
        this.puff(x + Math.cos(a) * size * 0.2, gy + 0.1, z + Math.sin(a) * size * 0.2);
      }
      if (size >= 0.5 && kind !== K_HE) {
        s.reset().colour(b.dust, b.dust, 1.15);
        s.flat = true;
        s.ring = 0.16;
        s.s0 = s.s1 = size * 5;
        s.life = 0.6;
        s.fadeIn = 0.02;
        s.fadeOut = 0.45;
        s.alpha = 0.5;
        s.dens = 0.2;
        s.wind = 0;
        s.imp = 0.9;
        this.puff(x, gy + 0.04, z);
      }
      const chunks = kind === K_HE ? (size >= 0.4 ? 3 + 6 * size : 0) : kind === K_MINE ? 12 + 8 * size : 8 + 10 * size;
      for (let i = 0, n = Math.round(chunks * (0.5 + 0.5 * this.budget.density)); i < n; i++) {
        const a = this.r() * Math.PI * 2;
        const out = this.rr(0.4, 1.8) * Math.sqrt(size);
        const upv = this.rr(2, kind === K_MINE ? 6 : 4.6) * Math.sqrt(size);
        this.debris.throw(x, gy + 0.1, z, Math.cos(a) * out, upv, Math.sin(a) * out, this.rr(0.025, 0.06) * (0.7 + size * 0.3), i % 4 ? b.dirt : b.dust, this.rr(0.7, 1.1), this.rr(2.5, 4.5), this.r());
      }
    }
    if (kind === K_HE || kind === K_SHELL) this.sparks(x, by + 0.1, z, this.cnt(4 + 6 * size), 0, 1, 0, 1.4, 2, 4.5 * Math.sqrt(size), SPARK, 0.3, 0.7, true);
  }

  /** Sparks or fragments: streaks thrown in a cone around a direction. */
  private sparks(x: number, y: number, z: number, n: number, dx: number, dy: number, dz: number, spread: number, v0: number, v1: number, c: readonly number[], life0: number, life1: number, bounce: boolean): void {
    const g = this.gt;
    const gy = this.heightAt(x, z);
    for (let i = 0; i < n; i++) {
      g.reset(STREAK).colour(c, this.rr(0.8, 1.2));
      const sp = this.rr(v0, v1);
      let vx = dx + this.rr(-spread, spread);
      let vy = dy + this.rr(-spread, spread);
      let vz = dz + this.rr(-spread, spread);
      const l = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1;
      vx /= l;
      vy /= l;
      vz /= l;
      g.vx = vx * sp;
      g.vy = vy * sp;
      g.vz = vz * sp;
      g.grav = GRAVITY;
      g.drag = 0.8;
      g.s0 = g.s1 = 0.012;
      g.stretch = 0.035;
      g.lenMax = 0.22;
      g.life = this.rr(life0, life1);
      g.inten = this.night ? 2.6 : 1.8;
      g.fade = 1.5;
      g.bounce = bounce;
      g.imp = 1.2;
      this.glow(x, y, z, gy);
    }
  }

  /** Sparks where a round strikes: a penetration flash, a ricochet streak, or bullet dust. */
  hit(at: THREE.Vector3, normal: THREE.Vector3, kind: HitKind): void {
    const g = this.gt;
    const s = this.st;
    const n = this.v1.copy(normal);
    if (n.lengthSq() < 1e-8) n.set(0, 1, 0);
    n.normalize();
    if (kind === 'small') {
      if (n.y > 0.6) {
        // Bullet strikes on the ground: a little spurt of earth.
        for (let i = 0; i < 2; i++) {
          s.reset().colour(i ? this.biome.dust : this.biome.dirt, this.biome.dust);
          s.vx = this.rr(-0.2, 0.2);
          s.vz = this.rr(-0.2, 0.2);
          s.vy = this.rr(1, 1.9);
          s.drag = 3.2;
          s.s0 = 0.04;
          s.s1 = this.rr(0.16, 0.26);
          s.grow = 0.35;
          s.life = this.rr(0.7, 1.1);
          s.fadeOut = 0.6;
          s.alpha = 0.6;
          s.dens = 0.5;
          s.imp = 0.4;
          this.puff(at.x, at.y + 0.02, at.z);
        }
      } else this.sparks(at.x, at.y, at.z, this.cnt(4), n.x, n.y, n.z, 0.9, 1, 2.4, SPARK, 0.12, 0.3, false);
      return;
    }
    if (kind === 'pen') {
      this.bigHit(0.4);
      g.reset(GLOW).colour(FLASH, 1.1);
      g.s0 = 0.25;
      g.s1 = 0.45;
      g.life = 0.08;
      g.inten = this.night ? 2.4 : 1;
      g.fade = 2;
      g.imp = 2;
      this.glow(at.x, at.y, at.z);
      for (let i = 0; i < 2; i++) {
        g.reset(FLAME);
        g.s0 = 0.1;
        g.s1 = 0.24;
        g.life = 0.12;
        g.vx = n.x * 0.8;
        g.vy = n.y * 0.8;
        g.vz = n.z * 0.8;
        g.inten = 2;
        g.imp = 1.8;
        this.glow(at.x, at.y, at.z);
      }
      this.sparks(at.x, at.y, at.z, this.cnt(16), n.x, n.y + 0.3, n.z, 0.85, 2.5, 5.5, SPARK, 0.35, 0.9, true);
      s.reset().colour(SMOKE_BLACK, SMOKE_GREY);
      s.vx = n.x * 0.4;
      s.vy = 0.3;
      s.vz = n.z * 0.4;
      s.s0 = 0.08;
      s.s1 = 0.45;
      s.grow = 0.6;
      s.life = 1.8;
      s.drag = 2;
      s.alpha = 0.6;
      s.hot = 0.9;
      s.imp = 0.8;
      this.puff(at.x, at.y, at.z);
      this.flash(at.x + n.x * 0.2, at.y + 0.2, at.z + n.z * 0.2, 5, 26, 2.5);
      return;
    }
    // Ricochet: a shower of sparks and the round skipping away, glowing.
    this.sparks(at.x, at.y, at.z, this.cnt(8), n.x, n.y, n.z, 0.9, 1.5, 3.5, SPARK, 0.2, 0.5, false);
    g.reset(STREAK).colour(SPARK, 1.3);
    let rx = n.x + this.rr(-0.8, 0.8);
    let ry = Math.abs(n.y) + this.rr(0.3, 0.9);
    let rz = n.z + this.rr(-0.8, 0.8);
    const l = Math.sqrt(rx * rx + ry * ry + rz * rz);
    rx /= l;
    ry /= l;
    rz /= l;
    const sp = this.rr(7, 10);
    g.vx = rx * sp;
    g.vy = ry * sp;
    g.vz = rz * sp;
    g.grav = GRAVITY * 0.3;
    g.s0 = g.s1 = this.night ? 0.03 : 0.02;
    g.stretch = 0.05;
    g.lenMax = 0.5;
    g.life = this.rr(0.4, 0.7);
    g.inten = this.night ? 3.2 : 1.8;
    g.fade = 0.6;
    g.imp = 2;
    this.glow(at.x, at.y, at.z);
    g.reset(GLOW).colour(SPARK);
    g.s0 = 0.2;
    g.s1 = 0.3;
    g.life = 0.06;
    g.inten = 1.5;
    this.glow(at.x, at.y, at.z);
    this.flash(at.x, at.y, at.z, 6, 30, 2);
  }

  /** A catastrophic kill: fireball, a cook-off fountain of sparks and flame, rising black smoke. */
  catastrophic(at: THREE.Vector3): void {
    this.bigHit(1.6);
    this.flash(at.x, at.y + 0.5, at.z, 18, 6, 5);
    const g = this.gt;
    const s = this.st;
    g.reset(GLOW).colour(FLASH);
    g.s0 = 2;
    g.s1 = 2.8;
    g.life = 0.22;
    g.inten = this.night ? 1.8 : 0.55;
    g.fade = 2;
    g.imp = 2;
    this.glow(at.x, at.y + 0.3, at.z);
    for (let i = 0, n = this.cnt(10); i < n; i++) {
      g.reset(FLAME);
      const a = this.r() * Math.PI * 2;
      const sp = this.rr(0.3, 1.1);
      g.vx = Math.cos(a) * sp;
      g.vz = Math.sin(a) * sp;
      g.vy = this.rr(0.8, 2);
      g.drag = 1.6;
      g.s0 = this.rr(0.3, 0.45);
      g.s1 = this.rr(0.7, 1.05);
      g.life = this.rr(0.5, 1.05);
      g.inten = this.night ? 1.6 : 1.05;
      g.heat = this.rr(0.75, 0.9);
      g.cool = 1;
      g.rotV = 2;
      g.imp = 1.8;
      this.glow(at.x + Math.cos(a) * 0.12, at.y + this.rr(0.1, 0.4), at.z + Math.sin(a) * 0.12);
    }
    for (let i = 0, n = this.cnt(6); i < n; i++) {
      s.reset().colour(SMOKE_OILY, SMOKE_BLACK);
      s.vx = this.rr(-0.4, 0.4);
      s.vy = this.rr(0.8, 1.6);
      s.vz = this.rr(-0.4, 0.4);
      s.drag = 1;
      s.buoy = 0.1;
      s.s0 = 0.35;
      s.s1 = this.rr(1.2, 1.7) * this.cover;
      s.grow = 1.4;
      s.life = this.rr(5, 7);
      s.fadeOut = 2.5;
      s.alpha = 0.85;
      s.dens = 1;
      s.emis = 0.9;
      s.emisK = 2.5;
      s.hot = 1;
      s.imp = 1.2;
      this.puff(at.x, at.y + 0.3, at.z);
    }
    this.sparks(at.x, at.y + 0.2, at.z, this.cnt(20), 0, 1, 0, 0.9, 3, 6, SPARK, 0.6, 1.4, true);
    for (let i = 0, n = Math.round(12 * (0.5 + 0.5 * this.budget.density)); i < n; i++) {
      const a = this.r() * Math.PI * 2;
      const out = this.rr(0.5, 1.8);
      this.debris.throw(at.x, at.y + 0.2, at.z, Math.cos(a) * out, this.rr(2.5, 5), Math.sin(a) * out, this.rr(0.025, 0.055), METAL, this.rr(0.6, 1.2), this.rr(3, 5), this.r());
    }
    this.timer(T_COOKOFF, at.x, at.y, at.z, 1, 4.5);
  }

  // --- Fires, smoke and dust --------------------------------------------------------------------

  /** A burning wreck: flames, a black column leaning with the wind, a flickering light. Calling again moves it. */
  burn(id: string, at: THREE.Vector3, size: number): void {
    let b = this.burns.find((x) => x.id === id);
    if (!b) {
      b = { id, x: 0, y: 0, z: 0, size: 1, dying: -1, flame: 0, smoke: 0, ember: 0, seed: this.r() * 100 };
      this.burns.push(b);
    }
    b.x = at.x;
    b.y = at.y;
    b.z = at.z;
    b.size = Math.max(0.2, size);
    b.dying = -1;
  }

  /** The fire goes out; its smoke thins away over a few seconds. */
  stopBurn(id: string): void {
    const b = this.burns.find((x) => x.id === id);
    if (b && b.dying < 0) b.dying = 0;
  }

  /** A smoke screen over cells (one cell is one world unit, centred on x + 0.5, y + 0.5). Returns a handle. */
  smoke(cells: { x: number; y: number }[], seconds?: number): string {
    const owner = this.nextOwner++;
    if (this.nextOwner > 65000) this.nextOwner = 1;
    const handle = `smoke-${owner}`;
    const c = new Float32Array(cells.length * 2);
    cells.forEach((p, i) => {
      c[i * 2] = p.x + 0.5;
      c[i * 2 + 1] = p.y + 0.5;
    });
    const screen: Screen = { owner, handle, cells: c, acc: new Float32Array(cells.length), until: seconds !== undefined ? this.clock + seconds : Infinity, clearing: -1 };
    this.screens.push(screen);
    const per = this.screenPerCell();
    const s = this.st;
    for (let i = 0; i < cells.length; i++) {
      const cx = c[i * 2]!;
      const cz = c[i * 2 + 1]!;
      for (let k = 0; k < per; k++) this.screenPuff(screen, cx, cz, true);
      // The canisters burst: white streamers arcing out.
      if (i % 3 === 0) {
        const gy = this.heightAt(cx, cz);
        this.sparks(cx, gy + 0.3, cz, this.cnt(5), 0, 1, 0, 1, 1.5, 3, WP, 0.5, 0.9, false);
        s.reset().colour(SMOKE_WHITE);
        s.s0 = 0.2;
        s.s1 = 1;
        s.grow = 0.3;
        s.life = 1.2;
        s.alpha = 0.9;
        s.vy = 0.8;
        s.drag = 3;
        s.hot = 1;
        s.imp = 2;
        this.puff(cx, gy + 0.3, cz);
      }
    }
    return handle;
  }

  /** The screen stops and thins away over a few seconds. */
  clearSmoke(handle: string): void {
    const sc = this.screens.find((x) => x.handle === handle);
    if (!sc || sc.clearing >= 0) return;
    sc.clearing = 0;
    this.smokeSys.forOwner(sc.owner, (slot) => this.smokeSys.thin(slot, this.rr(2.5, 5.5), 1.3));
  }

  private screenPerCell(): number {
    return this.budget.density >= 1 ? 6 : this.budget.density >= 0.7 ? 4 : 3;
  }

  private screenPuff(sc: Screen, cx: number, cz: number, burst: boolean): void {
    const s = this.st;
    const gy = this.heightAt(cx, cz);
    const size = (this.budget.density >= 1 ? 1.45 : this.budget.density >= 0.7 ? 1.7 : 2.1) * this.rr(0.9, 1.15);
    const h = this.r();
    const px = cx + this.rr(-0.42, 0.42);
    const pz = cz + this.rr(-0.42, 0.42);
    s.reset().colour(SMOKE_WHITE, SMOKE_WHITE, this.rr(0.94, 1.02), this.rr(0.86, 0.95));
    if (burst) {
      s.vx = (px - cx) * 1.2;
      s.vz = (pz - cz) * 1.2;
      s.vy = this.rr(0.2, 0.6);
      s.s0 = 0.3;
      s.grow = this.rr(1, 1.8);
      s.fadeIn = 0.25;
    } else {
      s.vy = this.rr(0.02, 0.1);
      s.s0 = size * 0.65;
      s.grow = 2.5;
      s.fadeIn = 1.6;
    }
    s.s1 = size;
    s.life = this.rr(10, 16);
    s.fadeOut = 2.5;
    s.drag = 1.2;
    s.buoy = 0.004;
    s.wind = 0.18;
    s.alpha = 0.95;
    s.dens = 0.9;
    s.rotV = 0.15;
    s.hot = 0.15;
    s.imp = 4;
    s.owner = sc.owner;
    if (!this.room(s.imp)) return;
    this.smokeSys.emit(s, px, gy + 0.25 + h * h * 1.1, pz, gy, this.r(), this.r());
  }

  /** Dust thrown up behind tracks and wheels. Call every frame while moving; amount 0..1 (1 is a tank at speed). */
  dust(at: THREE.Vector3, amount: number): void {
    let p = Math.min(2, Math.max(0, amount)) * this.lastDt * 13 * this.budget.density * (1 - 0.6 * this.pressure);
    const s = this.st;
    const winter = this.biomeName === 'winter';
    while (p > 0) {
      if (p < 1 && this.r() > p) break;
      p -= 1;
      s.reset().colour(winter ? this.biome.wash : this.biome.dust, winter ? this.biome.wash : this.biome.dust, 1, 1.06);
      s.vx = this.rr(-0.15, 0.15);
      s.vz = this.rr(-0.15, 0.15);
      s.vy = this.rr(0.12, 0.35);
      s.drag = 1.6;
      s.s0 = 0.15;
      s.s1 = this.rr(0.75, 1.1) * this.cover;
      s.grow = 1;
      s.life = this.rr(1.8, 2.8);
      s.fadeIn = 0.2;
      s.fadeOut = 1.5;
      s.alpha = 0.1 + 0.24 * Math.min(1, amount);
      s.dens = 0.3;
      s.imp = 0.5;
      this.puff(at.x + this.rr(-0.08, 0.08), this.heightAt(at.x, at.z) + 0.08, at.z + this.rr(-0.08, 0.08));
    }
  }

  /** Rotor wash under a low helicopter: call every frame while hovering. Strength 0..1. */
  rotorWash(id: string, at: THREE.Vector3, strength: number, surface: Surface = 'ground'): void {
    let w = this.washes.find((x) => x.id === id);
    if (!w) {
      w = { id, x: 0, y: 0, z: 0, strength: 0, surface, last: 0, acc: 0, ring: 0 };
      this.washes.push(w);
    }
    w.x = at.x;
    w.y = at.y;
    w.z = at.z;
    w.strength = strength;
    w.surface = surface;
    w.last = this.clock;
  }

  stopRotorWash(id: string): void {
    const i = this.washes.findIndex((x) => x.id === id);
    if (i >= 0) this.washes.splice(i, 1);
  }

  /** A building comes down: a rolling cloud of dust and falling rubble. */
  collapse(at: THREE.Vector3, size: number): void {
    this.bigHit(size * 0.8);
    const gy = this.heightAt(at.x, at.z);
    const s = this.st;
    const dust = this.biomeName === 'winter' ? CONCRETE : this.biome.dust;
    for (let i = 0, n = this.cnt(10 + 8 * size); i < n; i++) {
      const a = this.r() * Math.PI * 2;
      const rad = this.rr(0.1, 0.5) * size;
      const sp = this.rr(0.6, 1.5);
      s.reset().colour(i % 3 ? dust : CONCRETE, dust, this.rr(0.85, 1), 1.05);
      s.vx = Math.cos(a) * sp;
      s.vz = Math.sin(a) * sp;
      s.vy = this.rr(0.2, 0.8);
      s.drag = 1;
      s.buoy = 0.02;
      s.s0 = size * 0.4;
      s.s1 = size * this.rr(1.2, 1.9) * this.cover;
      s.grow = 1.8;
      s.life = this.rr(7, 11);
      s.fadeIn = 0.2;
      s.fadeOut = 3.5;
      s.alpha = 0.85;
      s.dens = 0.9;
      s.wind = 0.7;
      s.imp = 1.3;
      this.puff(at.x + Math.cos(a) * rad, gy + this.rr(0.1, 0.6) * size, at.z + Math.sin(a) * rad);
    }
    for (let i = 0, n = Math.round((16 + 10 * size) * (0.5 + 0.5 * this.budget.density)); i < n; i++) {
      const a = this.r() * Math.PI * 2;
      const rad = this.rr(0, 0.45) * size;
      const out = this.rr(0.2, 1);
      this.debris.throw(at.x + Math.cos(a) * rad, gy + this.rr(0.2, 1) * size * 0.8, at.z + Math.sin(a) * rad, Math.cos(a) * out, this.rr(0, 0.6), Math.sin(a) * out, this.rr(0.035, 0.09), CONCRETE, this.rr(0.6, 1.15), this.rr(4, 7), this.r());
    }
    this.timer(T_COLLAPSE, at.x, gy, at.z, size, 1.4);
  }

  // --- Frame ------------------------------------------------------------------------------------

  /** Step every effect and upload the instances. Call once a frame, after placing the camera. */
  update(dt: number, camera: THREE.Camera): void {
    dt = Math.min(0.1, Math.max(0, dt));
    this.clock += dt;
    this.lastDt = dt > 0 ? dt : this.lastDt;
    this.frame++;
    const e = camera.matrixWorld.elements;
    const ctx = this.ctx;
    ctx.dt = dt;
    ctx.frame = this.frame;
    ctx.windX = this.windX;
    ctx.windZ = this.windZ;
    ctx.camX = e[12]!;
    ctx.camY = e[13]!;
    ctx.camZ = e[14]!;
    ctx.fwdX = -e[8]!;
    ctx.fwdY = -e[9]!;
    ctx.fwdZ = -e[10]!;
    const fill = (this.smokeSys.live + this.glowSys.live) / this.budget.particles;
    this.pressure = Math.min(1, Math.max(0, (fill - 0.55) / 0.4));

    for (let i = this.delayed - 1; i >= 0; i--) {
      const t = this.dT[i]! - dt;
      this.dT[i] = t;
      if (t > 0) continue;
      const x = this.dX[i]!;
      const y = this.dY[i]!;
      const z = this.dZ[i]!;
      const s = this.dS[i]!;
      const k = this.dK[i]!;
      const last = --this.delayed;
      this.dT[i] = this.dT[last]!;
      this.dX[i] = this.dX[last]!;
      this.dY[i] = this.dY[last]!;
      this.dZ[i] = this.dZ[last]!;
      this.dS[i] = this.dS[last]!;
      this.dK[i] = this.dK[last]!;
      this.blast(x, y, z, s, k);
    }

    this.debris.begin();
    for (let i = this.burns.length - 1; i >= 0; i--) if (!this.stepBurn(this.burns[i]!, dt)) this.burns.splice(i, 1);
    for (let i = this.screens.length - 1; i >= 0; i--) if (!this.stepScreen(this.screens[i]!, dt)) this.screens.splice(i, 1);
    for (let i = this.washes.length - 1; i >= 0; i--) if (!this.stepWash(this.washes[i]!, dt)) this.washes.splice(i, 1);
    for (const t of this.timed) if (t.active) this.stepTimed(t, dt);
    for (const p of this.projectiles) if (p.active) this.stepProjectile(p, dt);

    this.smokeSys.update(ctx);
    this.glowSys.update(ctx);
    this.fxMesh.draw(this.smokeSys, this.glowSys);
    this.debris.update(dt, this.heightAt);
    this.stepLights();
  }

  private flicker(seed: number): number {
    const t = this.clock;
    return 0.72 + 0.14 * Math.sin(t * 13.1 + seed) + 0.09 * Math.sin(t * 23.7 + seed * 2.3) + 0.05 * Math.sin(t * 41.3 + seed * 0.7);
  }

  private stepBurn(b: Burn, dt: number): boolean {
    let k = 1;
    if (b.dying >= 0) {
      b.dying += dt;
      if (b.dying > 6) return false;
      k = Math.max(0, 1 - b.dying / 4);
    }
    const size = b.size;
    const g = this.gt;
    const s = this.st;
    const flick = this.flicker(b.seed);
    const fire = b.dying < 0 ? 1 : Math.max(0, 1 - b.dying / 1.5);
    const lod = 1 - 0.55 * this.pressure;
    b.flame += dt * this.cnt(16) * size * fire * (1 - 0.35 * this.pressure);
    while (b.flame >= 1) {
      b.flame -= 1;
      g.reset(FLAME);
      const a = this.r() * Math.PI * 2;
      const rad = Math.sqrt(this.r()) * 0.2 * size;
      g.vx = this.windX * 0.4;
      g.vz = this.windZ * 0.4;
      g.vy = this.rr(0.35, 0.7) * Math.sqrt(size);
      g.s0 = this.rr(0.14, 0.24) * size;
      g.s1 = this.rr(0.26, 0.42) * size;
      g.life = this.rr(0.45, 0.85);
      g.inten = this.night ? 2 : 1.5;
      g.heat = 0.95;
      g.cool = 0.9;
      g.rotV = 1.5;
      g.transient = false;
      g.imp = 1.6;
      this.glow(b.x + Math.cos(a) * rad, b.y + 0.04, b.z + Math.sin(a) * rad);
    }
    // A buoyant plume: it keeps rising at about 0.4 a second, widening slowly and leaning downwind.
    b.smoke += dt * this.cnt(6.5) * size * k * lod;
    while (b.smoke >= 1) {
      b.smoke -= 1;
      s.reset().colour(SMOKE_OILY, SMOKE_GREY, 1, 0.75);
      s.vx = this.rr(-0.05, 0.05);
      s.vz = this.rr(-0.05, 0.05);
      s.vy = this.rr(0.55, 0.8) * Math.sqrt(size);
      s.buoy = 0.07;
      s.drag = 0.17;
      s.s0 = 0.2 * size;
      s.s1 = this.rr(1.1, 1.6) * size * this.cover * (1 + 0.45 * this.pressure);
      s.grow = 3.2;
      s.life = this.rr(7, 10);
      s.fadeIn = 0.5;
      s.fadeOut = 3;
      s.alpha = 0.82;
      s.dens = 1;
      s.emis = fire * 1.1;
      s.emisK = 1.3;
      s.hot = 0.7;
      s.rotV = 0.3;
      s.imp = 1.2;
      this.puff(b.x + this.rr(-0.08, 0.08) * size, b.y + 0.15 * size, b.z + this.rr(-0.08, 0.08) * size);
    }
    b.ember += dt * this.cnt(3) * size * fire * (1 - 0.7 * this.pressure);
    while (b.ember >= 1) {
      b.ember -= 1;
      g.reset(STREAK).colour(EMBER);
      g.vx = this.rr(-0.3, 0.3) + this.windX * 0.6;
      g.vz = this.rr(-0.3, 0.3) + this.windZ * 0.6;
      g.vy = this.rr(1, 2);
      g.drag = 0.6;
      g.grav = -0.1;
      g.s0 = g.s1 = 0.009;
      g.stretch = 0.03;
      g.lenMax = 0.06;
      g.life = this.rr(1.2, 2.4);
      g.inten = this.night ? 2.4 : 1.4;
      g.fade = 1;
      g.transient = false;
      g.imp = 0.6;
      this.glow(b.x + this.rr(-0.1, 0.1) * size, b.y + 0.15, b.z + this.rr(-0.1, 0.1) * size);
    }
    if (fire > 0) {
      // Light thrown on the ground around the fire (all there is on Low, where there are no lights).
      const life = this.lastDt * 1.5 + 1e-4;
      const extra = this.lights.length === 0 ? 1.5 : 1;
      g.reset(GROUND).colour(FIRE_GLOW);
      g.s0 = g.s1 = 1.6 * size;
      g.life = life;
      g.fade = 0;
      g.inten = (this.night ? 0.55 : 0.12) * flick * fire * extra;
      g.transient = false;
      g.imp = 1.5;
      this.glow(b.x, this.heightAt(b.x, b.z) + 0.03, b.z);
      if (this.night) {
        g.reset(GLOW).colour(FIRE_GLOW);
        g.s0 = g.s1 = 1.3 * size;
        g.life = life;
        g.fade = 0;
        g.inten = 0.28 * flick * fire * extra;
        g.transient = false;
        g.imp = 1.4;
        this.glow(b.x, b.y + 0.25 * size, b.z);
      }
    }
    return true;
  }

  private stepScreen(sc: Screen, dt: number): boolean {
    if (sc.clearing >= 0) {
      sc.clearing += dt;
      return sc.clearing < 7;
    }
    if (this.clock >= sc.until) {
      this.clearSmoke(sc.handle);
      return true;
    }
    // Keep the screen full: replace sprites as they age out, each fading in over the last.
    const rate = this.screenPerCell() / 12;
    const n = sc.acc.length;
    for (let i = 0; i < n; i++) {
      let a = sc.acc[i]! + dt * rate;
      while (a >= 1) {
        a -= 1;
        this.screenPuff(sc, sc.cells[i * 2]!, sc.cells[i * 2 + 1]!, false);
      }
      sc.acc[i] = a;
    }
    return true;
  }

  private stepWash(w: Wash, dt: number): boolean {
    if (this.clock - w.last > 0.3) return false;
    const gy = this.heightAt(w.x, w.z);
    const h = w.y - gy;
    const k = Math.min(1, Math.max(0, w.strength)) * Math.min(1, Math.max(0, 1 - h / 2.8));
    if (k <= 0.02) return true;
    const water = w.surface === 'water';
    const snow = !water && this.biomeName === 'winter';
    const sand = !water && this.biomeName === 'desert';
    const c = water ? SPRAY : this.biome.wash;
    const s = this.st;
    // The downwash hits the ground and races out: low puffs rolling outward, rising at the rim,
    // over a sheet of flat dust that reads as a disc from above.
    w.acc += dt * this.cnt(50) * k * (1 - 0.5 * this.pressure);
    while (w.acc >= 1) {
      w.acc -= 1;
      const a = this.r() * Math.PI * 2;
      const sheet = this.r() < 0.35;
      const r0 = 0.25 + h * 0.1 + this.r() * 0.2;
      const sp = this.rr(1.6, 3) * (0.5 + 0.5 * k) * (water ? 1.25 : 1);
      s.reset().colour(c, c, 1, water ? 1 : 1.05);
      s.vx = Math.cos(a) * sp;
      s.vz = Math.sin(a) * sp;
      s.drag = 2.1;
      s.fadeIn = 0.08;
      s.dens = 0.45;
      s.wind = 0.4;
      s.imp = 0.7;
      const base = snow ? 0.62 : sand ? 0.58 : water ? 0.5 : 0.5;
      if (sheet) {
        s.flat = true;
        s.s0 = 0.5;
        s.s1 = this.rr(1.1, 1.5) * this.cover;
        s.grow = 0.5;
        s.life = this.rr(0.9, 1.3);
        s.fadeOut = 0.8;
        s.alpha = base * 0.75 * (0.4 + 0.6 * k);
        this.puff(w.x + Math.cos(a) * r0, gy + 0.03, w.z + Math.sin(a) * r0);
      } else {
        s.vy = this.rr(0.04, water ? 0.45 : 0.22);
        s.buoy = 0.12;
        s.s0 = water ? 0.12 : 0.2;
        s.s1 = this.rr(0.8, 1.15) * (water ? 0.8 : 1) * this.cover;
        s.grow = 0.6;
        s.life = water ? this.rr(0.8, 1.3) : this.rr(1.4, 2.1);
        s.fadeOut = 1;
        s.alpha = base * (0.45 + 0.55 * k);
        this.puff(w.x + Math.cos(a) * r0, gy + 0.06, w.z + Math.sin(a) * r0);
      }
    }
    // A faint flat ring of disturbed ground or water, read from above.
    w.ring += dt * 3;
    if (w.ring >= 1) {
      w.ring -= 1;
      s.reset().colour(c, c, water ? 1.05 : 0.95);
      s.flat = true;
      s.ring = water ? 0.3 : 0.4;
      s.s0 = s.s1 = (1.2 + 0.6 * k) * (1 - h * 0.15);
      s.life = water ? 0.9 : 1.1;
      s.fadeIn = 0.05;
      s.fadeOut = 0.7;
      s.alpha = (water ? 0.35 : 0.25) * k;
      s.dens = 0.2;
      s.wind = 0;
      s.imp = 0.5;
      this.puff(w.x, gy + 0.02, w.z);
    }
    return true;
  }

  private stepTimed(t: Timed, dt: number): void {
    t.t += dt;
    if (t.t >= t.dur) {
      t.active = false;
      return;
    }
    const left = 1 - t.t / t.dur;
    const g = this.gt;
    const s = this.st;
    if (t.kind === T_COOKOFF) {
      // Ammunition cooking off: a jet of flame from the hatches, a fountain of sparks, pops.
      t.a += dt * this.cnt(26) * Math.sqrt(left);
      while (t.a >= 1) {
        t.a -= 1;
        g.reset(FLAME);
        g.vx = this.rr(-0.15, 0.15);
        g.vz = this.rr(-0.15, 0.15);
        g.vy = this.rr(2.2, 3.2) * (0.5 + 0.5 * left);
        g.drag = 1.5;
        g.s0 = this.rr(0.12, 0.2);
        g.s1 = this.rr(0.3, 0.45);
        g.life = this.rr(0.3, 0.55);
        g.inten = this.night ? 2.4 : 1.8;
        g.cool = 0.9;
        g.rotV = 2;
        g.imp = 1.7;
        this.glow(t.x + this.rr(-0.05, 0.05), t.y + 0.25, t.z + this.rr(-0.05, 0.05));
      }
      t.b += dt * this.cnt(36) * left * (1 - 0.5 * this.pressure);
      while (t.b >= 1) {
        t.b -= 1;
        this.sparks(t.x, t.y + 0.3, t.z, 1, 0, 1, 0, 0.45, 3, 6, SPARK, 0.8, 1.6, true);
      }
      t.c += dt * this.cnt(9);
      while (t.c >= 1) {
        t.c -= 1;
        s.reset().colour(SMOKE_OILY, SMOKE_BLACK);
        s.vx = this.rr(-0.1, 0.1);
        s.vz = this.rr(-0.1, 0.1);
        s.vy = this.rr(0.9, 1.3);
        s.buoy = 0.12;
        s.drag = 0.6;
        s.s0 = 0.25;
        s.s1 = this.rr(1.3, 1.8) * this.cover;
        s.grow = 1.8;
        s.life = this.rr(6, 8);
        s.fadeOut = 3;
        s.alpha = 0.85;
        s.dens = 1;
        s.emis = 0.8;
        s.emisK = 2;
        s.hot = 0.9;
        s.imp = 1.2;
        this.puff(t.x, t.y + 0.35, t.z);
      }
      t.pop -= dt;
      if (t.pop <= 0) {
        t.pop = this.rr(0.25, 0.7);
        g.reset(GLOW).colour(FLASH);
        g.s0 = 0.8;
        g.s1 = 1.2;
        g.life = 0.08;
        g.inten = this.night ? 2 : 1.2;
        g.fade = 2;
        g.imp = 1.5;
        this.glow(t.x, t.y + 0.35, t.z);
        this.sparks(t.x, t.y + 0.3, t.z, this.cnt(8), 0, 1, 0, 1, 2.5, 5, SPARK, 0.5, 1.1, true);
        this.flash(t.x, t.y + 0.5, t.z, 12, 18, 4);
      }
    } else if (t.kind === T_COLLAPSE) {
      t.a += dt * this.cnt(14) * t.size * left;
      while (t.a >= 1) {
        t.a -= 1;
        const a = this.r() * Math.PI * 2;
        const sp = this.rr(1, 2);
        const dust = this.biomeName === 'winter' ? CONCRETE : this.biome.dust;
        s.reset().colour(dust, dust, 1, 1.05);
        s.vx = Math.cos(a) * sp;
        s.vz = Math.sin(a) * sp;
        s.vy = this.rr(0.05, 0.3);
        s.drag = 1.1;
        s.s0 = 0.3 * t.size;
        s.s1 = this.rr(0.9, 1.4) * t.size * this.cover;
        s.grow = 1.5;
        s.life = this.rr(5, 8);
        s.fadeOut = 3;
        s.alpha = 0.7;
        s.dens = 0.8;
        s.imp = 1;
        this.puff(t.x + Math.cos(a) * 0.4 * t.size, t.y + 0.1, t.z + Math.sin(a) * 0.4 * t.size);
      }
    }
  }

  private stepProjectile(p: Projectile, dt: number): void {
    p.t += dt;
    const k = Math.min(1, p.t / p.dur);
    const u = p.accel > 0 ? (k + p.accel * k * k) / (1 + p.accel) : k;
    p.prev.copy(p.pos);
    if (p.type === P_SHELL) {
      p.pos.lerpVectors(p.p0, p.p3, u);
      p.pos.y += 4 * p.p1.y * u * (1 - u);
    } else if (p.type === P_MISSILE) {
      bezier(p.pos, p.p0, p.p1, p.p2, p.p3, u);
      if (p.missile === 'atgm' && !p.top) {
        // Beam riders weave a little as they are steered onto the line.
        const wob = Math.sin(p.t * 17 + p.seed) * 0.03 * (1 - u);
        p.pos.y += wob;
      }
    } else {
      if (u < p.split) bezier(p.pos, p.p0, p.p1, p.p2, p.p3, u / p.split);
      else {
        const v = (u - p.split) / (1 - p.split);
        bezier(p.pos, p.p3, p.d1, p.d2, p.d3, v * v * (1.6 - 0.6 * v));
      }
      if (p.drone === 'fpv' && u < p.split) {
        p.pos.x += Math.sin(p.t * 9 + p.seed) * 0.05;
        p.pos.y += Math.sin(p.t * 13 + p.seed * 2) * 0.03;
      }
    }
    const dir = this.v1.subVectors(p.pos, p.prev);
    const step = dir.length();
    if (step > 1e-6) dir.multiplyScalar(1 / step);
    else dir.set(0, 0, 1);

    if (p.type === P_MISSILE) this.missileFrame(p, dir, step);
    else if (p.type === P_SHELL) {
      this.q.setFromUnitVectors(this.fwd, dir);
      this.debris.body(p.pos, this.q, 0.022, 0.022, 0.075, BODY[0], BODY[1], BODY[2]);
      if (this.budget.density >= 0.7) {
        p.trail += step;
        while (p.trail >= p.spacing) {
          p.trail -= p.spacing;
          const s = this.st;
          s.reset().colour(TRAIL, TRAIL, 0.9);
          s.s0 = 0.03;
          s.s1 = 0.22;
          s.grow = 0.8;
          s.life = 1.6;
          s.fadeIn = 0.05;
          s.fadeOut = 1.2;
          s.alpha = 0.16;
          s.dens = 0.2;
          s.wind = 0.6;
          s.imp = 0.3;
          this.puff(p.pos.x - dir.x * p.trail, p.pos.y - dir.y * p.trail, p.pos.z - dir.z * p.trail);
        }
      }
    } else if (p.model) {
      const m = p.model;
      m.position.copy(p.pos);
      this.v2.copy(p.pos).add(dir);
      this.m4.lookAt(this.v2, p.pos, this.up);
      m.quaternion.setFromRotationMatrix(this.m4);
    } else {
      this.q.setFromUnitVectors(this.fwd, dir);
      const span = p.drone === 'fpv' ? 0.09 : 0.13;
      this.debris.body(p.pos, this.q, span, 0.025, p.drone === 'fpv' ? 0.08 : 0.11, BODY[0], BODY[1], BODY[2]);
    }
    if (p.type === P_DRONE && this.thermal) {
      // Motors and batteries run hot: a small white dot in thermal.
      const g = this.gt;
      g.reset(GLOW).colour(FLASH);
      g.s0 = g.s1 = 0.12;
      g.life = this.lastDt * 1.5 + 1e-4;
      g.fade = 0;
      g.inten = 0.8;
      g.imp = 1.5;
      this.glow(p.pos.x, p.pos.y, p.pos.z);
    }
    if (k >= 1) {
      p.active = false;
      if (p.model) p.model.visible = false;
    }
  }

  private missileFrame(p: Projectile, dir: THREE.Vector3, step: number): void {
    const kind = p.missile;
    const k = p.t / p.dur;
    const len = kind === 'manpads' || kind === 'hellfire' ? 0.16 : kind === 'rocket' ? 0.1 : 0.12;
    this.q.setFromUnitVectors(this.fwd, dir);
    this.debris.body(p.pos, this.q, 0.02, 0.02, len * 1.3, BODY[0] * 1.3, BODY[1] * 1.4, BODY[2]);
    // A Javelin coasts out of its tube before the flight motor lights.
    const lit = !(p.top && k < 0.06);
    if (lit) {
      const g = this.gt;
      const tx = p.pos.x - dir.x * len * 0.7;
      const ty = p.pos.y - dir.y * len * 0.7;
      const tz = p.pos.z - dir.z * len * 0.7;
      const life = this.lastDt * 1.5 + 1e-4;
      g.reset(FLAME);
      g.s0 = g.s1 = this.rr(0.08, 0.13);
      g.life = life;
      g.fade = 0;
      g.cool = 0;
      g.inten = this.night ? 2.6 : 2;
      g.imp = 2.5;
      this.glow(tx, ty, tz);
      g.reset(GLOW).colour(FIRE_GLOW, 1.2);
      g.s0 = g.s1 = this.night ? 0.6 : 0.3;
      g.life = life;
      g.fade = 0;
      g.inten = this.night ? 0.9 : 0.6;
      g.imp = 2.4;
      this.glow(tx, ty, tz);
      p.trail += step;
      const s = this.st;
      const thick = kind === 'manpads' || kind === 'rocket';
      while (p.trail >= p.spacing) {
        p.trail -= p.spacing;
        s.reset().colour(TRAIL, TRAIL, 1, 0.92);
        s.vx = this.rr(-0.04, 0.04);
        s.vy = this.rr(-0.02, 0.05);
        s.vz = this.rr(-0.04, 0.04);
        s.s0 = Math.max(0.1, p.spacing * 1.1);
        s.s1 = Math.max(s.s0 * 1.6, (thick ? this.rr(0.42, 0.55) : this.rr(0.3, 0.38)) * this.cover);
        s.grow = 0.9;
        s.life = kind === 'manpads' ? this.rr(4, 5.5) : this.rr(2.6, 3.8);
        s.fadeIn = 0.04;
        s.fadeOut = 2;
        s.alpha = thick ? 0.55 : 0.42;
        s.dens = 0.35;
        s.drag = 1;
        s.wind = 0.6;
        s.emis = 0.8;
        s.emisK = 10;
        s.hot = 0.6;
        s.imp = 0.9;
        this.puff(tx - dir.x * p.trail, ty - dir.y * p.trail, tz - dir.z * p.trail);
      }
    }
  }

  private stepLights(): void {
    const n = this.lights.length;
    if (n === 0) return;
    let c = 0;
    for (let i = 0; i < MAX_FLASHES && c < MAX_CANDIDATES; i++) {
      const it = this.fI[i]! * Math.exp(-(this.clock - this.fT[i]!) * this.fK[i]!);
      if (it < 0.4) continue;
      this.cX[c] = this.fX[i]!;
      this.cY[c] = this.fY[i]!;
      this.cZ[c] = this.fZ[i]!;
      this.cI[c] = it;
      this.cD[c] = this.fR[i]!;
      this.cFire[c] = 0;
      c++;
    }
    for (const b of this.burns) {
      if (c >= MAX_CANDIDATES || b.dying > 1.5) continue;
      this.cX[c] = b.x;
      this.cY[c] = b.y + 0.35 * b.size;
      this.cZ[c] = b.z;
      this.cI[c] = (this.night ? 6 : 2) * b.size * this.flicker(b.seed) * (b.dying < 0 ? 1 : 1 - b.dying / 1.5);
      this.cD[c] = 3.5 * b.size + 1;
      this.cFire[c] = 1;
      c++;
    }
    for (const t of this.timed) {
      if (!t.active || t.kind !== T_COOKOFF || c >= MAX_CANDIDATES) continue;
      this.cX[c] = t.x;
      this.cY[c] = t.y + 0.6;
      this.cZ[c] = t.z;
      this.cI[c] = 7 * this.flicker(t.x * 3.1);
      this.cD[c] = 5;
      this.cFire[c] = 1;
      c++;
    }
    const cam = this.ctx;
    for (let i = 0; i < c; i++) {
      const dx = this.cX[i]! - cam.camX;
      const dy = this.cY[i]! - cam.camY;
      const dz = this.cZ[i]! - cam.camZ;
      this.cS[i] = this.cI[i]! / (1 + (dx * dx + dy * dy + dz * dz) / 100);
    }
    for (let li = 0; li < n; li++) {
      let best = -1;
      let bs = 0;
      for (let i = 0; i < c; i++) {
        if (this.cS[i]! > bs) {
          bs = this.cS[i]!;
          best = i;
        }
      }
      const light = this.lights[li]!;
      if (best < 0) {
        light.intensity = 0;
        continue;
      }
      this.cS[best] = 0;
      light.position.set(this.cX[best]!, this.cY[best]!, this.cZ[best]!);
      light.intensity = this.cI[best]!;
      light.distance = this.cD[best]!;
      const col = this.cFire[best] ? FIRE_LIGHT : FLASH_LIGHT;
      light.color.setRGB(col[0], col[1], col[2]);
    }
  }

  /** Remove every effect at once (a new battle, or the preview's reset). Burns and screens stop too. */
  clear(): void {
    this.smokeSys.clear();
    this.glowSys.clear();
    this.fxMesh.clear();
    this.debris.clear();
    this.burns.length = 0;
    this.screens.length = 0;
    this.washes.length = 0;
    for (const t of this.timed) t.active = false;
    for (const p of this.projectiles) {
      if (p.active && p.model) p.model.visible = false;
      p.active = false;
    }
    this.delayed = 0;
    this.fI.fill(0);
    for (const l of this.lights) l.intensity = 0;
  }

  dispose(): void {
    this.scene.remove(this.fxMesh.mesh, this.debris.mesh);
    this.fxMesh.dispose();
    this.debris.dispose();
    this.atlas.dispose();
    this.setLightCount(0);
    this.burns.length = 0;
    this.screens.length = 0;
    this.washes.length = 0;
  }
}

import * as THREE from 'three';
import { FX_FRAG, FX_VERT } from './shaders';

// Two particle pools (lit smoke, and fire and light) drawn together in one instanced draw call,
// sorted back to front with premultiplied alpha: smoke blends over what is behind it, fire adds
// light (and can hold back a little of what is behind), so smoke in front of a fire hides it and a
// fireball sits inside its own dust. State lives in flat typed arrays indexed by slot; slots come
// from a free list and the live list is rebuilt each frame, so nothing is allocated while it plays.

const STRIDE = 16;

/** What the pools need to know about the frame. */
export interface FrameCtx {
  dt: number;
  frame: number;
  windX: number;
  windZ: number;
  camX: number;
  camY: number;
  camZ: number;
  /** Camera forward (into the screen), for sorting and culling. */
  fwdX: number;
  fwdY: number;
  fwdZ: number;
  heightAt: (x: number, z: number) => number;
}

abstract class Pool {
  readonly cap: number;
  readonly alive: Uint8Array;
  private readonly free: Int32Array;
  private freeN: number;
  protected order: Int32Array;
  protected readonly orderPos: Int32Array;
  protected n = 0;
  live = 0;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly z: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly vz: Float32Array;
  readonly age: Float32Array;
  readonly life: Float32Array;
  /** Base importance: how much a sprite is worth keeping when the budget is full. */
  readonly imp: Float32Array;
  /** On screen last frame (1), or behind the camera (0.2). */
  readonly vis: Float32Array;
  readonly gy: Float32Array;
  /** Distance along the view axis this frame, for the sort. */
  readonly depth: Float32Array;

  constructor(cap: number) {
    this.cap = cap;
    this.alive = new Uint8Array(cap);
    this.free = new Int32Array(cap);
    for (let i = 0; i < cap; i++) this.free[i] = cap - 1 - i;
    this.freeN = cap;
    this.order = new Int32Array(cap * 2);
    this.orderPos = new Int32Array(cap);
    const f = () => new Float32Array(cap);
    this.x = f();
    this.y = f();
    this.z = f();
    this.vx = f();
    this.vy = f();
    this.vz = f();
    this.age = f();
    this.life = f();
    this.imp = f();
    this.vis = f();
    this.gy = f();
    this.depth = f();
  }

  /** A fresh slot, or -1 when the pool is full. The caller fills it in. */
  protected take(): number {
    if (this.freeN === 0) return -1;
    const s = this.free[--this.freeN]!;
    if (this.n >= this.order.length) this.compact();
    this.alive[s] = 1;
    this.order[this.n] = s;
    this.orderPos[s] = this.n++;
    this.live++;
    this.age[s] = 0;
    this.vis[s] = 1;
    return s;
  }

  kill(s: number): void {
    if (!this.alive[s]) return;
    this.alive[s] = 0;
    this.free[this.freeN++] = s;
    this.live--;
  }

  /** A random live slot (for eviction sampling), or -1. */
  sample(r: number): number {
    if (this.n === 0) return -1;
    const i = Math.min(this.n - 1, Math.floor(r * this.n));
    const s = this.order[i]!;
    return this.alive[s] && this.orderPos[s] === i ? s : -1;
  }

  /** Worth of keeping a slot: importance, time left, and whether it is on screen. */
  score(s: number): number {
    const left = 1 - this.age[s]! / Math.max(1e-3, this.life[s]!);
    return this.imp[s]! * (0.25 + 0.75 * left) * this.vis[s]!;
  }

  private compact(): void {
    let w = 0;
    for (let i = 0; i < this.n; i++) {
      const s = this.order[i]!;
      if (!this.alive[s] || this.orderPos[s] !== i) continue;
      this.order[w] = s;
      this.orderPos[s] = w++;
    }
    this.n = w;
  }

  /** Walk the live list: drop dead and reused entries, step the rest. */
  update(ctx: FrameCtx): void {
    let w = 0;
    for (let i = 0; i < this.n; i++) {
      const s = this.order[i]!;
      if (!this.alive[s] || this.orderPos[s] !== i) continue;
      const a = this.age[s]! + ctx.dt;
      this.age[s] = a;
      if (a >= this.life[s]!) {
        this.kill(s);
        continue;
      }
      if ((s + ctx.frame) % 4 === 0) this.gy[s] = ctx.heightAt(this.x[s]!, this.z[s]!);
      this.integrate(s, ctx);
      this.order[w] = s;
      this.orderPos[s] = w++;
    }
    this.n = w;
  }

  /** Live slots after `update`, in no particular order. */
  slot(i: number): number {
    return this.order[i]!;
  }

  get count(): number {
    return this.n;
  }

  protected abstract integrate(s: number, ctx: FrameCtx): void;

  /** Pack a slot's instance data at `p` in the shared buffer. */
  abstract write(out: Float32Array, p: number, s: number): void;

  clear(): void {
    for (let i = 0; i < this.n; i++) this.kill(this.order[i]!);
    this.n = 0;
  }
}

/** Template for a smoke sprite: set the fields, then emit. */
export class SmokeTpl {
  s0 = 0.2;
  s1 = 1;
  /** Seconds to reach most of the final size (billowing slows as it grows). */
  grow = 1;
  life = 3;
  vx = 0;
  vy = 0;
  vz = 0;
  drag = 1;
  buoy = 0;
  /** How strongly the wind carries it (more with height). */
  wind = 1;
  alpha = 0.6;
  fadeIn = 0.15;
  fadeOut = 1;
  r0 = 0.5;
  g0 = 0.5;
  b0 = 0.5;
  r1 = 0.5;
  g1 = 0.5;
  b1 = 0.5;
  /** Self-shadowing: 1 for a dense column, lower for thin haze. */
  dens = 0.8;
  /** Fire glow on its belly, decaying at emisK a second. */
  emis = 0;
  emisK = 2;
  /** Thermal brightness, fading over its life. */
  hot = 0;
  imp = 1;
  flat = false;
  /** A flat ring expanding with this time constant (seconds), or 0. */
  ring = 0;
  owner = 0;
  rotV = 0;

  reset(): this {
    this.s0 = 0.2;
    this.s1 = 1;
    this.grow = 1;
    this.life = 3;
    this.vx = this.vy = this.vz = 0;
    this.drag = 1;
    this.buoy = 0;
    this.wind = 1;
    this.alpha = 0.6;
    this.fadeIn = 0.15;
    this.fadeOut = 1;
    this.dens = 0.8;
    this.emis = 0;
    this.emisK = 2;
    this.hot = 0;
    this.imp = 1;
    this.flat = false;
    this.ring = 0;
    this.owner = 0;
    this.rotV = 0;
    return this;
  }

  /** Colour from start to end of life (linear RGB), each scaled by k. */
  colour(c0: readonly number[], c1: readonly number[] = c0, k0 = 1, k1 = k0): this {
    this.r0 = c0[0]! * k0;
    this.g0 = c0[1]! * k0;
    this.b0 = c0[2]! * k0;
    this.r1 = c1[0]! * k1;
    this.g1 = c1[1]! * k1;
    this.b1 = c1[2]! * k1;
    return this;
  }
}

export class SmokeSystem extends Pool {
  private readonly s0: Float32Array;
  private readonly s1: Float32Array;
  private readonly grow: Float32Array;
  private readonly fadeIn: Float32Array;
  private readonly fadeOut: Float32Array;
  private readonly rot: Float32Array;
  private readonly rotV: Float32Array;
  private readonly alpha: Float32Array;
  private readonly c0: Float32Array;
  private readonly c1: Float32Array;
  private readonly emis: Float32Array;
  private readonly emisK: Float32Array;
  private readonly drag: Float32Array;
  private readonly buoy: Float32Array;
  private readonly wind: Float32Array;
  private readonly dens: Float32Array;
  private readonly hot: Float32Array;
  private readonly ring: Float32Array;
  private readonly frame: Uint8Array;
  private readonly flat: Uint8Array;
  readonly owner: Uint16Array;
  // This frame's values, packed by `write`.
  private readonly size: Float32Array;
  private readonly a: Float32Array;

  constructor(cap: number) {
    super(cap);
    const f = () => new Float32Array(cap);
    this.s0 = f();
    this.s1 = f();
    this.grow = f();
    this.fadeIn = f();
    this.fadeOut = f();
    this.rot = f();
    this.rotV = f();
    this.alpha = f();
    this.c0 = new Float32Array(cap * 3);
    this.c1 = new Float32Array(cap * 3);
    this.emis = f();
    this.emisK = f();
    this.drag = f();
    this.buoy = f();
    this.wind = f();
    this.dens = f();
    this.hot = f();
    this.ring = f();
    this.frame = new Uint8Array(cap);
    this.flat = new Uint8Array(cap);
    this.owner = new Uint16Array(cap);
    this.size = f();
    this.a = f();
  }

  /** Emit one sprite from the template at a point; returns its slot or -1. */
  emit(t: SmokeTpl, x: number, y: number, z: number, gy: number, r1: number, r2: number): number {
    const s = this.take();
    if (s < 0) return s;
    this.x[s] = x;
    this.y[s] = y;
    this.z[s] = z;
    this.vx[s] = t.vx;
    this.vy[s] = t.vy;
    this.vz[s] = t.vz;
    this.life[s] = t.life;
    this.imp[s] = t.imp;
    this.gy[s] = gy;
    this.s0[s] = t.s0;
    this.s1[s] = t.s1;
    this.grow[s] = Math.max(0.05, t.grow);
    this.fadeIn[s] = Math.max(0.01, t.fadeIn);
    this.fadeOut[s] = Math.max(0.01, t.fadeOut);
    this.rot[s] = r1 * Math.PI * 2;
    this.rotV[s] = t.rotV * (r2 - 0.5) * 2;
    this.alpha[s] = t.alpha;
    const c = s * 3;
    this.c0[c] = t.r0;
    this.c0[c + 1] = t.g0;
    this.c0[c + 2] = t.b0;
    this.c1[c] = t.r1;
    this.c1[c + 1] = t.g1;
    this.c1[c + 2] = t.b1;
    this.emis[s] = t.emis;
    this.emisK[s] = t.emisK;
    this.drag[s] = t.drag;
    this.buoy[s] = t.buoy;
    this.wind[s] = t.wind;
    this.dens[s] = t.dens;
    this.hot[s] = t.hot;
    this.ring[s] = t.ring;
    this.frame[s] = Math.floor(r2 * 4) & 3;
    this.flat[s] = t.flat ? 1 : 0;
    this.owner[s] = t.owner;
    this.size[s] = t.s0;
    this.a[s] = 0;
    return s;
  }

  /** Thin a sprite away over the next `seconds` (smoke screens clearing). */
  thin(s: number, seconds: number, grow: number): void {
    const left = this.life[s]! - this.age[s]!;
    if (left > seconds) this.life[s] = this.age[s]! + seconds;
    this.fadeOut[s] = Math.max(0.01, Math.min(seconds, this.life[s]! - this.age[s]!));
    this.s1[s] = this.s1[s]! * grow;
    this.wind[s] = Math.max(this.wind[s]!, 0.7);
    this.vy[s] = this.vy[s]! + 0.05;
  }

  /** Slots owned by an emitter (for clearing a screen). */
  forOwner(owner: number, fn: (s: number) => void): void {
    for (let i = 0; i < this.n; i++) {
      const s = this.order[i]!;
      if (this.alive[s] && this.orderPos[s] === i && this.owner[s] === owner) fn(s);
    }
  }

  protected integrate(s: number, ctx: FrameCtx): void {
    const dt = ctx.dt;
    const age = this.age[s]!;
    const kd = Math.exp(-this.drag[s]! * dt);
    const gy = this.gy[s]!;
    let y = this.y[s]!;
    // Wind shear: the higher it rises, the more the wind carries it (columns lean).
    const w = this.wind[s]! * (0.35 + Math.min(1, Math.max(0, y - gy) * 0.5));
    const wx = ctx.windX * w;
    const wz = ctx.windZ * w;
    const vx = wx + (this.vx[s]! - wx) * kd;
    const vz = wz + (this.vz[s]! - wz) * kd;
    let vy = this.vy[s]! * kd + this.buoy[s]! * dt;
    const x = this.x[s]! + vx * dt;
    const z = this.z[s]! + vz * dt;
    y += vy * dt;
    const grow = 1 - Math.exp(-age / this.grow[s]!);
    const size = this.s0[s]! + (this.s1[s]! - this.s0[s]!) * grow;
    const floor = gy + size * 0.12;
    if (y < floor) {
      y = floor;
      if (vy < 0) vy = 0;
    }
    this.x[s] = x;
    this.y[s] = y;
    this.z[s] = z;
    this.vx[s] = vx;
    this.vy[s] = vy;
    this.vz[s] = vz;
    this.rot[s] = this.rot[s]! + this.rotV[s]! * dt;
    this.size[s] = size;
    const left = this.life[s]! - age;
    // Fade out on a curve: a clearing screen visibly thins early and lingers as haze.
    const out = Math.min(1, left / this.fadeOut[s]!);
    this.a[s] = this.alpha[s]! * Math.min(1, age / this.fadeIn[s]!) * out * out;
    const d = (x - ctx.camX) * ctx.fwdX + (y - ctx.camY) * ctx.fwdY + (z - ctx.camZ) * ctx.fwdZ;
    this.depth[s] = d;
    this.vis[s] = d > -size ? 1 : 0.2;
  }

  write(out: Float32Array, p: number, s: number): void {
    const age = this.age[s]!;
    const k = age / this.life[s]!;
    const c = s * 3;
    out[p] = this.x[s]!;
    out[p + 1] = this.y[s]!;
    out[p + 2] = this.z[s]!;
    out[p + 3] = this.size[s]!;
    out[p + 4] = this.rot[s]!;
    out[p + 5] = this.a[s]!;
    out[p + 6] = this.flat[s]!;
    out[p + 7] = this.gy[s]!;
    out[p + 8] = this.c0[c]! + (this.c1[c]! - this.c0[c]!) * k;
    out[p + 9] = this.c0[c + 1]! + (this.c1[c + 1]! - this.c0[c + 1]!) * k;
    out[p + 10] = this.c0[c + 2]! + (this.c1[c + 2]! - this.c0[c + 2]!) * k;
    out[p + 11] = this.emis[s]! * Math.exp(-age * this.emisK[s]!);
    out[p + 12] = this.dens[s]!;
    out[p + 13] = this.hot[s]! * (1 - k);
    out[p + 14] = this.ring[s]! > 0 ? 0.2 + 0.78 * (1 - Math.exp(-age / this.ring[s]!)) : 0;
    out[p + 15] = this.frame[s]!;
  }
}

/** Template for a fire or light sprite: flame, glow, streak or ground glow. */
export class GlowTpl {
  static readonly FLAME = 0;
  static readonly GLOW = 1;
  static readonly STREAK = 2;
  static readonly GROUND = 3;
  shape = 1;
  s0 = 0.2;
  s1 = 0.2;
  life = 0.2;
  vx = 0;
  vy = 0;
  vz = 0;
  grav = 0;
  drag = 0;
  inten = 1;
  /** Intensity falls as (1 - age/life) to this power. */
  fade = 1;
  r = 1;
  g = 0.6;
  b = 0.3;
  /** Flames: starting heat (1 white hot) and how much of it is lost over the life. */
  heat = 1;
  cool = 1;
  /** How much of what is behind it a flame holds back (0 is pure light). */
  occ = 0;
  /** Streaks: tail length per unit of speed, capped at lenMax; with no speed, a fixed axis. */
  stretch = 0;
  lenMax = 0.3;
  ax = 0;
  ay = 1;
  az = 0;
  bounce = false;
  rotV = 0;
  imp = 1;
  /** Counts toward `busy` (a burning wreck's flames do not). */
  transient = true;

  reset(shape: number): this {
    this.shape = shape;
    this.s0 = this.s1 = 0.2;
    this.life = 0.2;
    this.vx = this.vy = this.vz = 0;
    this.grav = 0;
    this.drag = 0;
    this.inten = 1;
    this.fade = 1;
    this.r = 1;
    this.g = 0.6;
    this.b = 0.3;
    this.heat = 1;
    this.cool = 1;
    this.occ = shape === GlowTpl.FLAME ? 0.35 : 0;
    this.stretch = 0;
    this.lenMax = 0.3;
    this.ax = 0;
    this.ay = 1;
    this.az = 0;
    this.bounce = false;
    this.rotV = 0;
    this.imp = 1;
    this.transient = true;
    return this;
  }

  colour(c: readonly number[], k = 1): this {
    this.r = c[0]! * k;
    this.g = c[1]! * k;
    this.b = c[2]! * k;
    return this;
  }
}

export class GlowSystem extends Pool {
  private readonly shape: Uint8Array;
  private readonly s0: Float32Array;
  private readonly s1: Float32Array;
  private readonly grav: Float32Array;
  private readonly drag: Float32Array;
  private readonly inten: Float32Array;
  private readonly fade: Float32Array;
  private readonly col: Float32Array;
  private readonly heat: Float32Array;
  private readonly cool: Float32Array;
  private readonly occ: Float32Array;
  private readonly stretch: Float32Array;
  private readonly lenMax: Float32Array;
  private readonly axis: Float32Array;
  private readonly bounce: Uint8Array;
  private readonly rot: Float32Array;
  private readonly rotV: Float32Array;
  private readonly frame: Uint8Array;
  private readonly transient: Uint8Array;
  /** Live sprites that count toward `busy`. */
  busyCount = 0;

  constructor(cap: number) {
    super(cap);
    const f = () => new Float32Array(cap);
    this.shape = new Uint8Array(cap);
    this.s0 = f();
    this.s1 = f();
    this.grav = f();
    this.drag = f();
    this.inten = f();
    this.fade = f();
    this.col = new Float32Array(cap * 3);
    this.heat = f();
    this.cool = f();
    this.occ = f();
    this.stretch = f();
    this.lenMax = f();
    this.axis = new Float32Array(cap * 3);
    this.bounce = new Uint8Array(cap);
    this.rot = f();
    this.rotV = f();
    this.frame = new Uint8Array(cap);
    this.transient = new Uint8Array(cap);
  }

  emit(t: GlowTpl, x: number, y: number, z: number, gy: number, r1: number, r2: number): number {
    const s = this.take();
    if (s < 0) return s;
    this.x[s] = x;
    this.y[s] = y;
    this.z[s] = z;
    this.vx[s] = t.vx;
    this.vy[s] = t.vy;
    this.vz[s] = t.vz;
    this.life[s] = Math.max(0.005, t.life);
    this.imp[s] = t.imp;
    this.gy[s] = gy;
    this.shape[s] = t.shape;
    this.s0[s] = t.s0;
    this.s1[s] = t.s1;
    this.grav[s] = t.grav;
    this.drag[s] = t.drag;
    this.inten[s] = t.inten;
    this.fade[s] = t.fade;
    const c = s * 3;
    this.col[c] = t.r;
    this.col[c + 1] = t.g;
    this.col[c + 2] = t.b;
    this.heat[s] = t.heat;
    this.cool[s] = t.cool;
    this.occ[s] = t.occ;
    this.stretch[s] = t.stretch;
    this.lenMax[s] = t.lenMax;
    this.axis[c] = t.ax;
    this.axis[c + 1] = t.ay;
    this.axis[c + 2] = t.az;
    this.bounce[s] = t.bounce ? 1 : 0;
    this.rot[s] = r1 * Math.PI * 2;
    this.rotV[s] = t.rotV * (r2 - 0.5) * 2;
    this.frame[s] = Math.floor(r2 * 4) & 3;
    this.transient[s] = t.transient ? 1 : 0;
    this.depth[s] = 0;
    return s;
  }

  override update(ctx: FrameCtx): void {
    this.busyCount = 0;
    super.update(ctx);
  }

  protected integrate(s: number, ctx: FrameCtx): void {
    const dt = ctx.dt;
    let vx = this.vx[s]!;
    let vy = this.vy[s]!;
    let vz = this.vz[s]!;
    const drag = this.drag[s]!;
    if (drag > 0) {
      const kd = Math.exp(-drag * dt);
      vx *= kd;
      vy *= kd;
      vz *= kd;
    }
    vy -= this.grav[s]! * dt;
    const x = this.x[s]! + vx * dt;
    let y = this.y[s]! + vy * dt;
    const z = this.z[s]! + vz * dt;
    if (this.bounce[s] && y < this.gy[s]! && vy < 0) {
      // Sparks skip off the ground once or twice and die out.
      y = this.gy[s]!;
      vy = -vy * 0.32;
      vx *= 0.55;
      vz *= 0.55;
    }
    this.x[s] = x;
    this.y[s] = y;
    this.z[s] = z;
    this.vx[s] = vx;
    this.vy[s] = vy;
    this.vz[s] = vz;
    this.rot[s] = this.rot[s]! + this.rotV[s]! * dt;
    const d = (x - ctx.camX) * ctx.fwdX + (y - ctx.camY) * ctx.fwdY + (z - ctx.camZ) * ctx.fwdZ;
    this.depth[s] = d;
    this.vis[s] = d > -1 ? 1 : 0.2;
    if (this.transient[s]) this.busyCount++;
  }

  write(out: Float32Array, p: number, s: number): void {
    const age = this.age[s]!;
    const life = this.life[s]!;
    const k = age / life;
    const c = s * 3;
    const shape = this.shape[s]!;
    const e = 1 - (1 - k) * (1 - k);
    out[p] = this.x[s]!;
    out[p + 1] = this.y[s]!;
    out[p + 2] = this.z[s]!;
    out[p + 3] = this.s0[s]! + (this.s1[s]! - this.s0[s]!) * e;
    if (shape === GlowTpl.STREAK) {
      const vx = this.vx[s]!;
      const vy = this.vy[s]!;
      const vz = this.vz[s]!;
      const sp = Math.sqrt(vx * vx + vy * vy + vz * vz);
      if (sp > 1e-3 && this.stretch[s]! > 0) {
        const len = Math.min(this.lenMax[s]!, sp * this.stretch[s]!) / sp;
        out[p + 4] = vx * len;
        out[p + 5] = vy * len;
        out[p + 6] = vz * len;
      } else {
        const len = this.lenMax[s]!;
        out[p + 4] = this.axis[c]! * len;
        out[p + 5] = this.axis[c + 1]! * len;
        out[p + 6] = this.axis[c + 2]! * len;
      }
    } else {
      out[p + 4] = 0;
      out[p + 5] = 0;
      out[p + 6] = 0;
    }
    // Flames flare up in their first few hundredths of a second, then fade.
    const rise = shape === GlowTpl.FLAME && life > 0.1 ? Math.min(1, age * 30) : 1;
    const fade = Math.pow(1 - k, this.fade[s]!) * rise;
    out[p + 7] = this.occ[s]! * fade;
    out[p + 8] = this.col[c]!;
    out[p + 9] = this.col[c + 1]!;
    out[p + 10] = this.col[c + 2]!;
    out[p + 11] = this.inten[s]! * fade;
    out[p + 12] = this.rot[s]!;
    out[p + 13] = Math.max(0, this.heat[s]! * (1 - k * this.cool[s]!));
    out[p + 14] = shape;
    // Frames 8..11 mark a fire sprite for the shader.
    out[p + 15] = 8 + this.frame[s]!;
  }
}

/** The one mesh that draws both pools, sorted back to front. */
export class FxMesh {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  private readonly data: Float32Array;
  private readonly keys: Float64Array;
  private readonly buffer: THREE.InstancedInterleavedBuffer;
  private readonly geo: THREE.InstancedBufferGeometry;
  private readonly range = { start: 0, count: 0 };
  private readonly cap: number;
  private lastN = 0;

  constructor(cap: number, map: THREE.Texture) {
    this.cap = cap;
    this.material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog]),
      vertexShader: FX_VERT,
      fragmentShader: FX_FRAG,
      transparent: true,
      depthWrite: false,
      premultipliedAlpha: true,
      blending: THREE.NormalBlending,
      fog: true,
    });
    Object.assign(this.material.uniforms, {
      uMap: { value: map },
      uSunDir: { value: new THREE.Vector3(-0.52, 0.82, 0.33).normalize() },
      uSunCol: { value: new THREE.Color(1.45, 1.36, 1.22) },
      uSky: { value: new THREE.Color(0.42, 0.46, 0.52) },
      uGround: { value: new THREE.Color(0.2, 0.18, 0.15) },
      uFire: { value: new THREE.Color(0.55, 0.22, 0.07) },
      uThermal: { value: 0 },
    });
    this.data = new Float32Array(cap * STRIDE);
    this.keys = new Float64Array(cap).fill(Infinity);
    this.buffer = new THREE.InstancedInterleavedBuffer(this.data, STRIDE, 1);
    this.buffer.setUsage(THREE.DynamicDrawUsage);
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.setAttribute('iA', new THREE.InterleavedBufferAttribute(this.buffer, 4, 0));
    g.setAttribute('iB', new THREE.InterleavedBufferAttribute(this.buffer, 4, 4));
    g.setAttribute('iC', new THREE.InterleavedBufferAttribute(this.buffer, 4, 8));
    g.setAttribute('iD', new THREE.InterleavedBufferAttribute(this.buffer, 4, 12));
    g.instanceCount = 0;
    this.geo = g;
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 10;
  }

  /** Sort both pools far to near and upload. */
  draw(a: Pool, b: Pool): void {
    const keys = this.keys;
    const na = a.count;
    const n = Math.min(this.cap, na + b.count);
    // Key: depth in tenths of a millimetre, negated (far first), with the entry index in the low bits.
    for (let i = 0; i < n; i++) {
      const s = i < na ? a.slot(i) : b.slot(i - na);
      const d = (i < na ? a : b).depth[s]!;
      keys[i] = Math.round(Math.min(5e5, Math.max(-5e5, -d * 1e3)) + 5e5) * 2048 + i;
    }
    // Unused keys sort last; sorting the whole (small) array avoids making a view every frame.
    if (this.lastN > n) keys.fill(Infinity, n, this.lastN);
    this.lastN = n;
    keys.sort();
    for (let k = 0; k < n; k++) {
      const i = keys[k]! % 2048;
      if (i < na) a.write(this.data, k * STRIDE, a.slot(i));
      else b.write(this.data, k * STRIDE, b.slot(i - na));
    }
    this.geo.instanceCount = n;
    this.mesh.visible = n > 0;
    if (n === 0) return;
    this.range.count = n * STRIDE;
    // One range object, reused; if the last frame was never drawn it is still queued.
    if (this.buffer.updateRanges.length === 0) this.buffer.updateRanges.push(this.range);
    this.buffer.needsUpdate = true;
  }

  clear(): void {
    this.geo.instanceCount = 0;
    this.mesh.visible = false;
  }

  dispose(): void {
    this.geo.dispose();
    this.material.dispose();
  }
}

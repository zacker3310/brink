import { Container, Graphics, Sprite, Texture, type Application } from 'pixi.js';
import type { HexKey, NationView, TurnReport } from '@brink/contracts';
import { neighborKeys, type Point } from '@brink/map';
import { getArt } from '../art';

// The map, alive: fog clouds over unexplored land, cloud shadows drifting across the theatre, glints
// on the water, and fighting wherever your forces face an enemy at war. Tracers, muzzle flashes and
// shell bursts across each front line; smoke and fire where last turn's battles were. All of it is
// decoration drawn from the view: it never changes the game, and it stops when motion is reduced.

let soft: Texture | null = null;

/** A white disc fading to nothing: clouds, smoke, glow and flashes are all this, tinted. */
function softTexture(): Texture {
  if (soft) return soft;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  soft = Texture.from(c);
  return soft;
}

interface Fx {
  obj: Container;
  t: number;
  life: number;
  step: (fx: Fx, dt: number) => void;
}

interface Front {
  from: Point;
  to: Point;
  /** Seconds to the next shot from each side. */
  next: [number, number];
  /** The ember glow on the contested edge. */
  glow: Sprite;
  phase: number;
}

export interface LifeContext {
  center: (key: HexKey) => Point;
  size: number;
}

export class MapLife {
  private readonly root = new Container();
  private readonly fogLayer = new Container();
  private readonly shadowLayer = new Container();
  private readonly glintLayer = new Container();
  private readonly fireLayer = new Container();
  private readonly fxLayer = new Container();
  private fx: Fx[] = [];
  private fronts: Front[] = [];
  private fires: { p: Point; next: number }[] = [];
  private glints: { s: Sprite; phase: number; speed: number }[] = [];
  private fogs: { s: Sprite; x: number; y: number; phase: number }[] = [];
  private shadows: { s: Sprite; vx: number }[] = [];
  private bounds = { x: 0, y: 0, w: 1, h: 1 };
  private clock = 0;
  private readonly still = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  private readonly tick = () => this.step(Math.min(0.05, this.app.ticker.deltaMS / 1000));

  constructor(
    private readonly app: Application,
    parent: Container,
    private readonly ctx: LifeContext,
  ) {
    this.root.addChild(this.shadowLayer, this.glintLayer, this.fireLayer, this.fxLayer, this.fogLayer);
    this.root.eventMode = 'none';
    parent.addChild(this.root);
    app.ticker.add(this.tick);
  }

  destroy(): void {
    this.app.ticker.remove(this.tick);
    this.root.destroy({ children: true });
  }

  /** Rebuild what is alive from the latest view: fog, water, fronts and fires. */
  update(v: NationView, report: TurnReport | null, active: boolean): void {
    const { center, size } = this.ctx;
    const keys = Object.keys(v.tiles).sort();
    const pts = keys.map(center);
    const minX = Math.min(...pts.map((p) => p.x));
    const minY = Math.min(...pts.map((p) => p.y));
    this.bounds = { x: minX - size, y: minY - size, w: Math.max(...pts.map((p) => p.x)) - minX + size * 2, h: Math.max(...pts.map((p) => p.y)) - minY + size * 2 };
    const tex = softTexture();

    // Fog: banks of cloud over every hex nobody has seen, gently heaving.
    this.fogLayer.removeChildren().forEach((c) => c.destroy());
    this.fogs = [];
    for (const k of keys) {
      if (v.tiles[k]!.visibility !== 'unknown') continue;
      const p = center(k);
      const s = new Sprite(tex);
      s.anchor.set(0.5);
      s.tint = 0x26313a;
      s.alpha = 0.95;
      s.scale.set((size * 3.2) / 128);
      s.position.set(p.x, p.y);
      this.fogLayer.addChild(s);
      this.fogs.push({ s, x: p.x, y: p.y, phase: hash(k) * Math.PI * 2 });
    }

    // Cloud shadows: a few, made once, drifting west to east forever.
    if (this.shadows.length === 0) {
      for (let i = 0; i < 6; i++) {
        const s = new Sprite(tex);
        s.anchor.set(0.5);
        s.tint = 0x0a1418;
        s.alpha = 0.16;
        s.scale.set((size * (6 + i)) / 128, (size * (3.5 + (i % 3))) / 128);
        s.position.set(this.bounds.x + (i / 6) * this.bounds.w, this.bounds.y + ((i * 37) % 100) / 100 * this.bounds.h);
        this.shadowLayer.addChild(s);
        this.shadows.push({ s, vx: 4 + (i % 3) * 2 });
      }
    }

    // Glints on open water and rivers.
    this.glintLayer.removeChildren().forEach((c) => c.destroy());
    this.glints = [];
    for (const k of keys) {
      const t = v.tiles[k]!;
      if (t.visibility === 'unknown' || !(t.terrain === 'water' || t.river)) continue;
      const p = center(k);
      for (let i = 0; i < (t.terrain === 'water' ? 3 : 1); i++) {
        const s = new Sprite(tex);
        s.anchor.set(0.5);
        s.tint = 0xe8fbff;
        s.blendMode = 'add';
        const h = hash(`${k}${i}`);
        s.position.set(p.x + (h - 0.5) * size, p.y + (hash(`${i}${k}`) - 0.5) * size * 0.8);
        s.scale.set(3 / 128, 1.4 / 128);
        this.glintLayer.addChild(s);
        this.glints.push({ s, phase: h * 10, speed: 0.6 + h });
      }
    }

    // Fronts: every place one of your stacks stands next to an enemy at war. Each side fires, and
    // the contested edge glows like a fire line.
    this.fireLayer.removeChildren().forEach((c) => c.destroy());
    this.fronts = [];
    if (active) {
      const enemyAt = new Set(Object.values(v.contacts).filter((c) => c.confirmed && v.relations[c.owner] === 'war').map((c) => c.key));
      const ownAt = new Set(Object.values(v.formations).map((f) => f.key));
      for (const k of [...ownAt].sort()) {
        for (const n of neighborKeys(k)) {
          if (!enemyAt.has(n)) continue;
          this.addFront(center(k), center(n), hash(k + n));
          if (this.fronts.length >= 16) break;
        }
        if (this.fronts.length >= 16) break;
      }
    }

    // Last turn's battles and strikes smoulder where they happened.
    this.fires = [];
    if (active && report) {
      const seen = new Set<HexKey>();
      for (const e of report.events) {
        const at = e.kind === 'engagement' ? e.location : e.kind === 'strike' ? e.target : null;
        if (!at || seen.has(at) || v.tiles[at]?.visibility === 'unknown') continue;
        seen.add(at);
        this.addFire(center(at), hash(at));
      }
    }
  }

  /** A front between two hex centres: both sides fire, the edge between them glows. */
  addFront(from: Point, to: Point, seed: number): void {
    const glow = new Sprite(softTexture());
    glow.anchor.set(0.5);
    glow.tint = 0xff5a2c;
    glow.blendMode = 'add';
    glow.position.set((from.x + to.x) / 2, (from.y + to.y) / 2);
    glow.scale.set((this.ctx.size * 1.3) / 128, (this.ctx.size * 0.9) / 128);
    glow.rotation = Math.atan2(to.y - from.y, to.x - from.x) + Math.PI / 2;
    this.fireLayer.addChild(glow);
    this.fronts.push({ from, to, next: [seed * 1.2, ((seed * 7) % 1) * 1.2 + 0.3], glow, phase: seed * 6 });
  }

  /** A burning battlefield: a glow on the ground and smoke rising from it. */
  addFire(p: Point, seed: number): void {
    const { size } = this.ctx;
    const glow = new Sprite(softTexture());
    glow.anchor.set(0.5);
    glow.tint = 0xff7a2a;
    glow.blendMode = 'add';
    glow.alpha = 0.5;
    glow.scale.set((size * 0.9) / 128);
    glow.position.set(p.x + size * 0.25, p.y + size * 0.3);
    this.fireLayer.addChild(glow);
    this.fires.push({ p: { x: p.x + size * 0.25, y: p.y + size * 0.3 }, next: seed });
  }

  private add(obj: Container, life: number, step: Fx['step']): void {
    this.fxLayer.addChild(obj);
    this.fx.push({ obj, t: 0, life, step });
  }

  /** A shot along a front: muzzle flash, a tracer, and a burst where it lands. */
  private shoot(from: Point, to: Point): void {
    const { size } = this.ctx;
    const tex = softTexture();
    const jx = (Math.random() - 0.5) * size * 0.5;
    const jy = (Math.random() - 0.5) * size * 0.4;
    const a = { x: from.x + jx * 0.6, y: from.y + jy * 0.6 };
    const b = { x: to.x + jx, y: to.y + jy };
    const flash = new Sprite(tex);
    flash.anchor.set(0.5);
    flash.tint = 0xffe08a;
    flash.blendMode = 'add';
    flash.position.set(a.x, a.y);
    this.add(flash, 0.12, (f) => flash.scale.set(((size * 0.5) / 128) * (1 + f.t * 6)));
    const heavy = Math.random() < 0.45;
    const tracer = new Graphics();
    this.add(tracer, 0.22, (f) => {
      const p = Math.min(1, f.t / 0.18);
      const head = { x: a.x + (b.x - a.x) * p, y: a.y + (b.y - a.y) * p };
      const tail = { x: a.x + (b.x - a.x) * Math.max(0, p - 0.35), y: a.y + (b.y - a.y) * Math.max(0, p - 0.35) };
      tracer.clear().moveTo(tail.x, tail.y).lineTo(head.x, head.y).stroke({ width: heavy ? 2.2 : 1.3, color: heavy ? 0xffb347 : 0xfff1b0, alpha: 1 - f.t / 0.22 });
    });
    const art = getArt();
    const land = 180;
    const boom = (frames: Texture[] | undefined) => {
      const s = new Sprite(frames?.[0] ?? tex);
      s.anchor.set(0.5);
      if (!frames) {
        s.tint = 0xff9a3c;
        s.blendMode = 'add';
      }
      s.position.set(b.x, b.y);
      s.visible = false;
      const scale = (heavy ? size * 1.25 : size * 0.6) / (frames?.[0]?.width ?? 128);
      this.add(s, 0.75, (f) => {
        const t = f.t - land / 1000;
        s.visible = t > 0;
        if (t <= 0) return;
        const p = t / (f.life - land / 1000);
        if (frames) s.texture = frames[Math.min(frames.length - 1, Math.floor(p * frames.length))]!;
        s.scale.set(scale * (0.6 + p));
        s.alpha = 1 - p * 0.7;
      });
    };
    boom(art?.explosion);
    if (heavy) {
      const smoke = new Sprite(art?.smoke[Math.floor(Math.random() * (art?.smoke.length ?? 1))] ?? tex);
      smoke.anchor.set(0.5);
      if (!art) smoke.tint = 0x3a3a3a;
      smoke.position.set(b.x, b.y);
      smoke.alpha = 0;
      const base = (size * 0.9) / smoke.texture.width;
      this.add(smoke, 2.2, (f, dt) => {
        smoke.y -= dt * 5;
        smoke.alpha = Math.max(0, 0.5 * (1 - f.t / f.life)) * Math.min(1, f.t * 4);
        smoke.scale.set(base * (0.5 + f.t / f.life));
      });
    }
  }

  private puff(p: Point): void {
    const { size } = this.ctx;
    const art = getArt();
    const s = new Sprite(art?.smoke[Math.floor(Math.random() * (art?.smoke.length ?? 1))] ?? softTexture());
    s.anchor.set(0.5);
    if (!art) s.tint = 0x2e2e2e;
    s.position.set(p.x + (Math.random() - 0.5) * 3, p.y);
    const base = (size * 0.55) / s.texture.width;
    this.add(s, 3.2, (f, dt) => {
      s.y -= dt * 7;
      s.x += dt * 2.5;
      s.alpha = 0.55 * (1 - f.t / f.life);
      s.scale.set(base * (0.6 + (f.t / f.life) * 1.8));
    });
  }

  private step(dt: number): void {
    this.clock += dt;
    const t = this.clock;
    for (const f of this.fogs) {
      f.s.position.set(f.x + Math.sin(t * 0.25 + f.phase) * 3, f.y + Math.cos(t * 0.2 + f.phase) * 2);
      f.s.alpha = 0.88 + Math.sin(t * 0.4 + f.phase) * 0.07;
    }
    if (this.still) return;
    for (const s of this.shadows) {
      s.s.x += s.vx * dt;
      if (s.s.x - s.s.width / 2 > this.bounds.x + this.bounds.w) s.s.x = this.bounds.x - s.s.width / 2;
    }
    for (const gl of this.glints) gl.s.alpha = Math.max(0, Math.sin(t * gl.speed * 2 + gl.phase)) ** 6 * 0.9;
    for (const fr of this.fronts) {
      fr.glow.alpha = 0.35 + Math.sin(t * 3 + fr.phase) * 0.15 + Math.random() * 0.08;
      for (const side of [0, 1] as const) {
        fr.next[side] -= dt;
        if (fr.next[side] > 0) continue;
        fr.next[side] = 0.25 + Math.random() * 0.9;
        if (side === 0) this.shoot(fr.from, fr.to);
        else this.shoot(fr.to, fr.from);
      }
    }
    for (const fire of this.fires) {
      fire.next -= dt;
      if (fire.next > 0) continue;
      fire.next = 0.45 + Math.random() * 0.4;
      this.puff(fire.p);
    }
    for (const f of this.fx) {
      f.t += dt;
      f.step(f, dt);
    }
    const done = this.fx.filter((f) => f.t >= f.life);
    if (done.length) {
      this.fx = this.fx.filter((f) => f.t < f.life);
      for (const f of done) f.obj.destroy();
    }
  }
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

import { Graphics, Text, type Application, type Container } from 'pixi.js';
import { create } from 'zustand';
import type { HexKey, UnitClass } from '@brink/contracts';
import type { Point } from '@brink/map';
import { addUnit, affiliationOf, slotOffsets, type CounterLook, type UnitModel } from './counters';
import type { Affiliation } from './design/symbols';
import { AFFILIATION, FONT_DISPLAY } from './design/tokens';
import type { Playback } from './store';

// Replays a resolved turn on the map: everything moves at once, then strikes and battles, then
// retreats, losses and captures. Built from the turn's events and the views either side of it,
// so it shows exactly what the player was entitled to see and nothing more.

type Phase = Playback['phase'];

/** Transport controls for the replay, read by the player every frame. */
export const useReplay = create<{
  paused: boolean;
  speed: number;
  /** Seek target in timeline ms, consumed by the player. */
  seek: number | null;
  /** Phase start times and total length of the replay being played. */
  marks: Record<Phase, number> & { end: number };
  /** 0..1, updated a few times a second. */
  progress: number;
}>(() => ({ paused: false, speed: 1, seek: null, marks: { movement: 0, combat: 0, aftermath: 0, end: 1 }, progress: 0 }));

interface Actor {
  id: string;
  cls: UnitClass;
  color: number;
  /** Fill as #rrggbb, and affiliation, for the APP-6 symbol. */
  fill: string;
  aff: Affiliation;
  own: boolean;
  confirmed: boolean;
  /** Strength before and after the turn, 0..1000 (estimates for enemies). */
  s0: number;
  s1: number;
  /** Start hex followed by every hex entered during movement. */
  route: HexKey[];
  /** Assault target this actor lunges at during combat. */
  lunge: HexKey | null;
  retreat: [HexKey, HexKey] | null;
  destroyed: boolean;
  /** Not on the board before the turn: fades in as it is first seen. */
  appears: boolean;
  /** Formation slot at its resting hex, and how many share it. */
  slot: number;
  slots: number;
}

interface Battle {
  at: HexKey;
  ours: number;
  theirs: number;
  delay: number;
}

interface Strike {
  from: HexKey | null;
  to: HexKey;
  color: number;
  delay: number;
}

export interface Timeline {
  actors: Actor[];
  battles: Battle[];
  strikes: Strike[];
  captures: { at: HexKey; color: number }[];
  /** Phase boundaries in ms. */
  move: [number, number];
  combat: [number, number];
  after: [number, number];
  end: number;
}

const hex = (c: string | undefined) => Number.parseInt((c ?? '#888888').replace('#', ''), 16);

export function buildTimeline(pb: Playback): Timeline {
  const before = pb.before;
  const after = pb.result.view;
  const me = before.self.id;
  const actors = new Map<string, Actor>();
  const colorOf = (owner: string) => hex(before.nations[owner]?.color);

  for (const f of Object.values(before.formations)) {
    actors.set(f.id, {
      id: f.id,
      cls: f.unitClass,
      color: hex(before.self.color),
      fill: before.self.color,
      aff: 'friend',
      own: true,
      confirmed: true,
      s0: f.strength,
      s1: after.formations[f.id]?.strength ?? f.strength,
      route: [f.key],
      lunge: null,
      retreat: null,
      destroyed: false,
      appears: false,
      slot: 0,
      slots: 1,
    });
  }
  for (const c of Object.values(before.contacts)) {
    actors.set(c.formation, {
      id: c.formation,
      cls: c.unitClass,
      color: colorOf(c.owner),
      fill: before.nations[c.owner]?.color ?? '#888888',
      aff: affiliationOf(false, before.relations[c.owner]),
      own: false,
      confirmed: c.confirmed,
      s0: c.estimatedStrength,
      s1: after.contacts[c.formation]?.estimatedStrength ?? c.estimatedStrength,
      route: [c.key],
      lunge: null,
      retreat: null,
      destroyed: false,
      appears: false,
      slot: 0,
      slots: 1,
    });
  }

  // One battle marker per hex: strikes and assaults on the same ground add up.
  const byHex = new Map<HexKey, Battle>();
  const hit = (at: HexKey, ours: number, theirs: number, delay: number) => {
    const b = byHex.get(at);
    if (b) {
      b.ours += ours;
      b.theirs += theirs;
      b.delay = Math.min(b.delay, delay);
    } else byHex.set(at, { at, ours, theirs, delay });
  };
  const strikes: Strike[] = [];
  const captures: { at: HexKey; color: number }[] = [];
  let hasMove = false;
  let hasAfter = false;

  for (const e of pb.events) {
    switch (e.kind) {
      case 'movement': {
        if (e.path.length === 0) break;
        hasMove = true;
        const a = actors.get(e.formation);
        if (a) {
          a.route = [a.route[0]!, ...e.path];
          a.confirmed = true;
        } else {
          // First seen this turn: it enters from the edge of what we could see.
          const c = after.contacts[e.formation];
          actors.set(e.formation, {
            id: e.formation,
            cls: e.unitClass,
            color: colorOf(e.owner),
            fill: before.nations[e.owner]?.color ?? '#888888',
            aff: affiliationOf(e.owner === me, before.relations[e.owner]),
            own: e.owner === me,
            confirmed: true,
            s0: c?.estimatedStrength ?? 1000,
            s1: c?.estimatedStrength ?? 1000,
            route: [...e.path],
            lunge: null,
            retreat: null,
            destroyed: false,
            appears: true,
            slot: 0,
            slots: 1,
          });
        }
        break;
      }
      case 'engagement': {
        let ours = 0;
        let theirs = 0;
        for (const p of e.participants) {
          if (p.owner === me) ours += p.strengthLoss;
          else theirs += p.strengthLoss;
          const a = actors.get(p.formation);
          if (a && p.role === 'attacker' && p.from !== e.location) a.lunge = e.location;
        }
        hit(e.location, ours, theirs, byHex.size * 140);
        break;
      }
      case 'strike': {
        const src = actors.get(e.source);
        strikes.push({ from: src ? src.route.at(-1)! : null, to: e.target, color: colorOf(e.owner), delay: strikes.length * 120 });
        let ours = 0;
        let theirs = 0;
        for (const v of e.victims) {
          if (v.owner === me) ours += v.strengthLoss;
          else theirs += v.strengthLoss;
        }
        hit(e.target, ours, theirs, 380 + strikes.length * 120);
        break;
      }
      case 'retreat': {
        const a = actors.get(e.formation);
        if (a) a.retreat = [e.from, e.to];
        hasAfter = true;
        break;
      }
      case 'destroyed': {
        const a = actors.get(e.formation);
        if (a) a.destroyed = true;
        hasAfter = true;
        break;
      }
      case 'site_captured':
        captures.push({ at: e.key, color: colorOf(e.to) });
        hasAfter = true;
        break;
    }
  }

  const battles = [...byHex.values()];
  // Stack slots at each actor's resting hex, in a stable order.
  const rest = new Map<HexKey, number>();
  for (const a of [...actors.values()].sort((x, y) => (x.id < y.id ? -1 : 1))) {
    const k = a.retreat?.[1] ?? a.route.at(-1)!;
    a.slot = rest.get(k) ?? 0;
    rest.set(k, a.slot + 1);
  }
  for (const a of actors.values()) a.slots = rest.get(a.retreat?.[1] ?? a.route.at(-1)!) ?? 1;

  const hasCombat = battles.length > 0 || strikes.length > 0;
  const moveDur = hasMove ? 1300 : 0;
  const combatDur = hasCombat ? 900 + Math.min(600, (battles.length + strikes.length) * 90) : 0;
  const afterDur = hasAfter ? 750 : 0;
  const move: [number, number] = [0, moveDur];
  const combat: [number, number] = [moveDur, moveDur + combatDur];
  const aft: [number, number] = [combat[1], combat[1] + afterDur];
  return { actors: [...actors.values()], battles, strikes, captures, move, combat, after: aft, end: aft[1] + 250 };
}

const clamp = (x: number) => Math.max(0, Math.min(1, x));
const ease = (x: number) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);
const span = (t: number, [a, b]: [number, number]) => (b > a ? clamp((t - a) / (b - a)) : t >= b ? 1 : 0);
const lerp = (a: Point, b: Point, p: number): Point => ({ x: a.x + (b.x - a.x) * p, y: a.y + (b.y - a.y) * p });

function along(route: Point[], p: number): Point {
  if (route.length === 1) return route[0]!;
  const f = p * (route.length - 1);
  const i = Math.min(route.length - 2, Math.floor(f));
  return lerp(route[i]!, route[i + 1]!, f - i);
}

export function phaseAt(tl: Timeline, t: number): Phase {
  if (t < tl.move[1]) return 'movement';
  if (t < tl.combat[1]) return 'combat';
  return 'aftermath';
}

interface PlayOptions {
  center: (k: HexKey) => Point;
  size: number;
  onPhase: (p: Phase) => void;
  onDone: () => void;
}

/** Play a timeline on `layer`. Returns a stop function that removes everything it drew. */
export function playReplay(app: Application, layer: Container, tl: Timeline, opts: PlayOptions): () => void {
  const { center, size } = opts;
  const units = new Graphics();
  const fx = new Graphics();
  layer.addChild(fx, units);
  const look = (a: Actor): CounterLook => ({ cls: a.cls, aff: a.aff, fill: a.fill, confirmed: a.confirmed, strength: a.s0 });
  const sprites = new Map<string, UnitModel>();
  for (const a of tl.actors) {
    const s = addUnit(layer, 0, 0, look(a));
    s.alpha = 0;
    sprites.set(a.id, s);
  }
  const labels: { text: Text; at: Point; start: number }[] = [];
  for (const b of tl.battles) {
    const at = center(b.at);
    const start = tl.combat[0] + b.delay + 260;
    const mk = (s: string, fill: number, dx: number) => {
      const text = new Text({ text: s, resolution: 3, style: { fontFamily: FONT_DISPLAY, fontSize: 17, fontWeight: '800', fill, stroke: { color: 0x070b12, width: 3 } } });
      text.anchor.set(0.5, 1);
      text.alpha = 0;
      layer.addChild(text);
      labels.push({ text, at: { x: at.x + dx, y: at.y - 14 }, start });
    };
    if (b.ours) mk(`−${b.ours}`, AFFILIATION.hostile, b.theirs ? -14 : 0);
    if (b.theirs) mk(`−${b.theirs}`, 0x6fbf8e, b.ours ? 14 : 0);
  }
  const routes = new Map(tl.actors.map((a) => [a.id, a.route.map(center)]));
  let t = 0;
  let last = performance.now();
  let phase: Phase | null = null;
  let done = false;
  useReplay.setState({ paused: false, seek: null, progress: 0, marks: { movement: tl.move[0], combat: tl.combat[0], aftermath: tl.after[0], end: tl.end } });

  const frame = () => {
    if (done) return;
    const now = performance.now();
    const ctl = useReplay.getState();
    if (ctl.seek !== null) {
      t = Math.max(0, Math.min(tl.end, ctl.seek));
      useReplay.setState({ seek: null });
    } else if (!ctl.paused) t += (now - last) * ctl.speed;
    last = now;
    const progress = Math.min(1, t / tl.end);
    if (Math.abs(progress - ctl.progress) > 0.02 || progress === 1) useReplay.setState({ progress });
    const p = phaseAt(tl, t);
    if (p !== phase) {
      phase = p;
      opts.onPhase(p);
    }
    const pm = ease(span(t, tl.move));
    const pc = span(t, tl.combat);
    const pa = ease(span(t, tl.after));
    units.clear();
    fx.clear();

    // Formations.
    for (const a of tl.actors) {
      let pos = along(routes.get(a.id)!, pm);
      if (a.lunge && pc > 0 && pc < 1) pos = lerp(pos, center(a.lunge), Math.sin(Math.PI * clamp(pc * 1.6)) * 0.38);
      if (a.retreat) pos = lerp(pos, center(a.retreat[1]), pa);
      let fade = 1;
      if (a.appears) fade = clamp(pm * 4);
      if (a.destroyed) fade *= 1 - pa;
      const sprite = sprites.get(a.id)!;
      if (fade <= 0.01) {
        sprite.alpha = 0;
        continue;
      }
      const strength = a.s0 + (a.s1 - a.s0) * pc;
      const slot = slotOffsets(Math.max(1, a.slots))[Math.min(a.slot, Math.max(0, a.slots - 1))]!;
      const x = pos.x + slot.x;
      const y = pos.y + slot.y;
      // Vehicles turn to the way they are driving.
      const dx = x - sprite.x;
      const dy = y - sprite.y;
      if (dx * dx + dy * dy > 0.04) sprite.setFacing(Math.atan2(dy, dx));
      sprite.position.set(x, y);
      if (sprite.scale.x !== slot.scale) {
        sprite.scale.set(slot.scale);
        sprite.applyZoom();
      }
      sprite.alpha = (a.confirmed ? 1 : 0.55) * fade;
      sprite.setStrength(strength);
      if (a.destroyed && pa > 0 && pa < 1) {
        fx.circle(pos.x, pos.y, size * (0.3 + pa)).stroke({ width: 3, color: 0xf2a65a, alpha: 1 - pa });
        fx.circle(pos.x, pos.y, size * 0.5 * pa).fill({ color: 0xffd28a, alpha: 0.5 * (1 - pa) });
      }
    }

    // Strikes: a tracer arcing to the target.
    for (const s of tl.strikes) {
      const q = clamp((t - tl.combat[0] - s.delay) / 420);
      if (q <= 0 || q >= 1) continue;
      const b = center(s.to);
      // An unseen shooter's fire arrives from beyond the fog.
      const a = s.from ? center(s.from) : { x: b.x - size * 3, y: b.y - size * 4 };
      const mid = { x: (a.x + b.x) / 2, y: Math.min(a.y, b.y) - size * 1.6 };
      const pt = (u: number) => ({ x: (1 - u) ** 2 * a.x + 2 * (1 - u) * u * mid.x + u * u * b.x, y: (1 - u) ** 2 * a.y + 2 * (1 - u) * u * mid.y + u * u * b.y });
      const head = pt(q);
      const tail = pt(Math.max(0, q - 0.22));
      fx.moveTo(tail.x, tail.y).quadraticCurveTo((tail.x + head.x) / 2, (tail.y + head.y) / 2 - 2, head.x, head.y).stroke({ width: 2, color: s.color, alpha: 0.9 });
      fx.circle(head.x, head.y, 3).fill({ color: 0xfff1c9 });
    }

    // Battles: flash, shock rings and a crossed mark.
    for (const b of tl.battles) {
      const q = clamp((t - tl.combat[0] - b.delay - 200) / 700);
      if (q <= 0 || q >= 1) continue;
      const c = center(b.at);
      if (q < 0.12) fx.circle(c.x, c.y, size * 1.1).fill({ color: 0xffffff, alpha: 0.55 * (1 - q / 0.12) });
      fx.circle(c.x, c.y, size * (0.45 + 0.6 * q)).fill({ color: 0xffb35c, alpha: 0.55 * (1 - q) });
      fx.circle(c.x, c.y, size * (0.5 + 1.1 * q)).stroke({ width: 4, color: AFFILIATION.hostile, alpha: 1 - q });
      fx.circle(c.x, c.y, size * (0.3 + 1.6 * q)).stroke({ width: 2, color: 0xffd28a, alpha: 0.8 * (1 - q) });
      const r = 9;
      fx.moveTo(c.x - r, c.y - r).lineTo(c.x + r, c.y + r).moveTo(c.x + r, c.y - r).lineTo(c.x - r, c.y + r).stroke({ width: 3, color: 0xffffff, alpha: Math.min(1, 3 * (1 - q)) });
    }

    // Damage numbers float up from each battle.
    for (const l of labels) {
      const q = clamp((t - l.start) / 1100);
      l.text.alpha = q <= 0 ? 0 : q < 0.15 ? q / 0.15 : 1 - Math.max(0, (q - 0.6) / 0.4);
      l.text.position.set(l.at.x, l.at.y - 22 * ease(q));
    }

    // Captured sites pulse in the new owner's colour.
    for (const c of tl.captures) {
      const p0 = center(c.at);
      for (const k of [0, 0.35]) {
        const q = clamp((pa - k) / 0.65);
        if (q <= 0 || q >= 1) continue;
        fx.circle(p0.x, p0.y, size * (0.4 + 1.2 * q)).stroke({ width: 3, color: c.color, alpha: 1 - q });
      }
    }

    if (t >= tl.end) {
      done = true;
      opts.onDone();
    }
  };

  app.ticker.add(frame);
  return () => {
    done = true;
    app.ticker.remove(frame);
    layer.removeChildren().forEach((c) => c.destroy());
  };
}

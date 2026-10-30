// Touch on the battlefield, read the way Maps reads it: one finger drags the ground, two pinch, twist
// and drag it together with the ground pinned under both, two sliding up or down side by side tilt.
// Small motions are dead zones, so a pinch never leaks a turn; once a turn or a pinch is plainly
// meant the map catches up with the fingers and then follows them one to one. A press that moves is
// a drag, one held still is a long-press, and only a clean tap (one finger, still, short, never cut
// short) may give an order. Pure: pointer events in, what the battle should do out; no DOM, no
// three.js, no clock of its own (the caller passes the time and calls `tick`).

export interface Pt {
  x: number;
  y: number;
}

/** A press that moves this far (points) is a drag, never a tap; a long-press is cancelled by it. */
export const SLOP = 10;
/** A press held this long is a long-press, never a tap (ms). */
export const HOLD_MS = 480;
/** The long-press ring starts filling after this long (ms). */
export const HOLD_SHOW_MS = 150;
/** The ring is up at least this long before the long-press, even on a page too slow to tick on time (ms). */
export const RING_MIN_MS = 120;
/** A twist starts once the fingers have turned this far together (radians). */
export const TWIST = (12 * Math.PI) / 180;
/** A pinch starts once the distance between the fingers has changed by 5% (as a log). */
export const PINCH = Math.log(1.05);
/** A twist that ends within this of a quarter turn settles on it (radians). */
export const SNAP = (10 * Math.PI) / 180;
/** Further off north than this the north chip shows (radians). */
export const OFF_NORTH = (4 * Math.PI) / 180;
/** Cells drawn smaller than this (points) get help: a tap snaps to the nearest legal cell. */
export const SMALL_CELL = 44;
/** How far a tap may snap (points). */
export const SNAP_REACH = 22;
/** A second tap this close to the first (points), and this soon (ms), is on the same spot. */
export const SAME_SPOT = 16;
export const SAME_SPOT_MS = 2500;

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const len = (v: Pt) => Math.hypot(v.x, v.y);
const pt = (p: Pt): Pt => ({ x: p.x, y: p.y });

/**
 * Nothing inside the dead zone, then twice the fingers' rate until the map has caught up with them,
 * then one to one. Continuous: the map never jumps when a gesture starts.
 */
function lag(v: number, dead: number, caught: boolean): number {
  if (caught) return v;
  const m = Math.abs(v);
  return m <= dead ? 0 : Math.sign(v) * Math.min(m, 2 * (m - dead));
}

/** What two fingers ask of the camera after a move. */
export type TwoStep =
  | { kind: 'wait' }
  /** Tilt by the fingers' vertical travel since the last move (points, down positive). */
  | { kind: 'tilt'; dy: number }
  /**
   * Put the ground pinned under the first and second finger at `a` and `b`: the fingers' midpoint
   * at once, their turn and spread only past the dead zones (`turn` and `zoom` say which are past).
   */
  | { kind: 'map'; a: Pt; b: Pt; turn: boolean; zoom: boolean };

/**
 * Two fingers from the moment the second lands. The first motion decides: both sliding up or down
 * side by side tilts (for the rest of the gesture); anything else moves the map. On the map, the
 * targets for the pinned ground follow the fingers' midpoint at once, their turn and spread only
 * past the dead zones.
 */
export class TwoFingers {
  private mode: 'wait' | 'tilt' | 'map' = 'wait';
  /** The turn of the line between the fingers since they landed (radians, clockwise positive). */
  private turned = 0;
  private turnOn = false;
  private turnCaught = false;
  private zoomOn = false;
  private zoomCaught = false;
  private readonly a0: Pt;
  private readonly b0: Pt;
  private last: [Pt, Pt];

  constructor(a: Pt, b: Pt) {
    this.a0 = pt(a);
    this.b0 = pt(b);
    this.last = [this.a0, this.b0];
  }

  /** The map has been turned by this gesture (so it may settle on a quarter turn when it ends). */
  get turning(): boolean {
    return this.turnOn;
  }

  move(a: Pt, b: Pt): TwoStep {
    const [pa, pb] = this.last;
    this.last = [pt(a), pt(b)];
    const v0 = sub(this.b0, this.a0);
    const v = sub(b, a);
    const vp = sub(pb, pa);
    if (len(v) > 0.5 && len(vp) > 0.5) this.turned += wrap(Math.atan2(v.y, v.x) - Math.atan2(vp.y, vp.x));
    const spread = Math.log(Math.max(1, len(v)) / Math.max(1, len(v0)));
    if (this.mode === 'tilt') return { kind: 'tilt', dy: (a.y + b.y - pa.y - pb.y) / 2 };
    if (this.mode === 'wait') {
      const da = sub(a, this.a0);
      const db = sub(b, this.b0);
      // Each finger's move comes as its own event: decide once both have moved, or one has plainly
      // gone alone, or the fingers have turned or spread past a dead zone.
      const both = Math.min(len(da), len(db)) >= SLOP * 0.6;
      const alone = Math.max(len(da), len(db)) >= SLOP * 2.5;
      if (Math.abs(this.turned) < TWIST && Math.abs(spread) < PINCH && !both && !alone) return { kind: 'wait' };
      // Side by side, both sliding the same way up or down, neither spreading nor turning: tilt.
      const sideBySide = Math.abs(v0.x) > Math.abs(v0.y);
      const upright = (d: Pt) => Math.abs(d.y) >= SLOP * 0.6 && Math.abs(d.x) < Math.abs(d.y) * 0.6;
      const together = da.y * db.y > 0 && Math.abs(da.y - db.y) < Math.max(Math.abs(da.y), Math.abs(db.y)) * 0.6;
      if (sideBySide && upright(da) && upright(db) && together && Math.abs(spread) < PINCH && Math.abs(this.turned) < TWIST / 2) {
        this.mode = 'tilt';
        return { kind: 'tilt', dy: (da.y + db.y) / 2 };
      }
      this.mode = 'map';
    }
    if (Math.abs(this.turned) > TWIST) this.turnOn = true;
    if (Math.abs(this.turned) >= 2 * TWIST) this.turnCaught = true;
    if (Math.abs(spread) > PINCH) this.zoomOn = true;
    if (Math.abs(spread) >= 2 * PINCH) this.zoomCaught = true;
    const turn = lag(this.turned, TWIST, this.turnCaught);
    const scale = Math.exp(lag(spread, PINCH, this.zoomCaught));
    // The line between the fingers as it would be with only the turn and spread let through.
    const c = Math.cos(turn) * scale;
    const s = Math.sin(turn) * scale;
    const hx = (v0.x * c - v0.y * s) / 2;
    const hy = (v0.x * s + v0.y * c) / 2;
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    return { kind: 'map', a: { x: mx - hx, y: my - hy }, b: { x: mx + hx, y: my + hy }, turn: this.turnOn, zoom: this.zoomOn };
  }
}

/** The quarter turn a heading settles on when a twist ends close to it, or null. */
export function quarterNear(yaw: number): number | null {
  const q = Math.round(yaw / (Math.PI / 2)) * (Math.PI / 2);
  return Math.abs(wrap(yaw - q)) <= SNAP ? wrap(q) : null;
}

/** A tap on the field, and the unit it took (for stepping through a stack). */
export interface TapMark extends Pt {
  t: number;
  unit: string | null;
}

/**
 * The unit a tap takes from a stack in one cell (a helicopter over a tank, ground first): the one
 * nearest the finger, or, when the same spot was tapped a moment ago and took one of these, the next.
 */
export function stackPick(stack: readonly string[], nearest: string, tap: Pt & { t: number }, last: TapMark | null): string {
  if (stack.length < 2 || !last?.unit || tap.t - last.t >= SAME_SPOT_MS || Math.hypot(tap.x - last.x, tap.y - last.y) >= SAME_SPOT) return nearest;
  const i = stack.indexOf(last.unit);
  return i < 0 ? nearest : stack[(i + 1) % stack.length]!;
}

/** A pointer event as the gestures read it. */
export interface PointerInput {
  id: number;
  x: number;
  y: number;
  /** Milliseconds, on the same clock as `tick`. */
  t: number;
  /** The button pressed (down): 0 main, 2 secondary. */
  button?: number;
  /** Buttons held (move): 0 means none. */
  buttons?: number;
  kind?: 'mouse' | 'touch' | 'pen';
  /** The first pointer of a new touch (or any mouse press): every earlier pointer has ended. */
  primary?: boolean;
  shift?: boolean;
}

/** What the battle should do. */
export type Gesture =
  /** Fingers are down: the camera stops where it is and only they move it. */
  | { kind: 'grab' }
  /** Every finger is up, or the gesture was cut short: the camera is free again. `twisted`: the map was turned. */
  | { kind: 'release'; twisted: boolean }
  /** Pin the ground under these points. */
  | { kind: 'pin'; points: Pt[] }
  /**
   * Put the pinned ground under these points, the camera turning and zooming only if `turn` and
   * `zoom` (one finger: neither); `delta` is the finger's move, for a drag that could not pin.
   */
  | { kind: 'drag'; points: Pt[]; turn: boolean; zoom: boolean; delta: Pt }
  /** Two fingers sliding up or down: tilt by this many points. */
  | { kind: 'tilt'; dy: number }
  /** A mouse right-drag (or shift-drag): orbit by this many points. */
  | { kind: 'orbit'; dx: number; dy: number }
  /** The ring that fills under a finger held still, or null to take it away. */
  | { kind: 'ring'; at: Pt | null }
  /** A long-press, or a right-click: show what is there. Never an order. */
  | { kind: 'press'; at: Pt }
  /** A clean tap: the only gesture that may give an order. */
  | { kind: 'tap'; at: Pt }
  /** A mouse moved over the field with no button down. */
  | { kind: 'hover'; at: Pt };

interface Press {
  x: number;
  y: number;
  x0: number;
  y0: number;
  t0: number;
  /** Moved past the slop, or shared the glass with another finger: never a tap. */
  moved: boolean;
  /** Became a long-press. */
  held: boolean;
  button: number;
  /** One finger: the ground under it has been pinned. */
  pinned: boolean;
}

/**
 * The pointer state machine: tap, drag, long-press, and two-finger pinch, twist, drag and tilt.
 * A pointer that is cancelled, loses its capture, or is left over when the page is hidden ends
 * without a tap; one that never sent its up is dropped when the next touch starts.
 */
export class Gestures {
  private readonly presses = new Map<number, Press>();
  private two: { ids: [number, number]; g: TwoFingers } | null = null;
  private twisted = false;
  /** The press a long-press may still come from. */
  private holdFor: number | null = null;
  private ringOn = false;
  private ringSince = 0;

  /** Pointers down now. */
  get count(): number {
    return this.presses.size;
  }

  pointerDown(p: PointerInput): Gesture[] {
    const out: Gesture[] = [];
    // A new primary pointer: every earlier one has ended, even one that never said so.
    if (p.primary && this.presses.size) out.push(...this.reset());
    if (this.presses.has(p.id)) out.push(...this.pointerCancel(p.id));
    if (!this.presses.size) out.push({ kind: 'grab' });
    out.push(...this.ring(null));
    this.holdFor = null;
    const button = p.button ?? 0;
    this.presses.set(p.id, { x: p.x, y: p.y, x0: p.x, y0: p.y, t0: p.t, moved: false, held: false, button, pinned: false });
    if (this.presses.size === 1) {
      if (button === 0) this.holdFor = p.id;
      return out;
    }
    // Another finger: nothing down now is a tap or a long-press.
    for (const q of this.presses.values()) q.moved = true;
    if (this.presses.size === 2) out.push(...this.startTwo());
    return out;
  }

  pointerMove(p: PointerInput): Gesture[] {
    const press = this.presses.get(p.id);
    if (!press) return p.kind === 'mouse' && !p.buttons ? [{ kind: 'hover', at: pt(p) }] : [];
    // A mouse with no button down missed its up: end the press, without a tap.
    if (p.kind === 'mouse' && p.buttons === 0) return this.pointerCancel(p.id);
    const out: Gesture[] = [];
    const from = pt(press);
    const delta = { x: p.x - press.x, y: p.y - press.y };
    press.x = p.x;
    press.y = p.y;
    if (!press.moved && Math.hypot(p.x - press.x0, p.y - press.y0) > SLOP) {
      press.moved = true;
      if (this.holdFor === p.id) {
        this.holdFor = null;
        out.push(...this.ring(null));
      }
    }
    const two = this.two;
    if (two) {
      const a = this.presses.get(two.ids[0]);
      const b = this.presses.get(two.ids[1]);
      if (!a || !b || !two.ids.includes(p.id)) return out;
      const step = two.g.move(a, b);
      if (step.kind === 'tilt') out.push({ kind: 'tilt', dy: step.dy });
      else if (step.kind === 'map') {
        if (step.turn) this.twisted = true;
        // The dead zones are in the targets (a turn or spread not yet meant is taken out of them);
        // the camera turns and zooms as far as keeping the ground under both targets needs, which
        // in perspective a plain two-finger drag needs a little of too.
        out.push({ kind: 'drag', points: [step.a, step.b], turn: true, zoom: true, delta });
      }
      return out;
    }
    if (this.presses.size > 1) return out;
    // After a long-press the finger may still drag the map; what the press showed stays up.
    if (press.moved && (press.button === 2 || p.shift)) out.push({ kind: 'orbit', dx: delta.x, dy: delta.y });
    else if (press.moved) {
      // Pin the ground where the finger was a moment ago, so the drag never jumps by the slop.
      if (!press.pinned) {
        press.pinned = true;
        out.push({ kind: 'pin', points: [from] });
      }
      out.push({ kind: 'drag', points: [pt(p)], turn: false, zoom: false, delta });
    }
    return out;
  }

  pointerUp(p: PointerInput): Gesture[] {
    const press = this.presses.get(p.id);
    if (!press) return [];
    const out = this.lift(p.id);
    if (press.moved || press.held || p.t - press.t0 >= HOLD_MS) return out;
    if (press.button === 0) out.push({ kind: 'tap', at: pt(p) });
    else if (press.button === 2) out.push({ kind: 'press', at: pt(p) });
    return out;
  }

  /**
   * Another finger touched the glass off the field (on a button, say), which the field never sees
   * go down: nothing down now is a tap or a long-press, as with a second finger on the field.
   */
  elsewhere(): Gesture[] {
    if (!this.presses.size) return [];
    for (const q of this.presses.values()) q.moved = true;
    this.holdFor = null;
    return this.ring(null);
  }

  /** The pointer was cancelled or lost its capture: it ends, and is never a tap. */
  pointerCancel(id: number): Gesture[] {
    return this.presses.has(id) ? this.lift(id) : [];
  }

  /** The page was hidden or lost focus mid-gesture: everything ends, nothing is a tap. */
  reset(): Gesture[] {
    const out = this.ring(null);
    this.holdFor = null;
    this.two = null;
    if (!this.presses.size) return out;
    this.presses.clear();
    out.push({ kind: 'release', twisted: this.twisted });
    this.twisted = false;
    return out;
  }

  /**
   * Time passes for a finger held still: the ring, then the long-press once the ring has been up a
   * moment (so it shows first even when a slow page ticks late). Tick again `RING_MIN_MS` after a ring.
   */
  tick(t: number): Gesture[] {
    const press = this.holdFor === null ? undefined : this.presses.get(this.holdFor);
    if (!press || press.moved || this.presses.size !== 1) {
      this.holdFor = null;
      return this.ring(null);
    }
    if (t - press.t0 < HOLD_SHOW_MS) return [];
    if (!this.ringOn) {
      this.ringSince = t;
      return this.ring(pt(press));
    }
    if (t - press.t0 >= HOLD_MS && t - this.ringSince >= RING_MIN_MS) {
      press.held = true;
      this.holdFor = null;
      return [...this.ring(null), { kind: 'press', at: pt(press) }];
    }
    return [];
  }

  private startTwo(): Gesture[] {
    const [[ia, a], [ib, b]] = [...this.presses.entries()] as [[number, Press], [number, Press]];
    this.two = { ids: [ia, ib], g: new TwoFingers(a, b) };
    return [{ kind: 'pin', points: [pt(a), pt(b)] }];
  }

  private lift(id: number): Gesture[] {
    const out: Gesture[] = [];
    this.presses.delete(id);
    if (this.holdFor === id) this.holdFor = null;
    out.push(...this.ring(null));
    if (this.two?.ids.includes(id)) {
      if (this.two.g.turning) this.twisted = true;
      this.two = null;
      // Fingers left on the glass go on from where they are.
      for (const q of this.presses.values()) q.pinned = false;
      if (this.presses.size === 2) out.push(...this.startTwo());
    }
    if (!this.presses.size) {
      out.push({ kind: 'release', twisted: this.twisted });
      this.twisted = false;
    }
    return out;
  }

  private ring(at: Pt | null): Gesture[] {
    if (!at === !this.ringOn) return [];
    this.ringOn = !!at;
    return [{ kind: 'ring', at }];
  }
}

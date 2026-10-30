// When the battle draws, and how sharp (docs/arena-v2.md, section 8). A turn-based battle shows a
// still picture most of the time, and every frame costs battery. The scheduler is in one state at
// a time, in this order of precedence:
//
//   Context lost      the GPU context is gone: nothing draws until the stage is rebuilt.
//   Suspended         the page is hidden: nothing draws (the browser runs no animation frames).
//   Combat playback   the film, an action cam, slow motion, shake, shots in the air, words rising,
//                     and two seconds after (buildings slump, trees fall): every frame.
//   Camera transition the camera is moving or easing, and 0.3 s after: every frame.
//   Interaction       something asked for a frame (an order, an overlay, a setting): that frame, or
//                     every frame for as long as it asked.
//   Ambient animation only smoke, fire, rain or snow, turning rotors or moving soldiers in view:
//                     30 a second, for 15 s after the last playback, camera move or interaction,
//                     then the picture holds (a player may think for minutes).
//   Idle              nothing moves: no frames at all.
//
// The pixel ratio follows the real frame rate between 1 and the quality's cap (never above the device's).

export type FrameState = 'lost' | 'suspended' | 'playback' | 'camera' | 'interaction' | 'ambient' | 'idle';
export const FRAME_STATES: readonly FrameState[] = ['lost', 'suspended', 'playback', 'camera', 'interaction', 'ambient', 'idle'];

/** What the field itself says it needs; interaction, suspension and loss come from outside. */
export type SceneNeed = 'playback' | 'camera' | 'ambient' | 'idle';

/** Seconds of full rate after a nudge or a camera move. */
export const NUDGE = 0.3;
/** Seconds of full rate after the film: buildings slump, trees fall, wrecks settle. */
export const AFTER_FILM = 2;
/** Seconds ambient animation keeps drawing after the last playback, camera move or interaction. */
export const AMBIENT_FOR = 15;
const AMBIENT_MS = 1000 / 30;

export class Pacer {
  state: FrameState = 'interaction';
  /** Frames drawn in each state, and frames not drawn, since the stage was built. */
  readonly drawsBy: Record<FrameState, number> = { lost: 0, suspended: 0, playback: 0, camera: 0, interaction: 0, ambient: 0, idle: 0 };
  draws = 0;
  kept = 0;
  /** Draw the next frame whatever the field says. */
  private nudged = true;
  private interactUntil = 0;
  private ambientUntil = 0;
  private last = -Infinity;
  /** Seconds the scene has not been stepped by. */
  private owed = 0;

  /** An interaction: draw the next frame, and every frame for `seconds`. */
  nudge(now: number, seconds = 0): void {
    this.nudged = true;
    if (seconds > 0) this.interactUntil = Math.max(this.interactUntil, now + seconds * 1000);
    this.ambientUntil = now + AMBIENT_FOR * 1000;
  }

  /** Lost or suspended (shown in the overlay; nothing draws), or back to drawing. */
  hold(state: 'lost' | 'suspended' | null, now: number): void {
    if (state) this.state = state;
    else this.nudge(now, NUDGE);
  }

  /** At each animation frame: the seconds to step the scene by before drawing, or null to keep the picture. */
  tick(now: number, dt: number, need: SceneNeed): number | null {
    this.owed += dt;
    let state: FrameState = need;
    if (need === 'playback' || need === 'camera') this.ambientUntil = now + AMBIENT_FOR * 1000;
    else if (this.nudged || now < this.interactUntil) state = 'interaction';
    else if (need === 'ambient' && now >= this.ambientUntil) state = 'idle';
    this.state = state;
    const due = state === 'ambient' ? now - this.last >= AMBIENT_MS - 4 : state !== 'idle';
    if (!due) {
      this.kept++;
      return null;
    }
    this.nudged = false;
    this.last = now;
    this.draws++;
    this.drawsBy[state]++;
    // After a still spell the scene takes one ordinary step, not the whole wait.
    const step = Math.min(0.25, this.owed);
    this.owed = 0;
    return step;
  }
}

/** A rolling sample of one cost (ms), for the overlay and the probe. */
export class Meter {
  private readonly xs: number[] = [];
  last = 0;
  constructor(private readonly size = 240) {}

  add(ms: number): void {
    this.last = ms;
    this.xs.push(ms);
    if (this.xs.length > this.size) this.xs.shift();
  }

  /** The `p` quantile (0..1) of the sample, 0 when empty. */
  q(p: number): number {
    const s = [...this.xs].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0;
  }

  get count(): number {
    return this.xs.length;
  }

  recent(n: number): number[] {
    return this.xs.slice(-n);
  }

  clear(): void {
    this.xs.length = 0;
  }
}

/** Time spent in the battle engine (orders, turns, the advice), measured where the screen calls it. */
export const engineMeter = new Meter(120);

/** Run an engine call and add its time to `engineMeter`. */
export function metered<T>(fn: () => T): T {
  const t0 = performance.now();
  try {
    return fn();
  } finally {
    engineMeter.add(performance.now() - t0);
  }
}

export type RatioState = 'fixed' | 'adapting' | 'frozen';

/** Frames a step down looks at, and a step up (a step up wants a longer run of good frames). */
const DOWN_AFTER = 60;
const UP_AFTER = 180;
/** Up and down moves that reverse each other before it stops climbing. */
const FLIPS = 2;
/** Intervals over this are pauses (a tab switch, a hitch), not frame rate. */
const OUTLIER_MS = 250;
const LOW_POWER_MS = 1000 / 30;
/** The rate it aims for: 60 a second (Safari's rate even on 120 Hz screens; a faster screen is a bonus). */
const VSYNC_MS = 1000 / 60;

/**
 * The pixel ratio, from a rolling median of real frame intervals (as drei's PerformanceMonitor
 * does): down a step when frames run long, up when they keep 60 a second. A steady 33 ms cadence is
 * iOS Low Power Mode (it caps animation frames at 30 a second), not a slow GPU: it holds. After it
 * has turned back on itself twice it stops climbing (it can still step down).
 */
export class RatioGovernor {
  ratio: number;
  max: number;
  min: number;
  state: RatioState;
  /** The last frames ran at a steady 30 a second: Low Power Mode (or a 30 Hz screen). */
  lowPower = false;
  private window: number[] = [];
  private lastMove: -1 | 0 | 1 = 0;
  private flips = 0;

  constructor(device: number, cap: number) {
    this.max = Math.max(0.5, Math.min(2, cap, device || 1));
    this.min = Math.min(1, this.max);
    this.ratio = this.max;
    this.state = this.max > this.min ? 'adapting' : 'fixed';
  }

  /** The device's ratio changed (another screen, a zoom): keep within it. */
  setDevice(device: number, cap: number): number {
    const max = Math.max(0.5, Math.min(2, cap, device || 1));
    if (max === this.max) return this.ratio;
    this.max = max;
    this.min = Math.min(1, max);
    this.ratio = Math.min(max, Math.max(this.min, this.ratio));
    if (max <= this.min) this.state = 'fixed';
    else if (this.state === 'fixed') this.state = 'adapting';
    this.window = [];
    return this.ratio;
  }

  /** One real frame interval (ms) after a drawn frame; returns the new ratio when it should change. */
  add(ms: number): number | null {
    if (!(ms > 0) || ms > OUTLIER_MS) return null;
    const w = this.window;
    w.push(ms);
    if (w.length > UP_AFTER) w.shift();
    if (w.length < DOWN_AFTER) return null;
    const recent = w.slice(-DOWN_AFTER).sort((a, b) => a - b);
    const at = (q: number) => recent[Math.floor(recent.length * q)]!;
    const median = at(0.5);
    // Low Power Mode: a steady 30 a second. Only slower than that is the GPU's doing.
    this.lowPower = Math.abs(median - LOW_POWER_MS) < 2.5 && at(0.9) - at(0.1) < 4;
    if (this.state === 'fixed' || this.lowPower) return null;
    if (median > VSYNC_MS * 1.25) return this.ratio > this.min ? this.move(-1, median > VSYNC_MS * 2 ? 0.4 : 0.2) : null;
    if (w.length < UP_AFTER || this.ratio >= this.max || this.state === 'frozen') return null;
    const all = [...w].sort((a, b) => a - b);
    if (all[Math.floor(all.length / 2)]! > VSYNC_MS * 1.08 || all[Math.floor(all.length * 0.9)]! > VSYNC_MS * 1.3) return null;
    if (this.lastMove === -1 && this.flips >= FLIPS) {
      // Back and forth: settle on the lower ratio for good.
      this.state = 'frozen';
      return null;
    }
    return this.move(1, 0.2);
  }

  private move(dir: -1 | 1, size: number): number {
    if (this.lastMove !== 0 && this.lastMove !== dir) this.flips++;
    this.lastMove = dir;
    this.ratio = Math.round(Math.min(this.max, Math.max(this.min, this.ratio + dir * size)) * 100) / 100;
    this.window = [];
    return this.ratio;
  }
}

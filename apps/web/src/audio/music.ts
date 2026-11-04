// The music director: which piece plays (planning on the map and the menu, battle in the arena,
// nothing), how intense it is, and the stingers. A bar is scheduled on the audio clock a little
// ahead of time, so the main thread only wakes a few times a second. Layers fade in and out on
// their own gains as intensity moves; a change of piece crossfades. Quiet layers schedule nothing.
// Nothing at all is scheduled while the mixer has no running context (muted, hidden, or before the
// first touch).

import type { Bus } from './mixer';
import { barNotes, barSeconds, layerGains, LAYERS, stepSeconds, type Mode } from './score';
import { STINGERS, stingerLength, type StingerKind } from './stingers';
import { play } from './voices';

export type Scene = 'off' | 'menu' | 'planning';
export type MusicMode = Mode | 'off';

/** What the director needs of the mixer. */
export interface MixerPort {
  running(): BaseAudioContext | null;
  bus(b: Bus, ctx?: BaseAudioContext): AudioNode | null;
}

export interface Timers {
  every: (fn: () => void, ms: number) => unknown;
  cancel: (h: unknown) => void;
}

const browserTimers: Timers = {
  every: (fn, ms) => setInterval(fn, ms),
  cancel: (h) => clearInterval(h as ReturnType<typeof setInterval>),
};

/** The piece for a scene: the battle overrides the map. */
export function modeFor(scene: Scene, battle: boolean): MusicMode {
  if (battle) return 'battle';
  return scene === 'off' ? 'off' : 'planning';
}

/** The title screen's level: the pad and a soft pulse. */
export const MENU_LEVEL = 0.3;
/** Seconds of the next bar scheduled ahead. */
export const LOOKAHEAD = 0.5;
export const TICK_MS = 120;
/** Seconds a piece takes to fade out when another takes over. */
export const CROSSFADE = 2.5;

interface Group {
  mode: Mode;
  out: GainNode;
  layers: Record<string, GainNode>;
  bar: number;
  nextBar: number;
  /** Layer gains last set, to skip setting them again. */
  set: Record<string, number>;
  /** The intensity used to pick the bar's notes. */
  level: number;
  /** When a fading group is torn down. */
  dies: number;
}

interface Graph {
  ctx: BaseAudioContext;
  /** The score's own gain into the music bus: stingers duck it. */
  score: GainNode;
  bus: AudioNode;
}

export class MusicDirector {
  private scene: Scene = 'off';
  private battle = false;
  private target = 0;
  private level = 0;
  private source: (() => number) | null = null;
  private graph: Graph | null = null;
  private groups: Group[] = [];
  private timer: unknown = null;
  private lastTick = 0;
  private stingUntil = 0;
  private stingPriority = 0;
  private lastSting: Partial<Record<StingerKind, number>> = {};
  private readonly timers: Timers;

  constructor(
    private readonly mixer: MixerPort,
    timers?: Timers,
  ) {
    this.timers = timers ?? browserTimers;
  }

  get mode(): MusicMode {
    return modeFor(this.scene, this.battle);
  }

  /** The intensity the score is moving toward. */
  get intensity(): number {
    return this.target;
  }

  /** Groups sounding now (the current piece, and any fading out). */
  get pieces(): number {
    return this.groups.length;
  }

  setScene(s: Scene): void {
    if (s === this.scene) return;
    this.scene = s;
    this.wake();
  }

  /** The arena opens (true) or closes; `source` reads the battle's intensity each tick. */
  setBattle(on: boolean, source?: () => number): void {
    this.battle = on;
    this.source = on ? (source ?? null) : null;
    this.wake();
  }

  /** The map's tension (0..1). */
  setLevel(v: number): void {
    this.target = Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
  }

  /** A cue over the score. Returns whether it played. */
  stinger(kind: StingerKind): boolean {
    const g = this.ensureGraph();
    if (!g) return false;
    const s = STINGERS[kind];
    const now = g.ctx.currentTime;
    // The same cue twice in a moment (two screens reporting one victory) plays once.
    if ((this.lastSting[kind] ?? -Infinity) + 2 > now) return false;
    if (now < this.stingUntil && s.priority < this.stingPriority) return false;
    this.lastSting[kind] = now;
    const len = stingerLength(kind);
    this.stingUntil = now + len;
    this.stingPriority = s.priority;
    const at = now + 0.03;
    for (const [t, inst, midi, dur, gain] of s.notes) play(g.ctx, g.bus, inst, at + t, midi, dur, gain);
    const p = g.score.gain;
    p.cancelScheduledValues(now);
    p.setTargetAtTime(Math.max(0.05, 1 - s.duck), now, 0.06);
    p.setTargetAtTime(1, at + Math.max(0.6, len * 0.8), 0.8);
    return true;
  }

  /** Stops the clock and lets everything fade (the page going away). */
  dispose(): void {
    this.scene = 'off';
    this.battle = false;
    this.tick();
    if (this.timer !== null) this.timers.cancel(this.timer);
    this.timer = null;
  }

  private wake(): void {
    if (this.timer === null && this.mode !== 'off') this.timer = this.timers.every(() => this.tick(), TICK_MS);
    this.tick();
  }

  private ensureGraph(): Graph | null {
    const ctx = this.mixer.running();
    if (!ctx) return null;
    if (this.graph?.ctx === ctx) return this.graph;
    const bus = this.mixer.bus('music', ctx);
    if (!bus) return null;
    const score = ctx.createGain();
    score.connect(bus);
    this.graph = { ctx, score, bus };
    this.groups = [];
    return this.graph;
  }

  /** One wake of the clock: follow the intensity, crossfade pieces, schedule what is due. */
  tick(): void {
    const mode = this.mode;
    const g = this.ensureGraph();
    if (!g) {
      // Nothing is running: nothing to schedule. The clock stops when there is no piece to play.
      if (mode === 'off' && this.timer !== null) {
        this.timers.cancel(this.timer);
        this.timer = null;
      }
      return;
    }
    const now = g.ctx.currentTime;
    const dt = Math.min(1, Math.max(0, now - this.lastTick));
    this.lastTick = now;
    const want = mode === 'battle' ? (this.source ? this.source() : this.target) : this.scene === 'menu' ? MENU_LEVEL : this.target;
    // Follow the target over a couple of seconds: a single shot does not slam the drums in.
    this.level += (Math.min(1, Math.max(0, want)) - this.level) * Math.min(1, dt / 1.5 + (dt === 0 ? 0 : 0.02));

    for (const grp of this.groups) {
      if (grp.dies === Infinity && grp.mode !== mode) {
        grp.dies = now + CROSSFADE + 0.5;
        grp.out.gain.cancelScheduledValues(now);
        grp.out.gain.setTargetAtTime(0, now, CROSSFADE / 4);
      }
    }
    for (const grp of this.groups.filter((x) => x.dies <= now)) grp.out.disconnect();
    this.groups = this.groups.filter((x) => x.dies > now);

    if (mode !== 'off') {
      let cur = this.groups.find((x) => x.mode === mode && x.dies === Infinity);
      if (!cur) {
        cur = this.makeGroup(g, mode, now);
        this.groups.push(cur);
        // A new piece starts at the level it is called at, not climbing up from silence.
        this.level = Math.min(1, Math.max(0, want));
      }
      this.follow(cur, now);
      // A clock that fell far behind (a throttled background tab) starts again from now.
      if (cur.nextBar < now - 0.25) cur.nextBar = now + 0.05;
      while (cur.nextBar < now + LOOKAHEAD) this.scheduleBar(g, cur);
    } else if (this.groups.length === 0 && this.timer !== null) {
      this.timers.cancel(this.timer);
      this.timer = null;
    }
  }

  private makeGroup(g: Graph, mode: Mode, now: number): Group {
    const out = g.ctx.createGain();
    out.gain.setValueAtTime(0.0001, now);
    out.gain.setTargetAtTime(1, now, 0.5);
    out.connect(g.score);
    const layers: Record<string, GainNode> = {};
    for (const l of LAYERS[mode]) {
      const n = g.ctx.createGain();
      n.gain.setValueAtTime(0, now);
      n.connect(out);
      layers[l.id] = n;
    }
    return { mode, out, layers, bar: 0, nextBar: now + 0.1, set: {}, level: this.level, dies: Infinity };
  }

  private follow(grp: Group, now: number): void {
    const gains = layerGains(grp.mode, this.level);
    for (const [id, v] of Object.entries(gains)) {
      if (Math.abs((grp.set[id] ?? -1) - v) < 0.01) continue;
      grp.set[id] = v;
      const p = grp.layers[id]!.gain;
      p.cancelScheduledValues(now);
      p.setTargetAtTime(v, now, 1.2);
    }
    grp.level = this.level;
  }

  private scheduleBar(g: Graph, grp: Group): void {
    const step = stepSeconds(grp.mode);
    // A layer fading in is heard from its first bar: schedule by where it is heading.
    const notes = barNotes(grp.mode, grp.bar, grp.level, layerGains(grp.mode, grp.level));
    for (const n of notes) play(g.ctx, grp.layers[n.layer]!, n.inst, grp.nextBar + n.step * step, n.midi, n.len * step, n.gain);
    grp.bar++;
    grp.nextBar += barSeconds(grp.mode);
  }
}

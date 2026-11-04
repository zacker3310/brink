// The mixer: one AudioContext for the page, three buses (music, sfx, ui) into a master with a
// gentle limiter. Levels are 0..100 sliders kept on the device; mute suspends the context, so a
// muted game spends no CPU on sound at all. Everything that makes a sound asks `context()` first
// and gets null when muted or before the first touch (iOS only starts audio inside a gesture).

export type Bus = 'music' | 'sfx' | 'ui';
export type LevelKey = 'master' | Bus;
export type Levels = Record<LevelKey, number>;

export const DEFAULT_LEVELS: Levels = { master: 100, music: 60, sfx: 100, ui: 75 };
export const BUSES: readonly Bus[] = ['music', 'sfx', 'ui'];
const KEY = 'brink.audio.v1';

/** A slider position (0..100) to a gain: squared, so the top half of the slider is the useful half. */
export function gainOf(level: number): number {
  if (!Number.isFinite(level) || level <= 0) return 0;
  const v = Math.min(100, level) / 100;
  return v * v;
}

/** Levels from storage; anything missing or out of range falls back to the default. */
export function parseLevels(raw: string | null): Levels {
  const out = { ...DEFAULT_LEVELS };
  if (!raw) return out;
  try {
    const p = JSON.parse(raw) as Partial<Record<LevelKey, unknown>>;
    for (const k of Object.keys(out) as LevelKey[]) {
      const v = p[k];
      if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.max(0, Math.min(100, Math.round(v)));
    }
  } catch {
    // A broken entry is the defaults.
  }
  return out;
}

export interface KeyValue {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

const browserStore: KeyValue = {
  get: (k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      // A convenience; losing it is fine.
    }
  },
};

export interface MixerOptions {
  /** Makes the context; null when the platform has none. */
  create: () => AudioContext | null;
  muted?: boolean;
  store?: KeyValue;
}

interface Graph {
  ctx: AudioContext;
  master: GainNode;
  buses: Record<Bus, GainNode>;
  /** Ducks a bus without touching its level (stingers over the score, radio over the battle). */
  ducks: Record<Bus, GainNode>;
}

export class Mixer {
  private graph: Graph | null = null;
  private muted: boolean;
  private lv: Levels;
  private failed = false;
  private readonly store: KeyValue;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly opts: MixerOptions) {
    this.muted = opts.muted ?? false;
    this.store = opts.store ?? browserStore;
    this.lv = parseLevels(this.store.get(KEY));
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /** The context, made or resumed; null when muted, unsupported or not yet allowed. */
  context(): AudioContext | null {
    if (this.muted) return null;
    const g = this.ensure();
    if (!g) return null;
    if (g.ctx.state === 'suspended') void g.ctx.resume().catch(() => undefined);
    return g.ctx;
  }

  /** The context only if it is already running: a scheduler polls this and never starts audio. */
  running(): AudioContext | null {
    if (this.muted || !this.graph) return null;
    return this.graph.ctx.state === 'running' ? this.graph.ctx : null;
  }

  /** A bus input for `ctx`, or null when that is not the mixer's context (an offline render). */
  bus(b: Bus, ctx?: BaseAudioContext): GainNode | null {
    if (this.muted) return null;
    const g = ctx ? this.graph : this.ensure();
    if (!g || (ctx && g.ctx !== ctx)) return null;
    return g.ducks[b];
  }

  levels(): Levels {
    return { ...this.lv };
  }

  setLevel(k: LevelKey, v: number): void {
    this.lv = { ...this.lv, [k]: Math.max(0, Math.min(100, Math.round(v))) };
    this.store.set(KEY, JSON.stringify(this.lv));
    this.apply(0.05);
    this.emit();
  }

  setMuted(m: boolean): void {
    if (m === this.muted) return;
    this.muted = m;
    const g = this.graph;
    if (g) {
      if (m) {
        g.master.gain.cancelScheduledValues(g.ctx.currentTime);
        g.master.gain.setValueAtTime(0, g.ctx.currentTime);
        void g.ctx.suspend().catch(() => undefined);
      } else {
        void g.ctx.resume().catch(() => undefined);
        this.apply(0.08);
      }
    }
    this.emit();
  }

  /** Pull a bus down by `depth` (0..1) now and let it back up over `hold` seconds. */
  duck(b: Bus, depth: number, hold: number): void {
    const g = this.graph;
    if (!g || this.muted) return;
    const p = g.ducks[b].gain;
    const now = g.ctx.currentTime;
    p.cancelScheduledValues(now);
    p.setTargetAtTime(Math.max(0.05, 1 - depth), now, 0.05);
    p.setTargetAtTime(1, now + hold, 0.6);
  }

  /** Called when the page is hidden or shown: a hidden page makes no sound and burns no battery. */
  visible(on: boolean): void {
    const g = this.graph;
    if (!g) return;
    if (!on) void g.ctx.suspend().catch(() => undefined);
    else if (!this.muted) void g.ctx.resume().catch(() => undefined);
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  private ensure(): Graph | null {
    if (this.graph) return this.graph;
    if (this.failed) return null;
    let ctx: AudioContext | null = null;
    try {
      ctx = this.opts.create();
    } catch {
      ctx = null;
    }
    if (!ctx) {
      this.failed = true;
      return null;
    }
    const master = ctx.createGain();
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 4;
    limiter.ratio.value = 8;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.2;
    master.connect(limiter).connect(ctx.destination);
    const make = (): [GainNode, GainNode] => {
      const level = ctx.createGain();
      const duck = ctx.createGain();
      duck.connect(level).connect(master);
      return [level, duck];
    };
    const [mu, muD] = make();
    const [sf, sfD] = make();
    const [ui, uiD] = make();
    this.graph = { ctx, master, buses: { music: mu, sfx: sf, ui }, ducks: { music: muD, sfx: sfD, ui: uiD } };
    this.apply(0);
    return this.graph;
  }

  private apply(tc: number): void {
    const g = this.graph;
    if (!g) return;
    const now = g.ctx.currentTime;
    const set = (p: AudioParam, v: number) => {
      p.cancelScheduledValues(now);
      if (tc > 0) p.setTargetAtTime(v, now, tc);
      else p.setValueAtTime(v, now);
    };
    set(g.master.gain, this.muted ? 0 : gainOf(this.lv.master));
    for (const b of BUSES) set(g.buses[b].gain, gainOf(this.lv[b]));
  }
}

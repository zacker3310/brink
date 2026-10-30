// Battle audio (docs/arena-v2.md, section 7, decision 18): weapon reports by calibre, impacts,
// engines, rotors and drones placed by distance from the camera, a shared echo, and radio calls.
// Reuses the game's AudioContext and mute (sfx.ts). Sounds are synthesised once into buffers; a shot
// is a few nodes. At most MAX_VOICES at once on an iPhone; the quietest gives way. Tank guns,
// artillery, rockets and the heavy blasts play in layers weighed by distance (`layers`).

import type { RadioCall } from '@brink/arena/v2';
import { audio, isMuted } from '../../sfx';
import { dB, rand, type Rand, type Samples } from './dsp';
import { crickets, diesel, DIESEL_RPM, rain, rotor as rotorLoop, tracks, white } from './loops';
import { fetchRadio, RadioDesk, type Direction } from './radio';
import { LAYERED, SOUNDS, synth, synthLayers } from './recipes';
import { impulse, place, type Listener, type Spot } from './space';

export type { Listener } from './space';
export type { Direction } from './radio';

/** Sounds at once, everything counted; the quietest gives way. */
export const MAX_VOICES = 24;
/** Continuous sources heard at once (the loudest); the rest wait silent until they matter. */
export const MAX_LOOPS = 8;

interface Gun {
  sound: string;
  /** Seconds between rounds in a burst: the weapon's real cyclic rate. */
  every: number;
  /** How much that interval wanders: a trigger finger, or a mechanism. */
  jitter: number;
  /** Twin guns: the second fires this long after the first. */
  pair?: number;
  /** dB at the gun. */
  level: number;
  /** Cells at which the direct sound is 6 dB down. */
  reach: number;
  /** A slap echo off the terrain. */
  slap: boolean;
}

const rpm = (n: number) => 60 / n;

const GUNS: Record<string, Gun> = {
  '5.56': { sound: '5.56', every: rpm(800), jitter: 0.08, level: -9, reach: 6, slap: false },
  '7.62': { sound: '7.62', every: rpm(650), jitter: 0.06, level: -6, reach: 7, slap: false },
  '12.7': { sound: '12.7', every: rpm(550), jitter: 0.03, level: -3, reach: 9, slap: false },
  '23': { sound: '23', every: rpm(3400), jitter: 0.01, level: -4, reach: 9, slap: false },
  // M242 at the 200 a minute single-shot cadence the game fires it at.
  '25': { sound: '25', every: rpm(200), jitter: 0.015, level: -2, reach: 10, slap: false },
  // 2A72 at 330 a minute (2A42 low rate is 300; pass rpm for its 550 high rate or the M230's 625).
  '30': { sound: '30', every: rpm(330), jitter: 0.015, level: -2, reach: 10, slap: false },
  // Twin KDA: a round is a pair, the second gun a beat behind, 550 a minute a gun.
  '35': { sound: '35', every: rpm(550), jitter: 0.015, pair: 0.034, level: -1.5, reach: 11, slap: false },
  '40': { sound: '40', every: 1.1, jitter: 0.1, level: -10, reach: 6, slap: false },
  '84': { sound: '84', every: 4, jitter: 0.05, level: 0, reach: 13, slap: true },
  '100': { sound: '100', every: 5, jitter: 0.05, level: -1, reach: 13, slap: true },
  '105': { sound: '105', every: 6, jitter: 0.05, level: 0, reach: 14, slap: true },
  '120': { sound: '120', every: 6, jitter: 0.05, level: 0, reach: 15, slap: true },
  '125': { sound: '125', every: 7, jitter: 0.05, level: 0, reach: 15, slap: true },
  '152': { sound: '152', every: 6, jitter: 0.05, level: 0, reach: 17, slap: true },
  '155': { sound: '155', every: 6, jitter: 0.05, level: 0, reach: 17, slap: true },
  mortar: { sound: 'mortar', every: 3, jitter: 0.1, level: -3, reach: 12, slap: false },
  atgm: { sound: 'atgm', every: 0.7, jitter: 0.1, level: -3, reach: 11, slap: false },
  manpads: { sound: 'manpads', every: 1, jitter: 0.1, level: -5, reach: 10, slap: false },
  // Pods ripple fast (Hydra 70, S-8); a 122 mm launcher sends one every half second.
  rocket: { sound: 'rocket', every: 0.085, jitter: 0.12, level: -4, reach: 12, slap: false },
  rocket122: { sound: 'rocket122', every: 0.5, jitter: 0.1, level: -1, reach: 15, slap: true },
  fpv: { sound: 'fpv', every: 1.5, jitter: 0.2, level: -9, reach: 6, slap: false },
  loiter: { sound: 'loiter', every: 1.5, jitter: 0.2, level: -9, reach: 7, slap: false },
};

/** The gun for a calibre key, with sensible matches for keys outside the list. */
export function gunFor(calibre: string): Gun {
  const exact = GUNS[calibre];
  if (exact) return exact;
  const c = calibre.toLowerCase().trim();
  if (c.includes('mortar')) return GUNS.mortar!;
  if (c.includes('loiter') || c.includes('lancet') || c.includes('switchblade')) return GUNS.loiter!;
  // Inch calibres: .50, .338.
  const n = c.startsWith('.') ? parseFloat(`0${c}`) * 25.4 : parseFloat(c);
  if (!Number.isFinite(n)) return GUNS['7.62']!;
  const key =
    n < 6.5 ? '5.56'
    : n < 10 ? '7.62'
    : n < 16 ? '12.7'
    : n < 24 ? '23'
    : n < 27 ? '25'
    : n < 33 ? '30'
    : n < 38 ? '35'
    : n < 50 ? '40'
    : n < 83 ? 'mortar'
    : n < 95 ? '84'
    : n < 103 ? '100'
    : n < 112 ? '105'
    : n < 121 ? '120'
    : n < 124 ? 'rocket122'
    : n < 140 ? '125'
    : n < 154 ? '152'
    : n < 200 ? '155'
    : 'rocket122';
  return GUNS[key]!;
}

interface Hit {
  sound: string;
  level: number;
  reach: number;
  slap: boolean;
  /** Several landing over `spread` seconds (a rocket ripple, a stick of bombs). */
  count?: number;
  spread?: number;
}

const HITS: Record<string, Hit> = {
  ke_hit: { sound: 'ke_hit', level: -3, reach: 11, slap: false },
  bounce: { sound: 'bounce', level: -7, reach: 8, slap: false },
  he: { sound: 'he', level: -1, reach: 12, slap: false },
  big: { sound: 'big', level: 0, reach: 16, slap: true },
  shell: { sound: 'shell', level: 0, reach: 16, slap: true },
  rockets: { sound: 'rocket_hit', level: -2, reach: 14, slap: true, count: 10, spread: 1.8 },
  bombs: { sound: 'bomb', level: 0, reach: 18, slap: true, count: 3, spread: 0.9 },
  mine: { sound: 'mine', level: -1, reach: 12, slap: false },
  building: { sound: 'building', level: -2, reach: 14, slap: true },
  small: { sound: 'small', level: -9, reach: 5, slap: false },
};

type LoopKind = 'diesel' | 'turbine' | 'rotor' | 'fpv' | 'uav';

const LOOPS: Record<LoopKind, { level: number; reach: number; spool: number }> = {
  diesel: { level: -10, reach: 9, spool: 0.25 },
  turbine: { level: -10, reach: 9, spool: 0.9 },
  rotor: { level: -6, reach: 14, spool: 0.6 },
  fpv: { level: -14, reach: 6, spool: 0.08 },
  uav: { level: -16, reach: 8, spool: 0.3 },
};

/** Speed of sound for doppler, in cells a second, scaled like the arrival delay. */
const SOUND_SPEED = 40;

interface Voice {
  input: GainNode;
  nodes: AudioNode[];
  srcs: AudioScheduledSourceNode[];
  /** A layered sound's own paths into `input` (transient, tail) and straight to the mix (the sub). */
  layers?: { transient: GainNode; tail: GainNode; sub: GainNode; lag: number };
  /** Level at the listener, linear. */
  level: number;
  /** When the last part starts, and how fast it dies away (for picking the quietest). */
  last: number;
  tau: number;
  ends: number;
}

interface Live {
  input: GainNode;
  lp: BiquadFilterNode;
  pan: StereoPannerNode | null;
  send: GainNode;
  nodes: AudioNode[];
  srcs: AudioScheduledSourceNode[];
  set: (s: Source, now: number, tc: number) => void;
}

interface Source {
  id: string;
  kind: LoopKind;
  x: number;
  y: number;
  load: number;
  blades: number;
  rpm: number;
  rpm0: number;
  coaxial: boolean;
  vx: number;
  vy: number;
  /** Where it was at `seen`, for its velocity. */
  px: number;
  py: number;
  seen: number;
  doppler: number;
  level: number;
  live: Live | null;
}

interface Bed {
  biome: string;
  weather: string;
}

interface Buses {
  ctx: BaseAudioContext;
  master: GainNode;
  out: GainNode;
  battle: GainNode;
  dry: GainNode;
  reverb: GainNode;
  slap: GainNode;
  amb: GainNode;
  radio: GainNode;
  nodes: AudioNode[];
}

// Synthesised buffers are kept for the page: an AudioBuffer plays in any context.
const bank = new Map<string, AudioBuffer>();
const layerBank = new Map<string, { transient: AudioBuffer; body: AudioBuffer; tail: AudioBuffer; sub: AudioBuffer | null }>();
const irs = new Map<number, AudioBuffer>();

/**
 * How a layered sound's parts weigh with range (effective cells). The transient is the near field's
 * (the crack, the flash, the front of the blast wave are gone a few hundred metres out); the tail
 * grows into most of what you hear far off, and comes a little later; the sub loses level slower
 * than the rest (`SUB_CARRY` of the direct sound's loss) and skips the air filter and the echo.
 */
export function layerWeights(d: number): { transient: number; tail: number; lag: number } {
  const far = d / (d + 10);
  return { transient: 1 / (1 + (d / 6) ** 2), tail: 0.7 + 1.1 * far, lag: 0.05 * far };
}
const SUB_CARRY = 0.7;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const smooth = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export interface BattleAudioOptions {
  radio: boolean;
  /** Render into this context instead of the game's (the audition page, offline measurement). */
  context?: BaseAudioContext;
}

export class BattleAudio {
  private readonly injected: BaseAudioContext | null;
  private bus: Buses | null = null;
  private listener: Listener = { x: 15, y: 22, zoom: 0.4 };
  private voices: Voice[] = [];
  private dying: Voice[] = [];
  private sources = new Map<string, Source>();
  private bed: Bed | null = null;
  private bedLive: { nodes: AudioNode[]; srcs: AudioScheduledSourceNode[]; voices: number } | null = null;
  private nextDistant = 0;
  private night = false;
  private disposed = false;
  private silent = false;
  private lastParams = -Infinity;
  private lastRank = -Infinity;
  private readonly desk: RadioDesk;
  private readonly r: Rand = rand(1);

  constructor(opts: BattleAudioOptions) {
    this.injected = opts.context ?? null;
    this.desk = new RadioDesk(opts.radio);
  }

  /** The mix after the limiter, for metering. */
  get output(): AudioNode | null {
    return this.bus?.out ?? null;
  }

  /** Voices sounding now (one-shots, loops and the bed), for the audition page. */
  get voiceCount(): number {
    return this.voices.length + this.liveLoops() + (this.bedLive?.voices ?? 0);
  }

  get radioClips(): number {
    return this.desk.count;
  }

  setListener(l: Listener): void {
    this.listener = { x: l.x, y: l.y, zoom: clamp(l.zoom, 0, 1) };
  }

  /** A weapon report at a cell. `burst` rounds at the weapon's cyclic rate; `rpm` overrides that rate. */
  shot(calibre: string, x: number, y: number, opts?: { burst?: number; night?: boolean; rpm?: number }): void {
    const b = this.ready();
    if (!b) return;
    const gun = gunFor(calibre);
    const n = clamp(Math.round(opts?.burst ?? 1), 1, 64);
    // A 7.62 burst this long is a minigun (M134, 3,000 a minute).
    const every = opts?.rpm ? rpm(opts.rpm) : calibre === '7.62' && n >= 30 ? rpm(3000) : gun.every;
    this.fire(b, gun, n, every, x, y, opts?.night ?? this.night, true);
  }

  /** Impact or explosion: 'ke_hit', 'bounce', 'he', 'big', 'shell', 'rockets', 'bombs', 'mine', 'building', 'small'. */
  impact(kind: string, x: number, y: number): void {
    const b = this.ready();
    if (!b) return;
    const hit = HITS[kind] ?? HITS.he!;
    const spot = place(x, y, this.listener, hit.reach, this.night);
    const level = dB(hit.level) * spot.gain;
    if (!this.admit(level, true)) return;
    const layered = LAYERED[hit.sound];
    const v = this.chain(b, spot, dB(hit.level), hit.slap, layered?.sub);
    const t0 = b.ctx.currentTime + 0.02 + spot.delay;
    const count = hit.count ?? 1;
    const take = Math.floor(this.r() * 8);
    let last = t0;
    let ends = t0;
    for (let i = 0; i < count; i++) {
      const at = count === 1 ? t0 : t0 + (i === 0 ? 0 : this.r() * (hit.spread ?? 1));
      const rate = count === 1 ? 0.97 + this.r() * 0.06 : 0.88 + this.r() * 0.24;
      // A ripple or a stick shares one sub and one tail: every landing in full would be mud.
      const end = layered ? this.layers(b, v, hit.sound, take + i, at, rate, i === 0) : this.one(b, v, hit.sound, take + i, at, rate);
      last = Math.max(last, at);
      ends = Math.max(ends, end);
    }
    this.keep(v, level, last, ends, (ends - last) / 3);
  }

  /** Incoming artillery: a whistle that ends where it lands, `seconds` from now. */
  incoming(x: number, y: number, seconds: number): void {
    const b = this.ready();
    if (!b || !(seconds > 0)) return;
    const buf = this.buffer(b, 'whistle', 0);
    // Overhead: the air between is shorter and the shell is coming to you; no arrival delay.
    const spot = place(x, y, this.listener, 14, this.night);
    const level = dB(-8) * spot.gain;
    if (!this.admit(level, true)) return;
    const v = this.chain(b, { ...spot, cutoff: Math.min(18000, spot.cutoff * 1.6) }, dB(-8), false);
    const now = b.ctx.currentTime;
    const src = b.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(v.input);
    src.start(now + Math.max(0, seconds - buf.duration), Math.max(0, buf.duration - seconds));
    v.srcs.push(src);
    this.keep(v, level, now + seconds, now + seconds + 0.05, 0.3);
  }

  /** An engine by id, called as often as it changes: 'diesel' or 'turbine', load 0 (idle) to 1 (full). */
  engine(id: string, kind: 'diesel' | 'turbine', x: number, y: number, load: number): void {
    this.source(id, kind, x, y, (s) => {
      s.load = clamp(load, 0, 1);
    });
  }

  /** A helicopter's rotor by id: blades and rpm of the main rotor (`coaxial`: two of them, Ka-52). */
  rotor(id: string, blades: number, rpm: number, x: number, y: number, opts?: { coaxial?: boolean }): void {
    this.source(id, 'rotor', x, y, (s, fresh) => {
      s.blades = clamp(Math.round(blades), 2, 8);
      s.rpm = clamp(rpm, 60, 600);
      if (fresh) {
        s.rpm0 = s.rpm;
        s.coaxial = opts?.coaxial ?? false;
      }
    });
  }

  /** A drone by id: an FPV quadcopter's whine, or a recon UAV's buzz. */
  drone(id: string, kind: 'fpv' | 'uav', x: number, y: number): void {
    this.source(id, kind, x, y, () => undefined);
  }

  stop(id: string): void {
    const s = this.sources.get(id);
    if (!s) return;
    this.sources.delete(id);
    if (s.live) this.release(s.live, 0.15);
  }

  /** A radio call from your side; returns whether it went out (one at a time, one every 2.5 s). */
  radio(call: RadioCall, opts?: { dir?: Direction }): boolean {
    const b = this.ready();
    if (!b) return false;
    return this.desk.play(b.ctx, b.radio, b.battle, call, opts?.dir);
  }

  setRadio(on: boolean): void {
    this.desk.on = on;
    if (on) {
      fetchRadio();
      const b = this.ready();
      if (b) void this.desk.load(b.ctx);
    } else if (this.bus) this.desk.cut(this.bus.ctx.currentTime);
  }

  /** Waits for the radio clips (the audition page; the game just calls `radio`). */
  async loadRadio(): Promise<number> {
    const b = this.ready();
    if (!b) return 0;
    const bankOf = await this.desk.load(b.ctx);
    return bankOf?.clips.size ?? 0;
  }

  setNight(night: boolean): void {
    if (night === this.night) return;
    this.night = night;
    this.rebuildBed();
  }

  /** The bed under the battle: wind by biome and weather, rain, night insects, and distant fire. */
  ambience(biome: string, weather: string): void {
    this.bed = { biome, weather };
    this.rebuildBed();
  }

  /** Synthesises buffers ahead of time, one a tick, so the first shot of each does not stall a frame. */
  prepare(calibres: string[]): void {
    const keys = [...new Set(calibres.map((c) => gunFor(c).sound))];
    const step = () => {
      const k = keys.shift();
      const b = this.ready();
      if (!k || !b) return;
      const variants = (LAYERED[k] ?? SOUNDS[k])?.variants ?? 1;
      for (let i = 0; i < variants; i++) {
        if (LAYERED[k]) this.layerBuffers(b, k, i);
        else this.buffer(b, k, i);
      }
      setTimeout(step, 30);
    };
    setTimeout(step, 30);
  }

  /** Call every frame: keeps loops placed, applies doppler, ends finished sounds, runs the bed. */
  update(dt: number): void {
    if (this.disposed) return;
    const b = this.ready();
    if (!b) {
      this.silence();
      return;
    }
    if (this.silent) {
      // Unmuted: bring the loops and the bed back.
      this.silent = false;
      this.rebuildBed();
    }
    const now = b.ctx.currentTime;
    this.prune(now);
    if (now - this.lastRank > 0.25) {
      this.lastRank = now;
      this.rank(b, now);
    }
    if (now - this.lastParams > 0.05) {
      this.lastParams = now;
      for (const s of this.sources.values()) {
        this.doppler(s);
        if (s.live) this.aim(s, now);
      }
    }
    // Decay velocity estimates of sources that stopped reporting.
    for (const s of this.sources.values()) {
      const k = Math.exp(-Math.max(0, dt) * 2);
      if (now - s.seen > 0.3) {
        s.vx *= k;
        s.vy *= k;
      }
    }
    this.distant(b, now);
  }

  dispose(): void {
    if (this.disposed) return;
    this.silence();
    this.sources.clear();
    this.bed = null;
    if (this.bus) for (const n of this.bus.nodes) n.disconnect();
    this.bus = null;
    this.disposed = true;
  }

  // --- Internals ---------------------------------------------------------------------------------

  /** The graph, or null when muted, disposed or not unlocked. */
  private ready(): Buses | null {
    if (this.disposed) return null;
    const ctx = this.injected ?? (isMuted() ? null : audio());
    if (!ctx) return null;
    if (this.bus?.ctx !== ctx) {
      this.bus = this.build(ctx);
      // Decode the radio clips now, so the first call is ready when it comes.
      if (this.desk.on) void this.desk.load(ctx);
    }
    return this.bus;
  }

  private build(ctx: BaseAudioContext): Buses {
    const master = ctx.createGain();
    master.gain.value = 0.85;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.knee.value = 6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.25;
    const out = ctx.createGain();
    master.connect(limiter).connect(out).connect(ctx.destination);
    const battle = ctx.createGain();
    battle.connect(master);
    const dry = ctx.createGain();
    dry.connect(battle);
    // The echo: one convolver for everything, fed by each voice's send.
    const reverb = ctx.createGain();
    const conv = ctx.createConvolver();
    conv.buffer = this.ir(ctx);
    const wet = ctx.createGain();
    wet.gain.value = 0.9;
    reverb.connect(conv).connect(wet).connect(battle);
    // Big guns: a slap back off the terrain, then a fainter one off the next ridge.
    const slap = ctx.createGain();
    const d1 = ctx.createDelay(1);
    d1.delayTime.value = 0.24;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    const g1 = ctx.createGain();
    g1.gain.value = 0.5;
    const d2 = ctx.createDelay(1);
    d2.delayTime.value = 0.31;
    const g2 = ctx.createGain();
    g2.gain.value = 0.55;
    slap.connect(d1).connect(lp).connect(g1).connect(battle);
    g1.connect(d2).connect(g2).connect(battle);
    g2.connect(reverb);
    const amb = ctx.createGain();
    amb.connect(battle);
    const radio = ctx.createGain();
    radio.connect(master);
    return { ctx, master, out, battle, dry, reverb, slap, amb, radio, nodes: [master, limiter, out, battle, dry, reverb, conv, wet, slap, d1, lp, g1, d2, g2, amb, radio] };
  }

  private ir(ctx: BaseAudioContext): AudioBuffer {
    const sr = ctx.sampleRate;
    let buf = irs.get(sr);
    if (!buf) {
      const [l, r] = impulse(sr);
      buf = ctx.createBuffer(2, l.length, sr);
      buf.copyToChannel(l, 0);
      buf.copyToChannel(r, 1);
      irs.set(sr, buf);
    }
    return buf;
  }

  private buffer(b: Buses, key: string, take: number): AudioBuffer {
    const def = SOUNDS[key];
    const variants = def?.variants ?? 1;
    const t = take % variants;
    const sr = def?.low ? Math.min(32000, b.ctx.sampleRate) : b.ctx.sampleRate;
    const id = `${key}@${sr}#${t}`;
    let buf = bank.get(id);
    if (!buf) {
      buf = this.toBuffer(b.ctx, synth(key, sr, t), sr);
      bank.set(id, buf);
    }
    return buf;
  }

  private layerBuffers(b: Buses, key: string, take: number): { transient: AudioBuffer; body: AudioBuffer; tail: AudioBuffer; sub: AudioBuffer | null } {
    const def = LAYERED[key]!;
    const t = take % def.variants;
    const sr = def.low ? Math.min(32000, b.ctx.sampleRate) : b.ctx.sampleRate;
    const id = `${key}@${sr}#${t}`;
    let set = layerBank.get(id);
    if (!set) {
      const x = synthLayers(key, sr, t);
      set = { transient: this.toBuffer(b.ctx, x.transient, sr), body: this.toBuffer(b.ctx, x.body, sr), tail: this.toBuffer(b.ctx, x.tail, sr), sub: x.sub ? this.toBuffer(b.ctx, x.sub, sr) : null };
      layerBank.set(id, set);
    }
    return set;
  }

  /** One buffer into a voice at `at`; returns when it ends. */
  private one(b: Buses, v: Voice, key: string, take: number, at: number, rate: number): number {
    const buf = this.buffer(b, key, take);
    const src = b.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    src.connect(v.input);
    src.start(at);
    v.srcs.push(src);
    return at + buf.duration / rate;
  }

  /** A layered sound into a voice at `at` (`whole`: with its sub and tail); returns when it ends. */
  private layers(b: Buses, v: Voice, key: string, take: number, at: number, rate: number, whole: boolean): number {
    const set = this.layerBuffers(b, key, take);
    const paths = v.layers!;
    let ends = at;
    const play = (buf: AudioBuffer | null, to: AudioNode, t: number) => {
      if (!buf) return;
      const src = b.ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = rate;
      src.connect(to);
      src.start(t);
      v.srcs.push(src);
      ends = Math.max(ends, t + buf.duration / rate);
    };
    play(set.transient, paths.transient, at);
    play(set.body, v.input, at);
    if (whole) {
      play(set.tail, paths.tail, at + paths.lag);
      play(set.sub, paths.sub, at);
    }
    return ends;
  }

  private loopBuffer(b: Buses, id: string, make: (sr: number) => Samples): AudioBuffer {
    const sr = b.ctx.sampleRate;
    const key = `${id}@${sr}`;
    let buf = bank.get(key);
    if (!buf) {
      buf = this.toBuffer(b.ctx, make(sr), sr);
      bank.set(key, buf);
    }
    return buf;
  }

  private toBuffer(ctx: BaseAudioContext, data: Samples, sr: number): AudioBuffer {
    const buf = ctx.createBuffer(1, data.length, sr);
    buf.copyToChannel(data, 0);
    return buf;
  }

  private fire(b: Buses, gun: Gun, n: number, every: number, x: number, y: number, night: boolean, steal: boolean): void {
    const spot = place(x, y, this.listener, gun.reach, night);
    const level = dB(gun.level) * spot.gain;
    if (!this.admit(level, steal)) return;
    const layered = LAYERED[gun.sound];
    const v = this.chain(b, spot, dB(gun.level), gun.slap, layered?.sub);
    let at = b.ctx.currentTime + 0.02 + spot.delay;
    let ends = at;
    let last = at;
    const variants = (layered ?? SOUNDS[gun.sound])?.variants ?? 1;
    const take = Math.floor(this.r() * variants);
    for (let i = 0; i < n; i++) {
      const shots = gun.pair ? 2 : 1;
      for (let k = 0; k < shots; k++) {
        const rate = 0.97 + this.r() * 0.06;
        const t = at + k * (gun.pair ?? 0) * (0.85 + this.r() * 0.3);
        // A ripple of rockets shares the first one's sub and tail.
        const end = layered ? this.layers(b, v, gun.sound, take + i + k, t, rate, i === 0 && k === 0) : this.one(b, v, gun.sound, take + i + k, t, rate);
        last = t;
        ends = Math.max(ends, end);
      }
      at += every * (1 + (this.r() - 0.5) * 2 * gun.jitter);
    }
    this.keep(v, level, last, ends, Math.max(0.05, (ends - last) / 4));
  }

  /**
   * One voice's path: level, air absorption, pan to the dry mix, and sends to the echo. `sub`: a
   * layered sound, with its sub's level (0 for none): paths for the transient and tail weighed by
   * range, and the sub straight to the dry mix.
   */
  private chain(b: Buses, spot: Spot, level: number, slap: boolean, sub?: number): Voice {
    const c = b.ctx;
    const input = c.createGain();
    input.gain.value = level * spot.gain;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = spot.cutoff;
    lp.Q.value = 0.5;
    input.connect(lp);
    const nodes: AudioNode[] = [input, lp];
    const pan = this.panner(c, spot.pan);
    if (pan) {
      lp.connect(pan).connect(b.dry);
      nodes.push(pan);
    } else lp.connect(b.dry);
    // The echo falls off slower than the direct sound: far away, it is most of what you hear.
    const send = c.createGain();
    send.gain.value = spot.wet * Math.max(spot.gain, 0.002) ** -0.4;
    lp.connect(send).connect(b.reverb);
    nodes.push(send);
    if (slap) {
      const s = c.createGain();
      s.gain.value = 0.5 * Math.max(spot.gain, 0.002) ** -0.3;
      lp.connect(s).connect(b.slap);
      nodes.push(s);
    }
    const v: Voice = { input, nodes, srcs: [], level: 0, last: 0, tau: 0.1, ends: 0 };
    if (sub !== undefined) {
      const w = layerWeights(spot.d);
      const transient = c.createGain();
      transient.gain.value = w.transient;
      transient.connect(input);
      const tail = c.createGain();
      tail.gain.value = w.tail;
      tail.connect(input);
      const s = c.createGain();
      s.gain.value = level * sub * Math.max(spot.gain, 1e-4) ** SUB_CARRY;
      s.connect(b.dry);
      nodes.push(transient, tail, s);
      v.layers = { transient, tail, sub: s, lag: w.lag };
    }
    return v;
  }

  private panner(c: BaseAudioContext, pan: number): StereoPannerNode | null {
    if (typeof c.createStereoPanner !== 'function') return null;
    const p = c.createStereoPanner();
    p.pan.value = pan;
    return p;
  }

  private keep(v: Voice, level: number, last: number, ends: number, tau: number): void {
    v.level = level;
    v.last = last;
    v.ends = ends;
    v.tau = Math.max(0.05, tau);
    this.voices.push(v);
  }

  private loudness(v: Voice, now: number): number {
    return now <= v.last ? v.level : v.level * Math.exp(-(now - v.last) / v.tau);
  }

  private liveLoops(): number {
    let n = 0;
    for (const s of this.sources.values()) if (s.live) n++;
    return n;
  }

  /** Room for a sound of this level? Steals the quietest when full (unless `steal` is off). */
  private admit(level: number, steal: boolean): boolean {
    if (!this.bus) return false;
    const now = this.bus.ctx.currentTime;
    this.prune(now);
    const cap = MAX_VOICES - this.liveLoops() - (this.bedLive?.voices ?? 0);
    if (this.voices.length < cap) return true;
    if (!steal) return false;
    let quiet: Voice | null = null;
    let ql = Infinity;
    for (const v of this.voices) {
      const l = this.loudness(v, now);
      if (l < ql) {
        ql = l;
        quiet = v;
      }
    }
    if (!quiet || ql > level) return false;
    this.kill(quiet, now);
    return this.voices.length < cap;
  }

  private kill(v: Voice, now: number): void {
    this.voices = this.voices.filter((x) => x !== v);
    for (const g of v.layers ? [v.input, v.layers.sub] : [v.input]) {
      g.gain.cancelScheduledValues(now);
      g.gain.setTargetAtTime(0, now, 0.012);
    }
    for (const s of v.srcs) {
      try {
        s.stop(now + 0.06);
      } catch {
        // Not started yet or already stopped.
      }
    }
    v.ends = now + 0.08;
    this.dying.push(v);
  }

  private prune(now: number): void {
    const done = (v: Voice) => now > v.ends + 0.05;
    for (const v of this.voices) if (done(v)) this.drop(v);
    for (const v of this.dying) if (done(v)) this.drop(v);
    this.voices = this.voices.filter((v) => !done(v));
    this.dying = this.dying.filter((v) => !done(v));
  }

  private drop(v: Voice): void {
    for (const s of v.srcs) s.disconnect();
    for (const n of v.nodes) n.disconnect();
  }

  // --- Continuous sources -------------------------------------------------------------------------

  private source(id: string, kind: LoopKind, x: number, y: number, set: (s: Source, fresh: boolean) => void): void {
    if (this.disposed) return;
    const now = this.bus?.ctx.currentTime ?? 0;
    let s = this.sources.get(id);
    const fresh = !s || s.kind !== kind;
    if (s && fresh) this.stop(id);
    if (!s || fresh) {
      s = { id, kind, x, y, load: 0, blades: 4, rpm: 289, rpm0: 289, coaxial: false, vx: 0, vy: 0, px: x, py: y, seen: now, doppler: 1, level: 0, live: null };
      this.sources.set(id, s);
    } else {
      if (Math.hypot(x - s.x, y - s.y) > 6) {
        // A jump, not a move.
        s.vx = 0;
        s.vy = 0;
        s.px = x;
        s.py = y;
        s.seen = now;
      } else {
        const dt = now - s.seen;
        if (dt > 0.05) {
          const k = Math.min(1, dt * 5);
          s.vx += (clamp((x - s.px) / dt, -30, 30) - s.vx) * k;
          s.vy += (clamp((y - s.py) / dt, -30, 30) - s.vy) * k;
          s.px = x;
          s.py = y;
          s.seen = now;
        }
      }
      s.x = x;
      s.y = y;
    }
    set(s, fresh);
    if (fresh) {
      const b = this.ready();
      if (b) this.rank(b, b.ctx.currentTime);
    }
  }

  private doppler(s: Source): void {
    const dx = s.x - this.listener.x;
    const dy = s.y - this.listener.y;
    const d = Math.hypot(dx, dy) || 1;
    const away = (s.vx * dx + s.vy * dy) / d;
    s.doppler = clamp(SOUND_SPEED / (SOUND_SPEED + away), 0.8, 1.25);
  }

  /** Keeps the loudest MAX_LOOPS sources sounding and parks the rest. */
  private rank(b: Buses, now: number): void {
    const list = [...this.sources.values()];
    for (const s of list) {
      const def = LOOPS[s.kind];
      s.level = dB(def.level) * place(s.x, s.y, this.listener, def.reach, this.night).gain;
    }
    list.sort((p, q) => q.level - p.level || (p.id < q.id ? -1 : 1));
    list.forEach((s, i) => {
      const want = i < MAX_LOOPS && s.level > 0.0005;
      if (want && !s.live) {
        // Make room among the one-shots for a loop.
        const cap = MAX_VOICES - this.liveLoops() - 1 - (this.bedLive?.voices ?? 0);
        while (this.voices.length > Math.max(0, cap)) {
          const quiet = this.voices.reduce((a, v) => (this.loudness(v, now) < this.loudness(a, now) ? v : a));
          this.kill(quiet, now);
        }
        s.live = this.realise(b, s);
        this.aim(s, now, true);
      } else if (!want && s.live) {
        this.release(s.live, 0.3);
        s.live = null;
      }
    });
  }

  /** Places a live source: level, air, pan and echo by distance, then its own pitch and load. */
  private aim(s: Source, now: number, first = false): void {
    const live = s.live;
    if (!live) return;
    const def = LOOPS[s.kind];
    const spot = place(s.x, s.y, this.listener, def.reach, this.night);
    const tc = first ? 0.005 : 0.08;
    const set = (p: AudioParam, v: number, t = tc) => (first ? p.setValueAtTime(v, now) : p.setTargetAtTime(v, now, t));
    set(live.input.gain, dB(def.level) * spot.gain);
    set(live.lp.frequency, spot.cutoff);
    if (live.pan) set(live.pan.pan, spot.pan);
    set(live.send.gain, spot.wet * Math.max(spot.gain, 0.002) ** -0.4);
    live.set(s, now, first ? 0.005 : def.spool);
  }

  private release(live: Live, fade: number): void {
    const ctx = this.bus?.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    live.input.gain.cancelScheduledValues(now);
    live.input.gain.setTargetAtTime(0, now, fade / 4);
    for (const s of live.srcs) {
      try {
        s.stop(now + fade + 0.05);
      } catch {
        // Already stopped.
      }
    }
    const nodes = [...live.nodes, ...live.srcs];
    setTimeout(() => {
      for (const n of nodes) n.disconnect();
    }, (fade + 0.2) * 1000);
  }

  /** Builds a source's nodes. Each kind keeps its own `set` to follow load, rpm and doppler. */
  private realise(b: Buses, s: Source): Live {
    const c = b.ctx;
    const input = c.createGain();
    input.gain.value = 0;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 0.5;
    input.connect(lp);
    const pan = this.panner(c, 0);
    if (pan) lp.connect(pan).connect(b.dry);
    else lp.connect(b.dry);
    const send = c.createGain();
    lp.connect(send).connect(b.reverb);
    const nodes: AudioNode[] = [input, lp, send];
    if (pan) nodes.push(pan);
    const srcs: AudioScheduledSourceNode[] = [];
    const now = c.currentTime;

    const gain = (v: number, to: AudioNode = input) => {
      const g = c.createGain();
      g.gain.value = v;
      g.connect(to);
      nodes.push(g);
      return g;
    };
    const filt = (type: BiquadFilterType, f: number, q: number, to: AudioNode) => {
      const n = c.createBiquadFilter();
      n.type = type;
      n.frequency.value = f;
      n.Q.value = q;
      n.connect(to);
      nodes.push(n);
      return n;
    };
    const osc = (type: OscillatorType, f: number, to: AudioNode) => {
      const o = c.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.connect(to);
      o.start(now);
      srcs.push(o);
      return o;
    };
    const play = (buf: AudioBuffer, to: AudioNode, offset = 0) => {
      const src = c.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.connect(to);
      src.start(now, offset % buf.duration);
      srcs.push(src);
      return src;
    };
    const noiseBuf = this.loopBuffer(b, 'white', white);
    const trackParts = () => {
      const g = gain(0);
      const src = play(this.loopBuffer(b, 'tracks', tracks), g, this.r() * 2);
      return (load: number, t: number, tc: number) => {
        src.playbackRate.setTargetAtTime(0.45 + 1.2 * load, t, tc);
        g.gain.setTargetAtTime(0.7 * smooth(0.05, 0.5, load), t, tc);
      };
    };

    let set: Live['set'];
    if (s.kind === 'diesel') {
      const tone = filt('lowpass', 600, 0.7, input);
      const eg = gain(0.5, tone);
      const eng = play(this.loopBuffer(b, 'diesel', diesel), eg, this.r());
      // Turbocharger whine, rising with boost.
      const tg = gain(0.012);
      const turbo = osc('sine', 1900, tg);
      const tr = trackParts();
      set = (src, t, tc) => {
        const rpmNow = 720 + 1080 * src.load;
        eng.playbackRate.setTargetAtTime((rpmNow / DIESEL_RPM) * src.doppler, t, tc);
        eg.gain.setTargetAtTime(0.5 + 0.5 * src.load, t, tc);
        tone.frequency.setTargetAtTime(450 + 2200 * src.load, t, tc);
        turbo.frequency.setTargetAtTime((1900 + 1600 * src.load) * src.doppler, t, tc * 2);
        tg.gain.setTargetAtTime(0.012 + 0.02 * src.load, t, tc);
        tr(src.load, t, tc);
      };
    } else if (s.kind === 'turbine') {
      // Gas turbine (AGT1500, GTD-1250): a high whine with inharmonic partials over a broad roar.
      const wg = gain(0.08);
      const w1 = osc('sine', 2600, wg);
      const w2g = gain(0.04);
      const w2 = osc('triangle', 3913, w2g);
      const w3g = gain(0.05);
      const w3 = osc('sine', 1291, w3g);
      const rg = gain(0.35);
      const roar = filt('bandpass', 350, 0.7, rg);
      play(noiseBuf, roar, this.r() * 2);
      const hg = gain(0.06);
      const hiss = filt('highpass', 3500, 0.7, hg);
      play(noiseBuf, hiss, this.r() * 2);
      const tr = trackParts();
      set = (src, t, tc) => {
        const f = (2600 + 2000 * src.load) * src.doppler;
        w1.frequency.setTargetAtTime(f, t, tc);
        w2.frequency.setTargetAtTime(f * 1.5 + 13, t, tc);
        w3.frequency.setTargetAtTime(f * 0.5 - 9, t, tc);
        const w = 0.7 + 0.3 * src.load;
        wg.gain.setTargetAtTime(0.08 * w, t, tc);
        w2g.gain.setTargetAtTime(0.04 * w, t, tc);
        w3g.gain.setTargetAtTime(0.05 * w, t, tc);
        roar.frequency.setTargetAtTime(350 + 900 * src.load, t, tc);
        rg.gain.setTargetAtTime(0.35 + 0.6 * src.load, t, tc);
        hg.gain.setTargetAtTime(0.06 + 0.12 * src.load, t, tc);
        tr(src.load, t, Math.min(tc, 0.25));
      };
    } else if (s.kind === 'rotor') {
      const buf = this.loopBuffer(b, `rotor${s.blades}x${Math.round(s.rpm0)}`, (sr) => rotorLoop(sr, s.blades, s.rpm0));
      const mg = gain(0.8);
      const main = play(buf, mg, this.r() * buf.duration);
      // Coaxial (Ka-52): two rotors a hair apart, beating against each other.
      const second = s.coaxial ? play(buf, gain(0.7), this.r() * buf.duration) : null;
      const whg = gain(0.02);
      const wh1 = osc('sine', 1150, whg);
      const wh2 = osc('sine', 1730, whg);
      const tail = s.coaxial ? null : osc('sawtooth', ((s.blades * s.rpm0) / 60) * 4.85, filt('bandpass', 420, 1.2, gain(0.06)));
      set = (src, t, tc) => {
        const k = (src.rpm / src.rpm0) * src.doppler;
        main.playbackRate.setTargetAtTime(k, t, tc);
        second?.playbackRate.setTargetAtTime(k * 1.012, t, tc);
        wh1.frequency.setTargetAtTime(1150 * k, t, tc);
        wh2.frequency.setTargetAtTime(1730 * k, t, tc);
        tail?.frequency.setTargetAtTime(((src.blades * src.rpm) / 60) * 4.85 * src.doppler, t, tc);
      };
    } else if (s.kind === 'fpv') {
      // Four brushless motors at slightly different speeds: they beat into a buzz.
      const body = filt('bandpass', 1600, 0.9, gain(0.5));
      const motors = [0, 1, 2, 3].map((i) => osc('sawtooth', 330 * (1 + 0.013 * i), body));
      const wg = gain(0.03);
      const whine = osc('sine', 2343, wg);
      const wash = filt('bandpass', 1800, 0.7, gain(0.15));
      play(noiseBuf, wash, this.r() * 2);
      set = (src, t, tc) => {
        const speed = Math.min(1, Math.hypot(src.vx, src.vy) / 8);
        const k = src.doppler * (1 + 0.25 * speed);
        motors.forEach((m, i) => m.frequency.setTargetAtTime(330 * (1 + 0.013 * i) * k, t, tc));
        whine.frequency.setTargetAtTime(2343 * k, t, tc);
      };
    } else {
      // Recon UAV (Orlan-10, Raven): a small engine's buzz with a slow wobble.
      const body = filt('bandpass', 650, 0.8, input);
      const am = gain(0.8, body);
      const depth = c.createGain();
      depth.gain.value = 0.2;
      depth.connect(am.gain);
      nodes.push(depth);
      osc('sine', 5.3, depth);
      const b1 = osc('sawtooth', 105, am);
      const b2 = osc('sawtooth', 210.5, gain(0.5, am));
      const hiss = filt('bandpass', 1200, 0.8, gain(0.05));
      play(noiseBuf, hiss, this.r() * 2);
      set = (src, t, tc) => {
        b1.frequency.setTargetAtTime(105 * src.doppler, t, tc);
        b2.frequency.setTargetAtTime(210.5 * src.doppler, t, tc);
      };
    }
    return { input, lp, pan, send, nodes, srcs, set };
  }

  // --- The bed ---------------------------------------------------------------------------------

  private rebuildBed(): void {
    if (this.bedLive) {
      const ctx = this.bus?.ctx;
      const now = ctx?.currentTime ?? 0;
      const { nodes, srcs } = this.bedLive;
      for (const s of srcs) {
        try {
          s.stop(now + 0.5);
        } catch {
          // Already stopped.
        }
      }
      setTimeout(() => {
        for (const n of [...nodes, ...srcs]) n.disconnect();
      }, 700);
      this.bedLive = null;
    }
    const b = this.ready();
    if (!b || !this.bed) return;
    const c = b.ctx;
    const now = c.currentTime;
    const { biome, weather } = this.bed;
    const nodes: AudioNode[] = [];
    const srcs: AudioScheduledSourceNode[] = [];
    const node = <T extends AudioNode>(n: T) => {
      nodes.push(n);
      return n;
    };
    const loopSrc = (buf: AudioBuffer, to: AudioNode) => {
      const s = c.createBufferSource();
      s.buffer = buf;
      s.loop = true;
      s.connect(to);
      s.start(now, this.r() * buf.duration);
      srcs.push(s);
    };
    const lfo = (hz: number, depth: number, param: AudioParam) => {
      const o = c.createOscillator();
      o.frequency.value = hz;
      const g = node(c.createGain());
      g.gain.value = depth;
      o.connect(g).connect(param);
      o.start(now);
      srcs.push(o);
    };
    const windBy: Record<string, number> = { desert: 0.11, steppe: 0.1, winter: 0.09, temperate: 0.06, urban: 0.04 };
    const weatherBy: Record<string, number> = { clear: 1, overcast: 1.2, rain: 1.1, fog: 0.5, snow: 0.8 };
    let voices = 1;
    // Wind: low-passed noise, its colour and strength drifting in slow gusts.
    const wg = node(c.createGain());
    const wind = (windBy[biome] ?? 0.07) * (weatherBy[weather] ?? 1) * (this.night ? 0.7 : 1);
    wg.gain.value = wind;
    const wlp = node(c.createBiquadFilter());
    wlp.type = 'lowpass';
    wlp.frequency.value = weather === 'snow' ? 300 : 420;
    wlp.connect(wg).connect(b.amb);
    loopSrc(this.loopBuffer(b, 'white', white), wlp);
    lfo(0.09, 160, wlp.frequency);
    lfo(0.13, wind * 0.45, wg.gain);
    if (weather === 'rain') {
      const rg = node(c.createGain());
      rg.gain.value = 0.12;
      const hp = node(c.createBiquadFilter());
      hp.type = 'highpass';
      hp.frequency.value = 500;
      hp.connect(rg).connect(b.amb);
      loopSrc(this.loopBuffer(b, 'rain', rain), hp);
      voices++;
    }
    if (this.night && biome !== 'winter' && biome !== 'urban' && (weather === 'clear' || weather === 'overcast')) {
      const cg = node(c.createGain());
      cg.gain.value = 0.025;
      cg.connect(b.amb);
      loopSrc(this.loopBuffer(b, 'crickets', crickets), cg);
      voices++;
    }
    this.bedLive = { nodes, srcs, voices };
    this.nextDistant = now + 2 + this.r() * 4;
  }

  /** Someone else's fight beyond the field: rare, far, mostly echo. Never steals a voice. */
  private distant(b: Buses, now: number): void {
    if (!this.bedLive || now < this.nextDistant) return;
    const urban = this.bed?.biome === 'urban';
    this.nextDistant = now + (urban ? 2 : 3) + this.r() * (urban ? 5 : 7);
    const a = this.r() * 2 * Math.PI;
    const d = 60 + this.r() * 50;
    const x = this.listener.x + Math.cos(a) * d;
    const y = this.listener.y + Math.sin(a) * d;
    const pick = this.r();
    if (pick < 0.55) this.fire(b, GUNS[this.r() < 0.5 ? '7.62' : '5.56']!, 3 + Math.floor(this.r() * 6), rpm(700), x, y, this.night, false);
    else if (pick < 0.8) this.fire(b, GUNS[this.r() < 0.5 ? '152' : '155']!, 1, 1, x, y, this.night, false);
    else this.fire(b, GUNS[this.r() < 0.5 ? '120' : '125']!, 1, 1, x, y, this.night, false);
  }

  /** Muted: everything stops at once; loops, the bed and radio come back on unmute. */
  private silence(): void {
    if (this.silent) return;
    this.silent = true;
    const now = this.bus?.ctx.currentTime ?? 0;
    for (const v of [...this.voices]) this.kill(v, now);
    for (const s of this.sources.values()) {
      if (s.live) this.release(s.live, 0.02);
      s.live = null;
    }
    if (this.bedLive) {
      for (const s of this.bedLive.srcs) {
        try {
          s.stop();
        } catch {
          // Already stopped.
        }
      }
      for (const n of [...this.bedLive.nodes, ...this.bedLive.srcs]) n.disconnect();
      this.bedLive = null;
    }
    this.desk.cut(now);
    for (const v of this.dying) this.drop(v);
    this.dying = [];
  }
}

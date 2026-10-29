// Radio calls from your side: short clips made offline (tools/art/radio.py), fetched on the first
// battle, decoded once and kept for the session. One call on the net at a time.

import type { RadioCall } from '@brink/arena/v2';

export type Direction = 'front' | 'left' | 'right' | 'rear';

export interface RadioManifest {
  /** Call, then direction ('any' when the call has none), then the takes. */
  calls: Record<string, Record<string, string[]>>;
  clips: Record<string, { text: string; voice: string; seconds: number; bytes: number }>;
}

export interface RadioBank {
  manifest: RadioManifest;
  clips: Map<string, AudioBuffer>;
}

const BASE = `${import.meta.env.BASE_URL}art/radio/`;

let download: Promise<{ manifest: RadioManifest; files: Map<string, ArrayBuffer> } | null> | null = null;
let decoded: Promise<RadioBank | null> | null = null;

/** Starts the download, once a page. Needs no audio context. */
export function fetchRadio(): void {
  if (download || typeof fetch === 'undefined') return;
  download = (async () => {
    try {
      const res = await fetch(`${BASE}manifest.json`);
      if (!res.ok) return null;
      const manifest = (await res.json()) as RadioManifest;
      const names = Object.keys(manifest.clips);
      const files = new Map<string, ArrayBuffer>();
      await Promise.all(
        names.map(async (n) => {
          const r = await fetch(`${BASE}${n}`);
          if (r.ok) files.set(n, await r.arrayBuffer());
        }),
      );
      return { manifest, files };
    } catch {
      return null;
    }
  })();
}

function decode(ctx: BaseAudioContext, data: ArrayBuffer): Promise<AudioBuffer | null> {
  // The callback form: older iOS Safari has no promise from decodeAudioData.
  return new Promise((ok) => {
    try {
      const p = ctx.decodeAudioData(data, (b) => ok(b), () => ok(null));
      if (p && typeof p.catch === 'function') p.catch(() => ok(null));
    } catch {
      ok(null);
    }
  });
}

/** Decodes the clips once; an AudioBuffer plays in any context, so this is shared. */
export function radioBank(ctx: BaseAudioContext): Promise<RadioBank | null> {
  fetchRadio();
  decoded ??= (async () => {
    const got = await download;
    if (!got) return null;
    const clips = new Map<string, AudioBuffer>();
    for (const [name, data] of got.files) {
      const b = await decode(ctx, data);
      if (b) clips.set(name, b);
    }
    return { manifest: got.manifest, clips };
  })();
  return decoded;
}

/** Higher cuts in on lower. */
export const URGENCY: Record<RadioCall, number> = {
  man_down: 5,
  vehicle_hit: 5,
  air_threat: 4,
  taking_fire: 4,
  contact: 3,
  destroyed: 2,
  splash: 2,
  smoke: 1,
  dismount: 1,
  moving: 0,
};

/** Seconds between calls. Only a call more urgent than the last may come sooner. */
export const RADIO_GAP = 2.5;

interface OnAir {
  src: AudioBufferSourceNode;
  gain: GainNode;
  urgency: number;
  ends: number;
}

export class RadioDesk {
  private bank: RadioBank | null = null;
  private loading = false;
  private air: OnAir | null = null;
  private last = -Infinity;
  private lastUrgency = -1;
  private takes = new Map<string, number>();

  constructor(public on: boolean) {
    if (on) fetchRadio();
  }

  get ready(): boolean {
    return this.bank !== null;
  }

  /** Clips decoded, for the audition page. */
  get count(): number {
    return this.bank?.clips.size ?? 0;
  }

  load(ctx: BaseAudioContext): Promise<RadioBank | null> {
    if (!this.loading) {
      this.loading = true;
      void radioBank(ctx).then((b) => {
        this.bank = b;
      });
    }
    return radioBank(ctx);
  }

  /** Plays a call if the net is free (or the call is more urgent). Returns whether it went out. */
  play(ctx: BaseAudioContext, out: AudioNode, duck: GainNode, call: RadioCall, dir?: Direction): boolean {
    if (!this.on) return false;
    if (!this.bank) {
      void this.load(ctx);
      return false;
    }
    const urgency = URGENCY[call] ?? 0;
    const now = ctx.currentTime;
    const busy = this.air !== null && now < this.air.ends;
    if (busy && urgency <= this.air!.urgency) return false;
    if (!busy && now - this.last < RADIO_GAP && urgency <= this.lastUrgency) return false;
    const takes = this.pick(call, dir);
    if (takes.length === 0) return false;
    const key = `${call}:${dir ?? ''}`;
    const n = this.takes.get(key) ?? 0;
    this.takes.set(key, n + 1);
    const buf = this.bank.clips.get(takes[n % takes.length]!);
    if (!buf) return false;
    if (busy) this.cut(now);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const gain = ctx.createGain();
    gain.gain.value = 0.9;
    src.connect(gain).connect(out);
    const at = now + 0.02;
    src.start(at);
    const ends = at + buf.duration;
    // Duck the battle under the voice, then let it back up.
    duck.gain.cancelScheduledValues(now);
    duck.gain.setTargetAtTime(0.55, now, 0.04);
    duck.gain.setTargetAtTime(1, ends, 0.3);
    this.air = { src, gain, urgency, ends };
    this.last = now;
    this.lastUrgency = urgency;
    src.onended = () => {
      src.disconnect();
      gain.disconnect();
      if (this.air?.src === src) this.air = null;
    };
    return true;
  }

  private pick(call: RadioCall, dir?: Direction): string[] {
    const byDir = this.bank?.manifest.calls[call];
    if (!byDir) return [];
    return (dir && byDir[dir]) || byDir.any || byDir.front || Object.values(byDir)[0] || [];
  }

  /** Takes the call off the air with a quick fade. */
  cut(now: number): void {
    const a = this.air;
    if (!a) return;
    a.gain.gain.cancelScheduledValues(now);
    a.gain.gain.setTargetAtTime(0, now, 0.012);
    try {
      a.src.stop(now + 0.06);
    } catch {
      // Already stopped.
    }
    this.air = null;
  }
}

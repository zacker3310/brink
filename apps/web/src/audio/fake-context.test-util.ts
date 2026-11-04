// A stand-in AudioContext for the unit tests: nodes that remember what was connected and scheduled,
// params that log their automation, a clock the test moves by hand. No sound is made.

export class FakeParam {
  value: number;
  calls: [string, number, number][] = [];
  constructor(v = 0) {
    this.value = v;
  }
  private log(name: string, v: number, t: number) {
    this.calls.push([name, v, t]);
    return this;
  }
  setValueAtTime(v: number, t: number) {
    this.value = v;
    return this.log('set', v, t);
  }
  linearRampToValueAtTime(v: number, t: number) {
    this.value = v;
    return this.log('linear', v, t);
  }
  exponentialRampToValueAtTime(v: number, t: number) {
    if (!(v > 0)) throw new RangeError('exponential ramp to a non-positive value');
    this.value = v;
    return this.log('exp', v, t);
  }
  setTargetAtTime(v: number, t: number, _tc: number) {
    this.value = v;
    return this.log('target', v, t);
  }
  cancelScheduledValues(t: number) {
    return this.log('cancel', 0, t);
  }
  /** The last value it was sent to. */
  get last(): number {
    return this.value;
  }
}

export class FakeNode {
  outs: FakeNode[] = [];
  disconnected = false;
  constructor(
    readonly ctx: FakeContext,
    readonly kind: string,
  ) {
    ctx.nodes.push(this);
  }
  connect<T extends FakeNode>(n: T): T {
    this.outs.push(n);
    return n;
  }
  disconnect() {
    this.disconnected = true;
    this.outs = [];
  }
}

export class FakeGain extends FakeNode {
  gain = new FakeParam(1);
}

export class FakeSource extends FakeNode {
  started: number | null = null;
  stopped: number | null = null;
  onended: (() => void) | null = null;
  start(t = 0) {
    this.ctx.starts.push({ kind: this.kind, at: t });
    this.started = t;
  }
  stop(t = 0) {
    this.stopped = t;
  }
}

export class FakeOsc extends FakeSource {
  type = 'sine';
  frequency = new FakeParam(440);
  detune = new FakeParam(0);
}

export class FakeBufferSource extends FakeSource {
  buffer: unknown = null;
  playbackRate = new FakeParam(1);
}

export class FakeFilter extends FakeNode {
  type = 'lowpass';
  frequency = new FakeParam(350);
  Q = new FakeParam(1);
  gain = new FakeParam(0);
}

export class FakeCompressor extends FakeNode {
  threshold = new FakeParam(-24);
  knee = new FakeParam(30);
  ratio = new FakeParam(12);
  attack = new FakeParam(0.003);
  release = new FakeParam(0.25);
}

export class FakeContext {
  nodes: FakeNode[] = [];
  starts: { kind: string; at: number }[] = [];
  currentTime = 0;
  sampleRate = 8000;
  state: 'running' | 'suspended' | 'closed' = 'running';
  destination: FakeNode;
  suspends = 0;
  resumes = 0;
  constructor() {
    this.destination = new FakeNode(this, 'destination');
  }
  createGain() {
    return new FakeGain(this, 'gain');
  }
  createOscillator() {
    return new FakeOsc(this, 'osc');
  }
  createBufferSource() {
    return new FakeBufferSource(this, 'buffer');
  }
  createBiquadFilter() {
    return new FakeFilter(this, 'filter');
  }
  createDynamicsCompressor() {
    return new FakeCompressor(this, 'compressor');
  }
  createBuffer(channels: number, length: number, sampleRate: number) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { length, sampleRate, duration: length / sampleRate, numberOfChannels: channels, getChannelData: (i: number) => data[i]! };
  }
  suspend() {
    this.suspends++;
    this.state = 'suspended';
    return Promise.resolve();
  }
  resume() {
    this.resumes++;
    this.state = 'running';
    return Promise.resolve();
  }
  /** Sources started at or after `t`. */
  startsAfter(t: number): number {
    return this.starts.filter((s) => s.at >= t).length;
  }
}

export const asContext = (c: FakeContext): AudioContext => c as unknown as AudioContext;

/** A key-value store in memory. */
export function memoryStore(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return { get: (k: string) => m.get(k) ?? null, set: (k: string, v: string) => void m.set(k, v), map: m };
}

/** Timers the test fires by hand. */
export function manualTimers() {
  const live = new Set<number>();
  let n = 0;
  return {
    live,
    every: () => {
      live.add(++n);
      return n;
    },
    cancel: (h: unknown) => void live.delete(h as number),
  };
}

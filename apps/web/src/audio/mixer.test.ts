import { describe, expect, it } from 'vitest';
import { DEFAULT_LEVELS, gainOf, Mixer, parseLevels } from './mixer';
import { asContext, FakeContext, memoryStore, type FakeGain } from './fake-context.test-util';

const make = (opts: { muted?: boolean; store?: ReturnType<typeof memoryStore> } = {}) => {
  const ctx = new FakeContext();
  let made = 0;
  const mixer = new Mixer({
    create: () => {
      made++;
      return asContext(ctx);
    },
    muted: opts.muted,
    store: opts.store ?? memoryStore(),
  });
  return { ctx, mixer, made: () => made };
};

describe('gainOf', () => {
  it('is silent at zero, full at 100, squared between', () => {
    expect(gainOf(0)).toBe(0);
    expect(gainOf(-5)).toBe(0);
    expect(gainOf(Number.NaN)).toBe(0);
    expect(gainOf(100)).toBe(1);
    expect(gainOf(150)).toBe(1);
    expect(gainOf(50)).toBeCloseTo(0.25);
  });
});

describe('parseLevels', () => {
  it('falls back to the defaults for missing, broken or out-of-range entries', () => {
    expect(parseLevels(null)).toEqual(DEFAULT_LEVELS);
    expect(parseLevels('not json')).toEqual(DEFAULT_LEVELS);
    expect(parseLevels(JSON.stringify({ music: 20, sfx: 'loud', ui: 400 }))).toEqual({ ...DEFAULT_LEVELS, music: 20, ui: 100 });
  });
});

describe('Mixer', () => {
  it('makes no context while muted, and none before something asks for one', () => {
    const { mixer, made } = make({ muted: true });
    expect(made()).toBe(0);
    expect(mixer.context()).toBeNull();
    expect(mixer.bus('music')).toBeNull();
    expect(mixer.running()).toBeNull();
    expect(made()).toBe(0);
  });

  it('builds three buses into a limited master on the destination', () => {
    const { mixer, ctx } = make();
    expect(mixer.context()).toBe(ctx);
    const music = mixer.bus('music')! as unknown as FakeGain;
    const sfx = mixer.bus('sfx')! as unknown as FakeGain;
    const ui = mixer.bus('ui')! as unknown as FakeGain;
    expect(new Set([music, sfx, ui]).size).toBe(3);
    // duck -> level -> master -> limiter -> destination
    for (const bus of [music, sfx, ui]) {
      const level = bus.outs[0] as FakeGain;
      const master = level.outs[0] as FakeGain;
      expect(master.outs[0]!.kind).toBe('compressor');
      expect(master.outs[0]!.outs[0]).toBe(ctx.destination);
    }
    const level = music.outs[0] as FakeGain;
    expect(level.gain.last).toBeCloseTo(gainOf(DEFAULT_LEVELS.music));
  });

  it('refuses a bus for another context (an offline render goes straight out)', () => {
    const { mixer } = make();
    mixer.context();
    expect(mixer.bus('sfx', asContext(new FakeContext()))).toBeNull();
  });

  it('keeps the levels it is given, clamped and rounded', () => {
    const store = memoryStore();
    const { mixer } = make({ store });
    mixer.context();
    mixer.setLevel('music', 33.4);
    mixer.setLevel('ui', 140);
    expect(mixer.levels()).toMatchObject({ music: 33, ui: 100 });
    const again = new Mixer({ create: () => asContext(new FakeContext()), store });
    expect(again.levels()).toMatchObject({ music: 33, ui: 100 });
    const level = (mixer.bus('music') as unknown as FakeGain).outs[0] as FakeGain;
    expect(level.gain.last).toBeCloseTo(gainOf(33));
  });

  it('mute silences the master and suspends the context; unmute brings both back', () => {
    const { mixer, ctx } = make();
    mixer.context();
    const master = ((mixer.bus('sfx') as unknown as FakeGain).outs[0] as FakeGain).outs[0] as FakeGain;
    mixer.setMuted(true);
    expect(master.gain.last).toBe(0);
    expect(ctx.state).toBe('suspended');
    expect(mixer.context()).toBeNull();
    expect(mixer.running()).toBeNull();
    mixer.setMuted(false);
    expect(ctx.state).toBe('running');
    expect(master.gain.last).toBeCloseTo(gainOf(DEFAULT_LEVELS.master));
    expect(mixer.running()).toBe(ctx);
  });

  it('running() never starts audio: it is null until something makes the context', () => {
    const { mixer, made } = make();
    expect(mixer.running()).toBeNull();
    expect(made()).toBe(0);
    mixer.context();
    expect(mixer.running()).not.toBeNull();
  });

  it('a hidden page suspends; shown again it resumes unless muted', () => {
    const { mixer, ctx } = make();
    mixer.context();
    mixer.visible(false);
    expect(ctx.state).toBe('suspended');
    mixer.visible(true);
    expect(ctx.state).toBe('running');
    mixer.setMuted(true);
    mixer.visible(true);
    expect(ctx.state).toBe('suspended');
  });

  it('ducks a bus and lets it back up', () => {
    const { mixer } = make();
    mixer.context();
    const duck = mixer.bus('music') as unknown as FakeGain;
    mixer.duck('music', 0.6, 1);
    const targets = duck.gain.calls.filter((c) => c[0] === 'target');
    expect(targets[0]![1]).toBeCloseTo(0.4);
    expect(targets[1]![1]).toBe(1);
  });

  it('tells subscribers about changes', () => {
    const { mixer } = make();
    let n = 0;
    const off = mixer.subscribe(() => n++);
    mixer.setLevel('sfx', 10);
    mixer.setMuted(true);
    off();
    mixer.setMuted(false);
    expect(n).toBe(2);
  });

  it('a platform without Web Audio is silent, not broken', () => {
    const mixer = new Mixer({ create: () => null, store: memoryStore() });
    expect(mixer.context()).toBeNull();
    expect(mixer.bus('ui')).toBeNull();
    const throwing = new Mixer({
      create: () => {
        throw new Error('no audio');
      },
      store: memoryStore(),
    });
    expect(throwing.context()).toBeNull();
  });
});

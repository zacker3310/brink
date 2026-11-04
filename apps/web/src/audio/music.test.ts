import { describe, expect, it } from 'vitest';
import { CROSSFADE, modeFor, MusicDirector, type MixerPort } from './music';
import { barNotes, barSeconds, BPM, chordOf, layerGains, LAYERS, type Mode } from './score';
import { pickStinger, STINGERS, stingerLength, type StingerKind } from './stingers';
import { FakeContext, FakeGain, manualTimers } from './fake-context.test-util';

function rig(opts: { running?: boolean } = {}) {
  const ctx = new FakeContext();
  const bus = ctx.createGain();
  bus.connect(ctx.destination);
  let on = opts.running ?? true;
  const port: MixerPort = {
    running: () => (on ? (ctx as unknown as BaseAudioContext) : null),
    bus: () => bus as unknown as AudioNode,
  };
  const timers = manualTimers();
  const d = new MusicDirector(port, timers);
  const advance = (seconds: number, step = 0.12) => {
    for (let t = 0; t < seconds; t += step) {
      ctx.currentTime += step;
      d.tick();
    }
  };
  return { ctx, bus, d, timers, advance, setRunning: (v: boolean) => (on = v) };
}

describe('modeFor', () => {
  it('the battle takes over from any scene; off is off', () => {
    expect(modeFor('off', false)).toBe('off');
    expect(modeFor('menu', false)).toBe('planning');
    expect(modeFor('planning', false)).toBe('planning');
    expect(modeFor('planning', true)).toBe('battle');
    expect(modeFor('off', true)).toBe('battle');
  });
});

describe('layerGains', () => {
  it('the base layer always plays; the others come in, in order, as intensity rises', () => {
    for (const mode of ['planning', 'battle'] as Mode[]) {
      const ids = LAYERS[mode].map((l) => l.id);
      const calm = layerGains(mode, 0);
      expect(calm[ids[0]!]).toBeGreaterThan(0);
      for (const id of ids.slice(1)) expect(calm[id]).toBe(0);
      const full = layerGains(mode, 1);
      for (const l of LAYERS[mode]) expect(full[l.id]).toBeCloseTo(l.level);
      // Monotonic in intensity, layer by layer.
      for (const id of ids) {
        let prev = -1;
        for (let v = 0; v <= 1.0001; v += 0.05) {
          const g = layerGains(mode, v)[id]!;
          expect(g).toBeGreaterThanOrEqual(prev - 1e-9);
          prev = g;
        }
      }
    }
  });

  it('takes nonsense intensity as calm', () => {
    expect(layerGains('battle', Number.NaN)).toEqual(layerGains('battle', 0));
    expect(layerGains('battle', 7)).toEqual(layerGains('battle', 1));
  });
});

describe('the score', () => {
  it('is the same notes every time a bar comes round', () => {
    const g = layerGains('battle', 0.8);
    expect(barNotes('battle', 3, 0.8, g)).toEqual(barNotes('battle', 3, 0.8, g));
    expect(barNotes('planning', 9, 0.5, layerGains('planning', 0.5))).toEqual(barNotes('planning', 1, 0.5, layerGains('planning', 0.5)));
  });

  it('schedules nothing for a silent layer, and every note fits its bar and range', () => {
    for (const mode of ['planning', 'battle'] as Mode[]) {
      const calm = barNotes(mode, 0, 0, layerGains(mode, 0));
      expect(new Set(calm.map((n) => n.layer))).toEqual(new Set([LAYERS[mode][0]!.id]));
      for (let bar = 0; bar < 16; bar++) {
        for (const n of barNotes(mode, bar, 1, layerGains(mode, 1))) {
          expect(n.step).toBeGreaterThanOrEqual(0);
          expect(n.step).toBeLessThan(16);
          expect(n.len).toBeGreaterThan(0);
          expect(n.gain).toBeGreaterThan(0);
          expect(n.gain).toBeLessThan(0.4);
          expect(n.midi).toBeGreaterThanOrEqual(0);
          expect(n.midi).toBeLessThan(100);
        }
      }
    }
  });

  it('the tense map and the nearly-won battle change harmony', () => {
    expect(chordOf('planning', 4, 0.2)).not.toEqual(chordOf('planning', 4, 0.9));
    expect(chordOf('battle', 1, 0.3)).not.toEqual(chordOf('battle', 1, 0.9));
    expect(barSeconds('battle')).toBeCloseTo((60 / BPM.battle) * 4);
  });
});

describe('stingers', () => {
  it('every cue has notes, is short, and starts at once', () => {
    for (const k of Object.keys(STINGERS) as StingerKind[]) {
      const s = STINGERS[k];
      expect(s.notes.length).toBeGreaterThan(0);
      expect(Math.min(...s.notes.map((n) => n[0]))).toBe(0);
      expect(stingerLength(k)).toBeLessThanOrEqual(5);
      expect(s.duck).toBeGreaterThan(0);
      expect(s.duck).toBeLessThanOrEqual(1);
    }
  });

  it('picks the most important of several', () => {
    expect(pickStinger([])).toBeNull();
    expect(pickStinger(['turn', 'captured', 'promotion'])).toBe('captured');
    expect(pickStinger(['captured', 'lost'])).toBe('lost');
    expect(pickStinger(['war', 'captured', 'turn'])).toBe('war');
  });
});

describe('MusicDirector', () => {
  it('schedules nothing until the mixer has a running context', () => {
    const r = rig({ running: false });
    r.d.setScene('planning');
    r.d.setLevel(1);
    r.advance(5);
    expect(r.ctx.starts.length).toBe(0);
    r.setRunning(true);
    r.advance(1);
    expect(r.ctx.starts.length).toBeGreaterThan(0);
  });

  it('off plays nothing and stops its clock', () => {
    const r = rig();
    r.advance(2);
    expect(r.ctx.starts.length).toBe(0);
    expect(r.timers.live.size).toBe(0);
  });

  it('plays the planning score a bar ahead, and more of it as tension rises', () => {
    const calm = rig();
    calm.d.setScene('planning');
    calm.d.setLevel(0);
    calm.advance(barSeconds('planning') * 4);
    const tense = rig();
    tense.d.setScene('planning');
    tense.d.setLevel(1);
    tense.advance(barSeconds('planning') * 4);
    expect(calm.ctx.starts.length).toBeGreaterThan(0);
    expect(tense.ctx.starts.length).toBeGreaterThan(calm.ctx.starts.length * 3);
    // Nothing is scheduled further ahead than one bar and the lookahead.
    expect(Math.max(...tense.ctx.starts.map((s) => s.at))).toBeLessThan(tense.ctx.currentTime + barSeconds('planning') + 1);
    expect(tense.timers.live.size).toBe(1);
  });

  it('layer gains follow the intensity', () => {
    const r = rig();
    r.d.setScene('planning');
    r.d.setLevel(0);
    r.advance(1);
    // Every gain's last target: the layers' gains among them.
    const layerGain = () => r.ctx.nodes.filter((n): n is FakeGain => n instanceof FakeGain).map((g) => g.gain.last);
    const before = layerGain().filter((v) => v > 0.5).length;
    r.d.setLevel(1);
    r.advance(8);
    const after = layerGain().filter((v) => v > 0.5).length;
    expect(after).toBeGreaterThan(before);
  });

  it('the battle crossfades in over the map and back out when it closes', () => {
    const r = rig();
    r.d.setScene('planning');
    r.d.setLevel(0.3);
    r.advance(1);
    expect(r.d.pieces).toBe(1);
    r.d.setBattle(true, () => 0.9);
    expect(r.d.mode).toBe('battle');
    r.advance(0.5);
    expect(r.d.pieces).toBe(2);
    r.advance(CROSSFADE + 1);
    expect(r.d.pieces).toBe(1);
    r.d.setBattle(false);
    expect(r.d.mode).toBe('planning');
    r.advance(CROSSFADE + 1.5);
    expect(r.d.pieces).toBe(1);
  });

  it('the battle level comes from its source each tick', () => {
    let v = 0;
    const r = rig();
    r.d.setBattle(true, () => v);
    r.advance(barSeconds('battle') * 2);
    const quiet = r.ctx.starts.length;
    v = 1;
    r.advance(4);
    const loudStart = r.ctx.starts.length;
    r.advance(barSeconds('battle') * 2);
    expect(r.ctx.starts.length - loudStart).toBeGreaterThan(quiet * 2);
  });

  it('a stinger plays once, ducks the score, and a lesser one waits its turn', () => {
    const r = rig();
    r.d.setScene('planning');
    r.advance(0.5);
    const n0 = r.ctx.starts.length;
    expect(r.d.stinger('captured')).toBe(true);
    expect(r.ctx.starts.length).toBeGreaterThan(n0);
    // The same one again at once: dropped.
    expect(r.d.stinger('captured')).toBe(false);
    // Something smaller while it rings: dropped; something bigger: plays.
    expect(r.d.stinger('turn')).toBe(false);
    expect(r.d.stinger('victory')).toBe(true);
    r.advance(stingerLength('victory') + 0.5);
    expect(r.d.stinger('turn')).toBe(true);
  });

  it('a stinger with no running context is silent', () => {
    const r = rig({ running: false });
    expect(r.d.stinger('victory')).toBe(false);
    expect(r.ctx.starts.length).toBe(0);
  });

  it('a clock left far behind (a throttled tab) starts again from now instead of catching up', () => {
    const r = rig();
    r.d.setScene('planning');
    r.d.setLevel(0.5);
    r.advance(1);
    const n = r.ctx.starts.length;
    r.ctx.currentTime += 120;
    r.d.tick();
    // One bar's worth, not a hundred and twenty seconds of it.
    expect(r.ctx.starts.length - n).toBeLessThan(80);
    expect(Math.min(...r.ctx.starts.slice(n).map((s) => s.at))).toBeGreaterThanOrEqual(r.ctx.currentTime);
  });

  it('dispose lets it all go quiet and stops the clock', () => {
    const r = rig();
    r.d.setScene('planning');
    r.advance(1);
    r.d.dispose();
    expect(r.d.mode).toBe('off');
    expect(r.timers.live.size).toBe(0);
  });
});

import { describe, expect, it } from 'vitest';
import { STINGERS, type StingerKind } from './stingers';
import { UI_RECIPES, type UiSound } from './ui';
import { noiseBuffer, play, type Instrument } from './voices';
import { FakeContext, FakeNode, FakeSource } from './fake-context.test-util';

const INSTRUMENTS: Instrument[] = ['pad', 'pluck', 'bass', 'brass', 'strings', 'bell', 'kick', 'taiko', 'snare', 'hat', 'timpani', 'hit'];
const as = (c: FakeContext) => c as unknown as BaseAudioContext;
const out = (c: FakeContext) => new FakeNode(c, 'out') as unknown as AudioNode;

describe('voices', () => {
  it('every instrument schedules a few nodes, all stopped, and tears them down when done', () => {
    for (const inst of INSTRUMENTS) {
      const c = new FakeContext();
      // The fake throws on an exponential ramp to zero, as a real AudioParam does.
      play(as(c), out(c), inst, 1, 60, 0.5, 0.1);
      const srcs = c.nodes.filter((n): n is FakeSource => n instanceof FakeSource);
      expect(srcs.length, inst).toBeGreaterThan(0);
      expect(c.nodes.length, inst).toBeLessThanOrEqual(12);
      for (const s of srcs) {
        expect(s.started, inst).toBeGreaterThanOrEqual(1);
        expect(s.stopped, inst).not.toBeNull();
      }
      for (const s of srcs) s.onended?.();
      expect(c.nodes.filter((n) => n.kind !== 'out' && n.kind !== 'destination' && !n.disconnected).length, inst).toBe(0);
    }
  });

  it('one noise buffer a context', () => {
    const c = new FakeContext();
    expect(noiseBuffer(as(c))).toBe(noiseBuffer(as(c)));
  });

  it('every interface sound and every stinger plays on a context without throwing', () => {
    for (const k of Object.keys(UI_RECIPES) as UiSound[]) {
      const c = new FakeContext();
      UI_RECIPES[k](as(c), out(c), 0);
      expect(c.starts.length, k).toBeGreaterThan(0);
    }
    for (const k of Object.keys(STINGERS) as StingerKind[]) {
      const c = new FakeContext();
      for (const [t, inst, midi, dur, gain] of STINGERS[k].notes) play(as(c), out(c), inst, t, midi, dur, gain);
      expect(c.starts.length, k).toBeGreaterThan(0);
    }
  });
});

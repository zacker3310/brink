import { describe, expect, it } from 'vitest';
import { AMBIENT_FOR, Pacer, RatioGovernor, type SceneNeed } from './pacing';

/** Feed `n` intervals of about `ms` (a little jitter), returning the ratios it moved to. */
function feed(g: RatioGovernor, ms: number, n: number): number[] {
  const moves: number[] = [];
  for (let i = 0; i < n; i++) {
    const r = g.add(ms + ((i * 7919) % 5) * 0.2 - 0.4);
    if (r !== null) moves.push(r);
  }
  return moves;
}

describe('the pixel ratio', () => {
  it('starts at the quality cap, never above the device, and is fixed when there is no room', () => {
    expect(new RatioGovernor(3, 1.6).ratio).toBe(1.6);
    expect(new RatioGovernor(1.5, 2).ratio).toBe(1.5);
    expect(new RatioGovernor(3, 1).state).toBe('fixed');
    expect(new RatioGovernor(1, 2).state).toBe('fixed');
  });

  it('holds at 60 a second, and at a steady 30 (Low Power Mode, not a slow GPU)', () => {
    const fast = new RatioGovernor(3, 1.6);
    expect(feed(fast, 16.7, 600)).toEqual([]);
    const lowPower = new RatioGovernor(3, 1.6);
    expect(feed(lowPower, 33.3, 600)).toEqual([]);
    expect(lowPower.lowPower).toBe(true);
    expect(lowPower.ratio).toBe(1.6);
  });

  it('steps down when frames run long, faster when much too long, never under 1', () => {
    expect(feed(new RatioGovernor(3, 1.6), 25, 600)).toEqual([1.4, 1.2, 1]);
    expect(feed(new RatioGovernor(3, 2), 60, 600)).toEqual([1.6, 1.2, 1]);
  });

  it('takes pauses (a tab switch) for pauses, not frame rate; very slow frames still count', () => {
    expect(feed(new RatioGovernor(3, 1.6), 1500, 300)).toEqual([]);
    expect(feed(new RatioGovernor(3, 1.6), 600, 300)).toEqual([1.2, 1]);
  });

  it('steps back up when frames keep 60 a second, and stops climbing after turning back twice', () => {
    const g = new RatioGovernor(3, 2);
    const moves: number[] = [];
    for (let k = 0; k < 4; k++) {
      moves.push(...feed(g, 25, 70));
      moves.push(...feed(g, 16, 200));
    }
    // Down, up, down: then it stays down.
    expect(moves.slice(0, 3)).toEqual([1.8, 2, 1.8]);
    expect(g.state).toBe('frozen');
    expect(moves.slice(3).every((r, i, a) => i === 0 || r < a[i - 1]!)).toBe(true);
  });
});

describe('the render scheduler', () => {
  function clock() {
    const p = new Pacer();
    let t = 0;
    /** Animation frames at 60 Hz for `ms` with the field needing `need`: how many it drew. */
    const run = (need: SceneNeed, ms: number) => {
      let draws = 0;
      for (const end = t + ms; t < end; t += 1000 / 60) if (p.tick(t, 1 / 60, need) !== null) draws++;
      return draws;
    };
    return { p, run, now: () => t };
  }

  it('draws nothing while nothing moves', () => {
    const { p, run } = clock();
    expect(run('idle', 1000)).toBe(1);
    expect(run('idle', 10_000)).toBe(0);
    expect(p.state).toBe('idle');
  });

  it('draws every frame for playback, the camera and an interaction', () => {
    const { p, run, now } = clock();
    expect(run('playback', 1000)).toBeGreaterThanOrEqual(59);
    expect(run('camera', 1000)).toBeGreaterThanOrEqual(59);
    p.nudge(now(), 0.5);
    expect(run('idle', 1000)).toBeGreaterThanOrEqual(29);
    expect(run('idle', 1000)).toBe(0);
  });

  it('draws ambient animation 30 a second, then holds the picture after AMBIENT_FOR seconds', () => {
    const { p, run } = clock();
    run('camera', 100);
    const first = run('ambient', 1000);
    expect(first).toBeGreaterThanOrEqual(28);
    expect(first).toBeLessThanOrEqual(31);
    run('ambient', AMBIENT_FOR * 1000);
    expect(run('ambient', 5000)).toBe(0);
    expect(p.state).toBe('idle');
  });

  it('steps the scene by the time it held still, but no more than a quarter second', () => {
    const { p } = clock();
    expect(p.tick(0, 1 / 60, 'idle')).toBeCloseTo(1 / 60);
    for (let t = 16; t < 2000; t += 16) p.tick(t, 1 / 60, 'idle');
    expect(p.tick(2000, 1 / 60, 'camera')).toBe(0.25);
  });

  it('counts frames by state; lost and suspended draw none', () => {
    const { p, run, now } = clock();
    run('camera', 500);
    p.hold('suspended', now());
    expect(p.state).toBe('suspended');
    p.hold(null, now());
    run('idle', 500);
    expect(p.drawsBy.camera).toBeGreaterThan(25);
    expect(p.drawsBy.interaction).toBeGreaterThanOrEqual(1);
    expect(p.drawsBy.lost + p.drawsBy.suspended).toBe(0);
  });
});

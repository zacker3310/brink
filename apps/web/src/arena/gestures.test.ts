import { describe, expect, it } from 'vitest';
import { Gestures, HOLD_MS, HOLD_SHOW_MS, PINCH, quarterNear, RING_MIN_MS, SAME_SPOT_MS, SLOP, stackPick, TWIST, TwoFingers, type Gesture, type PointerInput } from './gestures';

// The pointer state machine, driven by synthetic pointer sequences: what is a tap, a drag, a
// long-press, a pinch, a twist and a tilt, and that nothing cut short (a cancel, a lost capture, a
// hidden page, a pointer that never sent its up) ever comes out as a tap, the one gesture that
// gives orders.

const deg = (d: number) => (d * Math.PI) / 180;
const kinds = (out: readonly Gesture[]) => out.map((g) => g.kind);
const touch = (id: number, x: number, y: number, t: number, extra: Partial<PointerInput> = {}): PointerInput => ({ id, x, y, t, kind: 'touch', button: 0, buttons: 1, primary: id === 1, ...extra });

/** Everything a run of events asked for, in order. */
function play(g: Gestures, steps: ((g: Gestures) => Gesture[])[]): Gesture[] {
  return steps.flatMap((s) => s(g));
}

describe('one finger', () => {
  it('a short, still press is a tap, after the camera is released', () => {
    const out = play(new Gestures(), [(g) => g.pointerDown(touch(1, 100, 200, 0)), (g) => g.pointerMove(touch(1, 104, 203, 60)), (g) => g.pointerUp(touch(1, 104, 203, 120))]);
    expect(kinds(out)).toEqual(['grab', 'release', 'tap']);
    expect(out.at(-1)).toEqual({ kind: 'tap', at: { x: 104, y: 203 } });
  });

  it('a press that moves past the slop drags the ground and is never a tap, even if it comes back', () => {
    const g = new Gestures();
    g.pointerDown(touch(1, 100, 200, 0));
    const out = [...g.pointerMove(touch(1, 100 + SLOP + 1, 200, 30)), ...g.pointerMove(touch(1, 100, 200, 60)), ...g.pointerUp(touch(1, 100, 200, 90))];
    expect(kinds(out)).toEqual(['pin', 'drag', 'drag', 'release']);
    // The ground is pinned where the finger was a moment before, so the drag starts without a jump.
    expect(out[0]).toEqual({ kind: 'pin', points: [{ x: 100, y: 200 }] });
    expect(out[1]).toMatchObject({ kind: 'drag', points: [{ x: 111, y: 200 }], turn: false, zoom: false });
  });

  it('a press held still shows the ring, then is a long-press, and its lift is not a tap', () => {
    const g = new Gestures();
    g.pointerDown(touch(1, 100, 200, 0));
    expect(g.tick(HOLD_SHOW_MS - 10)).toEqual([]);
    expect(g.tick(HOLD_SHOW_MS + 5)).toEqual([{ kind: 'ring', at: { x: 100, y: 200 } }]);
    expect(kinds(g.tick(HOLD_MS + 5))).toEqual(['ring', 'press']);
    // A still finger moving after the long-press drags the map (a slow page can hold a drag's
    // first move back past the hold); the lift is not a tap.
    expect(kinds(g.pointerMove(touch(1, 104, 203, HOLD_MS + 30)))).toEqual([]);
    expect(kinds(g.pointerMove(touch(1, 160, 240, HOLD_MS + 50)))).toEqual(['pin', 'drag']);
    expect(kinds(g.pointerUp(touch(1, 160, 240, HOLD_MS + 90)))).toEqual(['release']);
  });

  it('on a page too slow to tick on time, the ring still shows a moment before the long-press', () => {
    const g = new Gestures();
    g.pointerDown(touch(1, 100, 200, 0));
    // The first tick comes late, after the hold is due: the ring first, the press a moment later.
    expect(g.tick(HOLD_MS + 120)).toEqual([{ kind: 'ring', at: { x: 100, y: 200 } }]);
    expect(g.tick(HOLD_MS + 120)).toEqual([]);
    expect(g.tick(HOLD_MS + 120 + RING_MIN_MS - 1)).toEqual([]);
    expect(kinds(g.tick(HOLD_MS + 120 + RING_MIN_MS))).toEqual(['ring', 'press']);
  });

  it('a held press that moves past the slop before the hold is a drag: no long-press, no tap', () => {
    const g = new Gestures();
    g.pointerDown(touch(1, 100, 200, 0));
    g.tick(HOLD_SHOW_MS + 5);
    expect(kinds(g.pointerMove(touch(1, 100, 200 + SLOP + 2, 200)))).toEqual(['ring', 'pin', 'drag']);
    expect(g.tick(HOLD_MS + 5)).toEqual([]);
    expect(kinds(g.pointerUp(touch(1, 100, 212, HOLD_MS + 40)))).toEqual(['release']);
  });

  it('a press longer than the hold is never a tap, even when no tick came', () => {
    const g = new Gestures();
    g.pointerDown(touch(1, 100, 200, 0));
    expect(kinds(g.pointerUp(touch(1, 100, 200, HOLD_MS)))).toEqual(['release']);
  });

  it('a right-click is a long-press, a right-drag orbits', () => {
    const g = new Gestures();
    const mouse = (t: number, x: number, extra: Partial<PointerInput> = {}): PointerInput => ({ id: 9, x, y: 300, t, kind: 'mouse', button: 2, buttons: 2, primary: true, ...extra });
    g.pointerDown(mouse(0, 200));
    expect(kinds(g.pointerUp(mouse(80, 200)))).toEqual(['release', 'press']);
    g.pointerDown(mouse(200, 200));
    expect(kinds(g.pointerMove(mouse(230, 230)))).toEqual(['orbit']);
    expect(kinds(g.pointerUp(mouse(260, 230)))).toEqual(['release']);
  });

  it('a mouse moving with no button down hovers', () => {
    expect(new Gestures().pointerMove({ id: 1, x: 5, y: 6, t: 0, kind: 'mouse', buttons: 0 })).toEqual([{ kind: 'hover', at: { x: 5, y: 6 } }]);
  });
});

describe('cut short: never a tap', () => {
  it('a cancelled press', () => {
    const g = new Gestures();
    g.pointerDown(touch(1, 100, 200, 0));
    expect(kinds(g.pointerCancel(1))).toEqual(['release']);
    expect(g.pointerUp(touch(1, 100, 200, 50))).toEqual([]);
  });

  it('a press that loses its capture (the same path as a cancel), and a stray capture loss after an up', () => {
    const g = new Gestures();
    g.pointerDown(touch(1, 100, 200, 0));
    expect(kinds(g.pointerUp(touch(1, 100, 200, 40)))).toEqual(['release', 'tap']);
    // The browser sends lostpointercapture after every up: it must do nothing.
    expect(g.pointerCancel(1)).toEqual([]);
  });

  it('a page hidden mid-press, mid-hold and mid-pinch', () => {
    for (const before of [[], [(g: Gestures) => g.tick(HOLD_SHOW_MS + 5)], [(g: Gestures) => g.pointerDown(touch(2, 300, 200, 20))]]) {
      const g = new Gestures();
      g.pointerDown(touch(1, 100, 200, 0));
      for (const b of before) b(g);
      const out = g.reset();
      expect(kinds(out)).toContain('release');
      expect(kinds(out)).not.toContain('tap');
      expect(g.count).toBe(0);
      // The ups that arrive afterwards belong to nothing.
      expect(g.pointerUp(touch(1, 100, 200, 60))).toEqual([]);
      expect(g.tick(HOLD_MS + 10)).toEqual([]);
    }
  });

  it('a pointer that never sent its up is dropped when the next touch starts', () => {
    const g = new Gestures();
    g.pointerDown(touch(1, 100, 200, 0));
    // Finger 1's up was lost. A new primary touch:
    const out = g.pointerDown(touch(5, 220, 400, 1000, { primary: true }));
    expect(kinds(out)).toEqual(['release', 'grab']);
    expect(g.count).toBe(1);
    expect(kinds(g.pointerUp(touch(5, 220, 400, 1060)))).toEqual(['release', 'tap']);
  });

  it('a mouse whose up was lost ends at its next move with no button down', () => {
    const g = new Gestures();
    g.pointerDown({ id: 1, x: 10, y: 10, t: 0, kind: 'mouse', button: 0, buttons: 1, primary: true });
    expect(kinds(g.pointerMove({ id: 1, x: 12, y: 10, t: 40, kind: 'mouse', buttons: 0 }))).toEqual(['release']);
    expect(g.count).toBe(0);
  });

  it('a second finger cancels the first one tap, and neither lift is a tap', () => {
    const g = new Gestures();
    const out = play(g, [(x) => x.pointerDown(touch(1, 100, 300, 0)), (x) => x.pointerDown(touch(2, 260, 300, 30)), (x) => x.pointerUp(touch(2, 260, 300, 60)), (x) => x.pointerUp(touch(1, 100, 300, 90))]);
    expect(kinds(out)).not.toContain('tap');
    expect(kinds(out)).not.toContain('press');
    expect(kinds(out).filter((k) => k === 'release')).toHaveLength(1);
  });

  it('a second finger stops a pending long-press', () => {
    const g = new Gestures();
    g.pointerDown(touch(1, 100, 300, 0));
    g.tick(HOLD_SHOW_MS + 5);
    expect(kinds(g.pointerDown(touch(2, 260, 300, 200)))).toEqual(['ring', 'pin']);
    expect(g.tick(HOLD_MS + 5)).toEqual([]);
  });
});

describe('two fingers', () => {
  /** Two fingers 160 points apart, turned by `a` and spread by `s` about their midpoint. */
  const pair = (a: number, s: number, mx = 200, my = 400): [{ x: number; y: number }, { x: number; y: number }] => [
    { x: mx - 80 * s * Math.cos(a), y: my - 80 * s * Math.sin(a) },
    { x: mx + 80 * s * Math.cos(a), y: my + 80 * s * Math.sin(a) },
  ];
  function start() {
    const g = new Gestures();
    const [a, b] = pair(0, 1);
    g.pointerDown(touch(1, a.x, a.y, 0));
    const out = g.pointerDown(touch(2, b.x, b.y, 10));
    return { g, out };
  }
  const moveTo = (g: Gestures, a: number, s: number, t: number, mx?: number, my?: number) => {
    const [p, q] = pair(a, s, mx, my);
    return [...g.pointerMove(touch(1, p.x, p.y, t)), ...g.pointerMove(touch(2, q.x, q.y, t))];
  };
  const lastDrag = (out: Gesture[]) => out.filter((x): x is Extract<Gesture, { kind: 'drag' }> => x.kind === 'drag').at(-1)!;
  const angle = (d: Extract<Gesture, { kind: 'drag' }>) => Math.atan2(d.points[1]!.y - d.points[0]!.y, d.points[1]!.x - d.points[0]!.x);
  const spread = (d: Extract<Gesture, { kind: 'drag' }>) => Math.hypot(d.points[1]!.x - d.points[0]!.x, d.points[1]!.y - d.points[0]!.y) / 160;

  it('the second finger pins the ground under both', () => {
    expect(start().out).toEqual([{ kind: 'pin', points: pair(0, 1) }]);
  });

  it('a pinch inside the dead zone neither zooms nor turns the targets; past it, it catches up', () => {
    const { g } = start();
    // 3% apart and 6 degrees turned while dragging: the targets keep their spread and their angle.
    let d = lastDrag([...moveTo(g, deg(6), 1.03, 20, 215, 410)]);
    expect(spread(d)).toBeCloseTo(1, 6);
    expect(angle(d)).toBeCloseTo(0, 6);
    expect(d.points[0]!.x + d.points[1]!.x).toBeCloseTo(430, 6);
    // 30% apart: past twice the dead zone, the targets are the fingers.
    d = lastDrag(moveTo(g, deg(6), 1.3, 40));
    expect(spread(d)).toBeCloseTo(1.3, 6);
    expect(angle(d)).toBeCloseTo(0, 6);
    expect(Math.exp(PINCH)).toBeLessThan(1.06);
  });

  it('a twist turns the targets only past 12 degrees, never jumps, and is one to one from 24', () => {
    const { g } = start();
    let prev = 0;
    let drags = 0;
    for (let i = 1; i <= 80; i++) {
      const a = deg(i * 0.5);
      const d = lastDrag(moveTo(g, a, 1, 10 + i));
      // Inside the slop the fingers ask nothing yet.
      if (!d) continue;
      drags++;
      const got = angle(d);
      if (a <= TWIST) expect(got).toBeCloseTo(0, 6);
      if (a >= 2 * TWIST) expect(got).toBeCloseTo(a, 6);
      // Continuous: never more than twice the fingers' turn in a step.
      expect(Math.abs(got - prev)).toBeLessThanOrEqual(2 * deg(0.5) + 1e-9);
      prev = got;
    }
    expect(drags).toBeGreaterThan(60);
    // The map was turned: when the fingers lift it may settle on a quarter turn.
    g.pointerUp(touch(1, 0, 0, 200));
    expect(g.pointerUp(touch(2, 0, 0, 210))).toEqual([{ kind: 'release', twisted: true }]);
  });

  it('two fingers side by side sliding down together tilt, for the rest of the gesture', () => {
    const { g } = start();
    // Each finger's move is its own event, as on a phone: 4 points at a time.
    const out = [4, 8, 12].flatMap((dy, i) => moveTo(g, 0, 1, 20 + i, 200, 400 + dy));
    // Undecided until both fingers have moved 6 points, then tilt for every move after.
    expect(kinds(out)).toEqual(['tilt', 'tilt', 'tilt']);
    expect(out.reduce((s, x) => s + (x.kind === 'tilt' ? x.dy : 0), 0)).toBeCloseTo(12, 6);
    expect(kinds(moveTo(g, deg(20), 1.4, 40, 200, 440))).toEqual(['tilt', 'tilt']);
  });

  it('two fingers one above the other sliding down drag the map instead', () => {
    const g = new Gestures();
    g.pointerDown(touch(1, 200, 300, 0));
    g.pointerDown(touch(2, 210, 460, 10));
    const out = [...g.pointerMove(touch(1, 200, 320, 20)), ...g.pointerMove(touch(2, 210, 480, 20))];
    expect(kinds(out)).toEqual(['drag', 'drag']);
  });

  it('a finger leaving mid-gesture: the one left drags on, pinning its ground afresh', () => {
    const { g } = start();
    moveTo(g, deg(30), 1.2, 20);
    expect(kinds(g.pointerUp(touch(2, 300, 400, 30)))).toEqual([]);
    const out = g.pointerMove(touch(1, 90, 420, 40));
    expect(kinds(out)).toEqual(['pin', 'drag']);
    expect(kinds(g.pointerUp(touch(1, 90, 420, 50)))).toEqual(['release']);
  });

  it('a third finger is ignored, and when one of the two lifts the other two carry on', () => {
    const { g } = start();
    expect(kinds(g.pointerDown(touch(3, 200, 600, 20)))).toEqual([]);
    expect(kinds(g.pointerMove(touch(3, 220, 620, 30)))).toEqual([]);
    expect(kinds(g.pointerUp(touch(1, 120, 400, 40)))).toEqual(['pin']);
    // The new pair starts in its own dead zone: a small move asks nothing yet.
    expect(g.pointerMove(touch(3, 223, 622, 50))).toEqual([]);
  });

  it('a finger arriving after the other has been dragging takes over from where the camera is', () => {
    const g = new Gestures();
    g.pointerDown(touch(1, 100, 400, 0));
    g.pointerMove(touch(1, 140, 400, 20));
    const out = g.pointerDown(touch(2, 300, 400, 40));
    expect(out).toEqual([{ kind: 'pin', points: [{ x: 140, y: 400 }, { x: 300, y: 400 }] }]);
  });
});

describe('TwoFingers', () => {
  it('waits inside the slop', () => {
    const t = new TwoFingers({ x: 100, y: 100 }, { x: 200, y: 100 });
    expect(t.move({ x: 103, y: 101 }, { x: 202, y: 99 })).toEqual({ kind: 'wait' });
  });
});

describe('stacks', () => {
  const stack = ['tank', 'heli'];
  it('a first tap takes the unit nearest the finger', () => {
    expect(stackPick(stack, 'heli', { x: 100, y: 100, t: 0 }, null)).toBe('heli');
  });
  it('a second tap on the same spot steps to the next, and round again', () => {
    expect(stackPick(stack, 'heli', { x: 104, y: 98, t: 900 }, { x: 100, y: 100, t: 0, unit: 'heli' })).toBe('tank');
    expect(stackPick(stack, 'heli', { x: 101, y: 101, t: 1500 }, { x: 104, y: 98, t: 900, unit: 'tank' })).toBe('heli');
  });
  it('a tap elsewhere, a late one, or a lone unit takes the nearest', () => {
    expect(stackPick(stack, 'heli', { x: 140, y: 100, t: 500 }, { x: 100, y: 100, t: 0, unit: 'heli' })).toBe('heli');
    expect(stackPick(stack, 'heli', { x: 100, y: 100, t: SAME_SPOT_MS + 1 }, { x: 100, y: 100, t: 0, unit: 'heli' })).toBe('heli');
    expect(stackPick(['tank'], 'tank', { x: 100, y: 100, t: 10 }, { x: 100, y: 100, t: 0, unit: 'tank' })).toBe('tank');
    expect(stackPick(stack, 'heli', { x: 100, y: 100, t: 10 }, { x: 100, y: 100, t: 0, unit: 'other' })).toBe('heli');
  });
});

describe('quarter turns', () => {
  it('a heading within 10 degrees of a quarter turn settles on it, others stay', () => {
    expect(quarterNear(deg(8))).toBeCloseTo(0, 9);
    expect(quarterNear(deg(-9))).toBeCloseTo(0, 9);
    expect(quarterNear(deg(84))).toBeCloseTo(deg(90), 9);
    expect(Math.abs(quarterNear(deg(185))!)).toBeCloseTo(Math.PI, 9);
    expect(quarterNear(deg(30))).toBeNull();
    expect(quarterNear(deg(-135))).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { createScenario, TESTBED_ID } from '@brink/scenarios';
import { resolveTurn } from '@brink/simulation';
import { GameSession } from './session';

// This package builds without the DOM or node types; the test runner has both.
declare const performance: { now(): number };
declare const console: { log(...args: unknown[]): void };

// The world engine (MASTER-PLAN Phase 4): nothing assumes four powers or a 40 x 20 grid. Six AI
// powers and four minor states play ten turns of the 64 x 32 testbed without one rejected order.

describe('the six-power testbed, AI against AI', () => {
  it('plays ten turns with no rejected order', { timeout: 300_000 }, () => {
    const s = GameSession.create(TESTBED_ID, 3, null);
    let rejected = 0;
    let advanceMs = 0;
    for (let t = 0; t < 10 && !s.over; t++) {
      const t0 = performance.now();
      const r = s.advance();
      advanceMs += performance.now() - t0;
      rejected += r.events.filter((e) => e.kind === 'order_rejected').length;
    }
    expect(s.turn).toBe(11);
    expect(rejected).toBe(0);
    // Every power's army is still in the field: the war is fought, not frozen.
    const w = s.snapshot();
    expect(Object.values(w.formations).length).toBeGreaterThan(60);

    // resolveTurn alone, on the turn-11 world with every nation holding (median of five).
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      resolveTurn(w, []);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    const pacific = createScenario('pacific', 3);
    const p0 = performance.now();
    resolveTurn(pacific, []);
    const pacificMs = performance.now() - p0;
    console.log(`testbed 64x32, 6 powers: advance (AI + resolve) ${Math.round(advanceMs / 10)} ms a turn; resolveTurn ${Math.round(times[2]!)} ms (the Pacific's turn 1: ${Math.round(pacificMs)} ms)`);
  });
});

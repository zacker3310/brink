import { describe, expect, it } from 'vitest';
import { EUROPE_ID } from '@brink/scenarios';
import { invariants } from './invariants';
import { budget, endings, matchCount, play, seeds } from './play';

// Europe's AI-against-AI soak (docs/europe.md): six powers and forty minor states, the same
// invariants as every theatre between every turn, and not one order the engine refuses. A match
// takes several times a Pacific one (46 nations on 1792 hexes), so it plays `SOAK_EUROPE_MATCHES`,
// by default as many as `SOAK_MATCHES` up to 20.
const MATCHES = matchCount('SOAK_EUROPE_MATCHES', 20, 20);

describe(`Europe AI-vs-AI soak (${MATCHES} matches)`, () => {
  it('every match ends with a winner by the turn limit, with no invalid state and no rejected order', { timeout: budget(MATCHES, 240) }, () => {
    // A refused order fails the turn it was refused on, naming it (as the lane's soak did), besides
    // the total at the end.
    const t = play(EUROPE_ID, seeds(MATCHES), {
      check: invariants,
      onTurn: (events, w, seed) => expect(events.filter((e) => e.kind === 'order_rejected'), `seed ${seed} turn ${w.turn}`).toEqual([]),
    });
    const { usage } = t;
    console.log(...endings('europe ', t), 'facilities built', usage.facilities, 'treaties signed', usage.treaties, 'cards played', usage.cards, 'techs researched', usage.techs, 'sites captured', usage.captured);
    expect(t.rejected).toBe(0);
    // The AI fights the war it is given: it takes cities, plays its cards and builds.
    expect(usage.captured).toBeGreaterThan(MATCHES * 3);
    expect(usage.cards).toBeGreaterThan(MATCHES * 10);
    expect(usage.facilities).toBeGreaterThan(MATCHES);
  });
});

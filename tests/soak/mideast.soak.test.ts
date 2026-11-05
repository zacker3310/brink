import { describe, expect, it } from 'vitest';
import { MIDEAST_ID, MIDEAST_NATIONS } from '@brink/scenarios';
import { invariants } from './invariants';
import { budget, endings, matchCount, play, seeds } from './play';

// The Middle East and Africa's AI-against-AI soak (docs/mideast.md): six powers and twenty-four minor
// states on the theatre's own map, each match to its end, the world checked between every turn.
// `SOAK_MIDEAST_MATCHES` (or the lane's `MIDEAST_SOAK`) sets the count, else `SOAK_MATCHES`, else 24.
// About 30 to 60 s a match.
const MATCHES = matchCount(['SOAK_MIDEAST_MATCHES', 'MIDEAST_SOAK'], 24);

describe(`Middle East and Africa AI-vs-AI soak (${MATCHES} matches)`, () => {
  it('every match ends by the turn limit with no invalid state and no rejected AI order', { timeout: budget(MATCHES, 180) }, () => {
    const powers = new Set(MIDEAST_NATIONS.map((n) => n.id));
    const t = play(MIDEAST_ID, seeds(MATCHES), { check: invariants, onEnd: (w, seed) => expect(powers.has(w.victory!.winner), `seed ${seed}`).toBe(true) });
    const { usage } = t;
    console.log(...endings('mideast ', t), 'sites captured', usage.captured, 'facilities built', usage.facilities, 'treaties signed', usage.treaties, 'cards played', usage.cards, 'techs researched', usage.techs);
    expect(t.rejected).toBe(0);
    // The AI uses the economy, the doctrine and the diplomacy it is given, and the war moves.
    expect(usage.facilities).toBeGreaterThan(MATCHES);
    expect(usage.cards).toBeGreaterThan(MATCHES * 10);
    expect(usage.techs).toBeGreaterThan(MATCHES * 8);
    expect(usage.captured).toBeGreaterThan(MATCHES * 10);
  });
});

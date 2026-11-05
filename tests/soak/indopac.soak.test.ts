import { describe, expect, it } from 'vitest';
import { INDOPAC_ID, INDOPAC_NATIONS } from '@brink/scenarios';
import { invariants } from './invariants';
import { budget, endings, matchCount, play, seeds } from './play';

// The Indo-Pacific South, AI against AI (docs/indopac.md): five powers and fifteen minor states on
// an archipelago. Every match must end by the turn limit with no invalid state and no rejected AI
// order; the line on the console says who won, how, how often decisively, and who took what. Its
// matches are the slowest of any theatre (convoys planned across two oceans), so it plays
// `SOAK_INDOPAC_MATCHES`, else `SOAK_MATCHES` up to 20: a 100-match Pacific soak does not make it
// play 100.
const MATCHES = matchCount('SOAK_INDOPAC_MATCHES', 20);

describe(`Indo-Pacific South AI-vs-AI soak (${MATCHES} matches)`, () => {
  it('every match ends by the turn limit, with no invalid state and no rejected AI order', { timeout: budget(MATCHES, 240) }, () => {
    /** Sites each power took. */
    const captured: Record<string, number> = {};
    const t = play(INDOPAC_ID, seeds(MATCHES), {
      check: invariants,
      onTurn: (events, w) => {
        for (const e of events) if (e.kind === 'site_captured' && !w.nations[e.to]?.minor) captured[e.to] = (captured[e.to] ?? 0) + 1;
      },
    });
    console.log(...endings('indopac ', t), 'sites captured', captured, 'cards played', t.usage.cards);
    expect(t.rejected).toBe(0);
    // Every power is in the war: each takes something in the soak (Australia only by landing).
    for (const p of INDOPAC_NATIONS) expect(captured[p.id] ?? 0, p.id).toBeGreaterThan(0);
    expect(t.usage.cards).toBeGreaterThan(MATCHES * 10);
  });
});

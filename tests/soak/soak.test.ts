import { describe, expect, it } from 'vitest';
import { PACIFIC_ID } from '@brink/scenarios';
import { invariants } from './invariants';
import { budget, endings, play, seeds } from './play';

// The Pacific's AI-against-AI soak: four powers and seven minor states, every match to its end, the
// world checked between every turn, not one order the engine refuses. `SOAK_MATCHES` sets the
// count (100 by default; a match takes ten to twenty seconds).
const MATCHES = Number(process.env.SOAK_MATCHES ?? 100);

describe(`AI-vs-AI soak (${MATCHES} matches)`, () => {
  it('every match ends with a winner by the turn limit, with no invalid state', { timeout: budget(MATCHES, 60) }, () => {
    const t = play(PACIFIC_ID, seeds(MATCHES), { check: invariants });
    const { usage, generals } = t;
    console.log(...endings('', t), 'facilities built', usage.facilities, 'treaties signed', usage.treaties, 'generals promoted', generals.promoted, 'killed', generals.killed, 'top level', generals.topLevel, 'cards played', usage.cards, 'techs researched', usage.techs, 'cities grown', usage.grown);
    // The AI uses the economy and diplomacy it is given.
    expect(usage.facilities).toBeGreaterThan(MATCHES);
    expect(usage.treaties).toBeGreaterThan(MATCHES);
    expect(usage.cards).toBeGreaterThan(MATCHES * 10);
    // Every power researches down its tree, and cities grow a level or more in a match.
    expect(usage.techs).toBeGreaterThan(MATCHES * 8);
    expect(usage.grown).toBeGreaterThan(MATCHES * 4);
    expect(t.rejected).toBe(0);
    // Generals see war: they rise in rank.
    expect(generals.promoted).toBeGreaterThan(0);
  });
});

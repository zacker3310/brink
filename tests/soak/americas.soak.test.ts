import { describe, expect, it } from 'vitest';
import { UNITS } from '@brink/game-data';
import { AMERICAS_ID } from '@brink/scenarios';
import { invariants } from './invariants';
import { budget, endings, matchCount, play, seeds } from './play';

// The Americas played AI against AI to the end (docs/americas.md): six powers, fourteen minor
// states, 1312 hexes, the world checked between every turn and no AI order refused. The line on the
// console says how the war went and what the canal saw. `SOAK_AMERICAS_MATCHES` sets the count, else
// `SOAK_MATCHES`, else 24.
const MATCHES = matchCount('SOAK_AMERICAS_MATCHES', 24);

describe(`the Americas, AI against AI (${MATCHES} matches)`, () => {
  it('every match ends with a winner by the turn limit, with no invalid state and no rejected order', { timeout: budget(MATCHES, 120) }, () => {
    /** The canal: matches in which Panama City changed hands, ships that sailed through it, who held it at the end. */
    const canal = { taken: new Set<number>(), transits: 0, holders: {} as Record<string, number> };
    const t = play(AMERICAS_ID, seeds(MATCHES), {
      check: invariants,
      onTurn: (events, w, seed) => {
        const panama = Object.values(w.sites).find((x) => x.name === 'Panama City')!;
        for (const e of events) {
          if (e.kind === 'site_captured' && e.site === panama.id) canal.taken.add(seed);
          if (e.kind === 'movement' && UNITS[e.unitClass].naval && e.path.includes(panama.key)) canal.transits++;
        }
      },
      onEnd: (w) => {
        const holder = Object.values(w.sites).find((x) => x.name === 'Panama City')!.owner ?? 'nobody';
        canal.holders[holder] = (canal.holders[holder] ?? 0) + 1;
      },
    });
    const { usage } = t;
    console.log(...endings('americas ', t), 'canal taken in', canal.taken.size, 'matches, transits', canal.transits, 'held at the end by', canal.holders, 'facilities', usage.facilities, 'treaties', usage.treaties, 'cards', usage.cards, 'techs', usage.techs);
    expect(t.rejected).toBe(0);
    // The AI uses the economy, the diplomacy and the doctrine it is given here as in the Pacific.
    expect(usage.facilities).toBeGreaterThan(MATCHES);
    expect(usage.treaties).toBeGreaterThan(MATCHES);
    expect(usage.cards).toBeGreaterThan(MATCHES * 10);
    expect(usage.techs).toBeGreaterThan(MATCHES * 8);
    // The canal is fought over: somebody takes Panama City in most wars.
    expect(canal.taken.size).toBeGreaterThan(MATCHES / 2);
  });
});

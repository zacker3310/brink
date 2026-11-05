import { describe, expect, it } from 'vitest';
import { EUROPE_ID, EUROPE_MAX_TURNS } from '@brink/scenarios';
import { GameSession } from '@brink/session';
import { invariants } from './invariants';

// The European theatre's AI-against-AI soak (docs/europe.md): six powers and forty minor states, the
// same invariants as the Pacific's between every turn, and not one order the engine refuses. A match
// takes several times a Pacific one (46 nations on 1792 hexes), so it plays SOAK_EUROPE_MATCHES, by
// default as many as SOAK_MATCHES up to 20.
const MATCHES = Number(process.env.SOAK_EUROPE_MATCHES ?? Math.min(20, Number(process.env.SOAK_MATCHES ?? 20)));

describe(`Europe AI-vs-AI soak (${MATCHES} matches)`, () => {
  it('every match ends with a winner by the turn limit, with no invalid state and no rejected order', () => {
    const endings: Record<string, number> = {};
    const decisive: Record<string, number> = {};
    const onScore: Record<string, number> = {};
    const turns: number[] = [];
    let rejected = 0;
    const usage = { facilities: 0, treaties: 0, cards: 0, techs: 0, captured: 0, landings: 0 };
    for (let seed = 1; seed <= MATCHES; seed++) {
      const s = GameSession.create(EUROPE_ID, seed, null);
      let guard = 0;
      while (!s.over) {
        const r = s.advance();
        const refused = r.events.filter((e) => e.kind === 'order_rejected');
        rejected += refused.length;
        expect(refused, `seed ${seed} turn ${s.turn}`).toEqual([]);
        usage.facilities += r.events.filter((e) => e.kind === 'facility_built').length;
        usage.treaties += r.events.filter((e) => e.kind === 'treaty').length;
        usage.cards += r.events.filter((e) => e.kind === 'card_played').length;
        usage.techs += r.events.filter((e) => e.kind === 'research').length;
        usage.captured += r.events.filter((e) => e.kind === 'site_captured').length;
        const bad = invariants(s.snapshot());
        expect(bad, `seed ${seed} turn ${s.turn}`).toEqual([]);
        if (++guard > EUROPE_MAX_TURNS + 5) throw new Error(`seed ${seed} did not end`);
      }
      const v = s.snapshot().victory!;
      expect(v.turn).toBeLessThanOrEqual(EUROPE_MAX_TURNS);
      endings[v.reason] = (endings[v.reason] ?? 0) + 1;
      const tally = v.reason === 'turn_limit' ? onScore : decisive;
      tally[v.winner] = (tally[v.winner] ?? 0) + 1;
      turns.push(v.turn);
    }
    turns.sort((a, b) => a - b);
    const decisiveRate = Math.round((100 * (MATCHES - (endings.turn_limit ?? 0))) / MATCHES);
    console.log('europe endings', endings, 'decisive', `${decisiveRate}%`, 'median turn', turns[Math.floor(turns.length / 2)], 'decisive wins', decisive, 'turn-limit wins', onScore, 'rejected AI orders', rejected, 'facilities built', usage.facilities, 'treaties signed', usage.treaties, 'cards played', usage.cards, 'techs researched', usage.techs, 'sites captured', usage.captured);
    expect(rejected).toBe(0);
    // The AI fights the war it is given: it takes cities, plays its cards and builds.
    expect(usage.captured).toBeGreaterThan(MATCHES * 3);
    expect(usage.cards).toBeGreaterThan(MATCHES * 10);
    expect(usage.facilities).toBeGreaterThan(MATCHES);
  });
});

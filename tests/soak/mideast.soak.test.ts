import { describe, expect, it } from 'vitest';
import { MIDEAST_ID, MIDEAST_NATIONS } from '@brink/scenarios';
import { GameSession } from '@brink/session';
import { invariants } from './invariants';

// The Middle East and Africa soak (docs/mideast.md): AI-only matches on the theatre's own map, six
// powers and twenty-four minor states, each played to its end, the world checked between every turn.
// `MIDEAST_SOAK` sets the number of matches (else `SOAK_MATCHES`, else 24). About 30 to 60 s a match
// in a 4-core container.
const MATCHES = Number(process.env.MIDEAST_SOAK ?? process.env.SOAK_MATCHES ?? 24);

describe(`Middle East and Africa AI-vs-AI soak (${MATCHES} matches)`, () => {
  it('every match ends by the turn limit with no invalid state and no rejected AI order', () => {
    const endings: Record<string, number> = {};
    const decisive: Record<string, number> = {};
    const onScore: Record<string, number> = {};
    const turns: number[] = [];
    let rejected = 0;
    const usage = { facilities: 0, treaties: 0, cards: 0, techs: 0, captured: 0 };
    for (let seed = 1; seed <= MATCHES; seed++) {
      const s = GameSession.create(MIDEAST_ID, seed, null);
      let guard = 0;
      while (!s.over) {
        const r = s.advance();
        rejected += r.events.filter((e) => e.kind === 'order_rejected').length;
        usage.facilities += r.events.filter((e) => e.kind === 'facility_built').length;
        usage.treaties += r.events.filter((e) => e.kind === 'treaty').length;
        usage.cards += r.events.filter((e) => e.kind === 'card_played').length;
        usage.techs += r.events.filter((e) => e.kind === 'research').length;
        usage.captured += r.events.filter((e) => e.kind === 'site_captured').length;
        expect(invariants(s.snapshot()), `seed ${seed} turn ${s.turn}`).toEqual([]);
        if (++guard > 40) throw new Error(`seed ${seed} did not end`);
      }
      const v = s.snapshot().victory!;
      expect(v.turn).toBeLessThanOrEqual(30);
      expect(MIDEAST_NATIONS.map((n) => n.id)).toContain(v.winner);
      endings[v.reason] = (endings[v.reason] ?? 0) + 1;
      const tally = v.reason === 'turn_limit' ? onScore : decisive;
      tally[v.winner] = (tally[v.winner] ?? 0) + 1;
      turns.push(v.turn);
    }
    turns.sort((a, b) => a - b);
    const decided = MATCHES - (endings.turn_limit ?? 0);
    console.log('mideast endings', endings, 'decisive rate', `${Math.round((decided * 100) / MATCHES)}%`, 'median turn', turns[Math.floor(turns.length / 2)], 'decisive wins', decisive, 'turn-limit wins', onScore, 'rejected AI orders', rejected, 'sites captured', usage.captured, 'facilities built', usage.facilities, 'treaties signed', usage.treaties, 'cards played', usage.cards, 'techs researched', usage.techs);
    expect(rejected).toBe(0);
    // The AI uses the economy, the doctrine and the diplomacy it is given, and the war moves.
    expect(usage.facilities).toBeGreaterThan(MATCHES);
    expect(usage.cards).toBeGreaterThan(MATCHES * 10);
    expect(usage.techs).toBeGreaterThan(MATCHES * 8);
    expect(usage.captured).toBeGreaterThan(MATCHES * 10);
  }, 3_600_000);
});

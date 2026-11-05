import { describe, expect, it } from 'vitest';
import { PACIFIC_ID } from '@brink/scenarios';
import { GameSession } from '@brink/session';
import { invariants } from './invariants';

const MATCHES = Number(process.env.SOAK_MATCHES ?? 100);

describe(`AI-vs-AI soak (${MATCHES} matches)`, () => {
  it('every match ends with a winner by the turn limit, with no invalid state', () => {
    const endings: Record<string, number> = {};
    /** Who wins the decisive endings (not the turn limit), and who leads on score at the limit. */
    const decisive: Record<string, number> = {};
    const onScore: Record<string, number> = {};
    const turns: number[] = [];
    let rejected = 0;
    const usage = { facilities: 0, treaties: 0, cards: 0, techs: 0, grown: 0 };
    const generals = { promoted: 0, killed: 0, topLevel: 1 };
    for (let seed = 1; seed <= MATCHES; seed++) {
      const s = GameSession.create(PACIFIC_ID, seed, null);
      let guard = 0;
      while (!s.over) {
        const r = s.advance();
        rejected += r.events.filter((e) => e.kind === 'order_rejected').length;
        usage.facilities += r.events.filter((e) => e.kind === 'facility_built').length;
        usage.treaties += r.events.filter((e) => e.kind === 'treaty').length;
        generals.promoted += r.events.filter((e) => e.kind === 'commander' && e.change === 'level_up').length;
        generals.killed += r.events.filter((e) => e.kind === 'commander' && e.change === 'killed').length;
        usage.cards += r.events.filter((e) => e.kind === 'card_played').length;
        usage.techs += r.events.filter((e) => e.kind === 'research').length;
        usage.grown += r.events.filter((e) => e.kind === 'city_grew').length;
        const bad = invariants(s.snapshot());
        expect(bad, `seed ${seed} turn ${s.turn}`).toEqual([]);
        if (++guard > 40) throw new Error(`seed ${seed} did not end`);
      }
      for (const c of Object.values(s.snapshot().commanders ?? {})) generals.topLevel = Math.max(generals.topLevel, c.level);
      const v = s.snapshot().victory!;
      expect(v.turn).toBeLessThanOrEqual(30);
      endings[v.reason] = (endings[v.reason] ?? 0) + 1;
      const tally = v.reason === 'turn_limit' ? onScore : decisive;
      tally[v.winner] = (tally[v.winner] ?? 0) + 1;
      turns.push(v.turn);
    }
    turns.sort((a, b) => a - b);
    console.log('endings', endings, 'median turn', turns[Math.floor(turns.length / 2)], 'decisive wins', decisive, 'turn-limit wins', onScore, 'rejected AI orders', rejected, 'facilities built', usage.facilities, 'treaties signed', usage.treaties, 'generals promoted', generals.promoted, 'killed', generals.killed, 'top level', generals.topLevel, 'cards played', usage.cards, 'techs researched', usage.techs, 'cities grown', usage.grown);
    // The AI uses the economy and diplomacy it is given.
    expect(usage.facilities).toBeGreaterThan(MATCHES);
    expect(usage.treaties).toBeGreaterThan(MATCHES);
    expect(usage.cards).toBeGreaterThan(MATCHES * 10);
    // Every power researches down its tree, and cities grow a level or more in a match.
    expect(usage.techs).toBeGreaterThan(MATCHES * 8);
    expect(usage.grown).toBeGreaterThan(MATCHES * 4);
    expect(rejected).toBe(0);
    // Generals see war: they rise in rank.
    expect(generals.promoted).toBeGreaterThan(0);
  });
});

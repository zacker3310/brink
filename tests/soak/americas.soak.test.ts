import { describe, expect, it } from 'vitest';
import { AMERICAS_ID, AMERICAS_MAX_TURNS } from '@brink/scenarios';
import { GameSession } from '@brink/session';
import { UNITS } from '@brink/game-data';
import { invariants } from './invariants';

// The Americas played AI against AI to the end (docs/americas.md): six powers, fourteen minor
// states, 1312 hexes. Each match must end with a winner by the turn limit, with no invalid state and
// no rejected AI order. The table on the console says how the war went: who won, how often the war
// was decided before the limit, and what the canal saw.

const MATCHES = Number(process.env.SOAK_MATCHES ?? 24);

describe(`the Americas, AI against AI (${MATCHES} matches)`, () => {
  it('every match ends with a winner by the turn limit, with no invalid state and no rejected order', { timeout: 3_600_000 }, () => {
    const endings: Record<string, number> = {};
    const decisive: Record<string, number> = {};
    const onScore: Record<string, number> = {};
    const turns: number[] = [];
    let rejected = 0;
    const usage = { facilities: 0, treaties: 0, cards: 0, techs: 0 };
    /** The canal: matches in which Panama City changed hands, and ships that sailed through it. */
    const canal = { taken: 0, transits: 0, holders: {} as Record<string, number> };
    for (let seed = 1; seed <= MATCHES; seed++) {
      const s = GameSession.create(AMERICAS_ID, seed, null);
      const panama = Object.values(s.snapshot().sites).find((x) => x.name === 'Panama City')!;
      let taken = false;
      let guard = 0;
      while (!s.over) {
        const r = s.advance();
        rejected += r.events.filter((e) => e.kind === 'order_rejected').length;
        usage.facilities += r.events.filter((e) => e.kind === 'facility_built').length;
        usage.treaties += r.events.filter((e) => e.kind === 'treaty').length;
        usage.cards += r.events.filter((e) => e.kind === 'card_played').length;
        usage.techs += r.events.filter((e) => e.kind === 'research').length;
        for (const e of r.events) {
          if (e.kind === 'site_captured' && e.site === panama.id) taken = true;
          if (e.kind === 'movement' && UNITS[e.unitClass].naval && e.path.includes(panama.key)) canal.transits++;
        }
        expect(invariants(s.snapshot()), `seed ${seed} turn ${s.turn}`).toEqual([]);
        if (++guard > AMERICAS_MAX_TURNS + 10) throw new Error(`seed ${seed} did not end`);
      }
      const end = s.snapshot();
      if (taken) canal.taken++;
      const holder = end.sites[panama.id]!.owner ?? 'nobody';
      canal.holders[holder] = (canal.holders[holder] ?? 0) + 1;
      const v = end.victory!;
      expect(v.turn).toBeLessThanOrEqual(AMERICAS_MAX_TURNS);
      endings[v.reason] = (endings[v.reason] ?? 0) + 1;
      const tally = v.reason === 'turn_limit' ? onScore : decisive;
      tally[v.winner] = (tally[v.winner] ?? 0) + 1;
      turns.push(v.turn);
    }
    turns.sort((a, b) => a - b);
    const decided = MATCHES - (endings.turn_limit ?? 0);
    console.log('americas endings', endings, 'decisive rate', `${Math.round((decided * 100) / MATCHES)}%`, 'median turn', turns[Math.floor(turns.length / 2)], 'decisive wins', decisive, 'turn-limit wins', onScore, 'rejected AI orders', rejected, 'canal taken in', canal.taken, 'matches, transits', canal.transits, 'held at the end by', canal.holders, 'facilities', usage.facilities, 'treaties', usage.treaties, 'cards', usage.cards, 'techs', usage.techs);
    expect(rejected).toBe(0);
    // The AI uses the economy, the diplomacy and the doctrine it is given here as in the Pacific.
    expect(usage.facilities).toBeGreaterThan(MATCHES);
    expect(usage.treaties).toBeGreaterThan(MATCHES);
    expect(usage.cards).toBeGreaterThan(MATCHES * 10);
    expect(usage.techs).toBeGreaterThan(MATCHES * 8);
    // The canal is fought over: somebody takes Panama City in most wars.
    expect(canal.taken).toBeGreaterThan(MATCHES / 2);
  });
});

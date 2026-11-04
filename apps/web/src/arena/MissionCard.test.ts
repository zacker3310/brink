import { describe, expect, it } from 'vitest';
import { arenaResult, autoBattle, createBattle } from '@brink/arena';
import { starsEarned, STAR_RULES } from './MissionCard';
import { SKIRMISHES, skirmishRequest } from './skirmish';

// The after-action card marks each of the three star rules earned or not; together they must give
// exactly the stars the engine awards (`arenaResult`), win or lose.
describe('the after-action card', () => {
  it('earns stars rule by rule exactly as the battle counts them', () => {
    expect(STAR_RULES).toHaveLength(3);
    for (const [i, s] of SKIRMISHES.slice(0, 3).entries()) {
      const b = autoBattle(createBattle({ ...skirmishRequest(s, i).setup, seed: 101 + i }));
      const earned = starsEarned(b);
      const r = arenaResult(b);
      expect(earned.filter(Boolean).length, s.id).toBe(r.stars);
      // A loss earns nothing.
      if (!r.won) expect(earned).toEqual([false, false, false]);
    }
    // A clean win in the first round earns all three.
    const clean = createBattle(skirmishRequest(SKIRMISHES[0]!, 0).setup);
    for (const u of clean.units) if (u.side === 'red') u.alive = false;
    clean.ended = 'won';
    expect(starsEarned(clean)).toEqual([true, true, true]);
    expect(arenaResult(clean).stars).toBe(3);
  }, 120_000);
});

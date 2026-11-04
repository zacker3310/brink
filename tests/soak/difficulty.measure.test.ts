import { describe, expect, it } from 'vitest';
import type { AiMemory, Difficulty, NationId } from '@brink/contracts';
import { emptyMemory, planOrders, updateMemory } from '@brink/ai';
import { PACIFIC_ID } from '@brink/scenarios';
import { GameSession } from '@brink/session';

// How hard each difficulty is, measured with the AI's own planner in the human seat: the seat
// plays exactly as an AI would (with its own memory), but with the level's command edge and setup.
// `DIFFICULTY_MATCHES` campaigns per level (default 32), the human seat rotating over the four
// powers. `pnpm test:difficulty`. Targets: Easy 85%+, Normal about 55%, Hard 25-35%.

const MATCHES = Number(process.env.DIFFICULTY_MATCHES ?? 32);
const POWERS: NationId[] = ['china', 'japan', 'russia', 'usa'];
const LEVELS: Difficulty[] = ['easy', 'normal', 'hard'];

function campaign(seed: number, human: NationId, difficulty: Difficulty): { won: boolean; reason: string; turn: number; rejected: number } {
  const s = GameSession.create(PACIFIC_ID, seed, human, [], { difficulty });
  let memory: AiMemory = emptyMemory();
  let rejected = 0;
  let guard = 0;
  while (!s.over) {
    const orders = planOrders(s.view(human), memory, seed, { spare: [] });
    const r = s.advance(orders);
    rejected += r.events.filter((e) => e.kind === 'order_rejected').length;
    const report = s.lastReport(human);
    memory = updateMemory(memory, s.view(human), report?.events ?? []);
    if (++guard > 300) throw new Error(`seed ${seed} did not end`);
  }
  const v = s.snapshot().victory!;
  return { won: v.winner === human || (v.coalition ?? []).includes(human), reason: v.reason, turn: v.turn, rejected };
}

describe(`difficulty with the AI in the human seat (${MATCHES} campaigns a level)`, () => {
  it('reports the human win rate at each level', () => {
    const rates: Record<string, number> = {};
    let rejected = 0;
    for (const level of LEVELS) {
      let won = 0;
      const reasons: Record<string, number> = {};
      const by: Record<NationId, number> = {};
      for (let i = 0; i < MATCHES; i++) {
        const human = POWERS[i % POWERS.length]!;
        const r = campaign(1000 + Math.floor(i / POWERS.length), human, level);
        rejected += r.rejected;
        if (r.won) {
          won++;
          by[human] = (by[human] ?? 0) + 1;
          reasons[r.reason] = (reasons[r.reason] ?? 0) + 1;
        }
      }
      rates[level] = Math.round((won * 100) / MATCHES);
      console.log(level, `${rates[level]}% (${won}/${MATCHES})`, 'wins by', reasons, 'by power', by);
    }
    console.log('human win rates', rates, 'rejected orders', rejected);
    expect(rejected).toBe(0);
    // Each level is harder than the one below it.
    expect(rates.easy!).toBeGreaterThan(rates.normal!);
    expect(rates.normal!).toBeGreaterThan(rates.hard!);
  });
});

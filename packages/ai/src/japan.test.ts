import { describe, expect, it } from 'vitest';
import { createPacificScenario } from '@brink/scenarios';
import { NATION_DOCTRINES } from '@brink/game-data';
import { buildView, resolveTurn, sortedKeys } from '@brink/simulation';
import { emptyMemory, planOrders } from './index';

// Japan's signature cards (game-data `nations/japan.ts`) in the AI's hand: over a 15-turn match the
// AI plays at least one of them, and the validator refuses nothing.
describe('AI as Japan', () => {
  it('plays at least one Japanese signature card in a 15-turn match, never refused', () => {
    const signature = new Set(NATION_DOCTRINES.japan!.cards.map((c) => c.id));
    let w = createPacificScenario(2);
    const played: string[] = [];
    for (let turn = 0; turn < 15 && !w.victory; turn++) {
      const subs = sortedKeys(w.nations)
        .filter((n) => !w.nations[n]!.eliminated)
        .map((n) => planOrders(buildView(w, n), emptyMemory(), w.seed));
      const r = resolveTurn(w, subs);
      expect(r.events.filter((e) => e.kind === 'order_rejected'), `turn ${w.turn}`).toEqual([]);
      for (const e of r.events) if (e.kind === 'card_played' && e.nation === 'japan') played.push(e.card);
      w = r.world;
    }
    expect(played.filter((c) => signature.has(c)).length, played.join(', ')).toBeGreaterThan(0);
  }, 120_000); // one 15-turn match on the full map: about 8 s alone, far more on a loaded runner
});

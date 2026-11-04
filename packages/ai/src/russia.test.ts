import { describe, expect, it } from 'vitest';
import { createPacificScenario } from '@brink/scenarios';
import { NATION_DOCTRINES } from '@brink/game-data';
import { buildView, resolveTurn, sortedKeys } from '@brink/simulation';
import { emptyMemory, planOrders } from './index';

describe('Russia under the AI', () => {
  it('plays its signature cards in a 15-turn match, never refused', () => {
    const signature = new Set(NATION_DOCTRINES.russia!.cards.map((c) => c.id));
    const played: string[] = [];
    for (const seed of [1, 2]) {
      let w = createPacificScenario(seed);
      for (let turn = 0; turn < 15 && !w.victory; turn++) {
        const subs = sortedKeys(w.nations)
          .filter((n) => !w.nations[n]!.eliminated)
          .map((n) => planOrders(buildView(w, n), emptyMemory(), w.seed));
        const r = resolveTurn(w, subs);
        expect(r.events.filter((e) => e.kind === 'order_rejected'), `seed ${seed} turn ${w.turn}`).toEqual([]);
        for (const e of r.events) if (e.kind === 'card_played' && e.nation === 'russia') played.push(e.card);
        w = r.world;
      }
    }
    expect(played.filter((c) => signature.has(c)).length).toBeGreaterThan(0);
  }, 120_000);
});

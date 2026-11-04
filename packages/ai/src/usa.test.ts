import { describe, expect, it } from 'vitest';
import { createPacificScenario } from '@brink/scenarios';
import { buildView, resolveTurn, sortedKeys } from '@brink/simulation';
import { NATION_DOCTRINES } from '@brink/game-data';
import { emptyMemory, planOrders } from './index';

describe('AI: the United States doctrine', () => {
  it('plays the US signature cards in a 15-turn match, and the validator refuses none', () => {
    const signature = new Set(NATION_DOCTRINES.usa!.cards.map((c) => c.id));
    const played: string[] = [];
    let w = createPacificScenario(2);
    for (let turn = 0; turn < 15 && !w.victory; turn++) {
      const subs = sortedKeys(w.nations)
        .filter((n) => !w.nations[n]!.eliminated)
        .map((n) => planOrders(buildView(w, n), emptyMemory(), w.seed));
      const r = resolveTurn(w, subs);
      expect(r.events.filter((e) => e.kind === 'order_rejected'), `turn ${w.turn}`).toEqual([]);
      for (const e of r.events) if (e.kind === 'card_played' && e.nation === 'usa' && signature.has(e.card)) played.push(e.card);
      w = r.world;
    }
    // Seed 2 today: Global Strike, Tomahawk Salvo, Arsenal of Democracy, Carrier Strike Group twice.
    expect(played.length).toBeGreaterThan(0);
    expect(new Set(played).size).toBeGreaterThanOrEqual(2);
  }, 60_000);
});

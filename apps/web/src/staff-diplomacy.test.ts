import { describe, expect, it } from 'vitest';
import type { DiplomacyOrder, NationOrders } from '@brink/contracts';
import { PACIFIC_ID } from '@brink/scenarios';
import { GameSession } from '@brink/session';
import { staffDiplomacy } from './staff-diplomacy';

const draftOf = (s: GameSession): NationOrders => ({ nation: s.view().self.id, turn: s.turn, formations: {}, recruit: [], diplomacy: [] });

describe('the staff in the player\'s diplomacy', () => {
  it('never drafts peace or a ceasefire: it advises them, and signs only trade and pacts with powers at peace', () => {
    const s = GameSession.create(PACIFIC_ID, 4, 'usa', [], { difficulty: 'easy' });
    const view = s.view();
    const atWar = Object.keys(view.relations).find((n) => view.relations[n] === 'war' && !view.nations[n]!.minor)!;
    const atPeace = Object.keys(view.relations).find((n) => view.relations[n] === 'peace' && !view.nations[n]!.minor)!;
    const ally = Object.keys(view.relations).find((n) => view.relations[n] === 'alliance')!;
    const suggested: DiplomacyOrder[] = [
      { target: atWar, action: 'propose_peace' },
      { target: atPeace, action: 'propose_nonaggression' },
      { target: ally, action: 'propose_trade' },
    ];
    const out = staffDiplomacy(view, draftOf(s), suggested);
    expect(out.orders).toEqual([
      { target: atPeace, action: 'propose_nonaggression' },
      { target: ally, action: 'propose_trade' },
    ]);
    expect(out.advice).toEqual([{ target: atWar, action: 'propose_peace' }]);
    // Never a war, an alliance, an embargo, an ultimatum or a payment, nor trade with an enemy.
    const never: DiplomacyOrder[] = [
      { target: atPeace, action: 'declare_war' },
      { target: atPeace, action: 'propose_alliance', terms: { against: atWar } },
      { target: atPeace, action: 'embargo' },
      { target: atPeace, action: 'demand_tribute', terms: { get: { credits: 50 } } },
      { target: atPeace, action: 'pay_tribute', terms: { give: { credits: 50 } } },
      { target: atWar, action: 'propose_trade' },
      { target: atWar, action: 'propose_ceasefire' },
    ];
    for (const d of never) expect(staffDiplomacy(view, draftOf(s), [d]).orders).toEqual([]);
    // A power the player already has a move toward this turn is left alone, advice and all.
    const mine = { ...draftOf(s), diplomacy: [{ target: atWar, action: 'declare_war' as const }] };
    expect(staffDiplomacy(view, mine, suggested).advice).toEqual([]);
  });

  it('the turn after the player declares war, the staff drafts no peace with that power', () => {
    // The playtest: declare war on the power at peace; the staff's next plan must not undo it.
    const s = GameSession.create(PACIFIC_ID, 4, 'usa', [], { difficulty: 'easy' });
    const v = s.view();
    const target = Object.keys(v.relations).find((n) => v.relations[n] === 'peace' && !v.nations[n]!.minor)!;
    const r = s.advance({ ...draftOf(s), diplomacy: [{ target, action: 'declare_war' }] });
    const view = s.view();
    expect(view.relations[target]).toBe('war');
    for (let i = 0; i < 3; i++) {
      const sug = s.suggest('usa');
      const out = staffDiplomacy(view, draftOf(s), sug.diplomacy, i === 0 ? r.reports.usa : null);
      expect(out.orders.filter((d) => d.target === target)).toEqual([]);
      if (i === 0) expect(out.advice.filter((d) => d.target === target)).toEqual([]);
      for (const d of out.orders) expect(['propose_trade', 'propose_nonaggression']).toContain(d.action);
      s.advance({ ...draftOf(s), diplomacy: out.orders });
      expect(s.view().relations[target]).toBe('war');
    }
  });
});

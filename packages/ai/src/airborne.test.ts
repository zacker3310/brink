import { describe, expect, it } from 'vitest';
import type { DealTerms, NationOrders } from '@brink/contracts';
import { AIRBORNE, LEADER_TUNING, PASSAGE } from '@brink/game-data';
import { createPacificScenario } from '@brink/scenarios';
import { buildView, lockOrders, pairKey } from '@brink/simulation';
import { makeWorld, setRelation } from '../../simulation/src/fixture.test-util';
import { fundAirlifts, holdTheGates } from './airborne';
import { consider } from './diplomacy-ai';
import { emptyMemory } from './index';
import { considerPassage, passageWanted, seekPassage } from './passage';

// The AI's side of airborne warfare and right of passage (ruleset 2.9.0).

describe('passage, the leaders', () => {
  it('grants by mood, a hawk wanting more and a dove less, and more again when it will not say whom for', () => {
    const view = buildView(createPacificScenario(1), 'china');
    const yes = (mood: number, t: 'hawk' | 'dove' | 'opportunist', against?: string) => considerPassage(view, mood, t, false, against, false).accept;
    expect(yes(PASSAGE.mood.hawk, 'hawk', 'mongolia')).toBe(true);
    expect(yes(PASSAGE.mood.hawk - 1, 'hawk', 'mongolia')).toBe(false);
    expect(yes(PASSAGE.mood.dove, 'dove', 'mongolia')).toBe(true);
    expect(yes(PASSAGE.mood.opportunist, 'opportunist')).toBe(false);
    expect(yes(PASSAGE.mood.opportunist + PASSAGE.unnamed, 'opportunist')).toBe(true);
    // Never for the power its own army marches on; always for a spared human on Easy.
    expect(considerPassage(view, 100, 'dove', true, undefined, false).reason).toBe('focus');
    expect(considerPassage(view, -100, 'hawk', false, undefined, true).accept).toBe(true);
  });

  it('refuses passage toward a friend: an ally is never marched on through its land', () => {
    const w = createPacificScenario(1);
    w.relations[pairKey('china', 'usa')] = 'peace';
    w.relations[pairKey('china', 'russia')] = 'alliance';
    const view = buildView(w, 'china');
    // However warm toward the asker, toward its ally Russia the answer is no.
    expect(consider(view, emptyMemory(), { from: 'usa', kind: 'passage', terms: { against: 'russia' } }).accept).toBe(false);
    expect(considerPassage(view, 100, 'dove', false, 'russia', false)).toEqual({ accept: false, reason: 'likes_target' });
    // At war, it cannot even be asked.
    w.relations[pairKey('china', 'usa')] = 'war';
    expect(consider(buildView(w, 'china'), emptyMemory(), { from: 'usa', kind: 'passage' })).toEqual({ accept: false, reason: 'cannot' });
  });

  it('counts a sweetener as goodwill, up to a cap; never buys passage toward a friend; a request that asks to be paid is refused on terms', () => {
    // Ruleset 2.11.0: passage is a deal like an alliance, and may carry resources paid on signing.
    const w = makeWorld(8, 6, ['a', 'b', 'c']);
    setRelation(w, 'a', 'b', 'peace');
    setRelation(w, 'a', 'c', 'war');
    setRelation(w, 'b', 'c', 'peace');
    w.nations.b!.government = 'directorate'; // a hawk: it wants PASSAGE.mood.hawk
    const view = buildView(w, 'b');
    const att = (n: 'a' | 'c', mood: number) => ({ ...view.attitudes![n]!, mood, reasons: [] });
    const ask = (moodA: number, terms: DealTerms, moodC = 0) => consider({ ...view, attitudes: { a: att('a', moodA), c: att('c', moodC) } }, emptyMemory(), { from: 'a', kind: 'passage', terms });
    const bar = PASSAGE.mood.hawk;
    // 100 credits, held at par (500 in the bank), is worth 10 points of mood.
    expect(ask(bar - 5, { against: 'c' })).toEqual({ accept: false, reason: 'mood' });
    expect(ask(bar - 5, { against: 'c', give: { credits: 100 } })).toEqual({ accept: true, reason: 'agreed' });
    // The cap: however much is offered, it counts PASSAGE.sweetenerMax at most.
    expect(ask(bar - PASSAGE.sweetenerMax - 1, { against: 'c', give: { credits: 400 } })).toEqual({ accept: false, reason: 'mood' });
    expect(ask(bar - PASSAGE.sweetenerMax, { against: 'c', give: { credits: 400 } })).toEqual({ accept: true, reason: 'agreed' });
    // Toward a power it likes, no price will do; asking it to pay is a matter of terms.
    expect(ask(100, { against: 'c', give: { credits: 400 } }, LEADER_TUNING.stances.neutral + 1)).toEqual({ accept: false, reason: 'likes_target' });
    expect(ask(100, { against: 'c', get: { credits: 50 } })).toEqual({ accept: false, reason: 'terms' });
  });

  it('asks the power at peace whose land lies across the way to its objective, and the engine takes the request', () => {
    const w = createPacificScenario(1);
    // Russia at peace with China; the objective Pyongyang lies beyond China's Manchuria.
    w.relations[pairKey('china', 'russia')] = 'peace';
    const view = buildView(w, 'russia');
    const pyongyang = Object.values(w.sites).find((s) => s.name === 'Pyongyang')!;
    const memory = { ...emptyMemory(), objective: pyongyang.id };
    const want = passageWanted(view, memory)!;
    expect(want).not.toBeNull();
    {
      expect(want.target).toBe('china');
      expect(want.against).toBe('nkorea');
      // Every third turn at most; find the turn it asks.
      const base: NationOrders = { nation: 'russia', turn: w.turn, formations: {}, recruit: [], diplomacy: [] };
      let asked = 0;
      for (let t = 0; t < 3; t++) {
        const v = { ...view, turn: view.turn + t };
        const out = seekPassage(v, memory, { ...base, turn: v.turn });
        if (out.diplomacy.length === 0) continue;
        expect(out.diplomacy).toEqual([{ target: 'china', action: 'propose_passage', terms: { against: 'nkorea' } }]);
        const w2 = { ...w, turn: v.turn };
        expect(lockOrders(w2, [out]).rejected).toEqual([]);
        asked++;
      }
      expect(asked).toBe(1);
    }
    // Nothing to ask when the way is open (at war, the land is no one's to grant).
    w.relations[pairKey('china', 'russia')] = 'war';
    expect(passageWanted(buildView(w, 'russia'), memory)).toBeNull();
  });
});

describe('airborne, the staff', () => {
  it('pays for its lifts: recruits give way to the fuel, then the lifts are grounded, never refused', () => {
    const w = createPacificScenario(1);
    const view = buildView(w, 'usa');
    const marine = Object.values(view.formations).find((f) => f.unitClass === 'infantry' && f.aboard)!;
    const orders: NationOrders = { nation: 'usa', turn: 1, formations: { [marine.id]: { type: 'airlift', target: '1,1' } }, recruit: [{ siteId: 'x', unitClass: 'infantry' }], diplomacy: [] };
    const poor = { ...view, self: { ...view.self, stockpile: { ...view.self.stockpile, credits: AIRBORNE.cost.credits + 10 } } };
    const funded = fundAirlifts(poor, orders);
    expect(funded.recruit).toEqual([]);
    expect(funded.formations[marine.id]).toEqual({ type: 'airlift', target: '1,1' });
    const broke = { ...view, self: { ...view.self, stockpile: { ...view.self.stockpile, credits: AIRBORNE.cost.credits - 1 } } };
    expect(fundAirlifts(broke, orders).formations[marine.id]).toEqual({ type: 'hold' });
  });

  it('makes no peace with the power at the prize\'s gates while an airborne operation is under way', () => {
    const w = createPacificScenario(1);
    const view = buildView(w, 'usa');
    const ub = Object.values(w.sites).find((s) => s.name === 'Ulaanbaatar')!;
    const orders: NationOrders = { nation: 'usa', turn: 1, formations: {}, recruit: [], diplomacy: [{ target: 'china', action: 'propose_peace' }, { target: 'japan', action: 'propose_peace' }] };
    expect(holdTheGates(view, orders, ub.id).diplomacy).toEqual([{ target: 'japan', action: 'propose_peace' }]);
    // No airborne operation, no restraint.
    expect(holdTheGates(view, orders, undefined)).toBe(orders);
  });
});

import { describe, expect, it } from 'vitest';
import type { NationOrders, NationView } from '@brink/contracts';
import { proposeOperations } from '@brink/ai';
import { CARDS, NATION_BLURB } from '@brink/game-data';
import { createScenario, PACIFIC_ID } from '@brink/scenarios';
import { buildView, checkTarget, lockOrders } from '@brink/simulation';
import { commanderNote, suggestedPost } from './generals';
import { cardTargets, operationSpot } from './opspot';

const view = (nation = 'china'): NationView => buildView(createScenario(PACIFIC_ID, 1), nation);

describe('what the map points at', () => {
  it('rings a port or a beach for an amphibious operation, never the prize itself', () => {
    const v = view();
    for (const op of proposeOperations(v, 4)) {
      const spot = operationSpot(v, op);
      if (!spot) continue;
      expect(spot.key).not.toBe(op.at);
      expect(['BUILD LIFT', 'ASSEMBLE', 'EMBARK', 'LAND HERE']).toContain(spot.label);
      expect(v.tiles[spot.key]).toBeDefined();
    }
  });

  it('marks only hexes the engine would take for an armed card', () => {
    const v = view();
    for (const card of v.self.doctrine?.hand ?? []) {
      const def = CARDS[card]!;
      const keys = cardTargets(v, card);
      if (def.target === 'none' || def.target === 'nation') expect(keys).toEqual([]);
      for (const k of keys) expect(checkTarget(v, v.self.id, { card, target: k })).toBeNull();
      if (def.target === 'own-hex') expect(keys.length).toBeGreaterThan(0);
    }
  });
});

describe('generals and blurbs in words', () => {
  it('suggests a free land formation for a reserve general, and the plan is accepted', () => {
    const w = createScenario(PACIFIC_ID, 1);
    const v = buildView(w, 'china');
    const fid = suggestedPost(v, null)!;
    expect(fid).toBeTruthy();
    const orders: NationOrders = { nation: 'china', turn: v.turn, formations: {}, recruit: [], diplomacy: [], commanders: { assign: [{ commander: 'china-gen-1', formation: fid }] } };
    expect(lockOrders(w, [orders]).rejected).toEqual([]);
    // Once posted there, the next suggestion is another formation.
    expect(suggestedPost(v, orders)).not.toBe(fid);
  });

  it('words promotions, wounds and deaths, and stays quiet about a recall the player ordered', () => {
    const v = view();
    const base = { kind: 'commander', nation: 'china', commander: 'china-gen-1', name: 'Lin Haoyu' } as const;
    expect(commanderNote(v, { ...base, change: 'level_up', level: 2 })?.title).toBe('Lin Haoyu promoted');
    expect(commanderNote(v, { ...base, change: 'wounded', formation: Object.keys(v.formations)[0] })?.tone).toBe('bad');
    expect(commanderNote(v, { ...base, change: 'killed', formation: 'gone' })?.title).toBe('Lin Haoyu killed in action');
    expect(commanderNote(v, { ...base, change: 'relieved' })).toBeNull();
    expect(commanderNote(v, { ...base, change: 'relieved', formation: 'gone' })?.title).toBe('Lin Haoyu escaped');
  });

  it('has a blurb for each of the four powers', () => {
    for (const id of ['china', 'japan', 'russia', 'usa']) expect(NATION_BLURB[id]!.length).toBeGreaterThan(40);
  });
});

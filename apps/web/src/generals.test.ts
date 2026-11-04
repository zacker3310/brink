import { describe, expect, it } from 'vitest';
import type { NationOrders, NationView, WorldState } from '@brink/contracts';
import { RANKS, rankOf } from '@brink/arena';
import { createScenario, PACIFIC_ID } from '@brink/scenarios';
import { buildView, lockOrders } from '@brink/simulation';
import { battleFor } from './arena/battle';
import { leaderAfter, postings, withPosting, xpProgress } from './generals';

const world = (): WorldState => createScenario(PACIFIC_ID, 3);
const draftOf = (view: NationView, assign: NonNullable<NationOrders['commanders']>['assign'] = []): NationOrders => ({ nation: view.self.id, turn: view.turn, formations: {}, recruit: [], diplomacy: [], commanders: { assign } });
const landUnits = (view: NationView) =>
  Object.values(view.formations)
    .filter((f) => f.unitClass === 'infantry' || f.unitClass === 'armor')
    .map((f) => f.id)
    .sort();

describe('generals in the planner', () => {
  it('posts a general, relieving whoever would lead that formation, and the validator accepts the plan', () => {
    const w = world();
    const [f1, f2] = landUnits(buildView(w, 'usa'));
    w.commanders!['usa-gen-2']!.formation = f1!;
    const view = buildView(w, 'usa');
    // usa-gen-1 to f1: usa-gen-2 is relieved in the same plan.
    let assign = withPosting(view, draftOf(view), 'usa-gen-1', f1!);
    expect(assign).toEqual([
      { commander: 'usa-gen-1', formation: f1 },
      { commander: 'usa-gen-2', formation: null },
    ]);
    // Then usa-gen-2 to f2, and back: a posting to where a general already is drops out.
    assign = withPosting(view, draftOf(view, assign), 'usa-gen-2', f2!);
    expect(postings(view, draftOf(view, assign))).toMatchObject({ 'usa-gen-1': f1, 'usa-gen-2': f2 });
    expect(leaderAfter(view, draftOf(view, assign), f1!)).toMatchObject({ general: { id: 'usa-gen-1' }, incoming: true });
    expect(lockOrders(w, [draftOf(view, assign)]).rejected).toEqual([]);
    expect(withPosting(view, draftOf(view), 'usa-gen-2', f1!)).toEqual([]);
    expect(xpProgress({ level: 1, xp: 3 })).toEqual([3, 6]);
    expect(xpProgress({ level: 5, xp: 99 })).toBeNull();
  });

  it('a formation led by a general fights a rank higher in the arena, and the brief names the general', () => {
    const w = world();
    const view0 = buildView(w, 'usa');
    const [fid] = landUnits(view0);
    const f = view0.formations[fid!]!;
    // An enemy contact next door, as the planner would see it.
    const view = (lead: boolean): NationView => {
      const ww = structuredClone(w);
      if (lead) ww.commanders!['usa-gen-1']!.formation = fid!;
      const v = buildView(ww, 'usa');
      v.contacts.x = { formation: 'x', owner: 'russia', unitClass: 'infantry', key: '0,0', estimatedStrength: 800, confirmed: true, lastSeen: v.turn };
      v.relations.russia = 'war';
      return v;
    };
    const order = { [fid!]: { type: 'attack' as const, target: '0,0', path: [] } };
    const plain = battleFor(view(false), '0,0', order)!;
    const led = battleFor(view(true), '0,0', order)!;
    expect(plain.setup.attackers[0]!.rank).toBe(rankOf(f.experience));
    expect(led.setup.attackers[0]!.rank).toBe(Math.min(RANKS.length - 1, rankOf(f.experience) + 1));
    expect(led.title).toContain(w.commanders!['usa-gen-1']!.name);
    expect(plain.title).not.toContain(w.commanders!['usa-gen-1']!.name);
  });
});

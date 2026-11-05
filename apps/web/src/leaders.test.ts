import { describe, expect, it } from 'vitest';
import type { NationView } from '@brink/contracts';
import { PACIFIC_ID } from '@brink/scenarios';
import { GameSession } from '@brink/session';
import { blockedText, refusalText } from './leaders';
import { diplomacyBlocked } from './rules-view';

const why = (view: NationView, n: string, action: Parameters<typeof diplomacyBlocked>[2], terms?: Parameters<typeof diplomacyBlocked>[3]) => blockedText(view, n, action, terms, diplomacyBlocked(view, n, action, terms));

describe('diplomacy in plain words', () => {
  it('says peace comes first on Normal, where every power is at war with every other', () => {
    const view = GameSession.create(PACIFIC_ID, 4, 'usa', [], { difficulty: 'normal' }).view();
    expect(view.relations.japan).toBe('war');
    expect(why(view, 'japan', 'propose_alliance', { against: 'china' })).toBe('Make peace with Japan first');
    expect(why(view, 'japan', 'propose_trade')).toBe('Make peace with Japan first');
    expect(why(view, 'japan', 'propose_peace')).toBeNull();
  });

  it('says why a joint operation cannot be had: whose city it is, and who fights whom', () => {
    const view = GameSession.create(PACIFIC_ID, 4, 'usa', [], { difficulty: 'easy' }).view();
    const shanghai = Object.values(view.sites).find((s) => s.name === 'Shanghai')!;
    expect(view.relations.russia).toBe('peace');
    expect(view.relations.china).toBe('war');
    // You fight China: Russia can be asked, whether or not it fights China itself.
    expect(why(view, 'russia', 'propose_joint_op', { site: shanghai.id })).toBeNull();
    // A Chinese city when neither of you fights China.
    const calm: NationView = { ...view, relations: { ...view.relations, china: 'peace' }, publicRelations: { ...view.publicRelations, 'china|russia': 'peace', 'china|usa': 'peace' } };
    expect(why(calm, 'russia', 'propose_joint_op', { site: shanghai.id })).toBe("Shanghai isn't held by a power you or Russia are fighting");
    // A city of the power you are talking to.
    const moscow = Object.values(view.sites).find((s) => s.owner === 'russia' && s.kind === 'capital')!;
    expect(why(view, 'japan', 'propose_joint_op', { site: moscow.id })).toBeNull();
    expect(why(view, 'russia', 'propose_joint_op', { site: moscow.id })).toBe(`${moscow.name} is Russia's`);
    // A pact with the holder forbids it.
    const bound: NationView = { ...view, treaties: [...view.treaties, { kind: 'nonaggression', a: 'china', b: 'russia', from: view.turn, until: view.turn + 5 }] };
    expect(why(bound, 'russia', 'propose_joint_op', { site: shanghai.id })).toBe('Russia has a non-aggression pact with China');
  });

  it('says why a leader refused', () => {
    const view = GameSession.create(PACIFIC_ID, 4, 'usa', [], { difficulty: 'easy' }).view();
    expect(refusalText(view, 'japan', 'likes_target', 'alliance', { against: 'china' })).toBe("Japan won't start a war with China for you: they like China.");
    expect(refusalText(view, 'japan', 'stretched', 'alliance', { against: 'china' })).toBe('Japan has wars enough on its hands to take on China too.');
    expect(refusalText(view, 'japan', 'terms', 'joint_op', { site: Object.values(view.sites).find((s) => s.name === 'Shanghai')!.id })).toContain('add a sweetener');
    expect(refusalText(view, 'japan', 'mood', 'alliance')).toMatch(/^Japan does not trust you enough for that \(mood [+-]?\d+\)\.$/);
  });

  it('says why right of passage cannot be had, or was refused, in plain words', () => {
    const normal = GameSession.create(PACIFIC_ID, 4, 'usa', [], { difficulty: 'normal' }).view();
    expect(why(normal, 'japan', 'propose_passage')).toBe('Make peace with Japan first');
    const view = GameSession.create(PACIFIC_ID, 4, 'usa', [], { difficulty: 'easy' }).view();
    expect(view.relations.russia).toBe('peace');
    expect(why(view, 'russia', 'propose_passage', { against: 'china', give: { credits: 100 } })).toBeNull();
    const allied: NationView = { ...view, relations: { ...view.relations, russia: 'alliance' } };
    expect(why(allied, 'russia', 'propose_passage')).toBe('Russia is an ally: its ground is already open to you');
    const granted: NationView = { ...view, treaties: [...view.treaties, { kind: 'passage', a: 'russia', b: 'usa', from: view.turn, until: view.turn + 5 }] };
    expect(why(granted, 'russia', 'propose_passage')).toBe('Passage through Russia is already granted');
    expect(refusalText(view, 'russia', 'likes_target', 'passage', { against: 'china' })).toBe("Russia won't open its land to an army bound for China: they like China.");
    expect(refusalText(view, 'russia', 'mood', 'passage')).toMatch(/^Russia does not trust you enough to let your army through \(mood [+-]?\d+\): say whom it is for, or sweeten it\.$/);
    expect(refusalText(view, 'russia', 'mood', 'passage', { against: 'china' })).toMatch(/a sweetener may do it\.$/);
    expect(refusalText(view, 'russia', 'focus', 'passage')).toBe("Russia's army is set on you: it lets no army of yours through.");
    expect(refusalText(view, 'russia', 'terms', 'passage', { get: { credits: 50 } })).toBe("Russia won't pay you for the favour of letting your army through.");
  });
});

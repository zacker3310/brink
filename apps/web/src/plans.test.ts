import { describe, expect, it } from 'vitest';
import type { Contact, Formation, NationView, UnitClass } from '@brink/contracts';
import { proposeOperations } from '@brink/ai';
import { createPacificScenario } from '@brink/scenarios';
import { buildView } from '@brink/simulation';
import { keyDistance } from '@brink/map';
import { fightsFor, holdOrders, nextStep, proposePlans } from './plans';

// Plans are drawn from the systems already there; these pin what they offer and what they do.

describe('proposePlans', () => {
  const view = buildView(createPacificScenario(1), 'china');

  it('offers the staff operations, ranked as the staff ranks them, and at most the asked number', () => {
    const plans = proposePlans(view, { max: 5 });
    const ops = proposeOperations(view, 4).map((o) => `op:${o.id}`);
    expect(plans.length).toBeGreaterThan(0);
    expect(plans.length).toBeLessThanOrEqual(5);
    expect(plans.filter((p) => p.kind === 'operation').map((p) => p.id)).toEqual(ops.filter((id) => plans.some((p) => p.id === id)));
    for (const p of plans) {
      expect(p.title).not.toBe('');
      expect(p.line).not.toBe('');
      expect(p.cta).not.toBe('');
    }
    // An operation's line gives its turns and its odds.
    const op = plans.find((p) => p.kind === 'operation')!;
    expect(op.line).toMatch(/~\d+ turns? · (likely win|even fight|likely loss|garrison unseen) · \d+ VP/);
    expect(proposePlans(view, { max: 2 }).length).toBeLessThanOrEqual(2);
  });

  it('does not offer the running operation again', () => {
    const first = proposePlans(view).find((p) => p.kind === 'operation')!;
    expect(proposePlans(view, { operation: { id: first.operation!.id } }).some((p) => p.id === first.id)).toBe(false);
  });

  it('offers the staff plan only when it is off', () => {
    expect(proposePlans(view, { staffPlan: true, max: 8 }).some((p) => p.kind === 'staff')).toBe(false);
    expect(proposePlans(view, { staffPlan: false, max: 8 }).some((p) => p.kind === 'staff')).toBe(true);
  });

  it('never asks to hold a city against a minor state\'s militia, which holds its own ground', () => {
    // Turn one: China borders Mongolia's militia; nobody is marching on Beijing.
    expect(proposePlans(view, { max: 8 }).some((p) => p.kind === 'hold')).toBe(false);
  });
});

function front(): NationView {
  const view = buildView(createPacificScenario(1), 'japan');
  const template = Object.values(view.formations)[0]!;
  const own = (id: string, unitClass: UnitClass, key: string): Formation => ({ ...template, id, name: id, unitClass, key, strength: 1000 });
  const foe = (formation: string, owner: string, unitClass: UnitClass, key: string, estimatedStrength = 800): Contact => ({ formation, owner, unitClass, key, estimatedStrength, confirmed: true, lastSeen: view.turn });
  view.relations = { ...view.relations, china: 'war', russia: 'war' };
  const tokyo = view.sites['japan-capital']!;
  view.formations = Object.fromEntries([own('a', 'infantry', tokyo.key), own('b', 'infantry', '10,11'), own('c', 'armor', '10,11'), own('d', 'infantry', '20,20'), own('e', 'infantry', '20,21')].map((f) => [f.id, f]));
  view.contacts = Object.fromEntries(
    [foe('g1', 'china', 'infantry', '10,10'), foe('g2', 'china', 'infantry', '10,12', 200), foe('r1', 'russia', 'infantry', '20,22'), foe('r2', 'russia', 'armor', '21,21')].map((c) => [c.formation, c]),
  );
  return view;
}

describe('fightsFor', () => {
  it('lists every attack with enemies to fight, best odds first, and nothing without one', () => {
    const view = front();
    expect(fightsFor(view, { formations: {} })).toEqual([]);
    expect(fightsFor(view, { formations: { b: { type: 'move', path: [] } } })).toEqual([]);
    const formations = {
      b: { type: 'attack' as const, target: '10,10', path: [] },
      c: { type: 'attack' as const, target: '10,12', path: [] },
    };
    const list = fightsFor(view, { formations });
    expect(list.map((f) => f.target).sort()).toEqual(['10,10', '10,12']);
    const rank = { good: 0, even: 1, bad: 2 } as const;
    for (let i = 1; i < list.length; i++) expect(rank[list[i - 1]!.odds ?? 'bad']).toBeLessThanOrEqual(rank[list[i]!.odds ?? 'bad']);
    // A battle fought by hand this turn is not offered again.
    const fought = fightsFor(view, { formations, battles: [{ target: '10,10', attackers: ['b'], defenders: [], kept: {}, won: true }] });
    expect(fought.map((f) => f.target)).toEqual(['10,12']);
  });
});

describe('peace and hold plans', () => {
  it('offers peace with a second enemy, counting the divisions it frees, never with the operation\'s target', () => {
    const view = front();
    const peace = proposePlans(view, { max: 8 }).filter((p) => p.kind === 'peace');
    expect(peace.map((p) => [p.peace!.nation, p.peace!.frees])).toEqual([['russia', 2]]);
    for (const p of peace) expect(p.peace!.frees).toBeGreaterThanOrEqual(2);
    // Refused this turn: not offered again.
    for (const p of peace) expect(proposePlans(view, { max: 8, refused: [p.peace!.nation] }).some((x) => x.id === p.id)).toBe(false);
  });

  it('puts a capital with an enemy army at its gates first, digging in who stands there', () => {
    const view = front();
    const tokyo = view.sites['japan-capital']!;
    const gate = Object.keys(view.tiles).sort().find((k) => keyDistance(k, tokyo.key) === 1)!;
    view.contacts.siege = { formation: 'siege', owner: 'china', unitClass: 'armor', key: gate, estimatedStrength: 900, confirmed: true, lastSeen: view.turn };
    const [first] = proposePlans(view, { max: 8 });
    expect(first?.id).toBe('hold:japan-capital');
    expect(first?.hold?.formations).toEqual(['a']);
  });

  it('a hold digs in every unit it names that is still there', () => {
    expect(holdOrders(front(), { site: 'x', formations: ['a', 'gone'] })).toEqual({ a: { type: 'defend' } });
  });
});

describe('nextStep', () => {
  it('says the running operation\'s current phase in words, and nothing without one', () => {
    const view = buildView(createPacificScenario(1), 'china');
    expect(nextStep(view, null)).toBeNull();
    const op = proposeOperations(view, 1)[0]!;
    const step = nextStep(view, { id: op.id, kind: op.kind });
    expect(step?.text.length).toBeGreaterThan(10);
  });
});

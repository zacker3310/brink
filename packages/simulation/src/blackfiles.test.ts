import { describe, expect, it } from 'vitest';
import type { WorldState } from '@brink/contracts';
import { BLACK_FILES, RULESET_VERSION, TECHS, visitorsBars, VISITORS_BARS } from '@brink/game-data';
import { hexKey } from '@brink/map';
import { accordOpen, dormantVisitors, newBlackFiles } from './blackfiles';
import { makeWorld, orders, setRelation, site, unit } from './fixture.test-util';
import { buildView, computeVision, totalVictoryPoints } from './fog';
import { resolveTurn } from './resolve';
import { checkDiplomacy, checkResearch, lockOrders } from './validate';
import { evaluateVictory } from './victory';

const k = hexKey;

/** Three powers on a 12 x 8 field, a dig in the middle, a black site of a's, the Visitors asleep under (9,4). */
function blackWorld(over: { wakeAt?: number; wakeTurn?: number | null } = {}): WorldState {
  const w = makeWorld(12, 8, ['a', 'b', 'c']);
  // No victory points on the anomalies: three powers level at a third each, so no turn here ends the war.
  site(w, 'dig', k(5, 3), null, 'objective', 0).anomaly = 'excavation';
  site(w, 'lab', k(1, 1), 'a', 'objective', 0).anomaly = 'blacksite';
  dormantVisitors(w);
  w.blackFiles = newBlackFiles(w, { wakeAt: over.wakeAt ?? 5, wakeTurn: over.wakeTurn ?? null, incursions: [{ key: k(9, 4), name: 'The Test Lattice' }] });
  return w;
}

const turn = (w: WorldState, subs = [orders(w, 'a')]) => resolveTurn(w, subs);

describe('excavations and artefacts', () => {
  it('a power that holds a dig three turns running digs out an artefact, told to everyone', () => {
    let w = blackWorld();
    unit(w, 'a1', 'a', 'infantry', k(5, 3));
    let found = 0;
    for (let t = 0; t < BLACK_FILES.digTurns; t++) {
      const r = turn(w);
      w = r.world;
      found += r.events.filter((e) => e.kind === 'black_files' && e.what === 'artefact').length;
      // Not before the third turn held.
      if (t < BLACK_FILES.digTurns - 1) expect(w.blackFiles!.artefacts.a ?? 0).toBe(0);
      // A rival is told when it comes out of the ice.
      if (t === BLACK_FILES.digTurns - 1) expect(r.reports.b!.events.some((e) => e.kind === 'black_files' && e.what === 'artefact' && e.nation === 'a')).toBe(true);
    }
    expect(found).toBe(1);
    expect(w.blackFiles!.artefacts.a).toBe(1);
    expect(w.blackFiles!.excavated).toBe(1);
    expect(w.blackFiles!.digs.dig).toMatchObject({ holder: 'a', turns: 0, left: BLACK_FILES.digYield - 1 });
  });

  it('a dig that changes hands starts over, and an empty one yields nothing more', () => {
    let w = blackWorld();
    w.sites.dig!.owner = 'a';
    w.tiles[k(5, 3)]!.owner = 'a';
    w = turn(w).world;
    w = turn(w).world;
    expect(w.blackFiles!.digs.dig!.turns).toBe(2);
    w.sites.dig!.owner = 'b';
    w.tiles[k(5, 3)]!.owner = 'b';
    w = turn(w).world;
    expect(w.blackFiles!.digs.dig).toMatchObject({ holder: 'b', turns: 1 });
    w.blackFiles!.digs.dig!.left = 0;
    for (let i = 0; i < 4; i++) w = turn(w).world;
    expect(w.blackFiles!.artefacts.b ?? 0).toBe(0);
  });
});

describe('the reverse-engineered branch', () => {
  const black = Object.keys(TECHS).filter((t) => TECHS[t]!.artefact);

  it('is five technologies in its own branch, each needing an artefact', () => {
    expect(black.sort()).toEqual(['antigrav_lift', 'cloaked_drones', 'point_defence', 'quantum_radar', 'railguns']);
    for (const t of black) expect(TECHS[t]!.branch).toBe('black');
  });

  it('is started only at a black site with an artefact, which the finished project uses up', () => {
    let w = blackWorld();
    expect(checkResearch(w, 'a', 'railguns')).toMatch(/artefact/);
    expect(checkResearch(w, 'b', 'railguns')).toMatch(/black site/);
    w.blackFiles!.artefacts.a = 1;
    expect(checkResearch(w, 'a', 'railguns')).toBeNull();
    // A campaign without the Black Files has nothing to study.
    const plain = makeWorld();
    expect(checkResearch(plain, 'a', 'railguns')).toMatch(/nothing to reverse-engineer/);
    w.nations.a!.research.progress = TECHS.railguns!.cost;
    const r = turn(w, [orders(w, 'a', {}, { research: 'railguns' })]);
    w = r.world;
    expect(r.events.filter((e) => e.kind === 'order_rejected')).toEqual([]);
    expect(w.nations.a!.research.unlocked).toContain('railguns');
    expect(w.blackFiles!.artefacts.a ?? 0).toBe(0);
    expect(r.reports.a!.events.some((e) => e.kind === 'black_files' && e.what === 'studied' && e.tech === 'railguns')).toBe(true);
    expect(r.reports.b!.events.some((e) => e.kind === 'black_files' && e.what === 'studied')).toBe(false);
  });

  it('a project whose artefact is gone by the time it finishes is dropped, its points banked', () => {
    let w = blackWorld();
    w.nations.a!.research.current = 'point_defence';
    w.nations.a!.research.progress = TECHS.point_defence!.cost;
    w = turn(w).world;
    expect(w.nations.a!.research.unlocked).not.toContain('point_defence');
    expect(w.nations.a!.research.current).toBeNull();
  });

  it('is hidden from rivals until it leaks; a black site taken leaks it and seizes an artefact', () => {
    let w = blackWorld();
    w.nations.a!.research.unlocked = ['railguns'];
    w.blackFiles!.artefacts.a = 2;
    expect(buildView(w, 'a').blackFiles!.blackTechs.a).toEqual(['railguns']);
    expect(buildView(w, 'b').blackFiles!.blackTechs.a).toBeUndefined();
    // b walks into the empty laboratory.
    unit(w, 'b1', 'b', 'infantry', k(2, 1));
    const r = turn(w, [orders(w, 'a'), orders(w, 'b', { b1: { type: 'move', path: [k(1, 1)] } })]);
    w = r.world;
    expect(w.sites.lab!.owner).toBe('b');
    expect(w.blackFiles!.artefacts).toEqual({ a: 1, b: 1 });
    expect(w.blackFiles!.leaked).toEqual(['a']);
    expect(buildView(w, 'c').blackFiles!.blackTechs.a).toEqual(['railguns']);
    expect(r.reports.c!.events.some((e) => e.kind === 'black_files' && e.what === 'stolen')).toBe(false);
    expect(r.reports.a!.events.some((e) => e.kind === 'black_files' && e.what === 'stolen' && e.nation === 'b')).toBe(true);
  });

  it('point defence blunts strikes; quantum radar sees into cover', () => {
    const strike = (pd: boolean) => {
      const w = blackWorld();
      if (pd) w.nations.b!.research.unlocked = ['point_defence'];
      unit(w, 'art', 'a', 'artillery', k(3, 3));
      unit(w, 'b1', 'b', 'infantry', k(5, 3));
      const r = turn(w, [orders(w, 'a', { art: { type: 'attack', target: k(5, 3), path: [] } })]);
      return 1000 - r.world.formations.b1!.strength;
    };
    const plain = strike(false);
    const shielded = strike(true);
    expect(plain).toBeGreaterThan(0);
    expect(shielded).toBeLessThan(plain);
    const w = blackWorld();
    w.tiles[k(5, 3)]!.terrain = 'forest';
    unit(w, 'a1', 'a', 'infantry', k(3, 3));
    expect(computeVision(w, 'a').detect.has(k(5, 3))).toBe(false);
    w.nations.a!.research.unlocked = ['quantum_radar'];
    expect(computeVision(w, 'a').detect.has(k(5, 3))).toBe(true);
  });
});

describe('the Visitors', () => {
  it('sleep unseen: no view names them, they hold nothing and they are not eliminated', () => {
    let w = blackWorld();
    expect(buildView(w, 'a').nations.visitors).toBeUndefined();
    expect(buildView(w, 'a').relations.visitors).toBeUndefined();
    w = turn(w).world;
    expect(w.nations.visitors!.eliminated).toBe(false);
    expect(buildView(w, 'a').blackFiles!.awake).toBe(false);
  });

  it('wake past the threshold: the incursion opens with its first wave, at war with everyone', () => {
    let w = blackWorld({ wakeAt: 1 });
    w.blackFiles!.excavated = 1;
    const r = turn(w);
    w = r.world;
    expect(w.blackFiles!.awake).toBe(1);
    const inc = Object.values(w.sites).find((s) => s.anomaly === 'incursion')!;
    expect(inc).toMatchObject({ owner: 'visitors', kind: 'city', key: k(9, 4) });
    expect(w.tiles[k(9, 4)]!.crystal).toBe(true);
    const army = Object.values(w.formations).filter((f) => f.owner === 'visitors');
    expect(army.map((f) => f.unitClass).sort()).toEqual([...BLACK_FILES.firstWave].sort());
    for (const n of ['a', 'b', 'c']) expect(w.relations[`${n}|visitors`]).toBe('war');
    expect(r.reports.b!.events.some((e) => e.kind === 'black_files' && e.what === 'awakening')).toBe(true);
    const seen = buildView(w, 'a');
    expect(seen.nations.visitors).toMatchObject({ visitors: true, minor: true });
    expect(seen.blackFiles!.visitors).toBe('visitors');
  });

  it('also wake on their turn whatever was dug', () => {
    let w = blackWorld({ wakeAt: 9, wakeTurn: 2 });
    w = turn(w).world;
    expect(w.blackFiles!.awake).toBeNull();
    w = turn(w).world;
    expect(w.blackFiles!.awake).toBe(2);
  });

  it('make no treaties: every offer to them is refused', () => {
    const w = blackWorld({ wakeAt: 0 });
    const { rejected } = lockOrders(w, [orders(w, 'a', {}, { diplomacy: [{ target: 'visitors', action: 'propose_peace' }] })]);
    expect(rejected.map((e) => (e.kind === 'order_rejected' ? e.reason : ''))).toEqual(['The Visitors is a minor state: it makes no treaties']);
  });

  it('a shield emitter absorbs an assault and keeps the hex; strikes still hurt it', () => {
    const assault = (cls: 'walker' | 'emitter') => {
      const w = blackWorld();
      w.blackFiles!.awake = 1;
      w.tiles[k(6, 3)]!.owner = 'visitors';
      // Their incursion, or they are out of the war at the end of the turn.
      site(w, 'inc', k(10, 6), 'visitors', 'city', 0);
      unit(w, 'x', 'visitors', 'walker', k(6, 3), { strength: 200 });
      if (cls === 'emitter') unit(w, 'e', 'visitors', 'emitter', k(6, 3));
      for (const [i, q] of [4, 5].entries()) unit(w, `a${i}`, 'a', 'armor', k(q, 3 + (q === 4 ? 0 : 1)));
      unit(w, 'a2', 'a', 'armor', k(7, 2));
      const fo = { a0: { type: 'attack' as const, target: k(6, 3), path: [k(5, 3)] }, a1: { type: 'attack' as const, target: k(6, 3), path: [] }, a2: { type: 'attack' as const, target: k(6, 3), path: [] } };
      return resolveTurn(w, [orders(w, 'a', fo)]).world;
    };
    const open = assault('walker');
    const shielded = assault('emitter');
    expect(open.tiles[k(6, 3)]!.owner).toBe('a');
    expect(shielded.tiles[k(6, 3)]!.owner).toBe('visitors');
    expect(shielded.formations.e).toBeDefined();
  });

  it('turn ground they hold to crystal, split a big swarm and grow from the incursion', () => {
    let w = blackWorld({ wakeAt: 0 });
    w = turn(w).world;
    const swarm = Object.values(w.formations).find((f) => f.unitClass === 'swarm')!;
    w.formations[swarm.id]!.strength = 1000;
    const before = Object.values(w.formations).filter((f) => f.owner === 'visitors').length;
    for (let i = 0; i < BLACK_FILES.convertTurns; i++) w = turn(w, [orders(w, 'a'), orders(w, 'visitors', Object.fromEntries(Object.values(w.formations).filter((f) => f.owner === 'visitors').map((f) => [f.id, { type: 'hold' as const }])))]).world;
    const ring = [k(8, 4), k(10, 4), k(9, 3), k(10, 3), k(8, 5), k(9, 5)].filter((x) => w.tiles[x]!.owner === 'visitors');
    expect(ring.length).toBeGreaterThan(0);
    expect(ring.every((x) => w.tiles[x]!.crystal && w.tiles[x]!.terrain === 'hills')).toBe(true);
    expect(Object.values(w.formations).filter((f) => f.owner === 'visitors').length).toBeGreaterThan(before);
    expect(Object.values(w.formations).filter((f) => f.owner === 'visitors' && f.unitClass === 'swarm').length).toBeGreaterThanOrEqual(2);
  });

  it('win holding their share of the map, and lose to the Accord when destroyed', () => {
    const w = blackWorld({ wakeAt: 0 });
    w.blackFiles!.awake = 1;
    site(w, 'inc', k(9, 4), 'visitors', 'city', 100);
    expect(evaluateVictory(w)).toMatchObject({ winner: 'visitors', reason: 'visitors' });
    w.sites.inc!.victoryPoints = 1;
    expect(evaluateVictory(w)).toBeNull();
    w.nations.visitors!.eliminated = true;
    // Destroyed with nobody in the Accord: the war goes on.
    expect(evaluateVictory(w)).toBeNull();
    w.blackFiles!.accord = ['a', 'c'];
    expect(evaluateVictory(w)).toMatchObject({ reason: 'accord', coalition: ['a', 'c'] });
  });

  it("win by their campaign's own share where it has one: First Contact's, not the toggle's", () => {
    // The defaults (the Pacific with the toggle) and First Contact's own, measured (VISITORS_BARS).
    expect(visitorsBars()).toEqual({ visitorsShare: BLACK_FILES.visitorsShare, limitShare: BLACK_FILES.limitShare });
    expect(visitorsBars('pacific')).toEqual(visitorsBars());
    const first = visitorsBars('black-files-first-contact');
    expect(first).toEqual({ visitorsShare: VISITORS_BARS['black-files-first-contact']!.visitorsShare, limitShare: BLACK_FILES.limitShare });
    expect(first.visitorsShare).toBeLessThan(BLACK_FILES.visitorsShare);
    // The Visitors awake, holding a share between First Contact's and the toggle's.
    const at = (scenarioId: string) => {
      const w = blackWorld({ wakeAt: 0 });
      w.blackFiles!.awake = 1;
      w.scenarioId = scenarioId;
      const others = totalVictoryPoints(w);
      const vp = Math.ceil((others * first.visitorsShare) / (100 - first.visitorsShare));
      site(w, 'inc', k(9, 4), 'visitors', 'city', vp);
      const held = Math.floor((vp * 100) / totalVictoryPoints(w));
      expect(held).toBeGreaterThanOrEqual(first.visitorsShare);
      expect(held).toBeLessThan(BLACK_FILES.visitorsShare);
      return evaluateVictory(w);
    };
    expect(at('black-files-first-contact')).toMatchObject({ winner: 'visitors', reason: 'visitors' });
    expect(at('pacific')).toBeNull();
  });
});

describe('determinism', () => {
  it('the Black Files phase gives the same world whatever order the orders came in', () => {
    let w = blackWorld({ wakeAt: 0 });
    w = turn(w).world;
    w.blackFiles!.artefacts = { a: 1, b: 1 };
    for (const n of ['a', 'b', 'c']) w.nations[n]!.doctrine = { cp: 5, hand: ['black_bag'], deck: [], discard: [], effects: [] };
    unit(w, 'a1', 'a', 'infantry', k(5, 3));
    unit(w, 'b1', 'b', 'armor', k(7, 5));
    const subs = () => [
      orders(w, 'a', { a1: { type: 'move', path: [k(6, 3)] } }, { play: [{ card: 'black_bag', nation: 'b' }], diplomacy: [{ target: 'b', action: 'propose_accord' }] }),
      orders(w, 'b', { b1: { type: 'attack', target: k(8, 4), path: [] } }, { play: [{ card: 'black_bag', nation: 'a' }], diplomacy: [{ target: 'a', action: 'propose_accord' }] }),
      orders(w, 'c', {}, { play: [{ card: 'black_bag', nation: 'a' }] }),
    ];
    const r1 = resolveTurn(w, subs());
    const reversed = subs()
      .reverse()
      .map((o) => ({ ...o, formations: Object.fromEntries(Object.entries(o.formations).reverse()) }));
    expect(resolveTurn(w, reversed).hash).toBe(r1.hash);
    expect(r1.world.blackFiles!.accord).toEqual(['a', 'b']);
  });
});

describe('the Black Bag job', () => {
  const agents = (w: WorldState, n: string) => (w.nations[n]!.doctrine = { cp: 5, hand: ['black_bag'], deck: [], discard: [], effects: [] });
  const job = (w: WorldState, thief: string, from: string) => orders(w, thief, {}, { play: [{ card: 'black_bag', nation: from }] });

  it('steals an artefact from a rival that holds one', () => {
    const w = blackWorld();
    w.blackFiles!.artefacts.a = 2;
    agents(w, 'b');
    const r = resolveTurn(w, [job(w, 'b', 'a')]);
    expect(r.events.filter((e) => e.kind === 'order_rejected')).toEqual([]);
    expect(r.world.blackFiles!.artefacts).toEqual({ a: 1, b: 1 });
    expect(r.reports.a!.events.some((e) => e.kind === 'black_files' && e.what === 'stolen' && e.nation === 'b')).toBe(true);
  });

  it('leaks the programme of a rival with nothing to take, and two agencies after one artefact both come home empty', () => {
    let w = blackWorld();
    w.nations.a!.research.unlocked = ['point_defence'];
    agents(w, 'b');
    w = resolveTurn(w, [job(w, 'b', 'a')]).world;
    expect(w.blackFiles!.leaked).toEqual(['a']);
    w = blackWorld();
    w.blackFiles!.artefacts.a = 1;
    agents(w, 'b');
    agents(w, 'c');
    const r = resolveTurn(w, [job(w, 'c', 'a'), job(w, 'b', 'a')]);
    expect(r.world.blackFiles!.artefacts).toEqual({ a: 1 });
    expect(r.world.blackFiles!.leaked).toEqual(['a']);
  });
});

describe('the Accord', () => {
  const awake = () => {
    const w = blackWorld();
    w.blackFiles!.awake = 1;
    return w;
  };

  it('is offered only once they have woken, and signed when both offer it: peace and shared eyes', () => {
    const asleep = blackWorld();
    expect(checkDiplomacy(asleep, 'a', 'b', 'propose_accord')).toMatch(/nothing has come/);
    let w = awake();
    expect(accordOpen(w.blackFiles, 'a', 'b')).toBe(true);
    unit(w, 'b1', 'b', 'recon', k(10, 7));
    expect(computeVision(w, 'a').visible.has(k(10, 6))).toBe(false);
    const r = resolveTurn(w, [orders(w, 'a', {}, { diplomacy: [{ target: 'b', action: 'propose_accord' }] }), orders(w, 'b', {}, { diplomacy: [{ target: 'a', action: 'propose_accord' }] })]);
    w = r.world;
    expect(r.events.filter((e) => e.kind === 'order_rejected')).toEqual([]);
    expect(w.blackFiles!.accord).toEqual(['a', 'b']);
    expect(w.relations['a|b']).toBe('peace');
    expect(computeVision(w, 'a').visible.has(k(10, 6))).toBe(true);
    expect(checkDiplomacy(w, 'a', 'b', 'propose_accord')).toMatch(/both in the Accord/);
    expect(r.reports.c!.events.filter((e) => e.kind === 'black_files' && e.what === 'accord').length).toBe(2);
  });

  it('a third power joins by signing with one member, and its war with the members ends', () => {
    let w = awake();
    w.blackFiles!.accord = ['a', 'b'];
    setRelation(w, 'a', 'b', 'peace');
    w = resolveTurn(w, [orders(w, 'c', {}, { diplomacy: [{ target: 'a', action: 'propose_accord' }] }), orders(w, 'a', {}, { diplomacy: [{ target: 'c', action: 'propose_accord' }] })]).world;
    expect(w.blackFiles!.accord).toEqual(['a', 'b', 'c']);
    expect(w.relations['b|c']).toBe('peace');
    expect(w.relations['a|c']).toBe('peace');
  });

  it('betrayal is legal and dear: the betrayer is out for good, poorer in stability, at war with every signatory', () => {
    let w = awake();
    w.blackFiles!.accord = ['a', 'b', 'c'];
    setRelation(w, 'a', 'b', 'peace');
    setRelation(w, 'a', 'c', 'peace');
    setRelation(w, 'b', 'c', 'peace');
    const stability = w.nations.a!.stability;
    expect(checkDiplomacy(w, 'a', 'b', 'declare_war')).toBeNull();
    const r = resolveTurn(w, [orders(w, 'a', {}, { diplomacy: [{ target: 'b', action: 'declare_war' }] })]);
    w = r.world;
    expect(w.blackFiles!.accord).toEqual(['b', 'c']);
    expect(w.blackFiles!.betrayers).toEqual(['a']);
    expect(w.relations['a|b']).toBe('war');
    expect(w.relations['a|c']).toBe('war');
    // The Accord's own price, then perfidy for tearing up a peace.
    expect(w.nations.a!.stability).toBeLessThanOrEqual(stability - BLACK_FILES.betrayalStability);
    expect(r.reports.c!.events.some((e) => e.kind === 'black_files' && e.what === 'betrayal' && e.nation === 'a' && e.other === 'b')).toBe(true);
    expect(checkDiplomacy(w, 'a', 'c', 'propose_accord')).toMatch(/you broke the Accord/);
    expect(checkDiplomacy(w, 'c', 'a', 'propose_accord')).toMatch(/broke the Accord/);
  });

  it('every world it touches keeps the ruleset it was made under', () => {
    expect(awake().rulesetVersion).toBe(RULESET_VERSION);
  });
});

// Ruleset 2.12.0: the Accord beside the deals of diplomacy 2.10 and right of passage. It binds like a
// pact: no deal may take one signatory to war with another; only a declaration does, and betrays it.
describe('the Accord among the other deals', () => {
  const signed = () => {
    const w = blackWorld();
    w.blackFiles!.awake = 1;
    w.blackFiles!.accord = ['a', 'c'];
    setRelation(w, 'a', 'b', 'peace');
    setRelation(w, 'a', 'c', 'peace');
    setRelation(w, 'b', 'c', 'war');
    site(w, 'c-port', k(10, 1), 'c', 'city', 2);
    return w;
  };

  it('no alliance against a fellow signatory and no joint operation on its city, for either side', () => {
    const w = signed();
    // b, at war with c, asks a (in the Accord with c): a would go to war with c without declaring it.
    expect(checkDiplomacy(w, 'b', 'a', 'propose_alliance', { against: 'c' })).toBe(`${w.nations.a!.name} stands with ${w.nations.c!.name} in the Accord`);
    expect(checkDiplomacy(w, 'a', 'b', 'propose_alliance', { against: 'c' })).toBe(`you stand with ${w.nations.c!.name} in the Accord`);
    expect(checkDiplomacy(w, 'b', 'a', 'propose_joint_op', { site: 'c-port' })).toBe(`${w.nations.a!.name} stands with ${w.nations.c!.name} in the Accord`);
    expect(checkDiplomacy(w, 'a', 'b', 'propose_joint_op', { site: 'c-port' })).toBe(`you stand with ${w.nations.c!.name} in the Accord`);
    // Offered both ways anyway, nothing signs and nobody goes to war.
    const r = resolveTurn(w, [
      orders(w, 'a', {}, { diplomacy: [{ target: 'b', action: 'propose_joint_op', terms: { site: 'c-port' } }] }),
      orders(w, 'b', {}, { diplomacy: [{ target: 'a', action: 'propose_joint_op', terms: { site: 'c-port' } }] }),
    ]);
    expect(r.world.relations['a|c']).toBe('peace');
    expect(r.world.treaties.some((t) => t.kind === 'joint_op')).toBe(false);
    // Outside the Accord, the same alliance is a deal like any other.
    const out = signed();
    out.blackFiles!.accord = [];
    expect(checkDiplomacy(out, 'b', 'a', 'propose_alliance', { against: 'c' })).toBeNull();
  });

  it('a betrayal ends a right of passage with every signatory, and those pairs heed no offer that turn', () => {
    const w = signed();
    w.blackFiles!.accord = ['a', 'b', 'c'];
    setRelation(w, 'b', 'c', 'peace');
    w.treaties.push({ kind: 'passage', a: 'a', b: 'c', from: 1, until: 8 });
    // a betrays b; c, a signatory with a passage to a, goes to war with a and the passage ends.
    const r = resolveTurn(w, [
      orders(w, 'a', {}, { diplomacy: [{ target: 'b', action: 'declare_war' }, { target: 'c', action: 'propose_peace' }] }),
      orders(w, 'c', {}, { diplomacy: [{ target: 'a', action: 'propose_peace' }] }),
    ]);
    expect(r.world.relations['a|c']).toBe('war');
    expect(r.world.treaties.some((t) => t.kind === 'passage')).toBe(false);
    expect(r.events).toContainEqual(expect.objectContaining({ kind: 'treaty_ended', treaty: 'passage', a: 'a', b: 'c', reason: 'war' }));
    // Both offered peace, but the war the betrayal brought is not undone in the same turn.
    expect(r.world.proposals.some((p) => p.kind === 'peace' && ((p.from === 'a' && p.to === 'c') || (p.from === 'c' && p.to === 'a')))).toBe(false);
  });

  it('every pair is public, but the Visitors are in none until they wake', () => {
    const w = blackWorld();
    const asleep = buildView(w, 'a');
    expect(Object.keys(asleep.publicRelations ?? {}).some((k) => k.includes('visitors'))).toBe(false);
    expect(asleep.publicRelations?.['b|c']).toBeDefined();
    w.blackFiles!.awake = 1;
    expect(Object.keys(buildView(w, 'a').publicRelations ?? {}).some((k) => k.includes('visitors'))).toBe(true);
  });
});

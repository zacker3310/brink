import { describe, expect, it } from 'vitest';
import { decide, rejectedActions } from './ai';
import { act, arenaResult, autoBattle, autoTurn, createBattle, endTurn, unitById, whyNot } from './engine';
import { autoDeploy, placements, zoneCells, zonesOf } from './deploy';
import { bare, BATTLES, copy, NORTH, put, setup, SOUTH, spec, unit } from './fixture.test-util';
import { groupsOf, planGroup, slotsFor, STACK_SPACING } from './groups';
import { observe } from './observe';
import { hashBattle, replay, submit } from './replay';
import { BASE_CP, commandPoints, MIN_ON_FIELD, reserveUnits } from './reserves';
import { typeOf } from './roster';
import { cheb, isFlying } from './sight';
import { at, BUILDING, H, OPEN, W, WATER, type ArenaSetup, type Battle } from './types';
import { stateProblems } from './verify.test-util';

// Command of the battle (docs/arena-v2.md, section 16): groups under one order, the deployment
// phase, and reserves called in with Command Points.

const ids = (b: Battle, side: 'blue' | 'red' = 'blue') => b.units.filter((u) => u.side === side && u.alive && !u.carrier).map((u) => u.id);
const ok = (b: Battle, a: Parameters<typeof act>[1]) => {
  const why = whyNot(b, a);
  expect(why, JSON.stringify(a)).toBeNull();
  expect(act(b, a)).toBe(true);
};

describe('groups', () => {
  /** Three tanks and an IFV at the bottom, two attack helicopters behind them, the enemy far off. */
  function company(): Battle {
    const b = bare(['m1a2', 'm1a2', 'm1a2', 'm2a3', 'ah64e', 'ah64e'], ['t90m']);
    ['m1a2', 'm1a2', 'm1a2', 'm2a3'].forEach((t, i) => put(unit(b, t as 'm1a2', 'blue', t === 'm1a2' ? i : 0), 13 + i, 40, NORTH));
    put(unit(b, 'ah64e'), 14, 43);
    put(unit(b, 'ah64e', 'blue', 1), 15, 43);
    put(unit(b, 't90m', 'red'), 15, 2, SOUTH);
    return b;
  }

  it('one order moves the whole group, each unit by an ordinary move, into its formation', () => {
    const b = company();
    ok(b, { type: 'group', units: ids(b), formation: 'line' });
    const g = groupsOf(b, 'blue')[0]!;
    expect(g.id).toBe('blue:g1');
    const slots = slotsFor(b, g, { kind: 'move', to: { x: 15, y: 37 } });
    const before = b.events.length;
    ok(b, { type: 'order', group: g.id, order: { kind: 'move', to: { x: 15, y: 37 } } });
    const moves = b.events.slice(before);
    // Nothing but moves: the order is its units' moves, no rule of its own.
    expect(moves.every((e) => e.type === 'move' || e.type === 'spotted' || e.type === 'radio')).toBe(true);
    expect(new Set(moves.filter((e) => e.type === 'move').map((e) => (e as { unit: string }).unit)).size).toBe(6);
    for (const id of g.units) expect(unitById(b, id)!.moved).toBe(true);
    // The tanks and the IFV abreast on row 37 (a line across the way they went), each in its slot.
    const ground = g.units.map((id) => unitById(b, id)!).filter((u) => !isFlying(typeOf(u.type)));
    expect(new Set(ground.map((u) => u.y))).toEqual(new Set([37]));
    for (const u of ground) expect(u).toMatchObject(slots.find((x) => x.unit === u.id)!.at);
    // The helicopters fly a spaced stack.
    const air = g.units.map((id) => unitById(b, id)!).filter((u) => isFlying(typeOf(u.type)));
    expect(cheb(air[0]!, air[1]!)).toBeGreaterThanOrEqual(STACK_SPACING);
    // One order a group a turn.
    expect(whyNot(b, { type: 'order', group: g.id, order: { kind: 'hold' } })).toBe('Already ordered this turn');
  });

  it('formations: a column trails the lead, a line goes abreast, a wedge steps back and out', () => {
    const b = company();
    ok(b, { type: 'group', units: ids(b).filter((id) => !isFlying(typeOf(unitById(b, id)!.type))), formation: 'column' });
    const g = groupsOf(b, 'blue')[0]!;
    const to = { x: 15, y: 20 };
    const slots = (f: 'column' | 'line' | 'wedge') => {
      g.formation = f;
      return slotsFor(b, g, { kind: 'move', to }).map((s) => s.at);
    };
    expect(slots('column')).toEqual([to, { x: 15, y: 21 }, { x: 15, y: 22 }, { x: 15, y: 23 }]);
    expect(slots('line').map((p) => p.y)).toEqual([20, 20, 20, 20]);
    const wedge = slots('wedge');
    expect(wedge[0]).toEqual(to);
    expect(wedge[1]!.y).toBe(21);
    expect(wedge[2]!.y).toBe(21);
    expect(Math.abs(wedge[1]!.x - wedge[2]!.x)).toBe(2);
    // Changing it is an order of its own; the same again is refused.
    ok(b, { type: 'formation', group: g.id, formation: 'line' });
    expect(whyNot(b, { type: 'formation', group: g.id, formation: 'line' })).toBe('Already in that formation');
  });

  it('persists across turns until dissolved; the dead leave it; others refuse to be grouped', () => {
    const b = company();
    const mine = ids(b);
    ok(b, { type: 'group', units: mine });
    expect(whyNot(b, { type: 'group', units: mine })).toBe('Already a group');
    expect(whyNot(b, { type: 'group', units: [mine[0]!, unit(b, 't90m', 'red').id] })).toBe('Not your unit');
    endTurn(b);
    expect(groupsOf(b, 'blue')[0]!.units).toEqual(mine);
    // A unit lost leaves it.
    const lost = unitById(b, mine[0]!)!;
    lost.alive = false;
    lost.status = 'destroyed';
    ok(b, { type: 'hold', unit: mine[1]! });
    expect(groupsOf(b, 'blue')[0]!.units).toEqual(mine.slice(1));
    // A unit grouped again leaves its old group.
    ok(b, { type: 'group', units: [mine[2]!] });
    expect(groupsOf(b, 'blue').map((g) => g.units)).toEqual([[mine[1]!, ...mine.slice(3)], [mine[2]!]]);
    ok(b, { type: 'ungroup', group: groupsOf(b, 'blue')[0]!.id });
    expect(groupsOf(b, 'blue')).toHaveLength(1);
  });

  it('the rules still apply to each unit: an enemy on overwatch fires on the group as it moves in front of it', () => {
    const b = company();
    const t90 = put(unit(b, 't90m', 'red'), 15, 26, SOUTH);
    t90.overwatch = true;
    ok(b, { type: 'group', units: ids(b).slice(0, 4), formation: 'wedge' });
    const stream = b.stream;
    ok(b, { type: 'order', group: 'blue:g1', order: { kind: 'move', to: { x: 15, y: 34 } } });
    expect(b.events.some((e) => e.type === 'fire' && e.unit === t90.id && e.overwatch)).toBe(true);
    expect(b.stream).not.toBe(stream);
  });

  it('an assault moves up and fires at the named target; overwatch, screen and hold expand as named', () => {
    const b = company();
    const t90 = put(unit(b, 't90m', 'red'), 15, 30, SOUTH);
    ok(b, { type: 'group', units: ids(b).slice(0, 3) });
    ok(b, { type: 'order', group: 'blue:g1', order: { kind: 'assault', to: { x: 15, y: 36 }, target: t90.id } });
    expect(b.events.filter((e) => e.type === 'fire' && e.target === t90.id).length).toBeGreaterThan(0);

    const c = company();
    ok(c, { type: 'group', units: ids(c).slice(0, 4) });
    const plan = planGroup(c, 'blue:g1', { kind: 'screen', to: { x: 15, y: 38 } });
    expect(plan.map((p) => p.action?.type)).toEqual(['move', 'move', 'move', 'move']);
    // Two cells apart, abreast.
    const xs = plan.map((p) => p.slot.x).sort((m, n) => m - n);
    for (let i = 1; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!).toBe(2);
    ok(c, { type: 'order', group: 'blue:g1', order: { kind: 'screen', to: { x: 15, y: 38 } } });
    for (const id of groupsOf(c, 'blue')[0]!.units) expect(unitById(c, id)!.overwatch).toBe(true);

    const d = company();
    ok(d, { type: 'group', units: ids(d) });
    ok(d, { type: 'order', group: 'blue:g1', order: { kind: 'hold' } });
    for (const id of ids(d)) expect(unitById(d, id)!.acted).toBe(true);
    // The standing order: the next turn, an order without one repeats it.
    endTurn(d);
    ok(d, { type: 'order', group: 'blue:g1' });
  });

  it('an order with nothing for anyone to do is refused and changes nothing', () => {
    const b = company();
    ok(b, { type: 'group', units: ids(b) });
    for (const id of ids(b)) ok(b, { type: 'hold', unit: id });
    const before = JSON.stringify(b);
    expect(whyNot(b, { type: 'order', group: 'blue:g1', order: { kind: 'move', to: { x: 15, y: 30 } } })).toBe('Nothing to do');
    expect(act(b, { type: 'order', group: 'blue:g1', order: { kind: 'move', to: { x: 15, y: 30 } } })).toBe(false);
    expect(JSON.stringify(b)).toBe(before);
  });
});

describe('deployment', () => {
  const base = (extra: Partial<ArenaSetup> = {}) =>
    setup({ attackers: [spec('b', ['m1a2', 'm1a2', 'ah64e', 'squad_w', 'paladin'])], defenders: [spec('r', ['t90m', 'bmp3', 'squad_e'])], ...extra });

  it('without zone data the battle starts deployed, as it always has, and stores nothing new', () => {
    const b = createBattle(base());
    expect(b.deployment).toBeUndefined();
    expect(b.reserves).toBeUndefined();
    expect(b.groups).toBeUndefined();
    expect(zonesOf(b, 'blue')).toEqual([{ id: 'blue:edge', kind: 'edge', cells: b.map.blueSpawn }]);
    for (const u of b.units.filter((x) => x.side === 'blue' && !x.carrier)) expect(b.map.blueSpawn.some((p) => p.x === u.x && p.y === u.y)).toBe(true);
  });

  it('a deployment phase: only placing, grouping and Begin until it closes; each unit only in a zone it may use', () => {
    const b = createBattle(base({ deployment: { manual: true, blue: { zones: [{ kind: 'lz', at: { x: 8, y: 30 } }] } } }));
    expect(b.deployment?.open).toBe(true);
    expect(stateProblems(b)).toEqual([]);
    const tank = unit(b, 'm1a2');
    const heli = unit(b, 'ah64e');
    const lz = zonesOf(b, 'blue').find((z) => z.kind === 'lz')!;
    expect(lz.cells[0]).toEqual({ x: 8, y: 30 });
    // Auto-deploy put the helicopter on the landing zone.
    expect(lz.cells.some((p) => p.x === heli.x && p.y === heli.y)).toBe(true);
    expect(whyNot(b, { type: 'move', unit: tank.id, to: { x: tank.x, y: tank.y - 1 } })).toBe('Deploy first');
    expect(whyNot(b, { type: 'place', unit: tank.id, at: lz.cells[1]! })).toBe('Not in a zone it may use');
    expect(whyNot(b, { type: 'place', unit: tank.id, at: { x: 15, y: 20 } })).toBe('Not in a zone it may use');
    const spot = placements(b, tank.id).find((p) => !b.units.some((u) => u.x === p.x && u.y === p.y))!;
    ok(b, { type: 'place', unit: tank.id, at: spot });
    expect(tank).toMatchObject(spot);
    expect(b.events.at(-1)).toMatchObject({ type: 'deploy', unit: tank.id, ...spot });
    // Onto a friend: they trade places.
    const other = unit(b, 'm1a2', 'blue', 1);
    const was = { x: other.x, y: other.y };
    ok(b, { type: 'place', unit: tank.id, at: was });
    expect(other).toMatchObject(spot);
    ok(b, { type: 'deployed' });
    expect(b.deployment?.open).toBe(false);
    expect(whyNot(b, { type: 'place', unit: tank.id, at: spot })).toBe('Deployment is over');
    expect(b.round).toBe(1);
    expect(b.turn).toBe('blue');
  });

  it('End Turn in deployment begins the battle; Let Crews Play deploys and fights', () => {
    const s = base({ deployment: { manual: true } });
    const b = createBattle(s);
    endTurn(b);
    expect(b.deployment?.open).toBe(false);
    expect(b.round).toBe(2);
    const c = createBattle(s);
    expect(decide(c, 'blue')).toEqual({ type: 'deployed' });
    autoTurn(c);
    expect(rejectedActions(c)).toEqual([]);
    expect(c.events.some((e) => e.type === 'move' && unitById(c, e.unit)?.side === 'blue')).toBe(true);
  });

  it('zones from the war map: a drop zone needs air superiority, a beach is the shore (or the edge with no water), all in the side’s own part', () => {
    const b = createBattle(base());
    const m = b.map;
    expect(zoneCells(m, 'blue', { kind: 'drop', at: { x: 10, y: 30 } })).toEqual([]);
    expect(zoneCells(m, 'blue', { kind: 'drop', at: { x: 10, y: 30 } }, true).length).toBeGreaterThan(5);
    // A landing zone asked for in the enemy's deployment band is clipped to blue's part.
    expect(zoneCells(m, 'blue', { kind: 'lz', at: { x: 10, y: 10 } })).toEqual([]);
    for (let i = 0; i < W * H; i++) m.cells[i] = OPEN;
    expect(zoneCells(m, 'blue', { kind: 'beach' })).toEqual(zoneCells(m, 'blue', { kind: 'edge' }));
    for (let x = 0; x < W; x++) m.cells[at(m, x, 36)] = WATER;
    const beach = zoneCells(m, 'blue', { kind: 'beach' });
    expect(beach.length).toBeGreaterThan(0);
    expect(beach.every((p) => Math.abs(p.y - 36) === 1)).toBe(true);
  });

  it('the defender never deploys on top of an attacker landed deep in the field', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const b = createBattle(base({ seed, deployment: { blue: { zones: [{ kind: 'lz', at: { x: 15, y: 26 }, r: 3 }] } } }));
      expect(stateProblems(b), `seed ${seed}`).toEqual([]);
    }
  });

  it('auto-deploy puts guns at the back of the zone and armour at its front', () => {
    const b = createBattle(base({ deployment: {} }));
    autoDeploy(b, 'blue');
    expect(unit(b, 'paladin').y).toBeGreaterThan(unit(b, 'm1a2').y);
  });
});

describe('reserves and Command Points', () => {
  const withAir = (extra: Partial<ArenaSetup> = {}) =>
    setup({
      attackers: [spec('b', ['m1a2', 'm1a2']), spec('air', ['uh60', 'squad_w'], 'air'), spec('tanks', ['m1a2', 'm1a2', 'm1a2'])],
      defenders: [spec('r', ['t90m', 'bmp3', 'squad_e'])],
      reserves: { blue: { formations: ['air', 'tanks'] } },
      deployment: { blue: { zones: [{ kind: 'lz', at: { x: 15, y: 30 } }] } },
      command: { blue: { points: 12 } },
      ...extra,
    });

  it('Command Points: 6 and twice the general’s level, plus doctrine and technology, or as given', () => {
    expect(commandPoints(undefined)).toBe(BASE_CP);
    expect(commandPoints({ general: 3, doctrine: 2, tech: 1 })).toBe(BASE_CP + 6 + 2 + 1);
    expect(commandPoints({ points: 3 })).toBe(3);
    expect(commandPoints({ general: 99 })).toBe(BASE_CP + 20);
  });

  it('reserves start off the field in waves, by formation; someone always starts on it', () => {
    const b = createBattle(withAir());
    expect(b.reserves!.blue.cp).toBe(12);
    expect(b.reserves!.blue.waves.map((w) => [w.id, w.units.map((u) => u.id), w.via, w.cost])).toEqual([
      ['blue:w1', ['air:1', 'air:2'], ['edge', 'lz'], 3],
      ['blue:w2', ['tanks:1', 'tanks:2', 'tanks:3'], ['edge', 'beach'], 6],
    ]);
    expect(b.units.filter((u) => u.side === 'blue').map((u) => u.id)).toEqual(['b:1', 'b:2']);
    const all = createBattle(withAir({ reserves: { blue: { formations: ['b', 'air', 'tanks'] } } }));
    expect(all.units.filter((u) => u.side === 'blue' && !u.carrier).length).toBe(MIN_ON_FIELD);
    // A war-map result counts a formation never called in whole.
    autoBattle(b);
    if (b.reserves!.blue.waves.some((w) => w.id === 'blue:w2')) expect(arenaResult(b).kept.tanks).toBe(1000);
    expect(Object.keys(arenaResult(b).kept).sort()).toEqual(['air', 'b', 'r', 'tanks']);
  }, BATTLES);

  it('a UH-60 brings its squad onto a roof at the landing zone; the wave comes on as a group, fresh, and costs its points', () => {
    const b = createBattle(withAir());
    const roof = { x: 15, y: 30 };
    b.map.cells[at(b.map, roof.x, roof.y)] = BUILDING;
    b.map.storeys[at(b.map, roof.x, roof.y)] = 2;
    const lz = zonesOf(b, 'blue').find((z) => z.kind === 'lz')!;
    expect(lz.cells[0]).toEqual(roof);
    ok(b, { type: 'reserve', wave: 'blue:w1', zone: lz.id });
    const heli = unitById(b, 'air:1')!;
    const squad = unitById(b, 'air:2')!;
    expect(heli).toMatchObject({ ...roof, moved: false, acted: false });
    expect(squad).toMatchObject({ ...roof, carrier: null });
    expect(heli.passengers).toEqual([]);
    expect(b.reserves!.blue.cp).toBe(9);
    expect(b.reserves!.blue.waves.map((w) => w.id)).toEqual(['blue:w2']);
    expect(groupsOf(b, 'blue')).toEqual([{ id: 'blue:g1', side: 'blue', units: ['air:1', 'air:2'], formation: 'column', order: null, wave: 'blue:w1' }]);
    expect(b.events.filter((e) => e.type === 'reinforce').map((e) => (e as { unit: string }).unit)).toEqual(['air:1', 'air:2']);
    // Tanks cannot land at a landing zone; at the edge they can, and they can act at once.
    expect(whyNot(b, { type: 'reserve', wave: 'blue:w2', zone: lz.id })).toBe('Cannot come on there');
    ok(b, { type: 'reserve', wave: 'blue:w2', zone: 'blue:edge' });
    expect(b.reserves!.blue.cp).toBe(3);
    const tank = unitById(b, 'tanks:1')!;
    ok(b, { type: 'move', unit: tank.id, to: { x: tank.x, y: tank.y - 2 } });
    expect(stateProblems(b)).toEqual([]);
  });

  it('only at the start of the side’s turn, and only with the points', () => {
    const b = createBattle(withAir());
    ok(b, { type: 'hold', unit: 'b:1' });
    expect(whyNot(b, { type: 'reserve', wave: 'blue:w1', zone: 'blue:edge' })).toBe('Reserves come on at the start of the turn');
    endTurn(b);
    // Grouping and calling leave the start of the turn open.
    ok(b, { type: 'group', units: ['b:1', 'b:2'] });
    ok(b, { type: 'reserve', wave: 'blue:w2', zone: 'blue:edge' });
    expect(b.reserves!.blue.cp).toBe(6);
    b.reserves!.blue.cp = 2;
    expect(whyNot(b, { type: 'reserve', wave: 'blue:w1', zone: 'blue:edge' })).toBe('Not enough Command Points');
    expect(whyNot(b, { type: 'reserve', wave: 'red:w1', zone: 'blue:edge' })).toBe('No such reserve');
  });

  it('replays exactly from the command log, and the enemy’s reserves are not in the player’s picture', () => {
    const s = withAir({ defenders: [spec('r', ['t90m', 't90m', 'bmp3', 'squad_e', 'kornet', 'rpg'])], reserves: { blue: { formations: ['air', 'tanks'] }, red: { share: 400 } }, command: { blue: { points: 12 }, red: { general: 2 } } });
    const b = createBattle(s);
    expect(reserveUnits(b, 'red').length).toBeGreaterThan(0);
    expect(submit(b, { type: 'act', action: { type: 'group', units: ['b:1', 'b:2'], formation: 'wedge' } })).toBe(true);
    expect(submit(b, { type: 'act', action: { type: 'reserve', wave: 'blue:w1', zone: 'blue:lz' } })).toBe(true);
    expect(submit(b, { type: 'act', action: { type: 'order', group: 'blue:g1', order: { kind: 'move', to: { x: 15, y: 36 } } } })).toBe(true);
    expect(submit(b, { type: 'end' })).toBe(true);
    expect(submit(b, { type: 'auto' })).toBe(true);
    expect(hashBattle(replay(s, b.commands!))).toBe(hashBattle(b));
    expect(hashBattle(copy(b))).toBe(hashBattle(b));
    const o = observe(b, 'blue');
    expect(o.reserves!.red.waves).toEqual([]);
    expect(o.reserves!.blue).toEqual(b.reserves!.blue);
    expect((o.groups ?? []).every((g) => g.side === 'blue')).toBe(true);
  }, BATTLES);
});

describe('the AI commands', () => {
  it('calls its reserves, moves the waves in formation, releases them in contact, and breaks no rule', () => {
    let called = 0;
    let ordered = 0;
    let released = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const b = createBattle(
        setup({
          seed,
          terrain: seed % 2 ? 'plains' : 'hills',
          attackers: [spec('b', ['m1a2', 'm1a2', 'm2a3', 'squad_w']), spec('w', ['m1a2', 'm1a2', 'stryker', 'squad_w'], 'mechanized'), spec('air', ['ah64e', 'uh60', 'squad_w'], 'air')],
          defenders: [spec('r', ['t90m', 'bmp3', 'squad_e', 'kornet']), spec('rr', ['t90m', 't90m', 'bmp3', 'squad_e'])],
          reserves: { blue: { formations: ['w', 'air'] }, red: { formations: ['rr'] } },
          deployment: { manual: true, blue: { zones: [{ kind: 'lz', at: { x: 6, y: 31 } }] } },
          command: { blue: { general: 2 }, red: { general: 1 } },
        }),
      );
      const before = { blue: b.reserves!.blue.waves.length, red: b.reserves!.red.waves.length };
      for (let i = 0; i < 17 && !b.ended; i++) {
        autoTurn(b);
        expect(stateProblems(b), `seed ${seed} turn ${i}`).toEqual([]);
      }
      expect(rejectedActions(b), `seed ${seed}`).toEqual([]);
      called += before.blue - b.reserves!.blue.waves.length + before.red - b.reserves!.red.waves.length;
      ordered += b.events.filter((e) => e.type === 'reinforce').length;
      released += (b.groups ?? []).length === 0 ? 1 : 0;
    }
    expect(called).toBeGreaterThan(6);
    expect(ordered).toBeGreaterThan(20);
    expect(released).toBeGreaterThan(0);
  }, BATTLES * 3);

  it('picks its entries from what it knows: a landing zone under known air defence is passed over', () => {
    const b = createBattle(
      setup({
        attackers: [spec('b', ['m1a2', 'm1a2']), spec('air', ['ah64e', 'ah64e'], 'air')],
        defenders: [spec('r', ['t90m', 'tunguska'])],
        reserves: { blue: { formations: ['air'] } },
        deployment: { blue: { zones: [{ kind: 'lz', at: { x: 15, y: 30 } }] } },
        command: { blue: { points: 10 } },
      }),
    );
    b.round = 2;
    const ad = unit(b, 'tunguska', 'red');
    b.intel.blue[ad.id] = { unit: ad.id, type: ad.type, x: 15, y: 27, turn: 0, now: false };
    expect(decide(b, 'blue')).toEqual({ type: 'reserve', wave: 'blue:w1', zone: 'blue:edge' });
    delete b.intel.blue[ad.id];
    expect(decide(b, 'blue')).toEqual({ type: 'reserve', wave: 'blue:w1', zone: 'blue:lz' });
  });
});

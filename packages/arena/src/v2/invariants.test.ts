import { describe, expect, it } from 'vitest';
import { act, canAct, createBattle, UNDO_SAFE, undoable, whyNot } from './engine';
import { bare, BATTLES, copy, NORTH, put, setup, spec, unit } from './fixture.test-util';
import { submit, type PlayerCommand } from './replay';
import { typeOf } from './roster';
import { visibleTo } from './sight';
import type { Action, ArenaSetup, Battle } from './types';
import { arenaSetup, play, stateProblems, stepProblems, type Step } from './verify.test-util';

// Commands are all or nothing (docs/architecture.md, Battles): an order the rules refuse changes
// nothing at all, an accepted one is logged once, the same order twice commits twice only where
// the rules allow it, and Undo is offered only for a step that drew no dice and showed nothing new.

const SETUPS: ArenaSetup[] = [
  arenaSetup(51, { mix: 'roster', terrain: 'urban', site: 'city' }),
  arenaSetup(52, { mix: 'roster', terrain: 'forest', river: true, time: 'night' }),
  arenaSetup(53, { mix: 'roster', terrain: 'hills', weather: 'fog' }),
  arenaSetup(54, { mix: 'artillery', terrain: 'plains', site: 'objective' }),
  arenaSetup(55, { mix: 'air', terrain: 'mountains', time: 'dusk' }),
];

const sameJson = (s: Step) => JSON.stringify(s.b) === s.before;
const orderOf = (c: PlayerCommand | null): Action | null => (c?.type === 'act' ? c.action : null);

describe('commands are all or nothing', () => {
  it('a refused command never changes the battle; an accepted one is logged once; no step breaks a rule', () => {
    const reasons: Record<string, number> = {};
    let refused = 0;
    let accepted = 0;
    for (const [i, s] of SETUPS.entries()) {
      let n = 0;
      play(s, 500 + i, { turns: 3, illegal: 0.35 }, (st) => {
        const before = JSON.parse(st.before!) as Battle;
        if (st.must) {
          reasons[st.must] = (reasons[st.must] ?? 0) + 1;
          expect(st.ok, `${st.must}: ${JSON.stringify(st.cmd)}`).toBe(false);
        }
        if (st.ok) accepted++;
        else {
          refused++;
          expect(sameJson(st), `refused ${JSON.stringify(st.cmd)} changed the battle (seed ${s.seed})`).toBe(true);
        }
        expect(stepProblems(before, st.b, st.cmd, st.ok), `seed ${s.seed}: ${JSON.stringify(st.cmd)}`).toEqual([]);
        if (n++ % 5 === 0 || st.cmd?.type !== 'act') expect(stateProblems(st.b), `seed ${s.seed} after ${JSON.stringify(st.cmd)}`).toEqual([]);
      });
    }
    expect(refused).toBeGreaterThan(150);
    expect(accepted).toBeGreaterThan(150);
    for (const why of ['wrong side', 'unknown target', 'unknown unit', 'out of reach', 'already there', 'target out of sight', 'no such asset']) expect(reasons[why], why).toBeGreaterThan(0);
    expect(Object.keys(reasons).filter((k) => k.startsWith('malformed')).length).toBeGreaterThan(5);
  }, BATTLES * 3);

  it('the same accepted order twice in a row commits once, unless the rules allow another (a second rocket mission)', () => {
    let once = 0;
    for (const [i, s] of SETUPS.entries()) {
      play(s, 600 + i, { turns: 2, illegal: 0 }, (st) => {
        const a = orderOf(st.cmd);
        if (!st.ok || !a || st.b.ended) return;
        const allowed = canAct(st.b, a, 'blue');
        const before = JSON.stringify(st.b);
        const missions = a.type === 'support' ? st.b.support.find((x) => x.side === 'blue' && x.id === a.asset)!.missions : 0;
        const again = submit(st.b, st.cmd);
        expect(again, `${a.type} twice: ${whyNot(st.b, a, 'blue')}`).toBe(allowed);
        if (a.type !== 'support') expect(again, `${a.type} twice`).toBe(false);
        if (again) {
          expect(st.b.support.find((x) => x.side === 'blue' && a.type === 'support' && x.id === a.asset)!.missions).toBe(missions - 1);
        } else {
          once++;
          expect(JSON.stringify(st.b)).toBe(before);
        }
      });
    }
    expect(once).toBeGreaterThan(100);
  }, BATTLES * 3);

  it('a second rocket mission is a second commit; a third, with none left, is refused and changes nothing', () => {
    const b = createBattle(setup({ attackers: [spec('guns', ['paladin'], 'artillery')], defenders: [spec('x', ['t90m'])] }));
    const himars = b.support.find((s) => s.side === 'blue' && s.id === 'himars')!;
    expect(himars.missions).toBe(2);
    const call: PlayerCommand = { type: 'act', action: { type: 'support', asset: 'himars', at: { x: 15, y: 5 } } };
    expect(submit(b, call)).toBe(true);
    expect(submit(b, call)).toBe(true);
    expect(b.support.find((s) => s.id === 'himars')!.missions).toBe(0);
    const before = JSON.stringify(b);
    expect(submit(b, call)).toBe(false);
    expect(JSON.stringify(b)).toBe(before);
    expect(b.commands).toHaveLength(2);
  });

  it('End Turn twice is two turns; Retreat twice is one retreat', () => {
    const b = bare(['m1a2'], ['t90m']);
    expect(submit(b, { type: 'end' })).toBe(true);
    expect(submit(b, { type: 'end' })).toBe(true);
    expect(b.round).toBe(3);
    expect(submit(b, { type: 'retreat' })).toBe(true);
    const over = JSON.stringify(b);
    expect(submit(b, { type: 'retreat' })).toBe(false);
    expect(JSON.stringify(b)).toBe(over);
    expect(b.commands).toHaveLength(3);
  });

  it('Undo is offered only for a step that drew no dice and showed nothing new', () => {
    const kinds = new Set<string>();
    let offered = 0;
    let withheld = 0;
    for (const [i, s] of SETUPS.entries()) {
      play(s, 700 + i, { turns: 3, illegal: 0 }, (st) => {
        const a = orderOf(st.cmd);
        if (!st.ok || !a) return;
        const before = JSON.parse(st.before!) as Battle;
        if (!undoable(before, st.b)) {
          withheld++;
          return;
        }
        offered++;
        kinds.add(a.type);
        expect(['move', 'face', 'overwatch', 'hunker', 'embark', 'dismount']).toContain(a.type);
        expect(st.b.stream, `${a.type} drew from the stream`).toBe(before.stream);
        expect([...visibleTo(st.b, 'blue')].sort(), `${a.type} changed what blue sees`).toEqual([...visibleTo(before, 'blue')].sort());
        expect(st.b.intel.blue, `${a.type} changed blue's last known positions`).toEqual(before.intel.blue);
        expect(st.b.units.filter((u) => u.side === 'red').map((u) => u.revealed)).toEqual(before.units.filter((u) => u.side === 'red').map((u) => u.revealed));
        for (const e of st.b.events.slice(before.events.length)) expect(UNDO_SAFE[e.type], e.type).toBe(true);
        expect(st.b.turnIndex).toBe(before.turnIndex);
      });
    }
    expect(offered).toBeGreaterThan(20);
    expect(withheld).toBeGreaterThan(20);
    expect(kinds.has('move')).toBe(true);
  }, BATTLES * 3);

  it('a malformed command is refused before the engine sees it, and changes nothing', () => {
    const b = bare(['m1a2', 'paladin'], ['t90m']);
    const tank = put(unit(b, 'm1a2'), 15, 40, NORTH);
    const gun = put(unit(b, 'paladin'), 10, 44, NORTH);
    const shell = typeOf(gun.type).weapons.find((w) => w.indirect)!.id;
    const before = JSON.stringify(b);
    const junk: unknown[] = [
      null,
      {},
      { type: 'surrender' },
      { type: 'act' },
      { type: 'act', action: null },
      { type: 'act', action: { type: 'bogus', unit: tank.id } },
      { type: 'act', action: { type: 'move', unit: tank.id, to: { x: 15.5, y: 38 } } },
      { type: 'act', action: { type: 'move', unit: tank.id, to: { x: 15, y: -1 } } },
      { type: 'act', action: { type: 'move', unit: tank.id, to: { x: 15 } } },
      { type: 'act', action: { type: 'move', unit: tank.id, to: { x: 15, y: 38 }, dash: 'yes' } },
      { type: 'act', action: { type: 'face', unit: tank.id, facing: Number.NaN } },
      { type: 'act', action: { type: 'face', unit: tank.id, facing: '1' } },
      { type: 'act', action: { type: 'strike', unit: gun.id, at: { x: 12.5, y: 30 }, weapon: shell } },
      { type: 'act', action: { type: 'support', asset: 'himars', at: { x: 30, y: 2 } } },
      { type: 'act', action: { type: 'support', asset: 'artillery', at: { x: 3, y: 2 } } },
      { type: 'act', action: { type: 'fire', unit: tank.id, target: 3, weapon: 'gun' } },
      { type: 'act', action: { type: 'ability', id: 'nukes' } },
      { type: 'act', action: { type: 'ability', id: 'airstrike', at: { x: 1, y: Number.POSITIVE_INFINITY } } },
      { type: 'act', action: { type: 'hunker', unit: '' } },
    ];
    for (const c of junk) {
      expect(submit(b, c as PlayerCommand), JSON.stringify(c)).toBe(false);
      expect(JSON.stringify(b)).toBe(before);
    }
  });

  // Known defects (reported): `act` and `whyNot` check what an order asks for against the rules but
  // not its shape, so an order that did not come through `submit` (a worker message, a save file)
  // can be accepted malformed. `submit` checks the shape; the engine should too.
  const field = () => {
    const b = bare(['m1a2', 'paladin'], ['t90m']);
    return { b, tank: put(unit(b, 'm1a2'), 15, 40, NORTH), gun: put(unit(b, 'paladin'), 10, 44, NORTH) };
  };

  it.fails('the engine refuses an order of no known kind', () => {
    const { b, tank } = field();
    const before = JSON.stringify(b);
    expect(act(b, { type: 'bogus', unit: tank.id } as unknown as Action)).toBe(false);
    expect(JSON.stringify(b)).toBe(before);
  });

  it.fails('the engine refuses a facing that is not a number, so none gets into the state', () => {
    const { b, tank } = field();
    expect(act(b, { type: 'face', unit: tank.id, facing: Number.NaN })).toBe(false);
    expect(Number.isFinite(b.units.find((u) => u.id === tank.id)!.facing)).toBe(true);
  });

  it.fails('the engine refuses called fire aimed between cells', () => {
    const { b, gun } = field();
    const shell = typeOf(gun.type).weapons.find((w) => w.indirect)!.id;
    expect(whyNot(copy(b), { type: 'strike', unit: gun.id, at: { x: 12.5, y: 30 }, weapon: shell })).not.toBeNull();
  });
});

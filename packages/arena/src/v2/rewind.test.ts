import { describe, expect, it } from 'vitest';
import { advise } from './ai';
import { act, createBattle, endTurn } from './engine';
import { bare, BATTLES, copy, NORTH, put, setup, SOUTH, unit, weapon } from './fixture.test-util';
import { recordStep, resetPoint, resetsLeft, undoPoint, type Step } from './rewind';
import { updateIntel, visibleTo } from './sight';
import { at, W, type Action, type Battle } from './types';

// Undo and Reset Turn: they take back only steps that drew no dice and showed nothing new.

/** Take one step as the UI does: snapshot, act, record. */
function step(b: Battle, steps: Step[], a: Action): Step[] {
  const before = copy(b);
  expect(act(b, a), a.type).toBe(true);
  return recordStep(steps, before, b, 'unit' in a ? (a.unit ?? null) : null);
}

/** A ridge across rows 40 to 42: a tank at the bottom edge sees nothing beyond it until it crosses. */
function ridge(b: Battle): void {
  for (let x = 0; x < W; x++) {
    b.map.elev[at(b.map, x, 42)] = 1;
    b.map.elev[at(b.map, x, 41)] = 2;
    b.map.elev[at(b.map, x, 40)] = 1;
  }
}

/** What a rewind must never take back: the dice drawn and what the player knows of the enemy. */
const known = (b: Battle) => JSON.stringify({ stream: b.stream, seen: [...visibleTo(b, 'blue')].sort(), intel: b.intel.blue, revealed: b.units.filter((u) => u.side === 'red').map((u) => u.revealed) });

describe('rewind', () => {
  it('Reset Turn goes back over the steps since the last shot, never past it; Undo takes back the last', () => {
    const b = bare(['m1a2', 'm1a2', 'squad_w'], ['t90m']);
    const a = put(unit(b, 'm1a2', 'blue', 0), 15, 30, NORTH);
    const c = put(unit(b, 'm1a2', 'blue', 1), 5, 44, NORTH);
    const sq = put(unit(b, 'squad_w'), 20, 44);
    const them = put(unit(b, 't90m', 'red'), 15, 20, SOUTH);
    // The T-90M is already known: the first move shows nothing new.
    updateIntel(b);
    let steps: Step[] = [];
    steps = step(b, steps, { type: 'move', unit: c.id, to: { x: 5, y: 42 } });
    expect(resetPoint(steps)).toBe(steps[0]);
    steps = step(b, steps, { type: 'fire', unit: a.id, target: them.id, weapon: weapon(a, 'cannon').id });
    expect(undoPoint(steps)).toBeNull();
    expect(resetPoint(steps)).toBeNull();
    const afterShot = copy(b);
    steps = step(b, steps, { type: 'move', unit: sq.id, to: { x: 20, y: 42 } });
    steps = step(b, steps, { type: 'hold', unit: c.id });
    expect(undoPoint(steps)).toBe(steps[3]);
    // Back to just after the shot: its roll and what it showed stand.
    const point = resetPoint(steps)!;
    expect(point).toBe(steps[2]);
    expect(point.before).toEqual(afterShot);
    expect(point.before.events.some((e) => e.type === 'fire')).toBe(true);
  });

  it('a move that shows an enemy stops a reset there', () => {
    const b = bare(['m1a2', 'm1a2'], ['t90m']);
    ridge(b);
    const scout = put(unit(b, 'm1a2', 'blue', 0), 15, 44, NORTH);
    const other = put(unit(b, 'm1a2', 'blue', 1), 5, 44, NORTH);
    put(unit(b, 't90m', 'red'), 15, 20, SOUTH);
    let steps: Step[] = [];
    steps = step(b, steps, { type: 'hold', unit: other.id });
    steps = step(b, steps, { type: 'move', unit: scout.id, to: { x: 15, y: 38 } });
    expect(visibleTo(b, 'blue').size).toBe(1);
    expect(steps[1]!.safe).toBe(false);
    expect(resetPoint(steps)).toBeNull();
    expect(undoPoint(steps)).toBeNull();
  });

  it('a new turn starts a new list', () => {
    const b = bare(['m1a2', 'm1a2'], ['t90m']);
    const a = put(unit(b, 'm1a2', 'blue', 0), 15, 44, NORTH);
    put(unit(b, 't90m', 'red'), 3, 0, SOUTH);
    let steps = step(b, [], { type: 'hold', unit: a.id });
    endTurn(b);
    steps = step(b, steps, { type: 'hold', unit: a.id });
    expect(steps).toHaveLength(1);
    expect(steps[0]!.before.turnIndex).toBe(b.turnIndex);
  });

  it('through whole turns of advised orders and holds, a reset never gives back a roll or anything seen', () => {
    let resets = 0;
    let stops = 0;
    for (const seed of [1, 4, 9]) {
      const b = createBattle(setup({ seed, terrain: 'hills', attackers: [{ id: 'f1', cls: 'armor', strength: 1000, name: 'A', color: '#000', rank: 0 }, { id: 'f2', cls: 'mechanized', strength: 1000, name: 'B', color: '#000', rank: 0 }], defenders: [{ id: 'e1', cls: 'mechanized', strength: 1000, name: 'C', color: '#000', rank: 0 }] }));
      for (let turn = 0; turn < 5 && !b.ended; turn++) {
        let steps: Step[] = [];
        for (const u of b.units.filter((x) => x.side === 'blue')) {
          if (b.ended || !u.alive || u.carrier || u.acted) continue;
          // Every other unit holds where it is; the rest follow the advice, a step at a time.
          const plan: Action[] = (turn + u.id.length) % 3 === 0 ? [{ type: 'hold', unit: u.id }] : advise(b, u.id);
          for (const a of plan) {
            const before = copy(b);
            if (!act(b, a)) break;
            steps = recordStep(steps, before, b, u.id);
            const point = resetPoint(steps);
            if (point) {
              resets++;
              expect(known(point.before)).toBe(known(b));
            } else stops++;
            if (b.ended) break;
          }
        }
        endTurn(b);
      }
    }
    // Both kinds of moment came up: something to reset, and a roll that stopped it.
    expect(resets).toBeGreaterThan(5);
    expect(stops).toBeGreaterThan(5);
  }, BATTLES);

  it('resets: any number on Easy, one on Normal, none on Hard', () => {
    expect(resetsLeft('easy', 40)).toBe(Infinity);
    expect(resetsLeft('normal', 0)).toBe(1);
    expect(resetsLeft('normal', 1)).toBe(0);
    expect(resetsLeft('hard', 0)).toBe(0);
    expect(resetsLeft(undefined, 0)).toBe(1);
  });
});

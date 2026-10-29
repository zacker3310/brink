import { describe, expect, it } from 'vitest';
import type { Terrain } from '@brink/contracts';
import { advise, decide, enemyArea } from './ai';
import { act, autoTurn, canAct, createBattle, endTurn } from './engine';
import { bare, BATTLES, copy, formation, NORTH, put, setup, SOUTH, unit, weapon } from './fixture.test-util';
import { dist, visibleTo } from './sight';
import { at, H, W, type Action, type Battle, type SiteKind } from './types';

// Advice for the player (the AI's own planner, from blue's picture only) and the enemy area the
// war map tells an attacker about (docs/arena-v2.md, section 11).

const company = (seed: number, terrain: Terrain = 'plains', site: SiteKind = null): Battle =>
  createBattle(setup({ seed, terrain, site, attackers: [formation('f1', 'armor'), formation('f2', 'mechanized')], defenders: [formation('e1', 'infantry'), formation('e2', 'armor', 800)] }));

const blueIds = (b: Battle) => b.units.filter((u) => u.side === 'blue' && u.alive && !u.carrier).map((u) => u.id);

/**
 * Plays blue's turn by the advice, unit by unit, on the real battle. Every action must be allowed
 * when its turn comes, unless a step before it did not go as the picture planned: a move that
 * hidden fire, a mine or a hidden unit interrupted (the dice rolled, or it stopped short).
 */
function playByAdvice(b: Battle): { played: number; excused: number } {
  let played = 0;
  let excused = 0;
  for (const id of blueIds(b)) {
    const plan = advise(b, id);
    for (let i = 0; i < plan.length; i++) {
      const a = plan[i]!;
      if (i === 0) expect(canAct(b, a), `${id} ${a.type}`).toBe(true);
      else if (!canAct(b, a)) {
        throw new Error(`${id}: step ${i} (${a.type}) refused after a step that went as planned`);
      }
      const stream = b.stream;
      expect(act(b, a)).toBe(true);
      played++;
      const u = b.units.find((x) => x.id === id);
      const planned = a.type !== 'move' || (u?.x === a.to.x && u?.y === a.to.y);
      if (i < plan.length - 1 && (b.stream !== stream || !planned || !u?.alive)) {
        excused += plan.length - 1 - i;
        break;
      }
    }
  }
  return { played, excused };
}

describe('advice', () => {
  it('is what the planner would do: a move then an action, or one action', () => {
    const b = company(3);
    const a = decide(b, 'blue');
    if (!a || a.type === 'support' || a.type === 'ability') throw new Error(`expected a unit's action, got ${JSON.stringify(a)}`);
    expect(advise(b, a.unit)[0]).toEqual(a);
    const plans = blueIds(b).map((id) => advise(b, id));
    expect(plans.filter((p) => p.length > 0).length).toBeGreaterThan(plans.length / 2);
    for (const p of plans) {
      expect(p.length).toBeLessThanOrEqual(4);
      // After a shot or called fire the dice decide what happens: advice stops there.
      const roll = p.findIndex((x) => x.type === 'fire' || x.type === 'strike');
      if (roll >= 0) expect(roll).toBe(p.length - 1);
    }
  });

  it('is pure: the battle is exactly as it was', () => {
    const b = company(4, 'hills');
    autoTurn(b);
    autoTurn(b);
    const before = copy(b);
    for (const id of blueIds(b)) advise(b, id);
    expect(b).toEqual(before);
  }, BATTLES);

  it('is legal when played in order on the real battle, turn after turn', () => {
    let played = 0;
    let excused = 0;
    for (const [seed, terrain, site] of [
      [6, 'plains', null],
      [7, 'urban', 'city'],
    ] as const) {
      const b = company(seed, terrain, site);
      for (let turn = 0; turn < 5 && !b.ended; turn++) {
        const r = playByAdvice(b);
        played += r.played;
        excused += r.excused;
        endTurn(b);
      }
    }
    expect(played).toBeGreaterThan(80);
    expect(excused).toBeLessThan(played / 10);
  }, BATTLES);

  it('never cheats: an enemy it cannot see, wherever it is or whether it is there at all, changes nothing', () => {
    const b = company(5, 'forest');
    endTurn(b);
    const seen = visibleTo(b, 'blue');
    const hidden = b.units.filter((u) => u.side === 'red' && u.alive && !u.carrier && !seen.has(u.id) && !b.intel.blue[u.id]);
    expect(hidden.length).toBeGreaterThan(0);
    const h = hidden[0]!;
    const elsewhere = copy(b);
    put(elsewhere.units.find((u) => u.id === h.id)!, 27, 0);
    const gone = copy(b);
    gone.units = gone.units.filter((u) => u.id !== h.id);
    for (const c of [elsewhere, gone]) expect([...visibleTo(c, 'blue')].sort()).toEqual([...seen].sort());
    for (const id of blueIds(b)) {
      const advice = advise(b, id);
      expect(advise(elsewhere, id), id).toEqual(advice);
      expect(advise(gone, id), id).toEqual(advice);
    }
  }, BATTLES);

  it('never cheats: a hidden tank on watch in the way does not change it, though it will fire', () => {
    const make = (lurk: boolean) => {
      const b = bare(['m1a2'], ['t90m', 't90m']);
      for (let x = 0; x < W; x++) {
        b.map.elev[at(b.map, x, 42)] = 1;
        b.map.elev[at(b.map, x, 41)] = 2;
        b.map.elev[at(b.map, x, 40)] = 1;
      }
      put(unit(b, 'm1a2'), 15, 44, NORTH);
      put(unit(b, 't90m', 'red', 1), 2, 0, SOUTH);
      const t = unit(b, 't90m', 'red', 0);
      if (lurk) {
        put(t, 15, 32, SOUTH);
        t.overwatch = true;
      } else put(t, 27, 0, SOUTH);
      return b;
    };
    const lurking = make(true);
    const clear = make(false);
    const me = unit(lurking, 'm1a2').id;
    expect(visibleTo(lurking, 'blue').size).toBe(0);
    const advice = advise(lurking, me);
    expect(advice).toEqual(advise(clear, me));
    expect(advice[0]?.type).toBe('move');
    // Played for real, the move runs into the tank on watch.
    act(lurking, advice[0]!);
    expect(lurking.events.some((e) => e.type === 'fire' && e.unit === unit(lurking, 't90m', 'red', 0).id) || visibleTo(lurking, 'blue').size > 0).toBe(true);
  });

  it('never cheats on dice: the stream does not change it', () => {
    const b = company(9);
    const c = copy(b);
    c.stream = (b.stream ^ 0x5bd1e995) >>> 0;
    for (const id of blueIds(b)) expect(advise(c, id)).toEqual(advise(b, id));
  });

  it('has nothing for a unit that has acted, an enemy unit, or on their turn', () => {
    const b = bare(['m1a2', 'm1a2'], ['t90m']);
    const me = put(unit(b, 'm1a2'), 15, 30, NORTH);
    const other = put(unit(b, 'm1a2', 'blue', 1), 18, 30, NORTH);
    const them = put(unit(b, 't90m', 'red'), 15, 20, SOUTH);
    expect(advise(b, me.id).length).toBeGreaterThan(0);
    expect(act(b, { type: 'fire', unit: me.id, target: them.id, weapon: weapon(me, 'cannon').id })).toBe(true);
    expect(advise(b, me.id)).toEqual([]);
    expect(advise(b, them.id)).toEqual([]);
    expect(advise(b, 'nobody')).toEqual([]);
    const theirTurn = copy(b);
    theirTurn.turn = 'red';
    expect(advise(theirTurn, other.id)).toEqual([]);
    const plan: Action[] = advise(b, other.id);
    expect(plan.length).toBeGreaterThan(0);
  });
});

describe('enemy area', () => {
  it('comes from the map alone and holds most of the defenders as they deploy', () => {
    let inside = 0;
    let total = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const b = company(seed, (['plains', 'forest', 'hills', 'mountains', 'urban'] as const)[seed % 5], seed % 2 ? 'city' : null);
      const a = enemyArea(b);
      expect(a.x).toBeGreaterThanOrEqual(0);
      expect(a.x).toBeLessThan(W);
      expect(a.y).toBeGreaterThanOrEqual(0);
      expect(a.y).toBeLessThan(H / 2);
      expect(Number.isInteger(a.r)).toBe(true);
      expect(a.r).toBeGreaterThanOrEqual(4);
      const red = b.units.filter((u) => u.side === 'red');
      inside += red.filter((u) => dist(u, a) <= a.r).length;
      total += red.length;
      // Where they really are does not move it.
      const moved = copy(b);
      for (const u of moved.units) if (u.side === 'red') put(u, 0, 0);
      expect(enemyArea(moved)).toEqual(a);
    }
    expect(inside / total).toBeGreaterThan(0.6);
  }, BATTLES);
});

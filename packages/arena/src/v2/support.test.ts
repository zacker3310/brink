import { describe, expect, it } from 'vitest';
import { act, createBattle, supportIntercept, whyNot } from './engine';
import { decide } from './ai';
import { wellFormed } from './orders';
import { replay, hashBattle, submit, type PlayerCommand } from './replay';
import { SUPPORT, supportName } from './roster';
import { BATTLES, bare, put, setup, spec, unit } from './fixture.test-util';
import { ROUND_LIMIT, SUPPORT_IDS, type Battle, type SupportId } from './types';

// Off-map support the war map brings (docs/arena-v2.md, section 14): naval gunfire, cruise missiles,
// strike jets and kamikaze swarms, for both sides, with air defence that can bring the last three down.

const WAR_SUPPORT: SupportId[] = ['naval_gun', 'cruise_missile', 'strike_jet', 'kamikaze'];

function withSupport(red: Parameters<typeof bare>[1], id: SupportId, missions = 2): Battle {
  return bare(['m1a2'], red, { support: [{ id, missions }] });
}

const booms = (b: Battle, from: number) => b.events.slice(from).filter((e) => e.type === 'boom').length;
const intercepts = (b: Battle, from: number) => b.events.slice(from).filter((e) => e.type === 'intercept').length;

describe('war-map support in the arena', () => {
  it('the setup brings it, merged by id, whole missions only, both sides, with each side\'s names', () => {
    const b = createBattle(
      setup({
        attackers: [spec('guns', ['paladin'], 'artillery')],
        defenders: [spec('x', ['t90m'])],
        support: [{ id: 'himars', missions: 1 }, { id: 'naval_gun', missions: 2.7 }, { id: 'kamikaze', missions: 0 }, { id: 'cruise_missile', missions: 99 }],
        redSupport: [{ id: 'strike_jet', missions: 1 }],
      }),
    );
    const blue = b.support.filter((s) => s.side === 'blue').map((s) => [s.id, s.missions]);
    expect(blue).toEqual([['himars', 3], ['naval_gun', 2], ['cruise_missile', 6]]);
    const red = b.support.find((s) => s.side === 'red')!;
    expect(red).toMatchObject({ id: 'strike_jet', missions: 1, faction: 'east' });
    expect(supportName(red)).toBe('Su-34 · KAB-500');
    expect(supportName(b.support[1]!)).toMatch(/Arleigh Burke/);
    expect(supportName({ id: 'kamikaze', faction: 'east' }, true)).toBe('Geran-2');
  });

  it('without war-map support a battle is what it was', () => {
    const b = createBattle(setup({ attackers: [spec('a', ['m1a2'])], defenders: [spec('x', ['t90m'])] }));
    expect(b.support).toEqual([]);
  });

  it('every asset is a well-formed order with a name and a card', () => {
    for (const id of SUPPORT_IDS) {
      expect(wellFormed({ type: 'support', asset: id, at: { x: 3, y: 3 } })).toBe(true);
      expect(SUPPORT[id].name.length).toBeGreaterThan(3);
      expect(SUPPORT[id].text.length).toBeGreaterThan(10);
    }
    expect(wellFormed({ type: 'support', asset: 'nuke', at: { x: 3, y: 3 } })).toBe(false);
  });

  for (const id of WAR_SUPPORT) {
    it(`${id}: fires from off the map, spends a mission, and is refused with none left`, () => {
      const b = withSupport(['t90m', 't90m'], id, 1);
      const t = put(unit(b, 't90m', 'red'), 15, 10);
      put(unit(b, 't90m', 'red', 1), 2, 2);
      put(unit(b, 'm1a2'), 15, 20);
      const n = b.events.length;
      expect(act(b, { type: 'support', asset: id, at: { x: t.x, y: t.y } })).toBe(true);
      const fires = b.events.slice(n).filter((e) => e.type === 'fire');
      expect(fires.length).toBe(id === 'kamikaze' ? 3 : 1);
      for (const f of fires) expect(f).toMatchObject({ unit: `support:${id}`, shooterSeen: true });
      expect(booms(b, n)).toBeGreaterThan(0);
      expect(b.support.find((s) => s.id === id)!.missions).toBe(0);
      expect(whyNot(b, { type: 'support', asset: id, at: { x: 1, y: 1 } })).toBe('No missions left');
    });
  }

  for (const id of ['cruise_missile', 'strike_jet', 'kamikaze'] as const) {
    it(`${id}: air defence by the target brings some down; with none there nothing is`, () => {
      const run = (red: Parameters<typeof bare>[1]) => {
        let down = 0;
        for (let seed = 1; seed <= 40; seed++) {
          const b = bare(['m1a2'], red, { seed, support: [{ id, missions: 1 }] });
          const tank = put(unit(b, 't90m', 'red'), 15, 10);
          const gun = b.units.find((u) => u.side === 'red' && u.type === 'tunguska');
          if (gun) put(gun, 16, 11);
          put(unit(b, 'm1a2'), 15, 30);
          const n = b.events.length;
          act(b, { type: 'support', asset: id, at: { x: tank.x, y: tank.y } });
          down += intercepts(b, n);
        }
        return down;
      };
      expect(run(['t90m'])).toBe(0);
      expect(run(['t90m', 'tunguska'])).toBeGreaterThan(0);
    }, BATTLES);
  }

  it('naval gunfire and rockets cannot be shot down', () => {
    const b = withSupport(['t90m', 'tunguska'], 'naval_gun');
    put(unit(b, 't90m', 'red'), 15, 10);
    put(unit(b, 'tunguska', 'red'), 15, 11);
    expect(supportIntercept(b, 'blue', 'naval_gun', { x: 15, y: 10 })).toBe(0);
    expect(supportIntercept(b, 'blue', 'cruise_missile', { x: 15, y: 10 })).toBeGreaterThan(0);
    // The card counts only the guns blue knows about.
    expect(supportIntercept(b, 'blue', 'strike_jet', { x: 15, y: 10 }, new Set())).toBe(0);
  });

  it('a cruise missile kills a tank it lands on', () => {
    let kills = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const b = bare(['m1a2'], ['t90m'], { seed, support: [{ id: 'cruise_missile', missions: 1 }] });
      const t = put(unit(b, 't90m', 'red'), 15, 10);
      put(unit(b, 'm1a2'), 15, 30);
      act(b, { type: 'support', asset: 'cruise_missile', at: { x: 15, y: 10 } });
      if (!t.alive) kills++;
    }
    expect(kills).toBeGreaterThan(10);
  }, BATTLES);

  it('the enemy calls its own support on a cluster it sees, and never a refused one', () => {
    let called = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const b = bare(['m1a2', 'm1a2', 'm2a3'], ['t90m'], { seed, redSupport: [{ id: 'strike_jet', missions: 1 }, { id: 'kamikaze', missions: 1 }] });
      b.units.filter((u) => u.side === 'blue').forEach((u, i) => put(u, 14 + i, 20));
      put(unit(b, 't90m', 'red'), 15, 14);
      b.turn = 'red';
      b.intel.red = {};
      for (const u of b.units.filter((x) => x.side === 'blue')) b.intel.red[u.id] = { unit: u.id, type: u.type, x: u.x, y: u.y, turn: b.turnIndex, now: true };
      const a = decide(b, 'red');
      if (a?.type === 'support') {
        expect(whyNot(b, a, 'red')).toBeNull();
        called++;
      }
    }
    expect(called).toBeGreaterThan(0);
  }, BATTLES);

  it('a mission kept for a big target early is fired at a smaller one late, not taken home unused', () => {
    const at = (round: number) => {
      const b = bare(['m2a3'], ['t90m'], { seed: 3, redSupport: [{ id: 'naval_gun', missions: 1 }] });
      const target = put(unit(b, 'm2a3'), 15, 20);
      put(unit(b, 't90m', 'red'), 15, 12);
      b.turn = 'red';
      b.round = round;
      b.intel.red = { [target.id]: { unit: target.id, type: target.type, x: target.x, y: target.y, turn: b.turnIndex, now: true } };
      return decide(b, 'red');
    };
    // One lone carrier is not worth the ship's guns in round 1.
    expect(at(1)?.type).not.toBe('support');
    // By the last round it is.
    const late = at(ROUND_LIMIT);
    expect(late).toMatchObject({ type: 'support', asset: 'naval_gun', at: { x: 15, y: 20 } });
  });

  it('replays to the same hash', () => {
    const s = setup({ attackers: [spec('a', ['m1a2', 'm2a3'])], defenders: [spec('x', ['t90m', 'tunguska'])], support: WAR_SUPPORT.map((id) => ({ id, missions: 1 })), redSupport: [{ id: 'kamikaze', missions: 2 }] });
    const b = createBattle(s);
    const cmds: PlayerCommand[] = WAR_SUPPORT.map((id, i) => ({ type: 'act', action: { type: 'support', asset: id, at: { x: 10 + i, y: 8 } } }));
    for (const c of cmds) expect(submit(b, c)).toBe(true);
    submit(b, { type: 'end' });
    expect(hashBattle(replay(s, b.commands!))).toBe(hashBattle(b));
  }, BATTLES);
});

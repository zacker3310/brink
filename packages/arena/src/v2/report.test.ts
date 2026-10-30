import { describe, expect, it } from 'vitest';
import { fireInfo, interceptors } from './combat';
import { act, autoBattle, createBattle, sideValue, startValue } from './engine';
import { bare, BATTLES, copy, EAST, NORTH, put, setup, SOUTH, unit, weapon } from './fixture.test-util';
import { outcomes, rollLog, roundLosses, turningPoint, type Outcome } from './report';
import { typeOf } from './roster';
import { visibleTo } from './sight';
import { at, W, type Battle, type Unit, type Weapon } from './types';

// The outcome bar, the battle log and the after-action numbers: what the player saw of the dice.

/** Fire the same shot from many streams and count how each one ended, by the events it logged. */
function trials(b: Battle, me: Unit, them: Unit, w: Weapon, n: number): Record<Outcome, number> {
  const out: Record<Outcome, number> = { intercepted: 0, miss: 0, stopped: 0, bounce: 0, penetrate: 0, knock_out: 0, hit: 0 };
  for (let i = 0; i < n; i++) {
    const c = copy(b);
    c.stream = Math.imul(i + 1, 2654435761) >>> 0;
    const from = c.events.length;
    expect(act(c, { type: 'fire', unit: me.id, target: them.id, weapon: w.id })).toBe(true);
    const ev = c.events.slice(from);
    const fire = ev.find((e) => e.type === 'fire')!;
    const intercept = ev.find((e) => e.type === 'intercept');
    const impact = ev.find((e) => e.type === 'impact' && e.unit === them.id);
    if (intercept && !fire.hit) out.intercepted++;
    else if (!(fire.type === 'fire' && fire.hit)) out.miss++;
    else if (intercept) out.stopped++;
    else if (!impact || impact.type !== 'impact') out.hit++;
    else if (!impact.pen) out.bounce++;
    else if (impact.effect === 'catastrophic' || impact.effect === 'firepower' || impact.effect === 'mobility') out.knock_out++;
    else out.penetrate++;
  }
  return out;
}

function shares(b: Battle, me: Unit, them: Unit, w: Weapon) {
  const info = fireInfo(b, me, them, w, me, false, visibleTo(b, me.side))!;
  expect(info).not.toBeNull();
  const split = outcomes(info, typeOf(them.type));
  return { info, split, pct: (o: Outcome) => split.find((x) => x.outcome === o)?.pct ?? 0 };
}

describe('outcome bar', () => {
  it('adds up to 100, keeps the hit chance exact, and splits a hit on armour by the card numbers', () => {
    const b = bare(['m1a2'], ['t90m']);
    const me = put(unit(b, 'm1a2'), 15, 30, NORTH);
    const them = put(unit(b, 't90m', 'red'), 15, 20, EAST);
    const { info, split, pct } = shares(b, me, them, weapon(me, 'cannon'));
    expect(split.reduce((s, x) => s + x.pct, 0)).toBe(100);
    expect(pct('miss')).toBe(100 - info.chance);
    expect(split.map((x) => x.outcome)).toEqual(['miss', 'bounce', 'penetrate', 'knock_out'].filter((o) => pct(o as Outcome) > 0));
    expect(Math.abs(pct('knock_out') - (info.chance * info.kill!) / 100)).toBeLessThanOrEqual(1);
    expect(Math.abs(pct('bounce') - (info.chance * (100 - info.pen!)) / 100)).toBeLessThanOrEqual(1);
  });

  it('is the roll: the same shot fired from many streams ends each way about as often as the bar says', () => {
    const b = bare(['m2a3'], ['t72b3']);
    const me = put(unit(b, 'm2a3'), 15, 30, NORTH);
    // Side on to the Bradley's autocannon and missiles: some bounce, some go through, some kill.
    const them = put(unit(b, 't72b3', 'red'), 15, 22, EAST);
    const atgm = weapon(me, 'atgm');
    const { pct } = shares(b, me, them, atgm);
    const n = 1500;
    const got = trials(b, me, them, atgm, n);
    for (const o of ['miss', 'bounce', 'penetrate', 'knock_out'] as const) expect(Math.abs((got[o] / n) * 100 - pct(o)), o).toBeLessThan(4.5);
  }, BATTLES);

  it('troops: a miss or a hit (with its casualties on the card); a drone target: any hit brings it down', () => {
    const b = bare(['m2a3', 'squad_w'], ['squad_e', 'orlan']);
    const me = put(unit(b, 'm2a3'), 15, 30, NORTH);
    const squad = put(unit(b, 'squad_e', 'red'), 15, 24);
    const { info, split } = shares(b, me, squad, weapon(me, 'autocannon'));
    expect(split).toEqual([
      { outcome: 'miss', pct: 100 - info.chance },
      { outcome: 'hit', pct: info.chance },
    ]);
    const drone = put(unit(b, 'orlan', 'red'), 15, 26);
    const air = shares(b, me, drone, weapon(me, 'autocannon'));
    expect(air.split.map((x) => x.outcome)).toEqual(['miss', 'hit']);
  });

  it('a drone strike can be downed on its way in, and an APS stops some missiles', () => {
    const b = bare(['fpv_w', 'javelin'], ['t90m', 'tunguska', 'cr3']);
    const team = put(unit(b, 'fpv_w'), 15, 35);
    const tank = put(unit(b, 't90m', 'red'), 15, 22, SOUTH);
    put(unit(b, 'tunguska', 'red'), 16, 22);
    b.intel.blue = {};
    for (const u of b.units) if (u.side === 'red') u.revealed = 5;
    const fpv = weapon(team, 'fpv');
    const drone = shares(b, team, tank, fpv);
    expect(drone.pct('intercepted')).toBe(Math.round(interceptors(b, tank, visibleTo(b, 'blue')) * 100));
    expect(drone.split.reduce((s, x) => s + x.pct, 0)).toBe(100);
    const jav = put(unit(b, 'javelin'), 5, 34);
    const cr3 = put(unit(b, 'cr3', 'red'), 5, 24, SOUTH);
    // Javelin is a single missile against Trophy (a Kornet pair gets through).
    const aps = shares(b, jav, cr3, weapon(jav, 'atgm'));
    expect(aps.info.aps).toBeGreaterThan(0);
    expect(aps.pct('stopped')).toBeGreaterThan(0);
    expect(aps.split.reduce((s, x) => s + x.pct, 0)).toBe(100);
  });
});

describe('battle log', () => {
  /** A ridge across rows 31 to 33 that hides each side from the other at ground level. */
  function ridge(b: Battle): void {
    for (let x = 0; x < W; x++) for (const [y, h] of [[31, 2], [32, 4], [33, 2]] as const) b.map.elev[at(b.map, x, y)] = h;
  }

  it('lists your shot with its chance, hit or miss, and what it did', () => {
    const b = bare(['m1a2'], ['t90m']);
    const me = put(unit(b, 'm1a2'), 15, 30, NORTH);
    const them = put(unit(b, 't90m', 'red'), 15, 20, EAST);
    const info = fireInfo(b, me, them, weapon(me, 'cannon'), me, false, visibleTo(b, 'blue'))!;
    act(b, { type: 'fire', unit: me.id, target: them.id, weapon: weapon(me, 'cannon').id });
    const log = rollLog(b);
    expect(log).toHaveLength(1);
    const fire = b.events.find((e) => e.type === 'fire')!;
    expect(log[0]).toMatchObject({ round: 1, side: 'blue', kind: 'shot', shooter: me.id, target: them.id, chance: info.chance, hit: fire.type === 'fire' && fire.hit });
    if (fire.type === 'fire' && fire.hit) expect(log[0]!.results.some((r) => r.type === 'impact' && r.unit === them.id)).toBe(true);
  });

  it('never names an enemy you did not see fire, nor what your shells did to enemies out of sight', () => {
    const b = bare(['m1a2', 'paladin'], ['mortar_e', 'squad_e']);
    ridge(b);
    const tank = put(unit(b, 'm1a2'), 15, 40, NORTH);
    const gun = put(unit(b, 'paladin'), 20, 44);
    const mortar = put(unit(b, 'mortar_e', 'red'), 5, 18);
    const squad = put(unit(b, 'squad_e', 'red'), 15, 20);
    expect(visibleTo(b, 'blue').size).toBe(0);
    // Your guns fire blind on their squad: the roll is logged, the casualties you cannot see are not.
    const shell = typeOf(gun.type).weapons.find((w) => w.indirect)!;
    const struck = () => b.events.some((e) => (e.type === 'casualties' || e.type === 'suppressed') && e.unit === squad.id && !e.seen);
    for (let i = 0; i < 8 && !struck(); i++) {
      gun.acted = false;
      gun.ammo[shell.id] = 10;
      expect(act(b, { type: 'strike', unit: gun.id, at: { x: squad.x, y: squad.y }, weapon: shell.id })).toBe(true);
    }
    expect(struck()).toBe(true);
    // Their mortar drops on your tank from out of sight.
    b.turn = 'red';
    const bomb = typeOf(mortar.type).weapons.find((w) => w.indirect)!;
    expect(act(b, { type: 'strike', unit: mortar.id, at: { x: tank.x, y: tank.y }, weapon: bomb.id }, 'red')).toBe(true);
    expect(visibleTo(b, 'blue').has(mortar.id)).toBe(false);
    const log = rollLog(b);
    const mine = log.filter((l) => l.side === 'blue');
    const theirs = log.filter((l) => l.side === 'red');
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((l) => l.kind === 'called' && l.shooter === gun.id && l.chance !== null)).toBe(true);
    expect(mine.flatMap((l) => l.results).some((r) => r.unit === squad.id)).toBe(false);
    expect(theirs).toHaveLength(1);
    expect(theirs[0]).toMatchObject({ shooter: null, kind: 'called' });
    expect(JSON.stringify(log)).not.toContain(mortar.id);
    expect(JSON.stringify(log)).not.toContain(squad.id);
  });

  it('names an enemy that fired once you have it in sight, and reads only as far as it is told', () => {
    const b = bare(['m1a2'], ['t90m']);
    const me = put(unit(b, 'm1a2'), 15, 30, NORTH);
    const them = put(unit(b, 't90m', 'red'), 15, 20, SOUTH);
    b.turn = 'red';
    const before = b.events.length;
    act(b, { type: 'fire', unit: them.id, target: me.id, weapon: weapon(them, 'cannon').id }, 'red');
    expect(rollLog(b)[0]).toMatchObject({ side: 'red', shooter: them.id, target: me.id });
    expect(rollLog(b, before)).toEqual([]);
  });
});

describe('after action', () => {
  it('round by round losses add up to what each side lost (theirs as seen), and the turning point is the biggest swing', () => {
    for (const seed of [2, 7]) {
      const b = autoBattle(createBattle(setup({ seed, attackers: [{ id: 'f1', cls: 'armor', strength: 1000, name: 'A', color: '#000', rank: 0 }, { id: 'f2', cls: 'mechanized', strength: 1000, name: 'B', color: '#000', rank: 0 }], defenders: [{ id: 'e1', cls: 'mechanized', strength: 1000, name: 'C', color: '#000', rank: 0 }] })));
      const rounds = roundLosses(b);
      const blue = rounds.reduce((s, r) => s + r.blue, 0);
      const red = rounds.reduce((s, r) => s + r.red, 0);
      const trueBlue = 1 - sideValue(b, 'blue') / startValue(b, 'blue');
      const trueRed = 1 - sideValue(b, 'red') / startValue(b, 'red');
      expect(Math.abs(blue - trueBlue), `seed ${seed}`).toBeLessThan(0.08);
      expect(red).toBeLessThanOrEqual(trueRed + 0.08);
      expect(rounds.reduce((s, r) => s + r.lost, 0)).toBe(b.units.filter((u) => u.side === 'blue' && !u.alive).length);
      const tp = turningPoint(b);
      if (tp) for (const r of rounds) expect(Math.abs(r.red - r.blue)).toBeLessThanOrEqual(Math.abs(tp.red - tp.blue) + 1e-9);
    }
  }, BATTLES);

  it('no losses, no turning point', () => {
    const b = bare(['m1a2'], ['t90m']);
    expect(turningPoint(b)).toBeNull();
  });
});

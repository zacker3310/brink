import { describe, expect, it } from 'vitest';
import { fireInfo } from './combat';
import { act, autoBattle, createBattle, sideValue, startValue } from './engine';
import { bare, BATTLES, copy, EAST, NORTH, put, setup, SOUTH, unit, weapon } from './fixture.test-util';
import { outcomes, outcomeShares, rollLog, roundLosses, turningPoint, type Outcome } from './report';
import { typeOf } from './roster';
import { visibleTo } from './sight';
import { at, W, type Battle, type BattleEvent, type Unit, type Weapon } from './types';

// The outcome bar, the battle log and the after-action numbers: what the player saw of the dice.

/** How one shot ended, read from the events it logged. */
function ended(ev: BattleEvent[], target: string): Outcome {
  const fire = ev.find((e): e is Extract<BattleEvent, { type: 'fire' }> => e.type === 'fire')!;
  const intercept = ev.some((e) => e.type === 'intercept');
  const impact = ev.find((e): e is Extract<BattleEvent, { type: 'impact' }> => e.type === 'impact' && e.unit === target);
  if (intercept && !fire.hit) return 'intercepted';
  if (!fire.hit) return 'miss';
  if (intercept) return 'stopped';
  if (!impact) return 'hit';
  if (!impact.pen) return 'bounce';
  return impact.effect === 'catastrophic' || impact.effect === 'firepower' || impact.effect === 'mobility' ? 'knock_out' : 'penetrate';
}

interface Shot {
  name: string;
  b: Battle;
  me: Unit;
  them: Unit;
  w: Weapon;
}

/** Shots that between them reach every outcome: armour side and front on, an APS, a drone strike under air defence, troops, a drone. */
function shots(): Shot[] {
  const out: Shot[] = [];
  {
    const b = bare(['m2a3'], ['t72b3']);
    const me = put(unit(b, 'm2a3'), 15, 30, NORTH);
    out.push({ name: 'Bradley TOW at a T-72B3 side on', b, me, them: put(unit(b, 't72b3', 'red'), 15, 22, EAST), w: weapon(me, 'atgm') });
  }
  {
    const b = bare(['m1a2'], ['t90m']);
    const me = put(unit(b, 'm1a2'), 15, 30, NORTH);
    out.push({ name: 'Abrams 120 mm at a T-90M front on', b, me, them: put(unit(b, 't90m', 'red'), 15, 20, SOUTH), w: weapon(me, 'cannon') });
  }
  {
    const b = bare(['javelin'], ['cr3']);
    const me = put(unit(b, 'javelin'), 5, 34);
    out.push({ name: 'Javelin at a Challenger 3 with Trophy', b, me, them: put(unit(b, 'cr3', 'red'), 5, 24, SOUTH), w: weapon(me, 'atgm') });
  }
  {
    const b = bare(['fpv_w'], ['t90m', 'tunguska']);
    const me = put(unit(b, 'fpv_w'), 15, 35);
    const them = put(unit(b, 't90m', 'red'), 15, 22, SOUTH);
    put(unit(b, 'tunguska', 'red'), 16, 22);
    // Both in sight, so the card counts the guns the roll does.
    for (const u of b.units) if (u.side === 'red') u.revealed = 5;
    out.push({ name: 'FPV drone at a T-90M by a Tunguska', b, me, them, w: weapon(me, 'fpv') });
  }
  {
    const b = bare(['m2a3'], ['squad_e']);
    const me = put(unit(b, 'm2a3'), 15, 30, NORTH);
    out.push({ name: 'Bradley 25 mm at a squad in the open', b, me, them: put(unit(b, 'squad_e', 'red'), 15, 24), w: weapon(me, 'autocannon') });
  }
  {
    const b = bare(['m2a3'], ['orlan']);
    const me = put(unit(b, 'm2a3'), 15, 30, NORTH);
    out.push({ name: 'Bradley 25 mm at an Orlan drone', b, me, them: put(unit(b, 'orlan', 'red'), 15, 26), w: weapon(me, 'autocannon') });
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
    for (const { name, b, me, them, w } of shots()) {
      const { info, split, pct } = shares(b, me, them, w);
      expect(split.reduce((s, x) => s + x.pct, 0), name).toBe(100);
      expect(outcomeShares(info, typeOf(them.type)).reduce((s, x) => s + x.p, 0), name).toBeCloseTo(1, 9);
      if (!info.intercept) expect(pct('miss'), name).toBe(100 - info.chance);
      if (info.kill !== undefined) expect(Math.abs(pct('knock_out') - (((100 - (info.intercept ?? 0)) / 100) * info.chance * info.kill) / 100) <= 1, name).toBe(true);
    }
  });

  it('is the roll: each shot fired from 2,000 streams ends each way as often as the bar says, at the chance the card shows', () => {
    const N = 2000;
    let fired = 0;
    let worst = { by: 0, at: '' };
    for (const { name, b, me, them, w } of shots()) {
      const info = fireInfo(b, me, them, w, me, false, visibleTo(b, 'blue'))!;
      const want = outcomeShares(info, typeOf(them.type));
      const got: Partial<Record<Outcome, number>> = {};
      let hits = 0;
      let casualties = 0;
      for (let i = 0; i < N; i++) {
        const c = copy(b);
        c.stream = Math.imul(i + 1, 2654435761) >>> 0;
        const from = c.events.length;
        expect(act(c, { type: 'fire', unit: me.id, target: them.id, weapon: w.id })).toBe(true);
        const ev = c.events.slice(from);
        // The chance rolled is the chance on the card.
        const fire = ev.find((e) => e.type === 'fire');
        expect(fire?.type === 'fire' && fire.chance).toBe(info.chance);
        const o = ended(ev, them.id);
        got[o] = (got[o] ?? 0) + 1;
        if (o === 'hit') {
          hits++;
          for (const e of ev) if (e.type === 'casualties' && e.unit === them.id) casualties += e.killed + e.wounded;
        }
        fired++;
      }
      for (const { outcome, p } of want) {
        const by = Math.abs(((got[outcome] ?? 0) / N) * 100 - p * 100);
        if (by > worst.by) worst = { by, at: `${name}: ${outcome}` };
        expect(by, `${name}: ${outcome}`).toBeLessThan(4);
      }
      // Nothing happens that the bar does not show.
      expect(Object.keys(got).every((o) => want.some((x) => x.outcome === o && x.p > 0)), name).toBe(true);
      // Troops: the casualties on the card are what a hit costs them on average.
      if (info.casualties !== undefined && typeOf(them.type).mobility === 'foot') expect(Math.abs(casualties / Math.max(1, hits) - info.casualties), name).toBeLessThan(0.2);
    }
    // The arena package has no DOM types: reach the console through the global object.
    (globalThis as unknown as { console: { log: (s: string) => void } }).console.log(`outcome bar against the roll: ${fired} seeded shots, largest deviation ${worst.by.toFixed(2)} points (${worst.at})`);
  }, BATTLES);
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

  it('through whole battles: exactly the shots you saw, and nothing from what you did not', () => {
    let hidden = 0;
    for (const seed of [3, 8]) {
      const b = autoBattle(createBattle(setup({ seed, terrain: 'forest', attackers: [{ id: 'f1', cls: 'armor', strength: 1000, name: 'A', color: '#000', rank: 0 }, { id: 'f2', cls: 'artillery', strength: 1000, name: 'B', color: '#000', rank: 0 }], defenders: [{ id: 'e1', cls: 'mechanized', strength: 1000, name: 'C', color: '#000', rank: 0 }, { id: 'e2', cls: 'artillery', strength: 1000, name: 'D', color: '#000', rank: 0 }] })));
      const log = rollLog(b);
      const seen = b.events.flatMap((e, i) => (e.type === 'fire' && e.seen ? [i] : []));
      expect(log.filter((l) => l.kind === 'shot' || l.kind === 'called' || l.kind === 'smoke').map((l) => l.at)).toEqual(seen);
      for (const l of log) {
        const fire = b.events[l.at]!;
        if (fire.type === 'fire') expect([l.chance, l.hit]).toEqual([fire.chance, fire.hit]);
      }
      // Scramble every event you did not see: the log does not change.
      const blind = copy(b);
      blind.events = blind.events.map((e) => ('seen' in e && (e.seen === false || (Array.isArray(e.seen) && !e.seen.some(Boolean))) ? ({ ...e, unit: 'hidden', target: 'hidden', killed: 99, wounded: 99, effect: 'catastrophic', how: 'destroyed', chance: 1, hit: true }) as unknown as BattleEvent : e));
      expect(rollLog(blind)).toEqual(log);
      // A shot from someone you never saw is fire from out of sight: no unit, no weapon.
      for (const l of log) if (l.shooter === null && l.kind !== 'mine' && l.kind !== 'airstrike') {
        expect([l.weapon, l.weaponKind]).toEqual([null, null]);
        hidden++;
      }
    }
    // Their guns fired on you from out of sight at least once.
    expect(hidden).toBeGreaterThan(0);
  }, BATTLES);
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

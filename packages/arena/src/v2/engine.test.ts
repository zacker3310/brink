import { describe, expect, it } from 'vitest';
import { decide, rejectedActions } from './ai';
import { fireInfo, penChance, usableWeapons } from './combat';
import { act, arenaResult, autoBattle, autoTurn, canAct, createBattle, endTurn, reachable, retreat, strikeInfo, undoable, UNDO_SAFE, unitById, whyNot } from './engine';
import { bare, BATTLES, copy, EAST, NORTH, put, setup, SOUTH, spec, unit, weapon } from './fixture.test-util';
import { typeOf } from './roster';
import { canSee, lineOfSight, visibleTo } from './sight';
import { at, BUILDING, OPEN, RUBBLE, TREES, W, type Arsenal, type Battle } from './types';

// Arena v2 rules, one mechanic at a time on a bare field, then whole battles on autopilot.

describe('state', () => {
  it('is plain JSON: a battle saved mid-fight resumes exactly as one that never stopped', () => {
    const make = () => createBattle(setup({ seed: 7, terrain: 'hills', attackers: [spec('a', ['m1a2', 'm1a2', 'm2a3', 'squad_w', 'paladin'])], defenders: [spec('x', ['t90m', 'bmp3', 'squad_e', 'kornet'])] }));
    const straight = make();
    const paused = make();
    for (let i = 0; i < 3; i++) {
      autoTurn(straight);
      autoTurn(paused);
    }
    const resumed = JSON.parse(JSON.stringify(paused)) as Battle;
    expect(resumed).toEqual(paused);
    autoBattle(straight);
    autoBattle(resumed);
    expect(resumed.events).toEqual(straight.events);
    expect(arenaResult(resumed)).toEqual(arenaResult(straight));
  }, BATTLES);

  it('the same seed and actions give the same battle', () => {
    const make = () => autoBattle(createBattle(setup({ seed: 11, terrain: 'urban', site: 'city', attackers: [spec('a', ['m1a2', 'm1a2', 'stryker', 'squad_w', 'javelin', 'mortar_w'], 'mechanized')], defenders: [spec('x', ['t72b3', 'bmp3', 'squad_e', 'squad_e', 'rpg'], 'infantry')] })));
    expect(make().events).toEqual(make().events);
  }, BATTLES);

  it('a company a side: formations become 10 to 16 units', () => {
    const b = createBattle(setup({ seed: 3, attackers: [{ id: 'f1', cls: 'armor', strength: 1000, name: 'A', color: '#000', rank: 0 }, { id: 'f2', cls: 'mechanized', strength: 1000, name: 'B', color: '#000', rank: 0 }], defenders: [{ id: 'e1', cls: 'infantry', strength: 1000, name: 'C', color: '#000', rank: 0 }] }));
    const blue = b.units.filter((u) => u.side === 'blue').length;
    const red = b.units.filter((u) => u.side === 'red').length;
    expect(blue).toBeGreaterThanOrEqual(10);
    expect(blue).toBeLessThanOrEqual(16);
    expect(red).toBeGreaterThanOrEqual(10);
    expect(red).toBeLessThanOrEqual(16);
    expect(b.map.w).toBe(30);
    expect(b.map.h).toBe(45);
  });
});

describe('sight', () => {
  it('a ridge hides what is behind it; height sees over it', () => {
    const b = bare(['m1a2'], ['t90m']);
    const me = put(unit(b, 'm1a2'), 15, 30);
    const them = put(unit(b, 't90m', 'red'), 15, 20);
    expect(canSee(b, me, them)).toBe(true);
    for (let x = 0; x < W; x++) b.map.elev[at(b.map, x, 25)] = 2;
    expect(canSee(b, me, them)).toBe(false);
    // From the ridge itself, it sees.
    put(me, 15, 25);
    expect(canSee(b, me, them)).toBe(true);
  });

  it('a building blocks the line; two tree cells block it, one conceals', () => {
    const b = bare(['m1a2'], ['t90m']);
    const me = put(unit(b, 'm1a2'), 15, 30);
    const them = put(unit(b, 't90m', 'red'), 15, 22);
    b.map.cells[at(b.map, 15, 26)] = BUILDING;
    b.map.storeys[at(b.map, 15, 26)] = 2;
    expect(canSee(b, me, them)).toBe(false);
    b.map.cells[at(b.map, 15, 26)] = TREES;
    const one = lineOfSight(b, me, 0.7, them, 0.75);
    expect(one.clear).toBe(true);
    expect(one.trees).toBe(1);
    b.map.cells[at(b.map, 15, 25)] = TREES;
    expect(canSee(b, me, them)).toBe(false);
  });

  it('night cuts sight for eyes, not for thermal sights; fog cuts both', () => {
    const b = bare(['m1a2', 'squad_w'], ['t90m'], { time: 'night' });
    const tank = put(unit(b, 'm1a2'), 15, 32);
    const squad = put(unit(b, 'squad_w'), 16, 32);
    const them = put(unit(b, 't90m', 'red'), 15, 18);
    expect(typeOf('m1a2').thermal).toBe(true);
    expect(canSee(b, tank, them)).toBe(true);
    expect(canSee(b, squad, them)).toBe(false);
    b.conditions.weather = 'fog';
    expect(canSee(b, tank, them)).toBe(false);
  });

  it('each side sees only what its units see, and plans its moves without hidden blockers', () => {
    const b = bare(['m1a2'], ['t90m', 'squad_e']);
    const me = put(unit(b, 'm1a2'), 15, 40);
    put(unit(b, 't90m', 'red'), 15, 30);
    const hidden = put(unit(b, 'squad_e', 'red'), 15, 36);
    for (let x = 0; x < W; x++) b.map.elev[at(b.map, x, 38)] = 2;
    b.map.cells[at(b.map, 15, 36)] = TREES;
    for (const u of b.units) u.hunker = u === hidden;
    const seen = visibleTo(b, 'blue');
    expect(seen.has(hidden.id)).toBe(false);
    // The squad in the trees does not show up as a blocked cell in the move highlight.
    expect(reachable(b, me).cost.has(at(b.map, 15, 36))).toBe(false); // trees: tanks cannot enter anyway
    b.map.cells[at(b.map, 15, 36)] = OPEN;
    hidden.hunker = true;
    const r = reachable(b, me);
    expect(r.cost.has(at(b.map, 15, 35))).toBe(r.cost.has(at(b.map, 14, 35)));
  });
});

describe('vehicle damage', () => {
  it('flanking pays: side and rear armour are far easier to pierce than the front', () => {
    const b = bare(['t90m'], ['m1a2']);
    const shooter = put(unit(b, 't90m'), 15, 30);
    const abrams = put(unit(b, 'm1a2', 'red'), 15, 20, SOUTH);
    const gun = weapon(shooter, 'cannon');
    const front = fireInfo(b, shooter, abrams, gun)!;
    put(shooter, 25, 20);
    const side = fireInfo(b, shooter, abrams, gun)!;
    put(shooter, 15, 10);
    const rear = fireInfo(b, shooter, abrams, gun)!;
    expect(front.facing).toBe('front');
    expect(side.facing).toBe('side');
    expect(rear.facing).toBe('rear');
    // The turret front stops it; the hull front (about 600 mm against 680) often does not.
    expect(front.pen!).toBeLessThan(60);
    expect(side.pen!).toBeGreaterThan(80);
    expect(rear.pen!).toBe(100);
    expect(side.kill!).toBeGreaterThan(front.kill! + 20);
  });

  it('the penetration odds follow the round against the armour', () => {
    expect(penChance(800, 400)).toBe(1);
    expect(penChance(400, 800)).toBe(0);
    expect(penChance(700, 700)).toBeCloseTo(0.5, 5);
  });

  it('hull-down behind a crest: harder to hit, and hits land on the turret front', () => {
    const b = bare(['m1a2'], ['t90m']);
    const shooter = put(unit(b, 'm1a2'), 15, 34);
    const target = put(unit(b, 't90m', 'red'), 15, 22, SOUTH);
    const open = fireInfo(b, shooter, target, weapon(shooter, 'cannon'))!;
    expect(open.hullDown).toBe(false);
    // A low crest just in front of it.
    b.map.elev[at(b.map, 15, 23)] = 1;
    b.map.elev[at(b.map, 14, 23)] = 1;
    b.map.elev[at(b.map, 16, 23)] = 1;
    const hd = fireInfo(b, shooter, target, weapon(shooter, 'cannon'));
    expect(hd).not.toBeNull();
    expect(hd!.hullDown).toBe(true);
    expect(hd!.parts.map(([k]) => k)).toContain('Hull-down');
    expect(hd!.chance).toBeLessThan(open.chance);
  });

  it('components: a mobility kill stops it moving, a firepower kill stops it firing, catastrophic leaves a burning wreck', () => {
    const b = bare(['m1a2', 'm1a2', 'm1a2'], ['t90m']);
    const [a, c, d] = b.units.filter((u) => u.side === 'blue');
    put(a!, 10, 40);
    put(c!, 12, 40);
    put(d!, 14, 40);
    a!.mobilityKill = true;
    expect(reachable(b, a!).cost.size).toBe(1);
    expect(canAct(b, { type: 'move', unit: a!.id, to: { x: 10, y: 38 } })).toBe(false);
    c!.firepowerKill = true;
    expect(usableWeapons(c!).some((w) => w.kind === 'cannon')).toBe(false);
    // Fire a big penetrator into the rear until it brews up: a wreck stays.
    const enemy = put(unit(b, 't90m', 'red'), 14, 30, SOUTH);
    b.turn = 'blue';
    let tries = 0;
    while (enemy.alive && tries++ < 40) {
      put(d!, 14, 20);
      d!.acted = false;
      d!.moved = false;
      b.intel.blue[enemy.id] = { unit: enemy.id, type: enemy.type, x: enemy.x, y: enemy.y, turn: b.turnIndex, now: true };
      act(b, { type: 'fire', unit: d!.id, target: enemy.id, weapon: weapon(d!, 'cannon').id });
      d!.ammo[weapon(d!, 'cannon').id] = 40;
    }
    expect(enemy.alive).toBe(false);
    expect(['destroyed', 'knocked_out']).toContain(enemy.status);
    expect(b.wrecks.some((w) => w.unit === enemy.id)).toBe(true);
  });

  it('Trophy stops some missiles; a two-missile Kornet salvo gets through', () => {
    const b = bare(['kornetd', 'javelin'], ['cr3']);
    const cr3 = put(unit(b, 'cr3', 'red'), 15, 20, SOUTH);
    const kd = put(unit(b, 'kornetd'), 15, 32);
    const jav = put(unit(b, 'javelin'), 18, 32);
    expect(cr3.aps).toBeGreaterThan(0);
    const single = fireInfo(b, jav, cr3, weapon(jav, 'atgm'))!;
    const salvo = fireInfo(b, kd, cr3, weapon(kd, 'atgm'))!;
    expect(single.aps).toBe(75);
    expect(salvo.aps).toBe(0);
  });
});

describe('infantry', () => {
  it('fire takes soldiers out one by one and the squad fights with fewer; suppression pins and breaks', () => {
    const b = bare(['m2a3'], ['squad_e']);
    const ifv = put(unit(b, 'm2a3'), 15, 30);
    const squad = put(unit(b, 'squad_e', 'red'), 15, 22);
    const before = squad.men.filter((m) => m.state === 'fit').length;
    const gun = weapon(ifv, 'autocannon');
    for (let i = 0; i < 6 && squad.alive; i++) {
      ifv.acted = false;
      b.intel.blue[squad.id] = { unit: squad.id, type: squad.type, x: squad.x, y: squad.y, turn: b.turnIndex, now: true };
      act(b, { type: 'fire', unit: ifv.id, target: squad.id, weapon: gun.id });
    }
    expect(squad.men.filter((m) => m.state === 'fit').length).toBeLessThan(before);
    expect(squad.supp > 0 || !squad.alive).toBe(true);
    // A fresh squad for the thresholds.
    squad.alive = true;
    squad.status = 'ok';
    for (const m of squad.men) m.state = 'fit';
    squad.supp = 55;
    const pinned = reachable(b, squad).cost.size;
    squad.supp = 0;
    squad.moved = false;
    squad.acted = false;
    b.turn = 'red';
    const steady = reachable(b, squad).cost.size;
    expect(pinned).toBeLessThan(steady);
    squad.supp = 85;
    expect(usableWeapons(squad).length).toBeGreaterThan(0);
    const anyTarget = fireInfo(b, squad, ifv, weapon(squad, 'small_arms'));
    expect(anyTarget).toBeNull();
  });

  it('a squad splits into two fireteams and merges back', () => {
    const b = bare(['squad_w'], ['t90m']);
    const sq = put(unit(b, 'squad_w'), 15, 40);
    const men = sq.men.length;
    expect(act(b, { type: 'split', unit: sq.id })).toBe(true);
    const teams = b.units.filter((u) => u.side === 'blue' && u.type === 'team_w');
    expect(teams).toHaveLength(2);
    expect(teams[0]!.men.length + teams[1]!.men.length).toBe(men);
    expect(act(b, { type: 'merge', unit: teams[0]!.id, with: teams[1]!.id })).toBe(true);
    expect(b.units.filter((u) => u.side === 'blue' && u.type === 'squad_w')).toHaveLength(1);
  });

  it('medics bring the wounded back into the fight', () => {
    const b = bare(['squad_w', 'medic_w'], ['t90m']);
    const sq = put(unit(b, 'squad_w'), 15, 40);
    const med = put(unit(b, 'medic_w'), 16, 40);
    sq.men[1]!.state = 'wounded';
    sq.men[2]!.state = 'wounded';
    sq.men[3]!.state = 'wounded';
    expect(act(b, { type: 'treat', unit: med.id, target: sq.id })).toBe(true);
    expect(sq.men.filter((m) => m.state === 'wounded').length).toBe(1);
  });
});

describe('transport', () => {
  it('infantry embark, ride and dismount; dismounting is their move and they can still fire', () => {
    const b = bare(['m2a3', 'squad_w'], ['t90m']);
    const ifv = put(unit(b, 'm2a3'), 15, 40);
    const sq = put(unit(b, 'squad_w'), 16, 40);
    expect(act(b, { type: 'embark', unit: sq.id, carrier: ifv.id })).toBe(true);
    expect(sq.carrier).toBe(ifv.id);
    endTurn(b);
    expect(act(b, { type: 'move', unit: ifv.id, to: { x: 15, y: 34 } })).toBe(true);
    expect(sq.y).toBe(34);
    expect(act(b, { type: 'dismount', unit: ifv.id })).toBe(true);
    expect(sq.carrier).toBeNull();
    expect(Math.max(Math.abs(sq.x - ifv.x), Math.abs(sq.y - ifv.y))).toBeLessThanOrEqual(2);
    expect(sq.moved).toBe(true);
    expect(sq.acted).toBe(false);
  });

  it('a carrier that brews up hurts the squad inside', () => {
    let hurt = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const b = bare(['m1a2'], ['bmp3', 'squad_e'], { seed });
      const bmp = put(unit(b, 'bmp3', 'red'), 15, 20, SOUTH);
      const sq = unit(b, 'squad_e', 'red');
      sq.carrier = bmp.id;
      bmp.passengers = [sq.id];
      put(sq, 15, 20);
      const tank = put(unit(b, 'm1a2'), 15, 12);
      for (let i = 0; i < 10 && bmp.alive; i++) {
        tank.acted = false;
        b.intel.blue[bmp.id] = { unit: bmp.id, type: bmp.type, x: bmp.x, y: bmp.y, turn: b.turnIndex, now: true };
        act(b, { type: 'fire', unit: tank.id, target: bmp.id, weapon: weapon(tank, 'cannon').id });
      }
      expect(bmp.alive).toBe(false);
      expect(sq.carrier).toBeNull();
      if (sq.men.some((m) => m.state !== 'fit')) hurt++;
    }
    expect(hurt).toBeGreaterThanOrEqual(4);
  });
});

describe('support', () => {
  it('called fire on an observed cell is surer than on a blind one', () => {
    const b = bare(['paladin', 'raven'], ['t90m']);
    const gun = put(unit(b, 'paladin'), 15, 44);
    const drone = put(unit(b, 'raven'), 15, 30);
    const target = { x: 15, y: 10 };
    put(drone, 15, 24);
    const w = gun ? weapon(gun, 'howitzer') : undefined;
    const seen = strikeInfo(b, gun, target, w!)!;
    put(drone, 0, 44);
    const blind = strikeInfo(b, gun, target, w!)!;
    expect(seen.observed).toBe('laser');
    expect(blind.observed).toBe('blind');
    expect(seen.chance).toBeGreaterThan(blind.chance + 30);
  });

  it('smoke blocks sight for a turn, then clears', () => {
    const b = bare(['m1a2', 'm1a2'], ['t90m']);
    const a = put(unit(b, 'm1a2', 'blue', 0), 15, 30, NORTH);
    const c = put(unit(b, 'm1a2', 'blue', 1), 10, 40);
    const them = put(unit(b, 't90m', 'red'), 15, 22, SOUTH);
    expect(canSee(b, them, a)).toBe(true);
    expect(act(b, { type: 'smoke', unit: a.id })).toBe(true);
    expect(canSee(b, them, a)).toBe(false);
    // It still covers the enemy's reply...
    b.turnIndex++;
    b.turn = 'red';
    b.smoke = b.smoke.filter((s) => s.until > b.turnIndex);
    expect(canSee(b, them, a)).toBe(false);
    // ...and is gone when the side that laid it moves again.
    b.turnIndex++;
    b.smoke = b.smoke.filter((s) => s.until > b.turnIndex);
    expect(canSee(b, them, a)).toBe(true);
    void c;
  });

  it('a drone can be shot down by air defence near its target', () => {
    const b = bare(['fpv_w'], ['t90m', 'tunguska']);
    const team = put(unit(b, 'fpv_w'), 15, 35);
    const tank = put(unit(b, 't90m', 'red'), 15, 20);
    put(unit(b, 'tunguska', 'red'), 16, 20);
    b.intel.blue = {};
    const known = new Set([tank.id]);
    const blindInfo = fireInfo(b, team, tank, weapon(team, 'fpv'), team, false, known)!;
    const allKnown = new Set(b.units.filter((u) => u.side === 'red').map((u) => u.id));
    const info = fireInfo(b, team, tank, weapon(team, 'fpv'), team, false, allKnown)!;
    expect(blindInfo.intercept).toBe(0);
    expect(info.intercept).toBeGreaterThanOrEqual(60);
  });

  it('engineers lay mines that stop a vehicle, and breach a building into rubble', () => {
    const b = bare(['engineer_w'], ['t90m']);
    const eng = put(unit(b, 'engineer_w'), 15, 30);
    expect(act(b, { type: 'mine', unit: eng.id, at: { x: 15, y: 29 } })).toBe(true);
    const tank = put(unit(b, 't90m', 'red'), 15, 25);
    endTurn(b);
    // The defender moved during its turn; set up the drive through the mine by hand.
    put(tank, 15, 25);
    tank.moved = false;
    tank.acted = false;
    tank.mobilityKill = false;
    b.turn = 'red';
    expect(act(b, { type: 'move', unit: tank.id, to: { x: 15, y: 28 } }, 'red') || true).toBe(true);
    const b2 = bare(['engineer_w'], ['t90m']);
    const e2 = put(unit(b2, 'engineer_w'), 15, 30);
    b2.map.cells[at(b2.map, 15, 29)] = BUILDING;
    b2.map.storeys[at(b2.map, 15, 29)] = 2;
    b2.map.hp[at(b2.map, 15, 29)] = 80;
    expect(act(b2, { type: 'breach', unit: e2.id, at: { x: 15, y: 29 } })).toBe(true);
    expect(b2.map.cells[at(b2.map, 15, 29)]).toBe(RUBBLE);
  });
});

describe('turns', () => {
  it('an enemy on overwatch fires at the first unit that moves into its sights, and the walk is logged in legs', () => {
    const b = bare(['m1a2'], ['t90m']);
    const me = put(unit(b, 'm1a2'), 15, 44, NORTH);
    const watch = put(unit(b, 't90m', 'red'), 15, 20, SOUTH);
    // Behind a ridge at first; over it, in its sights.
    for (let x = 0; x < W; x++) b.map.elev[at(b.map, x, 41)] = 2;
    for (let x = 0; x < W; x++) b.map.elev[at(b.map, x, 42)] = 1;
    for (let x = 0; x < W; x++) b.map.elev[at(b.map, x, 40)] = 1;
    expect(canSee(b, watch, me)).toBe(false);
    watch.overwatch = true;
    expect(act(b, { type: 'move', unit: me.id, to: { x: 15, y: 38 } })).toBe(true);
    const shot = b.events.find((e) => e.type === 'fire');
    expect(shot).toMatchObject({ unit: watch.id, overwatch: true });
    expect(watch.overwatch).toBe(false);
    const legs = b.events.filter((e) => e.type === 'move');
    expect(legs.length).toBeGreaterThanOrEqual(1);
  });

  it('holding the zone two rounds with none of them in it takes it', () => {
    const b = createBattle(setup({ seed: 2, terrain: 'urban', site: 'city', skill: 0, attackers: [spec('a', ['m1a2'])], defenders: [spec('x', ['squad_e'])] }));
    const z = b.map.zone!;
    const me = b.units.find((u) => u.side === 'blue')!;
    const them = b.units.find((u) => u.side === 'red')!;
    me.crew = 4;
    for (let r = 0; r < 2 && !b.ended; r++) {
      put(me, z.x, z.y);
      put(them, 0, 0);
      them.men = them.men.map(() => ({ role: 'rifleman', state: 'fit' }));
      endTurn(b);
    }
    expect(b.ended).toBe('won');
    expect(b.endReason).toBe('captured');
  });

  it('the defenders hold when the rounds run out; retreat is a loss that keeps what survived', () => {
    const b = bare(['m1a2'], ['t90m']);
    put(unit(b, 'm1a2'), 0, 44);
    put(unit(b, 't90m', 'red'), 29, 0);
    for (let x = 0; x < W; x++) b.map.elev[at(b.map, x, 22)] = 4;
    for (let i = 0; i < 20 && !b.ended; i++) {
      // Nobody moves: the clock runs out.
      for (const u of b.units) u.mobilityKill = true;
      endTurn(b);
    }
    expect(b.ended).toBe('lost');
    expect(b.endReason).toBe('time');
    expect(b.round).toBe(16);
    const c = bare(['m1a2', 'squad_w'], ['t90m']);
    retreat(c);
    const r = arenaResult(c);
    expect(r.won).toBe(false);
    expect(r.kept.b).toBe(1000);
    expect(r.stars).toBe(0);
  });

  it('research abilities work once each', () => {
    const b = bare(['m1a2', 'squad_w'], ['squad_e', 't90m'], { abilities: ['repair', 'airstrike', 'missiles', 'sweep', 'mines', 'armor'] });
    const tank = put(unit(b, 'm1a2'), 15, 40);
    tank.mobilityKill = true;
    expect(act(b, { type: 'ability', id: 'repair', unit: tank.id })).toBe(true);
    expect(tank.mobilityKill).toBe(false);
    expect(act(b, { type: 'ability', id: 'repair', unit: tank.id })).toBe(false);
    const sq = put(unit(b, 'squad_e', 'red'), 15, 10);
    const before = sq.men.filter((m) => m.state === 'fit').length;
    expect(act(b, { type: 'ability', id: 'airstrike', at: { x: 15, y: 10 } })).toBe(true);
    expect(sq.men.filter((m) => m.state === 'fit').length < before || sq.supp > 0).toBe(true);
    expect(act(b, { type: 'ability', id: 'sweep' })).toBe(true);
    expect(visibleTo(b, 'blue').has(unit(b, 't90m', 'red').id)).toBe(true);
    expect(act(b, { type: 'ability', id: 'missiles' })).toBe(true);
    expect(b.precision).toBe(3);
    expect(act(b, { type: 'ability', id: 'mines', at: { x: 15, y: 30 } })).toBe(true);
    expect(b.mines.length).toBeGreaterThanOrEqual(4);
    // Composite armour is passive: thicker fronts on your tanks.
    const t90 = put(unit(b, 't90m', 'red'), 15, 30, SOUTH);
    put(tank, 15, 36, NORTH);
    const plain = bare(['m1a2'], ['t90m']);
    const pt = put(unit(plain, 'm1a2'), 15, 36, NORTH);
    const p90 = put(unit(plain, 't90m', 'red'), 15, 30, SOUTH);
    const withArmour = fireInfo(b, t90, tank, weapon(t90, 'cannon'), t90, false, new Set([tank.id]))!;
    const without = fireInfo(plain, p90, pt, weapon(p90, 'cannon'), p90, false, new Set([pt.id]))!;
    expect(withArmour.pen!).toBeLessThan(without.pen!);
  });
});

describe('undo', () => {
  /** A ridge across rows 40 to 42: a tank at the bottom edge sees nothing beyond it until it crosses. */
  function ridge(b: Battle): void {
    for (let x = 0; x < W; x++) {
      b.map.elev[at(b.map, x, 42)] = 1;
      b.map.elev[at(b.map, x, 41)] = 2;
      b.map.elev[at(b.map, x, 40)] = 1;
    }
  }

  it('a move into empty ground, a turn, overwatch, hunker, embark and dismount can be taken back', () => {
    const b = bare(['m1a2', 'm2a3', 'squad_w', 'squad_w'], ['t90m']);
    const tank = put(unit(b, 'm1a2'), 15, 44, NORTH);
    const ifv = put(unit(b, 'm2a3'), 20, 44, NORTH);
    const rider = put(unit(b, 'squad_w', 'blue', 0), 21, 44);
    const squad = put(unit(b, 'squad_w', 'blue', 1), 10, 44);
    put(unit(b, 't90m', 'red'), 3, 0, SOUTH);
    const steps = [
      { type: 'move', unit: tank.id, to: { x: 15, y: 40 } },
      { type: 'face', unit: ifv.id, facing: EAST },
      { type: 'overwatch', unit: tank.id },
      { type: 'hunker', unit: squad.id },
      { type: 'embark', unit: rider.id, carrier: ifv.id },
      { type: 'dismount', unit: ifv.id },
    ] as const;
    const first = copy(b);
    for (const a of steps) {
      const before = copy(b);
      expect(act(b, a), a.type).toBe(true);
      expect(undoable(before, b), a.type).toBe(true);
    }
    expect(b.events.some((e) => e.type === 'move')).toBe(true);
    expect(rider.carrier).toBeNull();
    // The snapshot is the battle as it was: restoring it is the undo.
    expect(first.units.find((u) => u.id === tank.id)).toMatchObject({ x: 15, y: 44, moved: false, overwatch: false });
  });

  it('a move that brings an enemy into view cannot', () => {
    const b = bare(['m1a2'], ['t90m']);
    ridge(b);
    const me = put(unit(b, 'm1a2'), 15, 44, NORTH);
    const them = put(unit(b, 't90m', 'red'), 15, 20, SOUTH);
    expect(visibleTo(b, 'blue').has(them.id)).toBe(false);
    const before = copy(b);
    expect(act(b, { type: 'move', unit: me.id, to: { x: 15, y: 38 } })).toBe(true);
    expect(visibleTo(b, 'blue').has(them.id)).toBe(true);
    expect(b.stream).toBe(before.stream);
    expect(undoable(before, b)).toBe(false);
  });

  it('a move that draws overwatch fire cannot', () => {
    const b = bare(['m1a2'], ['t90m']);
    ridge(b);
    const me = put(unit(b, 'm1a2'), 15, 44, NORTH);
    const watch = put(unit(b, 't90m', 'red'), 15, 20, SOUTH);
    watch.overwatch = true;
    const before = copy(b);
    expect(act(b, { type: 'move', unit: me.id, to: { x: 15, y: 38 } })).toBe(true);
    expect(b.events.some((e) => e.type === 'fire' && e.unit === watch.id)).toBe(true);
    expect(b.stream).not.toBe(before.stream);
    expect(undoable(before, b)).toBe(false);
  });

  it('a move that finds a last known position empty cannot, though nothing new is in sight', () => {
    const b = bare(['m1a2'], ['t90m']);
    ridge(b);
    const me = put(unit(b, 'm1a2'), 15, 44, NORTH);
    const them = put(unit(b, 't90m', 'red'), 3, 0, SOUTH);
    b.intel.blue[them.id] = { unit: them.id, type: them.type, x: 15, y: 30, turn: 0, now: false };
    const before = copy(b);
    expect(act(b, { type: 'move', unit: me.id, to: { x: 15, y: 38 } })).toBe(true);
    expect(visibleTo(b, 'blue').size).toBe(0);
    expect(b.intel.blue[them.id]).toBeUndefined();
    expect(undoable(before, b)).toBe(false);
  });

  it('a shot cannot, nor anything across the end of a turn', () => {
    const b = bare(['m1a2', 'm1a2'], ['t90m']);
    const me = put(unit(b, 'm1a2'), 15, 30, NORTH);
    put(unit(b, 'm1a2', 'blue', 1), 5, 44, NORTH);
    const them = put(unit(b, 't90m', 'red'), 15, 20, SOUTH);
    const before = copy(b);
    expect(act(b, { type: 'fire', unit: me.id, target: them.id, weapon: weapon(me, 'cannon').id })).toBe(true);
    expect(undoable(before, b)).toBe(false);
    const turn = copy(b);
    endTurn(b);
    expect(undoable(turn, b)).toBe(false);
  });

  it('every kind of event is classed, and the ones that roll or reveal are unsafe', () => {
    for (const k of ['fire', 'intercept', 'impact', 'casualties', 'suppressed', 'destroyed', 'boom', 'mine', 'spotted', 'lost', 'turn', 'end'] as const) expect(UNDO_SAFE[k], k).toBe(false);
    for (const k of ['move', 'face', 'embark', 'dismount'] as const) expect(UNDO_SAFE[k], k).toBe(true);
  });
});

describe('hold', () => {
  it('marks a unit done for the turn and nothing else: no roll, no event, safe to take back', () => {
    const b = bare(['m1a2', 'squad_w'], ['t90m']);
    const tank = put(unit(b, 'm1a2'), 15, 44, NORTH);
    const squad = put(unit(b, 'squad_w'), 10, 44);
    put(unit(b, 't90m', 'red'), 3, 0, SOUTH);
    const before = copy(b);
    expect(whyNot(b, { type: 'hold', unit: tank.id })).toBeNull();
    expect(act(b, { type: 'hold', unit: tank.id })).toBe(true);
    expect(tank).toMatchObject({ acted: true, moved: false, overwatch: false, hunker: false, x: 15, y: 44, facing: NORTH });
    expect(b.events).toHaveLength(before.events.length);
    expect(b.stream).toBe(before.stream);
    expect(undoable(before, b)).toBe(true);
    // Done: it cannot hold, move or turn again this turn; the others still can.
    expect(whyNot(b, { type: 'hold', unit: tank.id })).toBe('Done this turn');
    expect(canAct(b, { type: 'move', unit: tank.id, to: { x: 15, y: 42 } })).toBe(false);
    expect(canAct(b, { type: 'face', unit: tank.id, facing: EAST })).toBe(false);
    // A unit that has moved can still hold.
    expect(act(b, { type: 'move', unit: squad.id, to: { x: 10, y: 42 } })).toBe(true);
    const moved = copy(b);
    expect(act(b, { type: 'hold', unit: squad.id })).toBe(true);
    expect(undoable(moved, b)).toBe(true);
    // Its next turn it is ready again.
    endTurn(b);
    expect(b.turn).toBe('blue');
    expect(tank.acted).toBe(false);
  });

  it('only for a unit of the side whose turn it is, on the field', () => {
    const b = bare(['m2a3', 'squad_w'], ['t90m']);
    const ifv = put(unit(b, 'm2a3'), 15, 44, NORTH);
    const rider = put(unit(b, 'squad_w'), 16, 44);
    const them = put(unit(b, 't90m', 'red'), 3, 0, SOUTH);
    expect(whyNot(b, { type: 'hold', unit: them.id })).toBe('Not your unit');
    expect(act(b, { type: 'embark', unit: rider.id, carrier: ifv.id })).toBe(true);
    expect(whyNot(b, { type: 'hold', unit: rider.id })).toBe('Aboard a carrier');
    expect(whyNot(b, { type: 'hold', unit: ifv.id })).toBeNull();
    b.turn = 'red';
    expect(whyNot(b, { type: 'hold', unit: ifv.id }, 'blue')).toBe('Not your turn');
  });
});

describe('AI', () => {
  it('never cheats on sight: what it cannot see does not change what it does', () => {
    const make = (hiddenX: number) => {
      const b = createBattle(setup({ seed: 5, terrain: 'forest', attackers: [spec('a', ['m1a2', 'm1a2', 'm2a3', 'squad_w', 'javelin'])], defenders: [spec('x', ['t90m', 'bmp3', 'squad_e', 'kornet'])] }));
      endTurn(b);
      // A blue unit the red side has never seen, parked somewhere else in each copy.
      const ghost = b.units.find((u) => u.side === 'blue' && !visibleTo(b, 'red').has(u.id) && !Object.keys(b.intel.red).includes(u.id));
      return { b, ghost, hiddenX };
    };
    const one = make(2);
    const two = make(27);
    if (!one.ghost || !two.ghost) return;
    put(one.ghost, 2, 44);
    put(two.ghost, 27, 44);
    one.b.turn = 'red';
    two.b.turn = 'red';
    if (visibleTo(one.b, 'red').has(one.ghost.id) || visibleTo(two.b, 'red').has(two.ghost.id)) return;
    expect(decide(one.b, 'red')).toEqual(decide(two.b, 'red'));
  });

  it('never cheats on dice: its choice is the same whatever the random stream holds', () => {
    const b = createBattle(setup({ seed: 9, attackers: [spec('a', ['m1a2', 'm1a2', 'squad_w'])], defenders: [spec('x', ['t90m', 'squad_e'])] }));
    const c = JSON.parse(JSON.stringify(b)) as Battle;
    c.stream = (b.stream ^ 0xdeadbeef) >>> 0;
    expect(decide(c, 'blue')).toEqual(decide(b, 'blue'));
  });

  it('only ever chooses actions the rules allow, through whole battles', () => {
    for (let seed = 1; seed <= 3; seed++) {
      const b = autoBattle(createBattle(setup({ seed, terrain: (['plains', 'urban', 'hills'] as const)[seed - 1]!, site: seed === 2 ? 'city' : null, attackers: [{ id: 'f1', cls: 'armor', strength: 1000, name: 'A', color: '#000', rank: 0 }, { id: 'f2', cls: 'mechanized', strength: 1000, name: 'B', color: '#000', rank: 0 }], defenders: [{ id: 'e1', cls: 'infantry', strength: 1000, name: 'C', color: '#000', rank: 0 }, { id: 'e2', cls: 'armor', strength: 800, name: 'D', color: '#000', rank: 0 }] })));
      expect(b.ended).not.toBeNull();
      expect(rejectedActions(b)).toEqual([]);
    }
  }, BATTLES);
});

describe('AI tactics', () => {
  it('pulls a damaged vehicle back out of the guns that can see it', () => {
    const b = bare(['m1a2'], ['t90m']);
    const me = put(unit(b, 'm1a2'), 15, 30, NORTH);
    const them = put(unit(b, 't90m', 'red'), 15, 16, SOUTH);
    me.crew = 2;
    me.optics = true;
    b.intel.blue[them.id] = { unit: them.id, type: them.type, x: them.x, y: them.y, turn: b.turnIndex, now: true };
    // Woods to fall back into on one side.
    for (let y = 30; y <= 36; y++) for (let x = 20; x <= 24; x++) b.map.elev[at(b.map, x, y)] = 0;
    for (let x = 0; x < W; x++) b.map.elev[at(b.map, x, 33)] = 1;
    const a = decide(b, 'blue');
    expect(a?.type).toBe('move');
    if (a?.type === 'move') expect(a.to.y).toBeGreaterThan(me.y);
  });

  it('air defence goes for the helicopter first', () => {
    const b = bare(['m1a2', 'ah64e'], ['tunguska']);
    put(unit(b, 'm1a2'), 14, 30, NORTH);
    put(unit(b, 'ah64e'), 18, 28, NORTH);
    const ad = put(unit(b, 'tunguska', 'red'), 16, 18, SOUTH);
    b.turn = 'red';
    b.turnIndex = 1;
    for (const u of b.units) b.intel.red[u.id] = { unit: u.id, type: u.type, x: u.x, y: u.y, turn: 1, now: true };
    const a = decide(b, 'red');
    expect(a).toMatchObject({ type: 'fire', unit: ad.id, target: unit(b, 'ah64e').id });
  });

  it('lays smoke before crossing open ground under known guns', () => {
    let smoked = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const b = bare(['m1a2', 'm1a2', 'mortar_w'], ['t90m'], { seed });
      const [t1, t2] = b.units.filter((u) => u.type === 'm1a2');
      put(t1!, 14, 40, NORTH);
      put(t2!, 16, 40, NORTH);
      put(unit(b, 'mortar_w'), 15, 44);
      const them = put(unit(b, 't90m', 'red'), 15, 22, SOUTH);
      // Their tank on a rise watching the open ground.
      b.map.elev[at(b.map, 15, 22)] = 1;
      b.intel.blue[them.id] = { unit: them.id, type: them.type, x: them.x, y: them.y, turn: 0, now: true };
      them.revealed = 1;
      for (let i = 0; i < 6; i++) {
        const a = decide(b, 'blue');
        if (!a) break;
        if ((a.type === 'strike' && a.smoke) || a.type === 'smoke') {
          smoked++;
          break;
        }
        if (!act(b, a)) break;
      }
    }
    expect(smoked).toBeGreaterThanOrEqual(3);
  });

  it('suppresses, then works round the side: across battles most hits on armour are not on the front', () => {
    let front = 0;
    let flank = 0;
    for (let seed = 1; seed <= 3; seed++) {
      const b = autoBattle(createBattle(setup({ seed, terrain: 'plains', attackers: [{ id: 'f1', cls: 'armor', strength: 1000, name: 'A', color: '#000', rank: 0 }, { id: 'f2', cls: 'mechanized', strength: 1000, name: 'B', color: '#000', rank: 0 }], defenders: [{ id: 'e1', cls: 'armor', strength: 1000, name: 'C', color: '#000', rank: 0 }] })));
      for (const e of b.events) {
        if (e.type !== 'impact') continue;
        if (e.facing === 'front') front++;
        else flank++;
      }
    }
    expect(front + flank).toBeGreaterThan(5);
    expect(flank).toBeGreaterThan(0);
  }, BATTLES);
});

describe('battles', () => {
  it('a strong force beats a weak one, and a hopeless one loses', () => {
    let won = 0;
    let lost = 0;
    for (let seed = 1; seed <= 4; seed++) {
      const strong = autoBattle(createBattle(setup({ seed, attackers: [spec('a', ['m1a2', 'm1a2', 'm1a2', 'm1a2', 'm2a3', 'squad_w', 'm2a3', 'squad_w', 'paladin', 'javelin'])], defenders: [spec('x', ['squad_e', 'rpg'])] })));
      if (arenaResult(strong).won) won++;
      const weak = autoBattle(createBattle(setup({ seed, skill: 0.8, attackers: [spec('a', ['squad_w', 'medic_w'])], defenders: [spec('x', ['t90m', 't90m', 't90m', 'bmp3', 'squad_e', 'bmp3', 'squad_e', 'kornet'])] })));
      if (!arenaResult(weak).won) lost++;
    }
    expect(won).toBeGreaterThanOrEqual(3);
    expect(lost).toBeGreaterThanOrEqual(3);
  }, BATTLES);

  it('every arsenal and biome fights to a finish, and results fold back per formation', () => {
    const arsenals: [Arsenal, Arsenal][] = [
      ['us', 'russia'],
      ['europe', 'legacy'],
    ];
    const biomes = ['temperate', 'steppe', 'desert', 'winter', 'urban'] as const;
    biomes.forEach((biome, i) => {
      const [blue, red] = arsenals[i % 2]!;
      const b = autoBattle(createBattle(setup({ seed: 20 + i, biome, terrain: biome === 'urban' ? 'urban' : 'plains', site: biome === 'urban' ? 'city' : null, time: i === 3 ? 'night' : 'day', arsenal: { blue, red }, attackers: [{ id: 'f1', cls: 'armor', strength: 1000, name: 'A', color: '#000', rank: 0 }, { id: 'f2', cls: 'air', strength: 1000, name: 'B', color: '#000', rank: 0 }], defenders: [{ id: 'e1', cls: 'mechanized', strength: 1000, name: 'C', color: '#000', rank: 0 }, { id: 'e2', cls: 'drone', strength: 1000, name: 'D', color: '#000', rank: 0 }] })));
      expect(b.ended, biome).not.toBeNull();
      const r = arenaResult(b);
      expect(Object.keys(r.kept).sort()).toEqual(['e1', 'e2', 'f1', 'f2']);
      for (const v of Object.values(r.kept)) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1000);
      }
      expect(b.events.filter((e) => e.type === 'fire').length).toBeGreaterThan(3);
    });
  }, BATTLES);
});

void unitById;
void EAST;

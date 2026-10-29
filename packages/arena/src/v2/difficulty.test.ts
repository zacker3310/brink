import { describe, expect, it } from 'vitest';
import { fireInfo } from './combat';
import { act, arenaResult, autoBattle, autoTurn, createBattle, strikeInfo, supportChance } from './engine';
import { bare, BATTLES, copy, formation, NORTH, put, setup, SOUTH, spec, unit, weapon } from './fixture.test-util';
import { buildForce } from './forces';
import { typeOf } from './roster';
import { DIFFICULTY, FEWEST_ENEMIES } from './rules';
import { at, W, type ArenaSetup, type Battle, type Difficulty, type TypeId } from './types';

// Battle difficulty (docs/arena-v2.md, section 11): aim for each side as a named part of the hit
// chance, a smaller enemy company on Easy, and the enemy's skill moved by the table.

const LEVELS: Difficulty[] = ['easy', 'normal', 'hard'];
const sum = (parts: [string, number][]) => parts.reduce((s, [, v]) => s + v, 0);
const clamp = (n: number) => Math.max(5, Math.min(95, Math.round(n)));

/** Two tanks and the rest in sight of each other on a bare field. */
function duel(difficulty?: Difficulty): Battle {
  const b = bare(['m1a2', 'paladin', 'fpv_w'], ['t90m', 'msta'], difficulty ? { difficulty } : {});
  put(unit(b, 'm1a2'), 15, 30, NORTH);
  put(unit(b, 'fpv_w'), 16, 32);
  put(unit(b, 'paladin'), 15, 44);
  put(unit(b, 't90m', 'red'), 15, 20, SOUTH);
  put(unit(b, 'msta', 'red'), 15, 2, SOUTH);
  return b;
}

describe('difficulty', () => {
  it('is a named part of every hit chance: plus for your crews, minus for theirs, none on Hard', () => {
    for (const d of LEVELS) {
      const b = duel(d);
      const { name, aim, enemyAim } = DIFFICULTY[d];
      const mine = unit(b, 'm1a2');
      const theirs = unit(b, 't90m', 'red');
      const shots = {
        blue: [fireInfo(b, mine, theirs, weapon(mine, 'cannon'))!, fireInfo(b, unit(b, 'fpv_w'), theirs, weapon(unit(b, 'fpv_w'), 'fpv'))!],
        red: [fireInfo(b, theirs, mine, weapon(theirs, 'cannon'))!],
      };
      const strike = strikeInfo(b, unit(b, 'paladin'), { x: 15, y: 20 }, weapon(unit(b, 'paladin'), 'howitzer'))!;
      for (const [side, list] of Object.entries(shots)) {
        const want = side === 'blue' ? aim : enemyAim;
        for (const info of list) {
          expect(info, `${d} ${side}`).not.toBeNull();
          const part = info.parts.filter(([k]) => k === name);
          expect(part, `${d} ${side} ${info.weapon.id}`).toEqual(want ? [[name, want]] : []);
          // The card is the roll: the chance is the parts added up and clamped, nothing else.
          expect(info.chance).toBe(clamp(sum(info.parts)));
        }
      }
      expect(strike.parts.filter(([k]) => k === name)).toEqual(aim ? [[name, aim]] : []);
      expect(strike.chance).toBe(clamp(sum(strike.parts)));
    }
    expect(DIFFICULTY.easy.aim).toBeGreaterThan(0);
    expect(DIFFICULTY.easy.enemyAim).toBeLessThan(0);
    expect(DIFFICULTY.normal.aim).toBeGreaterThan(0);
    expect(DIFFICULTY.normal.enemyAim).toBeLessThan(0);
  });

  it('moves the odds the same way for off-map rockets', () => {
    const cell = { x: 15, y: 5 };
    const chance = (d: Difficulty, side: 'blue' | 'red') => {
      const b = duel(d);
      // A ridge hides the cell from the player's units.
      for (let x = 0; x < W; x++) b.map.elev[at(b.map, x, 10)] = 4;
      return supportChance(b, side, 'himars', cell);
    };
    // Unobserved, HIMARS lands on the cell half the time, moved by the player's aim.
    for (const d of LEVELS) expect(chance(d, 'blue')).toBe(clamp(50 + DIFFICULTY[d].aim));
    expect(chance('easy', 'blue')).toBeGreaterThan(chance('hard', 'blue'));
    // Their gun next to the cell watches it: HIMARS would be 95, moved by their aim.
    for (const d of LEVELS) expect(chance(d, 'red')).toBe(clamp(95 + DIFFICULTY[d].enemyAim));
  });

  it('the roll is the chance on the card, difficulty included', () => {
    const b = duel('easy');
    const mine = unit(b, 'm1a2');
    const theirs = unit(b, 't90m', 'red');
    const info = fireInfo(b, mine, theirs, weapon(mine, 'cannon'))!;
    expect(act(b, { type: 'fire', unit: mine.id, target: theirs.id, weapon: info.weapon.id })).toBe(true);
    const shot = b.events.find((e) => e.type === 'fire');
    expect(shot).toMatchObject({ unit: mine.id, chance: info.chance });
  });

  it('Easy fields fewer enemies, never under the floor; Normal and Hard the full company', () => {
    const red = (d: Difficulty, defenders: ArenaSetup['defenders']) => buildForce(setup({ difficulty: d, attackers: [formation('f1', 'armor')], defenders }), 'red').units;
    const blue = (d: Difficulty) => buildForce(setup({ difficulty: d, attackers: [formation('f1', 'armor'), formation('f2', 'mechanized')], defenders: [formation('e1', 'infantry')] }), 'blue').units;
    const companies = [[formation('e1', 'infantry'), formation('e2', 'armor')], [formation('e1', 'mechanized', 600)], [formation('e1', 'infantry'), formation('e2', 'artillery'), formation('e3', 'air')]];
    for (const defenders of companies) {
      const easy = red('easy', defenders).length;
      const normal = red('normal', defenders).length;
      expect(red('hard', defenders).length).toBe(normal);
      expect(easy).toBe(Math.max(FEWEST_ENEMIES, Math.round(normal * DIFFICULTY.easy.enemyUnits)));
      expect(easy).toBeLessThan(normal);
    }
    // A skirmish's own list loses units spread through it from the back; a short list keeps them all.
    const list: TypeId[] = ['squad_e', 'squad_e', 'rpg', 'squad_e', 'bmp3', 'sniper_e', 'kornet', 'mortar_e', 'medic_e', 'squad_e', 'squad_e', 'rpg'];
    const kept = red('easy', [spec('x', list)]).map((u) => u.type);
    expect(kept.length).toBe(Math.max(FEWEST_ENEMIES, Math.round(list.length * DIFFICULTY.easy.enemyUnits)));
    // Kept in order: a subsequence of the list.
    let from = 0;
    for (const t of kept) {
      const i = list.indexOf(t, from);
      expect(i, t).toBeGreaterThanOrEqual(0);
      from = i + 1;
    }
    expect(kept[0]).toBe(list[0]);
    expect(red('normal', [spec('x', list)]).map((u) => u.type)).toEqual(list);
    expect(red('easy', [spec('x', ['t90m', 'bmp3', 'squad_e'])]).length).toBe(3);
    // The player's own company never changes.
    expect(blue('easy')).toEqual(blue('normal'));
    expect(blue('hard')).toEqual(blue('normal'));
  });

  it('a smaller company still makes sense: every squad aboard rides a carrier with seats', () => {
    const sides: ArenaSetup['defenders'][] = [[formation('e1', 'mechanized')], [formation('e1', 'air'), formation('e2', 'mechanized', 700)], [spec('x', ['bmp3', 'squad_e', 'bmp3', 'squad_e', 'bmp3', 'squad_e', 't90m', 't90m', 'kornet', 'mortar_e'])]];
    for (const defenders of sides)
      for (const d of LEVELS) {
        const units = buildForce(setup({ difficulty: d, attackers: [formation('f1', 'armor')], defenders, arsenal: { blue: 'us', red: 'legacy' } }), 'red').units;
        for (const u of units) {
          if (u.men !== undefined) expect(u.men, `${d} ${u.id}`).toBeGreaterThan(0);
          if (!u.carrier) continue;
          const c = units.find((x) => x.id === u.carrier);
          expect(c && typeOf(c.type).seats, `${d} ${u.id} in ${u.carrier}`).toBeGreaterThan(0);
        }
      }
  });

  it('moves the enemy skill, and with it their crews rank, within 0..1', () => {
    const make = (skill: number, difficulty?: Difficulty) => createBattle(setup({ skill, difficulty, attackers: [spec('a', ['m1a2'])], defenders: [formation('e1', 'armor')] }));
    expect(make(0.5).skill).toBe(0.5);
    expect(make(0.5, 'easy').skill).toBeCloseTo(0.5 + DIFFICULTY.easy.skill, 9);
    expect(make(0.5, 'hard').skill).toBeCloseTo(0.5 + DIFFICULTY.hard.skill, 9);
    expect(make(0.98, 'hard').skill).toBe(1);
    expect(make(0.05, 'easy').skill).toBe(0);
    // Their crews' rank follows the skill they play at: Veteran from 0.35.
    const rank = (b: Battle) => Math.max(...b.units.filter((u) => u.side === 'red').map((u) => u.rank));
    expect(rank(make(0.4))).toBe(1);
    expect(rank(make(0.4, 'easy'))).toBe(0);
  });

  it('a battle set up without one is Normal, exactly, and replays the same', () => {
    const base = setup({ seed: 13, terrain: 'hills', attackers: [spec('a', ['m1a2', 'm1a2', 'm2a3', 'squad_w', 'javelin'])], defenders: [spec('x', ['t90m', 'bmp3', 'squad_e', 'kornet'])] });
    const plain = createBattle(base);
    const normal = createBattle({ ...base, difficulty: 'normal' });
    expect(plain.difficulty).toBe('normal');
    expect(plain).toEqual(normal);
    autoBattle(plain);
    autoBattle(normal);
    expect(plain.events).toEqual(normal.events);
    const again = autoBattle(createBattle(base));
    expect(again.events).toEqual(plain.events);
    // An unknown name from an old or hand-made setup is Normal too.
    expect(createBattle({ ...base, difficulty: 'brutal' as Difficulty }).difficulty).toBe('normal');
  }, BATTLES);

  it('is plain JSON: an Easy battle saved mid-fight resumes exactly as one that never stopped', () => {
    const make = () => createBattle(setup({ seed: 17, difficulty: 'easy', attackers: [formation('f1', 'armor'), formation('f2', 'mechanized')], defenders: [formation('e1', 'infantry')] }));
    const straight = make();
    const paused = make();
    expect(straight.difficulty).toBe('easy');
    for (let i = 0; i < 2; i++) {
      autoTurn(straight);
      autoTurn(paused);
    }
    const resumed = copy(paused);
    expect(resumed).toEqual(paused);
    autoBattle(straight);
    autoBattle(resumed);
    expect(resumed.events).toEqual(straight.events);
    expect(arenaResult(resumed)).toEqual(arenaResult(straight));
  }, BATTLES);
});

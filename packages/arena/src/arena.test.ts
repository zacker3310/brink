import { describe, expect, it } from 'vitest';
import type { Terrain, UnitClass } from '@brink/contracts';
import { BRIDGE, buildLevel, CRATE, idx, OPEN, walkable, WALL, WATER } from './level';
import { ARENA_H, ARENA_W, CAPTURE_ROUNDS, CLASSES, COVER, ROUND_LIMIT } from './rules';
import { act, arenaResult, autoBattle, canAct, createArena, endTurn, fireInfo, reachable, retreat, strikeChance, targetsOf, type Arena, type ArenaSetup, type UnitSpec } from './tactics';

const TERRAINS: Terrain[] = ['plains', 'forest', 'hills', 'mountains', 'urban'];

function spec(id: string, cls: UnitClass, strength = 1000): UnitSpec {
  return { id, cls, strength, name: id, color: '#888888', rank: 0 };
}

function setup(p: Partial<ArenaSetup> & Pick<ArenaSetup, 'attackers' | 'defenders'>): ArenaSetup {
  return { seed: 1, terrain: 'plains', river: false, site: null, skill: 0.4, abilities: [], ...p };
}

/** An empty field with the units placed by hand, so a rule can be tested on its own. */
function bare(attackers: UnitSpec[], defenders: UnitSpec[], extra: Partial<ArenaSetup> = {}): Arena {
  const a = createArena(setup({ attackers, defenders, ...extra }));
  for (let i = 0; i < a.level.cells.length; i++) {
    a.level.cells[i] = OPEN;
    a.level.style[i] = null;
    a.level.height[i] = 0;
  }
  for (const u of a.units) u.dug = false;
  return a;
}

function put(a: Arena, id: string, x: number, y: number) {
  const u = a.units.find((v) => v.id === id)!;
  u.x = x;
  u.y = y;
  return u;
}

function wall(a: Arena, x: number, y: number, style: 'building' | 'sandbag' = 'building') {
  a.level.cells[idx(x, y)] = style === 'sandbag' ? CRATE : WALL;
  a.level.style[idx(x, y)] = style;
}

/** Cells a vehicle can reach from the attackers' edge. */
function vehicleReach(level: ReturnType<typeof buildLevel>): Set<number> {
  const seen = new Set([idx(7, ARENA_H - 2)]);
  const q = [[7, ARENA_H - 2] as [number, number]];
  while (q.length) {
    const [x, y] = q.shift()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx!;
      const ny = y + dy!;
      if (!walkable(level, nx, ny, false) || seen.has(idx(nx, ny))) continue;
      seen.add(idx(nx, ny));
      q.push([nx, ny]);
    }
  }
  return seen;
}

/** Whole battles on autopilot: well under a second each locally, more on a shared CI runner. */
const FULL_BATTLES = 30_000;

describe('levels', () => {
  it('every terrain, with and without a river, lets vehicles reach the defenders', () => {
    for (const terrain of TERRAINS)
      for (const river of [false, true])
        for (let seed = 1; seed <= 25; seed++) {
          const lv = buildLevel({ seed, terrain, river, site: seed % 3 === 0 ? 'city' : null });
          const reach = vehicleReach(lv);
          const goal = lv.zone ?? { x: 7.5, y: 3.5 };
          expect(reach.has(idx(Math.floor(goal.x), Math.floor(goal.y))), `${terrain} river=${river} seed=${seed}`).toBe(true);
          expect(lv.redSpawn.length).toBeGreaterThanOrEqual(3);
        }
  });

  it('a river crosses the field with bridges; cities and objectives are capture fights', () => {
    const lv = buildLevel({ seed: 3, terrain: 'plains', river: true, site: null });
    const row = Math.floor(ARENA_H / 2);
    const cells = Array.from({ length: ARENA_W }, (_, x) => lv.cells[idx(x, row)]);
    expect(cells.filter((c) => c === WATER).length).toBeGreaterThan(8);
    expect(cells.filter((c) => c === BRIDGE).length).toBeGreaterThanOrEqual(2);
    expect(lv.mode).toBe('destroy');
    expect(buildLevel({ seed: 3, terrain: 'urban', river: false, site: 'capital' }).mode).toBe('capture');
    expect(buildLevel({ seed: 3, terrain: 'plains', river: false, site: 'objective' }).zone).not.toBeNull();
  });

  it('every unit starts on its own cell, on ground it can stand on', () => {
    const all: UnitClass[] = ['infantry', 'mechanized', 'armor', 'artillery', 'recon', 'air', 'drone'];
    for (const terrain of TERRAINS) {
      const a = createArena(setup({ seed: 7, terrain, site: terrain === 'urban' ? 'city' : null, attackers: all.map((c) => spec(`b-${c}`, c)), defenders: all.map((c) => spec(`r-${c}`, c)) }));
      const cells = a.units.map((u) => idx(u.x, u.y));
      expect(new Set(cells).size).toBe(cells.length);
      for (const u of a.units) expect(walkable(a.level, u.x, u.y, true), `${terrain} ${u.id}`).toBe(true);
    }
  });
});

describe('moving', () => {
  it('a unit moves as far as its points allow, diagonals cost more, and only once a turn', () => {
    const a = bare([spec('t', 'armor')], [spec('x', 'infantry')]);
    put(a, 't', 7, 20);
    put(a, 'x', 0, 0);
    const reach = reachable(a, a.units[0]!);
    expect(reach.cost.has(idx(7, 15))).toBe(true); // 5 straight
    expect(reach.cost.has(idx(7, 14))).toBe(false); // 6 straight
    expect(reach.cost.has(idx(10, 17))).toBe(true); // 3 diagonals: 4.5 points
    expect(reach.cost.has(idx(11, 16))).toBe(false); // 4 diagonals: 6
    expect(canAct(a, { type: 'move', unit: 't', to: { x: 7, y: 14 } })).toBe(false);
    expect(act(a, { type: 'move', unit: 't', to: { x: 7, y: 15 } })).toBe(true);
    expect(a.units[0]!.y).toBe(15);
    expect(act(a, { type: 'move', unit: 't', to: { x: 7, y: 14 } })).toBe(false);
    expect(a.events.at(-1)).toMatchObject({ type: 'move', unit: 't' });
  });

  it('walls stop vehicles but not aircraft; nobody ends on another unit', () => {
    const a = bare([spec('t', 'armor'), spec('h', 'air')], [spec('x', 'infantry')]);
    put(a, 't', 7, 20);
    put(a, 'h', 8, 20);
    put(a, 'x', 7, 17);
    for (let x = 0; x < ARENA_W; x++) wall(a, x, 18);
    expect(reachable(a, a.units[0]!).cost.size).toBeLessThan(60);
    expect([...reachable(a, a.units[0]!).cost.keys()].every((i) => Math.floor(i / ARENA_W) > 18)).toBe(true);
    const air = reachable(a, a.units[1]!);
    expect(air.cost.has(idx(8, 16))).toBe(true);
    expect(air.cost.has(idx(7, 17))).toBe(false);
  });
});

describe('shooting', () => {
  it('shows the same chance it rolls against, and cover takes points off it', () => {
    const a = bare([spec('t', 'armor')], [spec('x', 'armor')]);
    put(a, 't', 7, 18);
    const x = put(a, 'x', 7, 12);
    const open = fireInfo(a, a.units[0]!, x)!;
    expect(open.cover).toBe('none');
    wall(a, 7, 13);
    const full = fireInfo(a, a.units[0]!, x)!;
    expect(full.cover).toBe('full');
    expect(full.chance).toBe(open.chance - COVER.full);
    wall(a, 7, 13, 'sandbag');
    expect(fireInfo(a, a.units[0]!, x)!.cover).toBe('half');
    // A wall in the middle, next to neither, blocks the shot outright.
    a.level.cells[idx(7, 13)] = OPEN;
    wall(a, 7, 15);
    expect(fireInfo(a, a.units[0]!, x)).toBeNull();
    // Out of range.
    a.level.cells[idx(7, 15)] = OPEN;
    put(a, 'x', 7, 0);
    expect(fireInfo(a, a.units[0]!, x)).toBeNull();
  });

  it('flanking pays: the same cover is no cover from the side', () => {
    const a = bare([spec('t', 'armor')], [spec('x', 'armor')]);
    const x = put(a, 'x', 7, 10);
    wall(a, 7, 11);
    put(a, 't', 7, 16);
    const front = fireInfo(a, a.units[0]!, x)!;
    put(a, 't', 13, 10);
    const side = fireInfo(a, a.units[0]!, x)!;
    expect(front.cover).toBe('full');
    expect(side.cover).toBe('none');
    expect(side.parts.some(([k]) => k === 'Flanked')).toBe(true);
    expect(side.chance).toBeGreaterThan(front.chance + 30);
  });

  it('a hit takes 85% to 115% of the shown damage; firing ends the unit’s turn', () => {
    const a = bare([spec('t', 'armor')], [spec('x', 'armor')]);
    put(a, 't', 7, 14);
    const x = put(a, 'x', 7, 12);
    const info = fireInfo(a, a.units[0]!, x)!;
    expect(act(a, { type: 'fire', unit: 't', target: 'x' })).toBe(true);
    const fire = a.events.find((e) => e.type === 'fire')!;
    expect(fire).toMatchObject({ chance: info.chance });
    if (fire.type === 'fire' && fire.hit) {
      const lost = x.maxHp - x.hp;
      expect(lost).toBeGreaterThanOrEqual(Math.floor(info.damage * 0.85));
      expect(lost).toBeLessThanOrEqual(Math.ceil(info.damage * 1.15));
    }
    expect(canAct(a, { type: 'move', unit: 't', to: { x: 7, y: 15 } })).toBe(false);
    expect(targetsOf(a, a.units[0]!)).toEqual([]);
  });

  it('artillery shells a cell over walls and hurts everyone next to it', () => {
    const a = bare([spec('g', 'artillery')], [spec('x', 'infantry'), spec('y', 'infantry')]);
    put(a, 'g', 7, 21);
    put(a, 'x', 7, 8);
    put(a, 'y', 8, 8);
    for (let x = 0; x < ARENA_W; x++) wall(a, x, 14);
    expect(strikeChance(a, a.units[0]!, { x: 7, y: 8 })).toBeGreaterThan(40);
    expect(strikeChance(a, a.units[0]!, { x: 7, y: 20 })).toBeNull(); // too close
    act(a, { type: 'strike', unit: 'g', at: { x: 7, y: 8 } });
    expect(a.units.filter((u) => u.side === 'red' && u.hp < u.maxHp).length).toBeGreaterThanOrEqual(1);
  });

  it('a drone dives once and is gone', () => {
    const a = bare([spec('d', 'drone')], [spec('x', 'armor')]);
    put(a, 'd', 7, 12);
    put(a, 'x', 7, 9);
    expect(act(a, { type: 'fire', unit: 'd', target: 'x' })).toBe(true);
    expect(a.units[0]!.alive).toBe(false);
    expect(a.stats.lost).toBe(1);
  });
});

describe('turns', () => {
  it('an enemy on overwatch fires at the first unit that moves into its sights', () => {
    const a = bare([spec('t', 'armor')], [spec('x', 'armor')]);
    // Out of its range at the start; in range two cells into the move.
    put(a, 't', 7, 21);
    const x = put(a, 'x', 7, 10);
    expect(fireInfo(a, x, a.units[0]!)).toBeNull();
    a.turn = 'red';
    act(a, { type: 'overwatch', unit: 'x' }, 'red');
    a.turn = 'blue';
    expect(x.overwatch).toBe(true);
    act(a, { type: 'move', unit: 't', to: { x: 7, y: 17 } });
    const shot = a.events.find((e) => e.type === 'fire');
    expect(shot).toMatchObject({ unit: 'x', overwatch: true });
    expect(x.overwatch).toBe(false);
    // The walk is logged in legs around the shot.
    const moves = a.events.filter((e) => e.type === 'move');
    expect(moves[0]).toMatchObject({ path: [{ x: 7, y: 21 }, { x: 7, y: 20 }, { x: 7, y: 19 }] });
  });

  it('mines stop an enemy vehicle and hurt it', () => {
    const a = bare([spec('t', 'armor')], [spec('x', 'armor')], { abilities: ['mines'] });
    put(a, 't', 7, 15);
    const x = put(a, 'x', 7, 10);
    expect(act(a, { type: 'ability', id: 'mines', unit: 't' })).toBe(true);
    expect(a.mines).toHaveLength(3);
    a.turn = 'red';
    expect(act(a, { type: 'move', unit: 'x', to: { x: 7, y: 14 } }, 'red')).toBe(true);
    expect(x.y).toBe(14);
    expect(a.events.some((e) => e.type === 'mine')).toBe(true);
    expect(x.hp).toBe(x.maxHp - 35);
    expect(a.mines).toHaveLength(2);
  });

  it('holding the zone for two rounds with no defender in it takes it', () => {
    const a = createArena(setup({ seed: 2, terrain: 'urban', site: 'city', skill: 0, attackers: [spec('t', 'armor')], defenders: [spec('x', 'infantry', 50)] }));
    const z = a.level.zone!;
    const me = put(a, 't', Math.floor(z.x), Math.floor(z.y));
    me.hp = me.maxHp = 100000;
    put(a, 'x', 0, ARENA_H - 1);
    a.units[1]!.dug = false;
    for (let r = 0; r < CAPTURE_ROUNDS && !a.ended; r++) {
      endTurn(a);
      put(a, 't', Math.floor(z.x), Math.floor(z.y));
      put(a, 'x', 0, ARENA_H - 1);
    }
    expect(a.ended).toBe('won');
  });

  it('the defenders hold when the rounds run out; retreat is a loss that keeps what survived', () => {
    const a = createArena(setup({ seed: 3, attackers: [spec('t', 'armor')], defenders: [spec('x', 'armor')] }));
    for (const u of a.units) u.hp = u.maxHp = 1_000_000;
    for (let i = 0; i < ROUND_LIMIT + 2 && !a.ended; i++) endTurn(a);
    expect(a.ended).toBe('lost');
    expect(a.round).toBe(ROUND_LIMIT);
    const b = createArena(setup({ seed: 4, attackers: [spec('a', 'armor')], defenders: [spec('x', 'armor')] }));
    retreat(b);
    const r = arenaResult(b);
    expect(r.won).toBe(false);
    expect(r.kept.a).toBe(1000);
    expect(r.stars).toBe(0);
  });

  it('abilities unlocked by research work once each', () => {
    const a = bare([spec('a', 'armor', 500)], [spec('x', 'infantry')], { abilities: ['repair', 'airstrike', 'mines', 'missiles', 'sweep', 'armor'] });
    const me = a.units[0]!;
    expect(me.maxHp).toBe(Math.round(CLASSES.armor.hp * 1.25));
    const before = me.hp;
    expect(act(a, { type: 'ability', id: 'repair', unit: 'a' })).toBe(true);
    expect(me.hp).toBeGreaterThan(before);
    expect(act(a, { type: 'ability', id: 'repair', unit: 'a' })).toBe(false);
    put(a, 'x', 7, 4);
    const hp = a.units[1]!.hp;
    expect(act(a, { type: 'ability', id: 'airstrike', at: { x: 7, y: 4 } })).toBe(true);
    expect(a.units[1]!.hp).toBeLessThan(hp);
    put(a, 'a', 7, 14);
    put(a, 'x', 7, 12);
    const plain = fireInfo(a, me, a.units[1]!);
    act(a, { type: 'ability', id: 'sweep' });
    act(a, { type: 'ability', id: 'missiles' });
    if (a.units[1]!.alive && plain) expect(fireInfo(a, me, a.units[1]!)!.parts.map(([k]) => k)).toEqual(expect.arrayContaining(['Recon sweep', 'Guided']));
    expect(a.abilities.armor).toBeUndefined();
  });
});

describe('battles', () => {
  it('a strong force beats a weak one, and a hopeless one loses, across seeds', () => {
    let won = 0;
    let lost = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const strong = autoBattle(createArena(setup({ seed, skill: 0.4, attackers: ['a', 'b', 'c'].map((i) => spec(i, 'armor')), defenders: [spec('x', 'infantry', 500)] })));
      if (arenaResult(strong).won) won++;
      const weak = autoBattle(createArena(setup({ seed, skill: 0.9, attackers: [spec('a', 'infantry', 300)], defenders: ['x', 'y', 'z'].map((i) => spec(i, 'armor')) })));
      if (!arenaResult(weak).won) lost++;
    }
    expect(won).toBeGreaterThanOrEqual(7);
    expect(lost).toBeGreaterThanOrEqual(7);
  }, FULL_BATTLES);

  it('every unit type fights to a finish on every terrain', () => {
    const all: UnitClass[] = ['infantry', 'mechanized', 'armor', 'artillery', 'recon', 'air', 'drone'];
    for (const terrain of TERRAINS) {
      const a = autoBattle(createArena(setup({ seed: 11, terrain, river: terrain === 'plains', site: terrain === 'urban' ? 'city' : null, skill: 0.6, attackers: all.map((c) => spec(`b-${c}`, c)), defenders: all.map((c) => spec(`r-${c}`, c)) })));
      expect(a.ended).not.toBeNull();
      const r = arenaResult(a);
      for (const v of Object.values(r.kept)) expect(v).toBeGreaterThanOrEqual(0);
      expect(a.events.filter((e) => e.type === 'fire').length).toBeGreaterThan(3);
    }
  }, FULL_BATTLES);

  it('is deterministic for a seed and the same actions', () => {
    const make = () => autoBattle(createArena(setup({ seed: 9, terrain: 'forest', river: true, skill: 0.5, attackers: [spec('a', 'armor'), spec('b', 'infantry')], defenders: [spec('x', 'mechanized'), spec('y', 'infantry')] })));
    const p = make();
    const q = make();
    expect(arenaResult(p)).toEqual(arenaResult(q));
    expect(p.events).toEqual(q.events);
  }, FULL_BATTLES);

  it('an even fight on autopilot goes either way, and a sharp enemy wins more of them', () => {
    const wins = (skill: number) => {
      let n = 0;
      for (let seed = 1; seed <= 12; seed++) {
        const a = autoBattle(createArena(setup({ seed, terrain: TERRAINS[seed % 5]!, skill, attackers: [spec('a', 'armor'), spec('b', 'mechanized'), spec('c', 'infantry')], defenders: [spec('x', 'armor'), spec('y', 'infantry')] })));
        if (arenaResult(a).won) n++;
      }
      return n;
    };
    const raw = wins(0.1);
    const sharp = wins(0.9);
    expect(raw).toBeGreaterThanOrEqual(sharp);
    expect(raw).toBeGreaterThanOrEqual(6);
    expect(sharp).toBeLessThanOrEqual(11);
  }, FULL_BATTLES);
});

import { describe, expect, it } from 'vitest';
import type { Terrain, UnitClass } from '@brink/contracts';
import { buildLevel, idx, walkable, WATER, BRIDGE } from './level';
import { ARENA_H, ARENA_W, CAPTURE_TIME, TIME_LIMIT } from './rules';
import { arenaResult, createArena, stepArena, type Arena, type ArenaInput, type UnitSpec } from './sim';

const TERRAINS: Terrain[] = ['plains', 'forest', 'hills', 'mountains', 'urban'];

function spec(id: string, cls: UnitClass, strength = 1000): UnitSpec {
  return { id, cls, strength, name: id, color: '#888888', rank: 0 };
}

function run(a: Arena, input: ArenaInput = { auto: true }, seconds = TIME_LIMIT + 5): Arena {
  for (let t = 0; t < seconds && !a.ended; t += 0.05) stepArena(a, 0.05, input);
  return a;
}

/** Cells a vehicle can reach from the attackers' edge. */
function reachable(level: ReturnType<typeof buildLevel>): Set<number> {
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

describe('levels', () => {
  it('every terrain, with and without a river, lets vehicles reach the defenders', () => {
    for (const terrain of TERRAINS)
      for (const river of [false, true])
        for (let seed = 1; seed <= 25; seed++) {
          const lv = buildLevel({ seed, terrain, river, site: seed % 3 === 0 ? 'city' : null });
          const reach = reachable(lv);
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
});

/** Full battles at 60 steps a second: seconds of work locally, more on a shared CI runner. */
const FULL_BATTLES = 30_000;

describe('battles', () => {
  it('a strong force beats a weak one, and a hopeless one loses, across seeds', () => {
    let won = 0;
    let lost = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const strong = run(createArena({ seed, terrain: 'plains', river: false, site: null, skill: 0.4, abilities: [], attackers: ['a', 'b', 'c'].map((i) => spec(i, 'armor')), defenders: [spec('x', 'infantry', 500)] }));
      if (arenaResult(strong).won) won++;
      const weak = run(createArena({ seed, terrain: 'plains', river: false, site: null, skill: 0.9, abilities: [], attackers: [spec('a', 'infantry', 300)], defenders: ['x', 'y', 'z'].map((i) => spec(i, 'armor')) }));
      if (!arenaResult(weak).won) lost++;
    }
    expect(won).toBeGreaterThanOrEqual(5);
    expect(lost).toBeGreaterThanOrEqual(5);
  }, FULL_BATTLES);

  it('every unit type can fight to a finish without errors', () => {
    const all: UnitClass[] = ['infantry', 'mechanized', 'armor', 'artillery', 'recon', 'air', 'drone'];
    for (const terrain of TERRAINS) {
      const a = run(createArena({ seed: 11, terrain, river: terrain === 'plains', site: terrain === 'urban' ? 'city' : null, skill: 0.6, abilities: [], attackers: all.map((c) => spec(`b-${c}`, c)), defenders: all.map((c) => spec(`r-${c}`, c)) }));
      expect(a.ended).not.toBeNull();
      const r = arenaResult(a);
      for (const v of Object.values(r.kept)) expect(v).toBeGreaterThanOrEqual(0);
    }
  }, FULL_BATTLES);

  it('is deterministic for a seed and the same inputs', () => {
    const make = () => createArena({ seed: 9, terrain: 'forest', river: true, site: null, skill: 0.5, abilities: [], attackers: [spec('a', 'armor'), spec('b', 'infantry')], defenders: [spec('x', 'mechanized'), spec('y', 'infantry')] });
    expect(arenaResult(run(make()))).toEqual(arenaResult(run(make())));
  }, FULL_BATTLES);

  it('a tank shell bounces once and can come back to hit its own tank', () => {
    const a = createArena({ seed: 1, terrain: 'plains', river: false, site: null, skill: 0, abilities: [], attackers: [spec('a', 'armor')], defenders: [spec('x', 'infantry')] });
    const me = a.units[0]!;
    // Put the tank against the right edge and fire straight into it.
    me.x = ARENA_W - 1.2;
    me.y = ARENA_H - 1.5;
    a.units[1]!.x = 1;
    a.units[1]!.y = 1;
    const hp = me.hp;
    me.cooldown = 0;
    stepArena(a, 0.016, { fire: { x: ARENA_W + 5, y: me.y } });
    for (let i = 0; i < 40; i++) stepArena(a, 0.016, {});
    expect(me.hp).toBeLessThan(hp);
  });

  it('holding a city square uncontested takes it', () => {
    const a = createArena({ seed: 2, terrain: 'urban', river: false, site: 'city', skill: 0, abilities: [], attackers: [spec('a', 'armor')], defenders: [spec('x', 'artillery', 100)] });
    const me = a.units[0]!;
    const zone = a.level.zone!;
    me.x = zone.x;
    me.y = zone.y;
    me.hp = me.maxHp = 100000;
    const gun = a.units[1]!;
    gun.x = 1.5;
    gun.y = ARENA_H - 1.5;
    for (let t = 0; t < CAPTURE_TIME + 3 && !a.ended; t += 0.05) stepArena(a, 0.05, {});
    expect(a.ended).toBe('won');
    expect(arenaResult(a).kept.x).toBeGreaterThan(0);
  });

  it('a retreat is a loss that keeps what survived; stars reward clean wins', () => {
    const a = createArena({ seed: 4, terrain: 'plains', river: false, site: null, skill: 0.5, abilities: [], attackers: [spec('a', 'armor')], defenders: [spec('x', 'armor')] });
    stepArena(a, 0.05, { retreat: true });
    const r = arenaResult(a);
    expect(r.won).toBe(false);
    expect(r.kept.a).toBe(1000);
    expect(r.stars).toBe(0);
    const easy = run(createArena({ seed: 4, terrain: 'plains', river: false, site: null, skill: 0, abilities: [], attackers: ['a', 'b', 'c', 'd'].map((i) => spec(i, 'armor')), defenders: [spec('x', 'recon', 200)] }));
    expect(arenaResult(easy).stars).toBeGreaterThanOrEqual(2);
  });

  it('abilities unlocked by research work once each', () => {
    const a = createArena({ seed: 5, terrain: 'plains', river: false, site: null, skill: 0, abilities: ['repair', 'airstrike', 'mines', 'missiles', 'sweep', 'armor'], attackers: [spec('a', 'armor', 500)], defenders: [spec('x', 'infantry')] });
    const me = a.units[0]!;
    expect(me.maxHp).toBe(175);
    const before = me.hp;
    stepArena(a, 0.05, { ability: { id: 'repair' } });
    expect(me.hp).toBeGreaterThan(before);
    stepArena(a, 0.05, { ability: { id: 'repair' } });
    expect(a.abilities.repair).toBe('used');
    stepArena(a, 0.05, { ability: { id: 'airstrike', x: 7, y: 4 } });
    expect(a.bombs.length).toBe(3);
    stepArena(a, 0.05, { ability: { id: 'mines' } });
    expect(a.mines.length).toBe(3);
    expect(a.abilities.armor).toBeUndefined();
  });
});

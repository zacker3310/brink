import type { Terrain } from '@brink/contracts';
import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../rng';
import { facingFrom, fireInfo } from './combat';
import { act, autoTurn, createBattle, endTurn, reachable, unitById } from './engine';
import { bare, BATTLES, copy, EAST, NORTH, put, setup, SOUTH, spec, unit } from './fixture.test-util';
import { airThreats, dangerArea, DANGER_STEPS, enemyReach, expectedArea, likelyTargets, moveExposure, observeBlue, overwatchAreas, recovery, scoutedEmpty } from './insight';
import { typeOf } from './roster';
import { updateIntel, visibleTo } from './sight';
import { at, BUILDING, H, OPEN, ROAD, TREES, W, WALL, type Arsenal, type Battle, type Difficulty, type Point, type TimeOfDay, type TypeId, type Unit, type Weather } from './types';

// What the overlay reads off the field, from the player's observation only.

/** The runner's console, for the fog check's tally (the engine builds without DOM or Node types). */
declare const console: { log: (line: string) => void };

const cell = (b: Battle, x: number, y: number) => at(b.map, x, y);

function building(b: Battle, x: number, y: number, storeys = 2): void {
  const i = cell(b, x, y);
  b.map.cells[i] = BUILDING;
  b.map.storeys[i] = storeys;
  b.map.hp[i] = 40 * storeys;
}

/** The rules log every change to the field; a test that edits it by hand says so the same way. */
const touch = (b: Battle) => b.events.push({ type: 'crater', x: 0, y: 0 });

/** A small fight on the bare field: two Abrams, an Apache and an FPV team facing a T-72B3, a BMP-3 and a Gepard. */
function fight(): Battle {
  const b = bare(['m1a2', 'm1a2', 'ah64e', 'fpv_w'], ['t72b3', 'bmp3', 'gepard', 't72b3', 'tunguska', 'squad_e']);
  put(unit(b, 'm1a2'), 12, 34, NORTH);
  put(unit(b, 'm1a2', 'blue', 1), 18, 34, NORTH);
  put(unit(b, 'ah64e'), 15, 38, NORTH);
  put(unit(b, 'fpv_w'), 15, 40, NORTH);
  put(unit(b, 't72b3', 'red'), 14, 14, SOUTH);
  put(unit(b, 'bmp3', 'red'), 20, 16, SOUTH);
  put(unit(b, 'gepard', 'red'), 16, 12, SOUTH);
  // Three more, out of sight (over 30 cells from every unit of ours).
  put(unit(b, 't72b3', 'red', 1), 3, 1, SOUTH);
  put(unit(b, 'tunguska', 'red'), 27, 2, SOUTH);
  put(unit(b, 'squad_e', 'red'), 9, 0, SOUTH);
  updateIntel(b);
  return b;
}

// --- Everything the overlay asks, for the differential tests -------------------------------------------

type Answers = Record<string, unknown>;

/** Every answer the module gives about a battle, for a fixed list of moves to look at. */
function answers(b: Battle, moves: readonly [string, Point][]): Answers {
  const blue = b.units.filter((u) => u.side === 'blue' && u.alive).sort((p, q) => (p.id < q.id ? -1 : 1));
  const seen = [...visibleTo(b, 'blue')].sort();
  return {
    observation: observeBlue(b),
    danger: dangerArea(b),
    reach: seen.map((id) => enemyReach(b, id)),
    likely: likelyTargets(b),
    watch: overwatchAreas(b),
    air: blue.map((u) => airThreats(b, u.id)),
    airDanger: blue.map((u) => airThreats(b, u.id, true)),
    moves: moves.map(([id, to]) => moveExposure(b, id, to)),
    expected: expectedArea(b),
    scouted: scoutedEmpty(b),
    recovery: blue.map((u) => recovery(b, u.id)),
  };
}

/** Each answer on its own, so a failure names the function that leaked. */
function expectSame(got: Answers, want: Answers, what: string): void {
  for (const k of Object.keys(want)) expect(got[k], `${k} after ${what}`).toEqual(want[k]);
}

/** Moves worth looking at: a couple of reachable cells for a few of the player's units. */
function someMoves(b: Battle, rand: () => number): [string, Point][] {
  const out: [string, Point][] = [];
  const known = visibleTo(b, 'blue');
  for (const u of b.units.filter((x) => x.side === 'blue' && x.alive && !x.carrier).slice(0, 4)) {
    const cells = [...reachable(b, u, false, known).cost.keys()].filter((i) => i !== cell(b, u.x, u.y));
    for (let k = 0; k < 2 && cells.length; k++) {
      const i = cells[Math.floor(rand() * cells.length)]!;
      out.push([u.id, { x: i % b.map.w, y: Math.floor(i / b.map.w) }]);
    }
  }
  return out;
}

// --- Changes to what the player cannot see ------------------------------------------------------------

const pick = <T>(xs: readonly T[], rand: () => number): T | undefined => xs[Math.floor(rand() * xs.length)];
const hiddenReds = (b: Battle): Unit[] => {
  const seen = visibleTo(b, 'blue');
  return b.units.filter((u) => u.side === 'red' && u.alive && !seen.has(u.id));
};
const seenReds = (b: Battle): Unit[] => {
  const seen = visibleTo(b, 'blue');
  return b.units.filter((u) => seen.has(u.id));
};

/** An empty open cell, preferring ones far from the player's units (so it is likely out of sight). */
function quietCell(b: Battle, rand: () => number): Point | null {
  const blue = b.units.filter((u) => u.side === 'blue' && u.alive && !u.carrier);
  let best: Point | null = null;
  let far = -1;
  for (let k = 0; k < 40; k++) {
    const p = { x: Math.floor(rand() * W), y: Math.floor(rand() * H) };
    const c = b.map.cells[cell(b, p.x, p.y)];
    if ((c !== OPEN && c !== ROAD && c !== TREES) || b.units.some((u) => u.alive && !u.carrier && u.x === p.x && u.y === p.y)) continue;
    const d = Math.min(...blue.map((u) => Math.hypot(u.x - p.x, u.y - p.y)));
    if (d > far) {
      far = d;
      best = p;
    }
  }
  return best;
}

interface Mutation {
  name: string;
  /** Change the copy; false when it does not apply to this battle. */
  apply: (b: Battle, rand: () => number) => boolean;
}

const MUTATIONS: Mutation[] = [
  {
    name: 'a hidden enemy moves',
    apply: (b, rand) => {
      const u = pick(hiddenReds(b).filter((x) => !x.carrier), rand);
      const p = quietCell(b, rand);
      if (!u || !p) return false;
      put(u, p.x, p.y, rand() * 6.28);
      return true;
    },
  },
  {
    name: 'a hidden enemy goes on overwatch, hunkers and turns',
    apply: (b, rand) => {
      const u = pick(hiddenReds(b), rand);
      if (!u) return false;
      u.overwatch = !u.overwatch;
      u.hunker = !u.hunker;
      u.facing = rand() * 6.28;
      u.aim = u.facing;
      return true;
    },
  },
  {
    name: 'a hidden enemy is suppressed and out of ammunition',
    apply: (b, rand) => {
      const u = pick(hiddenReds(b), rand);
      if (!u) return false;
      u.supp = Math.floor(rand() * 101);
      for (const k of Object.keys(u.ammo)) u.ammo[k] = 0;
      u.moved = rand() < 0.5;
      u.acted = rand() < 0.5;
      return true;
    },
  },
  {
    name: 'a hidden enemy is destroyed out of sight',
    apply: (b, rand) => {
      const u = pick(hiddenReds(b).filter((x) => !x.carrier), rand);
      if (!u) return false;
      u.alive = false;
      u.status = 'destroyed';
      b.wrecks.push({ x: u.x, y: u.y, unit: u.id, type: u.type, burning: 3 });
      b.events.push({ type: 'destroyed', unit: u.id, how: 'destroyed', x: u.x, y: u.y, seen: false });
      return true;
    },
  },
  {
    name: 'a hidden enemy is not there at all',
    apply: (b, rand) => {
      const u = pick(hiddenReds(b), rand);
      if (!u) return false;
      b.units = b.units.filter((x) => x !== u);
      for (const c of b.units) c.passengers = c.passengers.filter((id) => id !== u.id);
      return true;
    },
  },
  {
    name: 'one more hidden enemy',
    apply: (b, rand) => {
      const like = pick(
        b.units.filter((u) => u.side === 'red'),
        rand,
      );
      const p = quietCell(b, rand);
      if (!like || !p) return false;
      const extra = JSON.parse(JSON.stringify(like)) as Unit;
      Object.assign(extra, { id: `zz${b.units.length}`, x: p.x, y: p.y, alive: true, status: 'ok', carrier: null, passengers: [], overwatch: rand() < 0.5, revealed: -1 });
      b.units.push(extra);
      return true;
    },
  },
  {
    name: 'enemy mines',
    apply: (b, rand) => {
      for (let k = 0; k < 4; k++) b.mines.push({ x: Math.floor(rand() * W), y: Math.floor(rand() * H), side: 'red' });
      return true;
    },
  },
  {
    name: 'the stream, their picture, their support and their tallies',
    apply: (b, rand) => {
      b.stream = Math.floor(rand() * 2 ** 31);
      b.skill = rand();
      for (const u of b.units.filter((x) => x.side === 'blue')) b.intel.red[u.id] = { unit: u.id, type: u.type, x: Math.floor(rand() * W), y: Math.floor(rand() * H), turn: b.turnIndex, now: rand() < 0.5 };
      b.support.push({ id: 'tornado', side: 'red', missions: 3 });
      b.stats.red = { shots: 99, hits: 42, kills: 7, lost: 1 };
      return true;
    },
  },
  {
    name: 'a hidden squad boards an enemy vehicle you can see',
    apply: (b, rand) => {
      const squad = pick(
        hiddenReds(b).filter((u) => typeOf(u.type).mobility === 'foot' && !u.carrier),
        rand,
      );
      const carrier = pick(
        seenReds(b).filter((u) => typeOf(u.type).mobility !== 'foot'),
        rand,
      );
      if (!squad || !carrier) return false;
      squad.carrier = carrier.id;
      squad.x = carrier.x;
      squad.y = carrier.y;
      carrier.passengers.push(squad.id);
      return true;
    },
  },
  {
    name: 'an enemy you can see has spent its missiles and charges',
    apply: (b, rand) => {
      const u = pick(seenReds(b), rand);
      if (!u) return false;
      for (const k of Object.keys(u.ammo)) u.ammo[k] = 0;
      u.aps = 0;
      return true;
    },
  },
  {
    name: 'an enemy you can see is more suppressed, but shows the same',
    apply: (b, rand) => {
      const u = pick(seenReds(b), rand);
      if (!u) return false;
      const bands: [number, number][] = [
        [0, 24],
        [25, 49],
        [50, 79],
        [80, 100],
      ];
      const [lo, hi] = bands.find(([l, h]) => u.supp >= l && u.supp <= h)!;
      u.supp = lo + Math.floor(rand() * (hi - lo + 1));
      return true;
    },
  },
];

/** Same picture: the player sees the same enemies, where they were. */
function sameSight(a: Battle, b: Battle): boolean {
  const sa = [...visibleTo(a, 'blue')].sort();
  const sb = [...visibleTo(b, 'blue')].sort();
  if (sa.join() !== sb.join()) return false;
  return sa.every((id) => {
    const p = unitById(a, id)!;
    const q = unitById(b, id)!;
    return p.x === q.x && p.y === q.y;
  });
}

/** Run every mutation (rounds times) on copies of `base`; returns how many applied and were checked. */
function fogCheck(base: Battle, rand: () => number, rounds: number, label: string): number {
  const moves = someMoves(base, rand);
  const want = answers(base, moves);
  let checked = 0;
  for (let r = 0; r < rounds; r++)
    for (const m of MUTATIONS) {
      const v = copy(base);
      if (!m.apply(v, rand) || !sameSight(base, v)) continue;
      expectSame(answers(v, moves), want, `${m.name} (${label})`);
      checked++;
    }
  return checked;
}

describe('observation', () => {
  it('the fixture sees three of the six', () => {
    const b = fight();
    expect([...visibleTo(b, 'blue')].sort()).toEqual([unit(b, 'bmp3', 'red').id, unit(b, 'gepard', 'red').id, unit(b, 't72b3', 'red').id].sort());
  });

  it('holds only what the player can know', () => {
    const b = fight();
    const bmp = unit(b, 'bmp3', 'red');
    bmp.supp = 61;
    bmp.ammo.arkan = 0;
    bmp.overwatch = true;
    b.mines.push({ x: 12, y: 30, side: 'red' }, { x: 3, y: 40, side: 'blue' });
    b.stream = 12345;
    const o = observeBlue(b);
    expect(o.units.filter((u) => u.side === 'red').map((u) => u.id).sort()).toEqual([...visibleTo(b, 'blue')].sort());
    expect(o.units.filter((u) => u.side === 'blue')).toHaveLength(4);
    expect(o.mines).toEqual([{ x: 3, y: 40, side: 'blue' }]);
    expect(o.stream).toBe(0);
    expect(o.intel.red).toEqual({});
    const seenBmp = o.units.find((u) => u.id === bmp.id)!;
    // Pinned, as the badge shows: the least that shows so; missiles assumed aboard; on watch as its badge says.
    expect(seenBmp.supp).toBe(50);
    expect(seenBmp.ammo.arkan).toBe(typeOf('bmp3').weapons.find((w) => w.id === 'arkan')!.ammo);
    expect(seenBmp.overwatch).toBe(true);
    // The battle itself is untouched.
    expect(bmp.supp).toBe(61);
    expect(b.mines).toHaveLength(2);
  });

  it('is idempotent, and every answer is the same asked of the observation itself', () => {
    const b = fight();
    unit(b, 'bmp3', 'red').overwatch = true;
    const o = observeBlue(b);
    expect(observeBlue(o)).toEqual(o);
    const moves = someMoves(b, mulberry32(3));
    expectSame(answers(o, moves), answers(b, moves), 'observing first');
  });
});

describe('fog: nothing hidden changes an answer', () => {
  it('on the fixture: every function, every kind of hidden change', () => {
    const base = fight();
    unit(base, 'bmp3', 'red').overwatch = true;
    const tunguska = unit(base, 'tunguska', 'red');
    base.intel.blue[tunguska.id] = { unit: tunguska.id, type: 'tunguska', x: 25, y: 6, turn: base.turnIndex - 2, now: false };
    const checked = fogCheck(base, mulberry32(11), 3, 'fixture');
    expect(checked).toBeGreaterThanOrEqual(MUTATIONS.length * 2);
  });

  it('over generated battles: random forces, fields, light and weather, a few turns in', () => {
    const terrains: Terrain[] = ['plains', 'forest', 'hills', 'mountains', 'urban'];
    const west: TypeId[] = ['m1a2', 'leo2a7', 'cr3', 'm2a3', 'cv90', 'stryker', 'm10', 'm1134', 'ah64e', 'ah6', 'uh60', 'squad_w', 'javelin', 'gustaf', 'stinger', 'sniper_w', 'mortar_w', 'engineer_w', 'fpv_w', 'switchblade', 'gepard', 'paladin', 'raven'];
    const east: TypeId[] = ['t72b3', 't90m', 't80bvm', 'bmp3', 'sprut', 'kornetd', 'ka52', 'mi35', 'mi8', 'squad_e', 'kornet', 'rpg', 'igla', 'sniper_e', 'mortar_e', 'engineer_e', 'fpv_e', 'lancet', 'tunguska', 'msta', 'orlan'];
    const times: TimeOfDay[] = ['dawn', 'day', 'dusk', 'night'];
    const weathers: Weather[] = ['clear', 'overcast', 'rain', 'fog', 'snow'];
    const difficulties: Difficulty[] = ['easy', 'normal', 'hard'];
    const BATTLE_COUNT = 24;
    let battles = 0;
    let mutations = 0;
    for (let k = 0; k < BATTLE_COUNT; k++) {
      const rand = mulberry32(9000 + k);
      const some = (pool: TypeId[], n: number) => Array.from({ length: n }, () => pool[Math.floor(rand() * pool.length)]!);
      const blueArsenal: Arsenal = rand() < 0.5 ? 'us' : 'europe';
      const redArsenal: Arsenal = rand() < 0.5 ? 'russia' : 'legacy';
      const b = createBattle(
        setup({
          seed: 500 + k * 37,
          terrain: terrains[Math.floor(rand() * terrains.length)]!,
          site: rand() < 0.4 ? 'city' : null,
          arsenal: { blue: blueArsenal, red: redArsenal },
          time: times[Math.floor(rand() * times.length)]!,
          weather: weathers[Math.floor(rand() * weathers.length)]!,
          difficulty: difficulties[Math.floor(rand() * difficulties.length)]!,
          attackers: [spec('a', some(west, 6 + Math.floor(rand() * 5)))],
          defenders: [spec('x', some(east, 6 + Math.floor(rand() * 5)))],
        }),
      );
      const turns = Math.floor(rand() * 4);
      for (let t = 0; t < turns && !b.ended; t++) autoTurn(b);
      if (b.ended) continue;
      battles++;
      mutations += fogCheck(b, rand, 1, `battle ${k}, after ${turns} turns`);
    }
    console.log(`fog check: ${battles} generated battles, ${mutations} hidden-state mutations, every answer unchanged`);
    expect(battles).toBeGreaterThanOrEqual(BATTLE_COUNT * 0.75);
    expect(mutations).toBeGreaterThanOrEqual(battles * 6);
  }, BATTLES * 3);
});

describe('danger area', () => {
  it('shades where a seen enemy could fire: in range along a clear line, not behind a building, not out of reach', () => {
    const b = bare(['m1a2'], ['t72b3']);
    put(unit(b, 'm1a2'), 15, 40, NORTH);
    const t72 = put(unit(b, 't72b3', 'red'), 15, 12, SOUTH);
    const reach = new Set(enemyReach(b, t72.id));
    expect(reach.has(cell(b, 15, 25))).toBe(true);
    // Its gun reaches 22 cells, and it can drive 7 toward us: 44 rows down is beyond both.
    expect(reach.has(cell(b, 15, 44))).toBe(false);
    // Hemmed in by buildings: it cannot move, and sees nothing out of them.
    for (const [x, y] of [
      [14, 11],
      [15, 11],
      [16, 11],
      [14, 12],
      [16, 12],
      [14, 13],
      [16, 13],
    ] as const)
      building(b, x, y);
    building(b, 15, 13, 3);
    touch(b);
    expect(enemyReach(b, t72.id)).toEqual([]);
  });

  it('a short move counts: ground hidden from where it stands but seen from a step aside', () => {
    const b = bare(['m1a2'], ['t72b3']);
    put(unit(b, 'm1a2'), 5, 38, NORTH);
    const t72 = put(unit(b, 't72b3', 'red'), 15, 10, SOUTH);
    // A tall block right in front of it hides the column below.
    building(b, 15, 12, 4);
    t72.overwatch = true;
    expect(visibleTo(b, 'blue').has(t72.id)).toBe(true);
    const fromHere = new Set(overwatchAreas(b).find((w) => w.unit === t72.id)!.cells);
    const target = cell(b, 15, 16);
    expect(fromHere.has(target)).toBe(false);
    expect(new Set(enemyReach(b, t72.id)).has(target)).toBe(true);
  });

  it('counts how many seen enemies reach a cell, in up to three steps', () => {
    const b = bare(['m1a2'], ['t72b3', 't72b3', 't72b3', 't72b3']);
    put(unit(b, 'm1a2'), 15, 40, NORTH);
    for (let n = 0; n < 4; n++) put(unit(b, 't72b3', 'red', n), 12 + n * 2, 14, SOUTH);
    const level = dangerArea(b);
    expect(level[cell(b, 15, 22)]).toBe(DANGER_STEPS);
    expect(Math.max(...level)).toBe(DANGER_STEPS);
    expect(level[cell(b, 15, 44)]).toBe(0);
  });

  it('asks once per state: the same answer until something changes', () => {
    const b = fight();
    expect(dangerArea(b)).toBe(dangerArea(b));
    const before = overwatchAreas(b);
    unit(b, 'm1a2').overwatch = true;
    const after = overwatchAreas(b);
    expect(after).not.toBe(before);
    expect(after.map((w) => w.unit)).toContain(unit(b, 'm1a2').id);
  });

  it('is quick enough to ask on a real field', () => {
    const b = createBattle(setup({ seed: 5, terrain: 'hills', attackers: [spec('a', ['m1a2', 'm1a2', 'm2a3', 'm2a3', 'squad_w', 'squad_w', 'javelin', 'ah64e'])], defenders: [spec('x', ['t90m', 't72b3', 'bmp3', 'bmp3', 'squad_e', 'kornet', 'tunguska', 'mortar_e'])] }));
    for (let i = 0; i < 3 && visibleTo(b, 'blue').size < 2; i++) autoTurn(b);
    const t0 = Date.now();
    dangerArea(b);
    const first = Date.now() - t0;
    expect(first).toBeLessThan(4000);
  }, BATTLES);
});

describe('likely targets', () => {
  it('each seen enemy points at its best expected shot among the units of ours it can see', () => {
    const b = bare(['m1a2', 'squad_w'], ['t72b3'], { difficulty: 'normal' });
    const tank = put(unit(b, 'm1a2'), 15, 30, NORTH);
    const squad = put(unit(b, 'squad_w'), 17, 30, NORTH);
    const t72 = put(unit(b, 't72b3', 'red'), 15, 14, SOUTH);
    const likely = likelyTargets(b);
    expect(likely).toHaveLength(1);
    expect(likely[0]!.from).toBe(t72.id);
    expect([tank.id, squad.id]).toContain(likely[0]!.to);
    // The chance is the engine's own, for that shot.
    const w = typeOf('t72b3').weapons.find((x) => x.id === likely[0]!.weapon)!;
    const target = unitById(b, likely[0]!.to)!;
    expect(likely[0]!.chance).toBe(fireInfo(b, { ...t72, moved: false }, target, w)!.chance);
  });

  it('air defence goes for the aircraft, and Hard shows none', () => {
    const b = bare(['m1a2', 'ah64e'], ['gepard'], { difficulty: 'easy' });
    put(unit(b, 'm1a2'), 15, 26, NORTH);
    const heli = put(unit(b, 'ah64e'), 18, 26, NORTH);
    put(unit(b, 'gepard', 'red'), 15, 14, SOUTH);
    expect(likelyTargets(b).map((l) => l.to)).toEqual([heli.id]);
    const hard = copy(b);
    hard.difficulty = 'hard';
    expect(likelyTargets(hard)).toEqual([]);
  });
});

describe('overwatch', () => {
  it('ground units on watch cover the ground in reach and sight; air defence watches the sky', () => {
    const b = fight();
    unit(b, 't72b3', 'red').overwatch = true;
    unit(b, 'gepard', 'red').overwatch = true;
    unit(b, 'm1a2').overwatch = true;
    const areas = overwatchAreas(b);
    const t72 = areas.find((w) => w.unit === unit(b, 't72b3', 'red').id)!;
    expect(t72.side).toBe('red');
    expect(t72.sky).toBe(0);
    expect(t72.cells).toContain(cell(b, 14, 30));
    expect(t72.cells).not.toContain(cell(b, 14, 40));
    const gepard = areas.find((w) => w.unit === unit(b, 'gepard', 'red').id)!;
    expect(gepard.cells).toEqual([]);
    expect(gepard.sky).toBe(26);
    expect(areas.find((w) => w.unit === unit(b, 'm1a2').id)?.side).toBe('blue');
  });
});

describe('air threats', () => {
  it('rings every seen enemy that can shoot at your helicopter, with its chance, and suspected air defence where it was', () => {
    const b = fight();
    const tunguska = unit(b, 'tunguska', 'red');
    b.intel.blue[tunguska.id] = { unit: tunguska.id, type: 'tunguska', x: 25, y: 6, turn: b.turnIndex - 2, now: false };
    const heli = unit(b, 'ah64e');
    const rings = airThreats(b, heli.id);
    const gepardUnit = unit(b, 'gepard', 'red');
    const gepard = rings.find((r) => r.unit === gepardUnit.id)!;
    expect(gepard).toMatchObject({ r: 26, square: false, dedicated: true, suspected: false });
    // The engine's own chance, with the Apache at half the gun's range on the line to where it is.
    const k = 13 / Math.hypot(heli.x - gepardUnit.x, heli.y - gepardUnit.y);
    const at13 = { ...heli, x: Math.round(gepardUnit.x + (heli.x - gepardUnit.x) * k), y: Math.round(gepardUnit.y + (heli.y - gepardUnit.y) * k) };
    const own = fireInfo(b, { ...gepardUnit, moved: false }, at13, typeOf('gepard').weapons.find((w) => w.id === 'air')!, gepardUnit, false, new Set([heli.id]))!;
    expect(gepard.chance).toBe(own.chance);
    expect(rings.find((r) => r.unit === unit(b, 'bmp3', 'red').id)).toMatchObject({ r: 14, dedicated: false });
    expect(rings.find((r) => r.unit === unit(b, 't72b3', 'red').id)).toBeUndefined();
    expect(rings.find((r) => r.unit === tunguska.id)).toMatchObject({ x: 25, y: 6, r: 40, chance: null, suspected: true, age: 2 });
    expect(airThreats(b, heli.id, true).map((r) => r.unit).sort()).toEqual([gepardUnit.id, tunguska.id].sort());
  });

  it('a drone team sees the interception squares: 60% for air-defence guns, 25% for autocannons', () => {
    const b = fight();
    const rings = airThreats(b, unit(b, 'fpv_w').id);
    expect(rings.find((r) => r.unit === unit(b, 'gepard', 'red').id)).toMatchObject({ r: 4, square: true, chance: 60 });
    expect(rings.find((r) => r.unit === unit(b, 'bmp3', 'red').id)).toMatchObject({ r: 4, square: true, chance: 25 });
    expect(rings.find((r) => r.unit === unit(b, 't72b3', 'red').id)).toBeUndefined();
    expect(airThreats(b, unit(b, 'm1a2').id)).toEqual([]);
  });
});

describe('move exposure', () => {
  it('predicts the heading the move leaves, and the armour each seen enemy would strike', () => {
    let checked = 0;
    for (const to of [
      { x: 12, y: 29 },
      { x: 9, y: 31 },
      { x: 16, y: 30 },
      { x: 6, y: 33 },
    ]) {
      const b = fight();
      const tank = unit(b, 'm1a2');
      const ex = moveExposure(b, tank.id, to)!;
      expect(ex.vehicle).toBe(true);
      const after = copy(b);
      expect(act(after, { type: 'move', unit: tank.id, to })).toBe(true);
      const moved = unitById(after, tank.id)!;
      if (moved.x !== to.x || moved.y !== to.y) continue;
      checked++;
      expect(ex.facing).toBeCloseTo(moved.facing, 6);
      for (const th of ex.threats) {
        if (th.face === 'top') continue;
        const face = facingFrom(moved, unitById(b, th.unit)!, false);
        expect(face === 'side' ? th.face === 'left' || th.face === 'right' : th.face === face).toBe(true);
      }
      expect(ex.flanked).toBe(ex.threats.some((t) => t.face === 'left' || t.face === 'right' || t.face === 'rear'));
    }
    expect(checked).toBeGreaterThanOrEqual(3);
  });

  it('a vehicle with nothing known keeps the way it drove', () => {
    const b = bare(['m1a2'], ['t72b3']);
    const tank = put(unit(b, 'm1a2'), 15, 40, NORTH);
    put(unit(b, 't72b3', 'red'), 2, 1, SOUTH);
    const ex = moveExposure(b, tank.id, { x: 18, y: 40 })!;
    expect(ex.threats).toEqual([]);
    expect(ex.facing).toBeCloseTo(EAST, 6);
    expect(ex.flanked).toBe(false);
  });

  it('troops: a shield for the cover they would have, and a flank warning when an enemy sees round it', () => {
    const b = bare(['squad_w'], ['t72b3', 'bmp3']);
    const squad = put(unit(b, 'squad_w'), 15, 26, NORTH);
    put(unit(b, 't72b3', 'red'), 15, 14, SOUTH);
    put(unit(b, 'bmp3', 'red'), 16, 2, SOUTH);
    // A wall in front of the cell it moves to: half cover from the north.
    b.map.cells[cell(b, 15, 24)] = WALL;
    let ex = moveExposure(b, squad.id, { x: 15, y: 25 })!;
    expect(ex.vehicle).toBe(false);
    expect(ex.threats).toHaveLength(2);
    expect(ex.shield).toBe('half');
    expect(ex.flanked).toBe(false);
    // The BMP-3 comes round to the east: it sees past the wall.
    put(unit(b, 'bmp3', 'red'), 26, 25, SOUTH);
    ex = moveExposure(b, squad.id, { x: 15, y: 25 })!;
    expect(ex.shield).toBe('none');
    expect(ex.flanked).toBe(true);
    // Into the woods: cover all round.
    b.map.cells[cell(b, 13, 26)] = TREES;
    touch(b);
    ex = moveExposure(b, squad.id, { x: 13, y: 26 })!;
    expect(ex.shield).toBe('half');
  });

  it('null where it cannot go', () => {
    const b = fight();
    expect(moveExposure(b, unit(b, 'm1a2').id, { x: 12, y: 2 })).toBeNull();
  });
});

describe('fog', () => {
  it('the expected area clears where blue sees it empty, not where an enemy stands or troops could hide unseen', () => {
    const b = bare(['m1a2'], ['t72b3']);
    const area = expectedArea(b)!;
    expect(area.cells.length).toBeGreaterThan(20);
    const tank = put(unit(b, 'm1a2'), Math.round(area.x), Math.min(44, Math.round(area.y + area.r + 6)), NORTH);
    const inArea = area.cells.find((i) => Math.hypot((i % b.map.w) + 0.5 - area.x, Math.floor(i / b.map.w) + 0.5 - area.y) < 1.5)!;
    const t72 = put(unit(b, 't72b3', 'red'), inArea % b.map.w, Math.floor(inArea / b.map.w), SOUTH);
    // A wood deep in the area, further than a third of the tank's sight.
    const far = area.cells.filter((i) => Math.hypot((i % b.map.w) - tank.x, Math.floor(i / b.map.w) - tank.y) > 11)[0]!;
    b.map.cells[far] = TREES;
    const empty = new Set(scoutedEmpty(b));
    expect(empty.has(cell(b, t72.x, t72.y))).toBe(false);
    expect(empty.has(far)).toBe(false);
    expect(empty.size).toBeGreaterThan(area.cells.length / 2);
  });
});

describe('suppression', () => {
  it('the recovery the card promises is the one the next turn gives', () => {
    const b = bare(['squad_w', 'm1a2'], ['orlan']);
    const squad = put(unit(b, 'squad_w'), 15, 40, NORTH);
    const tank = put(unit(b, 'm1a2'), 16, 40, NORTH);
    put(unit(b, 'orlan', 'red'), 15, 2, SOUTH);
    b.map.cells[cell(b, 15, 40)] = TREES;
    squad.supp = 75;
    squad.hunker = true;
    tank.supp = 55;
    const rs = recovery(b, squad.id)!;
    expect(rs).toEqual({ points: 55, next: 'steady' });
    expect(recovery(b, tank.id)).toEqual({ points: 30, next: 'suppressed' });
    endTurn(b);
    expect(b.turn).toBe('blue');
    expect(unitById(b, squad.id)!.supp).toBe(20);
    expect(unitById(b, tank.id)!.supp).toBe(25);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, autoBattle, autoTurn, createBattle, endTurn } from './engine';
import { bare, BATTLES, copy, NORTH, put, setup, spec, unit } from './fixture.test-util';
import { canonicalJson, hashBattle, replay, submit, type PlayerCommand } from './replay';
import { arenaSetup, copyPlayer, coveringSetups, play, playTurn, player, replayDiverges, type Played } from './verify.test-util';
import type { ArenaSetup, Battle } from './types';

// The command log and replay (docs/architecture.md, Battles): a battle is a pure function of its
// setup and the player's accepted commands. The enemy's turns and Let Crews Play are the AI's, which
// reads the state alone, so the log holds only the player's commands and replaying it rebuilds the
// battle to the same hash at every turn.

const small = () => bare(['m1a2', 'm1a2', 'squad_w'], ['t90m', 'squad_e']);

describe('submit', () => {
  it('logs a copy of each accepted command and nothing else; a refused one changes nothing', () => {
    const b = small();
    const tank = put(unit(b, 'm1a2'), 15, 40, NORTH);
    const move: PlayerCommand = { type: 'act', action: { type: 'move', unit: tank.id, to: { x: 15, y: 38 } } };
    expect(submit(b, move)).toBe(true);
    expect(b.commands).toEqual([move]);
    // The log is the battle's own: changing the order afterwards does not rewrite history.
    (move as { action: { to: { y: number } } }).action.to.y = 30;
    expect(b.commands![0]).toMatchObject({ action: { to: { y: 38 } } });
    const before = JSON.stringify(b);
    expect(submit(b, { type: 'act', action: { type: 'move', unit: tank.id, to: { x: 15, y: 36 } } })).toBe(false);
    expect(JSON.stringify(b)).toBe(before);
    expect(submit(b, { type: 'end' })).toBe(true);
    expect(submit(b, { type: 'auto' })).toBe(true);
    expect(b.commands!.map((c) => c.type)).toEqual(['act', 'end', 'auto']);
    expect(submit(b, { type: 'retreat' })).toBe(true);
    expect(b.ended).toBe('lost');
    const over = JSON.stringify(b);
    for (const c of [{ type: 'retreat' }, { type: 'end' }, { type: 'auto' }, move] as PlayerCommand[]) expect(submit(b, c)).toBe(false);
    expect(JSON.stringify(b)).toBe(over);
  });

  it('a battle saved before there was a log has none until the first command', () => {
    const b = small();
    expect(b.commands).toBeUndefined();
    expect(JSON.parse(JSON.stringify(b))).not.toHaveProperty('commands');
    expect(submit(b, { type: 'end' })).toBe(true);
    expect(b.commands).toHaveLength(1);
  });
});

describe('hashBattle', () => {
  it('is the same for a battle and its JSON round trip, whatever order its keys are in', () => {
    const b = createBattle(setup({ seed: 4, terrain: 'hills', attackers: [spec('a', ['m1a2', 'm2a3', 'squad_w'])], defenders: [spec('x', ['t90m', 'squad_e'])] }));
    autoTurn(b);
    const h = hashBattle(b);
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(hashBattle(copy(b))).toBe(h);
    const reversed = Object.fromEntries(Object.entries(copy(b)).reverse()) as unknown as Battle;
    expect(hashBattle(reversed)).toBe(h);
    expect(canonicalJson({ b: 1, a: [1, { d: 2, c: undefined }] })).toBe('{"a":[1,{"d":2}],"b":1}');
  });

  it('changes with any part of the state, but not with the command log', () => {
    const b = small();
    const h = hashBattle(b);
    const moved = copy(b);
    moved.units[0]!.x += 1;
    const rolled = copy(b);
    rolled.stream = (rolled.stream + 1) >>> 0;
    const logged = copy(b);
    logged.events.push({ type: 'turn', side: 'blue', round: 1 });
    const mined = copy(b);
    mined.mines.push({ x: 3, y: 3, side: 'red' });
    for (const c of [moved, rolled, logged, mined]) expect(hashBattle(c)).not.toBe(h);
    const withLog = copy(b);
    withLog.commands = [{ type: 'end' }];
    expect(hashBattle(withLog)).toBe(h);
  });

  it('refuses a broken state: a number that is not finite', () => {
    const b = small();
    b.units[0]!.facing = Number.NaN;
    expect(() => hashBattle(b)).toThrow(/non-finite/);
  });
});

/** Every mark of a played battle compared with its replay: the number of hashes that agreed. */
function replayed(p: Played): number {
  expect(replayDiverges(p), `seed ${p.setup.seed}`).toBeNull();
  return p.marks.length + 1;
}

describe('replay', () => {
  it('rebuilds every battle from its setup and log to the same hash at every turn, across the field', () => {
    // One setup per company shape, each terrain, site, biome, time, weather and difficulty at least once.
    const setups = coveringSetups(9, 1);
    let hashes = 0;
    let commands = 0;
    for (const [i, s] of setups.entries()) {
      const p = play(s, 100 + i, { turns: 2, advice: 0.03, planner: 0.01 });
      expect(p.p.wrongly, `seed ${s.seed}`).toEqual([]);
      hashes += replayed(p);
      commands += p.b.commands?.length ?? 0;
      // The log is the player's alone: the enemy's turns and Let Crews Play are not in it.
      for (const c of p.b.commands ?? []) expect(['act', 'end', 'auto', 'retreat']).toContain(c.type);
    }
    expect(new Set(setups.map((s) => s.terrain)).size).toBe(5);
    expect(hashes).toBeGreaterThanOrEqual(9 * 4);
    expect(commands).toBeGreaterThan(200);
  }, BATTLES * 3);

  it('rebuilds a whole battle to its end, Let Crews Play and the enemy included', () => {
    const s = arenaSetup(21, { mix: 'roster', terrain: 'urban', time: 'night' });
    const p = play(s, 21, { auto: 0.4 });
    expect(p.b.ended).not.toBeNull();
    replayed(p);
    const again = replay(s, p.b.commands ?? []);
    expect(hashBattle(again)).toBe(hashBattle(p.b));
    expect(again.events).toEqual(p.b.events);
  }, BATTLES * 2);

  it('throws when the log does not belong to the setup', () => {
    const s = arenaSetup(5, { mix: 'roster' });
    const b = createBattle(s);
    const u = b.units.find((x) => x.side === 'blue' && x.carrier === null)!;
    const log: PlayerCommand[] = [{ type: 'act', action: { type: 'overwatch', unit: u.id } }, { type: 'act', action: { type: 'overwatch', unit: u.id } }];
    expect(() => replay(s, log)).toThrow(/command 1 \(overwatch\) was refused/);
  });

  it('the same setup and seeded player give the same battle twice', () => {
    for (const seed of [31, 32]) {
      const s = arenaSetup(seed, { mix: 'roster' });
      const one = play(s, seed, { turns: 2 });
      const two = play(s, seed, { turns: 2 });
      expect(two.marks, `seed ${seed}`).toEqual(one.marks);
      expect(two.b.commands).toEqual(one.b.commands);
    }
  }, BATTLES);

  it('a battle saved mid-fight as JSON and carried on equals one that never stopped', () => {
    for (const [i, s] of [arenaSetup(41, { mix: 'armour', terrain: 'hills' }), arenaSetup(42, { mix: 'roster', terrain: 'urban', site: 'city' })].entries()) {
      const p = player(60 + i, { advice: 0.04, planner: 0.02 });
      const straight = createBattle(s);
      for (let t = 0; t < 2 && !straight.ended; t++) playTurn(p, straight);
      const saved = copy(straight);
      const q = copyPlayer(p);
      expect(hashBattle(saved)).toBe(hashBattle(straight));
      for (let t = 0; t < 2 && !straight.ended; t++) {
        playTurn(p, straight);
        playTurn(q, saved);
        expect(hashBattle(saved), `seed ${s.seed} turn ${t}`).toBe(hashBattle(straight));
      }
      expect(saved.commands).toEqual(straight.commands);
    }
  }, BATTLES * 2);

  // Known defect (reported): the AI caches its sight grids per battle object (`gridCache` in ai.ts),
  // keyed on smoke and the count of building and tree cells. Walls and rocks block lines too and
  // fall in play (tracks flatten walls, a breach turns rock to rubble), so a battle that never
  // stopped plans on stale grids while the same battle saved and resumed computes fresh ones. Here
  // tracks flatten seven wall cells by turn 3, and blue's autopilot moves a tank to 11,31 in the one
  // and to 10,36 in the other. Replaying a log repeats the same calls, so replays still agree.
  it.fails('a battle resumed from a save plays on as the one that never stopped, after tracks flatten walls', () => {
    const s: ArenaSetup = {
      seed: 3,
      terrain: 'mountains',
      river: true,
      site: null,
      attackers: [
        { id: 'b0', cls: 'armor', strength: 746, name: 'b0', color: '#888888', rank: 1 },
        { id: 'b1', cls: 'armor', strength: 955, name: 'b1', color: '#888888', rank: 1 },
        { id: 'b2', cls: 'mechanized', strength: 722, name: 'b2', color: '#888888', rank: 0 },
      ],
      defenders: [
        { id: 'r0', cls: 'armor', strength: 759, name: 'r0', color: '#888888', rank: 0 },
        { id: 'r1', cls: 'mechanized', strength: 924, name: 'r1', color: '#888888', rank: 0 },
      ],
      arsenal: { blue: 'legacy', red: 'us' },
      skill: 0.5178601946216077,
      difficulty: 'normal',
      abilities: ['armor', 'repair'],
      theatre: 'varn-delta',
      biome: 'desert',
    };
    const straight = createBattle(s);
    for (let t = 0; t < 3; t++) autoTurn(straight);
    const resumed = copy(straight);
    autoTurn(straight);
    autoTurn(resumed);
    expect(hashBattle(resumed)).toBe(hashBattle(straight));
  }, BATTLES);
});

describe('the AI needs no log', () => {
  afterEach(() => vi.restoreAllMocks());

  it('never reads the clock or an unseeded random: a whole battle runs with them taken away', () => {
    const trap = () => {
      throw new Error('the battle read the clock or Math.random');
    };
    const perf = (globalThis as { performance?: { now(): number } }).performance;
    let b: Battle;
    try {
      vi.spyOn(Math, 'random').mockImplementation(trap);
      vi.spyOn(Date, 'now').mockImplementation(trap);
      if (perf) vi.spyOn(perf, 'now').mockImplementation(trap);
      b = autoBattle(createBattle(setup({ seed: 8, terrain: 'forest', attackers: [spec('a', ['m1a2', 'm2a3', 'squad_w', 'mortar_w', 'raven'])], defenders: [spec('x', ['t90m', 'squad_e', 'kornet', 'tunguska'])] })));
    } finally {
      // Back before the test runner reads its own clock.
      vi.restoreAllMocks();
    }
    expect(b.ended).not.toBeNull();
  }, BATTLES);

  it('its turn from a state is the same wherever the state came from: the battle, its copy, its replay', () => {
    const s = arenaSetup(12, { mix: 'roster', terrain: 'hills' });
    const p = play(s, 12, { turns: 3 });
    if (p.b.ended) return;
    const a = copy(p.b);
    const c = replay(s, p.b.commands ?? []);
    endTurn(p.b);
    endTurn(a);
    endTurn(c);
    expect(hashBattle(a)).toBe(hashBattle(p.b));
    expect(hashBattle(c)).toBe(hashBattle(p.b));
    // An order the battle refused on the way leaves no trace, so the log replays the same.
    const before = hashBattle(c);
    expect(act(c, { type: 'move', unit: 'nobody', to: { x: 1, y: 1 } })).toBe(false);
    expect(hashBattle(c)).toBe(before);
  }, BATTLES);
});

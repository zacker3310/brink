import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createBattle, hashBattle, rejectedActions, ROCK, ROUND_LIMIT, WALL, type ArenaSetup, type Battle } from '@brink/arena';
import {
  change,
  CHANGES,
  copyBattle,
  copyPlayer,
  coveringSetup,
  family,
  knownLeak,
  leaks,
  player,
  playTurn,
  probe,
  probeAsk,
  probeIds,
  replayDiverges,
  rng,
  stateProblems,
  stepProblems,
  type Played,
  type Player,
  type Step,
} from '../../packages/arena/src/v2/verify.test-util';

// Arena stress matrix (docs/architecture.md, Battles): seeded battles across terrain, site, river,
// biome, time, weather, company shape (air, armour, infantry, artillery, drones, urban, long range,
// mixed, explicit rosters) and difficulty, each played to its end by the seeded player (advice, the
// planner, random legal orders and orders meant to be refused) and checked for: crashes, broken
// states and steps, commands accepted that the rules forbid, AI actions the rules refused, battles
// that do not end by the round limit, replay divergence from the command log, a save that plays on
// differently from the battle that never stopped, and fog leaks sampled at two points a battle;
// and it counts the reported defects it meets (among them the film told of a shooter blue cannot see). `ARENA_MATRIX` is the number of battles; failing cases
// are kept in arena-failing-seeds.json and run first next time.

// About 10 s of CPU a battle: the default 24 run in about 4 minutes on a quiet machine.
const SIZE = Number(process.env.ARENA_MATRIX ?? 24);
const SEEDS = fileURLToPath(new URL('./arena-failing-seeds.json', import.meta.url));

interface Failing {
  case: number;
  seed: number;
  failures: string[];
}

/** What can go wrong, in the table's order. Each is a genuine failure. */
const CHECKS = [
  'crash',
  'invalid state',
  'invalid step',
  'accepted what the rules forbid',
  'rejected AI actions',
  'did not end by the round limit',
  'replay divergence',
  'resume divergence',
  'fog leak',
] as const;
type Check = (typeof CHECKS)[number];

interface Result {
  case: number;
  setup: ArenaSetup;
  failures: Partial<Record<Check, string[]>>;
  /** Reported defects met, by id: counted and listed, not failures. */
  known: Record<string, string[]>;
  /** Unusual but valid outcomes. */
  unusual: string[];
  ending: string;
  commands: number;
  refused: number;
  hashes: number;
  changes: number;
  probes: number;
}

function readFailing(): Failing[] {
  try {
    const v = JSON.parse(readFileSync(SEEDS, 'utf8')) as unknown;
    return Array.isArray(v) ? (v as Failing[]).filter((f) => Number.isInteger(f.case)) : [];
  } catch {
    return [];
  }
}

const sightBlockers = (b: Battle) => b.map.cells.filter((c) => c === WALL || c === ROCK).length;

/** One matrix case played and checked. */
function runCase(n: number): Result {
  const setup = coveringSetup(n, 1000);
  const r: Result = { case: n, setup, failures: {}, known: {}, unusual: [], ending: 'none', commands: 0, refused: 0, hashes: 0, changes: 0, probes: 0 };
  const fail = (k: Check, what: string) => {
    const list = (r.failures[k] ??= []);
    if (list.length < 5) list.push(what);
  };
  const known = (id: string, what: string) => {
    const list = (r.known[id] ??= []);
    if (list.length < 3) list.push(what);
  };
  try {
    const b = createBattle(setup);
    const p = player(n, { advice: 0.03, planner: 0.01, illegal: 0.1, auto: 0.3, retreat: 0.003 });
    const played: Played = { setup, b, p, marks: [{ at: 0, hash: hashBattle(b) }] };
    let k = 0;
    const watch = (st: Step) => {
      k++;
      if (st.must && st.ok) fail('accepted what the rules forbid', `${st.must}: ${JSON.stringify(st.cmd)}`);
      if (!st.ok && JSON.stringify(st.b) !== st.before) fail('invalid step', `refused ${JSON.stringify(st.cmd)} changed the battle`);
      const turn = st.cmd?.type === 'end' || st.cmd?.type === 'auto';
      if (turn || k % 4 === 0) for (const x of stepProblems(JSON.parse(st.before!) as Battle, st.b, st.cmd, st.ok)) fail('invalid step', `${x} after ${JSON.stringify(st.cmd)}`);
      if (turn || k % 10 === 0) for (const x of stateProblems(st.b)) fail('invalid state', `${x} in round ${st.b.round}`);
    };
    // A save made at the start of turn 3 plays the same two turns beside the battle that never stopped.
    let shadow: { b: Battle; q: Player; blockers: number } | null = null;
    const step = (stop?: number) => {
      playTurn(p, b, watch, stop);
      if (shadow) playTurn(shadow.q, shadow.b, undefined, stop);
    };
    for (let turn = 1; turn <= ROUND_LIMIT + 2 && !b.ended; turn++) {
      if (turn === 3) shadow = { b: copyBattle(b), q: copyPlayer(p), blockers: sightBlockers(b) };
      if (turn === 2) fog(b, n * 10 + 1, false, r, known, fail);
      if (turn === 4) {
        step(5);
        fog(b, n * 10 + 2, true, r, known, fail);
      }
      const from = b.events.length;
      step();
      played.marks.push({ at: b.commands?.length ?? 0, hash: hashBattle(b) });
      unseenShooters(b, from, known);
      if (shadow) {
        r.hashes++;
        if (hashBattle(shadow.b) !== hashBattle(b)) {
          // Walls and rocks fall in play and the AI caches its sight grids per battle (reported).
          if (sightBlockers(b) !== shadow.blockers) known('resume-stale-sight', `case ${n} (seed ${setup.seed}) round ${b.round}`);
          else fail('resume divergence', `round ${b.round}`);
          shadow = null;
        } else if (turn >= 4) shadow = null;
      }
    }
    if (!b.ended) fail('did not end by the round limit', `round ${b.round}`);
    const refused = rejectedActions(b);
    if (refused.length) fail('rejected AI actions', refused.slice(0, 3).join('; '));
    const d = replayDiverges(played);
    if (d) fail('replay divergence', `after ${d.at} commands: ${d.want} replayed as ${d.got}`);
    r.hashes += played.marks.length + 1;
    r.commands = b.commands?.length ?? 0;
    r.refused = p.refused;
    r.ending = `${b.ended ?? 'none'} ${b.endReason ?? ''}`.trim();
    if (b.endReason === 'retreat') r.unusual.push('retreated');
    if (b.endReason === 'time') r.unusual.push('held to the round limit');
    if (b.ended && b.round <= 2) r.unusual.push('over in round 1 or 2');
    if (!b.events.some((e) => e.type === 'spotted' && e.side === 'blue')) r.unusual.push('no contact all battle');
    if (b.stats.blue.shots + b.stats.red.shots === 0) r.unusual.push('no shot fired');
    if (b.endReason === 'wiped') r.unusual.push('attacker wiped out');
    if (b.ended === 'won' && b.stats.blue.lost === 0) r.unusual.push('won without a loss');
  } catch (e) {
    fail('crash', e instanceof Error ? `${e.message} ${e.stack?.split('\n')[1]?.trim() ?? ''}` : String(e));
  }
  return r;
}

/** Fog, sampled at one point: three changes blue cannot see, every reading compared. */
function fog(b: Battle, seed: number, advice: boolean, r: Result, known: (id: string, what: string) => void, fail: (k: Check, what: string) => void): void {
  if (b.ended || b.turn !== 'blue') return;
  const g = rng(seed);
  for (let i = 0; i < 3; i++) {
    const kind = CHANGES[(seed + i * 4) % CHANGES.length]!;
    const c = change(b, kind, g);
    if (!c) continue;
    r.changes++;
    const ask = probeAsk(b, rng(seed + i), c.cells, probeIds(b, c));
    const exclude = new Set(c.unit ? [c.unit] : []);
    const was = probe(b, ask, { advice: advice && i === 0, exclude });
    const now = probe(c.b, ask, { advice: advice && i === 0, exclude });
    r.probes += 2;
    for (const l of leaks(was, now, c.roster ? new Set(['strength']) : new Set())) {
      const id = knownLeak(l);
      const what = `case ${r.case} (seed ${r.setup.seed}) round ${b.round}, ${kind}: ${family(l.key)} (${l.key})`;
      if (id) known(id, what);
      else fail('fog leak', `${what}: ${JSON.stringify(l.was).slice(0, 80)} vs ${JSON.stringify(l.now).slice(0, 80)}`);
    }
  }
}

/**
 * A red shot the film is told blue saw (`seen`) from a shooter blue neither had in sight (by its
 * own `spotted` and `lost` events) nor sighted after the shot, before the turn was out.
 */
function unseenShooters(b: Battle, from: number, known: (id: string, what: string) => void): void {
  const inSight = new Set<string>();
  const red = new Set(b.units.filter((u) => u.side === 'red').map((u) => u.id));
  b.events.forEach((e, i) => {
    if (e.type === 'spotted' && e.side === 'blue') inSight.add(e.unit);
    else if (e.type === 'lost' && e.side === 'blue') inSight.delete(e.unit);
    if (i < from || e.type !== 'fire' || !e.seen || !red.has(e.unit) || inSight.has(e.unit)) return;
    for (let j = i + 1; j < b.events.length; j++) {
      const f = b.events[j]!;
      if (f.type === 'turn') break;
      if (f.type === 'spotted' && f.side === 'blue' && f.unit === e.unit) return;
    }
    const u = b.units.find((x) => x.id === e.unit)!;
    // A `fire` event is `seen` when blue sees either end, and the film then shows the shooter (reported).
    known('film-unseen-shooter', `${u.id} (${u.type}, ${e.kind}) from ${e.from.x},${e.from.y} at ${e.to.x},${e.to.y} in round ${b.round}`);
  });
}

const pad = (cells: string[][]) => {
  const w = cells[0]!.map((_, i) => Math.min(48, Math.max(...cells.map((c) => (c[i] ?? '').length))));
  return cells.map((c) => c.map((v, i) => (i === c.length - 1 ? v : v.padEnd(w[i]!))).join('  ')).join('\n');
};

describe(`arena matrix (${SIZE} battles)`, () => {
  it('no crash, broken state or step, forbidden command, refused AI action, endless battle, divergence or fog leak', () => {
    const t0 = performance.now();
    const before = readFailing();
    const order = [...new Set([...before.map((f) => f.case), ...Array.from({ length: SIZE }, (_, i) => i)])];
    const results = order.map(runCase);
    const failing: Failing[] = results
      .filter((x) => Object.keys(x.failures).length)
      .map((x) => ({ case: x.case, seed: x.setup.seed, failures: Object.entries(x.failures).flatMap(([k, v]) => v.map((w) => `${k}: ${w}`)) }));
    const text = JSON.stringify(failing, null, 2) + '\n';
    let old = '';
    try {
      old = readFileSync(SEEDS, 'utf8');
    } catch {
      old = '';
    }
    if (text !== old) writeFileSync(SEEDS, text);

    const sum = (f: (x: Result) => number) => results.reduce((s, x) => s + f(x), 0);
    const count = (key: (x: Result) => string) => {
      const m: Record<string, number> = {};
      for (const x of results) m[key(x)] = (m[key(x)] ?? 0) + 1;
      return JSON.stringify(m);
    };
    const genuine: string[][] = [['check', 'failures', 'battles', 'first']];
    for (const k of CHECKS) {
      const hit = results.filter((x) => x.failures[k]?.length);
      genuine.push([k, String(sum((x) => x.failures[k]?.length ?? 0)), String(hit.length), hit[0] ? `case ${hit[0].case}: ${hit[0].failures[k]![0]}` : '']);
    }
    const ids = [...new Set(results.flatMap((x) => Object.keys(x.known)))].sort();
    const unusual: Record<string, number> = {};
    for (const x of results) for (const u of x.unusual) unusual[u] = (unusual[u] ?? 0) + 1;
    const ms = performance.now() - t0;
    console.log(
      [
        `arena matrix: ${results.length} battles (${before.length} re-run first from arena-failing-seeds.json), ${sum((x) => x.commands)} commands logged and ${sum((x) => x.refused)} refused, ${sum((x) => x.hashes)} hashes compared, ${sum((x) => x.changes)} hidden changes (${sum((x) => x.probes)} probes), ${Math.round(ms / 1000)} s (${Math.round(ms / results.length / 100) / 10} s a battle)`,
        `covered: terrain ${count((x) => x.setup.terrain)}, site ${count((x) => String(x.setup.site))}, time ${count((x) => x.setup.time ?? 'drawn')}, weather ${count((x) => x.setup.weather ?? 'drawn')}, biome ${count((x) => x.setup.biome ?? 'drawn')}`,
        `         company ${count((x) => (x.setup.attackers[0]?.types ? 'roster' : x.setup.attackers.map((a) => a.cls).join('+')))}, difficulty ${count((x) => x.setup.difficulty ?? 'normal')}`,
        '',
        'GENUINE FAILURES',
        pad(genuine),
        '',
        'REPORTED DEFECTS MET (known: counted, not failures)',
        ids.length ? pad([['defect', 'battles', 'example'], ...ids.map((id) => [id, String(results.filter((x) => x.known[id]).length), results.find((x) => x.known[id])!.known[id]![0]!])]) : 'none',
        '',
        'UNUSUAL BUT VALID OUTCOMES',
        Object.keys(unusual).length ? pad([['outcome', 'battles'], ...Object.entries(unusual).sort().map(([k, v]) => [k, String(v)])]) : 'none',
        '',
        `endings ${count((x) => x.ending)}`,
        `rejected AI actions ${sum((x) => x.failures['rejected AI actions']?.length ?? 0)}`,
      ].join('\n'),
    );
    expect(failing, failing.length ? `failing cases written to arena-failing-seeds.json: ${failing.map((f) => f.case).join(', ')}` : '').toEqual([]);
  }, Math.max(900_000, (SIZE + 10) * 120_000));
});

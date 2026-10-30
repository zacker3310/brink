import { describe, expect, it } from 'vitest';
import type { Terrain, UnitClass } from '@brink/contracts';
import { act, arenaResult, autoBattle, createBattle, DIFFICULTY, endTurn, FEWEST_ENEMIES, playSide, rejectedActions, ROUND_LIMIT, typeOf, type Arsenal, type ArenaSetup, type Battle, type Difficulty, type SiteKind, type UnitSpec } from '@brink/arena';
import { mulberry32 } from '@brink/arena';

// Arena v2 soak: AI against AI over many battles across arsenals, biomes, times and weather.
// Every battle must end, the AI must never choose an action the rules refuse, and no state may
// break. The balance it measures is printed for docs/arena-v2.md.
//
// Each setup is fought at every difficulty, the AI's own planner in the player's seat (the way
// the war campaign's difficulty was measured), so the win rates per difficulty compare like with
// like. `ARENA_SOAK` is the number of setups.

const SETUPS = Number(process.env.ARENA_SOAK ?? 60);
const LEVELS: Difficulty[] = ['easy', 'normal', 'hard'];
const BATTLES = SETUPS * LEVELS.length;
const CLASSES: UnitClass[] = ['armor', 'mechanized', 'infantry', 'recon', 'artillery', 'air', 'drone'];
const TERRAINS: Terrain[] = ['plains', 'forest', 'hills', 'mountains', 'urban'];
const SITES: SiteKind[] = [null, null, 'city', 'objective', 'depot', 'capital'];
const WEST: Arsenal[] = ['us', 'europe'];
const EAST: Arsenal[] = ['russia', 'legacy'];

function setupFor(seed: number): ArenaSetup {
  const r = mulberry32(seed * 7919);
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;
  const force = (side: 'b' | 'r', n: number): UnitSpec[] =>
    Array.from({ length: n }, (_, i) => ({ id: `${side}${i}`, cls: pick(CLASSES), strength: 600 + Math.floor(r() * 401), name: `${side}${i}`, color: '#888888', rank: Math.floor(r() * 2) }));
  const westBlue = r() < 0.5;
  const terrain = pick(TERRAINS);
  return {
    seed,
    terrain,
    river: terrain !== 'urban' && r() < 0.25,
    site: pick(SITES),
    attackers: force('b', 1 + Math.floor(r() * 3)),
    defenders: force('r', 1 + Math.floor(r() * 2)),
    arsenal: { blue: pick(westBlue ? WEST : EAST), red: pick(westBlue ? EAST : WEST) },
    skill: 0.2 + r() * 0.6,
    abilities: [],
    theatre: pick(['meridian-crisis', 'highland-front', 'varn-delta']),
  };
}

/** Everything that must hold when a battle is over. Returns what broke. */
function invariants(b: Battle): string[] {
  const bad: string[] = [];
  if (!b.ended) bad.push('did not end');
  if (b.round > 16) bad.push(`round ${b.round}`);
  const ground = new Map<string, string>();
  const air = new Map<string, string>();
  for (const u of b.units) {
    if (!Number.isInteger(u.x) || !Number.isInteger(u.y) || u.x < 0 || u.y < 0 || u.x >= b.map.w || u.y >= b.map.h) bad.push(`${u.id} at ${u.x},${u.y}`);
    if (u.supp < 0 || u.supp > 100) bad.push(`${u.id} suppression ${u.supp}`);
    if (u.crew < 0 || u.crew > typeOf(u.type).crew) bad.push(`${u.id} crew ${u.crew}`);
    if (!u.alive || u.carrier) continue;
    const t = typeOf(u.type);
    const key = `${u.x},${u.y}`;
    const layer = t.mobility === 'heli' || t.mobility === 'drone' ? air : ground;
    if (layer.has(key)) bad.push(`${u.id} and ${layer.get(key)} share ${key}`);
    layer.set(key, u.id);
    if (t.mobility === 'foot' && !u.men.some((m) => m.state === 'fit')) bad.push(`${u.id} alive with nobody fit`);
    for (const id of u.passengers) {
      const p = b.units.find((x) => x.id === id);
      if (!p || p.carrier !== u.id) bad.push(`${u.id} carries ${id} that is not aboard`);
    }
  }
  for (const v of Object.values(arenaResult(b).kept)) if (!(v >= 0 && v <= 1000)) bad.push(`kept ${v}`);
  return bad;
}

describe(`arena soak (${SETUPS} setups at ${LEVELS.length} difficulties)`, () => {
  it('every battle ends, the AI never breaks a rule, and no state breaks', () => {
    const tally = (m: Record<string, [number, number]>, k: string, won: boolean) => {
      const e = (m[k] ??= [0, 0]);
      e[0] += won ? 1 : 0;
      e[1]++;
    };
    const by = { difficulty: {}, biome: {}, time: {}, weather: {}, mode: {}, matchup: {}, size: {} } as Record<string, Record<string, [number, number]>>;
    const reasons: Record<string, number> = {};
    const kills: Record<string, [number, number]> = {};
    const rounds: number[] = [];
    const ms: number[] = [];
    let rejected = 0;
    let units = 0;
    const used: Record<string, number> = { smoke: 0, 'called fire': 0, 'off-map rockets': 0, 'drone strikes': 0, dismounts: 0, splits: 0, treated: 0, repairs: 0, 'AD shots at aircraft': 0, 'hits front': 0, 'hits side or rear': 0, 'hits top': 0 };
    const msBy: Record<string, number> = {};
    for (let n = 0; n < BATTLES; n++) {
      const seed = 1 + Math.floor(n / LEVELS.length);
      const difficulty = LEVELS[n % LEVELS.length]!;
      const setup = { ...setupFor(seed), difficulty };
      const t0 = performance.now();
      const b = autoBattle(createBattle(setup));
      ms.push(performance.now() - t0);
      msBy[difficulty] = (msBy[difficulty] ?? 0) + ms.at(-1)!;
      const bad = invariants(b);
      expect(bad, `seed ${seed} ${difficulty}`).toEqual([]);
      const refused = rejectedActions(b);
      if (refused.length) console.log('refused', seed, difficulty, refused.slice(0, 5));
      rejected += refused.length;
      const won = b.ended === 'won';
      tally(by.difficulty!, difficulty, won);
      tally(by.biome!, b.conditions.biome, won);
      tally(by.time!, b.conditions.time, won);
      tally(by.weather!, b.conditions.weather, won);
      tally(by.mode!, b.map.mode, won);
      tally(by.matchup!, `${setup.arsenal.blue}>${setup.arsenal.red}`, won);
      const blue = b.units.filter((u) => u.side === 'blue').length;
      tally(by.size!, blue >= 14 ? '14-16' : blue >= 12 ? '12-13' : '10-11', won);
      reasons[b.endReason ?? 'none'] = (reasons[b.endReason ?? 'none'] ?? 0) + 1;
      rounds.push(b.round);
      units += b.units.length;
      const typeById = new Map(b.units.map((u) => [u.id, u.type]));
      for (const e of b.events) {
        if (e.type === 'smoke') used.smoke!++;
        else if (e.type === 'fire') {
          if (e.unit.startsWith('support:')) used['off-map rockets']!++;
          else if (e.kind === 'mortar' || e.kind === 'howitzer') used['called fire']!++;
          else if (e.kind === 'fpv' || e.kind === 'loiter') used['drone strikes']!++;
          const shooter = typeById.get(e.unit);
          const target = e.target ? typeById.get(e.target) : undefined;
          if (shooter && target && (typeOf(shooter).role === 'spaa' || typeOf(shooter).role === 'aa_team') && (typeOf(target).mobility === 'heli' || typeOf(target).mobility === 'drone')) used['AD shots at aircraft']!++;
        } else if (e.type === 'dismount') used.dismounts!++;
        else if (e.type === 'split') used.splits!++;
        else if (e.type === 'treat') used.treated!++;
        else if (e.type === 'repair') used.repairs!++;
        else if (e.type === 'impact') used[e.facing === 'front' ? 'hits front' : e.facing === 'top' ? 'hits top' : 'hits side or rear']!++;
      }
      for (const u of b.units) {
        const k = (kills[u.type] ??= [0, 0]);
        k[1]++;
        if (!u.alive) k[0]++;
      }
      // A template company is 10 to 16 a side; Easy fields a smaller one, never under the floor.
      expect(b.units.filter((u) => u.side === 'red').length).toBeGreaterThanOrEqual(DIFFICULTY[difficulty].enemyUnits < 1 ? FEWEST_ENEMIES : 10);
    }
    rounds.sort((a, c) => a - c);
    ms.sort((a, c) => a - c);
    const pct = (m: Record<string, [number, number]>) => Object.fromEntries(Object.entries(m).sort().map(([k, [w, n]]) => [k, `${Math.round((w / n) * 100)}% of ${n}`]));
    const wins = Object.values(by.mode!).reduce((s, [w]) => s + w, 0);
    console.log(`attacker wins ${wins}/${BATTLES} (${Math.round((wins / BATTLES) * 100)}%)`);
    // The difficulty table, measured: the AI's planner in the player's seat.
    for (const d of LEVELS) {
      const [w, n] = by.difficulty![d]!;
      const { aim, enemyAim, enemyUnits, skill } = DIFFICULTY[d];
      console.log(`difficulty ${d}: attacker wins ${w}/${n} (${Math.round((w / n) * 100)}%), aim ${aim}, enemy aim ${enemyAim}, enemy units x${enemyUnits}, skill ${skill >= 0 ? '+' : ''}${skill}, ${Math.round((msBy[d] ?? 0) / n)} ms a battle`);
    }
    console.log('end reasons', reasons);
    console.log('rounds median', rounds[Math.floor(rounds.length / 2)], 'p90', rounds[Math.floor(rounds.length * 0.9)]);
    for (const [k, m] of Object.entries(by)) console.log(`attacker wins by ${k}`, pct(m));
    console.log('loss rate by type', Object.fromEntries(Object.entries(kills).sort().map(([k, [d, n]]) => [k, `${Math.round((d / n) * 100)}% of ${n}`])));
    console.log('units per battle', Math.round(units / BATTLES), 'ms per battle median', Math.round(ms[Math.floor(ms.length / 2)]!), 'p95', Math.round(ms[Math.floor(ms.length * 0.95)]!));
    console.log('tactics used', used);
    console.log('rejected AI actions', rejected);
    expect(rejected).toBe(0);
    // The same setups get harder from Easy to Hard (the bands themselves are noisy: see the log).
    if (SETUPS >= 20) {
      expect(by.difficulty!.easy![0]).toBeGreaterThan(by.difficulty!.normal![0]);
      expect(by.difficulty!.normal![0]).toBeGreaterThan(by.difficulty!.hard![0]);
    }
  });

  it('a player who holds part of the company each turn: every hold is taken, the AI still breaks no rule', () => {
    let rejected = 0;
    let holds = 0;
    let refusedHolds = 0;
    const n = Math.min(SETUPS, 20);
    for (let seed = 1; seed <= n; seed++) {
      const b = createBattle({ ...setupFor(seed), difficulty: LEVELS[seed % LEVELS.length]! });
      for (let i = 0; i <= ROUND_LIMIT && !b.ended; i++) {
        b.units.forEach((u, k) => {
          if (k % 3 !== i % 3 || b.ended || u.side !== 'blue' || !u.alive || u.acted || u.carrier) return;
          holds++;
          if (!act(b, { type: 'hold', unit: u.id })) refusedHolds++;
        });
        playSide(b, 'blue');
        endTurn(b);
      }
      expect(invariants(b), `seed ${seed}`).toEqual([]);
      rejected += rejectedActions(b).length;
    }
    console.log('holds', holds, 'refused holds', refusedHolds, 'rejected AI actions with holds', rejected);
    expect(holds).toBeGreaterThan(n);
    expect(refusedHolds).toBe(0);
    expect(rejected).toBe(0);
  });
});

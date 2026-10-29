import { describe, expect, it } from 'vitest';
import type { Terrain, UnitClass } from '@brink/contracts';
import { arenaResult, autoBattle, createBattle, rejectedActions, typeOf, type Arsenal, type ArenaSetup, type Battle, type SiteKind, type UnitSpec } from '@brink/arena';
import { mulberry32 } from '@brink/arena';

// Arena v2 soak: AI against AI over many battles across arsenals, biomes, times and weather.
// Every battle must end, the AI must never choose an action the rules refuse, and no state may
// break. The balance it measures is printed for docs/arena-v2.md.

const BATTLES = Number(process.env.ARENA_SOAK ?? 120);
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

describe(`arena soak (${BATTLES} battles)`, () => {
  it('every battle ends, the AI never breaks a rule, and no state breaks', () => {
    const tally = (m: Record<string, [number, number]>, k: string, won: boolean) => {
      const e = (m[k] ??= [0, 0]);
      e[0] += won ? 1 : 0;
      e[1]++;
    };
    const by = { biome: {}, time: {}, weather: {}, mode: {}, matchup: {}, size: {} } as Record<string, Record<string, [number, number]>>;
    const reasons: Record<string, number> = {};
    const kills: Record<string, [number, number]> = {};
    const rounds: number[] = [];
    const ms: number[] = [];
    let rejected = 0;
    let units = 0;
    for (let seed = 1; seed <= BATTLES; seed++) {
      const setup = setupFor(seed);
      const t0 = performance.now();
      const b = autoBattle(createBattle(setup));
      ms.push(performance.now() - t0);
      const bad = invariants(b);
      expect(bad, `seed ${seed}`).toEqual([]);
      const refused = rejectedActions(b);
      if (refused.length) console.log('refused', seed, refused.slice(0, 5));
      rejected += refused.length;
      const won = b.ended === 'won';
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
      for (const u of b.units) {
        const k = (kills[u.type] ??= [0, 0]);
        k[1]++;
        if (!u.alive) k[0]++;
      }
      expect(b.units.filter((u) => u.side === 'red').length).toBeGreaterThanOrEqual(10);
    }
    rounds.sort((a, c) => a - c);
    ms.sort((a, c) => a - c);
    const pct = (m: Record<string, [number, number]>) => Object.fromEntries(Object.entries(m).sort().map(([k, [w, n]]) => [k, `${Math.round((w / n) * 100)}% of ${n}`]));
    const wins = Object.values(by.mode!).reduce((s, [w]) => s + w, 0);
    console.log(`attacker wins ${wins}/${BATTLES} (${Math.round((wins / BATTLES) * 100)}%)`);
    console.log('end reasons', reasons);
    console.log('rounds median', rounds[Math.floor(rounds.length / 2)], 'p90', rounds[Math.floor(rounds.length * 0.9)]);
    for (const [k, m] of Object.entries(by)) console.log(`attacker wins by ${k}`, pct(m));
    console.log('loss rate by type', Object.fromEntries(Object.entries(kills).sort().map(([k, [d, n]]) => [k, `${Math.round((d / n) * 100)}% of ${n}`])));
    console.log('units per battle', Math.round(units / BATTLES), 'ms per battle median', Math.round(ms[Math.floor(ms.length / 2)]!), 'p95', Math.round(ms[Math.floor(ms.length * 0.95)]!));
    console.log('rejected AI actions', rejected);
    expect(rejected).toBe(0);
  });
});

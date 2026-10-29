import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Terrain } from '@brink/contracts';
import { pickBiome, pickConditions } from './conditions';
import * as gen from './map';
import * as v2 from './types';
import type { BattleMap, Biome, Cell, MapSetup, Mobility, Point, SiteKind } from './types';

// Local copies: the test loader turns imported names into getter calls, slow in these loops.
const { buildMap, canStep, passable, renderAscii } = gen;
const { at, BRIDGE, BUILDING, BUILDING_HP_PER_STOREY, H, MAX_ELEV, OPEN, ROAD, ROCK, RUBBLE, TREE_KINDS, TREES, W, WALL, WALL_KINDS, WATER, ZONE_RADIUS } = v2;

const TERRAINS: Terrain[] = ['plains', 'forest', 'hills', 'mountains', 'urban'];
const BIOMES: Biome[] = ['temperate', 'steppe', 'desert', 'winter', 'urban'];
const SITES: SiteKind[] = [null, 'city', 'objective', 'depot', 'capital'];
const SEEDS = 12;
const N = W * H;

/** Every biome, river on and off, every site, over the seeds, for one terrain. */
function* setups(terrain: Terrain): Generator<MapSetup> {
  for (const biome of BIOMES) for (const river of [false, true]) for (const site of SITES) for (let seed = 1; seed <= SEEDS; seed++) yield { seed, terrain, river, site, biome };
}

const label = (s: MapSetup) => `${s.biome} ${s.terrain} river=${s.river} site=${s.site} seed=${s.seed}`;
const capture = (site: SiteKind) => site === 'capital' || site === 'city' || site === 'objective';

/** Cells a ground vehicle reaches from the blue spawn by orthogonal steps. */
function reach(map: BattleMap, mobility: Mobility): Uint8Array {
  const seen = new Uint8Array(N);
  const queue: number[] = [];
  for (const p of map.blueSpawn) {
    seen[at(map, p.x, p.y)] = 1;
    queue.push(at(map, p.x, p.y));
  }
  const from: Point = { x: 0, y: 0 };
  const to: Point = { x: 0, y: 0 };
  for (let k = 0; k < queue.length; k++) {
    const i = queue[k]!;
    from.x = i % W;
    from.y = (i - from.x) / W;
    for (let d = 0; d < 4; d++) {
      to.x = from.x + (d === 0 ? 1 : d === 1 ? -1 : 0);
      to.y = from.y + (d === 2 ? 1 : d === 3 ? -1 : 0);
      if (!passable(map, to.x, to.y, mobility) || seen[at(map, to.x, to.y)] || !canStep(map, from, to, mobility)) continue;
      seen[at(map, to.x, to.y)] = 1;
      queue.push(at(map, to.x, to.y));
    }
  }
  return seen;
}

/** Separate bridges: groups of BRIDGE cells joined side by side. */
function crossings(map: BattleMap): number {
  const seen = new Uint8Array(N);
  let n = 0;
  for (let i = 0; i < N; i++) {
    if (map.cells[i] !== BRIDGE || seen[i]) continue;
    n++;
    const stack = [i];
    seen[i] = 1;
    while (stack.length) {
      const j = stack.pop()!;
      const x = j % W;
      for (const k of [j - W, j + W, x > 0 ? j - 1 : -1, x < W - 1 ? j + 1 : -1])
        if (k >= 0 && k < N && map.cells[k] === BRIDGE && !seen[k]) {
          seen[k] = 1;
          stack.push(k);
        }
    }
  }
  return n;
}

/** Everything every map must satisfy, as a list of what is wrong. */
function problems(map: BattleMap, s: MapSetup): string[] {
  const out: string[] = [];
  const bad = (what: string) => out.length < 12 && out.push(what);
  if (map.w !== W || map.h !== H) bad('size');
  for (const k of ['cells', 'elev', 'storeys', 'hp', 'variant', 'crater'] as const) if (map[k].length !== N) bad(`${k} length ${map[k].length}`);
  if (map.biome !== s.biome || map.terrain !== s.terrain) bad('biome or terrain');
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = at(map, x, y);
      const c = map.cells[i]!;
      const e = map.elev[i]!;
      if (!Number.isInteger(e) || e < 0 || e > MAX_ELEV) bad(`elev ${e} at ${x},${y}`);
      // Cliffs (two levels or more between neighbours) only in the mountains.
      if (s.terrain !== 'mountains') {
        if (x < W - 1 && Math.abs(e - map.elev[i + 1]!) > 1) bad(`cliff at ${x},${y} east`);
        if (y < H - 1 && Math.abs(e - map.elev[i + W]!) > 1) bad(`cliff at ${x},${y} south`);
      }
      const st = map.storeys[i]!;
      const hp = map.hp[i]!;
      if (c === BUILDING ? st < 1 || st > 4 || hp !== BUILDING_HP_PER_STOREY * st : st !== 0) bad(`storeys ${st} hp ${hp} on ${c} at ${x},${y}`);
      if (c !== BUILDING && hp !== (c === TREES ? 2 : c === WALL ? 1 : 0)) bad(`hp ${hp} on ${c} at ${x},${y}`);
      const v = map.variant[i]!;
      if (!Number.isInteger(v) || v < 0 || v > 255) bad(`variant ${v}`);
      if (map.crater[i] !== 0) bad('crater');
      // Buildings stand on level ground.
      if (c === BUILDING && x < W - 1 && map.cells[i + 1] === BUILDING && map.elev[i + 1] !== e) bad(`building on a slope at ${x},${y}`);
      if (c === BUILDING && y < H - 1 && map.cells[i + W] === BUILDING && map.elev[i + W] !== e) bad(`building on a slope at ${x},${y}`);
    }
  // Mode and zone.
  if (map.mode !== (capture(s.site) ? 'capture' : 'destroy')) bad(`mode ${map.mode}`);
  const z = map.zone;
  if (capture(s.site) !== (z !== null)) bad('zone presence');
  if (z) {
    if (z.r !== ZONE_RADIUS || Math.abs(z.x - 15) > 1 || Math.abs(z.y - 10) > 1) bad(`zone ${JSON.stringify(z)}`);
    const centre = map.cells[at(map, z.x, z.y)];
    if (centre !== OPEN && centre !== ROAD) bad(`zone centre is ${centre}`);
    let open = 0;
    let all = 0;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        if ((x - z.x) ** 2 + (y - z.y) ** 2 <= z.r * z.r) {
          all++;
          const c = map.cells[at(map, x, y)];
          if (c === OPEN || c === ROAD) open++;
        }
    if (open < all * 0.7) bad(`zone only ${open}/${all} open`);
  }
  // Spawns: standable, unique, enough of them.
  const blue = new Set(map.blueSpawn.map((p) => at(map, p.x, p.y)));
  if (blue.size !== map.blueSpawn.length || blue.size < 24) bad(`blue spawn ${blue.size}/${map.blueSpawn.length}`);
  for (const p of map.blueSpawn) {
    const c = map.cells[at(map, p.x, p.y)];
    if (p.y < 40 || p.y > 44 || p.x < 0 || p.x >= W || c === WATER || c === BUILDING || c === ROCK || c === TREES) bad(`blue spawn ${p.x},${p.y} on ${c}`);
  }
  const red = new Set(map.redSpawn.map((p) => at(map, p.x, p.y)));
  if (red.size !== map.redSpawn.length || red.size < 60) bad(`red spawn ${red.size}/${map.redSpawn.length}`);
  for (const p of map.redSpawn) {
    const c = map.cells[at(map, p.x, p.y)];
    if (p.y < 2 || p.y > 24 || p.x < 0 || p.x >= W || c === WATER || c === ROCK) bad(`red spawn ${p.x},${p.y} on ${c}`);
  }
  // Tanks and trucks can drive from the deployment rows to the objective.
  for (const mobility of ['tracked', 'wheeled'] as const) {
    const r = reach(map, mobility);
    const ok = z ? r[at(map, z.x, z.y)] === 1 : r.subarray(8 * W, 9 * W).some((v) => v === 1);
    if (!ok) bad(`${mobility} cannot reach the ${z ? 'zone' : 'row 8'}`);
  }
  // The river: water right across the middle band, two or three bridges, nothing anywhere else.
  let water = 0;
  for (let i = 0; i < N; i++) {
    const c = map.cells[i];
    const y = (i / W) | 0;
    if (c === WATER || c === BRIDGE) {
      water++;
      if (y < 17 || y > 27) bad(`water on row ${y}`);
    }
  }
  if (s.river) {
    for (let x = 0; x < W; x++) {
      let across = false;
      for (let y = 17; y <= 27; y++) if (map.cells[at(map, x, y)] === WATER) across = true;
      if (!across && map.cells.every((c, i) => i % W !== x || c !== BRIDGE)) bad(`no river in column ${x}`);
    }
    const n = crossings(map);
    if (n < 2 || n > 3) bad(`${n} bridges`);
    // Each bridge runs from road on one bank to road on the other.
    for (let i = 0; i < N; i++) {
      if (map.cells[i] !== BRIDGE) continue;
      for (const k of [i - W, i + W]) if (map.cells[k] !== BRIDGE && map.cells[k] !== ROAD) bad(`bridge end at ${k % W},${(k / W) | 0} is ${map.cells[k]}`);
    }
  } else if (water > 0) bad('water without a river');
  return out;
}

// Each terrain's maps are built once and shared by the tests that look at them.
for (const terrain of TERRAINS)
  describe(`${terrain} maps`, () => {
    let maps: { s: MapSetup; map: BattleMap }[] = [];
    beforeAll(() => {
      maps = [...setups(terrain)].map((s) => ({ s, map: buildMap(s) }));
    });
    afterAll(() => {
      maps = [];
    });
    /** Fails with the map drawn when `ok` is false; draws nothing when it holds. */
    const holds = (ok: boolean, s: MapSetup, map: BattleMap, what: string) => {
      if (!ok) expect(ok, `${label(s)}: ${what}\n${renderAscii(map)}`).toBe(true);
    };

    it('every biome, site and river setting builds a sound field', () => {
      expect(maps.length).toBe(BIOMES.length * 2 * SITES.length * SEEDS);
      for (const { s, map } of maps) {
        const wrong = problems(map, s);
        if (wrong.length) expect(wrong, `${label(s)}\n${renderAscii(map)}`).toEqual([]);
      }
    });

    it('urban biome maps are dense blocks with tall apartments', () => {
      for (const { s, map } of maps.filter((m) => m.s.biome === 'urban')) {
        const buildings = map.cells.filter((c) => c === BUILDING).length;
        const tall = map.storeys.filter((n) => n >= 3).length;
        holds(buildings >= 180 && tall >= 30, s, map, `${buildings} buildings, ${tall} tall`);
      }
    });

    it('city and capital sites have a tall urban core round the zone', () => {
      for (const { s, map } of maps.filter((m) => m.s.site === 'city' || m.s.site === 'capital')) {
        const z = map.zone!;
        let tall = 0;
        for (let i = 0; i < N; i++) if (map.storeys[i]! >= 3 && Math.hypot((i % W) - z.x, ((i / W) | 0) - z.y) <= 10) tall++;
        holds(tall >= 4, s, map, `${tall} tall buildings near the zone`);
      }
    });

    it('steppe maps have long straight tree lines', () => {
      for (const { s, map } of maps.filter((m) => m.s.biome === 'steppe')) {
        let best = 0;
        for (let y = 0; y < H; y++)
          for (let x = 0, run = 0; x < W; x++) {
            run = map.cells[at(map, x, y)] === TREES ? run + 1 : 0;
            best = Math.max(best, run);
          }
        holds(best >= 8, s, map, `longest tree line ${best}`);
      }
    });

    it('kinds follow the biome: desert scrub and stone, winter conifer and birch, Hesco round objectives', () => {
      const kinds = (map: BattleMap, cell: Cell) => new Set(map.cells.flatMap((c, i) => (c === cell ? [map.variant[i]! & 3] : [])));
      const only = (got: Set<number>, names: readonly string[], all: readonly string[]) => [...got].every((k) => names.includes(all[k]!));
      for (const { s, map } of maps) {
        const trees = kinds(map, TREES);
        const walls = kinds(map, WALL);
        if (s.biome === 'desert') {
          holds(only(trees, ['scrub'], TREE_KINDS), s, map, 'desert trees');
          holds(only(walls, ['stone', 'sandbag', 'hesco'], WALL_KINDS), s, map, 'desert walls');
        }
        if (s.biome === 'winter') holds(only(trees, ['conifer', 'birch'], TREE_KINDS), s, map, 'winter trees');
        if (s.biome === 'steppe') holds(only(trees, ['broadleaf', 'birch'], TREE_KINDS), s, map, 'steppe trees');
        if (s.biome === 'urban') holds(walls.has(WALL_KINDS.indexOf('sandbag')), s, map, 'urban sandbags');
        if (s.site === 'objective') {
          const z = map.zone!;
          let hesco = 0;
          for (let i = 0; i < N; i++) if (map.cells[i] === WALL && WALL_KINDS[map.variant[i]! & 3] === 'hesco' && Math.hypot((i % W) - z.x, ((i / W) | 0) - z.y) < 6.5) hesco++;
          holds(hesco >= 8, s, map, `${hesco} Hesco round the zone`);
        }
      }
    });

    if (terrain === 'plains' || terrain === 'hills' || terrain === 'forest')
      it('temperate, steppe and winter fields have a village; temperate ones are hedged', () => {
        for (const { s, map } of maps.filter((m) => m.s.site === null && (m.s.biome === 'temperate' || m.s.biome === 'steppe' || m.s.biome === 'winter'))) {
          holds(map.cells.filter((c) => c === BUILDING).length >= 8, s, map, 'village buildings');
          if (s.biome === 'temperate') holds(map.cells.some((c, i) => c === WALL && WALL_KINDS[map.variant[i]! & 3] === 'hedge'), s, map, 'hedges');
        }
      });

    if (terrain === 'hills')
      it('hills top out at 3, with crests that have lower ground behind them: hull-down spots', () => {
        for (const { s, map } of maps) {
          const e = (x: number, y: number) => map.elev[at(map, x, y)]!;
          let crests = 0;
          for (let y = 1; y < H - 2; y++)
            for (let x = 0; x < W; x++) if (e(x, y) >= 2 && e(x, y - 1) < e(x, y) && e(x, y + 1) <= e(x, y) && e(x, y + 2) < e(x, y)) crests++;
          holds(crests > 0, s, map, 'crests');
          holds(Math.max(...map.elev) <= 3, s, map, 'highest level');
        }
      });

    if (terrain === 'mountains')
      it('mountains rise to 4 with rock on the heights and cliffs on most maps', () => {
        let cliffs = 0;
        for (const { s, map } of maps) {
          holds(Math.max(...map.elev) === MAX_ELEV, s, map, 'highest level');
          // A city on a mountain has cleared its rock; everywhere else the heights are rocky.
          if (s.biome !== 'urban') holds(map.cells.filter((c) => c === ROCK).length > 5, s, map, 'rock');
          if (map.elev.some((e, i) => (i % W < W - 1 && Math.abs(e - map.elev[i + 1]!) > 1) || (i + W < N && Math.abs(e - map.elev[i + W]!) > 1))) cliffs++;
        }
        expect(cliffs / maps.length).toBeGreaterThan(0.6);
      });

    if (terrain !== 'hills' && terrain !== 'mountains')
      it('keeps to low ground', () => {
        for (const { s, map } of maps) holds(Math.max(...map.elev) <= (terrain === 'urban' ? 1 : 2), s, map, 'highest level');
      });
  });

describe('battle maps', () => {
  it('the same seed builds the same map, another seed another', () => {
    for (const terrain of TERRAINS)
      for (const biome of BIOMES) {
        const s: MapSetup = { seed: 41, terrain, biome, river: true, site: terrain === 'urban' ? 'city' : 'objective' };
        const a = buildMap(s);
        expect(buildMap(s), label(s)).toEqual(a);
        const b = buildMap({ ...s, seed: 42 });
        expect(b.cells.join() === a.cells.join() && b.elev.join() === a.elev.join(), label(s)).toBe(false);
      }
  });

  it('builds a map in well under 20 ms', () => {
    let n = 0;
    const t0 = Date.now();
    for (const terrain of TERRAINS)
      for (const biome of BIOMES)
        for (let seed = 100; seed < 104; seed++) {
          buildMap({ seed, terrain, biome, river: seed % 2 === 0, site: SITES[seed % SITES.length]! });
          n++;
        }
    expect((Date.now() - t0) / n).toBeLessThan(20);
  });

  it('a road runs from the attackers edge to the top of the field', () => {
    for (const terrain of TERRAINS)
      for (const biome of BIOMES) {
        const map = buildMap({ seed: 7, terrain, biome, river: true, site: null });
        const seen = new Uint8Array(N);
        const queue: number[] = [];
        for (let x = 0; x < W; x++)
          if (map.cells[at(map, x, H - 1)] === ROAD) {
            seen[at(map, x, H - 1)] = 1;
            queue.push(at(map, x, H - 1));
          }
        for (let k = 0; k < queue.length; k++) {
          const i = queue[k]!;
          for (const j of [i - W, i + W, i % W > 0 ? i - 1 : -1, i % W < W - 1 ? i + 1 : -1])
            if (j >= 0 && j < N && !seen[j] && (map.cells[j] === ROAD || map.cells[j] === BRIDGE)) {
              seen[j] = 1;
              queue.push(j);
            }
        }
        expect(seen.subarray(0, W).some((v) => v === 1), `${biome} ${terrain}\n${renderAscii(map)}`).toBe(true);
      }
  });

  it('passable and canStep follow the mobility rules', () => {
    const map = buildMap({ seed: 3, terrain: 'plains', biome: 'temperate', river: false, site: null });
    const cells: Cell[] = [OPEN, ROAD, TREES, WATER, BRIDGE, BUILDING, RUBBLE, WALL, ROCK];
    cells.forEach((c, x) => {
      map.cells[at(map, x, 30)] = c;
    });
    const row = (mobility: Mobility, amphibious = false) => cells.map((_, x) => passable(map, x, 30, mobility, amphibious));
    //                              OPEN  ROAD   TREES  WATER  BRIDGE BUILD  RUBBLE WALL   ROCK
    expect(row('tracked')).toEqual([true, true, false, false, true, false, true, true, false]);
    expect(row('tracked', true)).toEqual([true, true, false, true, true, false, true, true, false]);
    expect(row('wheeled')).toEqual([true, true, false, false, true, false, false, false, false]);
    expect(row('wheeled', true)).toEqual([true, true, false, true, true, false, false, false, false]);
    expect(row('foot')).toEqual([true, true, true, false, true, true, true, true, true]);
    expect(row('heli')).toEqual(cells.map(() => true));
    expect(row('drone')).toEqual(cells.map(() => true));
    expect(passable(map, -1, 0, 'heli')).toBe(false);
    expect(passable(map, 0, H, 'foot')).toBe(false);
    map.elev[at(map, 0, 0)] = 0;
    map.elev[at(map, 1, 0)] = 1;
    map.elev[at(map, 2, 0)] = 3;
    const a = { x: 0, y: 0 };
    const b = { x: 1, y: 0 };
    const c = { x: 2, y: 0 };
    expect([canStep(map, a, b, 'tracked'), canStep(map, a, b, 'wheeled'), canStep(map, b, c, 'tracked'), canStep(map, c, b, 'wheeled')]).toEqual([true, true, false, false]);
    expect([canStep(map, b, c, 'foot'), canStep(map, a, c, 'foot'), canStep(map, a, c, 'heli'), canStep(map, a, c, 'drone')]).toEqual([true, false, true, true]);
  });

  it('draws the map as text: a header, a row of cells and levels per row, a legend', () => {
    const map = buildMap({ seed: 5, terrain: 'hills', biome: 'temperate', river: true, site: 'objective' });
    const lines = renderAscii(map).split('\n');
    expect(lines[0]).toContain('temperate hills capture');
    const rows = lines.slice(1, 1 + H);
    expect(rows.every((r) => r.length === 3 + W + 2 + W)).toBe(true);
    expect(rows.slice(17, 28).join('')).toMatch(/~/);
    expect(rows.slice(17, 28).join('')).toMatch(/H/);
    expect(rows.join('')).toContain('X');
  });
});

describe('battle conditions', () => {
  const base = { terrain: 'plains', site: null } as const;

  it('are a function of the setup', () => {
    for (let seed = 0; seed < 200; seed++) expect(pickConditions({ ...base, seed })).toEqual(pickConditions({ ...base, seed }));
  });

  it('explicit choices win', () => {
    for (let seed = 0; seed < 50; seed++) {
      expect(pickConditions({ ...base, seed, biome: 'desert', time: 'night', weather: 'fog' })).toEqual({ biome: 'desert', time: 'night', weather: 'fog' });
      expect(pickConditions({ seed, terrain: 'urban', site: 'capital', biome: 'winter' }).biome).toBe('winter');
    }
  });

  it('towns are urban; the theatres set the rest', () => {
    for (let seed = 0; seed < 100; seed++) {
      expect(pickBiome({ seed, terrain: 'urban', site: null })).toBe('urban');
      expect(pickBiome({ seed, terrain: 'forest', site: 'city' })).toBe('urban');
      expect(pickBiome({ seed, terrain: 'hills', site: 'capital', theatre: 'highland-front' })).toBe('urban');
      expect(pickBiome({ seed, terrain: 'mountains', site: null, theatre: 'highland-front' })).toBe('winter');
      expect(pickBiome({ seed, terrain: 'forest', site: 'depot', theatre: 'highland-front' })).toBe('winter');
      expect(pickBiome({ seed, terrain: 'plains', site: null, theatre: 'highland-front' })).toBe('temperate');
      expect(pickBiome({ seed, terrain: 'hills', site: null, theatre: 'varn-delta' })).toBe('steppe');
      expect(pickBiome({ seed, terrain: 'forest', site: null, theatre: 'meridian' })).toBe('temperate');
    }
  });

  it('the desert never sees rain or snow, and snow falls only in winter', () => {
    for (let seed = 0; seed < 2000; seed++) {
      expect(['rain', 'snow']).not.toContain(pickConditions({ ...base, seed, biome: 'desert' }).weather);
      for (const biome of ['temperate', 'steppe', 'urban'] as const) expect(pickConditions({ ...base, seed, biome }).weather).not.toBe('snow');
    }
  });

  it('roughly match the planned odds over 2,000 seeds', () => {
    const share = <T extends string>(n: number, f: (seed: number) => T): Record<string, number> => {
      const out: Record<string, number> = {};
      for (let seed = 1; seed <= n; seed++) {
        const k = f(seed);
        out[k] = (out[k] ?? 0) + 1 / n;
      }
      return out;
    };
    const near = (got: Record<string, number>, want: Record<string, number>) => {
      for (const k of Object.keys(want)) expect(got[k] ?? 0, `${k}: ${JSON.stringify(got)}`).toBeCloseTo(want[k]!, 1);
      expect(Object.keys(got).every((k) => k in want), JSON.stringify(got)).toBe(true);
    };
    near(share(2000, (seed) => pickConditions({ ...base, seed }).time), { day: 0.5, dawn: 0.15, dusk: 0.15, night: 0.2 });
    near(share(2000, (seed) => pickConditions({ ...base, seed, biome: 'winter' }).weather), { clear: 0.4, overcast: 0.2, snow: 0.25, fog: 0.15 });
    near(share(2000, (seed) => pickConditions({ ...base, seed, biome: 'desert' }).weather), { clear: 0.75, overcast: 0.1, fog: 0.15 });
    near(share(2000, (seed) => pickConditions({ ...base, seed, biome: 'steppe' }).weather), { clear: 0.55, overcast: 0.2, rain: 0.15, fog: 0.1 });
    near(share(2000, (seed) => pickConditions({ ...base, seed, biome: 'temperate' }).weather), { clear: 0.45, overcast: 0.2, rain: 0.2, fog: 0.15 });
    near(share(2000, (seed) => pickConditions({ ...base, seed, biome: 'urban' }).weather), { clear: 0.45, overcast: 0.2, rain: 0.2, fog: 0.15 });
    near(share(2000, (seed) => pickBiome({ seed, terrain: 'plains', site: null })), { steppe: 0.45, temperate: 0.55 });
    near(share(2000, (seed) => pickBiome({ seed, terrain: 'mountains', site: null })), { winter: 0.2, temperate: 0.8 });
    near(share(2000, (seed) => pickBiome({ seed, terrain: 'plains', site: null, theatre: 'varn-delta' })), { desert: 0.3, steppe: 0.7 });
  });
});

import { beforeAll, describe, expect, it } from 'vitest';
import { decide, enemyArea } from './ai';
import { bestFire, fireInfo, suppLevel } from './combat';
import { act, createBattle, reachable, strikeInfo, supportChance, undoable, whyNot } from './engine';
import { bare, BATTLES, copy, NORTH, put, SOUTH, unit, weapon } from './fixture.test-util';
import { observe, OBSERVED_STREAM } from './observe';
import { hashBattle } from './replay';
import { startingLoad, typeOf } from './roster';
import { cheb, visibleTo } from './sight';
import { at, TREES, W, type Battle } from './types';
import { arenaSetup, blueUnits, change, CHANGES, copyBattle, family, knownLeak, leaks, player, playTurn, probe, probeAsk, probeIds, rng, type Change, type Leak } from './verify.test-util';

// Fog (docs/architecture.md, Battles): everything the player is shown is computed from what blue
// may know. Take battles at many points, change something blue cannot see (a hidden red unit moved,
// taken away, added or altered; red mines laid, cleared, moved; red overwatch; red's picture of
// blue; the dice; what red units in sight carry), and every reading from blue's seat must be the
// same. Leaks found are reported defects, pinned below with fixtures that reproduce them.

/** Battles at a few points each: the start of player turns, and the middle of one. Built once. */
let built: { b: Battle; at: string }[] | null = null;
function points(): { b: Battle; at: string }[] {
  if (built) return built;
  const out: { b: Battle; at: string }[] = [];
  const shapes = [
    { mix: 'mixed', terrain: 'forest' },
    { mix: 'air', terrain: 'hills', time: 'night' },
    { mix: 'armour', terrain: 'plains', weather: 'fog' },
    { mix: 'urban', site: 'city' },
    { mix: 'roster', terrain: 'mountains', time: 'dawn', river: true },
  ] as const;
  shapes.forEach((pick, i) => {
    const b = createBattle(arenaSetup(80 + i, pick));
    const p = player(90 + i, { advice: 0, planner: 0, illegal: 0, auto: 0.5, retreat: 0 });
    playTurn(p, b);
    if (!b.ended) out.push({ b: copyBattle(b), at: `setup ${80 + i}, turn 2` });
    playTurn(p, b);
    playTurn(p, b, undefined, 6);
    if (!b.ended) out.push({ b: copyBattle(b), at: `setup ${80 + i}, turn 3 after 6 orders` });
    // Later, with more contacts and more hidden units able to move: every kind of change gets tried.
    playTurn(p, b);
    playTurn(p, b);
    if (!b.ended) out.push({ b: copyBattle(b), at: `setup ${80 + i}, turn 4` });
  });
  built = out;
  return out;
}

interface Found extends Leak {
  where: string;
  change: Change;
  known: string | null;
}

describe('fog: hidden changes change nothing blue is shown', () => {
  const found: Found[] = [];
  const tried: Record<string, number> = {};
  let probes = 0;

  beforeAll(() => {
    const r = rng(2026);
    for (const { b, at: where } of points()) {
      for (const kind of CHANGES) {
        const c = change(b, kind, r);
        if (!c) continue;
        tried[kind] = (tried[kind] ?? 0) + 1;
        const ask = probeAsk(b, rng(probes + 1), c.cells, probeIds(b, c));
        const exclude = new Set(c.unit ? [c.unit] : []);
        // Advice is the dearest reading: asked where a hidden unit, mine or the dice changed.
        const advice = kind !== 'intel' && kind !== 'stores';
        const was = probe(b, ask, { advice, exclude });
        const now = probe(c.b, ask, { advice, exclude });
        probes += 2;
        // A unit added or taken away changes their starting company, which the bar is a share of.
        for (const l of leaks(was, now, c.roster ? new Set(['strength']) : new Set())) found.push({ ...l, where, change: kind, known: knownLeak(l) });
      }
    }
  }, BATTLES * 4);

  const clean = (families: string[]) => () => {
    const bad = found.filter((f) => families.includes(family(f.key)) && !f.known);
    expect(bad.slice(0, 3), `${bad.length} leaks`).toEqual([]);
  };

  it('every kind of change was tried, at many points', () => {
    for (const k of CHANGES.filter((x) => x !== 'mine-remove' && x !== 'mine-move')) expect(tried[k], k).toBeGreaterThanOrEqual(3);
    expect(probes).toBeGreaterThan(120);
  });
  it('what blue sees, and the observation it is given', clean(['sight', 'observation']));
  it('where the enemy is expected, and the strength bar', clean(['enemy area', 'strength bar']));
  it('every unit’s reach, walking and dashing', clean(['reach']));
  it('shot cards on everything in sight, from where it stands and from a cell it could move to', clean(['shot card']));
  it('called fire and off-map rockets on any cell', clean(['called fire', 'off-map fire']));
  it('advice', clean(['advice']));
  it('Undo, but for the sightings reported below', clean(['undo']));
  it('why an order would be refused, but for the refusals reported below', () => {
    const bad = found.filter((f) => family(f.key).startsWith('refusal') && !f.known);
    expect(bad.slice(0, 3), `${bad.length} leaks`).toEqual([]);
  });
  it('and nothing else: every leak found is one reported below', () => {
    const bad = found.filter((f) => !f.known);
    expect(bad.slice(0, 3), `${bad.length} leaks`).toEqual([]);
  });
});

describe('fog: the observation', () => {
  const at3 = () => {
    const b = createBattle(arenaSetup(85, { mix: 'mixed', terrain: 'hills' }));
    const p = player(3, { advice: 0, planner: 0, illegal: 0, auto: 1, retreat: 0 });
    playTurn(p, b);
    playTurn(p, b);
    return b;
  };

  it('holds only what blue may know, leaves the battle untouched, and carries no dice', () => {
    const b = at3();
    const h = hashBattle(b);
    const o = observe(b, 'blue');
    expect(hashBattle(b)).toBe(h);
    const seen = visibleTo(b, 'blue');
    for (const u of o.units) if (u.side === 'red') expect(seen.has(u.id) || !u.alive, u.id).toBe(true);
    expect(o.units.filter((u) => u.side === 'blue')).toEqual(b.units.filter((u) => u.side === 'blue'));
    expect(o.mines.every((m) => m.side === 'blue')).toBe(true);
    expect(o.intel.red).toEqual({});
    expect(o.intel.blue).toEqual(b.intel.blue);
    expect(o.stream).toBe(OBSERVED_STREAM);
    expect(o.events).toEqual([]);
    expect(o.support.every((s) => s.side === 'blue')).toBe(true);
    expect(o.stats.red).toEqual({ shots: 0, hits: 0, kills: 0, lost: 0 });
    // A seen enemy: its full load whatever it has left, its suppression only as its badge's state.
    for (const u of o.units.filter((x) => x.side === 'red' && x.alive)) {
      const truth = b.units.find((x) => x.id === u.id)!;
      const load = startingLoad(typeOf(u.type));
      expect(u.ammo, u.id).toEqual(load.ammo);
      expect(u.smoke, u.id).toEqual(load.smoke);
      expect(u, u.id).toMatchObject({ passengers: [], moved: false, acted: false, optics: false });
      expect(suppLevel(u.supp), u.id).toBe(suppLevel(truth.supp));
      expect(u.supp, u.id).toBeLessThanOrEqual(truth.supp);
    }
    // Red's skill is not blue's to know; blue knows a wreck it made, saw made, or stands or sees next to.
    expect(o.skill).toBe(0);
    const fell = new Set(b.events.flatMap((e) => (e.type === 'destroyed' && e.seen ? [e.unit] : [])));
    const near = o.units.filter((u) => u.alive && u.carrier === null);
    for (const w of o.wrecks) expect(b.units.find((u) => u.id === w.unit)!.side === 'blue' || fell.has(w.unit) || near.some((u) => cheb(u, w) <= 1), w.unit).toBe(true);
    const red = observe(b, 'red');
    expect(red.skill).toBe(b.skill);
    expect(red.wrecks).toEqual(b.wrecks);
    expect(red.units.filter((u) => u.side === 'blue').every((u) => visibleTo(b, 'red').has(u.id))).toBe(true);
    expect(red.intel.blue).toEqual({});
  }, BATTLES);

  it('shows blue a wreck it saw made, or stands or sees next to, and no other', () => {
    const b = bare(['m1a2', 'm1a2'], ['t90m', 't90m']);
    const [t1, t2] = b.units.filter((u) => u.side === 'blue');
    put(t1!, 15, 40, NORTH);
    put(t2!, 4, 40, NORTH);
    const [far, other] = b.units.filter((u) => u.side === 'red');
    put(far!, 15, 3, SOUTH);
    put(other!, 28, 3, SOUTH);
    far!.alive = false;
    b.wrecks.push({ x: 15, y: 3, unit: far!.id, type: far!.type, burning: 0 });
    const wrecks = () => observe(b, 'blue').wrecks.map((w) => w.unit);
    // Killed out of sight, far off: nothing tells blue it is there.
    expect(wrecks()).toEqual([]);
    // Seen destroyed: it knows.
    b.events.push({ type: 'destroyed', unit: far!.id, how: 'destroyed', x: 15, y: 3, seen: true });
    expect(wrecks()).toEqual([far!.id]);
    // Not seen destroyed, but a tank of its own pulls up beside it.
    b.events.pop();
    put(t1!, 15, 4, NORTH);
    expect(wrecks()).toEqual([far!.id]);
    // Blue's own wreck it always knows.
    t2!.alive = false;
    b.wrecks.push({ x: 4, y: 40, unit: t2!.id, type: t2!.type, burning: 0 });
    put(t1!, 15, 40, NORTH);
    expect(wrecks()).toEqual([t2!.id]);
  });

  it('is enough: the player’s readers answer the same on it as on the battle, and red’s planner on red’s', () => {
    let checks = 0;
    for (const { b } of points()) {
      const o = observe(b, 'blue');
      const known = visibleTo(b, 'blue');
      const same = (what: string, x: unknown, y: unknown) => {
        checks++;
        expect(JSON.stringify(x), what).toBe(JSON.stringify(y));
      };
      same('sight', [...visibleTo(o, 'blue')].sort(), [...known].sort());
      same('enemy area', enemyArea(o), enemyArea(b));
      same('planner', decide(copyBattle(o), 'blue'), decide(copyBattle(b), 'blue'));
      for (const u of blueUnits(b)) {
        const v = o.units.find((x) => x.id === u.id)!;
        same(`reach ${u.id}`, [...reachable(o, v, true, known).cost.entries()], [...reachable(b, u, true, known).cost.entries()]);
        for (const e of b.units.filter((x) => known.has(x.id))) {
          const f = o.units.find((x) => x.id === e.id)!;
          same(`card ${u.id}>${e.id}`, bestFire(o, v, f, v, false, known)?.chance, bestFire(b, u, e, u, false, known)?.chance);
        }
        const w = typeOf(u.type).weapons.find((x) => x.indirect);
        if (w) for (let x = 0; x < W; x += 6) same(`strike ${u.id}`, strikeInfo(o, v, { x, y: 12 }, w)?.chance, strikeInfo(b, u, { x, y: 12 }, w)?.chance);
      }
      for (const s of b.support.filter((x) => x.side === 'blue')) same('rockets', supportChance(o, 'blue', s.id, { x: 15, y: 10 }), supportChance(b, 'blue', s.id, { x: 15, y: 10 }));
      // Red's planner at the start of a red turn, from red's picture and from the truth.
      const r = copyBattle(b);
      r.turn = 'red';
      for (const u of r.units) if (u.side === 'red') u.moved = u.acted = false;
      same('red planner', decide(copyBattle(observe(r, 'red')), 'red'), decide(copyBattle(r), 'red'));
    }
    expect(checks).toBeGreaterThan(300);
  }, BATTLES * 2);
});

// --- Leaks found (reported) -------------------------------------------------------------------------

/** A ridge across rows 40 to 42: a tank at the bottom edge sees nothing beyond it. */
function ridge(b: Battle): void {
  for (let x = 0; x < W; x++) {
    b.map.elev[at(b.map, x, 42)] = 1;
    b.map.elev[at(b.map, x, 41)] = 2;
    b.map.elev[at(b.map, x, 40)] = 1;
  }
}

describe('fog: leaks found (reported defects)', () => {
  // Each leak has a fixture, checked to stand (passing), and the property it breaks (expected to
  // fail until the defect is fixed; then the `.fails` comes off).

  // `whyNot` on a fire order answers "No shot" for a unit that exists out of sight and "No such
  // weapon" for an id nobody has, so asking about ids tells which enemies exist (and that one split).
  const outOfSight = () => {
    const b = bare(['m1a2'], ['t90m']);
    ridge(b);
    const me = put(unit(b, 'm1a2'), 15, 44, NORTH);
    const them = put(unit(b, 't90m', 'red'), 15, 20, SOUTH);
    const gun = weapon(me, 'cannon').id;
    return { b, at: (target: string) => whyNot(b, { type: 'fire', unit: me.id, target, weapon: gun }), them };
  };
  it('fixture: an enemy out of sight cannot be shot at', () => {
    const f = outOfSight();
    expect(visibleTo(f.b, 'blue').has(f.them.id)).toBe(false);
    expect(f.at(f.them.id)).not.toBeNull();
  });
  it('refusing a shot at someone out of sight says the same as at someone who is not there', () => {
    const f = outOfSight();
    expect(f.at(f.them.id)).toBe(f.at('nobody:1'));
  });

  // `whyNot` on breach allows clearing a cell with a hidden enemy mine and refuses an empty one, and
  // on mine-laying refuses a cell with a hidden mine or a hidden unit: an engineer's order buttons
  // find mines and men next to it for free, without the turn or the order being spent.
  const sapper = (mined: boolean) => {
    const b = bare(['engineer_w'], ['t90m']);
    const eng = put(unit(b, 'engineer_w'), 15, 40);
    put(unit(b, 't90m', 'red'), 2, 0, SOUTH);
    if (mined) b.mines.push({ x: 16, y: 39, side: 'red' });
    return [whyNot(b, { type: 'breach', unit: eng.id, at: { x: 16, y: 39 } }), whyNot(b, { type: 'mine', unit: eng.id, at: { x: 16, y: 39 } }), observe(b, 'blue')] as const;
  };
  it('fixture: the mine is hidden from blue', () => {
    expect(hashBattle(sapper(true)[2])).toBe(hashBattle(sapper(false)[2]));
  });
  it('an engineer’s orders next to it do not tell where a hidden mine is', () => {
    expect(sapper(true).slice(0, 2)).toEqual(sapper(false).slice(0, 2));
  });

  // Undo refuses a step when the enemy's side sighted (or lost) the unit, logged as `spotted` and
  // `lost` events for red that the film never shows (UNDO_SAFE in engine.ts). So a move that showed
  // the player nothing still tells it, by Undo going grey, that someone it cannot see is watching.
  const watchedStep = (watched: boolean) => {
    const b = bare(['m1a2'], ['t90m', 'squad_e']);
    ridge(b);
    put(unit(b, 'm1a2'), 15, 44, NORTH);
    put(unit(b, 't90m', 'red'), 2, 0, SOUTH);
    const squad = put(unit(b, 'squad_e', 'red'), 15, 26);
    // Hunkered in a wood: blue sees it only from 10 cells; it sees the tank from 30.
    b.map.cells[at(b.map, 15, 26)] = TREES;
    squad.hunker = true;
    if (!watched) put(squad, 28, 2);
    const before = copy(b);
    const ok = act(b, { type: 'move', unit: unit(b, 'm1a2').id, to: { x: 15, y: 38 } });
    return { ok, undo: undoable(before, b), saw: hashBattle(observe(b, 'blue')), seen: visibleTo(b, 'blue').size, red: Object.keys(b.intel.red).length };
  };
  it('fixture: the step is the same to blue whether or not the hidden squad watches it', () => {
    const [free, watched] = [watchedStep(false), watchedStep(true)];
    expect([free.ok, watched.ok, free.seen, watched.seen]).toEqual([true, true, 0, 0]);
    expect(watched.saw).toBe(free.saw);
    expect([free.red, watched.red]).toEqual([0, 1]);
    expect(free.undo).toBe(true);
  });
  it('a step a hidden enemy sees can be undone as one nobody sees', () => {
    expect(watchedStep(true).undo).toBe(watchedStep(false).undo);
  });

  // A `fire` event is `seen` when blue sees either end of the shot, and it names the shooter and where
  // it fired from. The film used to show the shooter whenever the shot was `seen`, so a hidden gun
  // downing a drone showed a gun the rules keep hidden. Fire events now say separately whether blue
  // sees the shooter (`shooterSeen`), and the film shows the shooter only then (stage.ts, queueFire).
  const downed = () => {
    const b = bare(['raven', 'm1a2'], ['tunguska', 't90m']);
    ridge(b);
    // The drone looks down 14 cells; the gun's radar finds it at 20 and its cannon reaches 26.
    const drone = put(unit(b, 'raven'), 15, 24);
    put(unit(b, 'm1a2'), 15, 44, NORTH);
    const gun = put(unit(b, 'tunguska', 'red'), 15, 4, SOUTH);
    put(unit(b, 't90m', 'red'), 2, 0, SOUTH);
    b.turn = 'red';
    const hidden = !visibleTo(b, 'blue').has(gun.id);
    const fire = { type: 'fire' as const, unit: gun.id, target: drone.id, weapon: typeOf(gun.type).weapons.find((w) => w.air !== 'no' && !w.indirect)!.id };
    // The stream state that brings the drone down (any hit does).
    for (let s = 1; s < 200; s++) {
      const c = copy(b);
      c.stream = s;
      if (act(c, fire, 'red') && !c.units.find((u) => u.id === drone.id)!.alive) {
        const shot = c.events.find((e) => e.type === 'fire' && e.unit === gun.id);
        return { b: c, gun, hidden, seen: shot?.type === 'fire' && shot.seen, shooterSeen: shot?.type === 'fire' && shot.shooterSeen };
      }
    }
    throw new Error('no stream state downs the drone');
  };
  it('fixture: the gun, hidden before and after, downs the drone, and the shot is marked seen', () => {
    const d = downed();
    expect(d.hidden).toBe(true);
    expect(d.seen).toBe(true);
    expect(visibleTo(d.b, 'blue').has(d.gun.id)).toBe(false);
  });
  // This first asked that `seen` itself match the shooter's visibility; that would also hide the
  // shot from the drone's side. The property that matters is that the shooter is flagged as unseen.
  it('a shot blue saw from the target end does not show its shooter', () => {
    const d = downed();
    expect(d.shooterSeen).toBe(visibleTo(d.b, 'blue').has(d.gun.id));
    expect(d.shooterSeen).toBe(false);
  });

  // The shot card shows a seen tank's active protection only while it has charges. That is a rule, not
  // a leak: the launchers sit on the outside of a turret in sight, and the card must show the chance
  // that is rolled (hiding spent charges would show a chance the roll does not use).
  const javelinOn = (charges: number) => {
    const b = bare(['javelin'], ['cr3']);
    const team = put(unit(b, 'javelin'), 15, 34);
    const tank = put(unit(b, 'cr3', 'red'), 15, 22, SOUTH);
    tank.aps = charges;
    return { seen: visibleTo(b, 'blue').has(tank.id), card: fireInfo(b, team, tank, weapon(team, 'atgm')) };
  };
  it('fixture: the tank is in sight and the Javelin has a shot', () => {
    expect(javelinOn(3).seen).toBe(true);
    expect(javelinOn(3).card?.aps).toBeGreaterThan(0);
  });
  it('the shot card shows a seen tank’s active protection as it stands, spent or not (rule)', () => {
    expect(javelinOn(3).card?.aps).toBeGreaterThan(0);
    expect(javelinOn(0).card?.aps ?? 0).toBe(0);
  });
});

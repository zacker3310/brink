import { suppLevel } from './combat';
import { startingLoad, typeOf } from './roster';
import { cheb, visibleTo } from './sight';
import type { Battle, Side, Unit } from './types';

// The visibility layer (docs/architecture.md, Battles): what one side may know of a battle, as a
// battle of its own, so whatever reads it (the screen, the overlays, the advice) can only show
// what that side knows. The simulation keeps the truth; this decides what of it is disclosed.

/** The stream an observation carries: a constant, so nothing that reads it can tell the dice. */
export const OBSERVED_STREAM = 0;

/** One side's picture of a battle: a `Battle` every engine reader accepts, holding only what it may know. */
export interface Observation extends Battle {
  /** Whose picture it is. */
  observer: Side;
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** The least suppression that shows as each badge state: all a watcher can tell of it. */
const SUPP_FLOOR = new Map<ReturnType<typeof suppLevel>, number>();
for (let v = 100; v >= 0; v--) SUPP_FLOOR.set(suppLevel(v), v);

/**
 * An enemy unit as a watcher sees it: where it is, which way it points, what it is, and the state
 * its badge shows (strength, damage, suppression as the badge's state, overwatch, hunkered) and
 * the rules reveal (that it fired). Not what it carries: it is taken to have its full load of
 * ammunition and smoke and loaded active protection, whatever it has left. Not who rides in it,
 * damaged optics, or what it did this turn.
 */
function asSeen(u: Unit): Unit {
  const t = typeOf(u.type);
  const c = clone(u);
  const load = startingLoad(t);
  c.ammo = load.ammo;
  c.smoke = load.smoke;
  c.aps = t.aps?.charges ?? 0;
  c.passengers = [];
  c.optics = false;
  c.moved = false;
  c.acted = false;
  c.dashed = false;
  c.smoked = false;
  c.supp = SUPP_FLOOR.get(suppLevel(u.supp)) ?? 0;
  return c;
}

/**
 * What `side` may know of the battle, as a deep copy (the battle is untouched):
 * - its own units, all of them, as they are;
 * - the enemy units it sees now (`visibleTo`), as `asSeen` shows them, and, for blue, the enemy
 *   units it saw destroyed (a `destroyed` event it saw), dead where they fell;
 * - its own last known positions (`intel[side]`: ghosts with the turn they were seen, `now` false
 *   for one out of sight); none of the other side's, so not what the enemy knows of it;
 * - the map, the conditions, the turn, the round, the zone count and smoke (all on show);
 * - for blue, the wrecks it can know of: its own, those of kills it saw, and any next to a unit it
 *   has or sees (where cover is reckoned); red, whose planner reads the truth, keeps them all;
 * - its own mines only, its own off-map support only, and, for blue, its research abilities,
 *   precision rounds and SIGINT sweep; red keeps only the passive composite armour it can see;
 * - its own shots, hits and losses (not kills: a kill out of sight is not known) and nothing of
 *   the enemy's tallies;
 * - for red only, the enemy skill (blue's picture has 0);
 * - no film (`events` is empty) and a constant stream (`OBSERVED_STREAM`).
 * Engine readers (sight, the shot card, reach, called fire, the planner) run on it as on the
 * battle. It is a picture, not a battle to play: acting on it settles nothing.
 */
export function observe(b: Battle, side: Side): Observation {
  const seen = visibleTo(b, side);
  const fell = new Set<string>();
  if (side === 'blue') for (const e of b.events) if (e.type === 'destroyed' && e.seen) fell.add(e.unit);
  const units = b.units.filter((u) => u.side === side || seen.has(u.id) || (!u.alive && fell.has(u.id))).map((u) => (u.side === side ? clone(u) : asSeen(u)));
  const mine = new Set(b.units.filter((u) => u.side === side).map((u) => u.id));
  const near = units.filter((u) => u.alive && u.carrier === null);
  const wrecks = side === 'red' ? b.wrecks : b.wrecks.filter((w) => mine.has(w.unit) || fell.has(w.unit) || near.some((u) => cheb(u, w) <= 1));
  const own = b.stats[side];
  const none = { shots: 0, hits: 0, kills: 0, lost: 0 };
  const obs: Observation = {
    version: b.version,
    seed: b.seed,
    map: clone(b.map),
    units,
    conditions: clone(b.conditions),
    round: b.round,
    turn: b.turn,
    turnIndex: b.turnIndex,
    ended: b.ended,
    endReason: b.endReason,
    // The enemy's skill (its decisions, its crews' rank) is red's to know: blue sees only what it does.
    skill: side === 'red' ? b.skill : 0,
    difficulty: b.difficulty,
    abilities: side === 'blue' ? clone(b.abilities) : b.abilities.armor !== undefined ? { armor: b.abilities.armor } : {},
    support: b.support.filter((s) => s.side === side).map((s) => ({ ...s })),
    precision: side === 'blue' ? b.precision : 0,
    sweepUntil: side === 'blue' ? b.sweepUntil : -1,
    smoke: clone(b.smoke),
    mines: b.mines.filter((m) => m.side === side).map((m) => ({ ...m })),
    wrecks: clone(wrecks),
    capture: b.capture,
    intel: side === 'blue' ? { blue: clone(b.intel.blue), red: {} } : { blue: {}, red: clone(b.intel.red) },
    events: [],
    stats: side === 'blue' ? { blue: { ...own, kills: 0 }, red: { ...none } } : { blue: { ...none }, red: { ...own, kills: 0 } },
    stream: OBSERVED_STREAM,
    observer: side,
  };
  if (side === 'blue' && b.commands) obs.commands = clone(b.commands);
  return obs;
}

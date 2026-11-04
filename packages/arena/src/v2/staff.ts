import type { DeployZone, Wave } from './command';
import { deploying } from './deploy';
import { canAct, sideValue, startValue, unitById } from './engine';
import { groupsOf } from './groups';
import { entriesFor } from './reserves';
import { typeOf } from './roster';
import { dist, isFlying, visibleTo } from './sight';
import { W, type Action, type Battle, type Point, type Side, type Unit } from './types';

// The AI's staff work (docs/arena-v2.md, section 16.4): it begins once deployed, calls reserves in
// when it needs them at the entry least under the enemy's guns, and moves a wave that came on as a
// group toward the fight in formation until it meets the enemy, then hands its units to the unit
// planner. Like the rest of the AI it reads only its own side's view and breaks ties by its order,
// never the dice.

/** A group is in contact (and released to fight unit by unit) within this many cells of an enemy it sees. */
export const CONTACT = 12;
/** A group this close to where it was going has arrived. */
const ARRIVED = 4;

/** The key `playSide` skips an action's actor by once it is done. */
export function actionKey(a: Action): string {
  switch (a.type) {
    case 'support':
      return `support:${a.asset}`;
    case 'ability':
      return `ability:${a.id}`;
    case 'reserve':
      return `reserve:${a.wave}`;
    case 'group':
      return `group:new:${a.units.join(',')}`;
    case 'ungroup':
    case 'formation':
    case 'order':
      return `group:${a.group}`;
    case 'deployed':
      return 'deployed';
    default:
      return a.unit;
  }
}

const mean = (ps: Point[]): Point => ({ x: ps.reduce((s, p) => s + p.x, 0) / ps.length, y: ps.reduce((s, p) => s + p.y, 0) / ps.length });

/** Where the side is fighting toward: the zone to take or hold, else (attacking) the enemy it knows of, else its positions. */
export function objectiveOf(b: Battle, side: Side): Point {
  const z = b.map.zone;
  if (z) return { x: z.x, y: z.y };
  const ghosts = Object.values(b.intel[side]);
  if (side === 'blue' && ghosts.length) return mean(ghosts);
  const spawn = b.map.redSpawn.slice(0, 20);
  return spawn.length ? mean(spawn) : { x: W / 2, y: 12 };
}

const round = (p: Point): Point => ({ x: Math.round(p.x), y: Math.round(p.y) });

/** Time to commit the reserves: an attacker from its second round or when bleeding; a defender once it has seen the enemy. */
function wantsReserves(b: Battle, side: Side): boolean {
  const bleeding = sideValue(b, side) < (side === 'blue' ? 0.7 : 0.75) * startValue(b, side);
  if (side === 'blue') return b.round >= 2 || bleeding;
  return Object.keys(b.intel.red).length > 0 || b.round >= 3 || bleeding;
}

/** The entry for a wave: far from known enemies (and landing zones clear of their air defence), near the objective. */
function bestEntry(b: Battle, side: Side, w: Wave): DeployZone | null {
  const ghosts = Object.values(b.intel[side]);
  const goal = objectiveOf(b, side);
  let best: DeployZone | null = null;
  let score = -Infinity;
  for (const z of entriesFor(b, side, w)) {
    const c = z.cells[0]!;
    const near = ghosts.length ? Math.min(...ghosts.map((g) => dist(g, c))) : 14;
    let s = Math.min(near, 14) - dist(c, goal) * 0.25;
    if (z.kind === 'lz' && ghosts.some((g) => (typeOf(g.type).role === 'spaa' || typeOf(g.type).role === 'aa_team') && dist(g, c) <= 14)) s -= 20;
    if (s > score) {
      score = s;
      best = z;
    }
  }
  return best;
}

function inContact(b: Battle, side: Side, members: Unit[], seen: Set<string>): boolean {
  if (members.some((u) => u.supp > 0)) return true;
  const enemies = b.units.filter((e) => seen.has(e.id));
  return members.some((u) => enemies.some((e) => dist(e, u) <= CONTACT));
}

/** The AI's next command action for `side`, or null when it has none. Pure: reads the state, changes nothing. */
export function commandDecision(b: Battle, side: Side, skip: ReadonlySet<string>): Action | null {
  if (side === 'blue' && deploying(b)) return { type: 'deployed' };
  const r = b.reserves?.[side];
  if (r && r.waves.length && r.acted !== b.turnIndex && wantsReserves(b, side)) {
    const waves = [...r.waves].sort((p, q) => q.cost - p.cost || (p.id < q.id ? -1 : 1));
    for (const w of waves) {
      if (skip.has(`reserve:${w.id}`) || w.cost > r.cp) continue;
      const z = bestEntry(b, side, w);
      const a: Action | null = z ? { type: 'reserve', wave: w.id, zone: z.id } : null;
      if (a && canAct(b, a, side)) return a;
    }
  }
  const seen = visibleTo(b, side);
  const goal = round(objectiveOf(b, side));
  for (const g of [...groupsOf(b, side)].sort((p, q) => (p.id < q.id ? -1 : 1))) {
    if (skip.has(`group:${g.id}`)) continue;
    const members = g.units.map((id) => unitById(b, id)).filter((u): u is Unit => !!u && u.alive && u.carrier === null);
    if (!members.length) continue;
    const centre = mean(members);
    // In contact, or there: the unit planner fights them from here.
    if (inContact(b, side, members, seen) || dist(centre, goal) <= ARRIVED) return { type: 'ungroup', group: g.id };
    const air = members.every((u) => isFlying(typeOf(u.type)));
    const a: Action = { type: 'order', group: g.id, order: { kind: 'move', to: air ? round({ x: (centre.x + goal.x) / 2, y: (centre.y + goal.y) / 2 }) : goal } };
    return canAct(b, a, side) ? a : { type: 'ungroup', group: g.id };
  }
  return null;
}

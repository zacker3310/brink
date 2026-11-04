import type { Formation, Group, GroupOrder } from './command';
import { bestFire, shotValue } from './combat';
import { canAct, reachable, unitAt, unitById, whyNot } from './engine';
import { typeOf } from './roster';
import { dist, isFlying, visibleTo } from './sight';
import { H, W, at, type Action, type Battle, type Point, type Side, type Unit, type UnitType } from './types';

// Groups (docs/arena-v2.md, section 16.1): a selection of a side's units under one order, kept
// across turns until dissolved. An order is never a rule of its own: it expands, unit by unit, into
// the ordinary actions (move, fire, overwatch, hold), each checked by `whyNot` and resolved by `act`
// exactly as if it had been given by hand. The plan reads only what the side knows.

/** Most units in one group. */
export const GROUP_MAX = 24;
/** Cells between aircraft in a group's stack. */
export const STACK_SPACING = 2;
/** Cells between units in a screen. */
export const SCREEN_SPACING = 2;

const onField = (u: Unit) => u.alive && u.carrier === null;

export const groupsOf = (b: Battle, side: Side): Group[] => (b.groups ?? []).filter((g) => g.side === side);
export const groupById = (b: Battle, id: string): Group | undefined => (b.groups ?? []).find((g) => g.id === id);
/** The group a unit is in, if any. */
export const groupOfUnit = (b: Battle, unit: string): Group | undefined => (b.groups ?? []).find((g) => g.units.includes(unit));

/** Units that died or were merged away leave their groups; a group with no one left is gone. */
export function pruneGroups(b: Battle): void {
  if (!b.groups?.length) return;
  for (const g of b.groups) g.units = g.units.filter((id) => unitById(b, id)?.alive === true);
  b.groups = b.groups.filter((g) => g.units.length > 0);
}

/** The formation a group of these units takes by default: armour leads in a wedge, the rest a column. */
export function formationFor(_b: Battle, units: Unit[]): Formation {
  const ground = units.map((u) => typeOf(u.type)).filter((t) => !isFlying(t));
  const armour = ground.filter((t) => t.role === 'mbt' || t.role === 'ifv' || t.role === 'light_tank' || t.role === 'tank_hunter').length;
  return ground.length && armour * 2 >= ground.length ? 'wedge' : 'column';
}

/** Form a group (no checks: `act` has made them). Its units leave whatever group they were in. */
export function addGroup(b: Battle, side: Side, units: string[], formation: Formation, wave?: string): Group {
  const set = new Set(units);
  const groups = (b.groups ?? []).map((g) => ({ ...g, units: g.units.filter((id) => !set.has(id)) })).filter((g) => g.units.length > 0);
  b.groupSeq = (b.groupSeq ?? 0) + 1;
  const g: Group = { id: `${side}:g${b.groupSeq}`, side, units: [...units], formation, order: null, ...(wave ? { wave } : {}) };
  b.groups = [...groups, g];
  return g;
}

// --- Formations --------------------------------------------------------------------------------------

/** Front, middle, back of a formation: armour and carriers lead, guns and support follow. */
function rank(t: UnitType): number {
  if (t.role === 'mbt' || t.role === 'light_tank' || t.role === 'ifv' || t.role === 'apc' || t.role === 'tank_hunter') return 0;
  if (t.role === 'spg' || t.role === 'mortar' || t.role === 'arv' || t.role === 'medic' || t.role === 'spaa' || t.role === 'engineer') return 2;
  return 1;
}

const clampCell = (x: number, y: number): Point => ({ x: Math.max(0, Math.min(W - 1, Math.round(x))), y: Math.max(0, Math.min(H - 1, Math.round(y))) });

/** The ground slots of a formation: offsets along `d` (forward) and `p` (to the side) from the anchor. */
function groundOffsets(formation: Formation, n: number, spacing: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    if (formation === 'column') out.push([-i * spacing, 0]);
    else if (formation === 'line') out.push([0, (i % 2 ? 1 : -1) * Math.ceil(i / 2) * spacing]);
    else {
      // Wedge: the point, then pairs stepping back and out.
      const row = Math.ceil(i / 2);
      out.push([-row * spacing, (i % 2 ? 1 : -1) * row * spacing]);
    }
  }
  return out;
}

/** Aircraft: a stack of rows of three, two cells apart, from the anchor back. */
function stackOffsets(n: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / 3);
    const col = [0, 1, -1][i % 3]!;
    out.push([-row * STACK_SPACING, col * STACK_SPACING]);
  }
  return out;
}

/** Which way the side faces when it has nowhere else to look: up the field for blue, down for red. */
const forward = (side: Side): Point => (side === 'blue' ? { x: 0, y: -1 } : { x: 0, y: 1 });

function unitVector(from: Point, to: Point, side: Side): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const n = Math.hypot(dx, dy);
  return n < 1 ? forward(side) : { x: dx / n, y: dy / n };
}

/** Where the side believes the enemy is: the middle of its last known positions, or null. */
function enemyCentre(b: Battle, side: Side): Point | null {
  const gs = Object.values(b.intel[side]);
  if (!gs.length) return null;
  return { x: gs.reduce((s, g) => s + g.x, 0) / gs.length, y: gs.reduce((s, g) => s + g.y, 0) / gs.length };
}

export interface Slot {
  unit: string;
  at: Point;
}

/** The members on the field, in formation order (front first), with the cell each is to take. */
export function slotsFor(b: Battle, g: Group, order: GroupOrder): Slot[] {
  const members = g.units.map((id) => unitById(b, id)).filter((u): u is Unit => !!u && onField(u));
  if (!members.length || order.kind === 'hold') return members.map((u) => ({ unit: u.id, at: { x: u.x, y: u.y } }));
  const centre = { x: members.reduce((s, u) => s + u.x, 0) / members.length, y: members.reduce((s, u) => s + u.y, 0) / members.length };
  const anchor = order.to ?? { x: Math.round(centre.x), y: Math.round(centre.y) };
  let d = unitVector(centre, anchor, g.side);
  if (order.kind === 'screen' || (order.kind === 'overwatch' && !order.to)) {
    const e = enemyCentre(b, g.side);
    d = e ? unitVector(anchor, e, g.side) : forward(g.side);
  }
  const p = { x: -d.y, y: d.x };
  const sort = (us: Unit[]) => us.sort((m, n) => rank(typeOf(m.type)) - rank(typeOf(n.type)) || dist(m, anchor) - dist(n, anchor) || (m.id < n.id ? -1 : 1));
  const ground = sort(members.filter((u) => !isFlying(typeOf(u.type))));
  const air = sort(members.filter((u) => isFlying(typeOf(u.type))));
  const formation: Formation = order.kind === 'screen' ? 'line' : g.formation;
  const spacing = order.kind === 'screen' ? SCREEN_SPACING : 1;
  const out: Slot[] = [];
  groundOffsets(formation, ground.length, spacing).forEach(([f, s], i) => out.push({ unit: ground[i]!.id, at: clampCell(anchor.x + d.x * f + p.x * s, anchor.y + d.y * f + p.y * s) }));
  // The stack flies just behind the ground lead (on the point itself when it is aircraft alone).
  const back = ground.length ? STACK_SPACING : 0;
  stackOffsets(air.length).forEach(([f, s], i) => out.push({ unit: air[i]!.id, at: clampCell(anchor.x + d.x * (f - back) + p.x * s, anchor.y + d.y * (f - back) + p.y * s) }));
  return out;
}

// --- Expanding an order ------------------------------------------------------------------------------

/** The move that brings a unit nearest its slot this turn, through cells its side knows are free, or null. */
export function moveToward(b: Battle, u: Unit, slot: Point, dash: boolean, claimed: Set<string>, known = visibleTo(b, u.side)): Action | null {
  if (!onField(u) || u.moved || (u.acted && !(u.smoked && !dash)) || u.mobilityKill) return null;
  if (u.x === slot.x && u.y === slot.y) return null;
  const air = isFlying(typeOf(u.type));
  const reach = reachable(b, u, dash, known);
  const here = at(b.map, u.x, u.y);
  let best = -1;
  let score = dist(u, slot) - 0.5;
  for (const i of [...reach.cost.keys()].sort((m, n) => m - n)) {
    if (i === here) continue;
    const p = { x: i % W, y: Math.floor(i / W) };
    if (claimed.has(`${air ? 'a' : 'g'}${i}`)) continue;
    const there = unitAt(b, p.x, p.y, air);
    if (there && (there.side === u.side || known.has(there.id))) continue;
    const s = dist(p, slot) + reach.cost.get(i)! / 10000;
    if (s < score) {
      score = s;
      best = i;
    }
  }
  if (best < 0) return null;
  claimed.add(`${air ? 'a' : 'g'}${best}`);
  return { type: 'move', unit: u.id, to: { x: best % W, y: Math.floor(best / W) }, ...(dash ? { dash: true } : {}) };
}

/** The best shot a unit has from where it stands at what its side sees: the named target first. */
export function bestShot(b: Battle, u: Unit, target?: string, known = visibleTo(b, u.side)): Action | null {
  if (!onField(u) || u.acted) return null;
  let best: { a: Action; v: number } | null = null;
  const enemies = b.units.filter((e) => e.side !== u.side && known.has(e.id) && onField(e)).sort((m, n) => (m.id === target ? -1 : n.id === target ? 1 : m.id < n.id ? -1 : 1));
  for (const e of enemies) {
    const info = bestFire(b, u, e, u, false, known);
    if (!info || info.weapon.indirect) continue;
    const a: Action = { type: 'fire', unit: u.id, target: e.id, weapon: info.weapon.id };
    if (e.id === target) return a;
    const v = shotValue(b, info, e);
    if (!best || v > best.v) best = { a, v };
  }
  return best?.a ?? null;
}

/** The next action a member takes for the order, from the state as it is now, or null when it is done. */
function nextStep(b: Battle, u: Unit, slot: Point, order: GroupOrder, claimed: Set<string>, known: Set<string>): Action | null {
  switch (order.kind) {
    case 'hold':
      return u.acted ? null : { type: 'hold', unit: u.id };
    case 'move':
      return moveToward(b, u, slot, !!order.dash, claimed, known);
    case 'assault':
      return moveToward(b, u, slot, false, claimed, known) ?? bestShot(b, u, order.target, known);
    case 'overwatch':
    case 'screen':
      return (order.to || order.kind === 'screen' ? moveToward(b, u, slot, false, claimed, known) : null) ?? (u.acted || u.overwatch ? null : { type: 'overwatch', unit: u.id });
  }
}

export interface PlannedStep {
  unit: string;
  /** Where the formation puts it. */
  slot: Point;
  /** Its first action, legal now; null when it has nothing to do for this order. */
  action: Action | null;
}

/**
 * What the order would have each member do first (a preview for the screen: the slots and the
 * first actions, each legal now). Pure: reads the battle, changes nothing, sees only what the side does.
 */
export function planGroup(b: Battle, groupId: string, order?: GroupOrder): PlannedStep[] {
  const g = groupById(b, groupId);
  const o = order ?? g?.order;
  if (!g || !o) return [];
  const known = visibleTo(b, g.side);
  const claimed = new Set<string>();
  return slotsFor(b, g, o).map((s) => {
    const u = unitById(b, s.unit)!;
    const a = nextStep(b, u, s.at, o, claimed, known);
    return { unit: s.unit, slot: s.at, action: a && canAct(b, a, g.side) ? a : null };
  });
}

/** Why a group action cannot be taken now, or null. */
export function whyNotGroup(b: Battle, a: Extract<Action, { type: 'group' | 'ungroup' | 'formation' | 'order' }>, side: Side): string | null {
  if (a.type === 'group') {
    for (const id of a.units) {
      const u = unitById(b, id);
      if (!u || !u.alive || u.side !== side) return 'Not your unit';
    }
    if (a.units.length > GROUP_MAX) return 'Too many';
    const set = [...a.units].sort().join();
    return groupsOf(b, side).some((g) => [...g.units].sort().join() === set) ? 'Already a group' : null;
  }
  const g = groupById(b, a.group);
  if (!g || g.side !== side) return 'No such group';
  if (a.type === 'formation') return g.formation === a.formation ? 'Already in that formation' : null;
  if (a.type !== 'order') return null;
  if (g.ordered === b.turnIndex) return 'Already ordered this turn';
  const o = a.order ?? g.order;
  if (!o) return 'No order';
  return planGroup(b, g.id, o).some((s) => s.action) ? null : 'Nothing to do';
}

/** Carry out a group action (checked by whyNotGroup). An order plays each member's actions through `act`. */
export function groupAct(b: Battle, a: Extract<Action, { type: 'group' | 'ungroup' | 'formation' | 'order' }>, side: Side, act: (b: Battle, a: Action, side: Side) => boolean): void {
  if (a.type === 'group') {
    const units = a.units.map((id) => unitById(b, id)!);
    addGroup(b, side, a.units, a.formation ?? formationFor(b, units));
    return;
  }
  const g = groupById(b, a.group)!;
  if (a.type === 'ungroup') {
    b.groups = (b.groups ?? []).filter((x) => x !== g);
    return;
  }
  if (a.type === 'formation') {
    g.formation = a.formation;
    return;
  }
  const order = a.order ?? g.order!;
  g.order = JSON.parse(JSON.stringify(order)) as GroupOrder;
  g.ordered = b.turnIndex;
  const claimed = new Set<string>();
  for (const s of slotsFor(b, g, order)) {
    // Each member to the end of its part of the order, before the next starts: what it meets on the
    // way (overwatch, a hidden enemy) is met as it would be by hand.
    for (let step = 0; step < 3 && !b.ended && b.turn === side; step++) {
      const u = unitById(b, s.unit);
      if (!u || !onField(u)) break;
      const next = nextStep(b, u, s.at, order, claimed, visibleTo(b, side));
      if (!next || whyNot(b, next, side) !== null || !act(b, next, side)) break;
      if (next.type !== 'move') break;
    }
  }
}

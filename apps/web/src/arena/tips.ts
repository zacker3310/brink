import { bestFire, dist, isFlying, OPEN, pathTo, reachable, ROAD, strikeInfo, suppLevel, typeOf, whyNot, type Battle, type FireInfo, type Point, type Unit, type Weapon } from '@brink/arena';

// Tips from the board (docs/arena-v2.md, section 11): on your turn, read what you know of the field
// and raise at most one short tip, once per kind of mistake ever (remembered on this device). The
// battle settings switch them off. Only your side's picture is read: the enemies you see now and
// your last known positions.

export type TipKind = 'flank' | 'open' | 'blind' | 'air' | 'smoke' | 'pinned';

export interface Tip {
  kind: TipKind;
  title: string;
  /** What to do, in one sentence. */
  text: string;
}

export interface TipBoard {
  b: Battle;
  /** The selected unit, if any. */
  me: Unit | undefined;
  /** Enemies your side sees now. */
  known: Set<string>;
  /** A move being looked at. */
  move: { at: Point; dash: boolean } | null;
  /** Called fire being looked at. */
  strike: { at: Point; smoke: boolean; weapon: Weapon } | null;
}

const KEY = 'brink.arena.tips.v1';
const KINDS: readonly TipKind[] = ['flank', 'open', 'blind', 'air', 'smoke', 'pinned'];

/** Kinds already shown on this device. */
export function readSeenTips(): Set<TipKind> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    return new Set(Array.isArray(raw) ? KINDS.filter((k) => raw.includes(k)) : []);
  } catch {
    return new Set();
  }
}

export function markTipSeen(kind: TipKind): void {
  try {
    const seen = readSeenTips();
    seen.add(kind);
    localStorage.setItem(KEY, JSON.stringify([...seen].sort()));
  } catch {
    // Storage is optional: the tip may just come round again.
  }
}

/** The unit as it would stand at `p`, facing `facing`, having moved. */
const standing = (u: Unit, p: Point, facing = u.facing): Unit => ({ ...u, x: p.x, y: p.y, facing, aim: facing, moved: true });

/** Enemies you see now that could hit `u` (assuming they see it), with their best shot. */
function threats(b: Battle, u: Unit, known: Set<string>): { e: Unit; info: FireInfo }[] {
  const out: { e: Unit; info: FireInfo }[] = [];
  for (const e of b.units) {
    if (e.side === u.side || !e.alive || e.carrier || !known.has(e.id)) continue;
    const info = bestFire(b, e, u, e, false, new Set([u.id]));
    if (info) out.push({ e, info });
  }
  return out;
}

/** Where a vehicle ends up facing after a move: toward the known enemy most worth its front armour (as the rules turn it). */
function faceAfterMove(b: Battle, p: Point, fallback: number): number {
  let best: Point | null = null;
  let score = 0;
  for (const g of Object.values(b.intel.blue)) {
    const t = typeOf(g.type);
    const pen = Math.max(0, ...t.weapons.filter((w) => w.air !== 'only').map((w) => (w.range + 1 >= dist(g, p) ? w.pen : 0)));
    const s = pen / (1 + dist(g, p)) / (g.now ? 1 : 2);
    if (s > score) {
      score = s;
      best = g;
    }
  }
  return best ? Math.atan2(best.y - p.y, best.x - p.x) : fallback;
}

const short = (u: Unit) => typeOf(u.type).short;

function flank(b: Battle, u: Unit, known: Set<string>, there: boolean): Tip | null {
  const hit = threats(b, u, known)
    .filter((x) => x.info.pen !== undefined && x.info.pen >= 25 && (x.info.facing === 'side' || x.info.facing === 'rear'))
    .sort((p, q) => q.info.pen! - p.info.pen!)[0];
  if (!hit) return null;
  const facing = hit.info.facing!;
  return {
    kind: 'flank',
    title: facing === 'rear' ? 'Rear Armour Showing' : 'Side Armour Showing',
    text: there
      ? `There, ${u.name} would show its ${facing} to the ${short(hit.e)} (penetrate ${hit.info.pen}%): pick a cell that keeps every threat in front of it.`
      : `${u.name} shows its ${facing} to the ${short(hit.e)} (penetrate ${hit.info.pen}%): use Turn to face it, or move out of its sight.`,
  };
}

function open(b: Battle, u: Unit, known: Set<string>, there: boolean): Tip | null {
  const n = threats(b, u, known).filter((x) => x.info.cover === 'none').length;
  if (n < 2) return null;
  return {
    kind: 'open',
    title: 'In the Open',
    text: there
      ? `There, ${u.name} would be in the open to ${n} enemies you know of: pick a cell in trees, a building or behind a wall.`
      : `${u.name} is in the open to ${n} enemies you know of: move it into trees, a building or behind a wall, or hunker.`,
  };
}

function air(b: Battle, u: Unit, known: Set<string>, there: boolean): Tip | null {
  const ad = threats(b, u, known)
    .filter((x) => typeOf(x.e.type).role === 'spaa' || typeOf(x.e.type).role === 'aa_team')
    .sort((p, q) => q.info.chance - p.info.chance)[0];
  if (!ad) return null;
  return {
    kind: 'air',
    title: 'Air Defence',
    text: there
      ? `There, ${u.name} would be inside the reach of the ${short(ad.e)} (${ad.info.chance}% to hit): stop short of it, or behind a hill.`
      : `${u.name} is inside the reach of the ${short(ad.e)} (${ad.info.chance}% to hit): pull it back out of range, or behind a hill.`,
  };
}

/** A route over open ground that a known enemy can hit, for a unit that still has smoke. */
function smoke(b: Battle, u: Unit, known: Set<string>, move: { at: Point; dash: boolean }): Tip | null {
  if (whyNot(b, { type: 'smoke', unit: u.id }) !== null) return null;
  const reach = reachable(b, u, move.dash, known);
  const path = pathTo(reach, move.at.y * b.map.w + move.at.x).slice(1);
  let watched = 0;
  let by: Unit | null = null;
  for (const p of path) {
    const cell = b.map.cells[p.y * b.map.w + p.x];
    if (cell !== OPEN && cell !== ROAD) continue;
    const t = threats(b, standing(u, p), known)[0];
    if (!t) continue;
    watched++;
    by ??= t.e;
  }
  if (watched < 3 || !by) return null;
  return { kind: 'smoke', title: 'Smoke First', text: `Pop smoke before this move: the route crosses ${watched} cells of open ground the ${short(by)} can hit, and smoke hides it for a turn.` };
}

function blind(b: Battle, u: Unit, s: NonNullable<TipBoard['strike']>): Tip | null {
  const info = strikeInfo(b, u, s.at, s.weapon, s.smoke);
  if (!info || info.observed !== 'blind') return null;
  return { kind: 'blind', title: 'Firing Blind', text: `Nobody of yours sees that cell, so it is ${info.chance}% to land there: move a unit or a drone where it can watch the cell first.` };
}

function pinned(u: Unit): Tip | null {
  if (typeOf(u.type).mobility !== 'foot' || suppLevel(u.supp) !== 'pinned') return null;
  return { kind: 'pinned', title: 'Pinned', text: `${u.name} is pinned, moving half as far and aiming worse: keep it in cover, hunkered and next to friends, and it steadies faster next turn.` };
}

/** The tip the board calls for now, of a kind `allow` lets through, most pressing first; or null. */
export function pickTip(board: TipBoard, allow: (k: TipKind) => boolean): Tip | null {
  const { b, me, known, move, strike } = board;
  if (!me || b.turn !== 'blue' || b.ended) return null;
  const t = typeOf(me.type);
  const vehicle = !!t.armour && !isFlying(t);
  const tries: (() => Tip | null)[] = [];
  if (strike) tries.push(() => (allow('blind') ? blind(b, me, strike) : null));
  if (move) {
    const facing = vehicle ? faceAfterMove(b, move.at, Math.atan2(move.at.y - me.y, move.at.x - me.x)) : me.facing;
    const there = standing(me, move.at, facing);
    tries.push(
      () => (allow('smoke') ? smoke(b, me, known, move) : null),
      () => (allow('flank') && vehicle ? flank(b, there, known, true) : null),
      () => (allow('air') && t.mobility === 'heli' ? air(b, there, known, true) : null),
      () => (allow('open') && t.mobility === 'foot' ? open(b, there, known, true) : null),
    );
  } else if (!strike) {
    tries.push(
      () => (allow('flank') && vehicle && whyNot(b, { type: 'face', unit: me.id, facing: me.facing }) === null ? flank(b, me, known, false) : null),
      () => (allow('air') && t.mobility === 'heli' && !me.moved ? air(b, me, known, false) : null),
      () => (allow('open') && t.mobility === 'foot' && !me.acted ? open(b, me, known, false) : null),
      () => (allow('pinned') ? pinned(me) : null),
    );
  }
  for (const f of tries) {
    const tip = f();
    if (tip) return tip;
  }
  return null;
}

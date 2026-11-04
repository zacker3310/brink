import type { Deployment, DeployZone, Edge, SideDeployment, ZoneKind, ZoneSpec } from './command';
import { unitAt, unitById } from './engine';
import { passable } from './map';
import { typeOf } from './roster';
import { blueSees } from './combat';
import { dist, isFlying, updateIntel, visibleTo } from './sight';
import { BUILDING, H, inside, W, WATER, at, type Action, type ArenaSetup, type Battle, type BattleMap, type Point, type Side, type Unit, type UnitType } from './types';

// The deployment phase (docs/arena-v2.md, section 16.2). The war map earns each side zones: the
// attack edge, helicopter landing zones, a beach for an amphibious attack, a drop zone with air
// superiority; the defender has its prepared positions. Before round 1 the company is placed in
// them, by the player one unit at a time (`place`, then `deployed`) or for them (`autoDeploy`).
// Without zone data the zones are the map's own deployment cells, and the battle starts deployed.

/** Blue's zones lie south of this row, red's north of the next: clear of each other's deployment band. */
export const BLUE_ZONE_FROM = 26;
export const RED_ZONE_TO = 24;
/** Radius of a landing or drop zone around its point, by default. */
export const ZONE_RADIUS_DEFAULT = 2;
/** Most cells a beach zone takes. */
const BEACH_CELLS = 40;

const inHalf = (side: Side, p: Point) => (side === 'blue' ? p.y >= BLUE_ZONE_FROM : p.y <= RED_ZONE_TO);
const key = (p: Point) => `${p.x},${p.y}`;

/** Edge cells, two deep, in the side's own part of the field, middle first. */
function edgeCells(map: BattleMap, side: Side, edge: Edge): Point[] {
  if (side === 'blue' && edge === 'south') return map.blueSpawn.map((p) => ({ x: p.x, y: p.y }));
  const out: Point[] = [];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const on = edge === 'south' ? y >= H - 2 : edge === 'north' ? y <= 1 : edge === 'west' ? x <= 1 : x >= W - 2;
      if (on && inHalf(side, { x, y }) && passable(map, x, y, 'foot')) out.push({ x, y });
    }
  const mid = edge === 'west' || edge === 'east' ? { x: edge === 'west' ? 0 : W - 1, y: side === 'blue' ? H - 8 : 8 } : { x: (W - 1) / 2, y: edge === 'north' ? 0 : H - 1 };
  return out.sort((p, q) => dist(p, mid) - dist(q, mid) || p.y - q.y || p.x - q.x);
}

function around(map: BattleMap, side: Side, c: Point, r: number): Point[] {
  const out: Point[] = [];
  const R = Math.ceil(r);
  for (let dy = -R; dy <= R; dy++)
    for (let dx = -R; dx <= R; dx++) {
      const p = { x: Math.round(c.x) + dx, y: Math.round(c.y) + dy };
      if (inside(p.x, p.y) && Math.hypot(dx, dy) <= r + 0.01 && inHalf(side, p) && passable(map, p.x, p.y, 'foot')) out.push(p);
    }
  return out.sort((p, q) => dist(p, c) - dist(q, c) || p.y - q.y || p.x - q.x);
}

function beachCells(map: BattleMap, side: Side, near: Point): Point[] {
  const out: Point[] = [];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const p = { x, y };
      if (!inHalf(side, p) || !passable(map, x, y, 'foot')) continue;
      let shore = false;
      for (let dy = -1; dy <= 1 && !shore; dy++) for (let dx = -1; dx <= 1 && !shore; dx++) if (inside(x + dx, y + dy) && map.cells[at(map, x + dx, y + dy)] === WATER) shore = true;
      if (shore) out.push(p);
    }
  return out.sort((p, q) => dist(p, near) - dist(q, near) || p.y - q.y || p.x - q.x).slice(0, BEACH_CELLS);
}

const defaultPoint = (side: Side): Point => (side === 'blue' ? { x: Math.floor(W / 2), y: 32 } : { x: Math.floor(W / 2), y: 8 });

/** The cells a zone spec resolves to on this map (none when it cannot be honoured). */
export function zoneCells(map: BattleMap, side: Side, spec: ZoneSpec, airSuperiority = false): Point[] {
  if (spec.kind === 'drop' && !airSuperiority) return [];
  if (Array.isArray(spec.cells)) {
    const seen = new Set<string>();
    return spec.cells.filter((p) => {
      const ok = p && Number.isInteger(p.x) && Number.isInteger(p.y) && inside(p.x, p.y) && inHalf(side, p) && passable(map, p.x, p.y, 'foot') && !seen.has(key(p));
      if (ok) seen.add(key(p));
      return ok;
    });
  }
  const home: Edge = side === 'blue' ? 'south' : 'north';
  const point = spec.at && Number.isFinite(spec.at.x) && Number.isFinite(spec.at.y) ? { x: Math.max(0, Math.min(W - 1, Math.round(spec.at.x))), y: Math.max(0, Math.min(H - 1, Math.round(spec.at.y))) } : defaultPoint(side);
  const r = Number.isFinite(spec.r) ? Math.max(0, Math.min(6, spec.r!)) : ZONE_RADIUS_DEFAULT;
  switch (spec.kind) {
    case 'edge':
      return edgeCells(map, side, spec.edge ?? home);
    case 'lz':
    case 'drop':
      return around(map, side, point, r);
    case 'beach': {
      const shore = beachCells(map, side, spec.at ? point : { x: (W - 1) / 2, y: side === 'blue' ? H - 1 : 0 });
      // No water on this field: the landing craft run onto the attack edge.
      return shore.length ? shore : edgeCells(map, side, spec.edge ?? home);
    }
    case 'position':
      return side === 'red' && !spec.at ? map.redSpawn.map((p) => ({ x: p.x, y: p.y })) : around(map, side, point, Math.max(r, 4));
  }
}

/** The default zones: blue's attack edge (the map's deployment cells); red's positions and its rear edge. */
export function defaultZones(map: BattleMap, side: Side): DeployZone[] {
  if (side === 'blue') return [{ id: 'blue:edge', kind: 'edge', cells: zoneCells(map, 'blue', { kind: 'edge' }) }];
  return [
    { id: 'red:position', kind: 'position', cells: zoneCells(map, 'red', { kind: 'position' }) },
    { id: 'red:edge', kind: 'edge', cells: zoneCells(map, 'red', { kind: 'edge' }) },
  ];
}

/** A side's zones from the war map's request: always an edge (and, for the defender, its positions). */
export function resolveZones(map: BattleMap, side: Side, d: SideDeployment | undefined): DeployZone[] {
  const specs = Array.isArray(d?.zones) ? d!.zones.filter((z) => z && (['edge', 'lz', 'beach', 'drop', 'position'] as ZoneKind[]).includes(z.kind)) : [];
  const zones: DeployZone[] = [];
  const count: Partial<Record<ZoneKind, number>> = {};
  const add = (kind: ZoneKind, cells: Point[]) => {
    if (!cells.length) return;
    const n = (count[kind] = (count[kind] ?? 0) + 1);
    zones.push({ id: `${side}:${kind}${n > 1 ? n : ''}`, kind, cells });
  };
  if (side === 'red' && !specs.some((z) => z.kind === 'position')) add('position', zoneCells(map, side, { kind: 'position' }));
  for (const z of specs) add(z.kind, zoneCells(map, side, z, !!d?.airSuperiority));
  if (!zones.some((z) => z.kind === 'edge')) add('edge', zoneCells(map, side, { kind: 'edge' }));
  return zones;
}

/** The deployment state a setup asks for, or undefined (the defaults, nothing stored). */
export function deploymentFor(map: BattleMap, setup: ArenaSetup): Deployment | undefined {
  const d = setup.deployment;
  if (!d || typeof d !== 'object') return undefined;
  return { open: d.manual === true, zones: { blue: resolveZones(map, 'blue', d.blue), red: resolveZones(map, 'red', d.red) } };
}

/** A side's zones: as set up, or the defaults. */
export function zonesOf(b: Battle, side: Side): DeployZone[] {
  return b.deployment?.zones[side] ?? defaultZones(b.map, side);
}

export const deploying = (b: Battle): boolean => !!b.deployment?.open && !b.ended;

/** May a unit of this type use a zone of this kind? (The carrier decides for whoever rides in it.) */
export function zoneFits(kind: ZoneKind, t: UnitType): boolean {
  switch (kind) {
    case 'edge':
    case 'position':
      return true;
    case 'lz':
      return isFlying(t) || t.mobility === 'foot';
    case 'beach':
      return !isFlying(t);
    case 'drop':
      return t.mobility === 'foot';
  }
}

/** Can a unit of this type stand on the cell (ground: passable and no wreck for vehicles; air: anywhere)? */
export function cellFits(b: Battle, t: UnitType, p: Point): boolean {
  if (!inside(p.x, p.y)) return false;
  if (isFlying(t)) return true;
  if (!passable(b.map, p.x, p.y, t.mobility, t.amphibious)) return false;
  if (t.mobility !== 'foot' && (b.wrecks.some((w) => w.x === p.x && w.y === p.y) || b.map.cells[at(b.map, p.x, p.y)] === BUILDING)) return false;
  return true;
}

/** The zone a unit could be placed in at a cell, if any. */
export function zoneAt(b: Battle, side: Side, t: UnitType, p: Point): DeployZone | undefined {
  return zonesOf(b, side).find((z) => zoneFits(z.kind, t) && z.cells.some((c) => c.x === p.x && c.y === p.y));
}

/** Every cell a unit may be placed on now, from what its side knows (for the deployment screen). */
export function placements(b: Battle, unitId: string): Point[] {
  const u = unitById(b, unitId);
  if (!u || !deploying(b) || u.side !== 'blue' || !u.alive || u.carrier) return [];
  const t = typeOf(u.type);
  const out = new Map<string, Point>();
  for (const z of zonesOf(b, 'blue')) if (zoneFits(z.kind, t)) for (const p of z.cells) if (whyNotPlace(b, { type: 'place', unit: u.id, at: p }, 'blue') === null) out.set(key(p), p);
  return [...out.values()].sort((p, q) => p.y - q.y || p.x - q.x);
}

const setFacing = (u: Unit) => {
  u.facing = u.side === 'blue' ? -Math.PI / 2 : Math.PI / 2;
  u.aim = u.facing;
};

function moveWithPassengers(b: Battle, u: Unit, p: Point): void {
  u.x = p.x;
  u.y = p.y;
  for (const id of u.passengers) {
    const q = unitById(b, id);
    if (q) {
      q.x = p.x;
      q.y = p.y;
    }
  }
}

/** Why a `place` cannot be taken now, or null. Reads only what the side knows. */
export function whyNotPlace(b: Battle, a: Extract<Action, { type: 'place' }>, side: Side): string | null {
  if (!deploying(b) || side !== 'blue') return 'Deployment is over';
  const u = unitById(b, a.unit);
  if (!u || !u.alive || u.side !== side) return 'Not your unit';
  if (u.carrier) return 'Aboard a carrier';
  if (u.x === a.at.x && u.y === a.at.y) return 'Already there';
  const t = typeOf(u.type);
  if (!zoneAt(b, side, t, a.at)) return 'Not in a zone it may use';
  if (!cellFits(b, t, a.at)) return 'Cannot stand there';
  const there = unitAt(b, a.at.x, a.at.y, isFlying(t));
  if (there && there.side === side) {
    // Two of ours trade places, when each may stand where the other is.
    const ot = typeOf(there.type);
    return zoneAt(b, side, ot, u) && cellFits(b, ot, u) ? null : 'Taken';
  }
  if (there && visibleTo(b, side).has(there.id)) return 'Taken';
  return null;
}

/** Place a unit (checked by whyNotPlace): an enemy hidden on the cell is found there instead. */
export function place(b: Battle, a: Extract<Action, { type: 'place' }>): void {
  const u = unitById(b, a.unit)!;
  const t = typeOf(u.type);
  const there = unitAt(b, a.at.x, a.at.y, isFlying(t));
  if (there && there.side !== u.side) {
    there.revealed = Math.max(there.revealed, b.turnIndex);
    updateIntel(b);
    return;
  }
  const from = { x: u.x, y: u.y };
  if (there) {
    moveWithPassengers(b, there, from);
    setFacing(there);
    b.events.push({ type: 'deploy', unit: there.id, x: from.x, y: from.y, seen: blueSees(b, there) });
  }
  moveWithPassengers(b, u, a.at);
  setFacing(u);
  b.events.push({ type: 'deploy', unit: u.id, x: a.at.x, y: a.at.y, seen: blueSees(b, u) });
  updateIntel(b);
}

/** Back line, middle, front: where a unit goes in a zone. */
const band = (t: UnitType) => (t.role === 'spg' || t.role === 'arv' || t.role === 'mortar' || t.role === 'medic' || t.role === 'spaa' ? 2 : t.role === 'mbt' || t.role === 'ifv' || t.role === 'apc' || t.role === 'light_tank' ? 0 : 1);

/** The zones a unit prefers, in order: aircraft a landing zone, foot a drop zone, the rest as the war map listed them. */
function preference(zones: DeployZone[], t: UnitType): DeployZone[] {
  const fit = zones.filter((z) => zoneFits(z.kind, t) && z.kind !== 'position');
  const first = isFlying(t) ? 'lz' : t.mobility === 'foot' ? 'drop' : null;
  return [...fit.filter((z) => z.kind === first), ...fit.filter((z) => z.kind !== first)];
}

/**
 * Place a side's company in its zones (the auto-deploy, and how a battle with zones starts): front-line
 * units on a zone's best cells, guns and support at its back. Units in a carrier ride in it.
 */
export function autoDeploy(b: Battle, side: Side): void {
  const zones = zonesOf(b, side);
  const taken = new Set<string>();
  const order = b.units.filter((u) => u.side === side && u.alive && !u.carrier).sort((p, q) => band(typeOf(p.type)) - band(typeOf(q.type)) || (p.id < q.id ? -1 : 1));
  for (const u of order) {
    const t = typeOf(u.type);
    const air = isFlying(t);
    const layer = air ? 'a' : 'g';
    let spot: Point | null = null;
    for (const z of preference(zones, t)) {
      const cells = band(t) === 2 ? [...z.cells].reverse() : z.cells;
      spot = cells.find((p) => !taken.has(layer + key(p)) && cellFits(b, t, p)) ?? null;
      if (spot) break;
    }
    if (!spot) {
      // Nowhere in its zones: the nearest free cell to the attack edge's middle it can stand on.
      const mid = { x: Math.floor(W / 2), y: side === 'blue' ? H - 1 : 0 };
      for (let r = 0; r < 12 && !spot; r++)
        for (let dy = -r; dy <= r && !spot; dy++)
          for (let dx = -r; dx <= r && !spot; dx++) {
            const p = { x: mid.x + dx, y: mid.y + dy };
            if (Math.max(Math.abs(dx), Math.abs(dy)) === r && inside(p.x, p.y) && !taken.has(layer + key(p)) && cellFits(b, t, p)) spot = p;
          }
    }
    const p = spot ?? { x: u.x, y: u.y };
    taken.add(layer + key(p));
    moveWithPassengers(b, u, p);
    setFacing(u);
  }
}

/** The cells the defender's AI may deploy a unit on: its zones' (positions first), or the map's red deployment cells. */
export function deployCells(b: Battle, side: Side, t: UnitType): Point[] {
  if (!b.deployment) return side === 'red' ? b.map.redSpawn : b.map.blueSpawn;
  const out = new Map<string, Point>();
  const zones = zonesOf(b, side).filter((z) => zoneFits(z.kind, t));
  for (const z of [...zones.filter((x) => x.kind === 'position'), ...zones.filter((x) => x.kind !== 'position')]) for (const p of z.cells) if (!out.has(key(p))) out.set(key(p), p);
  return [...out.values()];
}

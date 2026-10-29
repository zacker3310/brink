import type { UnitClass } from '@brink/contracts';
import { createBattle } from './engine';
import { typeOf } from './roster';
import { H, OPEN, W, type ArenaSetup, type Battle, type Side, type TypeId, type Unit, type UnitSpec, type WeaponKind } from './types';

// Arena test fixtures: setups, a bare field with units placed by hand, and small helpers.

export function spec(id: string, types: TypeId[], cls: UnitClass = 'armor'): UnitSpec {
  return { id, cls, strength: 1000, name: id, color: '#888888', rank: 0, types };
}

/** A war-map formation built from its class template (no explicit types). */
export function formation(id: string, cls: UnitClass, strength = 1000): UnitSpec {
  return { id, cls, strength, name: id, color: '#000', rank: 0 };
}

export function setup(p: Partial<ArenaSetup> & Pick<ArenaSetup, 'attackers' | 'defenders'>): ArenaSetup {
  return { seed: 1, terrain: 'plains', river: false, site: null, arsenal: { blue: 'us', red: 'russia' }, skill: 0.5, abilities: [], biome: 'temperate', time: 'day', weather: 'clear', ...p };
}

/** A flat, empty field with the units placed by hand, so a rule can be tested on its own. */
export function bare(blue: TypeId[], red: TypeId[], extra: Partial<ArenaSetup> = {}): Battle {
  const b = createBattle(setup({ attackers: [spec('b', blue)], defenders: [spec('r', red)], ...extra }));
  const n = W * H;
  for (let i = 0; i < n; i++) {
    b.map.cells[i] = OPEN;
    b.map.elev[i] = 0;
    b.map.storeys[i] = 0;
    b.map.hp[i] = 0;
    b.map.crater[i] = 0;
  }
  b.map.mode = 'destroy';
  b.map.zone = null;
  // Defenders start dismounted and away; put everyone where the test says.
  let x = 0;
  for (const u of b.units) {
    u.x = x++ % W;
    u.y = u.side === 'blue' ? H - 1 : 0;
    u.facing = u.side === 'blue' ? -Math.PI / 2 : Math.PI / 2;
    u.aim = u.facing;
    u.carrier = null;
    u.passengers = [];
  }
  b.intel = { blue: {}, red: {} };
  return b;
}

export const unit = (b: Battle, type: TypeId, side: Side = 'blue', n = 0): Unit => b.units.filter((u) => u.type === type && u.side === side)[n]!;

export function put(u: Unit, x: number, y: number, facing?: number): Unit {
  u.x = x;
  u.y = y;
  if (facing !== undefined) {
    u.facing = facing;
    u.aim = facing;
  }
  return u;
}

export const weapon = (u: Unit, kind: WeaponKind) => typeOf(u.type).weapons.find((w) => w.kind === kind)!;

/** A deep copy, as the UI snapshots a battle (the state is plain JSON). */
export const copy = (b: Battle): Battle => JSON.parse(JSON.stringify(b)) as Battle;

export const NORTH = -Math.PI / 2;
export const SOUTH = Math.PI / 2;
export const EAST = 0;

/** Whole battles on autopilot can take a few seconds each on a shared CI runner. */
export const BATTLES = 120_000;

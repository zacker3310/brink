import type { UnitClass } from '@brink/contracts';
import { fitMen, typeOf, type Role, type Unit } from '@brink/arena';

// Small readings of a unit shared by the battle screen and the field badges.

/** The war-map class whose pictogram stands for a battle role. */
export function classOf(role: Role): UnitClass {
  if (role === 'mbt') return 'armor';
  if (role === 'ifv' || role === 'apc' || role === 'arv' || role === 'spaa') return 'mechanized';
  if (role === 'light_tank' || role === 'tank_hunter') return 'recon';
  if (role === 'spg' || role === 'mortar') return 'artillery';
  if (role === 'attack_heli' || role === 'gunship' || role === 'scout_heli' || role === 'transport_heli') return 'air';
  if (role === 'recon_drone' || role === 'fpv_team' || role === 'loiter_team') return 'drone';
  return 'infantry';
}

/** How whole a unit is, 0..1. */
export function health(u: Unit): number {
  const t = typeOf(u.type);
  if (!u.alive) return 0;
  if (t.mobility === 'foot') return fitMen(u) / Math.max(1, t.men?.length ?? 1);
  let h = 1 - 0.2 * Math.max(0, t.crew - u.crew);
  if (u.mobilityKill) h -= 0.3;
  if (u.firepowerKill) h -= 0.3;
  return Math.max(0.1, h);
}

/** What a badge says about a unit besides its strength. */
export type BadgeStatus = 'none' | 'watch' | 'suppressed' | 'pinned' | 'broken' | 'hunker';

export function badgeStatus(u: Unit): BadgeStatus {
  if (u.supp >= 80) return 'broken';
  if (u.supp >= 50) return 'pinned';
  if (u.supp >= 25) return 'suppressed';
  if (u.overwatch) return 'watch';
  if (u.hunker) return 'hunker';
  return 'none';
}

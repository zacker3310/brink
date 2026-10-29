import type { SoldierRole, TypeId } from '@brink/arena/v2';

// Real sizes in metres (length, width, height) from the makers' and services' fact sheets: tanks
// with the gun forward, aircraft by fuselage length and rotor or wing span. The roster's
// `UnitType.dims` should carry the same figures.

export const DIMS: Partial<Record<TypeId, [number, number, number]>> = {
  m1a2: [9.83, 3.66, 2.44],
  leo2a7: [10.97, 3.75, 3.0],
  cr3: [11.5, 3.52, 2.5],
  t72b3: [9.53, 3.59, 2.23],
  t90m: [9.63, 3.78, 2.23],
  t80bvm: [9.65, 3.6, 2.2],
  m2a3: [6.55, 3.61, 3.38],
  bmp3: [7.14, 3.15, 2.3],
  cv90: [6.8, 3.2, 2.8],
  stryker: [6.95, 2.72, 2.64],
  m10: [9.0, 3.5, 2.8],
  sprut: [9.77, 3.15, 2.5],
  m1134: [6.95, 2.72, 3.1],
  kornetd: [5.7, 2.4, 2.4],
  ah64e: [15.06, 14.63, 4.95],
  ka52: [13.53, 14.5, 4.93],
  mi35: [17.5, 17.3, 6.5],
  ah6: [7.6, 8.33, 2.69],
  uh60: [15.26, 16.36, 5.13],
  mi8: [18.42, 21.29, 4.76],
  raven: [0.9, 1.37, 0.25],
  orlan: [1.8, 3.1, 0.5],
  gepard: [7.68, 3.71, 4.03],
  tunguska: [7.93, 3.24, 4.02],
  paladin: [9.7, 3.9, 3.6],
  msta: [11.92, 3.38, 2.99],
  m88: [8.6, 3.66, 3.12],
  brem: [7.98, 3.46, 2.43],
};

/** A soldier, for foot units (drawn by `SoldierCrowd`). */
export const SOLDIER_DIMS: [number, number, number] = [0.5, 0.6, 1.8];

const FOOT = new Set<TypeId>([
  'squad_w', 'squad_e', 'team_w', 'team_e', 'javelin', 'kornet', 'rpg', 'gustaf', 'stinger', 'igla',
  'sniper_w', 'sniper_e', 'mortar_w', 'mortar_e', 'engineer_w', 'engineer_e', 'medic_w', 'medic_e',
  'fpv_w', 'fpv_e', 'switchblade', 'lancet',
]);

/** Foot units have no vehicle model: their soldiers are drawn by `SoldierCrowd`. */
export function isFoot(type: TypeId): boolean {
  return FOOT.has(type);
}

export type SoldierKit = 'rifle' | 'saw' | 'grenadier' | 'rpg' | 'at4' | 'javelin' | 'kornet' | 'gustaf' | 'manpads' | 'sniper' | 'mortar' | 'medic' | 'sapper' | 'operator' | 'pkm';

/** What a soldier of `role` in a unit of `type` carries. */
export function kitFor(type: TypeId, role: SoldierRole): SoldierKit {
  const east = type.endsWith('_e') || type === 'kornet' || type === 'rpg' || type === 'igla' || type === 'lancet';
  if (role === 'medic') return 'medic';
  if (role === 'sapper') return 'sapper';
  if (role === 'operator') return 'operator';
  if (role === 'sniper') return 'sniper';
  if (role === 'auto_rifleman') return 'saw';
  if (role === 'gunner') {
    if (type === 'mortar_w' || type === 'mortar_e') return 'mortar';
    if (type === 'stinger' || type === 'igla') return 'manpads';
    if (type === 'kornet') return 'kornet';
    if (type === 'javelin') return 'javelin';
    if (type === 'gustaf') return 'gustaf';
    if (type === 'rpg') return 'rpg';
    return east ? 'pkm' : 'saw';
  }
  if (role === 'at') {
    if (type === 'javelin') return 'javelin';
    if (type === 'kornet') return 'kornet';
    if (type === 'gustaf') return 'gustaf';
    if (type === 'stinger' || type === 'igla') return 'manpads';
    return east ? 'rpg' : 'at4';
  }
  if (role === 'grenadier') return 'grenadier';
  if (role === 'marksman') return 'sniper';
  if (type === 'engineer_w' || type === 'engineer_e') return 'sapper';
  if (type === 'medic_w' || type === 'medic_e') return 'medic';
  if (type === 'fpv_w' || type === 'fpv_e' || type === 'switchblade' || type === 'lancet') return 'operator';
  return 'rifle';
}

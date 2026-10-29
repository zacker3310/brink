import type { TypeId } from '@brink/arena/v2';
import type { Draft } from './draft';
import type { Scheme } from './paint';
import { ah6, apache, ka52, mi35, mi8, orlan, raven, uh60 } from './air';
import { bmp3, bradley, cv90, kornetD, m10, m1134, sprut, stryker } from './ifv';
import { brem, gepard, m88, msta, paladin, tunguska } from './support';
import { abrams, challenger, leopard, t72, t80, t90 } from './tanks';

// Which builder draws each type, and the aircraft finishes that ignore the ground camouflage.

export const BUILDERS: Partial<Record<TypeId, (d: Draft) => void>> = {
  m1a2: abrams,
  leo2a7: leopard,
  cr3: challenger,
  t72b3: t72,
  t90m: t90,
  t80bvm: t80,
  m2a3: bradley,
  bmp3,
  cv90,
  stryker,
  m1134,
  m10,
  sprut,
  kornetd: kornetD,
  gepard,
  tunguska,
  paladin,
  msta,
  m88,
  brem,
  ah64e: apache,
  ka52,
  mi35,
  ah6,
  uh60,
  mi8,
  raven,
  orlan,
};

export const SCHEME_OF: Partial<Record<TypeId, Scheme>> = {
  ah64e: 'helo_drab',
  uh60: 'helo_drab',
  ah6: 'heli_black',
  ka52: 'ru_heli_grey',
  mi35: 'ru_heli_camo',
  mi8: 'ru_heli_green',
  raven: 'drone_grey',
  orlan: 'drone_grey',
};

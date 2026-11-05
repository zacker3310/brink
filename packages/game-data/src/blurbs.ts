// How each power plays, in a few lines for the setup dossier: one registry over the country files.
// Text only; no balance numbers.

import { BLURB as china } from './nations/china';
import { BLURB as japan } from './nations/japan';
import { NATION_BLURBS } from './nations/russia';
import { BLURB as usa } from './nations/usa';
import { BLURB as egypt } from './nations/egypt';
import { BLURB as iran } from './nations/iran';
import { BLURB as nigeria } from './nations/nigeria';
import { BLURB as saudiArabia } from './nations/saudi-arabia';
import { BLURB as southAfrica } from './nations/south-africa';
import { BLURB as turkey } from './nations/turkey';

/** A nation's playstyle blurb, by nation id; a nation without one has no entry. */
export const NATION_BLURB: Readonly<Record<string, string>> = { china, japan, usa, ...NATION_BLURBS, egypt, iran, nigeria, 'saudi-arabia': saudiArabia, 'south-africa': southAfrica, turkey };

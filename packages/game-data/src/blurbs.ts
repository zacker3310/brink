// How each power plays, in a few lines for the setup dossier: one registry over the country files.
// Text only; no balance numbers.

import { BLURB as china } from './nations/china';
import { BLURB as japan } from './nations/japan';
import { NATION_BLURBS } from './nations/russia';
import { BLURB as usa } from './nations/usa';
import { BLURB as india } from './nations/india';
import { BLURB as pakistan } from './nations/pakistan';
import { BLURB as indonesia } from './nations/indonesia';
import { BLURB as australia } from './nations/australia';

/** A nation's playstyle blurb, by nation id; a nation without one has no entry. */
export const NATION_BLURB: Readonly<Record<string, string>> = { china, japan, usa, ...NATION_BLURBS, india, pakistan, indonesia, australia };

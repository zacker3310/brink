// How each power plays, in a few lines for the setup dossier: one registry over the country files.
// Text only; no balance numbers.

import { BLURB as china } from './nations/china';
import { BLURB as japan } from './nations/japan';
import { NATION_BLURBS } from './nations/russia';
import { BLURB as usa } from './nations/usa';
import { BLURB as canada } from './nations/canada';
import { BLURB as mexico } from './nations/mexico';
import { BLURB as colombia } from './nations/colombia';
import { BLURB as brazil } from './nations/brazil';
import { BLURB as argentina } from './nations/argentina';

/** A nation's playstyle blurb, by nation id; a nation without one has no entry. */
export const NATION_BLURB: Readonly<Record<string, string>> = { china, japan, usa, ...NATION_BLURBS, canada, mexico, colombia, brazil, argentina };

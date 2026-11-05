// The Black Files (MASTER-PLAN Phase 8): excavations, artefacts, black sites, the Visitors and the
// Accord. Plain JSON like the rest of the world. Absent from a world: the campaign has no anomaly.
//
// Everything about the Visitors is fiction: an invented faction with its own design language.

import type { FormationId, HexKey, NationId, SiteId, TechId } from './index';

/** The Visitors' own formations. Never recruited: their incursions grow them (`BLACK_FILES`). */
export type VisitorClass = 'walker' | 'swarm' | 'emitter';

export const VISITOR_CLASSES: readonly VisitorClass[] = ['walker', 'swarm', 'emitter'];

/** What a site is to the Black Files: a dig, a black-site laboratory, or a Visitors' incursion. */
export type Anomaly = 'excavation' | 'blacksite' | 'incursion';

/** One excavation site's dig: who has held it for how many turns running, and what is left in it. */
export interface Dig {
  holder: NationId | null;
  turns: number;
  /** Artefacts still in the ground. */
  left: number;
}

export interface BlackFilesState {
  /** The Visitors' nation id. It exists from turn 1, dormant (no sites, no formations) until it wakes. */
  visitors: NationId;
  /** Artefacts dug up across the world so far. */
  excavated: number;
  /** The Visitors wake when `excavated` reaches this. */
  wakeAt: number;
  /** They wake on this turn whatever was dug (the signal reaches them anyway); null: only by digging. */
  wakeTurn: number | null;
  /** Turn they woke; null while they sleep. */
  awake: number | null;
  /** Where the incursions open when they wake. */
  incursions: { key: HexKey; name: string }[];
  digs: Record<SiteId, Dig>;
  /** Artefacts each power holds, not yet studied. Public: a dig is seen from orbit. */
  artefacts: Record<NationId, number>;
  /** Powers whose black programme has leaked: everyone sees their reverse-engineered technologies. */
  leaked: NationId[];
  /** Signatories of the Accord, sorted. */
  accord: NationId[];
  /** Powers that broke the Accord: they can never sign again. Sorted. */
  betrayers: NationId[];
  /** How many turns running the Visitors have held each hex: past `BLACK_FILES.convertTurns` it turns to crystal. */
  held: Record<HexKey, number>;
  /** The next swarm split is told apart by this counter (ids come from `WorldState.nextId`). */
  splits: number;
}

/** What every power may know of the Black Files. Built by `buildView`. */
export interface BlackFilesView {
  visitors: NationId | null;
  awake: boolean;
  excavated: number;
  wakeAt: number;
  wakeTurn: number | null;
  digs: Record<SiteId, Dig>;
  artefacts: Record<NationId, number>;
  accord: NationId[];
  betrayers: NationId[];
  leaked: NationId[];
  /** Reverse-engineered technologies known to the viewer: its own, and those of leaked programmes. */
  blackTechs: Record<NationId, TechId[]>;
}

export type BlackFilesWhat =
  /** `nation` dug an artefact out of `site`. Public. */
  | 'artefact'
  /** `nation` finished reverse-engineering `tech`. Its own report only. */
  | 'studied'
  /** `nation` stole an artefact from `other`. Both are told. */
  | 'stolen'
  /** `nation`'s black programme leaked. Public. */
  | 'leaked'
  /** The Visitors woke. Public. */
  | 'awakening'
  /** An incursion opened at `site`. Public. */
  | 'incursion'
  /** `nation` signed the Accord. Public. */
  | 'accord'
  /** `nation` broke the Accord by declaring war on `other`. Public. */
  | 'betrayal'
  /** The Visitors turned the ground at `key` to crystal. Seen only. */
  | 'converted'
  /** A swarm (`formation`) split in two. Seen only. */
  | 'split';

export interface BlackFilesEvent {
  kind: 'black_files';
  what: BlackFilesWhat;
  nation?: NationId;
  other?: NationId;
  site?: SiteId;
  key?: HexKey;
  tech?: TechId;
  formation?: FormationId;
}

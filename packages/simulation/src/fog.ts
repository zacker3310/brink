import type {
  Contact,
  FormationId,
  HexKey,
  NationId,
  NationIntel,
  NationView,
  PublicNation,
  Relation,
  SiteView,
  TileView,
  WorldState,
} from '@brink/contracts';
import { RULES, TERRAIN } from '@brink/game-data';
import { rangeKeys } from '@brink/map';
import { clone, nationModifiers, relationOf, sortedKeys, visionRadius } from './rules';

export interface Vision {
  /** Hexes whose terrain, ownership and open-ground formations are seen. */
  visible: Set<HexKey>;
  /** Visible hexes where formations in concealing terrain are also detected. */
  detect: Set<HexKey>;
}

/** Nations whose eyes `nation` shares: itself and its allies. */
function sharers(world: WorldState, nation: NationId): NationId[] {
  return sortedKeys(world.nations).filter(
    (n) => !world.nations[n]!.eliminated && relationOf(world.relations, nation, n) === 'alliance',
  );
}

/**
 * What `nation` can see in the current world. `reconActive` lists formations flying a recon
 * order this turn: they see one hex further and detect concealed formations.
 */
export function computeVision(world: WorldState, nation: NationId, reconActive: ReadonlySet<FormationId> = new Set()): Vision {
  const visible = new Set<HexKey>();
  const detect = new Set<HexKey>();
  const eyes = new Set(sharers(world, nation));
  const add = (key: HexKey, detecting: boolean) => {
    if (!world.tiles[key]) return;
    visible.add(key);
    if (detecting) detect.add(key);
  };
  for (const key of sortedKeys(world.tiles)) {
    const t = world.tiles[key]!;
    if (t.owner && eyes.has(t.owner)) add(key, false);
  }
  for (const id of sortedKeys(world.sites)) {
    const s = world.sites[id]!;
    if (!s.owner || !eyes.has(s.owner)) continue;
    for (const k of rangeKeys(s.key, 2)) add(k, false);
    for (const k of rangeKeys(s.key, 1)) add(k, true);
  }
  for (const id of sortedKeys(world.formations)) {
    const f = world.formations[id]!;
    if (!eyes.has(f.owner)) continue;
    const mods = nationModifiers(world.nations[f.owner]!);
    const onRecon = reconActive.has(id);
    const radius = visionRadius(f.unitClass, mods, onRecon);
    const sharpEyed = f.unitClass === 'recon' || onRecon;
    for (const k of rangeKeys(f.key, radius)) add(k, sharpEyed);
    // Everyone sees into their own hex; only reconnaissance sees into cover beyond it.
    add(f.key, true);
  }
  return { visible, detect };
}

export function canDetect(world: WorldState, vision: Vision, key: HexKey): boolean {
  if (!vision.visible.has(key)) return false;
  const t = world.tiles[key];
  return !!t && (!TERRAIN[t.terrain].concealing || vision.detect.has(key));
}

/** Foreign formations `nation` currently detects, sorted by id. */
export function detectedFormations(world: WorldState, nation: NationId, vision: Vision): FormationId[] {
  return sortedKeys(world.formations).filter((id) => {
    const f = world.formations[id]!;
    return f.owner !== nation && canDetect(world, vision, f.key);
  });
}

export function emptyIntel(): NationIntel {
  return { observed: {}, knownOwner: {}, lastKnown: {} };
}

/** Record what `nation` saw at the end of this turn. Mutates `world.intel[nation]`. */
export function updateIntel(world: WorldState, nation: NationId, vision: Vision, turn: number): void {
  const intel = (world.intel[nation] ??= emptyIntel());
  for (const key of [...vision.visible].sort()) {
    intel.observed[key] = turn;
    intel.knownOwner[key] = world.tiles[key]!.owner;
  }
  // A nation always learns that it lost ground, and to whom, even out of sight.
  for (const key of sortedKeys(intel.knownOwner)) {
    const owner = world.tiles[key]!.owner;
    if (intel.knownOwner[key] === nation && owner !== nation) intel.knownOwner[key] = owner;
  }
  const seen = new Set(detectedFormations(world, nation, vision));
  for (const id of sortedKeys(intel.lastKnown)) {
    const lk = intel.lastKnown[id]!;
    const ownerNow = world.formations[id]?.owner;
    // Gone from where it was last seen, as far as this nation can tell.
    if (!seen.has(id) && canDetect(world, vision, lk.key)) delete intel.lastKnown[id];
    else if (ownerNow && relationOf(world.relations, nation, ownerNow) === 'alliance') delete intel.lastKnown[id];
  }
  for (const id of [...seen].sort()) {
    const f = world.formations[id]!;
    if (relationOf(world.relations, nation, f.owner) === 'alliance') continue;
    intel.lastKnown[id] = { owner: f.owner, unitClass: f.unitClass, key: f.key, strength: f.strength, turn };
  }
}

export function estimateStrength(strength: number): number {
  return Math.max(100, Math.round(strength / 100) * 100);
}

export function victoryPoints(world: WorldState): Record<NationId, number> {
  const out: Record<NationId, number> = {};
  for (const n of sortedKeys(world.nations)) out[n] = 0;
  for (const id of sortedKeys(world.sites)) {
    const s = world.sites[id]!;
    if (s.owner && out[s.owner] !== undefined) out[s.owner] = out[s.owner]! + s.victoryPoints;
  }
  return out;
}

export function totalVictoryPoints(world: WorldState): number {
  return Object.values(world.sites).reduce((a, s) => a + s.victoryPoints, 0);
}

export function victoryThreshold(world: WorldState): number {
  return Math.ceil((totalVictoryPoints(world) * RULES.victoryShare) / 100);
}

/**
 * Everything `nation` is allowed to know, built only from current vision and its own intel.
 * The client and the AI never receive anything else.
 */
export function buildView(world: WorldState, nation: NationId, vision: Vision = computeVision(world, nation)): NationView {
  const self = world.nations[nation];
  if (!self) throw new Error(`no such nation: ${nation}`);
  const intel = world.intel[nation] ?? emptyIntel();

  const tiles: Record<HexKey, TileView> = {};
  for (const key of sortedKeys(world.tiles)) {
    const t = world.tiles[key]!;
    const visible = vision.visible.has(key);
    const last = intel.observed[key];
    if (visible || last !== undefined) {
      tiles[key] = {
        key,
        q: t.q,
        r: t.r,
        visibility: visible ? 'visible' : 'observed',
        terrain: t.terrain,
        river: t.river,
        infrastructure: t.infrastructure,
        owner: visible ? t.owner : (intel.knownOwner[key] ?? null),
        siteId: t.siteId,
        lastObserved: visible ? world.turn : (last ?? null),
      };
    } else {
      tiles[key] = {
        key,
        q: t.q,
        r: t.r,
        visibility: 'unknown',
        terrain: null,
        river: false,
        infrastructure: 0,
        owner: null,
        siteId: null,
        lastObserved: null,
      };
    }
  }

  // Cities and objectives are public geography; who holds them is only what was last seen.
  const sites: Record<string, SiteView> = {};
  for (const id of sortedKeys(world.sites)) {
    const s = world.sites[id]!;
    const visible = vision.visible.has(s.key);
    sites[id] = {
      id,
      name: s.name,
      kind: s.kind,
      key: s.key,
      owner: visible ? s.owner : (intel.knownOwner[s.key] ?? s.originalOwner),
      victoryPoints: s.victoryPoints,
      population: s.population,
      yields: { ...s.yields },
    };
    tiles[s.key]!.siteId = id;
  }

  const formations: NationView['formations'] = {};
  for (const id of sortedKeys(world.formations)) {
    const f = world.formations[id]!;
    if (f.owner === nation) formations[id] = clone(f);
  }

  const contacts: Record<FormationId, Contact> = {};
  for (const id of detectedFormations(world, nation, vision)) {
    const f = world.formations[id]!;
    contacts[id] = {
      formation: id,
      owner: f.owner,
      unitClass: f.unitClass,
      key: f.key,
      estimatedStrength: estimateStrength(f.strength),
      confirmed: true,
      lastSeen: world.turn,
    };
  }
  for (const id of sortedKeys(intel.lastKnown)) {
    if (contacts[id]) continue;
    const lk = intel.lastKnown[id]!;
    contacts[id] = {
      formation: id,
      owner: lk.owner,
      unitClass: lk.unitClass,
      key: lk.key,
      estimatedStrength: estimateStrength(lk.strength),
      confirmed: false,
      lastSeen: lk.turn,
    };
  }

  // The scoreboard is public by design: victory points are announced, like an election count.
  const vp = victoryPoints(world);
  const nations: Record<NationId, PublicNation> = {};
  const relations: Record<NationId, Relation> = {};
  for (const id of sortedKeys(world.nations)) {
    const n = world.nations[id]!;
    nations[id] = { id, name: n.name, color: n.color, government: n.government, eliminated: n.eliminated, victoryPoints: vp[id]! };
    if (id !== nation) relations[id] = relationOf(world.relations, nation, id);
  }

  return {
    scenarioId: world.scenarioId,
    rulesetVersion: world.rulesetVersion,
    turn: world.turn,
    maxTurns: world.maxTurns,
    self: clone(self),
    nations,
    relations,
    proposals: world.proposals.filter((p) => p.from === nation || p.to === nation).map((p) => ({ ...p })),
    tiles,
    sites,
    formations,
    contacts,
    victoryThreshold: victoryThreshold(world),
    totalVictoryPoints: totalVictoryPoints(world),
    victory: world.victory ? { ...world.victory } : null,
    difficulty: world.difficulty ?? 'normal',
  };
}

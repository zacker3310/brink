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
import { TERRAIN, victoryBars } from '@brink/game-data';
import { keyDistance, rangeKeys } from '@brink/map';
import { blackFilesView, dormant } from './blackfiles';
import { leaderEffects, leaderOf } from './commanders';
import { revealedHexes } from './doctrine';
import { attitudesFor } from './leaders';
import { clone, nationModifiers, pairKey, relationOf, sortedKeys, visionRadius } from './rules';
import { supremacyStanding } from './victory';

export interface Vision {
  /** Hexes whose terrain, ownership and open-ground formations are seen. */
  visible: Set<HexKey>;
  /** Visible hexes where formations in concealing terrain are also detected. */
  detect: Set<HexKey>;
}

/** Nations whose eyes `nation` shares: itself, its allies and, in the Accord (Black Files), every signatory. */
function sharers(world: WorldState, nation: NationId): NationId[] {
  const accord = world.blackFiles?.accord.includes(nation) ? world.blackFiles.accord : [];
  return sortedKeys(world.nations).filter(
    (n) => !world.nations[n]!.eliminated && (relationOf(world.relations, nation, n) === 'alliance' || accord.includes(n)),
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
  const leaders = leaderEffects(world.commanders);
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
    const radius = visionRadius(f.unitClass, mods, onRecon) + (leaders[id]?.vision ?? 0);
    // Quantum radar (Black Files): every formation sees into cover as far as it sees.
    const sharpEyed = f.unitClass === 'recon' || onRecon || mods.trueSight > 0;
    for (const k of rangeKeys(f.key, radius)) add(k, sharpEyed);
    // Everyone sees into their own hex; only reconnaissance sees into cover beyond it.
    add(f.key, true);
  }
  // A Recon Flight sees all of its circle, cover or not.
  for (const n of [...eyes].sort()) for (const k of revealedHexes(world, n)) add(k, true);
  // Partners in a joint operation share what they see of its prize: the city and the ring around it.
  for (const t of world.treaties) {
    if (t.kind !== 'joint_op' || !t.site || (t.a !== nation && t.b !== nation)) continue;
    const prize = world.sites[t.site];
    const partner = t.a === nation ? t.b : t.a;
    if (!prize || world.nations[partner]?.eliminated) continue;
    const near = rangeKeys(prize.key, 1);
    const theirs = new Set(sharers(world, partner));
    for (const id of sortedKeys(world.formations)) {
      const f = world.formations[id]!;
      if (!theirs.has(f.owner) || keyDistance(f.key, prize.key) > 8) continue;
      const radius = visionRadius(f.unitClass, nationModifiers(world.nations[f.owner]!), false) + (leaders[id]?.vision ?? 0);
      for (const k of near) if (keyDistance(f.key, k) <= radius) add(k, f.unitClass === 'recon' || f.key === k);
    }
  }
  return { visible, detect };
}

/**
 * Who `nation` believes holds `siteId`: the truth where it sees the site now, else what it last saw
 * (its view shows the same). A joint operation is judged on this: a deal made on a prize that
 * changed hands out of sight is not an illegal order, it simply does not sign.
 */
export function knownSiteOwner(world: WorldState, nation: NationId, siteId: string, vision: Vision = computeVision(world, nation)): NationId | null {
  const s = world.sites[siteId];
  if (!s) return null;
  if (vision.visible.has(s.key)) return s.owner;
  return world.intel[nation]?.knownOwner[s.key] ?? s.originalOwner;
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
  return Math.ceil((totalVictoryPoints(world) * victoryBars(world.maxTurns).dominationShare) / 100);
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
        ...(t.port ? { port: true } : {}),
        ...(t.crystal ? { crystal: true as const } : {}),
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
      facilities: s.owner === nation || visible ? [...s.facilities] : [],
      ...((s.owner === nation || visible) && s.development !== undefined ? { development: s.development } : {}),
      ...(s.anomaly ? { anomaly: s.anomaly } : {}),
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

  // Your own generals in full; a foreign one only by name and rank, leading a contact seen now.
  const commanders: NonNullable<NationView['commanders']> = {};
  const enemyCommanders: NonNullable<NationView['enemyCommanders']> = {};
  for (const id of sortedKeys(world.commanders ?? {})) {
    const c = world.commanders![id]!;
    if (c.nation === nation) commanders[id] = clone(c);
  }
  for (const id of sortedKeys(contacts)) {
    if (!contacts[id]!.confirmed) continue;
    const c = leaderOf(world.commanders, id);
    if (c && c.nation !== nation) enemyCommanders[id] = { name: c.name, level: c.level, nation: c.nation };
  }

  // The scoreboard is public by design: victory points are announced, like an election count.
  const vp = victoryPoints(world);
  const nations: Record<NationId, PublicNation> = {};
  const relations: Record<NationId, Relation> = {};
  for (const id of sortedKeys(world.nations)) {
    const n = world.nations[id]!;
    // The Visitors are unknown to everyone until they wake.
    if (dormant(world, id) && id !== nation) continue;
    nations[id] = {
      id,
      name: n.name,
      color: n.color,
      government: n.government,
      eliminated: n.eliminated,
      victoryPoints: vp[id]!,
      ...(n.minor ? { minor: true } : {}),
      ...(n.visitors ? { visitors: true as const } : {}),
      // Command Points and hand size are public; the cards are not.
      ...(n.doctrine ? { doctrine: { cp: n.doctrine.cp, hand: n.doctrine.hand.length } } : {}),
    };
    if (id !== nation) relations[id] = relationOf(world.relations, nation, id);
  }
  // Wars and alliances are public, like the treaties: every pair, so a leader asked to join a war
  // knows whether the one asking is already in it. Every pair the view knows of: dormant Visitors
  // (Black Files) are in no pair until they wake.
  const ids = sortedKeys(nations);
  const publicRelations: Record<string, Relation> = {};
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) publicRelations[pairKey(ids[i]!, ids[j]!)] = relationOf(world.relations, ids[i]!, ids[j]!);

  const standing = supremacyStanding(world);
  return {
    scenarioId: world.scenarioId,
    rulesetVersion: world.rulesetVersion,
    turn: world.turn,
    maxTurns: world.maxTurns,
    self: clone(self),
    nations,
    relations,
    publicRelations,
    proposals: world.proposals.filter((p) => p.from === nation || p.to === nation).map((p) => ({ ...p })),
    treaties: world.treaties.map((t) => ({ ...t })),
    tiles,
    sites,
    formations,
    contacts,
    victoryThreshold: victoryThreshold(world),
    totalVictoryPoints: totalVictoryPoints(world),
    victory: world.victory ? { ...world.victory } : null,
    difficulty: world.difficulty ?? 'normal',
    ...(world.crisis ? { crisis: world.crisis } : {}),
    supremacy: standing,
    ...(world.commanders ? { commanders, enemyCommanders } : {}),
    // Leaders' moods: how every rival feels about you (their envoys make no secret of it), and how you feel about them.
    ...(self.minor ? {} : attitudesFor(world, nation, standing)),
    ...(world.blackFiles ? { blackFiles: blackFilesView(world, nation) } : {}),
  };
}

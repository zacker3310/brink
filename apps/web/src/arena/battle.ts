import type { ArenaBattle, CardPlay, FormationId, FormationOrder, HexKey, NationView } from '@brink/contracts';
import { UNITS } from '@brink/game-data';
import { cardSupport } from '@brink/simulation';
import { keyDistance } from '@brink/map';
import { abilitiesFor, ARSENAL_OF, rankOf, SUPPORT_IDS, type ArenaResult, type ArenaSetup, type Battle, type BattleEvent, type SiteKind, type SupportId, type UnitSpec } from '@brink/arena';

// A battle request: the stack you sent at a hex and the enemies you can see there, set up as an
// arena fight. Each formation becomes a detachment of a company (docs/arena-v2.md, section 5).
// Fought or not, its orders are what the war map gets.

export interface BattleRequest {
  setup: ArenaSetup;
  target: HexKey;
  /** The orders the stack gets: attack orders for everyone who fights. */
  orders: Record<FormationId, FormationOrder>;
  title: string;
  /** Skirmish practice: no war map behind it. */
  skirmish?: boolean;
  /** The war-map turn and nation it was ordered on (a saved battle is matched against them). */
  campaign?: { turn: number; nation: string };
  /** A saved battle to pick up where it was, instead of a new one, and what it logged that was never shown (arena/resume.ts). */
  resume?: { battle: Battle; unplayed: BattleEvent[] };
}

const BASE_SKILL = { easy: 0.18, normal: 0.38, hard: 0.58 } as const;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Enemy skill ramps with the difficulty, how far into the war it is, and how many are dug in there. */
export function enemySkill(view: NationView, defenders: number): number {
  const base = BASE_SKILL[view.difficulty] ?? BASE_SKILL.normal;
  return Math.max(0.08, Math.min(0.95, base + (view.turn / Math.max(1, view.maxTurns)) * 0.3 + Math.max(0, defenders - 1) * 0.04));
}

type SupportList = { id: SupportId; missions: number }[];

/** Ships within this many hexes of a battle fire on it: naval guns and cruise missiles. */
export const NAVAL_REACH = 2;
/** Carriers within this many hexes put strike sorties over it, from their own wing and what rides aboard. */
export const CARRIER_REACH = 3;

/**
 * The off-map support the war map brings to a battle at `target`, each side's from what stands
 * around it: fleets offshore (naval gunfire, a cruise missile each), carriers (two strike sorties
 * each), air wings and drone companies in strike range (a sortie, a kamikaze swarm), from a base or
 * a carrier deck nearby. Blue's from its own formations, red's from the enemies it has in sight.
 * Who fights in the battle itself (`exclude`) is not counted twice.
 */
export function supportFor(view: NationView, target: HexKey, exclude: readonly string[] = []): { blue: SupportList; red: SupportList } {
  const skip = new Set(exclude);
  const blue = new Map<SupportId, number>();
  const red = new Map<SupportId, number>();
  const add = (m: Map<SupportId, number>, id: SupportId, n: number) => m.set(id, (m.get(id) ?? 0) + n);
  const count = (m: Map<SupportId, number>, cls: string, d: number, deckNear: boolean) => {
    if (cls === 'fleet' && d <= NAVAL_REACH) {
      add(m, 'naval_gun', 2);
      add(m, 'cruise_missile', 1);
    } else if (cls === 'carrier' && d <= CARRIER_REACH) add(m, 'strike_jet', 2);
    else if (cls === 'air' && (d <= UNITS.air.range || deckNear)) add(m, 'strike_jet', 1);
    else if (cls === 'drone' && (d <= UNITS.drone.range || deckNear)) add(m, 'kamikaze', 1);
  };
  for (const id of Object.keys(view.formations).sort()) {
    const f = view.formations[id]!;
    if (skip.has(id)) continue;
    const ship = f.aboard ? view.formations[f.aboard] : undefined;
    // Aboard a transport, nothing flies; aboard a carrier near enough, the deck is the base.
    if (f.aboard && (!ship || UNITS[ship.unitClass].carries !== 'air')) continue;
    const deckNear = !!ship && keyDistance(ship.key, target) <= CARRIER_REACH;
    count(blue, f.unitClass, f.aboard ? Infinity : keyDistance(f.key, target), deckNear);
  }
  for (const id of Object.keys(view.contacts).sort()) {
    const c = view.contacts[id]!;
    if (skip.has(c.formation) || !c.confirmed || view.relations[c.owner] !== 'war') continue;
    // The garrison and its own aircraft in the hex are in the battle already.
    if (c.key === target && !UNITS[c.unitClass].naval) continue;
    count(red, c.unitClass, keyDistance(c.key, target), false);
  }
  const list = (m: Map<SupportId, number>): SupportList => SUPPORT_IDS.filter((x) => (m.get(x) ?? 0) > 0).map((x) => ({ id: x, missions: m.get(x)! }));
  return { blue: list(blue), red: list(red) };
}

/** Blue's support with what its doctrine cards add: the lasting ones in its view and the ones played this turn. */
export function withCards(view: NationView, blue: SupportList, plays: readonly CardPlay[] = []): SupportList {
  const total = new Map<SupportId, number>(blue.map((s) => [s.id, s.missions]));
  for (const c of cardSupport(view.self, view.turn, plays)) if ((SUPPORT_IDS as readonly string[]).includes(c.id)) total.set(c.id as SupportId, (total.get(c.id as SupportId) ?? 0) + c.missions);
  return SUPPORT_IDS.filter((x) => (total.get(x) ?? 0) > 0).map((x) => ({ id: x, missions: total.get(x)! }));
}

/** `plays`: the doctrine cards played in this turn's draft (Air Superiority's sorties fly over the battle). */
export function battleFor(view: NationView, target: HexKey, orders: Record<FormationId, FormationOrder>, plays: readonly CardPlay[] = []): BattleRequest | null {
  const fighters = Object.keys(orders)
    .filter((id) => orders[id]!.type === 'attack' && view.formations[id])
    .sort();
  // Ships in the hex fight at sea, never on the battlefield: a hand-fought battle is for the land forces.
  const enemies = Object.values(view.contacts)
    .filter((c) => c.key === target && view.relations[c.owner] === 'war' && !UNITS[c.unitClass].naval)
    .sort((a, b) => (a.formation < b.formation ? -1 : 1));
  if (fighters.length === 0 || enemies.length === 0) return null;
  const tile = view.tiles[target];
  const site = tile?.siteId ? view.sites[tile.siteId] : undefined;
  const attackers: UnitSpec[] = fighters.map((id) => {
    const f = view.formations[id]!;
    return { id, cls: f.unitClass, strength: f.strength, name: f.name, color: view.self.color, rank: rankOf(f.experience) };
  });
  const veteranEnemy = view.turn > view.maxTurns * 0.6 ? 1 : 0;
  const defenders: UnitSpec[] = enemies.map((c) => ({
    id: c.formation,
    cls: c.unitClass,
    strength: c.estimatedStrength,
    name: `${view.nations[c.owner]?.name ?? 'Enemy'} ${UNITS[c.unitClass].name}`,
    color: view.nations[c.owner]?.color ?? '#c0392b',
    rank: veteranEnemy,
  }));
  // The defenders' kit comes from the strongest power holding the hex.
  const owner = enemies[0]!.owner;
  const around = supportFor(view, target, [...fighters, ...enemies.map((c) => c.formation)]);
  const support = { blue: withCards(view, around.blue, plays), red: around.red };
  const place = site?.name ?? (tile?.terrain ? `the ${tile.terrain}` : 'the line');
  return {
    target,
    orders,
    title: site ? `Assault on ${site.name}` : `Battle for ${place}`,
    setup: {
      seed: hash(`${view.turn}|${target}|${fighters.join(',')}`),
      terrain: tile?.terrain ?? 'plains',
      river: tile?.river ?? false,
      site: (site?.kind ?? null) as SiteKind,
      attackers,
      defenders,
      arsenal: { blue: ARSENAL_OF[view.self.government], red: ARSENAL_OF[view.nations[owner]?.government ?? 'directorate'] },
      skill: enemySkill(view, defenders.length),
      // Battles are as hard as the campaign.
      difficulty: view.difficulty ?? 'normal',
      abilities: abilitiesFor(view.self.research.unlocked),
      theatre: view.scenarioId,
      ...(support.blue.length ? { support: support.blue } : {}),
      ...(support.red.length ? { redSupport: support.red } : {}),
    },
  };
}

/** The arena's verdict, in the form the engine takes on the turn's orders. */
export function battleRecord(req: BattleRequest, result: ArenaResult): ArenaBattle {
  const kept: Record<string, number> = {};
  for (const u of [...req.setup.attackers, ...req.setup.defenders]) kept[u.id] = result.kept[u.id] ?? 1000;
  return {
    target: req.target,
    attackers: req.setup.attackers.map((u) => u.id).sort(),
    defenders: req.setup.defenders.map((u) => u.id).sort(),
    kept,
    won: result.won,
  };
}

import type { ArenaBattle, FormationId, FormationOrder, HexKey, NationView } from '@brink/contracts';
import { UNITS } from '@brink/game-data';
import { abilitiesFor, rankOf, type ArenaResult, type ArenaSetup, type SiteKind, type UnitSpec } from '@brink/arena';

// A battle request: the stack you sent at a hex and the enemies you can see there, set up as an
// arena fight. Fought or not, its orders are what the war map gets.

export interface BattleRequest {
  setup: ArenaSetup;
  target: HexKey;
  /** The orders the stack gets: attack orders for everyone who fights. */
  orders: Record<FormationId, FormationOrder>;
  title: string;
  /** Skirmish practice: no war map behind it. */
  skirmish?: boolean;
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

export function battleFor(view: NationView, target: HexKey, orders: Record<FormationId, FormationOrder>): BattleRequest | null {
  const fighters = Object.keys(orders)
    .filter((id) => orders[id]!.type === 'attack' && view.formations[id])
    .sort();
  const enemies = Object.values(view.contacts)
    .filter((c) => c.key === target && view.relations[c.owner] === 'war')
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
      skill: enemySkill(view, defenders.length),
      abilities: abilitiesFor(view.self.research.unlocked),
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

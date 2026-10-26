import type {
  HexKey,
  Formation,
  FormationId,
  GameEvent,
  NationId,
  NationOrders,
  NationView,
  Stockpile,
  TurnReport,
  TurnResult,
  WorldState,
} from '@brink/contracts';
import { RULESET_VERSION } from '@brink/game-data';
import { settleEconomy } from './economy';
import { resolveDiplomacy } from './diplomacy';
import { resolveWorldEvents } from './events';
import { resolveEngagements, resolveRetreats, resolveStrikes } from './engagements';
import { buildView, canDetect, computeVision, detectedFormations, updateIntel, victoryPoints, victoryThreshold, type Vision } from './fog';
import { hashState } from './hash';
import { resolveMovement } from './movement';
import { resolveProduction } from './production';
import { clone, relationOf, sortedKeys } from './rules';
import { allocateLogistics } from './supply';
import { resolveTerritory } from './territory';
import { lockOrders } from './validate';

export const PHASES = [
  'validate',
  'diplomacy',
  'production',
  'logistics',
  'reconnaissance',
  'strikes',
  'movement',
  'engagements',
  'territory',
  'economy',
  'victory',
  'reports',
] as const;

function living(world: WorldState): NationId[] {
  return sortedKeys(world.nations).filter((n) => !world.nations[n]!.eliminated);
}

/**
 * Phase 2b. Nations at peace may share ground; once at war they cannot. When war breaks out over
 * a shared hex, whoever is not on its own ground falls back (the declarer, on anyone else's).
 */
function separateNewEnemies(world: WorldState, events: GameEvent[]): void {
  const wars = events.filter((e): e is Extract<GameEvent, { kind: 'diplomacy' }> => e.kind === 'diplomacy' && e.relation === 'war');
  if (wars.length === 0) return;
  const mustRetreat = new Map<FormationId, HexKey[]>();
  const byHex = new Map<HexKey, Formation[]>();
  for (const id of sortedKeys(world.formations)) {
    const f = world.formations[id]!;
    byHex.set(f.key, [...(byHex.get(f.key) ?? []), f]);
  }
  for (const key of [...byHex.keys()].sort()) {
    const here = byHex.get(key)!;
    for (const w of wars) {
      if (!here.some((f) => f.owner === w.a) || !here.some((f) => f.owner === w.b)) continue;
      const host = world.tiles[key]!.owner;
      const leaver = host === w.a ? w.b : host === w.b ? w.a : w.proposedBy;
      for (const f of here) if (f.owner === leaver) mustRetreat.set(f.id, [key]);
    }
  }
  if (mustRetreat.size > 0) resolveRetreats(world, { mustRetreat, advances: new Map() }, events);
}

/** Phase 11a. A nation holding no capital or city is out; its formations surrender. */
function resolveEliminations(world: WorldState, events: GameEvent[]): void {
  for (const nation of living(world)) {
    const holds = Object.values(world.sites).some((s) => s.owner === nation && (s.kind === 'capital' || s.kind === 'city'));
    if (holds) continue;
    const n = world.nations[nation]!;
    n.eliminated = true;
    n.productionQueue = [];
    for (const id of sortedKeys(world.formations)) {
      const f = world.formations[id]!;
      if (f.owner !== nation) continue;
      events.push({ kind: 'destroyed', formation: id, owner: nation, unitClass: f.unitClass, at: f.key });
      delete world.formations[id];
    }
    world.proposals = world.proposals.filter((p) => p.from !== nation && p.to !== nation);
    events.push({ kind: 'elimination', nation });
  }
}

/** Phase 11b. Victory points, last nation standing, or the turn limit, in that order. */
export function evaluateVictory(world: WorldState): WorldState['victory'] {
  const alive = living(world);
  if (alive.length === 1) return { winner: alive[0]!, reason: 'last_standing', turn: world.turn };
  const vp = victoryPoints(world);
  const threshold = victoryThreshold(world);
  const leaders = alive.filter((n) => vp[n]! >= threshold);
  if (leaders.length === 1) return { winner: leaders[0]!, reason: 'victory_points', turn: world.turn };
  if (world.turn >= world.maxTurns) {
    const strength = (n: NationId) => Object.values(world.formations).filter((f) => f.owner === n).reduce((a, f) => a + f.strength, 0);
    const ranked = [...alive].sort((a, b) => vp[b]! - vp[a]! || strength(b) - strength(a) || (a < b ? -1 : 1));
    return { winner: ranked[0]!, reason: 'turn_limit', turn: world.turn };
  }
  return null;
}

/** Events a nation is entitled to see, redacted where they would reveal what it cannot. */
function reportFor(world: WorldState, nation: NationId, vision: Vision, events: readonly GameEvent[]): GameEvent[] {
  const friendly = (owner: NationId) => relationOf(world.relations, nation, owner) === 'alliance';
  const sees = (key: string) => vision.visible.has(key);
  const out: GameEvent[] = [];
  for (const e of events) {
    switch (e.kind) {
      case 'movement':
        if (friendly(e.owner)) out.push(e);
        else {
          const path = e.path.filter((k) => canDetect(world, vision, k));
          if (path.length > 0) out.push({ ...e, path, halted: null });
        }
        break;
      case 'engagement':
        if (e.participants.some((p) => friendly(p.owner)) || sees(e.location)) out.push(e);
        break;
      case 'strike':
        if (friendly(e.owner)) {
          const victims = canDetect(world, vision, e.target) ? e.victims : e.victims.filter((v) => friendly(v.owner));
          out.push({ ...e, victims });
        } else if (e.victims.some((v) => friendly(v.owner)) || sees(e.target)) {
          out.push({ ...e, victims: e.victims.filter((v) => friendly(v.owner) || sees(e.target)) });
        }
        break;
      case 'retreat':
        if (friendly(e.owner) || sees(e.from) || sees(e.to)) out.push(e);
        break;
      case 'destroyed':
        if (friendly(e.owner) || sees(e.at)) out.push(e);
        break;
      case 'territory':
        if ((e.from && friendly(e.from)) || friendly(e.to) || sees(e.key)) out.push(e);
        break;
      case 'site_captured':
        if ((e.from && friendly(e.from)) || friendly(e.to) || sees(e.key)) out.push(e);
        break;
      case 'production':
      case 'production_cancelled':
      case 'recruitment_queued':
      case 'economy':
      case 'supply':
      case 'intel':
      case 'research':
      case 'order_rejected':
      case 'world_event':
        if (e.nation === nation) out.push(e);
        break;
      case 'proposal':
        if (e.from === nation || e.to === nation) out.push(e);
        break;
      case 'diplomacy':
      case 'elimination':
      case 'victory':
        out.push(e);
        break;
    }
  }
  return out;
}

/**
 * Resolve one strategic turn (six hours). Pure: the input world is not modified, and the same
 * world and orders always give the same result and hash, whatever order the submissions are in.
 */
export function resolveTurn(input: WorldState, submissions: readonly NationOrders[]): TurnResult {
  if (input.rulesetVersion !== RULESET_VERSION) {
    throw new Error(`world uses ruleset ${input.rulesetVersion}; this engine runs ${RULESET_VERSION}`);
  }
  if (input.victory) throw new Error('the match is over');
  const world = clone(input);
  const seed = world.seed;
  const events: GameEvent[] = [];
  const engaged = new Set<FormationId>();

  // 1. Validate and lock.
  const { orders, rejected } = lockOrders(world, submissions);
  events.push(...rejected);
  const nations = sortedKeys(orders);

  // 2. Diplomacy.
  resolveDiplomacy(world, orders, events);
  separateNewEnemies(world, events);

  // 3. Production and recruitment. Each nation touches only its own stockpile and queue.
  const production: Record<NationId, Stockpile> = {};
  for (const n of nations) production[n] = resolveProduction(world, n, orders[n]!, events);

  // 4. Logistics, against one snapshot of enemy positions.
  const logistics: Record<NationId, Stockpile> = {};
  for (const n of nations) logistics[n] = allocateLogistics(world, n, orders[n]!, events);

  // 5. Reconnaissance: vision for this turn's targeting, with recon orders active.
  const recon = new Set<FormationId>();
  for (const n of nations) for (const id of sortedKeys(orders[n]!.formations)) if (orders[n]!.formations[id]!.type === 'recon') recon.add(id);
  const vision: Record<NationId, Vision> = {};
  for (const n of nations) vision[n] = computeVision(world, n, recon);

  // 6. Ranged and air.
  const support = resolveStrikes(world, orders, vision, seed, events, engaged);

  // 7. Movement.
  const movement = resolveMovement(world, orders);
  events.push(...movement.events);

  // 8. Engagements.
  const engagement = resolveEngagements(world, orders, movement.meetings, vision, support, seed, events, engaged);

  // 9. Retreats, advances, territory.
  resolveRetreats(world, engagement, events);
  resolveTerritory(world, events);

  // 10. Economy.
  for (const n of nations) {
    if (world.nations[n]!.eliminated) continue;
    settleEconomy(world, n, orders[n]!, engaged, movement.moved, { production: production[n]!, logistics: logistics[n]! }, events);
  }
  resolveWorldEvents(world, orders, events);

  // 11. Victory.
  resolveEliminations(world, events);
  world.victory = evaluateVictory(world);
  if (world.victory) events.push({ kind: 'victory', winner: world.victory.winner, reason: world.victory.reason });

  // 12. Observation and reports. Intel is recorded against the turn just resolved.
  const resolved = world.turn;
  const finalVision: Record<NationId, Vision> = {};
  for (const n of sortedKeys(world.nations)) finalVision[n] = computeVision(world, n);
  for (const n of sortedKeys(world.nations)) {
    const before = new Set(Object.keys(world.intel[n]?.lastKnown ?? {}));
    for (const id of detectedFormations(world, n, finalVision[n]!)) {
      const f = world.formations[id]!;
      if (!before.has(id) && relationOf(world.relations, n, f.owner) !== 'alliance') {
        events.push({ kind: 'intel', nation: n, formation: id, owner: f.owner, unitClass: f.unitClass, key: f.key });
      }
    }
    updateIntel(world, n, finalVision[n]!, resolved);
  }
  if (!world.victory) world.turn += 1;

  const vp = victoryPoints(world);
  const observations: Record<NationId, NationView> = {};
  const reports: Record<NationId, TurnReport> = {};
  for (const n of sortedKeys(world.nations)) {
    observations[n] = buildView(world, n, finalVision[n]!);
    reports[n] = { turn: resolved, events: reportFor(world, n, finalVision[n]!, events), victoryPoints: vp };
  }
  return { world, events, observations, reports, hash: hashState(world) };
}

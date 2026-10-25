import type {
  EngagementParticipant,
  Formation,
  FormationId,
  GameEvent,
  HexKey,
  NationId,
  NationOrders,
  WorldState,
} from '@brink/contracts';
import { AIR_REBASE_RANGE, RULES, STACK_LIMIT, UNITS } from '@brink/game-data';
import { areAdjacent, keyDistance, neighborKeys } from '@brink/map';
import {
  airDefenseLoss,
  assaultLosses,
  assaultOutcome,
  attackerPower,
  defenderPower,
  spreadLoss,
  strikeLoss,
  type AssaultContext,
  type AssaultOutcome,
} from './combat';
import { canDetect, type Vision } from './fog';
import { rollRange } from './rng';
import { clamp, enterCost, nationModifiers, relationOf, sortedKeys } from './rules';

/** Per-formation effects computed from a snapshot, then committed together. */
interface Effects {
  strength: number;
  organization: number;
  morale: number;
  ammunition: number;
  experience: number;
  entrenchment: number;
}

class EffectBook {
  private map = new Map<FormationId, Effects>();
  add(id: FormationId, e: Partial<Effects>): void {
    const cur = this.map.get(id) ?? { strength: 0, organization: 0, morale: 0, ammunition: 0, experience: 0, entrenchment: 0 };
    cur.strength += e.strength ?? 0;
    cur.organization += e.organization ?? 0;
    cur.morale += e.morale ?? 0;
    cur.ammunition += e.ammunition ?? 0;
    cur.experience += e.experience ?? 0;
    cur.entrenchment += e.entrenchment ?? 0;
    this.map.set(id, cur);
  }
  /** Apply every recorded effect. Returns strength lost per nation. */
  commit(world: WorldState): Map<NationId, number> {
    const lost = new Map<NationId, number>();
    for (const id of [...this.map.keys()].sort()) {
      const f = world.formations[id];
      if (!f) continue;
      const e = this.map.get(id)!;
      const loss = Math.min(f.strength, e.strength);
      f.strength -= loss;
      f.organization = clamp(f.organization - e.organization, 0, 100);
      f.morale = clamp(f.morale + e.morale, 0, 100);
      f.ammunition = clamp(f.ammunition - e.ammunition, 0, 100);
      f.experience = clamp(f.experience + e.experience, 0, 100);
      f.entrenchment = clamp(f.entrenchment - e.entrenchment, 0, 100);
      lost.set(f.owner, (lost.get(f.owner) ?? 0) + loss);
    }
    for (const [n, l] of lost) world.nations[n]!.warLosses += l;
    return lost;
  }
}

function hostilesAt(world: WorldState, nation: NationId, key: HexKey): Formation[] {
  return sortedKeys(world.formations)
    .map((id) => world.formations[id]!)
    .filter((f) => f.key === key && relationOf(world.relations, nation, f.owner) === 'war');
}

/** Remove formations at or below the destroyed threshold. */
export function removeDestroyed(world: WorldState, events: GameEvent[]): void {
  for (const id of sortedKeys(world.formations)) {
    const f = world.formations[id]!;
    if (f.strength <= RULES.destroyedStrength) {
      events.push({ kind: 'destroyed', formation: id, owner: f.owner, unitClass: f.unitClass, at: f.key });
      delete world.formations[id];
    }
  }
}

export interface Support {
  air: Set<string>;
  artillery: Set<string>;
}

const supportKey = (nation: NationId, key: HexKey) => `${nation}|${key}`;

/**
 * Phase 6. Every artillery and air strike is computed from the same pre-strike snapshot and
 * committed together, so two batteries shelling each other both fire.
 */
export function resolveStrikes(
  world: WorldState,
  orders: Record<NationId, NationOrders>,
  vision: Record<NationId, Vision>,
  seed: number,
  events: GameEvent[],
  engaged: Set<FormationId>,
): Support {
  const support: Support = { air: new Set(), artillery: new Set() };
  const book = new EffectBook();
  for (const nation of sortedKeys(orders)) {
    for (const id of sortedKeys(orders[nation]!.formations)) {
      const order = orders[nation]!.formations[id]!;
      const f = world.formations[id];
      if (!f || order.type !== 'attack' || UNITS[f.unitClass].range === 0) continue;
      const def = UNITS[f.unitClass];
      if (keyDistance(f.key, order.target) > def.range) continue;
      const victims = hostilesAt(world, nation, order.target);
      const spotted = canDetect(world, vision[nation]!, order.target);
      const ctx = { terrain: world.tiles[order.target]!.terrain, spotted, sourceMods: nationModifiers(world.nations[nation]!) };
      const hits: { formation: FormationId; owner: NationId; strengthLoss: number }[] = [];
      for (const v of victims) {
        const swing = rollRange(100 - RULES.combatSwing, 100 + RULES.combatSwing, seed, world.turn, 'strike', id, v.id);
        const loss = strikeLoss(f, v, ctx, swing);
        book.add(v.id, { strength: loss, organization: Math.floor(loss / 3) + 5, entrenchment: RULES.strikeEntrenchment });
        hits.push({ formation: v.id, owner: v.owner, strengthLoss: loss });
        engaged.add(v.id);
      }
      let sourceLoss = 0;
      if (!def.ground) {
        sourceLoss = airDefenseLoss(victims, rollRange(100 - RULES.combatSwing, 100 + RULES.combatSwing, seed, world.turn, 'flak', id));
        book.add(id, { strength: sourceLoss });
        support.air.add(supportKey(nation, order.target));
      } else {
        support.artillery.add(supportKey(nation, order.target));
      }
      book.add(id, { ammunition: def.ammoPerAttack, experience: hits.length > 0 ? 1 : 0 });
      engaged.add(id);
      events.push({ kind: 'strike', source: id, owner: nation, unitClass: f.unitClass, target: order.target, victims: hits, sourceLoss });
    }
  }
  book.commit(world);
  removeDestroyed(world, events);
  return support;
}

interface Assault {
  nation: NationId;
  target: HexKey;
  attackers: Formation[];
}

export interface EngagementResult {
  /** Formations that lost an assault on their hex and must fall back. */
  mustRetreat: Map<FormationId, HexKey[]>;
  /** Hexes cleared (or found empty) by a single nation, with the formation that takes them. */
  advances: Map<HexKey, FormationId>;
}

function participant(f: Formation, role: EngagementParticipant['role'], loss: number, org: number, morale: number, ammo: number): EngagementParticipant {
  return {
    formation: f.id,
    owner: f.owner,
    unitClass: f.unitClass,
    role,
    from: f.key,
    strengthBefore: f.strength,
    strengthLoss: loss,
    organizationLoss: org,
    moraleChange: morale,
    ammunitionSpent: ammo,
  };
}

/**
 * Phase 8. Assaults and head-on meetings, all computed from the post-movement snapshot and
 * committed together. A defender attacked from two sides fights both at its full strength.
 */
export function resolveEngagements(
  world: WorldState,
  orders: Record<NationId, NationOrders>,
  meetings: [FormationId, FormationId][],
  vision: Record<NationId, Vision>,
  support: Support,
  seed: number,
  events: GameEvent[],
  engaged: Set<FormationId>,
): EngagementResult {
  const book = new EffectBook();
  const mustRetreat = new Map<FormationId, HexKey[]>();
  const claims = new Map<HexKey, { nation: NationId; candidates: Formation[] }[]>();
  const claim = (key: HexKey, nation: NationId, candidates: Formation[]) => claims.set(key, [...(claims.get(key) ?? []), { nation, candidates }]);
  const swing = (...parts: (string | number)[]) =>
    rollRange(100 - RULES.combatSwing, 100 + RULES.combatSwing, seed, world.turn, ...parts);

  // Group ground attackers by (nation, target).
  const assaults: Assault[] = [];
  for (const nation of sortedKeys(orders)) {
    const byTarget = new Map<HexKey, Formation[]>();
    for (const id of sortedKeys(orders[nation]!.formations)) {
      const order = orders[nation]!.formations[id]!;
      const f = world.formations[id];
      if (!f || order.type !== 'attack' || UNITS[f.unitClass].range > 0) continue;
      if (!areAdjacent(f.key, order.target)) continue;
      byTarget.set(order.target, [...(byTarget.get(order.target) ?? []), f]);
    }
    for (const target of [...byTarget.keys()].sort()) assaults.push({ nation, target, attackers: byTarget.get(target)! });
  }

  const defendingIds = new Set<FormationId>();
  for (const nation of sortedKeys(orders))
    for (const id of sortedKeys(orders[nation]!.formations)) if (orders[nation]!.formations[id]!.type === 'defend') defendingIds.add(id);

  for (const a of assaults) {
    const defenders = hostilesAt(world, a.nation, a.target);
    const tile = world.tiles[a.target]!;
    if (defenders.length === 0) {
      // Nobody home: walk in, unless the hex belongs to a nation we are at peace with.
      if (!tile.owner || relationOf(world.relations, a.nation, tile.owner) !== 'peace') claim(a.target, a.nation, a.attackers);
      continue;
    }
    const id = `e${world.turn}-${a.nation}-${a.target}`;
    const ctx: AssaultContext = {
      terrain: tile.terrain,
      river: tile.river,
      tileOwner: tile.owner,
      spotted: canDetect(world, vision[a.nation]!, a.target) || a.attackers.some((f) => f.unitClass === 'recon'),
      airSupport: support.air.has(supportKey(a.nation, a.target)),
      artillerySupport: support.artillery.has(supportKey(a.nation, a.target)),
      attackerMods: nationModifiers(world.nations[a.nation]!),
      defenderMods: (owner) => nationModifiers(world.nations[owner]!),
      defending: (fid) => defendingIds.has(fid),
    };
    const power = { attack: attackerPower(a.attackers, defenders, ctx), defense: defenderPower(defenders, ctx) };
    const res = assaultLosses(power, swing(id, 'attacker'), swing(id, 'defender'));
    const aLoss = spreadLoss(a.attackers, res.attackerLoss);
    const dLoss = spreadLoss(defenders, res.defenderLoss);
    const broken = defenders.every((d) => d.organization - (Math.floor(dLoss.get(d.id)! / 4) + 10) <= RULES.breakOrganization);
    const outcome: AssaultOutcome = assaultOutcome(res.share, broken);
    const won = outcome === 'attacker_victory';
    const held = outcome === 'defender_held';
    const participants: EngagementParticipant[] = [];
    for (const f of a.attackers) {
      const loss = aLoss.get(f.id)!;
      const org = Math.floor(loss / 4) + 5;
      const morale = won ? 4 : held ? -8 : -2;
      const ammo = UNITS[f.unitClass].ammoPerAttack;
      book.add(f.id, { strength: loss, organization: org, morale, ammunition: ammo, experience: 2 });
      participants.push(participant(f, 'attacker', loss, org, morale, ammo));
      engaged.add(f.id);
    }
    for (const d of defenders) {
      const loss = dLoss.get(d.id)!;
      const org = Math.floor(loss / 4) + (won ? 15 : 5);
      const morale = won ? -8 : held ? 4 : -2;
      const ammo = Math.floor(UNITS[d.unitClass].ammoPerAttack / 2);
      book.add(d.id, { strength: loss, organization: org, morale, ammunition: ammo, experience: 2 });
      participants.push(participant(d, 'defender', loss, org, morale, ammo));
      engaged.add(d.id);
      if (won) mustRetreat.set(d.id, [...(mustRetreat.get(d.id) ?? []), ...a.attackers.map((f) => f.key)]);
    }
    if (won) claim(a.target, a.nation, a.attackers);
    events.push({ kind: 'engagement', id, location: a.target, type: 'assault', participants, outcome, retreated: [], destroyed: [], advanced: null });
  }

  for (const [x, y] of meetings) {
    const a = world.formations[x];
    const b = world.formations[y];
    if (!a || !b) continue;
    const id = `m${world.turn}-${x}-${y}`;
    const ctxFor = (self: Formation, other: Formation): AssaultContext => ({
      terrain: 'plains',
      river: false,
      tileOwner: null,
      spotted: true,
      airSupport: false,
      artillerySupport: false,
      attackerMods: nationModifiers(world.nations[self.owner]!),
      defenderMods: () => nationModifiers(world.nations[other.owner]!),
      defending: () => false,
    });
    // Both sides attack; each side's power is its attack against the other.
    const power = { attack: attackerPower([a], [b], ctxFor(a, b)), defense: attackerPower([b], [a], ctxFor(b, a)) };
    const res = assaultLosses(power, swing(id, x), swing(id, y));
    const outcome: AssaultOutcome = res.share >= RULES.breakthrough ? 'attacker_victory' : res.share <= 1000 - RULES.breakthrough ? 'defender_held' : 'inconclusive';
    const participants: EngagementParticipant[] = [];
    for (const [f, loss] of [
      [a, res.defenderLoss],
      [b, res.attackerLoss],
    ] as const) {
      const take = Math.min(f.strength, loss);
      const org = Math.floor(take / 4) + 5;
      const ammo = Math.floor(UNITS[f.unitClass].ammoPerAttack / 2);
      book.add(f.id, { strength: take, organization: org, morale: -2, ammunition: ammo, experience: 2 });
      participants.push(participant(f, 'meeting', take, org, -2, ammo));
      engaged.add(f.id);
    }
    events.push({ kind: 'engagement', id, location: a.key, type: 'meeting', participants, outcome, retreated: [], destroyed: [], advanced: null });
  }

  book.commit(world);
  const destroyedNow: GameEvent[] = [];
  removeDestroyed(world, destroyedNow);
  const destroyedIds = new Set(destroyedNow.map((e) => (e.kind === 'destroyed' ? e.formation : '')));
  for (const e of events) {
    if (e.kind === 'engagement') e.destroyed = e.participants.map((p) => p.formation).filter((p) => destroyedIds.has(p));
  }
  events.push(...destroyedNow);
  for (const id of [...mustRetreat.keys()]) if (!world.formations[id]) mustRetreat.delete(id);

  // A hex claimed by exactly one nation is taken by its strongest formation there.
  const advances = new Map<HexKey, FormationId>();
  for (const key of [...claims.keys()].sort()) {
    const list = claims.get(key)!;
    const nations = new Set(list.map((c) => c.nation));
    if (nations.size !== 1) continue;
    const alive = list
      .flatMap((c) => c.candidates)
      .map((f) => world.formations[f.id])
      .filter((f): f is Formation => !!f && UNITS[f.unitClass].ground && enterCost(world.tiles[key], f.unitClass) !== null);
    alive.sort((p, q) => q.strength - p.strength || (p.id < q.id ? -1 : 1));
    if (alive[0]) advances.set(key, alive[0].id);
  }
  return { mustRetreat, advances };
}

/**
 * Phase 9a. Beaten defenders fall back, then winners advance into the ground they cleared.
 * Retreat choices are made together; when two hostile formations pick the same hex, both look
 * elsewhere, so neither nation's retreat has priority.
 */
export function resolveRetreats(world: WorldState, result: EngagementResult, events: GameEvent[]): void {
  const retreating = [...result.mustRetreat.keys()].sort();
  const vacating = new Set(retreating.map((id) => world.formations[id]!.key));
  const banned = new Map<FormationId, Set<HexKey>>();
  const chosen = new Map<FormationId, HexKey | null>();

  const candidates = (f: Formation): HexKey[] => {
    const threats = result.mustRetreat.get(f.id)!;
    const ban = banned.get(f.id) ?? new Set();
    if (!UNITS[f.unitClass].ground) {
      return sortedKeys(world.sites)
        .map((s) => world.sites[s]!)
        .filter((s) => s.owner === f.owner && s.key !== f.key && keyDistance(s.key, f.key) <= AIR_REBASE_RANGE)
        .filter((s) => !vacating.has(s.key) && !ban.has(s.key) && hostilesAt(world, f.owner, s.key).length === 0)
        .sort((a, b) => keyDistance(a.key, f.key) - keyDistance(b.key, f.key) || (a.key < b.key ? -1 : 1))
        .map((s) => s.key);
    }
    const scored = neighborKeys(f.key)
      .filter((k) => world.tiles[k] && enterCost(world.tiles[k], f.unitClass) !== null)
      .filter((k) => !vacating.has(k) && !ban.has(k) && hostilesAt(world, f.owner, k).length === 0)
      .filter((k) => {
        const owner = world.tiles[k]!.owner;
        return !owner || relationOf(world.relations, f.owner, owner) !== 'peace';
      })
      .map((k) => {
        const owner = world.tiles[k]!.owner;
        const home = owner && relationOf(world.relations, f.owner, owner) === 'alliance' ? 0 : owner === null ? 1 : 2;
        const away = threats.reduce((acc, t) => acc + keyDistance(k, t), 0);
        return { k, home, away };
      });
    scored.sort((a, b) => a.home - b.home || b.away - a.away || (a.k < b.k ? -1 : 1));
    return scored.map((s) => s.k);
  };

  for (let round = 0; round < 6; round++) {
    for (const id of retreating) chosen.set(id, candidates(world.formations[id]!)[0] ?? null);
    let clash = false;
    // No hex may end up over the stacking limit: later arrivals (by id, within one side) look elsewhere.
    const into = new Map<HexKey, FormationId[]>();
    for (const id of retreating) {
      const to = chosen.get(id);
      if (to) into.set(to, [...(into.get(to) ?? []), id]);
    }
    for (const [to, ids] of into) {
      const room = STACK_LIMIT - Object.values(world.formations).filter((o) => o.key === to && !result.mustRetreat.has(o.id)).length;
      for (const id of ids.slice(Math.max(0, room))) {
        banned.set(id, new Set([...(banned.get(id) ?? []), to]));
        clash = true;
      }
    }
    for (const a of retreating) {
      for (const b of retreating) {
        if (a >= b) continue;
        const ka = chosen.get(a);
        const kb = chosen.get(b);
        if (ka && ka === kb && relationOf(world.relations, world.formations[a]!.owner, world.formations[b]!.owner) !== 'alliance') {
          banned.set(a, new Set([...(banned.get(a) ?? []), ka]));
          banned.set(b, new Set([...(banned.get(b) ?? []), kb]));
          clash = true;
        }
      }
    }
    if (!clash) break;
    if (round === 5) for (const id of retreating) chosen.set(id, null);
  }

  for (const id of retreating) {
    const f = world.formations[id]!;
    const to = chosen.get(id) ?? null;
    if (to === null) {
      events.push({ kind: 'destroyed', formation: id, owner: f.owner, unitClass: f.unitClass, at: f.key });
      world.nations[f.owner]!.warLosses += f.strength;
      delete world.formations[id];
      continue;
    }
    events.push({ kind: 'retreat', formation: id, owner: f.owner, from: f.key, to });
    f.key = to;
    f.organization = clamp(f.organization - 10, 0, 100);
    f.entrenchment = 0;
  }

  for (const key of [...result.advances.keys()].sort()) {
    const f = world.formations[result.advances.get(key)!];
    if (!f) continue;
    const others = Object.values(world.formations).filter((o) => o.key === key);
    if (others.some((o) => o.owner !== f.owner) || others.length >= STACK_LIMIT) continue;
    f.key = key;
    f.entrenchment = 0;
    for (const e of events) if (e.kind === 'engagement' && e.location === key && e.type === 'assault') e.advanced = f.id;
    events.push({ kind: 'movement', formation: f.id, owner: f.owner, unitClass: f.unitClass, path: [key], halted: null });
  }

  const retreatedTo = new Set(events.filter((e) => e.kind === 'retreat').map((e) => (e.kind === 'retreat' ? e.formation : '')));
  for (const e of events) {
    if (e.kind === 'engagement') e.retreated = e.participants.map((p) => p.formation).filter((p) => retreatedTo.has(p));
  }
}

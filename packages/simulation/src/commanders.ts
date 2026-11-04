import type {
  Commander,
  CommanderEvent,
  CommanderId,
  CommanderOrders,
  CommandAssignment,
  FormationId,
  GameEvent,
  NationId,
  NationOrders,
  PerkId,
  WorldState,
} from '@brink/contracts';
import { COMMANDER_EFFECT_KEYS, COMMANDER_RULES, COMMANDER_TRAITS, levelForXp, PERK_IDS, PERKS, rosterFor, UNITS, type CommanderEffect } from '@brink/game-data';
import { roll } from './rng';
import { clamp, pct, sortedKeys } from './rules';

// Commanders (docs/architecture.md, "Commanders"). Generals lead formations; what they add is read
// from the commanders as they stood when the phase began (assignments change only in phase 1b, and
// experience, wounds and promotions only at the end of the turn), so every effect within a phase is
// computed from one snapshot.

/** Everything a general adds to the formation they lead; every field present. */
export type LeaderEffect = Required<CommanderEffect>;

function zeroEffect(): LeaderEffect {
  const out = {} as LeaderEffect;
  for (const k of COMMANDER_EFFECT_KEYS) out[k] = 0;
  return out;
}

/** A general's total effect: what any general adds, then their traits, then their perks. */
export function commanderEffect(c: Pick<Commander, 'traits' | 'perks'>): LeaderEffect {
  const out = zeroEffect();
  const sources: CommanderEffect[] = [COMMANDER_RULES.base];
  for (const t of c.traits) if (COMMANDER_TRAITS[t]) sources.push(COMMANDER_TRAITS[t].effect);
  for (const p of c.perks) if (PERKS[p]) sources.push(PERKS[p].effect);
  for (const s of sources) for (const k of COMMANDER_EFFECT_KEYS) out[k] += s[k] ?? 0;
  out.amphibious = Math.min(100, out.amphibious);
  out.survival = Math.min(100, out.survival);
  return out;
}

/** What each led formation gets, keyed by formation. Works on a world or a view's own generals. */
export function leaderEffects(commanders: Record<CommanderId, Commander> | undefined): Record<FormationId, LeaderEffect> {
  const out: Record<FormationId, LeaderEffect> = {};
  if (!commanders) return out;
  for (const id of sortedKeys(commanders)) {
    const c = commanders[id]!;
    if (c.status === 'active' && c.formation) out[c.formation] = commanderEffect(c);
  }
  return out;
}

/** The general leading formation `fid`, if any. */
export function leaderOf(commanders: Record<CommanderId, Commander> | undefined, fid: FormationId): Commander | undefined {
  if (!commanders) return undefined;
  for (const id of sortedKeys(commanders)) {
    const c = commanders[id]!;
    if (c.formation === fid && c.status === 'active') return c;
  }
  return undefined;
}

/** Two initials for the badge: "Eleanor Ashby" -> "EA". */
export function portraitOf(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '?';
  const last = parts.length > 1 ? parts.at(-1)![0]! : '';
  return (first + last).toUpperCase();
}

/**
 * Give every power its starting generals, once: worlds made before commanders, and new scenarios.
 * Minor states field none. Ids are `<nation>-gen-<n>`. Mutates and returns `world`.
 */
export function seedCommanders(world: WorldState): WorldState {
  if (world.commanders) return world;
  const out: Record<CommanderId, Commander> = {};
  for (const nation of sortedKeys(world.nations)) {
    const n = world.nations[nation]!;
    if (n.minor || n.eliminated) continue;
    rosterFor(nation, n.government)
      .slice(0, COMMANDER_RULES.perNation)
      .forEach((g, i) => {
        const id = `${nation}-gen-${i + 1}`;
        out[id] = {
          id,
          name: g.name,
          nation,
          portrait: portraitOf(g.name),
          traits: [g.trait],
          level: 1,
          xp: 0,
          perks: [],
          formation: null,
          status: 'active',
          woundedTurns: 0,
          offer: null,
          battles: 0,
        };
      });
  }
  world.commanders = out;
  return world;
}

function event(c: Commander, change: CommanderEvent['change'], extra: Partial<CommanderEvent> = {}): CommanderEvent {
  return { kind: 'commander', nation: c.nation, commander: c.id, name: c.name, change, ...extra };
}

/** Why general `c` cannot take formation `fid` (null: to the reserve), or null when they can. */
export function checkAssignment(world: Pick<WorldState, 'formations'>, nation: NationId, c: Commander | undefined, fid: FormationId | null, current: FormationId | null): string | null {
  if (!c || c.nation !== nation) return 'no such general of yours';
  if (c.status === 'killed') return `${c.name} has fallen`;
  if (fid === null) return current === null ? `${c.name} is already in reserve` : null;
  if (c.status === 'wounded') return `${c.name} is recovering from wounds`;
  if (typeof fid !== 'string') return 'malformed command assignment';
  const f = world.formations[fid];
  if (!f || f.owner !== nation) return 'no such formation of yours';
  if (UNITS[f.unitClass].naval) return 'generals lead land and air forces, not ships';
  if (current === fid) return `${c.name} already leads ${f.name}`;
  return null;
}

/**
 * Phase 1, commander orders: perk answers for waiting promotions, and postings. Postings are taken
 * together, as one reshuffle: a general may step into a command another leaves this turn, swaps
 * included. Where two would end up leading one formation, a general staying put keeps it, else the
 * lowest id; the others are refused (and stay where they were), until no formation has two.
 */
export function lockCommanderOrders(world: WorldState, nation: NationId, sub: CommanderOrders, reject: (reason: string) => void): CommanderOrders | undefined {
  if (!sub || typeof sub !== 'object') {
    reject('malformed commander orders');
    return undefined;
  }
  const all = world.commanders ?? {};
  const out: CommanderOrders = {};
  if (sub.perks !== undefined) {
    const perks: Record<CommanderId, 0 | 1> = {};
    const given = sub.perks && typeof sub.perks === 'object' ? sub.perks : {};
    for (const id of Object.keys(given).sort()) {
      const c = all[id];
      const choice = given[id];
      if (!c || c.nation !== nation) reject('no such general of yours');
      else if (!c.offer) reject(`${c.name} has no promotion waiting`);
      else if (choice !== 0 && choice !== 1) reject('unknown perk option');
      else perks[id] = choice;
    }
    out.perks = perks;
  }
  if (sub.assign !== undefined) {
    const list = Array.isArray(sub.assign) ? sub.assign.filter((a) => a && typeof a.commander === 'string') : [];
    if (!Array.isArray(sub.assign) || list.length !== sub.assign.length) reject('malformed command assignment');
    const mine = sortedKeys(all).filter((id) => all[id]!.nation === nation);
    const current = (id: CommanderId) => all[id]?.formation ?? null;
    const seen = new Set<CommanderId>();
    let live: CommandAssignment[] = [];
    for (const a of [...list].sort((x, y) => (x.commander < y.commander ? -1 : x.commander > y.commander ? 1 : 0))) {
      if (seen.has(a.commander)) {
        reject(`more than one assignment for ${all[a.commander]?.name ?? 'one general'}`);
        live = live.filter((x) => x.commander !== a.commander);
        continue;
      }
      seen.add(a.commander);
      const posting: CommandAssignment = { commander: a.commander, formation: a.formation ?? null };
      const why = checkAssignment(world, nation, all[a.commander], posting.formation, current(a.commander));
      if (why) reject(why);
      else live.push(posting);
    }
    for (;;) {
      const post = new Map<CommanderId, FormationId | null>(mine.map((id) => [id, current(id)]));
      for (const a of live) post.set(a.commander, a.formation);
      const moving = new Set(live.map((a) => a.commander));
      const byFormation = new Map<FormationId, CommanderId[]>();
      for (const id of mine) {
        const fid = post.get(id);
        if (fid) byFormation.set(fid, [...(byFormation.get(fid) ?? []), id]);
      }
      const refused = new Set<CommanderId>();
      for (const fid of [...byFormation.keys()].sort()) {
        const ids = byFormation.get(fid)!;
        if (ids.length < 2) continue;
        const keep = ids.find((id) => !moving.has(id)) ?? ids[0]!;
        for (const id of ids) if (id !== keep) refused.add(id);
      }
      if (refused.size === 0) break;
      for (const a of live) if (refused.has(a.commander)) reject(`${world.formations[a.formation!]?.name ?? 'that formation'} already has a general`);
      live = live.filter((a) => !refused.has(a.commander));
    }
    out.assign = live;
  }
  return out;
}

function takePerk(c: Commander, choice: 0 | 1, events: GameEvent[]): void {
  if (!c.offer) return;
  const perk = c.offer.options[choice];
  c.perks.push(perk);
  c.offer = null;
  events.push(event(c, 'perk', { perk, level: c.level }));
}

/** Phase 1b. Answered promotions take their perk, and generals take (or leave) their commands. */
export function applyCommanderOrders(world: WorldState, orders: Record<NationId, NationOrders>, events: GameEvent[]): void {
  const all = world.commanders;
  if (!all) return;
  for (const nation of sortedKeys(orders)) {
    const co = orders[nation]!.commanders;
    if (!co) continue;
    for (const id of sortedKeys(co.perks ?? {})) takePerk(all[id]!, co.perks![id]!, events);
    for (const a of co.assign ?? []) {
      const c = all[a.commander]!;
      c.formation = a.formation;
      events.push(a.formation ? event(c, 'assigned', { formation: a.formation }) : event(c, 'relieved'));
    }
  }
}

/** Phase 4b. A general's staff finds supplies the depots did not send. */
export function applyLeaderSupply(world: WorldState): void {
  const lead = leaderEffects(world.commanders);
  for (const fid of sortedKeys(lead)) {
    const f = world.formations[fid];
    if (f && lead[fid]!.supply > 0) f.supply = clamp(f.supply + lead[fid]!.supply, 0, 100);
  }
}

/** Two perks the general does not have, chosen by address. */
export function perkOffer(seed: number, turn: number, c: Pick<Commander, 'id' | 'perks'>): [PerkId, PerkId] {
  const open = PERK_IDS.filter((p) => !c.perks.includes(p));
  const i = roll(seed, turn, 'perk', c.id) % open.length;
  let j = roll(seed, turn, 'perk-2', c.id) % (open.length - 1);
  if (j >= i) j += 1;
  return [open[i]!, open[j]!];
}

/**
 * Phase 11b, after eliminations. Wounds heal; generals earn experience for what their formation
 * did this turn (fought, struck, took a site); a general whose formation was destroyed may be
 * killed or wounded, and one beaten back may be wounded; promotions are offered (two perks, by
 * `roll`) and a promotion left unanswered since an earlier turn takes its first perk; and every
 * general's standing effects (morale, readiness, entrenchment) apply.
 */
export function resolveCommanders(world: WorldState, events: GameEvent[]): void {
  const all = world.commanders;
  if (!all) return;
  const ids = sortedKeys(all);
  const out: GameEvent[] = [];
  const turnEvents = [...events];

  for (const id of ids) {
    const c = all[id]!;
    if (c.status !== 'wounded') continue;
    c.woundedTurns = Math.max(0, c.woundedTurns - 1);
    if (c.woundedTurns === 0) {
      c.status = 'active';
      out.push(event(c, 'recovered'));
    }
  }

  const ledBy = new Map<FormationId, Commander>();
  for (const id of ids) {
    const c = all[id]!;
    if (c.status === 'active' && c.formation) ledBy.set(c.formation, c);
  }
  const gained = new Map<CommanderId, number>();
  const fought = new Map<CommanderId, number>();
  const gain = (c: Commander | undefined, xp: number, battle = false) => {
    if (!c) return;
    gained.set(c.id, (gained.get(c.id) ?? 0) + xp);
    if (battle) fought.set(c.id, (fought.get(c.id) ?? 0) + 1);
  };
  const destroyed = new Set<FormationId>();
  const retreated = new Set<FormationId>();
  const X = COMMANDER_RULES.xp;
  for (const e of turnEvents) {
    if (e.kind === 'engagement') {
      for (const p of e.participants) {
        const won = (p.role === 'attacker' && e.outcome === 'attacker_victory') || (p.role === 'defender' && e.outcome === 'defender_held');
        gain(ledBy.get(p.formation), X.battle + (won ? X.victory : 0), true);
      }
    } else if (e.kind === 'strike') {
      if (e.victims.length > 0) gain(ledBy.get(e.source), X.strike, true);
    } else if (e.kind === 'site_captured') {
      for (const [fid, c] of ledBy) if (c.nation === e.to && world.formations[fid]?.key === e.key) gain(c, X.capture);
    } else if (e.kind === 'destroyed') destroyed.add(e.formation);
    else if (e.kind === 'retreat') retreated.add(e.formation);
  }

  for (const id of ids) {
    const c = all[id]!;
    const xp = gained.get(id);
    if (xp) c.xp += pct(xp, 100 + commanderEffect(c).xp);
    c.battles += fought.get(id) ?? 0;
  }

  // Fate: the formation's end is the general's peril. A formation gone without a destroyed event
  // (it cannot happen today) simply hands its general back to the reserve.
  for (const id of ids) {
    const c = all[id]!;
    const fid = c.formation;
    if (!fid || c.status !== 'active') continue;
    const guard = 100 - commanderEffect(c).survival;
    const die = roll(world.seed, world.turn, 'commander-fate', id) % 100;
    if (destroyed.has(fid)) {
      c.formation = null;
      const killed = pct(COMMANDER_RULES.destroyed.killed, guard);
      const wounded = killed + pct(COMMANDER_RULES.destroyed.wounded, guard);
      if (die < killed) {
        c.status = 'killed';
        c.offer = null;
        out.push(event(c, 'killed', { formation: fid }));
      } else if (die < wounded) {
        c.status = 'wounded';
        c.woundedTurns = COMMANDER_RULES.woundTurns.destroyed;
        out.push(event(c, 'wounded', { formation: fid }));
      } else out.push(event(c, 'relieved', { formation: fid }));
    } else if (!world.formations[fid]) {
      c.formation = null;
      out.push(event(c, 'relieved', { formation: fid }));
    } else if (retreated.has(fid) && die < pct(COMMANDER_RULES.retreatWound, guard)) {
      c.formation = null;
      c.status = 'wounded';
      c.woundedTurns = COMMANDER_RULES.woundTurns.retreat;
      out.push(event(c, 'wounded', { formation: fid }));
    }
  }

  for (const id of ids) {
    const c = all[id]!;
    const level = Math.min(COMMANDER_RULES.maxLevel, levelForXp(c.xp));
    // A general killed in the fight that earned a level keeps it on the record: no promotion, no offer.
    if (c.status === 'killed') {
      c.level = Math.max(c.level, level);
      continue;
    }
    if (level > c.level) {
      c.level = level;
      out.push(event(c, 'level_up', { level }));
    }
    // An earlier promotion nobody answered takes its first perk, like a world event.
    if (c.offer && c.offer.turn < world.turn) takePerk(c, 0, out);
    const owed = c.level - 1 - c.perks.length;
    if (!c.offer && owed > 0) c.offer = { options: perkOffer(world.seed, world.turn, c), turn: world.turn, level: c.perks.length + 2 };
  }

  for (const id of ids) {
    const c = all[id]!;
    if (c.status !== 'active' || !c.formation) continue;
    const f = world.formations[c.formation];
    if (!f) continue;
    const e = commanderEffect(c);
    if (e.morale) f.morale = clamp(f.morale + e.morale, 0, 100);
    if (e.readiness) f.readiness = clamp(f.readiness + e.readiness, 0, 100);
    if (e.entrench && (f.lastOrder === 'hold' || f.lastOrder === 'defend')) f.entrenchment = clamp(f.entrenchment + e.entrench, 0, 100);
  }
  events.push(...out);
}

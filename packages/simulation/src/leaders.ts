import type { Attitude, GameEvent, LeaderMemory, MemoryKind, MoodReason, MoodReasonId, NationId, Stance, WorldState } from '@brink/contracts';
import { LEADER_TUNING, leaderFor } from '@brink/game-data';
import { clamp, pct, relationOf, sortedKeys, treatyIn } from './rules';

// Leaders: what each power's head of government remembers of the others, and the mood that makes
// (Civ-style, itemised). Memories are written once a turn from the turn's public events (phase 11c);
// the mood is read from the world whenever a view is built, so it is never stored and never drifts.

const T = LEADER_TUNING;

/** The powers that have leaders: alive and not minor states. */
function powers(world: Pick<WorldState, 'nations'>): NationId[] {
  return sortedKeys(world.nations).filter((n) => !world.nations[n]!.eliminated && !world.nations[n]!.minor);
}

export function stanceOf(mood: number): Stance {
  if (mood < T.stances.hostile) return 'hostile';
  if (mood < T.stances.wary) return 'wary';
  if (mood <= T.stances.neutral) return 'neutral';
  if (mood <= T.stances.cordial) return 'cordial';
  return 'friendly';
}

/** What one memory is worth now: its weight fading in a straight line to nothing over its turns. */
export function memoryValue(kind: MemoryKind, age: number): number {
  const m = T.memory[kind];
  if (age >= m.turns || age < 0) return 0;
  return Math.trunc((m.weight * (m.turns - age)) / m.turns);
}

/**
 * How `from`'s leader feels about `to`, and why. Reads only public facts (relations, treaties, who
 * holds whose cities, the standing) and `from`'s own memories. `standing` is `supremacyStanding`.
 */
export function attitude(world: WorldState, from: NationId, to: NationId, standing: Record<NationId, number>): Attitude {
  const me = world.nations[from]!;
  const leader = leaderFor(from, me.government);
  const reasons: MoodReason[] = [];
  const add = (id: MoodReasonId, value: number, count?: number) => {
    if (value !== 0) reasons.push({ id, value, ...(count !== undefined && count > 1 ? { count } : {}) });
  };
  const turn = world.turn;
  add('temperament', T.temperament[leader.temperament].base);

  const rel = relationOf(world.relations, from, to);
  if (rel === 'war') add('at_war', T.live.at_war);
  if (rel === 'alliance') add('allied', T.live.allied);
  const trade = !!treatyIn(world.treaties, 'trade', from, to, turn);
  const pact = !!treatyIn(world.treaties, 'nonaggression', from, to, turn);
  const truce = !!treatyIn(world.treaties, 'ceasefire', from, to, turn);
  const embargo = treatyIn(world.treaties, 'embargo', from, to, turn);
  const embargoed = !!embargo && embargo.by === to;
  if (trade) add('trade', T.live.trade);
  if (pact) add('pact', T.live.pact);
  if (truce) add('ceasefire', T.live.ceasefire);
  if (treatyIn(world.treaties, 'joint_op', from, to, turn)) add('joint_op', T.live.joint_op);
  if (embargoed) add('embargo', T.live.embargo);

  const alive = powers(world);
  if (alive.some((n) => n !== from && n !== to && relationOf(world.relations, from, n) === 'war' && relationOf(world.relations, to, n) === 'war')) {
    add('common_enemy', T.live.common_enemy);
  }

  // Feared: `to` stands well ahead of every other power.
  const st = (n: NationId) => standing[n] ?? 0;
  const feared = alive.length > 2 && alive.every((n) => n === to || st(to) >= st(n) + T.live.fearedGap);
  if (feared) add('feared', leader.temperament === 'dove' ? T.live.fearedDove : T.live.feared);

  // Memories, summed by kind; grudges weigh by temperament.
  const memories = (world.memories?.[from] ?? []).filter((m) => m.about === to);
  const byKind = new Map<MemoryKind, { value: number; count: number }>();
  for (const m of memories) {
    const v = memoryValue(m.kind, turn - m.turn);
    if (v === 0) continue;
    const cur = byKind.get(m.kind) ?? { value: 0, count: 0 };
    byKind.set(m.kind, { value: cur.value + (v < 0 ? pct(v, T.temperament[leader.temperament].grudge) : v), count: cur.count + 1 });
  }
  for (const kind of [...byKind.keys()].sort()) add(kind, byKind.get(kind)!.value, byKind.get(kind)!.count);

  switch (leader.agenda) {
    case 'balance':
      if (feared) add('agenda_balance', T.agenda.balance);
      break;
    case 'commerce':
      if (trade) add('agenda_commerce', T.agenda.commerce);
      else if (embargoed) add('agenda_commerce', -T.agenda.commerce);
      break;
    case 'honour':
      if (memories.some((m) => m.kind === 'betrayed')) add('agenda_honour', T.agenda.honourBroken);
      else if (pact || truce || rel === 'alliance') add('agenda_honour', T.agenda.honourKept);
      break;
    case 'strength':
      if (st(to) >= st(from) + T.agenda.strengthGap) add('agenda_strength_respect', T.agenda.strengthRespect);
      else if (st(to) + T.agenda.contemptGap <= st(from)) add('agenda_strength_contempt', T.agenda.strengthContempt);
      break;
    case 'homeland': {
      let held = 0;
      for (const id of sortedKeys(world.sites)) {
        const s = world.sites[id]!;
        if (s.originalOwner === from && s.owner === to) held++;
      }
      add('agenda_homeland', Math.max(T.agenda.homelandCap, held * T.agenda.homelandPerSite), held);
      break;
    }
  }

  reasons.sort((a, b) => Math.abs(b.value) - Math.abs(a.value) || (a.id < b.id ? -1 : 1));
  const mood = clamp(
    reasons.reduce((s, r) => s + r.value, 0),
    -100,
    100,
  );
  return { leader: leader.id, mood, stance: stanceOf(mood), reasons };
}

/**
 * Phase 11c. Every power's leader remembers what was done to it this turn, from the turn's events:
 * betrayals and declarations of war, cities taken, peace made, treaties and deals signed, tribute
 * paid or refused, joint operations won. Old memories fade out; at most a few of a kind are kept.
 */
export function recordMemories(world: WorldState, events: readonly GameEvent[]): void {
  const memories = (world.memories ??= {});
  const isPower = (n: NationId | null | undefined): n is NationId => !!n && !!world.nations[n] && !world.nations[n]!.minor;
  const remember = (holder: NationId | null | undefined, about: NationId | null | undefined, kind: MemoryKind) => {
    if (!isPower(holder) || !isPower(about) || holder === about) return;
    (memories[holder] ??= []).push({ about, kind, turn: world.turn });
  };
  for (const e of events) {
    switch (e.kind) {
      case 'diplomacy': {
        const declarer = e.proposedBy;
        const other = declarer === e.a ? e.b : e.a;
        if (e.relation === 'war') remember(other, declarer, e.broke ? 'betrayed' : 'declared_war');
        else if (e.relation === 'peace') {
          remember(e.a, e.b, 'made_peace');
          remember(e.b, e.a, 'made_peace');
        } else {
          remember(e.a, e.b, 'dealt');
          remember(e.b, e.a, 'dealt');
        }
        break;
      }
      case 'treaty':
        if (e.treaty !== 'embargo') {
          remember(e.a, e.b, 'dealt');
          remember(e.b, e.a, 'dealt');
        }
        break;
      case 'site_captured':
        if (e.from && e.from !== e.to) remember(e.from, e.to, 'took_city');
        break;
      case 'exchange':
        if (e.void) break;
        if (e.tribute) {
          remember(e.a, e.b, 'extorted');
          remember(e.b, e.a, 'paid_us');
        } else {
          remember(e.a, e.b, 'dealt');
          remember(e.b, e.a, 'dealt');
        }
        break;
      case 'proposal_lapsed':
        // A demand left unpaid: the demander was defied. (`from` made the demand.)
        if (e.proposal === 'tribute' && e.terms?.get) remember(e.from, e.to, 'defied');
        break;
      case 'treaty_ended':
        if (e.treaty === 'joint_op' && e.reason === 'fulfilled') {
          remember(e.a, e.b, 'comrades');
          remember(e.b, e.a, 'comrades');
        }
        break;
    }
  }
  // Forget what has faded, what concerns a fallen power, and all but the newest few of a kind.
  for (const holder of sortedKeys(memories)) {
    if (!isPower(holder) || world.nations[holder]!.eliminated) {
      delete memories[holder];
      continue;
    }
    const kept = memories[holder]!.filter((m) => isPower(m.about) && !world.nations[m.about]!.eliminated && memoryValue(m.kind, world.turn - m.turn) !== 0);
    kept.sort((a, b) => (a.about < b.about ? -1 : a.about > b.about ? 1 : a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : b.turn - a.turn));
    const out: LeaderMemory[] = [];
    let run = 0;
    for (let i = 0; i < kept.length; i++) {
      const m = kept[i]!;
      const prev = kept[i - 1];
      run = prev && prev.about === m.about && prev.kind === m.kind ? run + 1 : 1;
      if (run <= T.memoriesPerKind) out.push(m);
    }
    memories[holder] = out;
  }
}

/** Every rival power's attitude toward `nation`, and `nation`'s toward each: for its view. */
export function attitudesFor(world: WorldState, nation: NationId, standing: Record<NationId, number>): { moods: Record<NationId, Attitude>; attitudes: Record<NationId, Attitude> } {
  const moods: Record<NationId, Attitude> = {};
  const attitudes: Record<NationId, Attitude> = {};
  const self = world.nations[nation];
  if (!self || self.minor) return { moods, attitudes };
  for (const n of powers(world)) {
    if (n === nation) continue;
    moods[n] = attitude(world, n, nation, standing);
    if (!self.eliminated) attitudes[n] = attitude(world, nation, n, standing);
  }
  return { moods, attitudes };
}

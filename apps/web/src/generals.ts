import type { Commander, CommandAssignment, CommanderId, FormationId, NationOrders, NationView } from '@brink/contracts';
import { COMMANDER_RANKS, COMMANDER_RULES, COMMANDER_TRAITS, PERKS, UNITS } from '@brink/game-data';

// The generals as the player sees them this turn: who leads what once the draft's postings take
// effect, and the draft edits that keep a plan the validator accepts (one general per formation).

/** Own generals, sorted by id. */
export function generalsOf(view: NationView): Commander[] {
  const all = view.commanders ?? {};
  return Object.keys(all)
    .sort()
    .map((id) => all[id]!);
}

/** Where each general will be once the draft's postings take effect (formation or null). */
export function postings(view: NationView, draft: NationOrders | null): Record<CommanderId, FormationId | null> {
  const out: Record<CommanderId, FormationId | null> = {};
  for (const c of generalsOf(view)) out[c.id] = c.formation;
  for (const a of draft?.commanders?.assign ?? []) out[a.commander] = a.formation;
  return out;
}

/** The general who will lead `fid` once the draft takes effect, and whether that is a new posting. */
export function leaderAfter(view: NationView, draft: NationOrders | null, fid: FormationId): { general: Commander; incoming: boolean } | null {
  const post = postings(view, draft);
  for (const c of generalsOf(view)) {
    if (post[c.id] === fid && c.status === 'active') return { general: c, incoming: c.formation !== fid };
  }
  return null;
}

/** A formation a general can lead: an own land or air formation, not a ship. */
export function canLead(view: NationView, fid: FormationId): boolean {
  const f = view.formations[fid];
  return !!f && !UNITS[f.unitClass].naval;
}

/** Generals who could take a command now: active (not wounded or fallen). */
export function available(view: NationView): Commander[] {
  return generalsOf(view).filter((c) => c.status === 'active');
}

/**
 * The draft's postings after sending `commander` to `formation` (null: the reserve). Whoever
 * would otherwise lead that formation goes to the reserve; a posting back to where the general
 * already is drops out of the draft.
 */
export function withPosting(view: NationView, draft: NationOrders, commander: CommanderId, formation: FormationId | null): CommandAssignment[] {
  const current = (id: CommanderId) => view.commanders?.[id]?.formation ?? null;
  const want = new Map<CommanderId, FormationId | null>();
  for (const a of draft.commanders?.assign ?? []) want.set(a.commander, a.formation);
  want.set(commander, formation);
  if (formation) {
    const post = postings(view, draft);
    for (const id of Object.keys(post).sort()) if (id !== commander && post[id] === formation) want.set(id, null);
  }
  return [...want.entries()]
    .filter(([id, f]) => f !== current(id))
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([id, f]) => ({ commander: id, formation: f }));
}

export function rankTitle(level: number): string {
  return COMMANDER_RANKS[Math.max(0, Math.min(COMMANDER_RANKS.length - 1, level - 1))]!;
}

/** Experience toward the next level, as [have, need]; null at the top. */
export function xpProgress(c: Pick<Commander, 'level' | 'xp'>): [number, number] | null {
  if (c.level >= COMMANDER_RULES.maxLevel) return null;
  const from = COMMANDER_RULES.levelXp[c.level - 1] ?? 0;
  const to = COMMANDER_RULES.levelXp[c.level] ?? from;
  return [c.xp - from, to - from];
}

export function traitLine(c: Pick<Commander, 'traits'>): string {
  return c.traits.map((t) => COMMANDER_TRAITS[t]?.name ?? t).join(', ');
}

export function perkName(id: string): string {
  return PERKS[id]?.name ?? id;
}

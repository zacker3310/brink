import type { Commander, CommandAssignment, CommanderEvent, CommanderId, FormationId, NationOrders, NationView } from '@brink/contracts';
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

/**
 * A general's news in plain words for the debrief and the report: who, what happened, and where;
 * null for a change the player made themselves (a posting they ordered says nothing new).
 */
export function commanderNote(view: NationView, e: CommanderEvent): { tone: 'good' | 'bad' | 'info'; title: string; text: string; at?: string } | null {
  const f = e.formation ? view.formations[e.formation] : undefined;
  const of = f ? ` ${f.name}` : e.formation ? ' the formation' : '';
  const at = f ? { at: f.key } : {};
  switch (e.change) {
    case 'level_up':
      return { tone: 'good', title: `${e.name} promoted`, text: `Now ${rankTitle(e.level ?? 1)}. Choose a perk for the new rank.` };
    case 'perk':
      return { tone: 'good', title: `${e.name} learns ${perkName(e.perk ?? '')}`, text: PERKS[e.perk ?? '']?.summary ?? 'A new perk.' };
    case 'wounded':
      return { tone: 'bad', title: `${e.name} wounded`, text: `Carried off the field when${of || ' the command'} fell back. Out of action for a few turns, then back in the reserve.`, ...at };
    case 'killed':
      return { tone: 'bad', title: `${e.name} killed in action`, text: `Fell with${of || ' the command'}. The perks and experience are lost.` };
    case 'recovered':
      return { tone: 'good', title: `${e.name} back from hospital`, text: 'Recovered and waiting in the reserve: select a formation to give them a command.' };
    case 'relieved':
      // A formation lost from under its general: they escaped. A recall the player ordered is no news.
      return e.formation && !f ? { tone: 'info', title: `${e.name} escaped`, text: 'Their formation was destroyed; the general made it back to the reserve.' } : null;
    case 'assigned':
      return f ? { tone: 'info', title: `${e.name} takes command`, text: `Now leads ${f.name}.`, ...at } : null;
  }
}

/**
 * The formation a reserve general would do most good leading: the operation's strongest assault
 * formation without a general, else the strongest land formation without one; null when none is free.
 */
export function suggestedPost(view: NationView, draft: NationOrders | null, preferred: readonly FormationId[] = []): FormationId | null {
  const post = postings(view, draft);
  const led = new Set(Object.values(post).filter((f): f is FormationId => !!f));
  const free = (id: FormationId) => canLead(view, id) && !led.has(id) && !view.formations[id]!.aboard;
  const best = (ids: FormationId[]) =>
    ids
      .filter(free)
      .sort((a, b) => view.formations[b]!.strength - view.formations[a]!.strength || (a < b ? -1 : 1))[0] ?? null;
  return best(preferred.filter((id) => view.formations[id])) ?? best(Object.keys(view.formations).filter((id) => UNITS[view.formations[id]!.unitClass].ground));
}

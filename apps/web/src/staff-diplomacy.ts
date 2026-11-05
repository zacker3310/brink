import type { DiplomacyOrder, DiplomaticAction, NationOrders, NationView, TurnReport } from '@brink/contracts';

// What the staff may do in the player's diplomacy. It drafts only what calms a front that is
// already quiet: trade and a non-aggression pact with a power the player is at peace (or allied)
// with. It never makes peace or a ceasefire for the player: a playtest declared war on a power and
// had the staff draft peace with it the next turn, which the rival (on Easy, always) accepted. Peace
// and ceasefires are advice instead, put to the player with one tap on the diplomacy screen.

/** What the staff signs on its own. */
const STAFF_SIGNS: ReadonlySet<DiplomaticAction> = new Set<DiplomaticAction>(['propose_nonaggression', 'propose_trade']);
/** What the staff only advises. */
const STAFF_ADVISES: ReadonlySet<DiplomaticAction> = new Set<DiplomaticAction>(['propose_peace', 'propose_ceasefire']);

export interface StaffDiplomacy {
  /** Orders to add to the player's draft. */
  orders: DiplomacyOrder[];
  /** Peace or a ceasefire the staff would make: the player decides. */
  advice: DiplomacyOrder[];
}

/**
 * Split the staff's suggested diplomacy into what goes in the draft and what is only advised. A
 * power the player already has a move toward this turn is left alone; nothing is advised toward a
 * power the player declared war on in the turn just resolved (they meant it).
 */
export function staffDiplomacy(view: NationView, draft: Pick<NationOrders, 'diplomacy'>, suggested: readonly DiplomacyOrder[], report?: Pick<TurnReport, 'events'> | null): StaffDiplomacy {
  const me = view.self.id;
  const mine = new Set(draft.diplomacy.map((d) => d.target));
  const declared = new Set(
    (report?.events ?? []).flatMap((e) => (e.kind === 'diplomacy' && e.relation === 'war' && e.proposedBy === me ? [e.a === me ? e.b : e.a] : [])),
  );
  const orders: DiplomacyOrder[] = [];
  const advice: DiplomacyOrder[] = [];
  for (const d of suggested) {
    if (mine.has(d.target) || orders.some((x) => x.target === d.target) || advice.some((x) => x.target === d.target)) continue;
    const rel = view.relations[d.target];
    if (STAFF_SIGNS.has(d.action) && (rel === 'peace' || rel === 'alliance')) orders.push({ target: d.target, action: d.action });
    else if (STAFF_ADVISES.has(d.action) && rel === 'war' && !declared.has(d.target)) advice.push({ target: d.target, action: d.action });
  }
  return { orders, advice };
}

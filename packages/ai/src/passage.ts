import type { AiMemory, NationId, NationOrders, NationView, SiteId, Temperament } from '@brink/contracts';
import { LEADER_TUNING, PASSAGE, UNITS } from '@brink/game-data';
import { findPath, keyDistance } from '@brink/map';
import { checkDiplomacy, diplomacyWorldOf, enterCost, hasPassage, sortedKeys } from '@brink/simulation';
import type { Verdict } from './diplomacy-ai';
import { landmasses } from './land';

// Right of passage, the leaders' side (ruleset 2.9.0): whom a leader lets march through, and when
// a power asks. Sees only its own view.

/**
 * How a leader answers a request for passage. Never toward a friend: an ally, or a power the leader
 * feels warmly about, is not marched on through its land (`likes_target`). Never for the power its
 * own army marches on. Otherwise by mood (with any sweetener already added by `consider`), which a
 * hawk wants high and a dove forgives; a request that will not say whom it is for wants more warmth.
 */
export function considerPassage(view: NationView, mood: number, temper: Temperament, isFocus: boolean, against: NationId | undefined, spared: boolean): Verdict {
  if (spared) return { accept: true, reason: 'agreed' };
  if (isFocus) return { accept: false, reason: 'focus' };
  if (against && (view.relations[against] === 'alliance' || (view.attitudes?.[against]?.mood ?? 0) > LEADER_TUNING.stances.neutral)) return { accept: false, reason: 'likes_target' };
  const bar = PASSAGE.mood[temper] + (against ? 0 : PASSAGE.unnamed);
  return mood >= bar ? { accept: true, reason: 'agreed' } : { accept: false, reason: 'mood' };
}

/** A power at peace with us whose land we may not cross: no passage, not an ally, not a minor state. */
function closedTo(view: NationView, owner: NationId | null | undefined): owner is NationId {
  return !!owner && owner !== view.self.id && view.relations[owner] === 'peace' && !view.nations[owner]?.minor && !hasPassage(view, view.self.id, owner);
}

/**
 * Whom to ask for passage this turn, if anyone: the power at peace whose land lies across the
 * army's way to its objective, when going round it costs half as much again (or is impossible).
 */
export function passageWanted(view: NationView, memory: AiMemory, target?: SiteId): { target: NationId; against?: NationId } | null {
  const site = (target ?? memory.objective) ? view.sites[(target ?? memory.objective)!] : undefined;
  if (!site || site.owner === view.self.id) return null;
  const land = landmasses(view);
  const goal = land.get(site.key);
  const army = sortedKeys(view.formations)
    .map((id) => view.formations[id]!)
    .filter((f) => UNITS[f.unitClass].ground && !f.aboard && land.get(f.key) === goal)
    .sort((a, b) => keyDistance(a.key, site.key) - keyDistance(b.key, site.key) || (a.id < b.id ? -1 : 1));
  const lead = army[0];
  if (!lead) return null;
  const step = (_a: string, b: string) => enterCost(view.tiles[b], lead.unitClass);
  const open = findPath(lead.key, site.key, step);
  if (!open) return null;
  const blocker = open.path.map((k) => view.tiles[k]?.owner).find((o) => closedTo(view, o));
  if (!blocker) return null;
  const around = findPath(lead.key, site.key, (a, b) => (closedTo(view, view.tiles[b]?.owner) ? null : step(a, b)), { maxCost: Math.floor((open.cost * 3) / 2) });
  if (around) return null;
  return { target: blocker, ...(site.owner ? { against: site.owner } : {}) };
}

/**
 * Add a request for passage to the turn's diplomacy when the war needs one: one at a time, never
 * while one of ours waits for an answer, every third turn at most, and only where the engine would
 * take it. Nothing else is planned toward that power this turn.
 */
export function seekPassage(view: NationView, memory: AiMemory, orders: NationOrders, target?: SiteId): NationOrders {
  if (view.self.minor) return orders;
  const want = passageWanted(view, memory, target);
  if (!want) return orders;
  if (orders.diplomacy.some((d) => d.target === want.target)) return orders;
  if (view.proposals.some((p) => p.from === view.self.id && p.to === want.target && p.kind === 'passage')) return orders;
  if ((view.turn + want.target.length) % 3 !== 0) return orders;
  const terms = want.against ? { against: want.against } : undefined;
  if (checkDiplomacy(diplomacyWorldOf(view), view.self.id, want.target, 'propose_passage', terms)) return orders;
  return { ...orders, diplomacy: [...orders.diplomacy, { target: want.target, action: 'propose_passage', ...(terms ? { terms } : {}) }] };
}

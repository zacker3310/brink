import type { FormationId, FormationOrder, HexKey, NationId, NationOrders, NationView, SiteId } from '@brink/contracts';
import { UNITS } from '@brink/game-data';
import { keyDistance } from '@brink/map';
import { ODDS_WORDS, operationById, proposeOperations, type Operation } from '@brink/ai';
import { plannedBattles, type PlannedBattle } from './arena/battle';
import { oddsFor, type Odds } from './odds';

// Plans: the turn's few concrete choices, ranked, each adopted in one tap. They come from the
// systems already there: the staff's operations (proposeOperations), a city under threat (dig in
// around it), a war on a second front (offer peace and free the army there), and the staff plan.
// Nothing here decides anything: a plan is a sentence and what one tap does.

export type PlanKind = 'operation' | 'hold' | 'peace' | 'staff';

export interface Plan {
  /** `op:take:<site>`, `hold:<site>`, `peace:<nation>`, `staff`. */
  id: string;
  kind: PlanKind;
  /** "Take Taipei". */
  title: string;
  /** "~5 turns · likely win · 12 VP": the cost and the chance, in a line. */
  line: string;
  /** Why the staff puts it here. */
  why: string;
  /** What the one tap says. */
  cta: string;
  odds?: Operation['odds'];
  /** Where it happens, for Show on map. */
  at?: HexKey;
  operation?: Operation;
  hold?: { site: SiteId; formations: FormationId[] };
  peace?: { nation: NationId; frees: number };
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

const isGround = (cls: string) => !!UNITS[cls as keyof typeof UNITS]?.ground;

/** Hostile strength (0..1000 per formation) seen within `reach` hexes of `key`. */
function threatAt(view: NationView, key: HexKey, reach: number): { strength: number; units: number; nation: NationId | null } {
  let strength = 0;
  let units = 0;
  const by = new Map<NationId, number>();
  for (const id of Object.keys(view.contacts).sort()) {
    const c = view.contacts[id]!;
    if (view.relations[c.owner] !== 'war' || !isGround(c.unitClass)) continue;
    if (keyDistance(c.key, key) > reach) continue;
    strength += c.estimatedStrength;
    units += 1;
    by.set(c.owner, (by.get(c.owner) ?? 0) + c.estimatedStrength);
  }
  const nation = [...by.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] ?? null;
  return { strength, units, nation };
}

/** Own cities with an enemy army at the gates and our troops there to hold them: dig in. */
function holds(view: NationView): (Plan & { urgency: number })[] {
  const out: (Plan & { urgency: number })[] = [];
  const own = Object.values(view.formations).filter((f) => isGround(f.unitClass) && !f.aboard);
  for (const id of Object.keys(view.sites).sort()) {
    const site = view.sites[id]!;
    if (site.owner !== view.self.id || (site.kind !== 'city' && site.kind !== 'capital')) continue;
    const threat = threatAt(view, site.key, 2);
    if (threat.units === 0) continue;
    const near = own.filter((f) => keyDistance(f.key, site.key) <= 1).sort((a, b) => (a.id < b.id ? -1 : 1));
    if (near.length === 0) continue;
    const ours = near.reduce((a, f) => a + f.strength, 0);
    // Worth a plan when the enemy outnumbers what stands there, or a capital sees any army close.
    const ratio = threat.strength / Math.max(1, ours);
    if (ratio < 0.8 && site.kind !== 'capital') continue;
    const who = threat.nation ? (view.nations[threat.nation]?.name ?? 'The enemy') : 'The enemy';
    out.push({
      id: `hold:${site.id}`,
      kind: 'hold',
      title: `Hold ${site.name}`,
      line: `${plural(threat.units, 'enemy unit')} within 2 hexes · dig in ${near.length}`,
      why: `${who} is massing on ${site.name} (${site.victoryPoints} VP). Dug in, the garrison fights at its best.`,
      cta: 'Dig in',
      at: site.key,
      hold: { site: site.id, formations: near.map((f) => f.id) },
      urgency: ratio * (site.victoryPoints + (site.kind === 'capital' ? 10 : 0)),
    });
  }
  return out.sort((a, b) => b.urgency - a.urgency || (a.id < b.id ? -1 : 1));
}

/**
 * A power we are at war with but not fighting for anything: peace frees the army on that front.
 * Only with another war to carry on, and never with the holder of the operation's prize.
 */
function peaces(view: NationView, focus: NationId | null): Plan[] {
  const enemies = Object.keys(view.relations)
    .sort()
    .filter((n) => view.relations[n] === 'war' && !view.nations[n]?.eliminated && !view.nations[n]?.minor);
  if (enemies.length < 2) return [];
  const own = Object.values(view.formations).filter((f) => isGround(f.unitClass) && !f.aboard);
  const contacts = Object.values(view.contacts).filter((c) => view.relations[c.owner] === 'war');
  // Each of our ground formations faces the enemy whose army is nearest it, within four hexes.
  const facing = new Map<NationId, number>();
  for (const f of own) {
    let best: { n: NationId; d: number } | null = null;
    for (const c of contacts) {
      const d = keyDistance(f.key, c.key);
      if (d <= 4 && (!best || d < best.d || (d === best.d && c.owner < best.n))) best = { n: c.owner, d };
    }
    if (best) facing.set(best.n, (facing.get(best.n) ?? 0) + 1);
  }
  const out: Plan[] = [];
  for (const n of enemies) {
    if (n === focus) continue;
    const frees = facing.get(n) ?? 0;
    if (frees < 2) continue;
    const name = view.nations[n]?.name ?? n;
    out.push({
      id: `peace:${n}`,
      kind: 'peace',
      title: `Make peace with ${name}`,
      line: `frees ${plural(frees, 'division')} for the main war`,
      why: `${plural(frees, 'division')} are tied down facing ${name}. Peace lets the staff send them where the war is won.`,
      cta: 'Offer peace',
      peace: { nation: n, frees },
    });
  }
  return out.sort((a, b) => b.peace!.frees - a.peace!.frees || (a.id < b.id ? -1 : 1));
}

function fromOperation(op: Operation): Plan {
  return {
    id: `op:${op.id}`,
    kind: 'operation',
    title: op.name,
    line: `~${plural(Math.max(1, op.turns), 'turn')} · ${ODDS_WORDS[op.odds]} · ${op.victoryPoints} VP`,
    why: op.why[0] ?? op.summary,
    cta: 'Launch',
    odds: op.odds,
    at: op.at,
    operation: op,
  };
}

/**
 * The turn's plans, best first: a city in danger, then the staff's operations, peace on a front
 * that only ties the army down, and the staff plan when it is off. The running operation is not
 * offered again; its next step is on the command card.
 */
export function proposePlans(view: NationView, opts: { operation?: { id: string } | null; staffPlan?: boolean; refused?: readonly NationId[]; max?: number } = {}): Plan[] {
  if (view.victory) return [];
  const max = opts.max ?? 4;
  const running = opts.operation?.id ?? null;
  const prize = running?.startsWith('take:') ? view.sites[running.slice(5)] : undefined;
  const ops = proposeOperations(view, 3)
    .filter((o) => o.id !== running)
    .map(fromOperation);
  const hold = holds(view);
  const urgent = hold.filter((h) => h.urgency >= 12).slice(0, 1);
  // Never peace with the power holding the prize the army is (or would be) marching on.
  const first = ops[0]?.operation;
  const focus = prize?.owner ?? (first ? (view.sites[first.target]?.owner ?? null) : null);
  const peace = peaces(view, focus).filter((p) => !opts.refused?.includes(p.peace!.nation));
  const plans: Plan[] = [...urgent, ...ops.slice(0, 1), ...peace.slice(0, 1), ...ops.slice(1), ...hold.filter((h) => !urgent.includes(h)).slice(0, 1)];
  if (opts.staffPlan === false)
    plans.push({ id: 'staff', kind: 'staff', title: 'Let the staff run the war', line: 'orders for every unit, every turn', why: 'Your generals draft every move; you change what you like and execute.', cta: 'Turn on' });
  const seen = new Set<string>();
  return plans
    .filter((p) => !seen.has(p.id) && !!seen.add(p.id))
    .slice(0, max)
    .map((p) => {
      const { urgency: _u, ...plan } = p as Plan & { urgency?: number };
      return plan;
    });
}

/** The next step of the running operation, in plain words. */
export function nextStep(view: NationView, operation: { id: string; kind: Operation['kind'] } | null): { op: Operation; text: string } | null {
  if (!operation) return null;
  const op = operationById(view, operation.id, operation.kind);
  if (!op) return null;
  const now = op.phases.find((p) => p.state === 'now');
  return { op, text: now ? `${now.title}: ${now.detail}` : `Assault ${op.name.replace('Take ', '')}.` };
}

const RANK: Record<Odds, number> = { good: 0, even: 1, bad: 2 };

export interface Fight extends PlannedBattle {
  odds: Odds | null;
  /** The place, short: "Taipei", "the hills". */
  place: string;
  victoryPoints: number;
}

/**
 * The battles that can be fought by hand this turn, best first: every attack in the draft on a hex
 * with enemies (`plannedBattles`) not fought yet, ranked by odds, then by what the place is worth.
 */
export function fightsFor(view: NationView, draft: Pick<NationOrders, 'formations' | 'battles' | 'play'>): Fight[] {
  return plannedBattles(view, draft)
    .filter((b) => !b.fought)
    .map((b) => {
      const attackers = Object.keys(b.orders)
        .map((id) => view.formations[id])
        .filter((f): f is NonNullable<typeof f> => !!f);
      const tile = view.tiles[b.target];
      const site = tile?.siteId ? view.sites[tile.siteId] : undefined;
      return { ...b, odds: oddsFor(view, attackers, b.target), place: site?.name ?? (tile?.terrain ? `the ${tile.terrain}` : 'the line'), victoryPoints: site?.victoryPoints ?? 0 };
    })
    .sort((a, b) => RANK[a.odds ?? 'bad'] - RANK[b.odds ?? 'bad'] || b.victoryPoints - a.victoryPoints || (a.target < b.target ? -1 : 1));
}

/** Dig-in orders for a hold plan: every listed ground unit still there. */
export function holdOrders(view: NationView, plan: NonNullable<Plan['hold']>): Record<FormationId, FormationOrder> {
  const out: Record<FormationId, FormationOrder> = {};
  for (const id of plan.formations) if (view.formations[id]) out[id] = { type: 'defend' };
  return out;
}

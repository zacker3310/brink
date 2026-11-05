import type { FacilityId, Formation, FormationId, GameEvent, Ledger, Nation, NationId, NationView, NationOrders, Resource, SiteKind, Stockpile, Treaty, WorldState, Yields } from '@brink/contracts';
import { RESOURCES } from '@brink/contracts';
import { FACILITIES, RESEARCH_BANK, RULES, TECHS, TREATIES, UNITS } from '@brink/game-data';
import { studyArtefact } from './blackfiles';
import { levelYields } from './progression';
import { clamp, fortressFloor, nationModifiers, pct, sortedKeys, zeroStockpile } from './rules';

export interface Settlement {
  income: Stockpile;
  upkeep: Stockpile;
  spending: Stockpile;
  industry: number;
  research: number;
}

/**
 * What the economy reads of a world: a `WorldState`, or a nation's own view of its sites, ground and
 * treaties with itself as the one nation (`balanceOf` builds that for the AI).
 */
export interface EconomyWorld {
  turn: number;
  nations: Record<NationId, Pick<Nation, 'government' | 'research' | 'edge' | 'stability'>>;
  sites: Record<string, { owner: NationId | null; kind: SiteKind; yields: Yields; facilities: readonly FacilityId[]; development?: number; population: number }>;
  tiles: Record<string, { owner: NationId | null } | undefined>;
  treaties: readonly Treaty[];
}

/** Gross income and throughput for a nation in the current world. Shared with the UI and the AI. */
export function grossYields(world: EconomyWorld, nation: NationId): { income: Stockpile; industry: number; research: number } {
  const n = world.nations[nation]!;
  const mods = nationModifiers(n);
  const income = zeroStockpile();
  let industry = 0;
  let research = 0;
  for (const id of sortedKeys(world.sites)) {
    const s = world.sites[id]!;
    if (s.owner !== nation) continue;
    const lv = levelYields(s);
    for (const r of RESOURCES) income[r] += s.yields[r] + lv[r];
    industry += s.yields.industry + lv.industry;
    research += s.yields.research + lv.research;
    for (const fac of s.facilities) {
      const y = FACILITIES[fac].yields;
      for (const r of RESOURCES) income[r] += y[r] ?? 0;
      industry += y.industry ?? 0;
      research += y.research ?? 0;
    }
  }
  // Trade agreements: a fixed income for each partner, before unrest.
  for (const t of world.treaties) {
    if (t.kind !== 'trade' || (t.a !== nation && t.b !== nation) || t.from > world.turn || t.until < world.turn) continue;
    for (const r of RESOURCES) income[r] += TREATIES.tradeIncome[r];
  }
  const hexes = Object.values(world.tiles).filter((t) => t?.owner === nation).length;
  income.credits += Math.floor(hexes / RULES.hexesPerCredit);
  const unrest = n.stability < 40 ? 80 : 100;
  for (const r of RESOURCES) income[r] = pct(pct(income[r], 100 + mods.income[r]), unrest);
  industry = pct(pct(industry, 100 + mods.industry), unrest);
  return { income, industry, research };
}

/**
 * Upkeep a nation owes a turn: its formations, its sites' facilities, food for its people and
 * energy for its industry. One reckoning for the economy phase and the AI's planning.
 */
export function upkeepOf(world: Pick<EconomyWorld, 'sites'>, nation: NationId, own: readonly Pick<Formation, 'unitClass'>[], industry: number): Stockpile {
  const due = zeroStockpile();
  for (const f of own) for (const r of RESOURCES) due[r] += UNITS[f.unitClass].upkeep[r];
  let population = 0;
  for (const id of sortedKeys(world.sites)) {
    const s = world.sites[id]!;
    if (s.owner !== nation) continue;
    population += s.population;
    for (const fac of s.facilities) for (const r of RESOURCES) due[r] += FACILITIES[fac].upkeep[r];
  }
  due.food += Math.floor(population / RULES.popPerFood);
  due.energy += Math.floor(industry / RULES.industryPerEnergy);
  return due;
}

/**
 * A nation's balance a turn, from its own view: gross income less the upkeep its army, buildings,
 * people and industry owe. Negative is a deficit the stockpile pays until it runs dry.
 */
export function balanceOf(view: Pick<NationView, 'self' | 'sites' | 'tiles' | 'treaties' | 'turn' | 'formations'>): Stockpile {
  const self = view.self.id;
  const world: EconomyWorld = { turn: view.turn, nations: { [self]: view.self }, sites: view.sites, tiles: view.tiles, treaties: view.treaties };
  const gross = grossYields(world, self);
  const own = sortedKeys(view.formations).map((id) => view.formations[id]!).filter((f) => f.owner === self);
  const due = upkeepOf(world, self, own, gross.industry);
  const out = zeroStockpile();
  for (const r of RESOURCES) out[r] = gross.income[r] - due[r];
  return out;
}

/**
 * Phase 10. Income arrives, upkeep is paid, then discretionary spending (budget shares and
 * reinforcement) from whatever is left. Stockpiles never go negative: unpaid upkeep is a
 * shortage with a stated penalty instead.
 */
export function settleEconomy(
  world: WorldState,
  nation: NationId,
  orders: NationOrders,
  engaged: ReadonlySet<FormationId>,
  moved: ReadonlySet<FormationId>,
  partial: { production: Stockpile; logistics: Stockpile },
  events: GameEvent[],
): Ledger {
  const n = world.nations[nation]!;
  if (orders.budget) n.budget = orders.budget;
  if (orders.research !== undefined) n.research.current = orders.research;
  const mods = nationModifiers(n);
  const gross = grossYields(world, nation);
  const own = sortedKeys(world.formations)
    .map((id) => world.formations[id]!)
    .filter((f) => f.owner === nation);
  const population = Object.values(world.sites)
    .filter((s) => s.owner === nation)
    .reduce((a, s) => a + s.population, 0);

  const upkeepDue = upkeepOf(world, nation, own, gross.industry);

  const income = gross.income;
  const upkeep = zeroStockpile();
  const shortages: Resource[] = [];
  for (const r of RESOURCES) {
    n.stockpile[r] += income[r];
    const paid = Math.min(upkeepDue[r], n.stockpile[r]);
    n.stockpile[r] -= paid;
    upkeep[r] = paid;
    if (paid < upkeepDue[r]) shortages.push(r);
  }

  const spending = zeroStockpile();
  const spend = (share: number) => {
    const amount = Math.min(pct(income.credits, share), n.stockpile.credits);
    n.stockpile.credits -= amount;
    spending.credits += amount;
    return amount;
  };
  const researchCredits = spend(n.budget.research);
  spend(n.budget.infrastructure);
  const welfareCredits = spend(n.budget.welfare);

  const research = pct(gross.research + Math.floor(researchCredits / 2), 100 + mods.research);
  n.researchOutput = research;
  n.research.progress += research;
  const current = n.research.current;
  if (current && TECHS[current] && n.research.progress >= TECHS[current].cost) {
    // A reverse-engineered project (Black Files) uses up an artefact at a black site as it finishes;
    // one that lost its artefact or its laboratory is dropped, its points banked.
    if (studyArtefact(world, nation, current)) {
      n.research.progress -= TECHS[current].cost;
      n.research.unlocked = [...n.research.unlocked, current].sort();
      events.push({ kind: 'research', nation, tech: current });
      if (TECHS[current].artefact) events.push({ kind: 'black_files', what: 'studied', nation, tech: current });
    }
    n.research.current = null;
  }
  if (!n.research.current) n.research.progress = Math.min(n.research.progress, RESEARCH_BANK);

  n.industrialCapacity = shortages.includes('energy') ? Math.floor(gross.industry / 2) : gross.industry;
  n.population = population;

  const lostSites = Object.values(world.sites).filter((s) => s.originalOwner === nation && s.owner !== nation).length;
  const target =
    RULES.baseStability +
    mods.stability +
    Math.min(20, Math.floor(welfareCredits / 3)) -
    Math.min(25, Math.floor(n.warLosses / 1000)) -
    lostSites * 5;
  n.stability = clamp(n.stability + Math.trunc((target - n.stability) / 4), 0, 100);
  if (shortages.includes('food')) n.stability = clamp(n.stability - 8, 0, 100);
  if (shortages.includes('credits')) n.stability = clamp(n.stability - 5, 0, 100);
  // Perfidy: tearing up a treaty this turn costs the declarer, in full.
  for (const e of events) {
    if (e.kind === 'diplomacy' && e.relation === 'war' && e.broke && e.proposedBy === nation) n.stability = clamp(n.stability - RULES.perfidy[e.broke], 0, 100);
  }

  const order = (id: FormationId) => orders.formations[id]?.type ?? 'hold';
  for (const f of own) {
    f.lastOrder = order(f.id);
    if (shortages.includes('food')) f.morale = clamp(f.morale - 5, 0, 100);
    if (shortages.includes('credits')) f.readiness = clamp(f.readiness - 5, 0, 100);
    if (!moved.has(f.id) && UNITS[f.unitClass].ground && !f.aboard) {
      f.entrenchment = clamp(f.entrenchment + (f.lastOrder === 'defend' ? 20 : 10), 0, 100);
    }
    f.entrenchment = Math.max(f.entrenchment, fortressFloor(world, f));
    if (engaged.has(f.id)) continue;
    f.organization = clamp(f.organization + 5 + Math.floor(f.supply / 10), 0, 100);
    f.morale = clamp(f.morale + Math.sign(70 - f.morale) * Math.min(3, Math.abs(70 - f.morale)), 0, 100);
    const home = world.tiles[f.key]?.owner === nation;
    if (home && f.supply >= 80 && f.strength < 1000) {
      const gain = Math.min(RULES.reinforcement, 1000 - f.strength);
      const cost = Math.ceil(gain / 5) * RULES.reinforcementMaterialsPer5;
      if (n.stockpile.materials >= cost) {
        n.stockpile.materials -= cost;
        spending.materials += cost;
        f.strength += gain;
      }
    }
  }

  for (const r of RESOURCES) if (n.stockpile[r] < 0) throw new Error(`negative ${r} for ${nation}`);
  const ledger: Ledger = {
    income,
    upkeep,
    production: partial.production,
    logistics: partial.logistics,
    spending,
    shortages,
    industry: n.industrialCapacity,
    research,
  };
  events.push({ kind: 'economy', nation, ledger });
  return ledger;
}

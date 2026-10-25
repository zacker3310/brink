import type { Formation, NationId, Terrain } from '@brink/contracts';
import { RIVER_ASSAULT_PENALTY, RULES, TERRAIN, UNITS } from '@brink/game-data';
import { clamp, pct, type FullModifiers } from './rules';

// Combat power is integer fixed-point: stat x strength (0..1000) with each modifier applied as
// a whole percentage, then divided by 100. A full-strength formation lands around 200..600.

/** Readiness, organization, morale, supply, ammunition and experience, applied in turn. */
function condition(f: Formation, value: number): number {
  const def = UNITS[f.unitClass];
  let v = pct(value, 50 + Math.floor(f.readiness / 2));
  v = pct(v, 50 + Math.floor(f.organization / 2));
  v = pct(v, 75 + Math.floor(f.morale / 4));
  v = pct(v, 60 + Math.floor((f.supply * 2) / 5));
  if (f.ammunition < def.ammoPerAttack) v = pct(v, 50);
  v = pct(v, 100 + Math.floor(f.experience / 5));
  return v;
}

function weightedHardness(targets: readonly Formation[]): number {
  const total = targets.reduce((a, f) => a + f.strength, 0);
  if (total === 0) return 0;
  return Math.floor(targets.reduce((a, f) => a + UNITS[f.unitClass].hardness * f.strength, 0) / total);
}

/** Attack stat against a mix of targets: soft attack against soft share, hard against hard. */
function attackStat(f: Formation, hardness: number): number {
  const def = UNITS[f.unitClass];
  return Math.floor((def.softAttack * (100 - hardness) + def.hardAttack * hardness) / 100);
}

export interface AssaultContext {
  terrain: Terrain;
  river: boolean;
  tileOwner: NationId | null;
  /** The attacker can see what it is attacking (detected, or a recon formation is in the group). */
  spotted: boolean;
  /** Own air struck the hex this turn. */
  airSupport: boolean;
  /** Own artillery struck the hex this turn. */
  artillerySupport: boolean;
  attackerMods: FullModifiers;
  defenderMods: (owner: NationId) => FullModifiers;
  /** Formations under a defend order. */
  defending: (id: string) => boolean;
}

export interface Power {
  attack: number;
  defense: number;
}

export function attackerPower(attackers: readonly Formation[], defenders: readonly Formation[], ctx: AssaultContext): number {
  const hardness = weightedHardness(defenders);
  const classes = new Set(attackers.map((a) => a.unitClass)).size;
  const terrain = TERRAIN[ctx.terrain];
  let total = 0;
  for (const a of attackers) {
    let v = condition(a, attackStat(a, hardness) * a.strength);
    v = pct(v, 100 + ctx.attackerMods.attack);
    if (a.unitClass === 'armor' || a.unitClass === 'mechanized') v = pct(v, 100 - terrain.armorPenalty);
    total += v;
  }
  if (ctx.river) total = pct(total, 100 - RIVER_ASSAULT_PENALTY);
  if (!ctx.spotted) total = pct(total, 80);
  if (ctx.airSupport) total = pct(total, 115);
  if (ctx.artillerySupport) total = pct(total, 110);
  const arms = Math.min(30 + ctx.attackerMods.combinedArms * 2, (classes - 1) * (10 + ctx.attackerMods.combinedArms));
  total = pct(total, 100 + arms);
  return Math.floor(total / 100);
}

export function defenderPower(defenders: readonly Formation[], ctx: AssaultContext): number {
  const terrain = TERRAIN[ctx.terrain];
  let total = 0;
  for (const d of defenders) {
    const def = UNITS[d.unitClass];
    const mods = ctx.defenderMods(d.owner);
    let v = condition(d, def.defense * d.strength);
    // Infantry makes the most of cover; armor makes the least.
    const cover = d.unitClass === 'infantry' ? pct(terrain.defense, 150) : d.unitClass === 'armor' ? pct(terrain.defense, 50) : terrain.defense;
    v = pct(v, 100 + cover);
    v = pct(v, 100 + Math.floor(d.entrenchment / 2));
    if (ctx.defending(d.id)) v = pct(v, 120);
    if (ctx.tileOwner === d.owner) v = pct(v, 100 + mods.homeDefense);
    if (d.unitClass === 'armor' || d.unitClass === 'mechanized') v = pct(v, 100 + mods.armorDefense);
    total += v;
  }
  return Math.floor(total / 100);
}

export interface LossOutcome {
  /** Attacker share of combat power, permille. */
  share: number;
  attackerLoss: number;
  defenderLoss: number;
}

/** Total strength lost by each side, before it is spread across formations. */
export function assaultLosses(power: Power, attackerSwing: number, defenderSwing: number): LossOutcome {
  const sum = power.attack + power.defense;
  const share = sum === 0 ? 500 : Math.floor((power.attack * 1000) / sum);
  const defenderLoss = Math.floor((power.attack * RULES.defenderLethality * share * defenderSwing) / (1000 * 10 * 100));
  const attackerLoss = Math.floor((power.defense * RULES.attackerLethality * (1000 - share) * attackerSwing) / (1000 * 10 * 100));
  return { share, attackerLoss, defenderLoss };
}

/** Spread a side's loss across its formations in proportion to strength. */
export function spreadLoss(side: readonly Formation[], loss: number): Map<string, number> {
  const total = side.reduce((a, f) => a + f.strength, 0);
  const out = new Map<string, number>();
  for (const f of side) out.set(f.id, total === 0 ? 0 : Math.min(f.strength, Math.floor((loss * f.strength) / total)));
  return out;
}

export type AssaultOutcome = 'attacker_victory' | 'defender_held' | 'inconclusive';

export function assaultOutcome(share: number, defendersBroken: boolean): AssaultOutcome {
  if (share >= RULES.breakthrough || defendersBroken) return 'attacker_victory';
  if (share <= RULES.repulse) return 'defender_held';
  return 'inconclusive';
}

export interface StrikeContext {
  terrain: Terrain;
  spotted: boolean;
  sourceMods: FullModifiers;
}

/** Strength one ranged strike takes off one victim. */
export function strikeLoss(source: Formation, victim: Formation, ctx: StrikeContext, swing: number): number {
  const hardness = UNITS[victim.unitClass].hardness;
  let v = condition(source, attackStat(source, hardness) * source.strength);
  v = pct(v, 100 + ctx.sourceMods.ranged);
  if (!ctx.spotted) v = pct(v, 50);
  v = Math.floor((v * 100) / (100 + TERRAIN[ctx.terrain].defense));
  v = pct(v, 100 - Math.floor(victim.entrenchment / 2));
  v = pct(v, swing);
  return clamp(Math.floor((v * 2) / 1000), 0, victim.strength);
}

/** What anti-air fire from the victims costs an air formation. */
export function airDefenseLoss(victims: readonly Formation[], swing: number): number {
  let v = 0;
  for (const d of victims) {
    if (!UNITS[d.unitClass].ground) continue;
    v += Math.floor((UNITS[d.unitClass].defense * d.strength) / 1000 / 4);
  }
  return pct(v, swing);
}

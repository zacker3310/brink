import type { Formation, FormationId, HexKey, NationView } from '@brink/contracts';
import { RULES, UNITS } from '@brink/game-data';
import {
  assaultLosses,
  assaultOutcome,
  attackerPower,
  defenderPower,
  strikeLoss,
  type AssaultContext,
  type AssaultOutcome,
} from './combat';
import { nationModifiers } from './rules';

export type Confidence = 'confirmed' | 'estimated' | 'blind';

export interface AssaultPreview {
  confidence: Confidence;
  defenders: number;
  /** Attacker share of combat power, permille, low..high. */
  share: [number, number];
  attackerLoss: [number, number];
  defenderLoss: [number, number];
  /** Every outcome the range of estimates allows, most favourable to the attacker first. */
  outcomes: AssaultOutcome[];
}

export interface StrikePreview {
  confidence: Confidence;
  targets: number;
  /** Strength lost per target, low..high. */
  loss: [number, number];
}

/**
 * Enemy formations at `key` as the viewer believes them to be: last-known strength widened by
 * how stale the sighting is, and typical values for what can never be observed.
 */
function believedDefenders(view: NationView, key: HexKey, widen: number): { low: Formation[]; high: Formation[]; confidence: Confidence } {
  const contacts = Object.values(view.contacts)
    .filter((c) => c.key === key && view.relations[c.owner] === 'war')
    .sort((a, b) => (a.formation < b.formation ? -1 : 1));
  const tile = view.tiles[key];
  const confidence: Confidence =
    contacts.length === 0 ? 'blind' : contacts.every((c) => c.confirmed) && tile?.visibility === 'visible' ? 'confirmed' : 'estimated';
  const spread = confidence === 'confirmed' ? 10 : 30 + widen;
  const make = (c: (typeof contacts)[number], strength: number): Formation => ({
    id: c.formation,
    name: '',
    owner: c.owner,
    unitClass: c.unitClass,
    key,
    strength: Math.max(1, Math.min(1000, strength)),
    organization: 70,
    morale: 70,
    readiness: 80,
    fuel: 100,
    ammunition: 100,
    experience: 5,
    entrenchment: 20,
    supplyPriority: 'normal',
    supply: 80,
    lastOrder: 'hold',
  });
  return {
    low: contacts.map((c) => make(c, Math.floor((c.estimatedStrength * (100 - spread)) / 100))),
    high: contacts.map((c) => make(c, Math.ceil((c.estimatedStrength * (100 + spread)) / 100))),
    confidence,
  };
}

function enemyMods(view: NationView, owner: string) {
  const n = view.nations[owner];
  return nationModifiers({ government: n?.government ?? 'union', research: { current: null, progress: 0, unlocked: [] } });
}

/** An estimate, never a promise: hidden organization, entrenchment and dice are all ranges. */
export function previewAssault(view: NationView, attackerIds: readonly FormationId[], target: HexKey): AssaultPreview | null {
  const attackers = attackerIds.map((id) => view.formations[id]).filter((f): f is Formation => !!f);
  if (attackers.length === 0) return null;
  const staleness = Math.max(0, ...Object.values(view.contacts).filter((c) => c.key === target).map((c) => view.turn - c.lastSeen));
  const believed = believedDefenders(view, target, staleness * 10);
  const tile = view.tiles[target];
  const ctx: AssaultContext = {
    terrain: tile?.terrain ?? 'plains',
    river: tile?.river ?? false,
    tileOwner: tile?.owner ?? null,
    spotted: believed.confidence === 'confirmed' || attackers.some((a) => a.unitClass === 'recon'),
    airSupport: false,
    artillerySupport: false,
    attackerMods: nationModifiers(view.self),
    defenderMods: (owner) => enemyMods(view, owner),
    defending: () => false,
  };
  if (believed.low.length === 0) {
    return { confidence: 'blind', defenders: 0, share: [1000, 1000], attackerLoss: [0, 0], defenderLoss: [0, 0], outcomes: ['attacker_victory'] };
  }
  const lo = 100 - RULES.combatSwing;
  const hi = 100 + RULES.combatSwing;
  // Best case: weakest defenders, kind dice. Worst case: strongest defenders, unkind dice.
  const best = assaultLosses(
    { attack: attackerPower(attackers, believed.low, ctx), defense: defenderPower(believed.low, ctx) },
    lo,
    hi,
  );
  const worst = assaultLosses(
    { attack: attackerPower(attackers, believed.high, ctx), defense: defenderPower(believed.high, ctx) },
    hi,
    lo,
  );
  const outcomes = [...new Set([assaultOutcome(best.share, false), assaultOutcome(Math.floor((best.share + worst.share) / 2), false), assaultOutcome(worst.share, false)])];
  return {
    confidence: believed.confidence,
    defenders: believed.low.length,
    share: [worst.share, best.share],
    attackerLoss: [best.attackerLoss, worst.attackerLoss],
    defenderLoss: [worst.defenderLoss, best.defenderLoss],
    outcomes,
  };
}

export function previewStrike(view: NationView, sourceId: FormationId, target: HexKey): StrikePreview | null {
  const source = view.formations[sourceId];
  if (!source || UNITS[source.unitClass].range === 0) return null;
  const believed = believedDefenders(view, target, 0);
  if (believed.low.length === 0) return { confidence: 'blind', targets: 0, loss: [0, 0] };
  const ctx = {
    terrain: view.tiles[target]?.terrain ?? 'plains',
    spotted: view.tiles[target]?.visibility === 'visible' && believed.confidence === 'confirmed',
    sourceMods: nationModifiers(view.self),
  };
  const losses = believed.high.flatMap((v) => [strikeLoss(source, v, ctx, 100 - RULES.combatSwing), strikeLoss(source, v, ctx, 100 + RULES.combatSwing)]);
  return { confidence: believed.confidence, targets: believed.low.length, loss: [Math.min(...losses), Math.max(...losses)] };
}

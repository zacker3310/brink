import type { UnitClass } from '@brink/contracts';
import { isAircraft, isFoot, SUPPORT, TYPES } from './roster';
import { battleSkill, difficultyDef, FEWEST_ENEMIES, RANKS, rankFromSkill } from './rules';
import { FACTION_OF, type Arsenal, type ArenaSetup, type Faction, type Side, type SupportAsset, type TypeId, type UnitSpec, type UnitType } from './types';

// The force builder: each war-map formation in the battle becomes a detachment, and together they make
// a company of 10 to 16 units a side (docs/arena-v2.md section 5).
//
// Count: clamp(round(4 + 3.5 x total strength / 1000 + 1.5 x formations), 10, 16), over the formations
// built from templates. Shares by strength (largest remainder), every formation at least 2 when the count
// allows. A formation fills its share by cycling its class template; a carrier with a squad is two units
// and the squad starts inside it, shrunk to the seats. When one place is left for a pair, a fighting
// carrier comes alone and a transport helicopter's squad comes on foot.
//
// Attachments: at most 30% of the count, and never so many that a formation drops under 2, so the
// formations keep at least 70%. Starting from that cap a and counting down, share n - a among the
// formations and list what the company still lacks, in order (medic team; air defence when the other side
// fields aircraft; engineers for a city, capital, objective or river; a recovery vehicle with 3 or more
// heavy vehicles; a sniper team); the first a that qualify fill the rest. Attachments are dealt to the
// formations strongest first.
//
// Explicit `types` on a spec (skirmishes) are used exactly, outside the count; a squad listed right after
// a carrier with seats starts inside it. A side with only explicit specs gets no attachments.
//
// Difficulty: an easier battle scales the defenders' count (DIFFICULTY.enemyUnits), never under
// FEWEST_ENEMIES. A template company shrinks before the shares are dealt; an explicit list loses
// units spread from its back, where the support sits.

export interface UnitSeed {
  /** Unique in the battle and stable: `${formation}:${n}`, n from 1. */
  id: string;
  type: TypeId;
  /** War-map formation id (skirmish detachment id). */
  formation: string;
  /** "Abrams 2", "1st Squad", "Javelin Team". */
  name: string;
  /** 0 Recruit .. 3 Ace. */
  rank: number;
  /** Foot units: fit soldiers at the start (thinned by strength, shrunk to the carrier's seats). */
  men?: number;
  /** The seed id of the carrier it starts inside. */
  carrier?: string;
}

export interface ForceSeeds {
  units: UnitSeed[];
  support: { id: SupportAsset['id']; missions: number }[];
}

/** One template entry: a type, or a choice the formation's id settles, with an optional squad inside. */
export interface TemplateSlot {
  pick: readonly TypeId[];
  squad?: TypeId;
}

const one = (t: TypeId, squad?: TypeId): TemplateSlot => (squad ? { pick: [t], squad } : { pick: [t] });
const either = (a: TypeId, b: TypeId, squad?: TypeId): TemplateSlot => (squad ? { pick: [a, b], squad } : { pick: [a, b] });
const times = (n: number, s: TemplateSlot): TemplateSlot[] => Array.from({ length: n }, () => s);

/** Each class's template per arsenal, cycled in order (section 5). */
export const TEMPLATES: Record<Arsenal, Record<UnitClass, readonly TemplateSlot[]>> = {
  us: {
    armor: [...times(4, one('m1a2')), one('m88')],
    mechanized: times(3, either('m2a3', 'stryker', 'squad_w')),
    infantry: [...times(3, one('squad_w')), one('javelin'), one('sniper_w'), one('mortar_w'), one('gustaf')],
    recon: [one('m10'), one('m1134'), one('raven'), one('sniper_w')],
    artillery: [one('paladin'), one('paladin'), one('mortar_w')],
    air: [one('ah64e'), one('ah64e'), one('ah6'), one('uh60', 'squad_w')],
    drone: [one('raven'), one('fpv_w'), one('fpv_w'), one('switchblade')],
  },
  europe: {
    armor: [...times(4, either('leo2a7', 'cr3')), one('m88')],
    mechanized: times(3, one('cv90', 'squad_w')),
    infantry: [...times(3, one('squad_w')), one('gustaf'), one('javelin'), one('sniper_w'), one('mortar_w')],
    recon: [one('cv90'), one('raven'), one('m1134'), one('sniper_w')],
    artillery: [one('paladin'), one('paladin'), one('mortar_w')],
    air: [one('ah64e'), one('ah6'), one('uh60', 'squad_w')],
    drone: [one('raven'), one('fpv_w'), one('fpv_w'), one('switchblade')],
  },
  russia: {
    armor: [...times(4, either('t90m', 't80bvm')), one('brem')],
    mechanized: times(3, one('bmp3', 'squad_e')),
    infantry: [...times(3, one('squad_e')), one('kornet'), one('rpg'), one('sniper_e'), one('mortar_e')],
    recon: [one('sprut'), one('kornetd'), one('orlan'), one('sniper_e')],
    artillery: [one('msta'), one('msta'), one('mortar_e')],
    air: [one('ka52'), one('ka52'), one('mi8', 'squad_e')],
    drone: [one('orlan'), one('fpv_e'), one('fpv_e'), one('lancet')],
  },
  legacy: {
    armor: [...times(4, either('t72b3', 't80bvm')), one('brem')],
    mechanized: times(3, one('bmp3', 'squad_e')),
    infantry: [...times(3, one('squad_e')), one('rpg'), one('kornet'), one('mortar_e'), one('sniper_e')],
    recon: [one('kornetd'), one('orlan'), one('sprut'), one('sniper_e')],
    artillery: [one('msta'), one('msta'), one('mortar_e')],
    air: [one('mi35', 'squad_e'), one('mi35'), one('mi8', 'squad_e')],
    drone: [one('orlan'), one('fpv_e'), one('fpv_e'), one('lancet')],
  },
};

const AIR_DEFENCE: Record<Arsenal, TypeId> = { us: 'stinger', europe: 'gepard', russia: 'tunguska', legacy: 'igla' };
const MEDIC: Record<Faction, TypeId> = { west: 'medic_w', east: 'medic_e' };
const ENGINEER: Record<Faction, TypeId> = { west: 'engineer_w', east: 'engineer_e' };
const RECOVERY: Record<Faction, TypeId> = { west: 'm88', east: 'brem' };
const SNIPER: Record<Faction, TypeId> = { west: 'sniper_w', east: 'sniper_e' };
const SUPPORT_OF: Record<Faction, SupportAsset['id']> = { west: 'himars', east: 'tornado' };
/** Units that ride in a carrier listed just before them. */
const SQUAD_ROLES: ReadonlySet<UnitType['role']> = new Set(['rifle_squad', 'fireteam', 'engineer']);

/** Strength as an integer 0..1000. */
const strengthOf = (s: UnitSpec) => Math.max(0, Math.min(1000, Math.round(Number.isFinite(s.strength) ? s.strength : 0)));

/** Units a side's template-built formations make, before explicit lists. */
export function companySize(specs: readonly UnitSpec[]): number {
  const strength = specs.reduce((sum, s) => sum + strengthOf(s), 0);
  // In ten-thousandths, so the rounding is exact: 4 + 3.5 x strength / 1000 + 1.5 x formations.
  const n = Math.round((40000 + 35 * strength + 15000 * specs.length) / 10000);
  return Math.max(10, Math.min(16, n));
}

/** A count scaled by the difficulty: never under FEWEST_ENEMIES, never over what it was. */
function scaled(n: number, k: number): number {
  return k >= 1 ? n : Math.min(n, Math.max(FEWEST_ENEMIES, Math.round(n * k)));
}

/** Explicit lists cut to the difficulty's share, one about every 1 / (1 - k) counting from the back. */
function thinLists(lists: readonly (readonly TypeId[] | undefined)[], k: number): (readonly TypeId[] | undefined)[] {
  const total = lists.reduce((sum, l) => sum + (l?.length ?? 0), 0);
  const drops = total - scaled(total, k);
  if (drops <= 0) return [...lists];
  const gone = new Set<number>();
  for (let j = 0; j < drops; j++) gone.add(total - 1 - Math.floor((j * total) / drops));
  let i = 0;
  return lists.map((l) => l?.filter(() => !gone.has(i++)));
}

/** FNV-1a: a stable hash of a formation id, to settle its template choices. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

/** Largest-remainder shares of `total` by integer weights; each at least 2 (or 1) when the total allows. */
function shares(total: number, weights: readonly number[]): number[] {
  const f = weights.length;
  if (!f) return [];
  const sum = weights.reduce((a, b) => a + b, 0);
  const w = sum > 0 ? weights : weights.map(() => 1);
  const whole = sum > 0 ? sum : f;
  const out = w.map((x) => Math.floor((total * x) / whole));
  const rem = w.map((x) => (total * x) % whole);
  let left = total - out.reduce((a, b) => a + b, 0);
  const order = w.map((_, i) => i).sort((a, b) => rem[b]! - rem[a]! || w[b]! - w[a]! || a - b);
  for (const i of order) {
    if (left <= 0) break;
    out[i] = out[i]! + 1;
    left--;
  }
  const min = total >= 2 * f ? 2 : total >= f ? 1 : 0;
  for (let i = 0; i < f; i++)
    while (out[i]! < min) {
      // Take from the largest share above the floor; on a tie, from the weaker formation.
      let j = -1;
      for (let k = 0; k < f; k++) if (k !== i && out[k]! > min && (j < 0 || out[k]! > out[j]! || (out[k] === out[j] && w[k]! < w[j]!))) j = k;
      if (j < 0) break;
      out[j] = out[j]! - 1;
      out[i] = out[i]! + 1;
    }
  return out;
}

interface Item {
  type: TypeId;
  /** Rides in the item before it. */
  inside: boolean;
}

/** A formation's share from its class template, cycled. */
function fill(slots: readonly TemplateSlot[], share: number, formation: string): Item[] {
  const out: Item[] = [];
  if (!slots.length) return out;
  const choice = hash(formation);
  for (let i = 0; out.length < share; i++) {
    const slot = slots[i % slots.length]!;
    const type = slot.pick[choice % slot.pick.length]!;
    if (!slot.squad) out.push({ type, inside: false });
    else if (share - out.length >= 2) out.push({ type, inside: false }, { type: slot.squad, inside: true });
    else out.push({ type: TYPES[type].role === 'transport_heli' ? slot.squad : type, inside: false });
  }
  return out;
}

/** A skirmish's exact list; a squad right after a carrier with seats starts inside it. */
function explicit(types: readonly TypeId[]): Item[] {
  const out: Item[] = [];
  for (const type of types) {
    const prev = out[out.length - 1];
    const inside = !!prev && !prev.inside && TYPES[prev.type].seats > 0 && SQUAD_ROLES.has(TYPES[type].role);
    out.push({ type, inside });
  }
  return out;
}

const heavy = (t: UnitType) => t.mobility === 'tracked' && t.armour !== null && t.value >= 6;

const ordinal = (n: number): string => {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  return `${n}${teen ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')}`;
};

/** Radio names: "Abrams 2", "1st Squad", "Javelin Team" (numbered when there are more than one). */
function nameAll(seeds: UnitSeed[]): void {
  const total = new Map<TypeId, number>();
  for (const s of seeds) total.set(s.type, (total.get(s.type) ?? 0) + 1);
  const seen = new Map<TypeId, number>();
  const byRole = new Map<string, number>();
  for (const s of seeds) {
    const t = TYPES[s.type];
    const k = (seen.get(s.type) ?? 0) + 1;
    seen.set(s.type, k);
    if (t.role === 'rifle_squad' || t.role === 'fireteam') {
      const r = (byRole.get(t.role) ?? 0) + 1;
      byRole.set(t.role, r);
      s.name = `${ordinal(r)} ${t.role === 'rifle_squad' ? 'Squad' : 'Fireteam'}`;
    } else if (isFoot(t)) {
      const base = t.role === 'engineer' ? t.short : `${t.short} Team`;
      s.name = (total.get(s.type) ?? 0) > 1 ? `${base} ${k}` : base;
    } else s.name = `${t.short} ${k}`;
  }
}

/** The units and off-map support one side brings: blue is `setup.attackers` with `setup.arsenal.blue`. */
export function buildForce(setup: ArenaSetup, side: Side): ForceSeeds {
  const foe: Side = side === 'blue' ? 'red' : 'blue';
  const specs = side === 'blue' ? setup.attackers : setup.defenders;
  const foes = side === 'blue' ? setup.defenders : setup.attackers;
  const arsenal = setup.arsenal[side];
  const faction = FACTION_OF[arsenal];
  const k = side === 'red' ? difficultyDef(setup.difficulty).enemyUnits : 1;
  const lists = thinLists(specs.map((s) => s.types), k);
  const items: Item[][] = lists.map((l) => (l ? explicit(l) : []));
  const built = specs.map((s, i) => ({ s, i })).filter(({ s }) => !s.types);
  const attach: { type: TypeId; to: number }[] = [];

  if (built.length) {
    const n = scaled(companySize(built.map(({ s }) => s)), k);
    const maxA = Math.min(Math.floor((n * 3) / 10), Math.max(0, n - 2 * built.length));
    const weights = built.map(({ s }) => strengthOf(s));
    const foeArsenal = setup.arsenal[foe];
    const foeAir = foes.some((s) =>
      (s.types ?? TEMPLATES[foeArsenal][s.cls].flatMap((slot) => (slot.squad ? [...slot.pick, slot.squad] : [...slot.pick]))).some((t) => isAircraft(TYPES[t])),
    );
    const engineers = setup.river || setup.site === 'city' || setup.site === 'capital' || setup.site === 'objective';
    for (let a = maxA; a >= 0; a--) {
      const share = shares(n - a, weights);
      const formed = built.map(({ s }, k) => fill(TEMPLATES[arsenal][s.cls], share[k]!, s.id));
      const types = [...items, ...formed].flat().map((it) => TYPES[it.type]);
      const lacks = (p: (t: UnitType) => boolean) => !types.some(p);
      const wanted: TypeId[] = [];
      if (lacks((t) => t.treat === true)) wanted.push(MEDIC[faction]);
      if (foeAir && lacks((t) => t.role === 'spaa' || t.role === 'aa_team')) wanted.push(AIR_DEFENCE[arsenal]);
      if (engineers && lacks((t) => t.engineer === true)) wanted.push(ENGINEER[faction]);
      if (types.filter(heavy).length >= 3 && lacks((t) => t.repair === true)) wanted.push(RECOVERY[faction]);
      if (lacks((t) => t.role === 'sniper')) wanted.push(SNIPER[faction]);
      if (wanted.length < a) continue;
      built.forEach(({ i }, k) => (items[i] = formed[k]!));
      // Deal the attachments round the formations, strongest first.
      const deal = built.map((b, k) => ({ ...b, w: weights[k]! })).sort((x, y) => y.w - x.w || x.i - y.i);
      wanted.slice(0, a).forEach((type, k) => attach.push({ type, to: deal[k % deal.length]!.i }));
      break;
    }
  }

  const rank = (s: UnitSpec) => {
    const r = side === 'blue' ? s.rank : Math.max(s.rank, rankFromSkill(battleSkill(setup.skill, setup.difficulty)));
    return Math.max(0, Math.min(RANKS.length - 1, Math.floor(Number.isFinite(r) ? r : 0)));
  };
  const units: UnitSeed[] = [];
  const counter = new Map<string, number>();
  const add = (s: UnitSpec, it: Item, carrier: UnitSeed | undefined): UnitSeed => {
    const n = (counter.get(s.id) ?? 0) + 1;
    counter.set(s.id, n);
    const t = TYPES[it.type];
    const seed: UnitSeed = { id: `${s.id}:${n}`, type: it.type, formation: s.id, name: '', rank: rank(s) };
    if (isFoot(t)) {
      const full = t.men?.length ?? 0;
      let men = Math.min(full, Math.max(2, Math.round((full * strengthOf(s)) / 1000)));
      if (it.inside && carrier) {
        men = Math.min(men, TYPES[carrier.type].seats);
        seed.carrier = carrier.id;
      }
      seed.men = men;
    }
    units.push(seed);
    return seed;
  };
  specs.forEach((s, i) => {
    let carrier: UnitSeed | undefined;
    for (const it of items[i]!) {
      const seed = add(s, it, carrier);
      if (!it.inside) carrier = seed;
    }
  });
  for (const { type, to } of attach) add(specs[to]!, { type, inside: false }, undefined);
  nameAll(units);

  const guns = specs.filter((s) => s.cls === 'artillery').length;
  const id = SUPPORT_OF[faction];
  return { units, support: guns ? [{ id, missions: guns * SUPPORT[id].missions }] : [] };
}

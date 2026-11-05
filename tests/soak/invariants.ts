import type { WorldState } from '@brink/contracts';
import { RESOURCES } from '@brink/contracts';
import { CARDS, CITY_GROWTH, COMMANDER_RULES, DOCTRINE, FACILITY_SLOTS, LEVEL_SLOT_AT, levelForXp, STACK_LIMIT, TECHS, UNITS } from '@brink/game-data';
import { handSizeOf } from '@brink/simulation';

// The invariants every soak checks between turns, whatever the theatre (soak.test.ts, mideast.soak.test.ts).

/** Every invariant a world must satisfy between turns. Returns the broken ones. */
export function invariants(w: WorldState): string[] {
  const bad: string[] = [];
  for (const n of Object.values(w.nations)) {
    for (const r of RESOURCES) if (!Number.isInteger(n.stockpile[r]) || n.stockpile[r] < 0) bad.push(`${n.id} ${r}=${n.stockpile[r]}`);
    if (n.stability < 0 || n.stability > 100) bad.push(`${n.id} stability ${n.stability}`);
    // Doctrine: integer Command Points within the cap, a hand never over its size, every card known.
    const d = n.doctrine;
    if (d) {
      if (!Number.isInteger(d.cp) || d.cp < 0 || d.cp > DOCTRINE.cpCap) bad.push(`${n.id} cp ${d.cp}`);
      // Ruleset 2.6: Staff College adds a card, so the bound is the nation's own hand size.
      if (d.hand.length > handSizeOf(n)) bad.push(`${n.id} holds ${d.hand.length} cards`);
      for (const c of [...d.hand, ...d.deck, ...d.discard, ...d.effects.map((e) => e.card)]) if (!CARDS[c]) bad.push(`${n.id} unknown card ${c}`);
      if (d.effects.some((e) => e.until < e.from)) bad.push(`${n.id} malformed card effect`);
    } else if (!n.minor && !n.eliminated) bad.push(`${n.id} has no doctrine`);
  }
  const perHex = new Map<string, string[]>();
  const stacked = new Map<string, number>();
  for (const f of Object.values(w.formations)) {
    if (!w.tiles[f.key]) bad.push(`${f.id} off map`);
    if (w.nations[f.owner]?.eliminated) bad.push(`${f.id} belongs to an eliminated nation`);
    for (const v of [f.organization, f.morale, f.readiness, f.fuel, f.ammunition, f.experience, f.entrenchment, f.supply]) {
      if (!Number.isInteger(v) || v < 0 || v > 100) bad.push(`${f.id} stat out of range`);
    }
    if (f.strength <= 0 || f.strength > 1000) bad.push(`${f.id} strength ${f.strength}`);
    // At sea: ships, and whoever rides in one, in that ship's own hex. Nothing else.
    if (w.tiles[f.key]?.terrain === 'water' && !UNITS[f.unitClass].naval && !f.aboard) bad.push(`${f.id} in water`);
    if (f.aboard && (!w.formations[f.aboard] || w.formations[f.aboard]!.key !== f.key)) bad.push(`${f.id} aboard a ship that is not there`);
    if (f.aboard && UNITS[w.formations[f.aboard]?.unitClass ?? 'infantry'].carries !== (UNITS[f.unitClass].ground ? 'ground' : 'air')) bad.push(`${f.id} aboard the wrong kind of ship`);
    perHex.set(f.key, [...(perHex.get(f.key) ?? []), f.owner]);
    // Two stacking layers: ships, and everything else.
    if (!f.aboard) stacked.set(`${f.key}|${UNITS[f.unitClass].naval ? 'sea' : 'land'}`, (stacked.get(`${f.key}|${UNITS[f.unitClass].naval ? 'sea' : 'land'}`) ?? 0) + 1);
  }
  for (const c of Object.values(w.formations)) {
    const n = Object.values(w.formations).filter((f) => f.aboard === c.id).length;
    if (n > (UNITS[c.unitClass].capacity ?? 0)) bad.push(`${c.id} carries ${n}`);
  }
  for (const [key, owners] of perHex) {
    const distinct = new Set(owners);
    for (const a of distinct) for (const b of distinct) {
      if (a < b && w.relations[`${a}|${b}`] === 'war') bad.push(`enemies ${a} and ${b} share ${key}`);
    }
    // Passengers ride free; what stands in the hex is held to the limit.
    for (const layer of ['sea', 'land']) if ((stacked.get(`${key}|${layer}`) ?? 0) > STACK_LIMIT) bad.push(`${stacked.get(`${key}|${layer}`)} ${layer} formations in ${key}`);
  }
  for (const s of Object.values(w.sites)) if (w.tiles[s.key]!.owner !== s.owner) bad.push(`site ${s.id} owner differs from its hex`);
  for (const s of Object.values(w.sites)) {
    // Ruleset 2.6: a city's level opens more slots, and a city taken keeps its buildings though it
    // loses half its development, so the bound is the most a site of its kind can ever hold.
    if (s.facilities.length > FACILITY_SLOTS[s.kind] + LEVEL_SLOT_AT.length || new Set(s.facilities).size !== s.facilities.length) bad.push(`site ${s.id} facilities ${s.facilities.join(',')}`);
    const dev = s.development ?? 0;
    if (!Number.isInteger(dev) || dev < 0 || dev > CITY_GROWTH.max) bad.push(`site ${s.id} development ${dev}`);
  }
  for (const n of Object.values(w.nations)) {
    for (const t of n.research.unlocked) if (!TECHS[t] || TECHS[t]!.requires.some((p) => !n.research.unlocked.includes(p))) bad.push(`${n.id} has ${t} without its prerequisites`);
  }
  for (const t of w.treaties) {
    if (!(t.a < t.b) || t.until < t.from) bad.push(`malformed treaty ${JSON.stringify(t)}`);
    if (t.kind !== 'embargo' && t.until >= w.turn && w.relations[`${t.a}|${t.b}`] === 'war') bad.push(`${t.kind} between ${t.a} and ${t.b} at war`);
  }
  const led = new Set<string>();
  for (const c of Object.values(w.commanders ?? {})) {
    if (c.level !== Math.min(COMMANDER_RULES.maxLevel, levelForXp(c.xp)) || !Number.isInteger(c.xp)) bad.push(`general ${c.id} level ${c.level} at ${c.xp} xp`);
    if (c.perks.length + (c.offer ? 1 : 0) > c.level - 1 || new Set(c.perks).size !== c.perks.length) bad.push(`general ${c.id} perks ${c.perks.join(',')}`);
    if (c.status !== 'active' && c.formation) bad.push(`general ${c.id} ${c.status} but in command`);
    if ((c.status === 'wounded') !== c.woundedTurns > 0) bad.push(`general ${c.id} ${c.status} with ${c.woundedTurns} turns of wounds`);
    if (!c.formation) continue;
    const f = w.formations[c.formation];
    if (!f || f.owner !== c.nation || UNITS[f.unitClass].naval) bad.push(`general ${c.id} leads ${c.formation}, not an own land or air formation`);
    if (led.has(c.formation)) bad.push(`two generals lead ${c.formation}`);
    led.add(c.formation);
  }
  return bad;
}

import { describe, expect, it } from 'vitest';
import type { WorldState } from '@brink/contracts';
import { RESOURCES } from '@brink/contracts';
import { COMMANDER_RULES, FACILITY_SLOTS, levelForXp, STACK_LIMIT, UNITS } from '@brink/game-data';
import { PACIFIC_ID } from '@brink/scenarios';
import { GameSession } from '@brink/session';

const MATCHES = Number(process.env.SOAK_MATCHES ?? 100);

/** Every invariant a world must satisfy between turns. Returns the broken ones. */
function invariants(w: WorldState): string[] {
  const bad: string[] = [];
  for (const n of Object.values(w.nations)) {
    for (const r of RESOURCES) if (!Number.isInteger(n.stockpile[r]) || n.stockpile[r] < 0) bad.push(`${n.id} ${r}=${n.stockpile[r]}`);
    if (n.stability < 0 || n.stability > 100) bad.push(`${n.id} stability ${n.stability}`);
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
    if (s.facilities.length > FACILITY_SLOTS[s.kind] || new Set(s.facilities).size !== s.facilities.length) bad.push(`site ${s.id} facilities ${s.facilities.join(',')}`);
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

describe(`AI-vs-AI soak (${MATCHES} matches)`, () => {
  it('every match ends with a winner by the turn limit, with no invalid state', () => {
    const endings: Record<string, number> = {};
    const turns: number[] = [];
    let rejected = 0;
    const usage = { facilities: 0, treaties: 0 };
    const generals = { promoted: 0, killed: 0, topLevel: 1 };
    for (let seed = 1; seed <= MATCHES; seed++) {
      const s = GameSession.create(PACIFIC_ID, seed, null);
      let guard = 0;
      while (!s.over) {
        const r = s.advance();
        rejected += r.events.filter((e) => e.kind === 'order_rejected').length;
        usage.facilities += r.events.filter((e) => e.kind === 'facility_built').length;
        usage.treaties += r.events.filter((e) => e.kind === 'treaty').length;
        generals.promoted += r.events.filter((e) => e.kind === 'commander' && e.change === 'level_up').length;
        generals.killed += r.events.filter((e) => e.kind === 'commander' && e.change === 'killed').length;
        const bad = invariants(s.snapshot());
        expect(bad, `seed ${seed} turn ${s.turn}`).toEqual([]);
        if (++guard > 40) throw new Error(`seed ${seed} did not end`);
      }
      for (const c of Object.values(s.snapshot().commanders ?? {})) generals.topLevel = Math.max(generals.topLevel, c.level);
      const v = s.snapshot().victory!;
      expect(v.turn).toBeLessThanOrEqual(30);
      endings[v.reason] = (endings[v.reason] ?? 0) + 1;
      turns.push(v.turn);
    }
    turns.sort((a, b) => a - b);
    console.log('endings', endings, 'median turn', turns[Math.floor(turns.length / 2)], 'rejected AI orders', rejected, 'facilities built', usage.facilities, 'treaties signed', usage.treaties, 'generals promoted', generals.promoted, 'killed', generals.killed, 'top level', generals.topLevel);
    // The AI uses the economy and diplomacy it is given.
    expect(usage.facilities).toBeGreaterThan(MATCHES);
    expect(usage.treaties).toBeGreaterThan(MATCHES);
    expect(rejected).toBe(0);
    // Generals see war: they rise in rank.
    expect(generals.promoted).toBeGreaterThan(0);
  });
});

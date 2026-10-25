import { describe, expect, it } from 'vitest';
import type { WorldState } from '@brink/contracts';
import { RESOURCES } from '@brink/contracts';
import { STACK_LIMIT } from '@brink/game-data';
import { MERIDIAN_ID } from '@brink/scenarios';
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
  for (const f of Object.values(w.formations)) {
    if (!w.tiles[f.key]) bad.push(`${f.id} off map`);
    if (w.nations[f.owner]?.eliminated) bad.push(`${f.id} belongs to an eliminated nation`);
    for (const v of [f.organization, f.morale, f.readiness, f.fuel, f.ammunition, f.experience, f.entrenchment, f.supply]) {
      if (!Number.isInteger(v) || v < 0 || v > 100) bad.push(`${f.id} stat out of range`);
    }
    if (f.strength <= 0 || f.strength > 1000) bad.push(`${f.id} strength ${f.strength}`);
    if (w.tiles[f.key]?.terrain === 'water') bad.push(`${f.id} in water`);
    perHex.set(f.key, [...(perHex.get(f.key) ?? []), f.owner]);
  }
  for (const [key, owners] of perHex) {
    const distinct = new Set(owners);
    for (const a of distinct) for (const b of distinct) {
      if (a < b && w.relations[`${a}|${b}`] === 'war') bad.push(`enemies ${a} and ${b} share ${key}`);
    }
    if (owners.length > STACK_LIMIT) bad.push(`${owners.length} formations in ${key}`);
  }
  for (const s of Object.values(w.sites)) if (w.tiles[s.key]!.owner !== s.owner) bad.push(`site ${s.id} owner differs from its hex`);
  return bad;
}

describe(`AI-vs-AI soak (${MATCHES} matches)`, () => {
  it('every match ends with a winner by the turn limit, with no invalid state', () => {
    const endings: Record<string, number> = {};
    const turns: number[] = [];
    let rejected = 0;
    for (let seed = 1; seed <= MATCHES; seed++) {
      const s = GameSession.create(MERIDIAN_ID, seed, null);
      let guard = 0;
      while (!s.over) {
        const r = s.advance();
        rejected += r.events.filter((e) => e.kind === 'order_rejected').length;
        const bad = invariants(s.snapshot());
        expect(bad, `seed ${seed} turn ${s.turn}`).toEqual([]);
        if (++guard > 40) throw new Error(`seed ${seed} did not end`);
      }
      const v = s.snapshot().victory!;
      expect(v.turn).toBeLessThanOrEqual(30);
      endings[v.reason] = (endings[v.reason] ?? 0) + 1;
      turns.push(v.turn);
    }
    turns.sort((a, b) => a - b);
    console.log('endings', endings, 'median turn', turns[Math.floor(turns.length / 2)], 'rejected AI orders', rejected);
    expect(rejected).toBe(0);
  });
});

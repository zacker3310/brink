import { describe, expect, it } from 'vitest';
import type { WorldState } from '@brink/contracts';
import { STACK_LIMIT, UNITS } from '@brink/game-data';
import { INDOPAC_ID } from '@brink/scenarios';
import { GameSession } from '@brink/session';

// The Indo-Pacific South, AI against AI (docs/indopac.md): five powers and fifteen minor states on
// an archipelago. Every match must end by the turn limit with no invalid state and no rejected AI
// order; the balance table (who wins, how, how often decisively, and how much of the war is fought
// across the sea) is reported on the console. SOAK_MATCHES sets the count, as for the Pacific's soak.

const MATCHES = Number(process.env.SOAK_MATCHES ?? 100);

/** The invariants a world must keep between turns (the Pacific soak checks the full list). */
function invariants(w: WorldState): string[] {
  const bad: string[] = [];
  for (const n of Object.values(w.nations)) {
    for (const r of ['credits', 'energy', 'materials', 'food'] as const) if (!Number.isInteger(n.stockpile[r]) || n.stockpile[r] < 0) bad.push(`${n.id} ${r}=${n.stockpile[r]}`);
    if (!n.minor && !n.eliminated && !n.doctrine) bad.push(`${n.id} has no doctrine`);
  }
  const stacked = new Map<string, number>();
  const owners = new Map<string, Set<string>>();
  for (const f of Object.values(w.formations)) {
    const t = w.tiles[f.key];
    if (!t) bad.push(`${f.id} off map`);
    if (w.nations[f.owner]?.eliminated) bad.push(`${f.id} belongs to an eliminated nation`);
    if (f.strength <= 0 || f.strength > 1000 || !Number.isInteger(f.strength)) bad.push(`${f.id} strength ${f.strength}`);
    if (t?.terrain === 'water' && !UNITS[f.unitClass].naval && !f.aboard) bad.push(`${f.id} in water`);
    if (UNITS[f.unitClass].naval && t && t.terrain !== 'water' && !t.port) bad.push(`${f.id} ship ashore`);
    if (f.aboard && w.formations[f.aboard]?.key !== f.key) bad.push(`${f.id} aboard a ship that is not there`);
    if (!f.aboard) {
      const layer = `${f.key}|${UNITS[f.unitClass].naval ? 'sea' : 'land'}`;
      stacked.set(layer, (stacked.get(layer) ?? 0) + 1);
    }
    owners.set(f.key, (owners.get(f.key) ?? new Set()).add(f.owner));
  }
  for (const [k, n] of stacked) if (n > STACK_LIMIT) bad.push(`${n} formations in ${k}`);
  for (const [k, set] of owners) for (const a of set) for (const b of set) if (a < b && w.relations[`${a}|${b}`] === 'war') bad.push(`enemies ${a} and ${b} share ${k}`);
  for (const s of Object.values(w.sites)) if (w.tiles[s.key]!.owner !== s.owner) bad.push(`site ${s.id} owner differs from its hex`);
  return bad;
}

describe(`Indo-Pacific South AI-vs-AI soak (${MATCHES} matches)`, () => {
  // About a minute and a half a match on a busy four-core machine.
  it('every match ends by the turn limit, with no invalid state and no rejected AI order', { timeout: MATCHES * 180_000 }, () => {
    const endings: Record<string, number> = {};
    const decisive: Record<string, number> = {};
    const onScore: Record<string, number> = {};
    const turns: number[] = [];
    let rejected = 0;
    /** Sites taken, and how many of them lay on another landmass than the taker's capital. */
    const captured: Record<string, number> = {};
    let cards = 0;
    for (let seed = 1; seed <= MATCHES; seed++) {
      const s = GameSession.create(INDOPAC_ID, seed, null);
      let guard = 0;
      while (!s.over) {
        const r = s.advance();
        rejected += r.events.filter((e) => e.kind === 'order_rejected').length;
        cards += r.events.filter((e) => e.kind === 'card_played').length;
        for (const e of r.events) if (e.kind === 'site_captured' && !s.snapshot().nations[e.to]?.minor) captured[e.to] = (captured[e.to] ?? 0) + 1;
        const bad = invariants(s.snapshot());
        expect(bad, `seed ${seed} turn ${s.turn}`).toEqual([]);
        if (++guard > 40) throw new Error(`seed ${seed} did not end`);
      }
      const v = s.snapshot().victory!;
      expect(v.turn).toBeLessThanOrEqual(30);
      endings[v.reason] = (endings[v.reason] ?? 0) + 1;
      const tally = v.reason === 'turn_limit' ? onScore : decisive;
      tally[v.winner] = (tally[v.winner] ?? 0) + 1;
      turns.push(v.turn);
    }
    turns.sort((a, b) => a - b);
    const decisiveCount = Object.values(decisive).reduce((a, n) => a + n, 0);
    console.log(
      'indopac endings', endings,
      'decisive rate', `${Math.round((decisiveCount * 100) / MATCHES)}%`,
      'median turn', turns[Math.floor(turns.length / 2)],
      'decisive wins', decisive,
      'turn-limit wins', onScore,
      'sites captured', captured,
      'cards played', cards,
      'rejected AI orders', rejected,
    );
    expect(rejected).toBe(0);
    // Every power is in the war: each takes something in the soak (Australia only by landing).
    for (const p of ['india', 'pakistan', 'china', 'indonesia', 'australia']) expect(captured[p] ?? 0, p).toBeGreaterThan(0);
    expect(cards).toBeGreaterThan(MATCHES * 10);
  });
});

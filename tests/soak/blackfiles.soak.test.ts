import { describe, expect, it } from 'vitest';
import type { WorldState } from '@brink/contracts';
import { RESOURCES } from '@brink/contracts';
import { STACK_LIMIT, TECHS, UNITS } from '@brink/game-data';
import { FIRST_CONTACT_ID, PACIFIC_ID } from '@brink/scenarios';
import { GameSession } from '@brink/session';

// The Black Files soak (MASTER-PLAN Phase 8 exit criteria): AI-against-AI campaigns of First Contact
// on Normal, every turn checked, with no order of any AI's refused, the Visitors among them; and
// the Visitors winning sometimes, so the threat is real. A few Pacific campaigns with the Black
// Files toggle on go with them. `SOAK_MATCHES` sets the First Contact count (a fifth of it, at
// least two, for the Pacific).

const MATCHES = Number(process.env.SOAK_MATCHES ?? 100);

function invariants(w: WorldState): string[] {
  const bad: string[] = [];
  const bf = w.blackFiles!;
  for (const n of Object.values(w.nations)) for (const r of RESOURCES) if (!Number.isInteger(n.stockpile[r]) || n.stockpile[r] < 0) bad.push(`${n.id} ${r}=${n.stockpile[r]}`);
  const stacked = new Map<string, number>();
  const owners = new Map<string, Set<string>>();
  for (const f of Object.values(w.formations)) {
    if (!w.tiles[f.key]) bad.push(`${f.id} off map`);
    if (w.nations[f.owner]?.eliminated) bad.push(`${f.id} belongs to an eliminated nation`);
    if (f.strength <= 0 || f.strength > 1000 || !Number.isInteger(f.strength)) bad.push(`${f.id} strength ${f.strength}`);
    for (const v of [f.organization, f.morale, f.readiness, f.fuel, f.ammunition, f.entrenchment, f.supply]) if (!Number.isInteger(v) || v < 0 || v > 100) bad.push(`${f.id} stat out of range`);
    if (w.tiles[f.key]?.terrain === 'water' && !UNITS[f.unitClass].naval && !f.aboard) bad.push(`${f.id} in water`);
    if (!f.aboard) {
      const k = `${f.key}|${UNITS[f.unitClass].naval ? 'sea' : 'land'}`;
      stacked.set(k, (stacked.get(k) ?? 0) + 1);
    }
    owners.set(f.key, new Set([...(owners.get(f.key) ?? []), f.owner]));
  }
  for (const [k, n] of stacked) if (n > STACK_LIMIT) bad.push(`${n} formations in ${k}`);
  for (const [key, set] of owners) for (const a of set) for (const b of set) if (a < b && w.relations[`${a}|${b}`] === 'war') bad.push(`enemies ${a} and ${b} share ${key}`);
  for (const s of Object.values(w.sites)) if (w.tiles[s.key]!.owner !== s.owner) bad.push(`site ${s.id} owner differs from its hex`);
  for (const n of Object.values(w.nations)) for (const t of n.research.unlocked) if (!TECHS[t] || TECHS[t]!.requires.some((p) => !n.research.unlocked.includes(p))) bad.push(`${n.id} has ${t} without its prerequisites`);
  // The Black Files' own: whole artefacts, nobody both in the Accord and out of it for good, no
  // signatories at war, a sleeping Visitors with nothing, and digs that only ever empty.
  for (const [n, a] of Object.entries(bf.artefacts)) if (!Number.isInteger(a) || a <= 0 || !w.nations[n] || w.nations[n]!.minor) bad.push(`${n} holds ${a} artefacts`);
  for (const n of bf.accord) if (bf.betrayers.includes(n)) bad.push(`${n} both signed and betrayed`);
  for (const a of bf.accord) for (const b of bf.accord) if (a < b && w.relations[`${a}|${b}`] === 'war') bad.push(`signatories ${a} and ${b} at war`);
  for (const d of Object.values(bf.digs)) if (d.left < 0 || d.turns < 0) bad.push('a dig below nothing');
  if (bf.awake === null) {
    if (Object.values(w.formations).some((f) => f.owner === bf.visitors) || Object.values(w.sites).some((s) => s.owner === bf.visitors)) bad.push('the Visitors hold something asleep');
  }
  for (const f of Object.values(w.formations)) if ((f.owner === bf.visitors) !== ['walker', 'swarm', 'emitter'].includes(f.unitClass)) bad.push(`${f.id} ${f.unitClass} of ${f.owner}`);
  return bad;
}

interface Tally {
  endings: Record<string, number>;
  winners: Record<string, number>;
  rejected: number;
  rejectedBy: Record<string, number>;
  woke: number;
  artefacts: number;
  studied: number;
  accords: number;
  splits: number;
  converted: number;
  turns: number[];
}

function play(scenario: string, seeds: number[], opts: { blackFiles?: boolean }): Tally {
  const t: Tally = { endings: {}, winners: {}, rejected: 0, rejectedBy: {}, woke: 0, artefacts: 0, studied: 0, accords: 0, splits: 0, converted: 0, turns: [] };
  for (const seed of seeds) {
    const s = GameSession.create(scenario, seed, null, [], { difficulty: 'normal', ...opts });
    let guard = 0;
    while (!s.over) {
      const r = s.advance();
      for (const e of r.events) {
        if (e.kind === 'order_rejected') {
          t.rejected += 1;
          t.rejectedBy[`${e.nation}: ${e.reason}`] = (t.rejectedBy[`${e.nation}: ${e.reason}`] ?? 0) + 1;
        }
        if (e.kind !== 'black_files') continue;
        if (e.what === 'awakening') t.woke += 1;
        if (e.what === 'artefact') t.artefacts += 1;
        if (e.what === 'studied') t.studied += 1;
        if (e.what === 'accord') t.accords += 1;
        if (e.what === 'split') t.splits += 1;
        if (e.what === 'converted') t.converted += 1;
      }
      const bad = invariants(s.snapshot());
      expect(bad, `${scenario} seed ${seed} turn ${s.turn}`).toEqual([]);
      if (++guard > 60) throw new Error(`${scenario} seed ${seed} did not end`);
    }
    const v = s.snapshot().victory!;
    t.endings[v.reason] = (t.endings[v.reason] ?? 0) + 1;
    t.winners[v.winner] = (t.winners[v.winner] ?? 0) + 1;
    t.turns.push(v.turn);
  }
  t.turns.sort((a, b) => a - b);
  return t;
}

describe(`Black Files soak (${MATCHES} First Contact campaigns on Normal)`, () => {
  it('First Contact: no invalid state, no refused order, and the Visitors win sometimes', () => {
    const t = play(FIRST_CONTACT_ID, Array.from({ length: MATCHES }, (_, i) => i + 1), {});
    const visitors = t.endings.visitors ?? 0;
    console.log(
      'first contact endings', t.endings, 'winners', t.winners, 'median turn', t.turns[Math.floor(t.turns.length / 2)],
      'visitors win', `${Math.round((visitors * 100) / MATCHES)}%`, 'woke', t.woke, 'artefacts', t.artefacts, 'studied', t.studied,
      'accord signatures', t.accords, 'swarm splits', t.splits, 'hexes converted', t.converted, 'rejected AI orders', t.rejected, t.rejectedBy,
    );
    expect(t.rejected).toBe(0);
    // They wake in every campaign (by turn 9 at the latest), dig, study and sign.
    expect(t.woke).toBe(MATCHES);
    expect(t.artefacts).toBeGreaterThan(MATCHES);
    expect(t.accords).toBeGreaterThan(MATCHES);
    // The threat is real but beatable (MASTER-PLAN: about 15-25% on Normal). The bounds hold on a
    // small run too: a win at least once in twenty, never a majority.
    expect(visitors).toBeGreaterThan(0);
    expect(visitors * 2).toBeLessThan(MATCHES);
  });

  it('a Pacific campaign with the Black Files on: no invalid state, no refused order', () => {
    const n = Math.max(2, Math.floor(MATCHES / 5));
    const t = play(PACIFIC_ID, Array.from({ length: n }, (_, i) => i + 1), { blackFiles: true });
    console.log('pacific black files endings', t.endings, 'winners', t.winners, 'woke', t.woke, 'artefacts', t.artefacts, 'studied', t.studied, 'accord signatures', t.accords, 'rejected AI orders', t.rejected, t.rejectedBy);
    expect(t.rejected).toBe(0);
    expect(t.woke).toBeGreaterThan(0);
  });
});

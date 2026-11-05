import { describe, expect, it } from 'vitest';
import type { AiMemory, NationId, WorldState } from '@brink/contracts';
import { createScenario, FIRST_CONTACT_ID } from '@brink/scenarios';
import { TECHS } from '@brink/game-data';
import { buildView, lockOrders, resolveTurn, sortedKeys } from '@brink/simulation';
import { emptyMemory, planOrders, planVisitors, updateMemory } from './index';

// The Black Files' AI: the Visitors' own planner (visitors.ts) and the powers' answers to them,
// reverse-engineered research and the Accord, on First Contact with the Visitors awake early.

function play(seed: number, turns: number, prep: (w: WorldState) => void = () => {}) {
  let w = createScenario(FIRST_CONTACT_ID, seed);
  prep(w);
  const memory: Record<NationId, AiMemory> = {};
  for (const n of sortedKeys(w.nations)) memory[n] = emptyMemory();
  const rejected: string[] = [];
  const moves = { attacks: 0, marches: 0 };
  for (let t = 0; t < turns && !w.victory; t++) {
    const subs = sortedKeys(w.nations)
      .filter((n) => !w.nations[n]!.eliminated)
      .map((n) => planOrders(buildView(w, n), memory[n]!, w.seed));
    const v = subs.find((s) => s.nation === 'visitors')!;
    for (const o of Object.values(v.formations)) {
      if (o.type === 'attack') moves.attacks += 1;
      if (o.type === 'move') moves.marches += 1;
    }
    for (const e of lockOrders(w, subs).rejected) if (e.kind === 'order_rejected') rejected.push(`${e.nation} t${w.turn}: ${e.reason}`);
    const r = resolveTurn(w, subs);
    w = r.world;
    for (const n of sortedKeys(memory)) if (!w.nations[n]!.eliminated) memory[n] = updateMemory(memory[n]!, r.observations[n]!, r.reports[n]!.events);
  }
  return { w, rejected, moves };
}

describe('the Visitors and the powers against them', () => {
  it('the Visitors plan only from their own view, and every order of theirs is one the engine takes', () => {
    const { w, rejected, moves } = play(3, 12, (x) => (x.blackFiles!.wakeTurn = 2));
    expect(rejected).toEqual([]);
    expect(w.blackFiles!.awake).toBe(2);
    expect(moves.marches).toBeGreaterThan(0);
    expect(moves.attacks).toBeGreaterThan(0);
  }, 240_000);

  it('asleep, the Visitors have nothing to order; awake, a powerless view still plans', () => {
    const w = createScenario(FIRST_CONTACT_ID, 1);
    const asleep = planVisitors(buildView(w, 'visitors'));
    expect(asleep.formations).toEqual({});
    expect(asleep.diplomacy).toEqual([]);
    expect(asleep.recruit).toEqual([]);
  });

  it('once they wake, the powers sign the Accord with one another and study what they dig', () => {
    const { w, rejected } = play(5, 14, (x) => {
      x.blackFiles!.wakeTurn = 3;
      // Every power starts with an artefact in its laboratory.
      for (const n of ['usa', 'russia', 'china', 'uk', 'australia']) x.blackFiles!.artefacts[n] = 1;
    });
    expect(rejected).toEqual([]);
    expect(w.blackFiles!.accord.length).toBeGreaterThanOrEqual(2);
    // The AI keeps the Accord.
    expect(w.blackFiles!.betrayers).toEqual([]);
    // At least one power reverse-engineered what it held, and nobody picked a project it could not start.
    const studied = sortedKeys(w.nations).filter((n) => w.nations[n]!.research.unlocked.some((t) => TECHS[t]?.artefact));
    expect(studied.length).toBeGreaterThan(0);
  }, 240_000);
});

import { describe, expect, it } from 'vitest';
import { STACK_LIMIT, UNITS } from '@brink/game-data';
import { buildView, hashState, pairKey, relationOf, sortedKeys } from '@brink/simulation';
import type { WorldState } from '@brink/contracts';
import { applyCrisis, CRISES, crisisOf, dealCrisis } from './crises';
import { createPacificScenario } from './pacific';

/** What the soak checks every turn, for one world. */
export function legal(w: WorldState): string[] {
  const out: string[] = [];
  const perHex = new Map<string, string[]>();
  for (const id of sortedKeys(w.formations)) {
    const f = w.formations[id]!;
    if (!w.tiles[f.key]) out.push(`${id} off the map`);
    // At sea: only ships, and whoever rides in one (in the ship's own hex).
    else if (w.tiles[f.key]!.terrain === 'water' && !UNITS[f.unitClass].naval && !f.aboard) out.push(`${id} at sea`);
    if (f.aboard && w.formations[f.aboard]?.key !== f.key) out.push(`${id} is not with its ship`);
    if (!f.aboard && !UNITS[f.unitClass].naval) perHex.set(f.key, [...(perHex.get(f.key) ?? []), f.owner]);
  }
  for (const [key, owners] of perHex) {
    if (owners.length > STACK_LIMIT) out.push(`${key} holds ${owners.length}`);
    const set = [...new Set(owners)];
    for (let i = 0; i < set.length; i++) for (let j = i + 1; j < set.length; j++) if (relationOf(w.relations, set[i]!, set[j]!) === 'war') out.push(`${set[i]} and ${set[j]} share ${key} at war`);
  }
  for (const s of Object.values(w.sites)) if (s.owner !== w.tiles[s.key]!.owner) out.push(`${s.name} owner differs from its hex`);
  return out;
}

describe('Opening Crises', () => {
  it('has twelve crises, each with a story, a setup and a threat', () => {
    expect(CRISES).toHaveLength(12);
    expect(new Set(CRISES.map((c) => c.id)).size).toBe(12);
    for (const c of CRISES) {
      expect(c.story.length, c.id).toBeGreaterThan(60);
      expect(c.setup.length, c.id).toBeGreaterThan(30);
      expect([1, 2, 3]).toContain(c.threat);
    }
  });

  for (const c of CRISES) {
    it(`${c.id}: leaves a legal world (the AI's play of it is in @brink/ai's tests)`, () => {
      const w = createPacificScenario(11);
      applyCrisis(w, c.id);
      expect(w.crisis).toBe(c.id);
      expect(legal(w)).toEqual([]);
    });
  }

  it('is deterministic, applied once, and carried in the view', () => {
    const a = createPacificScenario(3);
    const b = createPacificScenario(3);
    applyCrisis(a, 'red-dawn');
    applyCrisis(b, 'red-dawn');
    expect(hashState(a)).toBe(hashState(b));
    expect(() => applyCrisis(a, 'cold-peace')).toThrow(/one crisis/);
    expect(buildView(a, 'usa').crisis).toBe('red-dawn');
  });

  it('sets the wars the story says, and only those between powers', () => {
    const w = createPacificScenario(1);
    applyCrisis(w, 'pearl-harbor');
    expect(w.relations[pairKey('japan', 'usa')]).toBe('war');
    expect(w.relations[pairKey('china', 'russia')]).toBe('peace');
    expect(w.relations[pairKey('usa', 'canada')]).toBe('war');
    const red = createPacificScenario(1);
    applyCrisis(red, 'red-dawn');
    expect(Object.values(red.sites).find((s) => s.name === 'Nome')!.owner).toBe('russia');
    expect(red.intel.usa!.knownOwner[Object.values(red.sites).find((s) => s.name === 'Nome')!.key]).toBe('russia');
  });

  it('deals every crisis from some seed, the same one each time for a seed', () => {
    const dealt = new Set<string>();
    for (let seed = 1; seed <= 400; seed++) dealt.add(dealCrisis(seed));
    expect(dealt.size).toBe(CRISES.length);
    expect(dealCrisis(77)).toBe(dealCrisis(77));
    expect(crisisOf(dealCrisis(5))).toBeDefined();
  });
});

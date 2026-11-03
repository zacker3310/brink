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
  it('has fourteen crises, each with a story, a setup and a threat', () => {
    expect(CRISES).toHaveLength(14);
    expect(new Set(CRISES.map((c) => c.id)).size).toBe(14);
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

  it('the Pacific Pact: the West allied against the East, and nobody\'s prize an ally\'s capital', () => {
    const w = createPacificScenario(1);
    applyCrisis(w, 'pacific-pact');
    for (const [a, b] of [['usa', 'japan'], ['usa', 'canada'], ['japan', 'mexico'], ['canada', 'mexico'], ['russia', 'china']]) expect(w.relations[pairKey(a!, b!)], `${a} ${b}`).toBe('alliance');
    for (const a of ['usa', 'japan', 'canada', 'mexico']) for (const b of ['russia', 'china']) expect(w.relations[pairKey(a, b)], `${a} ${b}`).toBe('war');
    expect(w.nations.usa!.objectives).not.toContain('canada-capital');
    expect(w.nations.usa!.objectives).toContain('taiwan-capital');
    expect(w.nations.china!.objectives).toContain('canada-capital');
    // A view shows an ally's units: the bloc fights as one.
    const v = buildView(w, 'japan');
    expect(Object.values(v.contacts).some((c) => c.owner === 'usa')).toBe(true);
  });

  it('the Second Civil War: a Heartland Republic against the cities, Russia behind it, Japan with the cities, Canada and Mexico invading', () => {
    const w = createPacificScenario(1);
    applyCrisis(w, 'second-civil-war');
    const h = w.nations.heartland!;
    expect(h.minor).toBeUndefined();
    const sites = (n: string) => Object.values(w.sites).filter((s) => s.owner === n);
    expect(sites('heartland').find((s) => s.kind === 'capital')!.name).toBe('Houston');
    // The cities stay with Washington; the countryside goes over.
    for (const name of ['Washington', 'New York', 'Chicago', 'San Francisco', 'Los Angeles', 'Seattle', 'Honolulu']) expect(sites('usa').map((s) => s.name), name).toContain(name);
    expect(Object.values(w.tiles).filter((t) => t.owner === 'heartland').length).toBeGreaterThan(Object.values(w.tiles).filter((t) => t.owner === 'usa').length);
    expect(Object.values(w.formations).some((f) => f.owner === 'heartland' && f.unitClass === 'armor')).toBe(true);
    for (const [a, b, r] of [
      ['heartland', 'usa', 'war'],
      ['heartland', 'russia', 'alliance'],
      ['russia', 'usa', 'war'],
      ['japan', 'usa', 'alliance'],
      ['canada', 'usa', 'war'],
      ['mexico', 'usa', 'war'],
      ['canada', 'heartland', 'peace'],
    ] as const) expect(w.relations[pairKey(a, b)], `${a} ${b}`).toBe(r);
    // Canada and Mexico fight as powers, not minor states that only hold their ground.
    expect(w.nations.canada!.minor).toBeUndefined();
    expect(w.nations.mexico!.minor).toBeUndefined();
    // The rebels see their own country.
    expect(buildView(w, 'heartland').self.id).toBe('heartland');
  });

  it('deals every crisis from some seed, the same one each time for a seed', () => {
    const dealt = new Set<string>();
    for (let seed = 1; seed <= 400; seed++) dealt.add(dealCrisis(seed));
    expect(dealt.size).toBe(CRISES.length);
    expect(dealCrisis(77)).toBe(dealCrisis(77));
    expect(crisisOf(dealCrisis(5))).toBeDefined();
  });
});

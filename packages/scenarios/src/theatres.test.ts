import { describe, expect, it } from 'vitest';
import { CRISES } from './crises';
import { SCENARIOS } from './index';
import { ALL_THEATRES, classicOnly, DEFAULT_THEATRE, findNation, FIRST_CONTACT, naturalAlly, shortName, THEATRES, theatreCrises, theatreMinors, theatreOf, theatrePowers } from './theatres';

// The one table of theatres (theatres.ts): who is in each, how it opens, who Easy puts beside a
// player, and that every screen and the session can find a nation of any of them.

describe('the theatre table', () => {
  it('lists five theatres on the picker, the Pacific first, and First Contact beside them', () => {
    expect(THEATRES.map((t) => t.id)).toEqual(['pacific', 'europe', 'mideast', 'indopac', 'americas']);
    expect(DEFAULT_THEATRE.id).toBe('pacific');
    expect(FIRST_CONTACT.listed).toBe(false);
    expect(ALL_THEATRES.map((t) => t.id)).toEqual([...THEATRES.map((t) => t.id), FIRST_CONTACT.id]);
    // The scenario list (title screen, API) is the same table.
    expect(SCENARIOS.map((s) => s.id)).toEqual(ALL_THEATRES.map((t) => t.id));
    for (const t of ALL_THEATRES) expect(SCENARIOS.find((s) => s.id === t.id)?.nations).toBe(t.powers.length);
    expect(theatreOf('nowhere')).toBeUndefined();
  });

  it('gives each theatre its own powers and minor states, as its world is built', { timeout: 120_000 }, () => {
    for (const t of ALL_THEATRES) {
      const w = t.create(1);
      expect(w.scenarioId, t.id).toBe(t.id);
      expect(w.maxTurns, t.id).toBe(t.maxTurns);
      const powers = Object.keys(w.nations).filter((n) => !w.nations[n]!.minor).sort();
      expect(powers, t.id).toEqual(t.powers.map((n) => n.id).sort());
      for (const m of t.minors) expect(w.nations[m.id]?.minor, `${t.id} ${m.id}`).toBe(true);
      expect(theatrePowers(t.id)).toBe(t.powers);
      expect(theatreMinors(t.id)).toBe(t.minors);
    }
  });

  it('deals the Opening Crises only in the Pacific, whose map they are written for', () => {
    expect(theatreCrises('pacific')).toBe(CRISES);
    expect(classicOnly('pacific')).toBe(false);
    for (const t of ALL_THEATRES.filter((x) => x.id !== 'pacific')) {
      expect(theatreCrises(t.id), t.id).toEqual([]);
      expect(classicOnly(t.id), t.id).toBe(true);
    }
    // The Black Files toggle seeds only the map with their sites; First Contact is the treaty and the ice.
    expect(ALL_THEATRES.filter((t) => t.blackFiles).map((t) => t.id)).toEqual(['pacific']);
    expect(ALL_THEATRES.filter((t) => t.treaty || t.ice).map((t) => t.id)).toEqual([FIRST_CONTACT.id]);
  });

  it("pairs Easy's natural allies both ways, among the theatre's own powers", () => {
    for (const t of ALL_THEATRES) {
      const ids = new Set(t.powers.map((n) => n.id));
      for (const [a, b] of Object.entries(t.allies)) {
        expect(ids.has(a) && ids.has(b), `${t.id}: ${a} and ${b}`).toBe(true);
        expect(naturalAlly(t.id, b), `${t.id}: ${b}`).toBe(a);
      }
    }
    expect(naturalAlly('pacific', 'usa')).toBe('japan');
    expect(naturalAlly('americas', 'usa')).toBe('canada');
    expect(naturalAlly('europe', 'russia')).toBe('turkey');
    expect(naturalAlly('mideast', 'egypt')).toBe('saudi-arabia');
    // Five powers: one stands alone.
    expect(naturalAlly('indopac', 'indonesia')).toBeUndefined();
  });

  it('finds a nation of any theatre, as its own theatre draws it', () => {
    // Turkey is one nation file in two theatres, with each map's colour.
    expect(findNation('turkey', 'europe')?.color).toBe(theatrePowers('europe').find((n) => n.id === 'turkey')!.color);
    expect(findNation('turkey', 'mideast')?.color).toBe(theatrePowers('mideast').find((n) => n.id === 'turkey')!.color);
    // Without a theatre: powers before minor states (Iran is a power in the Middle East, a minor state in Europe).
    expect(findNation('iran')?.minor).toBeUndefined();
    expect(findNation('canada')?.minor).toBeUndefined();
    expect(findNation('canada', 'pacific')?.minor).toBe(true);
    expect(findNation('usa')?.name).toBe('United States');
    expect(findNation(undefined)).toBeUndefined();
    expect(shortName('South Africa')).toBe('S. Africa');
    expect(shortName('Nowhere Land')).toBe('Nowhere Land');
  });
});

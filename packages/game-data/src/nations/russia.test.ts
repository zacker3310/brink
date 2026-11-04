import { describe, expect, it } from 'vitest';
import { COMMANDER_RULES, COMMANDER_TRAITS, GENERIC_ROSTER, NATION_ROSTERS, rosterFor } from '../commanders';
import { CARDS, deckFor, DOCTRINE, GENERIC_CARDS, NATION_DOCTRINES } from '../doctrine';
import { NATION_BLURBS, NATION_DOCTRINE, ROSTER, SIGNATURE_CARDS } from './russia';

describe('Russia', () => {
  it('fields three distinct generals with real traits and a bio each', () => {
    expect(NATION_ROSTERS.russia).toBe(ROSTER);
    expect(rosterFor('russia', 'directorate')).toBe(ROSTER);
    expect(ROSTER).toHaveLength(COMMANDER_RULES.perNation);
    expect(new Set(ROSTER.map((g) => g.name)).size).toBe(ROSTER.length);
    const generic = new Set(Object.values(GENERIC_ROSTER).flatMap((r) => r.map((g) => g.name)));
    for (const g of ROSTER) {
      expect(COMMANDER_TRAITS[g.trait], g.name).toBeDefined();
      expect(generic.has(g.name), g.name).toBe(false);
      expect(g.bio.length).toBeGreaterThan(20);
    }
  });

  it('registers five or six signature cards, unique, with integer costs within the bank', () => {
    expect(NATION_DOCTRINES.russia).toBe(NATION_DOCTRINE);
    expect(SIGNATURE_CARDS.length).toBeGreaterThanOrEqual(5);
    expect(SIGNATURE_CARDS.length).toBeLessThanOrEqual(6);
    expect(new Set(SIGNATURE_CARDS.map((c) => c.id)).size).toBe(SIGNATURE_CARDS.length);
    for (const c of SIGNATURE_CARDS) {
      expect(GENERIC_CARDS[c.id], `${c.id} shadows a generic card`).toBeUndefined();
      expect(CARDS[c.id]).toBe(c);
      expect(Number.isInteger(c.cost) && c.cost >= 1 && c.cost <= DOCTRINE.cpCap, c.id).toBe(true);
      expect(Number.isInteger(c.duration) && c.duration >= 1, c.id).toBe(true);
      expect(c.effects.length).toBeGreaterThan(0);
      expect(c.flavour.length).toBeGreaterThan(10);
      // Every number in an effect is an integer.
      const nums = JSON.stringify(c.effects).match(/-?\d+(\.\d+)?/g) ?? [];
      for (const n of nums) expect(Number.isInteger(Number(n)), `${c.id}: ${n}`).toBe(true);
    }
  });

  it('draws from a 14-18 card deck of known cards that holds every signature card', () => {
    const deck = deckFor('russia', 'directorate');
    expect(deck.length).toBeGreaterThanOrEqual(14);
    expect(deck.length).toBeLessThanOrEqual(18);
    for (const id of deck) expect(CARDS[id], id).toBeDefined();
    for (const c of SIGNATURE_CARDS) expect(deck).toContain(c.id);
    // A land power: no beach landings in its hand.
    expect(deck).not.toContain('amphibious_doctrine');
    // At least one card the opening Command Points can pay for.
    expect(deck.some((id) => CARDS[id]!.cost <= DOCTRINE.cpStart)).toBe(true);
  });

  it('has a blurb', () => {
    expect(NATION_BLURBS.russia!.length).toBeGreaterThan(40);
  });
});

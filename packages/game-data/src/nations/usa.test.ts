import { describe, expect, it } from 'vitest';
import { COMMANDER_RULES, COMMANDER_TRAITS, GENERIC_ROSTER, NATION_ROSTERS, rosterFor } from '../commanders';
import { CARDS, deckFor, DOCTRINE, GENERIC_CARDS, NATION_DOCTRINES } from '../doctrine';
import { CARDS as US_CARDS, DECK, ROSTER } from './usa';

describe('United States', () => {
  it('fields its own three generals, each with a known trait and a bio', () => {
    expect(NATION_ROSTERS.usa).toBe(ROSTER);
    expect(rosterFor('usa', 'commonwealth')).toBe(ROSTER);
    expect(ROSTER).toHaveLength(COMMANDER_RULES.perNation);
    expect(new Set(ROSTER.map((g) => g.name)).size).toBe(ROSTER.length);
    const generic = new Set(Object.values(GENERIC_ROSTER).flatMap((r) => r.map((g) => g.name)));
    for (const g of ROSTER) {
      expect(COMMANDER_TRAITS[g.trait], g.name).toBeDefined();
      expect(generic.has(g.name), g.name).toBe(false);
      expect(g.bio.length).toBeGreaterThan(10);
    }
    expect(new Set(ROSTER.map((g) => g.trait)).size).toBe(ROSTER.length);
  });

  it('holds a valid deck of known cards at sensible costs', () => {
    expect(NATION_DOCTRINES.usa?.nation).toBe('usa');
    expect(DECK.length).toBeGreaterThanOrEqual(14);
    expect(DECK.length).toBeLessThanOrEqual(18);
    for (const id of DECK) expect(CARDS[id], id).toBeDefined();
    expect(deckFor('usa', 'commonwealth')).toEqual([...DECK].sort());
    // Signature cards: unique, prefixed, never shadowing a generic card, each in the deck.
    expect(US_CARDS.length).toBeGreaterThanOrEqual(5);
    expect(new Set(US_CARDS.map((c) => c.id)).size).toBe(US_CARDS.length);
    for (const c of US_CARDS) {
      expect(c.id.startsWith('us_'), c.id).toBe(true);
      expect(GENERIC_CARDS[c.id], c.id).toBeUndefined();
      expect(CARDS[c.id]).toBe(c);
      expect(DECK, c.id).toContain(c.id);
      expect(Number.isInteger(c.cost) && c.cost >= 1 && c.cost <= DOCTRINE.cpCap, c.id).toBe(true);
      expect(Number.isInteger(c.duration) && c.duration >= 1, c.id).toBe(true);
      expect(c.effects.length).toBeGreaterThan(0);
      expect(c.flavour.length).toBeGreaterThan(10);
      const numbers = JSON.stringify(c.effects).match(/-?\d+(\.\d+)?/g) ?? [];
      for (const v of numbers) expect(Number.isInteger(Number(v)), `${c.id} ${v}`).toBe(true);
      // A card that strikes a hex must aim at one.
      if (c.effects.some((e) => e.kind === 'card_strike')) expect(c.target).toBe('enemy-hex');
    }
    // No more than two copies of anything, and the US deck has no drone swarm or saboteur.
    const counts = new Map<string, number>();
    for (const id of DECK) counts.set(id, (counts.get(id) ?? 0) + 1);
    for (const [id, n] of counts) expect(n, id).toBeLessThanOrEqual(2);
    expect(DECK).not.toContain('kamikaze_swarm');
    expect(DECK).not.toContain('sabotage');
  });
});

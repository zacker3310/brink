import { describe, expect, it } from 'vitest';
import { COMMANDER_RULES, COMMANDER_TRAITS, NATION_ROSTERS, rosterFor } from '../commanders';
import { CARDS, DOCTRINE, GENERIC_CARDS, NATION_DOCTRINES, deckFor, describeCard } from '../doctrine';
import { BLURB, NATION_DOCTRINE, ROSTER } from './japan';

describe('Japan', () => {
  it('fields three distinct generals with real traits and a bio each', () => {
    expect(NATION_ROSTERS.japan).toBe(ROSTER);
    expect(rosterFor('japan', 'federation')).toBe(ROSTER);
    expect(ROSTER).toHaveLength(COMMANDER_RULES.perNation);
    expect(new Set(ROSTER.map((g) => g.name)).size).toBe(ROSTER.length);
    for (const g of ROSTER) {
      expect(COMMANDER_TRAITS[g.trait], g.name).toBeDefined();
      expect(g.bio.length).toBeGreaterThan(10);
    }
  });

  it('registers six signature cards with unique ids, integer costs the bank can pay, and effects in words', () => {
    expect(NATION_DOCTRINES.japan).toBe(NATION_DOCTRINE);
    expect(NATION_DOCTRINE.nation).toBe('japan');
    const ids = NATION_DOCTRINE.cards.map((c) => c.id);
    expect(ids).toHaveLength(6);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of NATION_DOCTRINE.cards) {
      expect(c.id.startsWith('japan_'), c.id).toBe(true);
      expect(GENERIC_CARDS[c.id], c.id).toBeUndefined();
      expect(CARDS[c.id]).toBe(c);
      expect(Number.isInteger(c.cost) && c.cost >= 1 && c.cost <= DOCTRINE.cpCap, c.id).toBe(true);
      expect(Number.isInteger(c.duration) && c.duration >= 1, c.id).toBe(true);
      expect(c.effects.length).toBeGreaterThan(0);
      for (const e of c.effects) for (const v of Object.values(e)) if (typeof v === 'number') expect(Number.isInteger(v), c.id).toBe(true);
      expect(`${c.name} ${c.flavour}`).not.toMatch(/kamikaze/i);
      expect(describeCard(c).length).toBeGreaterThan(0);
    }
  });

  it('draws from a valid deck of 14 to 18 known cards that mixes its own with generic ones', () => {
    const deck = NATION_DOCTRINE.deck;
    expect(deck.length).toBeGreaterThanOrEqual(14);
    expect(deck.length).toBeLessThanOrEqual(18);
    for (const id of deck) expect(CARDS[id], id).toBeDefined();
    for (const c of NATION_DOCTRINE.cards) expect(deck, c.id).toContain(c.id);
    expect(deck.some((id) => GENERIC_CARDS[id])).toBe(true);
    expect(deck).not.toContain('kamikaze_swarm');
    expect(deckFor('japan', 'federation')).toEqual([...deck].sort());
    expect(BLURB.length).toBeGreaterThan(20);
  });
});

import { describe, expect, it } from 'vitest';
import { CARDS, DOCTRINE, GENERIC_CARDS, NATION_DOCTRINES, deckFor, describeCard } from '../doctrine';
import { COMMANDER_RULES, COMMANDER_TRAITS, NATION_ROSTERS, rosterFor } from '../commanders';
import { BIOS, BLURB, CARDS as CHINA_CARDS, DOCTRINE as CHINA, ROSTER } from './china';

describe('China', () => {
  it('is registered: its roster and its deck replace the union defaults', () => {
    expect(NATION_ROSTERS.china).toBe(ROSTER);
    expect(rosterFor('china', 'union')).toBe(ROSTER);
    expect(NATION_DOCTRINES.china).toBe(CHINA);
    expect(CHINA.nation).toBe('china');
    expect(deckFor('china', 'union')).toEqual([...CHINA.deck].sort());
    expect(BLURB.length).toBeGreaterThan(40);
  });

  it('fields three named generals with real traits, one of them a beach-landing specialist', () => {
    expect(ROSTER).toHaveLength(COMMANDER_RULES.perNation);
    expect(new Set(ROSTER.map((g) => g.name)).size).toBe(ROSTER.length);
    for (const g of ROSTER) {
      expect(COMMANDER_TRAITS[g.trait], g.name).toBeDefined();
      expect(BIOS[g.name], g.name).toMatch(/\S/);
    }
    expect(ROSTER.some((g) => (COMMANDER_TRAITS[g.trait]?.effect.amphibious ?? 0) > 0)).toBe(true);
  });

  it('has five or six signature cards, new ids, integer costs the Command Points can pay', () => {
    expect(CHINA_CARDS.length).toBeGreaterThanOrEqual(5);
    expect(CHINA_CARDS.length).toBeLessThanOrEqual(6);
    expect(new Set(CHINA_CARDS.map((c) => c.id)).size).toBe(CHINA_CARDS.length);
    for (const c of CHINA_CARDS) {
      expect(GENERIC_CARDS[c.id], c.id).toBeUndefined();
      expect(CARDS[c.id]).toBe(c);
      expect(Number.isInteger(c.cost) && c.cost >= 1 && c.cost <= DOCTRINE.cpCap, c.id).toBe(true);
      expect(Number.isInteger(c.duration) && c.duration >= 1, c.id).toBe(true);
      expect(c.effects.length).toBeGreaterThan(0);
      expect(c.name).toMatch(/\S/);
      expect(c.flavour).toMatch(/\S/);
      expect(describeCard(c)).toMatch(/\S/);
      for (const e of c.effects) for (const v of Object.values(e)) if (typeof v === 'number') expect(Number.isInteger(v), `${c.id} ${e.kind}`).toBe(true);
    }
  });

  it('draws from a 14 to 18 card deck of known cards, every signature card in it', () => {
    expect(CHINA.deck.length).toBeGreaterThanOrEqual(14);
    expect(CHINA.deck.length).toBeLessThanOrEqual(18);
    for (const id of CHINA.deck) expect(CARDS[id], id).toBeDefined();
    for (const c of CHINA_CARDS) expect(CHINA.deck).toContain(c.id);
    // Some generic cards too: a national hand, not a national monopoly.
    expect(CHINA.deck.some((id) => GENERIC_CARDS[id])).toBe(true);
  });

  it('can strike Taipei from Beijing (7 hexes), which the generic Missile Barrage cannot', () => {
    const reach = (id: string) => CARDS[id]!.effects.flatMap((e) => (e.kind === 'card_strike' ? [e.range] : []))[0]!;
    expect(reach('rocket_force_salvo')).toBeGreaterThanOrEqual(7);
    expect(reach('missile_barrage')).toBeLessThan(7);
  });
});

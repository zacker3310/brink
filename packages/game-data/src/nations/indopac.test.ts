import { describe, expect, it } from 'vitest';
import { NATION_BLURB } from '../blurbs';
import { COMMANDER_RULES, COMMANDER_TRAITS, GENERIC_ROSTER, NATION_ROSTERS, rosterFor } from '../commanders';
import { CARDS, DOCTRINE, GENERIC_CARDS, NATION_DOCTRINES, deckFor, describeCard } from '../doctrine';
import { LEADERS, leaderFor, NATION_LEADERS, type LineTrigger } from '../leaders';
import * as australia from './australia';
import * as india from './india';
import * as indonesia from './indonesia';
import * as pakistan from './pakistan';

// The four new powers of the Indo-Pacific South (China reuses its own file). Each is one nation
// file: a blurb, three generals, five or six signature cards and a deck, and an invented leader.

const POWERS = [
  { id: 'india', government: 'federation', prefix: 'india_', file: india },
  { id: 'pakistan', government: 'directorate', prefix: 'pak_', file: pakistan },
  { id: 'indonesia', government: 'union', prefix: 'indo_', file: indonesia },
  { id: 'australia', government: 'commonwealth', prefix: 'aus_', file: australia },
] as const;

const TRIGGERS: readonly LineTrigger[] = ['hostile', 'wary', 'neutral', 'cordial', 'friendly', 'accept', 'reject_mood', 'reject_terms', 'reject_strength', 'took_city', 'betrayed', 'winning', 'war', 'peace', 'deal', 'demand', 'defied', 'paid'];

describe.each(POWERS)('$id', ({ id, government, prefix, file }) => {
  it('is registered: its roster, deck, blurb and leader replace the government defaults', () => {
    expect(NATION_ROSTERS[id]).toBe(file.ROSTER);
    expect(rosterFor(id, government)).toBe(file.ROSTER);
    expect(NATION_DOCTRINES[id]).toBe(file.DOCTRINE);
    expect(file.DOCTRINE.nation).toBe(id);
    expect(deckFor(id, government)).toEqual([...file.DOCTRINE.deck].sort());
    expect(NATION_BLURB[id]).toBe(file.BLURB);
    expect(file.BLURB.length).toBeGreaterThan(40);
    expect(NATION_LEADERS[id]).toBe(file.LEADER.id);
    expect(leaderFor(id, government)).toBe(file.LEADER);
  });

  it('fields three distinct invented generals with real traits and a bio each', () => {
    expect(file.ROSTER).toHaveLength(COMMANDER_RULES.perNation);
    expect(new Set(file.ROSTER.map((g) => g.name)).size).toBe(file.ROSTER.length);
    const taken = new Set(
      [...Object.values(GENERIC_ROSTER), ...Object.entries(NATION_ROSTERS).filter(([n]) => n !== id).map(([, r]) => r)].flatMap((r) => r.map((g) => g.name)),
    );
    for (const g of file.ROSTER) {
      expect(COMMANDER_TRAITS[g.trait], g.name).toBeDefined();
      expect(taken.has(g.name), g.name).toBe(false);
      expect(g.bio.length).toBeGreaterThan(10);
    }
  });

  it('has five or six signature cards: prefixed ids, integer costs the Command Points can pay, effects in words', () => {
    expect(file.CARDS.length).toBeGreaterThanOrEqual(5);
    expect(file.CARDS.length).toBeLessThanOrEqual(6);
    expect(new Set(file.CARDS.map((c) => c.id)).size).toBe(file.CARDS.length);
    for (const c of file.CARDS) {
      expect(c.id.startsWith(prefix), c.id).toBe(true);
      expect(GENERIC_CARDS[c.id], c.id).toBeUndefined();
      expect(CARDS[c.id]).toBe(c);
      expect(Number.isInteger(c.cost) && c.cost >= 1 && c.cost <= DOCTRINE.cpCap, c.id).toBe(true);
      expect(Number.isInteger(c.duration) && c.duration >= 1, c.id).toBe(true);
      expect(c.effects.length).toBeGreaterThan(0);
      expect(c.flavour.length).toBeGreaterThan(10);
      expect(describeCard(c)).toMatch(/\S/);
      const numbers = JSON.stringify(c.effects).match(/-?\d+(\.\d+)?/g) ?? [];
      for (const v of numbers) expect(Number.isInteger(Number(v)), `${c.id} ${v}`).toBe(true);
      // A card that strikes or sabotages a hex must aim at an enemy one.
      if (c.effects.some((e) => e.kind === 'card_strike' || e.kind === 'sabotage')) expect(c.target, c.id).toBe('enemy-hex');
      if (c.effects.some((e) => e.kind === 'entrench')) expect(c.target, c.id).toBe('own-hex');
    }
  });

  it('draws from a 14 to 18 card deck of known cards, every signature card in it, some generic ones too', () => {
    const deck = file.DOCTRINE.deck;
    expect(deck.length).toBeGreaterThanOrEqual(14);
    expect(deck.length).toBeLessThanOrEqual(18);
    for (const cid of deck) expect(CARDS[cid], cid).toBeDefined();
    for (const c of file.CARDS) expect(deck).toContain(c.id);
    expect(deck.some((cid) => GENERIC_CARDS[cid])).toBe(true);
    const counts = new Map<string, number>();
    for (const cid of deck) counts.set(cid, (counts.get(cid) ?? 0) + 1);
    for (const [cid, n] of counts) expect(n, cid).toBeLessThanOrEqual(2);
  });

  it('is led by an invented head of government with a line for every occasion', () => {
    const l = file.LEADER;
    expect(LEADERS[l.id]).toBe(l);
    expect(l.name).toMatch(/\S+ \S+/);
    expect(l.bio.length).toBeGreaterThan(20);
    for (const t of TRIGGERS) {
      expect(l.lines[t].length, t).toBeGreaterThan(0);
      for (const line of l.lines[t]) expect(line, t).toMatch(/\S/);
    }
    // No two leaders share a name.
    expect(Object.values(LEADERS).filter((x) => x.name === l.name)).toHaveLength(1);
  });
});

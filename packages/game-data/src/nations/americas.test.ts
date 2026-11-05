import { describe, expect, it } from 'vitest';
import { COMMANDER_RULES, COMMANDER_TRAITS, GENERIC_ROSTER, NATION_ROSTERS, rosterFor } from '../commanders';
import { CARDS, deckFor, DOCTRINE, GENERIC_CARDS, NATION_DOCTRINES } from '../doctrine';
import { NATION_BLURB } from '../blurbs';
import { leaderFor, LEADERS, NATION_LEADERS, type LineTrigger } from '../leaders';
import * as argentina from './argentina';
import * as brazil from './brazil';
import * as canada from './canada';
import * as colombia from './colombia';
import * as mexico from './mexico';

// The Americas' five new powers (docs/americas.md), each held to what the United States' file is
// held to (usa.test.ts), plus its own invented leader.

const TRIGGERS: readonly LineTrigger[] = ['hostile', 'wary', 'neutral', 'cordial', 'friendly', 'accept', 'reject_mood', 'reject_terms', 'reject_strength', 'took_city', 'betrayed', 'winning', 'war', 'peace', 'deal', 'demand', 'defied', 'paid'];

const NATIONS = [
  { id: 'canada', prefix: 'ca_', file: canada },
  { id: 'mexico', prefix: 'mx_', file: mexico },
  { id: 'colombia', prefix: 'co_', file: colombia },
  { id: 'brazil', prefix: 'br_', file: brazil },
  { id: 'argentina', prefix: 'ar_', file: argentina },
] as const;

describe.each(NATIONS)('$id', ({ id, prefix, file }) => {
  it('fields its own three generals, each with a known trait and a bio', () => {
    expect(NATION_ROSTERS[id]).toBe(file.ROSTER);
    expect(rosterFor(id, file.GOVERNMENT)).toBe(file.ROSTER);
    expect(file.ROSTER).toHaveLength(COMMANDER_RULES.perNation);
    const generic = new Set(Object.values(GENERIC_ROSTER).flatMap((r) => r.map((g) => g.name)));
    const others = new Set(Object.entries(NATION_ROSTERS).filter(([n]) => n !== id).flatMap(([, r]) => r.map((g) => g.name)));
    for (const g of file.ROSTER) {
      expect(COMMANDER_TRAITS[g.trait], g.name).toBeDefined();
      expect(generic.has(g.name) || others.has(g.name), g.name).toBe(false);
      expect(g.bio.length).toBeGreaterThan(10);
    }
    expect(new Set(file.ROSTER.map((g) => g.trait)).size).toBe(file.ROSTER.length);
  });

  it('holds a valid deck of known cards at sensible costs', () => {
    expect(NATION_DOCTRINES[id]?.nation).toBe(id);
    expect(file.DECK.length).toBeGreaterThanOrEqual(14);
    expect(file.DECK.length).toBeLessThanOrEqual(18);
    for (const c of file.DECK) expect(CARDS[c], c).toBeDefined();
    expect(deckFor(id, file.GOVERNMENT)).toEqual([...file.DECK].sort());
    expect(file.CARDS.length).toBeGreaterThanOrEqual(5);
    expect(new Set(file.CARDS.map((c) => c.id)).size).toBe(file.CARDS.length);
    for (const c of file.CARDS) {
      expect(c.id.startsWith(prefix), c.id).toBe(true);
      expect(GENERIC_CARDS[c.id], c.id).toBeUndefined();
      expect(CARDS[c.id]).toBe(c);
      expect(file.DECK, c.id).toContain(c.id);
      expect(Number.isInteger(c.cost) && c.cost >= 1 && c.cost <= DOCTRINE.cpCap, c.id).toBe(true);
      expect(Number.isInteger(c.duration) && c.duration >= 1, c.id).toBe(true);
      expect(c.effects.length).toBeGreaterThan(0);
      expect(c.flavour.length).toBeGreaterThan(10);
      const numbers = JSON.stringify(c.effects).match(/-?\d+(\.\d+)?/g) ?? [];
      for (const v of numbers) expect(Number.isInteger(Number(v)), `${c.id} ${v}`).toBe(true);
      if (c.effects.some((e) => e.kind === 'card_strike')) expect(c.target).toBe('enemy-hex');
    }
    const counts = new Map<string, number>();
    for (const c of file.DECK) counts.set(c, (counts.get(c) ?? 0) + 1);
    for (const [c, n] of counts) expect(n, c).toBeLessThanOrEqual(2);
  });

  it('is led by its own invented leader, who has a line for everything, and has a blurb', () => {
    expect(NATION_LEADERS[id]).toBe(file.LEADER.id);
    expect(LEADERS[file.LEADER.id]).toBe(file.LEADER);
    expect(leaderFor(id, file.GOVERNMENT)).toBe(file.LEADER);
    for (const t of TRIGGERS) expect(file.LEADER.lines[t]?.length, `${id} ${t}`).toBeGreaterThan(0);
    const names = Object.values(LEADERS).map((l) => l.name);
    expect(names.filter((n) => n === file.LEADER.name)).toHaveLength(1);
    expect(NATION_BLURB[id]).toBe(file.BLURB);
    expect(file.BLURB.length).toBeGreaterThan(40);
  });
});

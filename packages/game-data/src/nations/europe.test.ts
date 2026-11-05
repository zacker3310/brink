import { describe, expect, it } from 'vitest';
import type { GovernmentId } from '@brink/contracts';
import { COMMANDER_RULES, COMMANDER_TRAITS, GENERIC_ROSTER, NATION_ROSTERS, rosterFor } from '../commanders';
import { CARDS, DOCTRINE, GENERIC_CARDS, NATION_DOCTRINES, deckFor, describeCard } from '../doctrine';
import { NATION_BLURB } from '../blurbs';
import { GOVERNMENT_LEADERS, LEADERS, leaderFor, NATION_LEADERS } from '../leaders';
import * as france from './france';
import * as germany from './germany';
import * as poland from './poland';
import * as turkey from './turkey';
import * as uk from './uk';

// The European powers' country files (the theatre: docs/europe.md). Russia's is shared with the
// Pacific and tested in russia.test.ts.
const POWERS: [id: string, government: GovernmentId, file: typeof uk][] = [
  ['uk', 'commonwealth', uk],
  ['france', 'federation', france],
  ['germany', 'commonwealth', germany],
  ['poland', 'federation', poland],
  ['turkey', 'directorate', turkey],
];

describe.each(POWERS)('%s', (id, government, file) => {
  it('fields three distinct fictional generals with real traits and a bio each', () => {
    expect(NATION_ROSTERS[id]).toBe(file.ROSTER);
    expect(rosterFor(id, government)).toBe(file.ROSTER);
    expect(file.ROSTER).toHaveLength(COMMANDER_RULES.perNation);
    expect(new Set(file.ROSTER.map((g) => g.name)).size).toBe(file.ROSTER.length);
    const generic = new Set(Object.values(GENERIC_ROSTER).flatMap((r) => r.map((g) => g.name)));
    const elsewhere = new Set(Object.entries(NATION_ROSTERS).filter(([n]) => n !== id).flatMap(([, r]) => r.map((g) => g.name)));
    for (const g of file.ROSTER) {
      expect(COMMANDER_TRAITS[g.trait], g.name).toBeDefined();
      expect(generic.has(g.name) || elsewhere.has(g.name), g.name).toBe(false);
      expect(g.bio.length).toBeGreaterThan(20);
    }
  });

  it('registers six signature cards, prefixed and unique, with integer costs the bank can pay', () => {
    expect(NATION_DOCTRINES[id]).toBe(file.NATION_DOCTRINE);
    expect(file.NATION_DOCTRINE.nation).toBe(id);
    const ids = file.NATION_DOCTRINE.cards.map((c) => c.id);
    expect(ids).toHaveLength(6);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of file.NATION_DOCTRINE.cards) {
      expect(c.id.startsWith(`${id}_`), c.id).toBe(true);
      expect(GENERIC_CARDS[c.id], c.id).toBeUndefined();
      expect(CARDS[c.id]).toBe(c);
      expect(Number.isInteger(c.cost) && c.cost >= 1 && c.cost <= DOCTRINE.cpCap, c.id).toBe(true);
      expect(Number.isInteger(c.duration) && c.duration >= 1, c.id).toBe(true);
      expect(c.effects.length).toBeGreaterThan(0);
      const nums = JSON.stringify(c.effects).match(/-?\d+(\.\d+)?/g) ?? [];
      for (const n of nums) expect(Number.isInteger(Number(n)), `${c.id}: ${n}`).toBe(true);
      expect(c.flavour.length).toBeGreaterThan(10);
      expect(describeCard(c).length).toBeGreaterThan(0);
    }
  });

  it('draws from a 14-18 card deck of known cards that holds every signature card and some generic ones', () => {
    const deck = deckFor(id, government);
    expect(deck).toEqual([...file.NATION_DOCTRINE.deck].sort());
    expect(deck.length).toBeGreaterThanOrEqual(14);
    expect(deck.length).toBeLessThanOrEqual(18);
    for (const c of deck) expect(CARDS[c], c).toBeDefined();
    for (const c of file.NATION_DOCTRINE.cards) expect(deck, c.id).toContain(c.id);
    expect(deck.some((c) => GENERIC_CARDS[c])).toBe(true);
    expect(deck.some((c) => CARDS[c]!.cost <= DOCTRINE.cpStart)).toBe(true);
  });

  it('has a blurb and its own invented leader, who has a line for everything', () => {
    expect(NATION_BLURB[id]).toBe(file.BLURB);
    expect(file.BLURB.length).toBeGreaterThan(40);
    expect(NATION_LEADERS[id]).toBe(file.LEADER.id);
    expect(LEADERS[file.LEADER.id]).toBe(file.LEADER);
    expect(leaderFor(id, government)).toBe(file.LEADER);
    expect(file.LEADER.id).not.toBe(GOVERNMENT_LEADERS[government]);
    for (const [trigger, lines] of Object.entries(file.LEADER.lines)) expect(lines.length, trigger).toBeGreaterThan(0);
    expect(Object.keys(file.LEADER.lines).sort()).toEqual(Object.keys(LEADERS.gov_union!.lines).sort());
  });
});

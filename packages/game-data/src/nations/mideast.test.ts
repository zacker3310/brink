import { describe, expect, it } from 'vitest';
import type { GovernmentId } from '@brink/contracts';
import { NATION_BLURB } from '../blurbs';
import { COMMANDER_RULES, COMMANDER_TRAITS, NATION_ROSTERS, rosterFor } from '../commanders';
import { CARDS, DOCTRINE, GENERIC_CARDS, NATION_DOCTRINES, deckFor, describeCard } from '../doctrine';
import { leaderFor, LEADERS, NATION_LEADERS } from '../leaders';
import * as egypt from './egypt';
import * as iran from './iran';
import * as nigeria from './nigeria';
import * as saudi from './saudi-arabia';
import * as southAfrica from './south-africa';
import * as turkey from './turkey';

// The six powers of the Middle East and Africa (docs/mideast.md): each a country file in the
// Japan pattern (blurb, three generals with a bio, six signature cards, a deck), registered in the
// rosters, the doctrines, the blurbs and the leaders, with an invented leader of its own.

const POWERS: readonly { id: string; prefix: string; government: GovernmentId; file: typeof turkey }[] = [
  { id: 'turkey', prefix: 'turkey_', government: 'federation', file: turkey },
  { id: 'iran', prefix: 'iran_', government: 'union', file: iran },
  { id: 'saudi-arabia', prefix: 'saudi_', government: 'commonwealth', file: saudi },
  { id: 'egypt', prefix: 'egypt_', government: 'directorate', file: egypt },
  { id: 'nigeria', prefix: 'nigeria_', government: 'union', file: nigeria },
  { id: 'south-africa', prefix: 'southafrica_', government: 'commonwealth', file: southAfrica },
];

describe.each(POWERS)('$id', ({ id, prefix, government, file }) => {
  it('fields three distinct generals with real traits and a bio each', () => {
    expect(NATION_ROSTERS[id]).toBe(file.ROSTER);
    expect(rosterFor(id, government)).toBe(file.ROSTER);
    expect(file.ROSTER).toHaveLength(COMMANDER_RULES.perNation);
    expect(new Set(file.ROSTER.map((g) => g.name)).size).toBe(file.ROSTER.length);
    for (const g of file.ROSTER) {
      expect(COMMANDER_TRAITS[g.trait], g.name).toBeDefined();
      expect(g.bio.length).toBeGreaterThan(10);
    }
  });

  it('registers six signature cards with unique ids, integer costs the bank can pay, and effects in words', () => {
    const d = file.NATION_DOCTRINE;
    expect(NATION_DOCTRINES[id]).toBe(d);
    expect(d.nation).toBe(id);
    const ids = d.cards.map((c) => c.id);
    expect(ids).toHaveLength(6);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of d.cards) {
      expect(c.id.startsWith(prefix), c.id).toBe(true);
      expect(GENERIC_CARDS[c.id], c.id).toBeUndefined();
      expect(CARDS[c.id]).toBe(c);
      expect(Number.isInteger(c.cost) && c.cost >= 1 && c.cost <= DOCTRINE.cpCap, c.id).toBe(true);
      expect(Number.isInteger(c.duration) && c.duration >= 1, c.id).toBe(true);
      expect(c.effects.length).toBeGreaterThan(0);
      for (const e of c.effects) for (const v of Object.values(e)) if (typeof v === 'number') expect(Number.isInteger(v), c.id).toBe(true);
      expect(describeCard(c).length).toBeGreaterThan(0);
    }
  });

  it('draws from a valid deck of 14 to 18 known cards that mixes its own with generic ones', () => {
    const deck = file.NATION_DOCTRINE.deck;
    expect(deck.length).toBeGreaterThanOrEqual(14);
    expect(deck.length).toBeLessThanOrEqual(18);
    for (const c of deck) expect(CARDS[c], c).toBeDefined();
    for (const c of file.NATION_DOCTRINE.cards) expect(deck, c.id).toContain(c.id);
    expect(deck.some((c) => GENERIC_CARDS[c])).toBe(true);
    expect(deckFor(id, government)).toEqual([...deck].sort());
  });

  it('has a blurb and an invented leader of its own with a line for every trigger', () => {
    expect(NATION_BLURB[id]).toBe(file.BLURB);
    expect(file.BLURB.length).toBeGreaterThan(20);
    const leader = leaderFor(id, government);
    expect(NATION_LEADERS[id]).toBe(leader.id);
    expect(LEADERS[leader.id]).toBe(leader);
    expect(leader.id.startsWith(prefix)).toBe(true);
    for (const [trigger, lines] of Object.entries(leader.lines)) {
      expect(lines.length, trigger).toBeGreaterThan(0);
      for (const l of lines) expect(l.trim().length, trigger).toBeGreaterThan(0);
    }
  });
});

describe('the Middle East and Africa powers together', () => {
  it('share no general, leader or card name', () => {
    const generals = POWERS.flatMap((p) => p.file.ROSTER.map((g) => g.name));
    expect(new Set(generals).size).toBe(generals.length);
    const leaders = POWERS.map((p) => leaderFor(p.id, p.government).name);
    expect(new Set(leaders).size).toBe(leaders.length);
    const cards = POWERS.flatMap((p) => p.file.NATION_DOCTRINE.cards.map((c) => c.name));
    expect(new Set(cards).size).toBe(cards.length);
  });
});

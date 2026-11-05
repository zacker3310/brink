import { describe, expect, it } from 'vitest';
import type { WorldState } from '@brink/contracts';
import { UNITS } from '@brink/game-data';
import { ALL_THEATRES, createScenario, FIRST_CONTACT } from '@brink/scenarios';
import { sortedKeys } from '@brink/simulation';
import { blackFilesInvariants, invariants } from './invariants';

// The shared invariants catch what every theatre's own list caught before the lists were merged
// into one: a turn-1 world of every campaign holds them all, and each world broken one way at a
// time is caught. A check the merge once dropped (a formation's strength a whole number, which the
// Black Files' and the Indo-Pacific's own lists had) is pinned here, so it cannot go again unseen.

const check = (w: WorldState) => [...invariants(w), ...blackFilesInvariants(w)];

/** A power's formation, not aboard a ship, whose class matches: the first by id. */
function formationOf(w: WorldState, pick: (cls: (typeof UNITS)[keyof typeof UNITS]) => boolean): string {
  const id = sortedKeys(w.formations).find((f) => !w.formations[f]!.aboard && !w.nations[w.formations[f]!.owner]!.minor && pick(UNITS[w.formations[f]!.unitClass]));
  if (!id) throw new Error('no such formation');
  return id;
}

describe('the soaks\' shared invariants', () => {
  for (const t of ALL_THEATRES) {
    describe(t.name, () => {
      const fresh = createScenario(t.id, 1);
      const broken = (edit: (w: WorldState) => void) => {
        const w = structuredClone(fresh);
        edit(w);
        return check(w);
      };

      it('a turn-1 world holds every invariant', () => {
        expect(check(fresh)).toEqual([]);
      });

      it('a fractional, a zero and an outsize strength are each caught', () => {
        const f = formationOf(fresh, (u) => !!u.ground);
        expect(broken((w) => (w.formations[f]!.strength = 512.5))).toContain(`${f} strength 512.5`);
        expect(broken((w) => (w.formations[f]!.strength = 0))).toContain(`${f} strength 0`);
        expect(broken((w) => (w.formations[f]!.strength = 1001))).toContain(`${f} strength 1001`);
      });

      it('a stat out of range, experience among them, and a fractional stockpile are caught', () => {
        const f = formationOf(fresh, (u) => !!u.ground);
        expect(broken((w) => (w.formations[f]!.experience = 101))).toContain(`${f} stat out of range`);
        expect(broken((w) => (w.formations[f]!.morale = 50.5))).toContain(`${f} stat out of range`);
        const n = t.powers[0]!.id;
        expect(broken((w) => (w.nations[n]!.stockpile.credits += 0.5))).toContain(`${n} credits=${fresh.nations[n]!.stockpile.credits + 0.5}`);
      });

      it('a soldier in the water and a ship ashore are caught', () => {
        const water = sortedKeys(fresh.tiles).find((k) => fresh.tiles[k]!.terrain === 'water')!;
        const inland = sortedKeys(fresh.tiles).find((k) => fresh.tiles[k]!.terrain !== 'water' && !fresh.tiles[k]!.port)!;
        const soldier = formationOf(fresh, (u) => !!u.ground);
        expect(broken((w) => (w.formations[soldier]!.key = water))).toContain(`${soldier} in water`);
        // Every theatre puts to sea: each power has a navy in port at turn 1.
        const ship = formationOf(fresh, (u) => !!u.naval);
        expect(broken((w) => (w.formations[ship]!.key = inland))).toContain(`${ship} ship ashore`);
      });
    });
  }

  it('First Contact: a power fielding the Visitors\' kind of unit is caught', () => {
    const w = createScenario(FIRST_CONTACT.id, 1);
    const f = formationOf(w, (u) => !!u.ground);
    w.formations[f]!.unitClass = 'walker';
    expect(check(w)).toContain(`${f} walker of ${w.formations[f]!.owner}`);
  });
});

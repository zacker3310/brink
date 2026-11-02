import { describe, expect, it } from 'vitest';
import { hexKey } from '@brink/map';
import { makeWorld, own, site } from './fixture.test-util';
import { resolveTurn } from './resolve';

// Take every city in a country and the whole country is yours: its ground and its bases fall to the
// power holding most of its cities, the old capital breaking a tie (docs/GAME_DESIGN.md).
describe('conquest of a country', () => {
  it('hands what is left of a fallen nation to the power holding most of its cities', () => {
    const w = makeWorld(8, 6, ['a', 'b', 'c']);
    const k = hexKey;
    // b: a country of four hexes, two cities and a depot; a has taken both cities, c nothing.
    own(w, 'b', [k(3, 2), k(4, 2), k(5, 2), k(5, 3)]);
    site(w, 'b-depot', k(5, 3), 'b', 'depot', 2);
    for (const id of ['b-home', 'b-two']) {
      if (id === 'b-two') site(w, id, k(4, 2), 'b', 'city');
      const s = w.sites[id]!;
      s.owner = 'a';
      w.tiles[s.key]!.owner = 'a';
    }
    const r = resolveTurn(w, []);
    expect(r.world.nations.b!.eliminated).toBe(true);
    for (const key of [k(3, 2), k(5, 2), k(5, 3)]) expect(r.world.tiles[key]!.owner, key).toBe('a');
    expect(r.world.sites['b-depot']!.owner).toBe('a');
    expect(r.events).toContainEqual({ kind: 'elimination', nation: 'b', annexedBy: 'a' });
    expect(Object.values(r.world.tiles).some((t) => t.owner === 'b')).toBe(false);
  });

  it('gives a split country to whoever holds most of its cities, the old capital breaking a tie', () => {
    const w = makeWorld(8, 6, ['a', 'b', 'c']);
    const k = hexKey;
    own(w, 'b', [k(3, 2), k(4, 2)]);
    site(w, 'b-capital', k(3, 2), 'b', 'capital');
    // a holds b's home city, c holds b's capital: one each, so the capital decides.
    w.sites['b-home']!.owner = 'a';
    w.tiles[w.sites['b-home']!.key]!.owner = 'a';
    w.sites['b-capital']!.owner = 'c';
    w.tiles[k(3, 2)]!.owner = 'c';
    const r = resolveTurn(w, []);
    expect(r.world.tiles[k(4, 2)]!.owner).toBe('c');
  });
});

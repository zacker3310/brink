import { describe, expect, it } from 'vitest';
import type { GameEvent, WorldState } from '@brink/contracts';
import { hexKey } from '@brink/map';
import { makeWorld, orders, setRelation, unit } from './fixture.test-util';
import { resolveTurn } from './resolve';

const k = hexKey;

function movement(events: GameEvent[], id: string) {
  return events.find((e) => e.kind === 'movement' && e.formation === id);
}

/** The same world with nations a and b swapped, for symmetry checks. */
function mirror(world: WorldState): WorldState {
  const swap = (n: string) => (n === 'a' ? 'b' : n === 'b' ? 'a' : n);
  const w = JSON.parse(JSON.stringify(world)) as WorldState;
  for (const f of Object.values(w.formations)) f.owner = swap(f.owner);
  return w;
}

describe('simultaneous movement', () => {
  it('moves along the ordered path', () => {
    const w = makeWorld();
    unit(w, 'a1', 'a', 'infantry', k(1, 1));
    const r = resolveTurn(w, [orders(w, 'a', { a1: { type: 'move', path: [k(2, 1), k(3, 1)] } })]);
    expect(r.world.formations.a1!.key).toBe(k(3, 1));
    expect(movement(r.events, 'a1')).toMatchObject({ path: [k(2, 1), k(3, 1)], halted: null });
  });

  it('enemies swapping hexes meet head-on and neither passes', () => {
    const w = makeWorld();
    unit(w, 'a1', 'a', 'infantry', k(2, 2));
    unit(w, 'b1', 'b', 'infantry', k(3, 2));
    const r = resolveTurn(w, [
      orders(w, 'a', { a1: { type: 'move', path: [k(3, 2)] } }),
      orders(w, 'b', { b1: { type: 'move', path: [k(2, 2)] } }),
    ]);
    expect(r.world.formations.a1!.key).toBe(k(2, 2));
    expect(r.world.formations.b1!.key).toBe(k(3, 2));
    const meeting = r.events.find((e) => e.kind === 'engagement' && e.type === 'meeting');
    expect(meeting).toBeDefined();
  });

  it('a hex entered by two enemies at the same instant goes to neither', () => {
    const w = makeWorld();
    unit(w, 'a1', 'a', 'infantry', k(2, 2));
    unit(w, 'b1', 'b', 'infantry', k(4, 2));
    const r = resolveTurn(w, [
      orders(w, 'a', { a1: { type: 'move', path: [k(3, 2)] } }),
      orders(w, 'b', { b1: { type: 'move', path: [k(3, 2)] } }),
    ]);
    expect(r.world.formations.a1!.key).toBe(k(2, 2));
    expect(r.world.formations.b1!.key).toBe(k(4, 2));
    expect(movement(r.events, 'a1')).toMatchObject({ halted: 'contested' });
    expect(movement(r.events, 'b1')).toMatchObject({ halted: 'contested' });
  });

  it('the faster formation reaches a contested hex first', () => {
    const w = makeWorld();
    unit(w, 'a1', 'a', 'recon', k(2, 2));
    unit(w, 'b1', 'b', 'infantry', k(4, 2));
    const r = resolveTurn(w, [
      orders(w, 'a', { a1: { type: 'recon', path: [k(3, 2)] } }),
      orders(w, 'b', { b1: { type: 'move', path: [k(3, 2)] } }),
    ]);
    expect(r.world.formations.a1!.key).toBe(k(3, 2));
    expect(movement(r.events, 'b1')).toMatchObject({ halted: 'enemy', path: [] });
  });

  it('formations stop on making contact with the enemy', () => {
    const w = makeWorld();
    unit(w, 'a1', 'a', 'armor', k(1, 3));
    unit(w, 'b1', 'b', 'infantry', k(5, 3));
    const r = resolveTurn(w, [orders(w, 'a', { a1: { type: 'move', path: [k(2, 3), k(3, 3), k(4, 3)] } })]);
    // 4,3 is the first hex next to the enemy at 5,3.
    expect(r.world.formations.a1!.key).toBe(k(4, 3));
    const short = resolveTurn(w, [orders(w, 'a', { a1: { type: 'move', path: [k(2, 3), k(3, 3), k(4, 3), k(4, 4)] } })]);
    expect(short.world.formations.a1!.key).toBe(k(4, 3));
    expect(movement(short.events, 'a1')).toMatchObject({ halted: 'contact' });
  });

  it('respects the stacking limit without ranking nations', () => {
    const w = makeWorld();
    unit(w, 'a1', 'a', 'infantry', k(3, 3));
    unit(w, 'a2', 'a', 'infantry', k(3, 3));
    unit(w, 'a3', 'a', 'infantry', k(2, 3));
    unit(w, 'a4', 'a', 'infantry', k(2, 4));
    const r = resolveTurn(w, [
      orders(w, 'a', { a3: { type: 'move', path: [k(3, 3)] }, a4: { type: 'move', path: [k(3, 3)] } }),
    ]);
    const there = Object.values(r.world.formations).filter((f) => f.key === k(3, 3));
    expect(there).toHaveLength(3);
    expect(movement(r.events, 'a4')).toMatchObject({ halted: 'stacking' });
  });

  it('does not enter the territory of a nation it is at peace with', () => {
    const w = makeWorld();
    setRelation(w, 'a', 'b', 'peace');
    w.tiles[k(3, 3)]!.owner = 'b';
    unit(w, 'a1', 'a', 'infantry', k(2, 3));
    const r = resolveTurn(w, [orders(w, 'a', { a1: { type: 'move', path: [k(3, 3)] } })]);
    expect(r.world.formations.a1!.key).toBe(k(2, 3));
  });

  it('conflicts resolve the same way when the nations are swapped', () => {
    const w = makeWorld();
    unit(w, 'x', 'a', 'mechanized', k(1, 2));
    unit(w, 'y', 'b', 'armor', k(5, 2));
    unit(w, 'z', 'b', 'infantry', k(3, 4));
    const sub = (world: WorldState, nx: string, ny: string) => [
      orders(world, nx, { x: { type: 'move', path: [k(2, 2), k(3, 2), k(4, 2)] } }),
      orders(world, ny, { y: { type: 'move', path: [k(4, 2), k(3, 2), k(2, 2)] }, z: { type: 'move', path: [k(3, 3), k(3, 2)] } }),
    ];
    const r1 = resolveTurn(w, sub(w, 'a', 'b'));
    const m = mirror(w);
    const r2 = resolveTurn(m, sub(m, 'b', 'a'));
    for (const id of ['x', 'y', 'z']) expect(r2.world.formations[id]?.key).toBe(r1.world.formations[id]?.key);
  });
});

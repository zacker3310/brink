import { describe, expect, it } from 'vitest';
import { hexKey } from '@brink/map';
import { attackerPower } from './combat';
import { makeWorld, orders, own, setRelation, setTerrain, site, unit } from './fixture.test-util';
import { nationModifiers } from './rules';
import { resolveTurn } from './resolve';
import { supplyDistances } from './supply';
import { checkFormationOrder, lockOrders } from './validate';

// The navy (docs/pacific.md): ships sail the sea and put in at ports, transports carry armies and
// land them, carriers carry aircraft, fleets strike, and sea lanes carry supply from a port.

const k = hexKey;

/**
 * Two coasts across a strait. West (q 0..2) is a's, with a port at 2,2; the sea is q 3..6; east
 * (q 7..9) is b's, with its home city at 9,5. Every hex is plains unless made water here.
 */
function strait() {
  const w = makeWorld(10, 6, ['a', 'b']);
  for (let q = 3; q <= 6; q++) for (let r = 0; r < 6; r++) setTerrain(w, k(q, r), 'water');
  for (let q = 0; q <= 2; q++) own(w, 'a', [0, 1, 2, 3, 4, 5].map((r) => k(q, r)));
  for (let q = 7; q <= 9; q++) own(w, 'b', [0, 1, 2, 3, 4, 5].map((r) => k(q, r)));
  for (let r = 0; r < 6; r++) {
    w.tiles[k(3, r)]!.owner = null;
  }
  site(w, 'a-port', k(2, 2), 'a', 'city');
  w.tiles[k(2, 2)]!.port = true;
  // Even victory points, so no turn here ends the match by domination.
  w.sites['b-home']!.victoryPoints = 10;
  return w;
}

describe('the navy', () => {
  it('sails the sea and puts in at a port, never crosses land; armies never walk into the sea', () => {
    const w = strait();
    unit(w, 'f', 'a', 'fleet', k(3, 2));
    unit(w, 'i', 'a', 'infantry', k(2, 1));
    expect(checkFormationOrder(w, 'a', 'f', { type: 'move', path: [k(4, 2), k(5, 2)] })).toBeNull();
    expect(checkFormationOrder(w, 'a', 'f', { type: 'move', path: [k(2, 2)] })).toBeNull(); // the port
    expect(checkFormationOrder(w, 'a', 'f', { type: 'move', path: [k(2, 3)] })).toMatch(/impassable/);
    expect(checkFormationOrder(w, 'a', 'i', { type: 'move', path: [k(3, 1)] })).toMatch(/impassable/);
    const r = resolveTurn(w, [orders(w, 'a', { f: { type: 'move', path: [k(4, 2), k(5, 2)] } })]);
    expect(r.world.formations.f!.key).toBe(k(5, 2));
  });

  it('boards a transport in port, sails with it, and lands on the far shore', () => {
    const w = strait();
    unit(w, 't', 'a', 'transport', k(2, 2));
    unit(w, 'i', 'a', 'infantry', k(2, 2));
    expect(checkFormationOrder(w, 'a', 'i', { type: 'embark', carrier: 't' })).toBeNull();
    let r = resolveTurn(w, [orders(w, 'a', { i: { type: 'embark', carrier: 't' }, t: { type: 'move', path: [k(3, 2), k(4, 2)] } })]);
    expect(r.world.formations.i!.aboard).toBe('t');
    expect(r.world.formations.i!.key).toBe(k(4, 2));
    // Next turn: sail on to the far coast, then the turn after go ashore.
    const w2 = r.world;
    r = resolveTurn(w2, [orders(w2, 'a', { t: { type: 'move', path: [k(5, 2), k(6, 2)] } })]);
    expect(r.world.formations.i!.key).toBe(k(6, 2));
    const w3 = r.world;
    expect(checkFormationOrder(w3, 'a', 'i', { type: 'move', path: [k(7, 2)] })).toBeNull();
    r = resolveTurn(w3, [orders(w3, 'a', { i: { type: 'move', path: [k(7, 2)] } })]);
    expect(r.world.formations.i!.aboard).toBeUndefined();
    expect(r.world.formations.i!.key).toBe(k(7, 2));
  });

  it('carries only what fits: two ground formations in a transport, aircraft only in a carrier', () => {
    const w = strait();
    unit(w, 't', 'a', 'transport', k(2, 2));
    unit(w, 'c', 'a', 'carrier', k(2, 2));
    unit(w, 'i1', 'a', 'infantry', k(2, 2), { aboard: 't' });
    unit(w, 'i2', 'a', 'infantry', k(2, 2), { aboard: 't' });
    unit(w, 'i3', 'a', 'infantry', k(2, 2));
    unit(w, 'h', 'a', 'air', k(2, 2));
    expect(checkFormationOrder(w, 'a', 'i3', { type: 'embark', carrier: 't' })).toMatch(/full/);
    expect(checkFormationOrder(w, 'a', 'i3', { type: 'embark', carrier: 'c' })).toMatch(/cannot carry/);
    expect(checkFormationOrder(w, 'a', 'h', { type: 'embark', carrier: 't' })).toMatch(/cannot carry/);
    expect(checkFormationOrder(w, 'a', 'h', { type: 'embark', carrier: 'c' })).toBeNull();
  });

  it('storms a beach from the ship at a penalty', () => {
    const w = strait();
    const ashore = unit(w, 'x', 'a', 'infantry', k(6, 2));
    const afloat = unit(w, 'y', 'a', 'infantry', k(6, 2), { aboard: 't' });
    const defender = unit(w, 'd', 'b', 'infantry', k(7, 2));
    const ctx = { terrain: 'plains' as const, river: false, tileOwner: 'b', spotted: true, airSupport: false, artillerySupport: false, attackerMods: nationModifiers(w.nations.a!), defenderMods: () => nationModifiers(w.nations.b!), defending: () => false };
    expect(attackerPower([afloat], [defender], ctx)).toBeLessThan(attackerPower([ashore], [defender], ctx));
    unit(w, 't', 'a', 'transport', k(6, 2));
    delete w.formations.x;
    expect(checkFormationOrder(w, 'a', 'y', { type: 'attack', target: k(7, 2), path: [] })).toBeNull();
    expect(checkFormationOrder(w, 'a', 'y', { type: 'attack', target: k(8, 2), path: [k(7, 3)] })).toMatch(/straight from the ship/);
  });

  it('sends its passengers down with it when a transport is sunk', () => {
    const w = strait();
    unit(w, 't', 'a', 'transport', k(5, 2), { strength: 30 });
    unit(w, 'i', 'a', 'infantry', k(5, 2), { aboard: 't' });
    unit(w, 'fb', 'b', 'fleet', k(7, 2));
    const r = resolveTurn(w, [orders(w, 'b', { fb: { type: 'attack', target: k(5, 2), path: [] } })]);
    expect(r.world.formations.t).toBeUndefined();
    expect(r.world.formations.i).toBeUndefined();
    expect(r.events.filter((e) => e.kind === 'destroyed').map((e) => (e.kind === 'destroyed' ? e.formation : ''))).toEqual(expect.arrayContaining(['t', 'i']));
  });

  it('supplies the far shore by sea lane from a port, until an enemy fleet sits on the lane', () => {
    const w = strait();
    unit(w, 'i', 'a', 'infantry', k(7, 0));
    w.tiles[k(7, 0)]!.owner = 'a';
    expect(supplyDistances(w, 'a').has(k(7, 0))).toBe(true);
    // Every crossing blocked: the lanes run through q 3..6; b's fleets hold column 4.
    for (let r = 0; r < 6; r++) unit(w, `fb${r}`, 'b', 'fleet', k(4, r));
    expect(supplyDistances(w, 'a').has(k(7, 0))).toBe(false);
  });

  it('never lets supply put to sea except from a port', () => {
    const w = strait();
    w.tiles[k(2, 2)]!.port = false;
    unit(w, 'i', 'a', 'infantry', k(7, 0));
    w.tiles[k(7, 0)]!.owner = 'a';
    expect(supplyDistances(w, 'a').has(k(7, 0))).toBe(false);
  });

  it('lands aircraft on a carrier that sails the same turn, and they strike from where it goes', () => {
    const w = strait();
    unit(w, 'c', 'a', 'carrier', k(3, 2));
    unit(w, 'h', 'a', 'air', k(2, 2));
    expect(checkFormationOrder(w, 'a', 'h', { type: 'move', path: [k(3, 2)] })).toBeNull();
    const r = resolveTurn(w, [orders(w, 'a', { h: { type: 'move', path: [k(3, 2)] }, c: { type: 'move', path: [k(4, 2), k(5, 2)] } })]);
    expect(r.world.formations.h!.aboard).toBe('c');
    expect(r.world.formations.h!.key).toBe(k(5, 2));
  });

  it('builds ships only in a port', () => {
    const w = strait();
    w.nations.a!.stockpile = { credits: 2000, energy: 2000, materials: 2000, food: 2000 };
    const ok = lockOrders(w, [orders(w, 'a', {}, { recruit: [{ siteId: 'a-port', unitClass: 'fleet' }] })]);
    expect(ok.rejected).toEqual([]);
    const no = lockOrders(w, [orders(w, 'a', {}, { recruit: [{ siteId: 'a-home', unitClass: 'transport' }] })]);
    expect(no.rejected.map((e) => (e.kind === 'order_rejected' ? e.reason : ''))).toEqual(['a-home is not a port']);
  });

  it('puts to sea when its port falls, with its passengers', () => {
    const w = strait();
    unit(w, 't', 'a', 'transport', k(2, 2), { organization: 5 });
    unit(w, 'p', 'a', 'infantry', k(2, 2), { aboard: 't', organization: 5, strength: 200 });
    for (const [id, q, r] of [['b1', 1, 2], ['b2', 2, 1], ['b3', 1, 3]] as const) unit(w, id, 'b', 'armor', k(q, r));
    setRelation(w, 'a', 'b', 'war');
    const r = resolveTurn(w, [
      orders(w, 'b', {
        b1: { type: 'attack', target: k(2, 2), path: [] },
        b2: { type: 'attack', target: k(2, 2), path: [] },
        b3: { type: 'attack', target: k(2, 2), path: [] },
      }),
    ]);
    const t = r.world.formations.t;
    if (t) {
      expect(r.world.tiles[t.key]!.terrain).toBe('water');
      if (r.world.formations.p) expect(r.world.formations.p.key).toBe(t.key);
    } else expect(r.world.formations.p).toBeUndefined();
  });
});

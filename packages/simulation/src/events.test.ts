import { describe, expect, it } from 'vitest';
import { EVENT_CHANCE, EVENTS } from '@brink/game-data';
import type { WorldState } from '@brink/contracts';
import { hexKey } from '@brink/map';
import { applyEvent, drawsEvent } from './events';
import { makeWorld, orders, unit } from './fixture.test-util';
import { resolveTurn } from './resolve';
import { lockOrders } from './validate';

const k = hexKey;

/** First turn on which nation `a` draws an event with the fixture seed. */
function firstDraw(w: WorldState): number {
  for (let t = 1; t < 200; t++) if (drawsEvent(w.seed, t, 'a')) return t;
  throw new Error('no draw in 200 turns');
}

describe('world events', () => {
  it('draws from a seeded roll at roughly the stated rate', () => {
    let hits = 0;
    for (let t = 1; t <= 1000; t++) if (drawsEvent(42, t, 'a')) hits++;
    expect(hits).toBeGreaterThan(EVENT_CHANCE * 10 - 60);
    expect(hits).toBeLessThan(EVENT_CHANCE * 10 + 60);
    expect(drawsEvent(42, 7, 'a')).toBe(drawsEvent(42, 7, 'a'));
  });

  it('a draw at the end of a turn becomes a pending event in the next view', () => {
    const w = makeWorld();
    w.turn = firstDraw(w);
    const r = resolveTurn(w, []);
    const pending = r.world.nations.a!.event;
    expect(pending).toMatchObject({ turn: w.turn });
    expect(EVENTS[pending!.id]).toBeDefined();
    expect(r.observations.a!.self.event).toEqual(pending);
    expect(r.reports.a!.events).toContainEqual({ kind: 'world_event', nation: 'a', event: pending!.id, choice: null });
    expect(r.reports.b!.events.some((e) => e.kind === 'world_event' && e.nation === 'a')).toBe(false);
  });

  it('applies the chosen option and clears the event', () => {
    const w = makeWorld();
    w.nations.a!.event = { id: 'oil_strike', turn: 0 };
    const before = w.nations.a!.stockpile.credits;
    const lease = resolveTurn(w, [orders(w, 'a', {}, { eventChoice: 1 })]);
    const pass = resolveTurn(w, [orders(w, 'a')]);
    expect(lease.world.nations.a!.event ?? null).toBeNull();
    expect(lease.world.nations.a!.stockpile.credits - pass.world.nations.a!.stockpile.credits).toBe(150);
    expect(pass.world.nations.a!.stockpile.energy - lease.world.nations.a!.stockpile.energy).toBe(120);
    expect(lease.events).toContainEqual({ kind: 'world_event', nation: 'a', event: 'oil_strike', choice: 1 });
    expect(before).toBeGreaterThan(0);
  });

  it('no answer takes the first option', () => {
    const w = makeWorld();
    w.nations.a!.event = { id: 'volunteers', turn: 0 };
    unit(w, 'a1', 'a', 'infantry', k(0, 0), { morale: 50 });
    const r = resolveTurn(w, []);
    expect(r.events).toContainEqual({ kind: 'world_event', nation: 'a', event: 'volunteers', choice: 0 });
    expect(r.world.formations.a1!.morale).toBeGreaterThanOrEqual(58);
  });

  it('never drives a stockpile or stability below zero', () => {
    const w = makeWorld();
    const n = w.nations.a!;
    n.stockpile.credits = 30;
    n.stability = 3;
    applyEvent(w, 'a', 'general_strike', 1);
    expect(n.stockpile.credits).toBe(0);
    applyEvent(w, 'a', 'general_strike', 0);
    expect(n.stability).toBe(0);
  });

  it('rejects an answer when nothing is pending, or an answer that is not an option', () => {
    const w = makeWorld();
    const none = lockOrders(w, [orders(w, 'a', {}, { eventChoice: 1 })]);
    expect(none.orders.a!.eventChoice).toBeUndefined();
    expect(none.rejected.some((e) => e.kind === 'order_rejected' && /event/.test(e.reason))).toBe(true);
    w.nations.a!.event = { id: 'defector', turn: 0 };
    const bad = lockOrders(w, [orders(w, 'a', {}, { eventChoice: 2 as 0 })]);
    expect(bad.orders.a!.eventChoice).toBeUndefined();
    const good = lockOrders(w, [orders(w, 'a', {}, { eventChoice: 1 })]);
    expect(good.orders.a!.eventChoice).toBe(1);
  });

  it('does not draw a new event on the turn one was answered', () => {
    const w = makeWorld();
    w.turn = firstDraw(w);
    w.nations.a!.event = { id: 'defector', turn: w.turn - 1 };
    const r = resolveTurn(w, [orders(w, 'a', {}, { eventChoice: 0 })]);
    expect(r.world.nations.a!.event ?? null).toBeNull();
  });
});

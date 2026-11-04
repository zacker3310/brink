import { describe, expect, it } from 'vitest';
import type { NationOrders } from '@brink/contracts';
import { RULESET_VERSION } from '@brink/game-data';
import { PACIFIC_ID } from '@brink/scenarios';
import { hashState, treatyIn } from '@brink/simulation';
import { parseSave, serializeSave } from './save';
import { GameSession } from './session';

const none = (nation: string, turn: number, diplomacy: NationOrders['diplomacy'] = []): NationOrders => ({ nation, turn, formations: {}, recruit: [], diplomacy });

describe('leaders in a session', () => {
  it('resumes a 2.5.0 campaign from before leaders with clean slates, and they start remembering', () => {
    const s = GameSession.create(PACIFIC_ID, 9, 'japan');
    s.advance();
    // What ruleset 2.5.0 wrote: no memories on the world.
    const old = JSON.parse(serializeSave(s.toSave('old', '2026-11-04T12:00:00Z')));
    old.rulesetVersion = '2.5.0';
    old.world.rulesetVersion = '2.5.0';
    delete old.world.memories;
    old.hash = hashState(old.world);
    const loaded = parseSave(JSON.stringify(old));
    expect(loaded.migratedFrom).toBe('2.5.0');
    expect(loaded.world.rulesetVersion).toBe(RULESET_VERSION);
    expect(loaded.world.memories).toEqual({});
    expect(loaded.hash).toBe(hashState(loaded.world));
    // Loading twice changes nothing: the migration is keyed on the field being there.
    expect(parseSave(serializeSave({ ...loaded, migratedFrom: undefined } as never)).world).toEqual(loaded.world);
    const resumed = GameSession.fromSave(loaded);
    for (let i = 0; i < 4; i++) {
      const r = resumed.advance();
      expect(r.events.filter((e) => e.kind === 'order_rejected')).toEqual([]);
    }
    const v = resumed.view();
    // Every rival power's leader has a mood toward the player, with its reasons.
    for (const n of ['china', 'russia', 'usa']) {
      expect(v.moods![n]!.leader).toBeTruthy();
      expect(v.moods![n]!.mood).toBe(Math.max(-100, Math.min(100, v.moods![n]!.reasons.reduce((a, r) => a + r.value, 0))));
    }
  });

  it("a leader's answer in the screen is the one they give when the turn resolves", () => {
    const s = GameSession.create(PACIFIC_ID, 5, 'usa', [], { difficulty: 'easy' });
    const v = s.view();
    const friend = Object.keys(v.relations).find((n) => v.relations[n] !== 'war' && !v.nations[n]!.minor)!;
    // A fair trade agreement: agreed now, signed when the turn ends.
    const yes = s.negotiate('usa', friend, { kind: 'trade' });
    expect(yes).toEqual({ accept: true, reason: 'agreed' });
    // A swindle: refused.
    const greedy = { give: { food: 20 }, get: { credits: 400 } };
    const no = s.negotiate('usa', friend, { kind: 'exchange', terms: greedy });
    expect(no.accept).toBe(false);
    const r = s.advance(none('usa', v.turn, [{ target: friend, action: 'propose_trade' }]));
    expect(r.events.filter((e) => e.kind === 'order_rejected')).toEqual([]);
    expect(treatyIn(s.snapshot().treaties, 'trade', 'usa', friend, s.turn - 1)).toBeDefined();

    const t = s.view().turn;
    const before = s.snapshot().nations.usa!.stockpile.credits;
    const r2 = s.advance(none('usa', t, [{ target: friend, action: 'propose_exchange', terms: greedy }]));
    expect(r2.events.some((e) => e.kind === 'exchange' && !e.void)).toBe(false);
    expect(s.snapshot().nations.usa!.stockpile.credits).toBeLessThan(before + 400);
  });

  it('a peace the screen grants on Easy is made at once', () => {
    const s = GameSession.create(PACIFIC_ID, 5, 'usa', [], { difficulty: 'easy' });
    const v = s.view();
    const enemy = Object.keys(v.relations).find((n) => v.relations[n] === 'war' && !v.nations[n]!.minor)!;
    expect(s.negotiate('usa', enemy, { kind: 'ceasefire' }).accept).toBe(true);
    s.advance(none('usa', v.turn, [{ target: enemy, action: 'propose_ceasefire' }]));
    expect(s.view().relations[enemy]).toBe('peace');
    expect(treatyIn(s.view().treaties, 'ceasefire', 'usa', enemy, s.turn)).toBeDefined();
  });
});

import { describe, expect, it } from 'vitest';
import { MERIDIAN_ID } from '@brink/scenarios';
import { hashState } from '@brink/simulation';
import { parseSave, SaveError, serializeSave } from './save';
import { GameSession } from './session';

describe('GameSession', () => {
  it('plays a turn with a human and three AIs', () => {
    const s = GameSession.create(MERIDIAN_ID, 11, 'selmar');
    const view = s.view();
    expect(Object.values(view.formations).every((f) => f.owner === 'selmar')).toBe(true);
    const r = s.advance({ nation: 'selmar', turn: view.turn, formations: {}, recruit: [], diplomacy: [] });
    expect(s.turn).toBe(2);
    expect(Object.keys(r.reports)).toEqual(['selmar']);
    expect(r.reports.selmar!.events.some((e) => e.kind === 'economy' && e.nation === 'selmar')).toBe(true);
  });

  it('round-trips a save to an identical hash and identical future', () => {
    const s = GameSession.create(MERIDIAN_ID, 4, 'aster');
    for (let i = 0; i < 3; i++) s.advance();
    const text = serializeSave(s.toSave('slot 1', '2026-10-25T12:00:00Z'));
    const loaded = GameSession.fromSave(parseSave(text));
    expect(loaded.hash).toBe(s.hash);
    expect(loaded.reports()).toEqual(s.reports());
    expect(loaded.advance().hash).toBe(s.advance().hash);
  });

  it('refuses incompatible or tampered saves', () => {
    const s = GameSession.create(MERIDIAN_ID, 4, 'aster');
    const save = s.toSave('x', '2026-10-25T12:00:00Z');
    expect(() => parseSave('nope')).toThrow(SaveError);
    expect(() => parseSave(serializeSave({ ...save, rulesetVersion: '0.9.0' }))).toThrow(/ruleset/);
    expect(() => parseSave(serializeSave({ ...save, saveVersion: 99 }))).toThrow(/newer/);
    const tampered = JSON.parse(serializeSave(save));
    tampered.world.nations.aster.stockpile.credits = 99999;
    expect(() => parseSave(JSON.stringify(tampered))).toThrow(/corrupted/);
    expect(hashState(save.world)).toBe(save.hash);
  });
});

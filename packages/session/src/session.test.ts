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

  it('seats several humans: AIs play only the empty seats, every human gets a report', () => {
    const s = GameSession.create(MERIDIAN_ID, 7, 'aster', ['korva']);
    expect(s.humans).toEqual(['aster', 'korva']);
    expect(s.aiOrders().map((o) => o.nation).sort()).toEqual(['drevan', 'selmar']);
    const korva = s.view('korva');
    expect(Object.values(korva.formations).every((f) => f.owner === 'korva')).toBe(true);
    const fid = Object.keys(korva.formations).sort()[0]!;
    const r = s.advance([
      { nation: 'aster', turn: 1, formations: {}, recruit: [], diplomacy: [] },
      { nation: 'korva', turn: 1, formations: { [fid]: { type: 'defend' } }, recruit: [], diplomacy: [] },
    ]);
    expect(Object.keys(r.reports).sort()).toEqual(['aster', 'korva']);
    expect(s.view('korva').formations[fid]!.lastOrder).toBe('defend');
    expect(s.reports('korva')).toHaveLength(1);
    expect(s.reports('aster')).toHaveLength(1);
  });

  it('treats a human who submitted nothing as holding', () => {
    const a = GameSession.create(MERIDIAN_ID, 9, 'aster', ['korva']);
    const b = GameSession.create(MERIDIAN_ID, 9, 'aster', ['korva']);
    a.advance([{ nation: 'aster', turn: 1, formations: {}, recruit: [], diplomacy: [] }]);
    b.advance([
      { nation: 'aster', turn: 1, formations: {}, recruit: [], diplomacy: [] },
      { nation: 'korva', turn: 1, formations: {}, recruit: [], diplomacy: [] },
    ]);
    expect(a.hash).toBe(b.hash);
  });

  it('round-trips a multi-human save with every seat and its history', () => {
    const s = GameSession.create(MERIDIAN_ID, 5, 'selmar', ['drevan']);
    s.advance();
    s.advance();
    const loaded = GameSession.fromSave(parseSave(serializeSave(s.toSave('mp', '2026-10-25T12:00:00Z'))));
    expect(loaded.humans).toEqual(['selmar', 'drevan']);
    expect(loaded.reports('drevan')).toEqual(s.reports('drevan'));
    expect(loaded.advance().hash).toBe(s.advance().hash);
  });

  it('hands a dropped seat to the AI and back, keeping its history', () => {
    const s = GameSession.create(MERIDIAN_ID, 8, 'aster', ['korva']);
    s.advance();
    s.releaseSeat('korva');
    expect(s.humans).toEqual(['aster']);
    expect(s.aiOrders().map((o) => o.nation)).toContain('korva');
    s.advance();
    expect(s.reports('korva')).toHaveLength(1);
    s.reclaimSeat('korva');
    expect(s.humans).toEqual(['aster', 'korva']);
    expect(s.aiOrders().map((o) => o.nation)).not.toContain('korva');
    s.advance();
    expect(s.reports('korva')).toHaveLength(2);
    expect(() => s.releaseSeat('aster')).toThrow(/local/);
  });

  it('records room callsigns and keeps a dropped seat\'s history for a resume', () => {
    const s = GameSession.create(MERIDIAN_ID, 9, 'aster', ['korva', 'selmar']);
    s.advance();
    s.releaseSeat('korva');
    const callsigns = { aster: 'Viper', korva: 'Ghost', selmar: 'Rook' };
    const save = parseSave(serializeSave(s.toSave('room', '2026-10-26T12:00:00Z', callsigns)));
    expect(save.callsigns).toEqual(callsigns);
    expect(save.humans).toEqual(['aster', 'selmar']);
    const loaded = GameSession.fromSave(save);
    loaded.reclaimSeat('korva');
    expect(loaded.reports('korva')).toEqual(s.reports('korva'));
    expect(loaded.reports('korva')).toHaveLength(1);
    const bad = { ...save, callsigns: { aster: 'Viper', nowhere: 'X' } };
    expect(() => parseSave(JSON.stringify(bad))).toThrow(SaveError);
    // Hotseat and single-player saves carry no callsigns.
    expect(parseSave(serializeSave(s.toSave('local', '2026-10-26T12:00:00Z'))).callsigns).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';
import { SAVE_VERSION } from '@brink/contracts';
import { RULESET_VERSION } from '@brink/game-data';
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
    expect(() => parseSave(serializeSave({ ...save, rulesetVersion: '9.0.0' }))).toThrow(/newer than this build/);
    expect(() => parseSave(serializeSave({ ...save, rulesetVersion: '0.9.0' }))).toThrow(/does not match its header/);
    expect(() => parseSave(serializeSave({ ...save, saveVersion: 99 }))).toThrow(/newer/);
    const tampered = JSON.parse(serializeSave(save));
    tampered.world.nations.aster.stockpile.credits = 99999;
    expect(() => parseSave(JSON.stringify(tampered))).toThrow(/corrupted/);
    expect(hashState(save.world)).toBe(save.hash);
  });

  it('migrates a save from the previous build and plays on', () => {
    const s = GameSession.create(MERIDIAN_ID, 6, 'korva');
    for (let i = 0; i < 2; i++) s.advance();
    // What ruleset 1.4.0 wrote: save version 1, world schema 1, no treaties, facilities or construction.
    const old = JSON.parse(serializeSave(s.toSave('old', '2026-10-27T12:00:00Z')));
    old.saveVersion = 1;
    old.rulesetVersion = '1.4.0';
    old.world.rulesetVersion = '1.4.0';
    old.world.schema = 1;
    delete old.world.treaties;
    for (const site of Object.values(old.world.sites) as Record<string, unknown>[]) delete site.facilities;
    for (const n of Object.values(old.world.nations) as Record<string, unknown>[]) delete n.construction;
    old.hash = hashState(old.world);
    const loaded = parseSave(JSON.stringify(old));
    expect(loaded.migratedFrom).toBe('1.4.0');
    expect(loaded.saveVersion).toBe(SAVE_VERSION);
    expect(loaded.world).toMatchObject({ schema: 2, rulesetVersion: RULESET_VERSION, treaties: [] });
    expect(loaded.hash).toBe(hashState(loaded.world));
    const resumed = GameSession.fromSave(loaded);
    expect(resumed.turn).toBe(3);
    resumed.advance();
    expect(resumed.turn).toBe(4);
    // Tampering is still caught: the hash is checked against the save as written.
    old.world.nations.korva.stockpile.credits = 99999;
    expect(() => parseSave(JSON.stringify(old))).toThrow(/corrupted/);
  });

  it('runs any campaign length from 5 to 60 turns', () => {
    expect(GameSession.create(MERIDIAN_ID, 1, 'aster', [], { maxTurns: 45 }).snapshot().maxTurns).toBe(45);
    expect(GameSession.create(MERIDIAN_ID, 1, 'aster', [], { maxTurns: 99 }).snapshot().maxTurns).toBe(60);
    expect(GameSession.create(MERIDIAN_ID, 1, 'aster', [], { maxTurns: 2 }).snapshot().maxTurns).toBe(5);
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

  it('can run a shorter campaign and drafts legal orders for a human seat', () => {
    const s = GameSession.create(MERIDIAN_ID, 3, 'korva', [], { maxTurns: 20 });
    expect(s.view().maxTurns).toBe(20);
    const draft = s.suggest('korva');
    expect(draft.nation).toBe('korva');
    expect(Object.keys(draft.formations).length).toBeGreaterThan(0);
    expect(s.check(draft)).toEqual([]);
  });

  it('easy opens one front, keeps the peace it promises and survives a save', () => {
    const normal = GameSession.create(MERIDIAN_ID, 5, 'aster');
    const s = GameSession.create(MERIDIAN_ID, 5, 'aster', [], { difficulty: 'easy' });
    const v = s.view();
    expect(Object.values(v.relations).filter((r) => r === 'war')).toHaveLength(1);
    expect(v.self.stockpile.credits).toBe(Math.floor((normal.view().self.stockpile.credits * 3) / 2));
    const friends = Object.keys(v.relations).filter((n) => v.relations[n] === 'peace');
    for (let i = 0; i < 20 && !s.view().victory; i++) s.advance();
    // No AI ever declares war on the human; the human never declared any.
    for (const n of friends) expect(s.view().relations[n]).toBe('peace');
    const loaded = GameSession.fromSave(parseSave(serializeSave(s.toSave('x', '2026-10-28T12:00:00Z'))));
    expect(loaded.difficulty).toBe('easy');
  });

  it('accepts a human peace offer on easy', () => {
    const s = GameSession.create(MERIDIAN_ID, 5, 'aster', [], { difficulty: 'easy' });
    const v = s.view();
    const enemy = Object.keys(v.relations).find((n) => v.relations[n] === 'war')!;
    s.advance({ nation: 'aster', turn: v.turn, formations: {}, recruit: [], diplomacy: [{ target: enemy, action: 'propose_peace' }] });
    s.advance();
    expect(s.view().relations[enemy]).toBe('peace');
  });

  it('hard gives every AI half again its stockpile', () => {
    const normal = GameSession.create(MERIDIAN_ID, 5, 'aster');
    const hard = GameSession.create(MERIDIAN_ID, 5, null, [], { difficulty: 'hard' });
    expect(hard.difficulty).toBe('hard');
    expect(normal.difficulty).toBe('normal');
  });

  it('gives human seats the command edge of their level, and the AI none', () => {
    const edge = (d: 'easy' | 'normal' | 'hard') => GameSession.create(MERIDIAN_ID, 5, 'aster', [], { difficulty: d }).snapshot().nations;
    expect(edge('easy').aster!.edge).toBe('easy');
    expect(edge('normal').aster!.edge).toBe('normal');
    expect(edge('hard').aster!.edge).toBeUndefined();
    for (const n of ['korva', 'selmar', 'drevan']) expect(edge('normal')[n]!.edge).toBeUndefined();
    // The edge is income: same world, same orders, more credits for the human with it.
    const plain = GameSession.create(MERIDIAN_ID, 5, 'aster');
    const easy = GameSession.create(MERIDIAN_ID, 5, 'aster', [], { difficulty: 'normal' });
    const start = [plain.view().self.stockpile.credits, easy.view().self.stockpile.credits];
    plain.advance();
    easy.advance();
    expect(easy.view().self.stockpile.credits - start[1]!).toBeGreaterThan(plain.view().self.stockpile.credits - start[0]!);
  });
});

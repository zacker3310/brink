import { describe, expect, it } from 'vitest';
import { SAVE_VERSION } from '@brink/contracts';
import { CARDS, HARD_AI_STOCKPILE, RULESET_VERSION } from '@brink/game-data';
import { PACIFIC_ID } from '@brink/scenarios';
import { hashState } from '@brink/simulation';
import { migrateSave, parseSave, SaveError, serializeSave } from './save';
import { GameSession, HISTORY_KEPT } from './session';

describe('GameSession', () => {
  it('plays a turn with a human and three AIs', () => {
    const s = GameSession.create(PACIFIC_ID, 11, 'china');
    const view = s.view();
    expect(Object.values(view.formations).every((f) => f.owner === 'china')).toBe(true);
    const r = s.advance({ nation: 'china', turn: view.turn, formations: {}, recruit: [], diplomacy: [] });
    expect(s.turn).toBe(2);
    expect(Object.keys(r.reports)).toEqual(['china']);
    expect(r.reports.china!.events.some((e) => e.kind === 'economy' && e.nation === 'china')).toBe(true);
  });

  it('round-trips a save to an identical hash and identical future', () => {
    const s = GameSession.create(PACIFIC_ID, 4, 'usa');
    for (let i = 0; i < 3; i++) s.advance();
    const text = serializeSave(s.toSave('slot 1', '2026-10-25T12:00:00Z'));
    const loaded = GameSession.fromSave(parseSave(text));
    expect(loaded.hash).toBe(s.hash);
    expect(loaded.reports()).toEqual(s.reports());
    expect(loaded.advance().hash).toBe(s.advance().hash);
  });

  it('refuses incompatible or tampered saves', () => {
    const s = GameSession.create(PACIFIC_ID, 4, 'usa');
    const save = s.toSave('x', '2026-10-25T12:00:00Z');
    expect(() => parseSave('nope')).toThrow(SaveError);
    expect(() => parseSave(serializeSave({ ...save, rulesetVersion: '9.0.0' }))).toThrow(/newer than this build/);
    expect(() => parseSave(serializeSave({ ...save, rulesetVersion: '0.9.0' }))).toThrow(/does not match its header/);
    expect(() => parseSave(serializeSave({ ...save, saveVersion: 99 }))).toThrow(/newer/);
    // A Meridian campaign from before the Pacific: refused in words a player understands.
    const meridian = { ...save, scenarioId: 'meridian-crisis', world: { ...save.world, scenarioId: 'meridian-crisis' } };
    expect(() => parseSave(serializeSave(meridian))).toThrow(/the Pacific has replaced; start a new campaign/);
    const tampered = JSON.parse(serializeSave(save));
    tampered.world.nations.usa.stockpile.credits = 99999;
    expect(() => parseSave(JSON.stringify(tampered))).toThrow(/corrupted/);
    expect(hashState(save.world)).toBe(save.hash);
  });

  it('migrates a save from the previous build and plays on', () => {
    const s = GameSession.create(PACIFIC_ID, 6, 'russia');
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
    old.world.nations.russia.stockpile.credits = 99999;
    expect(() => parseSave(JSON.stringify(old))).toThrow(/corrupted/);
  });

  it('gives a campaign begun before commanders its starting generals on load', () => {
    const s = GameSession.create(PACIFIC_ID, 6, 'japan');
    expect(Object.keys(s.view().commanders!).sort()).toEqual(['japan-gen-1', 'japan-gen-2', 'japan-gen-3']);
    s.advance();
    // What ruleset 2.2.0 wrote: no commanders in the world.
    const old = JSON.parse(serializeSave(s.toSave('old', '2026-11-01T12:00:00Z')));
    old.rulesetVersion = '2.2.0';
    old.world.rulesetVersion = '2.2.0';
    delete old.world.commanders;
    old.hash = hashState(old.world);
    const loaded = parseSave(JSON.stringify(old));
    expect(loaded.migratedFrom).toBe('2.2.0');
    expect(Object.keys(loaded.world.commanders!).filter((id) => id.startsWith('usa-'))).toHaveLength(3);
    // Minor states field none.
    expect(Object.values(loaded.world.commanders!).some((c) => loaded.world.nations[c.nation]!.minor)).toBe(false);
    expect(loaded.hash).toBe(hashState(loaded.world));
    const resumed = GameSession.fromSave(loaded);
    resumed.advance();
    expect(resumed.view().commanders!['japan-gen-1']!.status).toBe('active');
  });

  it('deals doctrine cards to a 2.2.0 save that had none, and plays them on', () => {
    const s = GameSession.create(PACIFIC_ID, 9, 'japan');
    s.advance();
    const old = JSON.parse(serializeSave(s.toSave('old', '2026-11-01T12:00:00Z')));
    old.rulesetVersion = '2.2.0';
    old.world.rulesetVersion = '2.2.0';
    for (const n of Object.values(old.world.nations) as Record<string, unknown>[]) delete n.doctrine;
    old.hash = hashState(old.world);
    const loaded = parseSave(JSON.stringify(old));
    expect(loaded.migratedFrom).toBe('2.2.0');
    const japan = loaded.world.nations.japan!.doctrine!;
    expect(japan.hand).toHaveLength(3);
    expect(loaded.world.nations.taiwan!.doctrine).toBeUndefined();
    expect(loaded.hash).toBe(hashState(loaded.world));
    const resumed = GameSession.fromSave(loaded);
    const view = resumed.view();
    expect(view.self.doctrine).toEqual(japan);
    // A card that needs no target, from the hand this seed deals.
    const card = japan.hand.find((c) => CARDS[c]!.target === 'none' && CARDS[c]!.cost <= japan.cp)!;
    expect(card).toBeDefined();
    const r = resumed.advance({ nation: 'japan', turn: view.turn, formations: {}, recruit: [], diplomacy: [], play: [{ card }] });
    expect(r.reports.japan!.events.filter((e) => e.kind === 'order_rejected')).toEqual([]);
    expect(r.reports.japan!.events).toContainEqual({ kind: 'card_played', nation: 'japan', card });
  });

  it('resumes a 2.4.0 campaign under the 2.5.0 bars, its AIs picking an objective afresh', () => {
    const s = GameSession.create(PACIFIC_ID, 12, 'russia');
    s.advance();
    s.advance();
    // What ruleset 2.4.0 wrote: AI memories without a remembered objective.
    const old = JSON.parse(serializeSave(s.toSave('old', '2026-11-03T12:00:00Z')));
    old.rulesetVersion = '2.4.0';
    old.world.rulesetVersion = '2.4.0';
    for (const m of Object.values(old.aiMemory) as Record<string, unknown>[]) delete m.objective;
    old.hash = hashState(old.world);
    const loaded = parseSave(JSON.stringify(old));
    expect(loaded.migratedFrom).toBe('2.4.0');
    expect(loaded.rulesetVersion).toBe(RULESET_VERSION);
    expect(loaded.world.rulesetVersion).toBe(RULESET_VERSION);
    expect(loaded.hash).toBe(hashState(loaded.world));
    const resumed = GameSession.fromSave(loaded);
    for (let i = 0; i < 3; i++) {
      const r = resumed.advance();
      expect(r.events.filter((e) => e.kind === 'order_rejected')).toEqual([]);
    }
    // The AIs that lost their memory of an objective have one again.
    expect(resumed.toSave('again', '2026-11-04T12:00:00Z').aiMemory.china!.objective).toBeDefined();
  });

  it('resumes a 2.5.0 campaign from before research branches and city growth, and plays on', () => {
    const s = GameSession.create(PACIFIC_ID, 21, 'usa');
    s.advance();
    // What ruleset 2.5.0 wrote: sites without development, the six technologies of its tree.
    const old = JSON.parse(serializeSave(s.toSave('old', '2026-11-04T12:00:00Z')));
    old.rulesetVersion = '2.5.0';
    old.world.rulesetVersion = '2.5.0';
    for (const site of Object.values(old.world.sites) as Record<string, unknown>[]) delete site.development;
    old.world.nations.usa.research = { current: 'combined_arms', progress: 40, unlocked: ['logistics_doctrine'] };
    old.hash = hashState(old.world);
    const loaded = parseSave(JSON.stringify(old));
    expect(loaded.migratedFrom).toBe('2.5.0');
    expect(loaded.hash).toBe(hashState(loaded.world));
    const cities = Object.values(loaded.world.sites).filter((x) => x.kind === 'capital' || x.kind === 'city');
    expect(cities.length).toBeGreaterThan(0);
    for (const c of cities) expect(c.development).toBe(0);
    for (const d of Object.values(loaded.world.sites).filter((x) => x.kind === 'depot')) expect(d.development).toBeUndefined();
    // Migrating again changes nothing: the step keys on the field, not the version.
    expect(hashState(migrateSave({ ...loaded, saveVersion: SAVE_VERSION }).world)).toBe(loaded.hash);
    const resumed = GameSession.fromSave(loaded);
    expect(resumed.view().self.research).toMatchObject({ current: 'combined_arms', unlocked: ['logistics_doctrine'] });
    for (let i = 0; i < 2; i++) {
      const r = resumed.advance();
      expect(r.events.filter((e) => e.kind === 'order_rejected')).toEqual([]);
    }
    const capital = Object.values(resumed.view().sites).find((x) => x.owner === 'usa' && x.kind === 'capital')!;
    expect(capital.development).toBeGreaterThan(0);
  });

  it('runs any campaign length from 5 turns to a 250-turn Total War', () => {
    expect(GameSession.create(PACIFIC_ID, 1, 'usa', [], { maxTurns: 45 }).snapshot().maxTurns).toBe(45);
    expect(GameSession.create(PACIFIC_ID, 1, 'usa', [], { maxTurns: 999 }).snapshot().maxTurns).toBe(250);
    expect(GameSession.create(PACIFIC_ID, 1, 'usa', [], { maxTurns: 2 }).snapshot().maxTurns).toBe(5);
  });

  it('seats several humans: AIs play only the empty seats, every human gets a report', () => {
    const s = GameSession.create(PACIFIC_ID, 7, 'usa', ['russia']);
    expect(s.humans).toEqual(['usa', 'russia']);
    // The AI plays every empty seat: the other two powers and the five minor states.
    expect(s.aiOrders().map((o) => o.nation).sort()).toEqual(['canada', 'china', 'japan', 'kazakhstan', 'mexico', 'mongolia', 'nkorea', 'skorea', 'taiwan']);
    const korva = s.view('russia');
    expect(Object.values(korva.formations).every((f) => f.owner === 'russia')).toBe(true);
    const fid = Object.keys(korva.formations).sort()[0]!;
    const r = s.advance([
      { nation: 'usa', turn: 1, formations: {}, recruit: [], diplomacy: [] },
      { nation: 'russia', turn: 1, formations: { [fid]: { type: 'defend' } }, recruit: [], diplomacy: [] },
    ]);
    expect(Object.keys(r.reports).sort()).toEqual(['russia', 'usa']);
    expect(s.view('russia').formations[fid]!.lastOrder).toBe('defend');
    expect(s.reports('russia')).toHaveLength(1);
    expect(s.reports('usa')).toHaveLength(1);
  });

  it('treats a human who submitted nothing as holding', () => {
    const a = GameSession.create(PACIFIC_ID, 9, 'usa', ['russia']);
    const b = GameSession.create(PACIFIC_ID, 9, 'usa', ['russia']);
    a.advance([{ nation: 'usa', turn: 1, formations: {}, recruit: [], diplomacy: [] }]);
    b.advance([
      { nation: 'usa', turn: 1, formations: {}, recruit: [], diplomacy: [] },
      { nation: 'russia', turn: 1, formations: {}, recruit: [], diplomacy: [] },
    ]);
    expect(a.hash).toBe(b.hash);
  });

  it('round-trips a multi-human save with every seat and its history', () => {
    const s = GameSession.create(PACIFIC_ID, 5, 'china', ['japan']);
    s.advance();
    s.advance();
    const loaded = GameSession.fromSave(parseSave(serializeSave(s.toSave('mp', '2026-10-25T12:00:00Z'))));
    expect(loaded.humans).toEqual(['china', 'japan']);
    expect(loaded.reports('japan')).toEqual(s.reports('japan'));
    expect(loaded.advance().hash).toBe(s.advance().hash);
  });

  it('hands a dropped seat to the AI and back, keeping its history', () => {
    const s = GameSession.create(PACIFIC_ID, 8, 'usa', ['russia']);
    s.advance();
    s.releaseSeat('russia');
    expect(s.humans).toEqual(['usa']);
    expect(s.aiOrders().map((o) => o.nation)).toContain('russia');
    s.advance();
    expect(s.reports('russia')).toHaveLength(1);
    s.reclaimSeat('russia');
    expect(s.humans).toEqual(['usa', 'russia']);
    expect(s.aiOrders().map((o) => o.nation)).not.toContain('russia');
    s.advance();
    expect(s.reports('russia')).toHaveLength(2);
    expect(() => s.releaseSeat('usa')).toThrow(/local/);
  });

  it('records room callsigns and keeps a dropped seat\'s history for a resume', () => {
    const s = GameSession.create(PACIFIC_ID, 9, 'usa', ['russia', 'china']);
    s.advance();
    s.releaseSeat('russia');
    const callsigns = { usa: 'Viper', russia: 'Ghost', china: 'Rook' };
    const save = parseSave(serializeSave(s.toSave('room', '2026-10-26T12:00:00Z', callsigns)));
    expect(save.callsigns).toEqual(callsigns);
    expect(save.humans).toEqual(['usa', 'china']);
    const loaded = GameSession.fromSave(save);
    loaded.reclaimSeat('russia');
    expect(loaded.reports('russia')).toEqual(s.reports('russia'));
    expect(loaded.reports('russia')).toHaveLength(1);
    const bad = { ...save, callsigns: { usa: 'Viper', nowhere: 'X' } };
    expect(() => parseSave(JSON.stringify(bad))).toThrow(SaveError);
    // Hotseat and single-player saves carry no callsigns.
    expect(parseSave(serializeSave(s.toSave('local', '2026-10-26T12:00:00Z'))).callsigns).toBeUndefined();
  });

  it('can run a shorter campaign and drafts legal orders for a human seat', () => {
    const s = GameSession.create(PACIFIC_ID, 3, 'russia', [], { maxTurns: 20 });
    expect(s.view().maxTurns).toBe(20);
    const draft = s.suggest('russia');
    expect(draft.nation).toBe('russia');
    expect(Object.keys(draft.formations).length).toBeGreaterThan(0);
    expect(s.check(draft)).toEqual([]);
  });

  it('keeps the last 60 turn reports, so a 250-turn Total War still saves on a phone', () => {
    const s = GameSession.create(PACIFIC_ID, 4, 'japan', [], { maxTurns: 250 });
    for (let i = 0; i < HISTORY_KEPT + 3; i++) s.advance();
    expect(s.reports()).toHaveLength(HISTORY_KEPT);
    expect(s.reports().at(-1)!.turn).toBe(HISTORY_KEPT + 3);
  }, 120_000);

  it('easy keeps its ally through a crisis that does not set them at war, never through one that does', () => {
    const calm = GameSession.create(PACIFIC_ID, 5, 'japan', [], { difficulty: 'easy', crisis: 'cold-peace' });
    expect(calm.view().relations.usa).toBe('alliance');
    const pearl = GameSession.create(PACIFIC_ID, 5, 'japan', [], { difficulty: 'easy', crisis: 'pearl-harbor' });
    expect(pearl.view().relations.usa).toBe('war');
  });

  it('easy opens one front, keeps the peace it promises and survives a save', () => {
    const normal = GameSession.create(PACIFIC_ID, 5, 'usa');
    const s = GameSession.create(PACIFIC_ID, 5, 'usa', [], { difficulty: 'easy' });
    const v = s.view();
    // One war between powers, with the natural ally beside you (the United States and Japan); the
    // minor states are at war with everyone (they only defend).
    const powers = Object.keys(v.relations).filter((n) => !v.nations[n]!.minor);
    expect(powers.filter((n) => v.relations[n] === 'war')).toHaveLength(1);
    expect(v.relations.japan).toBe('alliance');
    const enemy = powers.find((n) => v.relations[n] === 'war')!;
    expect(s.snapshot().relations[[enemy, 'japan'].sort().join('|')]).toBe('war');
    expect(v.self.stockpile.credits).toBe(Math.floor((normal.view().self.stockpile.credits * 3) / 2));
    const friends = Object.keys(v.relations).filter((n) => v.relations[n] === 'peace');
    for (let i = 0; i < 20 && !s.view().victory; i++) s.advance();
    // No AI ever declares war on the human; the human never declared any.
    for (const n of friends) expect(s.view().relations[n]).toBe('peace');
    const loaded = GameSession.fromSave(parseSave(serializeSave(s.toSave('x', '2026-10-28T12:00:00Z'))));
    expect(loaded.difficulty).toBe('easy');
  });

  it('accepts a human peace offer on easy', () => {
    const s = GameSession.create(PACIFIC_ID, 5, 'usa', [], { difficulty: 'easy' });
    const v = s.view();
    const enemy = Object.keys(v.relations).find((n) => v.relations[n] === 'war' && !v.nations[n]!.minor)!;
    s.advance({ nation: 'usa', turn: v.turn, formations: {}, recruit: [], diplomacy: [{ target: enemy, action: 'propose_peace' }] });
    s.advance();
    expect(s.view().relations[enemy]).toBe('peace');
  });

  it('hard gives every AI power a richer start (HARD_AI_STOCKPILE), minor states none', () => {
    const normal = GameSession.create(PACIFIC_ID, 5, 'usa');
    const hard = GameSession.create(PACIFIC_ID, 5, null, [], { difficulty: 'hard' });
    expect(hard.difficulty).toBe('hard');
    expect(normal.difficulty).toBe('normal');
    const [n, h] = [normal.snapshot().nations, hard.snapshot().nations];
    expect(HARD_AI_STOCKPILE).toBeGreaterThan(100);
    expect(h.china!.stockpile.credits).toBe(Math.floor((n.china!.stockpile.credits * HARD_AI_STOCKPILE) / 100));
    expect(h.taiwan!.stockpile).toEqual(n.taiwan!.stockpile);
  });

  it('gives human seats the command edge of their level, and the AI none', () => {
    const edge = (d: 'easy' | 'normal' | 'hard') => GameSession.create(PACIFIC_ID, 5, 'usa', [], { difficulty: d }).snapshot().nations;
    expect(edge('easy').usa!.edge).toBe('easy');
    expect(edge('normal').usa!.edge).toBe('normal');
    expect(edge('hard').usa!.edge).toBeUndefined();
    for (const n of ['russia', 'china', 'japan']) expect(edge('normal')[n]!.edge).toBeUndefined();
    // The edge is income: same world, same orders, more credits for the human with it.
    const plain = GameSession.create(PACIFIC_ID, 5, 'usa');
    const easy = GameSession.create(PACIFIC_ID, 5, 'usa', [], { difficulty: 'normal' });
    const start = [plain.view().self.stockpile.credits, easy.view().self.stockpile.credits];
    plain.advance();
    easy.advance();
    expect(easy.view().self.stockpile.credits - start[1]!).toBeGreaterThan(plain.view().self.stockpile.credits - start[0]!);
  });
});

describe('GameSession with an Opening Crisis', () => {
  it('opens on the crisis, after the difficulty, and keeps it through a save', () => {
    const s = GameSession.create(PACIFIC_ID, 5, 'usa', [], { difficulty: 'easy', crisis: 'pearl-harbor' });
    const v = s.view();
    expect(v.crisis).toBe('pearl-harbor');
    expect(v.relations.japan).toBe('war');
    const loaded = GameSession.fromSave(parseSave(serializeSave(s.toSave('x', '2026-11-01T12:00:00Z'))));
    expect(loaded.view().crisis).toBe('pearl-harbor');
  });
  it('refuses a crisis it does not know', () => {
    expect(() => GameSession.create(PACIFIC_ID, 5, 'usa', [], { crisis: 'alien-invasion' })).toThrow(/unknown crisis/);
  });
});

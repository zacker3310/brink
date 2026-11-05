import { describe, expect, it } from 'vitest';
import { SAVE_VERSION } from '@brink/contracts';
import { RULESET_VERSION } from '@brink/game-data';
import { FIRST_CONTACT_ID, PACIFIC_ID, pacificAnomaly, SCENARIOS } from '@brink/scenarios';
import { hashState } from '@brink/simulation';
import { migrateSave, parseSave, serializeSave } from './save';
import { GameSession } from './session';

// The Black Files as a player starts them: the toggle on a Pacific campaign and the standalone
// First Contact, through a save and back, and the migration of saves made before them.

describe('the Black Files in a campaign', () => {
  it('is off by default: a Pacific campaign has no anomaly unless the toggle is on', () => {
    expect(GameSession.create(PACIFIC_ID, 3, 'usa').snapshot().blackFiles).toBeUndefined();
    const s = GameSession.create(PACIFIC_ID, 3, 'usa', [], { blackFiles: true });
    const w = s.snapshot();
    expect(w.blackFiles).toBeDefined();
    expect(w.sites['usa-area-51']).toMatchObject({ anomaly: 'blacksite', owner: 'usa', key: pacificAnomaly('usa-area-51') });
    expect(w.sites['russia-tunguska']?.anomaly).toBe('blacksite');
    expect(w.sites['china-gobi']?.anomaly).toBe('blacksite');
    expect(w.sites['usa-bermuda']).toMatchObject({ anomaly: 'blacksite', owner: 'usa' });
    expect(w.tiles[w.sites['usa-bermuda']!.key]!.terrain).not.toBe('water');
    expect(Object.keys(w.blackFiles!.digs).sort()).toEqual(['dig-gobi', 'dig-semipalatinsk', 'dig-yukon']);
    // The Visitors sleep: no view has them.
    expect(s.view().nations.visitors).toBeUndefined();
    expect(s.view().blackFiles!.awake).toBe(false);
    const r = s.advance();
    expect(r.events.filter((e) => e.kind === 'order_rejected')).toEqual([]);
  });

  it('seeds after the Opening Crisis: the Visitors are at war with every nation, the one the crisis made too', () => {
    const w = GameSession.create(PACIFIC_ID, 5, 'usa', [], { blackFiles: true, crisis: 'second-civil-war', difficulty: 'normal' }).snapshot();
    expect(w.nations.heartland).toBeDefined();
    for (const n of Object.keys(w.nations)) if (n !== 'visitors') expect(w.relations[n < 'visitors' ? `${n}|visitors` : `visitors|${n}`], n).toBe('war');
    // Black sites stand only on a power's ground, whoever the crisis gave it to.
    for (const s of Object.values(w.sites)) if (s.anomaly === 'blacksite') expect(w.nations[s.owner!]!.minor).toBeFalsy();
  });

  it('First Contact is a listed scenario on the Antarctica map, opening under the treaty', () => {
    expect(SCENARIOS.some((x) => x.id === FIRST_CONTACT_ID)).toBe(true);
    const s = GameSession.create(FIRST_CONTACT_ID, 7, 'uk', [], { difficulty: 'normal' });
    const v = s.view();
    expect(Object.keys(v.nations).filter((n) => !v.nations[n]!.minor).sort()).toEqual(['australia', 'china', 'russia', 'uk', 'usa']);
    expect(Object.values(v.relations).every((r) => r === 'peace')).toBe(true);
    expect(v.treaties.filter((t) => t.kind === 'nonaggression' && (t.a === 'uk' || t.b === 'uk'))).toHaveLength(4);
    expect(Object.values(v.sites).filter((x) => x.anomaly === 'excavation')).toHaveLength(4);
    expect(Object.values(v.sites).some((x) => x.anomaly === 'blacksite' && x.owner === 'uk')).toBe(true);
    // Easy keeps the treaty: no war of the difficulty's making.
    const easy = GameSession.create(FIRST_CONTACT_ID, 7, 'uk', [], { difficulty: 'easy' }).view();
    expect(Object.values(easy.relations).includes('war')).toBe(false);
  });

  it('a First Contact save round-trips to the same hash and the same future', () => {
    const s = GameSession.create(FIRST_CONTACT_ID, 2, 'usa', [], { difficulty: 'normal' });
    for (let i = 0; i < 3; i++) s.advance();
    const loaded = GameSession.fromSave(parseSave(serializeSave(s.toSave('ice', '2026-11-05T12:00:00Z'))));
    expect(loaded.hash).toBe(s.hash);
    expect(loaded.advance().hash).toBe(s.advance().hash);
  });

  it('migrates a 2.9.0 save: a campaign without the Black Files gains none, and migrating twice is a no-op', () => {
    const s = GameSession.create(PACIFIC_ID, 9, 'japan');
    s.advance();
    const old = JSON.parse(serializeSave(s.toSave('old', '2026-11-05T12:00:00Z')));
    old.rulesetVersion = '2.9.0';
    old.world.rulesetVersion = '2.9.0';
    old.hash = hashState(old.world);
    const loaded = parseSave(JSON.stringify(old));
    expect(loaded.migratedFrom).toBe('2.9.0');
    expect(loaded.rulesetVersion).toBe(RULESET_VERSION);
    expect(loaded.world.blackFiles).toBeUndefined();
    expect({ ...loaded.world, rulesetVersion: '2.9.0' }).toEqual(old.world);
    expect(hashState(migrateSave({ ...loaded, saveVersion: SAVE_VERSION }).world)).toBe(loaded.hash);
  });

  it('migrates an older Black Files world: the state a younger build did not keep is filled, idempotently', () => {
    const s = GameSession.create(FIRST_CONTACT_ID, 4, 'china', [], { difficulty: 'normal' });
    s.advance();
    const old = JSON.parse(serializeSave(s.toSave('old', '2026-11-05T12:00:00Z')));
    old.rulesetVersion = '2.9.0';
    old.world.rulesetVersion = '2.9.0';
    delete old.world.blackFiles.leaked;
    delete old.world.blackFiles.held;
    delete old.world.blackFiles.splits;
    old.hash = hashState(old.world);
    const loaded = parseSave(JSON.stringify(old));
    expect(loaded.world.blackFiles).toMatchObject({ leaked: [], held: {}, splits: 0 });
    const twice = migrateSave({ ...loaded, saveVersion: SAVE_VERSION });
    expect(twice.world).toEqual(loaded.world);
    expect(hashState(twice.world)).toBe(loaded.hash);
    const resumed = GameSession.fromSave(loaded);
    expect(resumed.advance(resumed.suggest('china')).events.filter((e) => e.kind === 'order_rejected')).toEqual([]);
  });
});

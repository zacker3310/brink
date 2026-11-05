import { describe, expect, it } from 'vitest';
import type { GameEvent, SaveFile } from '@brink/contracts';
import { SAVE_VERSION } from '@brink/contracts';
import { RULESET_VERSION } from '@brink/game-data';
import { FIRST_CONTACT, PACIFIC_ID } from '@brink/scenarios';
import { hashState } from '@brink/simulation';
import { migrateSave, parseSave, serializeSave } from './save';
import { GameSession } from './session';

// Ruleset 2.12.0 brings three lanes together: airborne warfare and right of passage (2.9/2.10, no
// world state of their own), diplomacy that works (2.10/2.11: `publicRelations` lives in the view,
// the sweeteners in deals) and the Black Files (2.12: `normalizeBlackFiles`). Ruleset 2.13.0 adds the
// theatres: victory bars that scale with the powers on a map, fixed at build as `barPowers`
// (`fillBarPowers` gives a campaign begun before its map's count; a Pacific one, of four, gains
// nothing), and Turkey, Canada, Mexico, the United Kingdom and Australia with decks of their own
// wherever they are powers. Every migration step is keyed on a field being absent and runs in ruleset
// order after the save-version steps, so a save from before any of them resumes, and a migrated save
// goes through them again unchanged.

const refused = (events: readonly GameEvent[]) => events.filter((e) => e.kind === 'order_rejected');

/** A Pacific campaign two turns in, written as `version` wrote it (nothing in its shape differs). */
function oldSave(version: string, seed: number): SaveFile {
  const s = GameSession.create(PACIFIC_ID, seed, 'usa', [], { difficulty: 'normal' });
  for (let i = 0; i < 2; i++) s.advance(s.suggest('usa'));
  const old = JSON.parse(serializeSave(s.toSave(`from ${version}`, '2026-11-05T12:00:00Z'))) as SaveFile;
  old.rulesetVersion = version;
  old.world.rulesetVersion = version;
  old.hash = hashState(old.world);
  return old;
}

describe('saves from 2.8.0, 2.9.0 and 2.12.0 under ruleset 2.13.0', () => {
  it('loads each, migrates it once (twice changes nothing), and plays three turns with no order refused', () => {
    expect(RULESET_VERSION).toBe('2.13.0');
    for (const [version, seed] of [
      ['2.8.0', 3],
      ['2.9.0', 6],
      // The last ruleset before the theatres: a Pacific campaign resumes exactly as it was written.
      ['2.12.0', 5],
    ] as const) {
      const old = oldSave(version, seed);
      const loaded = parseSave(JSON.stringify(old));
      expect(loaded.migratedFrom, version).toBe(version);
      expect(loaded.rulesetVersion).toBe(RULESET_VERSION);
      expect(loaded.world.rulesetVersion).toBe(RULESET_VERSION);
      expect(loaded.hash).toBe(hashState(loaded.world));
      // Nothing invented: the world as written but for its version, no Black Files, and no
      // `barPowers` (the Pacific's four powers are the bars as measured).
      expect({ ...loaded.world, rulesetVersion: version }).toEqual(old.world);
      expect(loaded.world.blackFiles).toBeUndefined();
      expect(loaded.world.barPowers).toBeUndefined();
      // Twice: every step again on the migrated save, and a save of it read back, change nothing.
      const twice = migrateSave({ ...loaded, saveVersion: SAVE_VERSION });
      expect(twice.world).toEqual(loaded.world);
      expect(twice.hash).toBe(loaded.hash);
      const reread = parseSave(serializeSave(loaded));
      expect(reread.world).toEqual(loaded.world);
      expect(reread.hash).toBe(loaded.hash);
      // Three turns, the player's seat run by its staff: no order of anyone's is refused.
      const resumed = GameSession.fromSave(loaded);
      expect(resumed.view().publicRelations).toBeDefined();
      for (let i = 0; i < 3; i++) {
        const r = resumed.advance(resumed.suggest('usa'));
        expect(refused(r.events), `${version}, turn ${resumed.turn - 1}`).toEqual([]);
      }
    }
  }, 600_000);

  it('a 2.10.0 Black Files campaign (the lane that made them) is filled in once and plays on', () => {
    const s = GameSession.create(PACIFIC_ID, 4, 'usa', [], { difficulty: 'normal', blackFiles: true });
    s.advance(s.suggest('usa'));
    const old = JSON.parse(serializeSave(s.toSave('from 2.10.0', '2026-11-05T12:00:00Z'))) as SaveFile;
    old.rulesetVersion = '2.10.0';
    old.world.rulesetVersion = '2.10.0';
    // What an early build of the lane did not keep.
    const kept = old.world.blackFiles as unknown as Record<string, unknown>;
    delete kept.splits;
    delete kept.held;
    old.hash = hashState(old.world);
    const loaded = parseSave(JSON.stringify(old));
    expect(loaded.migratedFrom).toBe('2.10.0');
    expect(loaded.world.blackFiles).toMatchObject({ splits: 0, held: {} });
    // Only what was missing is filled: the rest of the world is as written.
    expect({ ...loaded.world, rulesetVersion: '2.10.0', blackFiles: { ...loaded.world.blackFiles!, splits: undefined, held: undefined } }).toEqual({
      ...old.world,
      blackFiles: { ...old.world.blackFiles, splits: undefined, held: undefined },
    });
    const twice = migrateSave({ ...loaded, saveVersion: SAVE_VERSION });
    expect(twice.world).toEqual(loaded.world);
    expect(twice.hash).toBe(loaded.hash);
    const resumed = GameSession.fromSave(loaded);
    for (let i = 0; i < 3; i++) expect(refused(resumed.advance(resumed.suggest('usa')).events)).toEqual([]);
  }, 600_000);

  it('a 2.12.0 First Contact campaign gains the five powers of its map for the bars, only that, once', () => {
    const s = GameSession.create(FIRST_CONTACT.id, 3, 'usa', [], { difficulty: 'normal' });
    for (let i = 0; i < 2; i++) s.advance(s.suggest('usa'));
    const old = JSON.parse(serializeSave(s.toSave('from 2.12.0', '2026-11-05T12:00:00Z'))) as SaveFile;
    // What 2.12.0 wrote: no `barPowers` (its bars were the four-power ones in every theatre).
    old.rulesetVersion = '2.12.0';
    old.world.rulesetVersion = '2.12.0';
    delete old.world.barPowers;
    old.hash = hashState(old.world);
    const loaded = parseSave(JSON.stringify(old));
    expect(loaded.migratedFrom).toBe('2.12.0');
    expect(loaded.world.barPowers).toBe(FIRST_CONTACT.powers.length);
    expect(loaded.world.barPowers).toBe(5);
    expect({ ...loaded.world, rulesetVersion: '2.12.0', barPowers: undefined }).toEqual({ ...old.world, barPowers: undefined });
    const twice = migrateSave({ ...loaded, saveVersion: SAVE_VERSION });
    expect(twice.world).toEqual(loaded.world);
    expect(twice.hash).toBe(loaded.hash);
    const resumed = GameSession.fromSave(loaded);
    for (let i = 0; i < 3; i++) expect(refused(resumed.advance(resumed.suggest('usa')).events)).toEqual([]);
  }, 600_000);
});

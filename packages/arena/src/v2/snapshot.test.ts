import { describe, expect, it } from 'vitest';
import { act, autoTurn, createBattle, endTurn } from './engine';
import { setup, spec } from './fixture.test-util';
import { ARENA_RULES_VERSION } from './rules';
import { hashBattle } from './replay';
import { clearSnapshot, decodeSnapshot, encodeSnapshot, hashText, readSnapshot, snapshotOf, SNAPSHOT_FORMAT, SNAPSHOT_VERSION, writeSnapshot, type SnapshotStore } from './snapshot';
import type { Battle } from './types';

function memory(): SnapshotStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

function battle(): Battle {
  return createBattle(setup({ seed: 11, attackers: [spec('blue', ['m1a2', 'm1a2', 'squad_w', 'm2a3'])], defenders: [spec('red', ['t72b3', 'squad_e', 'bmp3', 'rpg'], 'infantry')] }));
}

const KEY = 'test.snapshot';
const req = { title: 'Practice', target: 'x' };

describe('battle snapshots', () => {
  it('round-trip the battle, its stream and the request; the resumed battle plays on exactly as the original', () => {
    const b = battle();
    autoTurn(b);
    const store = memory();
    expect(writeSnapshot(store, KEY, snapshotOf(b, req))).toBe(true);
    const s = readSnapshot<typeof req>(store, KEY)!;
    expect(s.request).toEqual(req);
    expect(s.rules).toBe(ARENA_RULES_VERSION);
    expect(s.round).toBe(b.round);
    expect(s.turn).toBe('blue');
    expect(s.battle.stream).toBe(b.stream);
    expect(s.battle.units).toEqual(b.units);
    // The same next turn from the copy as from the original: the dice and the AI come out the same.
    const copy = s.battle;
    autoTurn(b);
    autoTurn(copy);
    expect(copy.units).toEqual(b.units);
    expect(copy.stream).toBe(b.stream);
  });

  it('keep the whole battle, its log too (it hashes as the battle), and the unplayed tail', () => {
    const b = battle();
    endTurn(b);
    const played = 3;
    const s = snapshotOf(b, req, played);
    // A trimmed log was first kept here to save space; it emptied the battle log on a resume and the
    // battle no longer hashed as the one that never stopped.
    expect(hashBattle(s.battle)).toBe(hashBattle(b));
    expect(s.unplayed).toEqual(b.events.slice(played));
  });

  it('write atomically: two slots in turn, the pointer swapped last, the old slot dropped', () => {
    const b = battle();
    const store = memory();
    writeSnapshot(store, KEY, snapshotOf(b, req));
    expect(store.data.get(KEY)).toBe(`${KEY}.a`);
    autoTurn(b);
    writeSnapshot(store, KEY, snapshotOf(b, req));
    expect(store.data.get(KEY)).toBe(`${KEY}.b`);
    expect(store.data.has(`${KEY}.a`)).toBe(false);
    expect(readSnapshot(store, KEY)!.round).toBe(b.round);
  });

  it('a save cut off before the pointer moved leaves the last good snapshot', () => {
    const b = battle();
    const store = memory();
    writeSnapshot(store, KEY, snapshotOf(b, req));
    const round = b.round;
    autoTurn(b);
    // The page died after writing the new slot, half of it, before swapping the pointer.
    const text = encodeSnapshot(snapshotOf(b, req));
    store.setItem(`${KEY}.b`, text.slice(0, text.length >> 1));
    expect(readSnapshot(store, KEY)!.round).toBe(round);
    // The next save goes to the unused slot and works.
    expect(writeSnapshot(store, KEY, snapshotOf(b, req))).toBe(true);
    expect(readSnapshot(store, KEY)!.round).toBe(b.round);
  });

  it('a storage that fails or does not read back keeps the last good snapshot', () => {
    const b = battle();
    const store = memory();
    writeSnapshot(store, KEY, snapshotOf(b, req));
    const full: SnapshotStore = { ...store, setItem: () => { throw new Error('QuotaExceededError'); } };
    expect(writeSnapshot(full, KEY, snapshotOf(b, req))).toBe(false);
    const lossy: SnapshotStore = { ...store, setItem: (k, v) => store.setItem(k, k === KEY ? v : v.slice(1)) };
    expect(writeSnapshot(lossy, KEY, snapshotOf(b, req))).toBe(false);
    expect(readSnapshot(store, KEY)).not.toBeNull();
  });

  it('reject a damaged snapshot, an unknown version and other rules without throwing', () => {
    const b = battle();
    const good = encodeSnapshot(snapshotOf(b, req));
    const [head, body] = [good.slice(0, good.indexOf('\n')), good.slice(good.indexOf('\n') + 1)];
    expect(decodeSnapshot(good)).not.toBeNull();
    // One character changed in the body.
    const i = body.indexOf('"round":') + 8;
    expect(decodeSnapshot(`${head}\n${body.slice(0, i)}9${body.slice(i + 1)}`)).toBeNull();
    // Cut short, empty, not JSON, no header.
    expect(decodeSnapshot(good.slice(0, -10))).toBeNull();
    expect(decodeSnapshot('')).toBeNull();
    expect(decodeSnapshot(null)).toBeNull();
    expect(decodeSnapshot(`${SNAPSHOT_FORMAT} 1 5 ${hashText('{bad}')}\n{bad}`)).toBeNull();
    expect(decodeSnapshot(body)).toBeNull();
    // A version from the future, or another format.
    const future = JSON.stringify({ ...JSON.parse(body), version: SNAPSHOT_VERSION + 1 });
    expect(decodeSnapshot(`${SNAPSHOT_FORMAT} ${SNAPSHOT_VERSION + 1} ${future.length} ${hashText(future)}\n${future}`)).toBeNull();
    expect(decodeSnapshot(`other-format 1 ${body.length} ${hashText(body)}\n${body}`)).toBeNull();
    // Fought under other rules.
    const rules = JSON.stringify({ ...JSON.parse(body), rules: ARENA_RULES_VERSION + 1 });
    expect(decodeSnapshot(`${SNAPSHOT_FORMAT} 1 ${rules.length} ${hashText(rules)}\n${rules}`)).toBeNull();
    // A pointer at nothing, or at a key that is not one of its slots.
    const store = memory();
    store.setItem(KEY, `${KEY}.a`);
    expect(readSnapshot(store, KEY)).toBeNull();
    store.setItem(KEY, 'brink.save.v1.Autosave');
    expect(readSnapshot(store, KEY)).toBeNull();
    // Storage that throws.
    const broken: SnapshotStore = { getItem: () => { throw new Error('SecurityError'); }, setItem: () => undefined, removeItem: () => undefined };
    expect(readSnapshot(broken, KEY)).toBeNull();
  });

  it('migrate an older version through the hook, and refuse one with no way forward', () => {
    const b = battle();
    const body = JSON.stringify(snapshotOf(b, req));
    const text = `${SNAPSHOT_FORMAT} 1 ${body.length} ${hashText(body)}\n${body}`;
    // As if the format were now at version 3: version 1 needs two steps.
    expect(decodeSnapshot(text, {}, 3)).toBeNull();
    expect(decodeSnapshot(text, { 1: (d) => d }, 3)).toBeNull();
    expect(decodeSnapshot(text, { 1: () => { throw new Error('bad step'); }, 2: (d) => d }, 3)).toBeNull();
    const seen: number[] = [];
    const s = decodeSnapshot<typeof req>(text, { 1: (d) => (seen.push(1), { ...d, note: 'v2' }), 2: (d) => (seen.push(2), d) }, 3);
    expect(seen).toEqual([1, 2]);
    expect(s?.version).toBe(3);
    expect(s?.request).toEqual(req);
  });

  it('never resume an ended battle; clear drops the pointer and both slots', () => {
    const b = battle();
    const store = memory();
    writeSnapshot(store, KEY, snapshotOf(b, req));
    const ended = { ...b, ended: 'won' as const };
    writeSnapshot(store, KEY, snapshotOf(ended, req));
    expect(readSnapshot(store, KEY)).toBeNull();
    clearSnapshot(store, KEY);
    expect(store.data.size).toBe(0);
  });

  it('a committed action is in the snapshot once: resuming does not commit it again', () => {
    const b = battle();
    const tank = b.units.find((u) => u.side === 'blue' && u.type === 'm1a2')!;
    const to = { x: tank.x, y: tank.y - 1 };
    expect(act(b, { type: 'move', unit: tank.id, to })).toBe(true);
    const store = memory();
    writeSnapshot(store, KEY, snapshotOf(b, req));
    const s = readSnapshot(store, KEY)!;
    const again = s.battle.units.find((u) => u.id === tank.id)!;
    expect([again.x, again.y, again.moved]).toEqual([to.x, to.y, true]);
    expect(s.battle.stream).toBe(b.stream);
  });
});

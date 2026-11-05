import { describe, expect, it } from 'vitest';
import type { DiplomacyOrder, NationOrders, SaveFile } from '@brink/contracts';
import { jointOpTarget } from '@brink/ai';
import { keyDistance } from '@brink/map';
import { PACIFIC_ID } from '@brink/scenarios';
import { hashState, treatyIn } from '@brink/simulation';
import { parseSave, serializeSave } from './save';
import { GameSession } from './session';

// Alliances and joint operations with a human seat: the player (the United States on Easy) asks
// Japan, a friend at peace with China, to go to war with China beside it. Until ruleset 2.10 Japan
// refused an alliance against China ('mood': it had to hate China already) and could never accept a
// joint operation on a Chinese city ('cannot': it had to be at war with China already).

const none = (s: GameSession, diplomacy: DiplomacyOrder[] = []): NationOrders => ({ nation: 'usa', turn: s.turn, formations: {}, recruit: [], diplomacy });

/** Easy, the United States: Japan its ally, but at peace with China (the Easy set-up has them at war). */
function friendAtPeaceWithChina(seed = 4): GameSession {
  const s = GameSession.create(PACIFIC_ID, seed, 'usa', [], { difficulty: 'easy' });
  const save = JSON.parse(serializeSave(s.toSave('probe', '2026-11-05T12:00:00Z'))) as SaveFile;
  save.world.relations['china|japan'] = 'peace';
  save.hash = hashState(save.world);
  const loaded = GameSession.fromSave(parseSave(JSON.stringify(save)));
  expect(loaded.view('japan').relations.china).toBe('peace');
  expect(loaded.view().relations.japan).toBe('alliance');
  expect(loaded.view().relations.china).toBe('war');
  return loaded;
}

const rejected = (r: ReturnType<GameSession['advance']>) => r.events.filter((e) => e.kind === 'order_rejected');

/** What the player puts in to carry it: on turn 1 Japan, a dove, likes China (they share an enemy in Russia). */
const SWEETENER = { credits: 200, food: 100 };

describe('a 2.9.0 save under ruleset 2.10', () => {
  it('loads with its pending offers and treaties as they were, migrates once, and resumes without a refusal', () => {
    const s = GameSession.create(PACIFIC_ID, 4, 'usa', [], { difficulty: 'easy' });
    s.advance(none(s, [{ target: 'russia', action: 'propose_trade' }]));
    const old = JSON.parse(serializeSave(s.toSave('old', '2026-11-05T12:00:00Z'))) as SaveFile;
    old.rulesetVersion = '2.9.0';
    old.world.rulesetVersion = '2.9.0';
    old.hash = hashState(old.world);
    const loaded = parseSave(JSON.stringify(old));
    expect(loaded.migratedFrom).toBe('2.9.0');
    // Nothing in the world's shape changed: only the ruleset version moves on.
    expect({ ...loaded.world, rulesetVersion: '2.9.0' }).toEqual(old.world);
    expect(parseSave(serializeSave({ ...loaded, migratedFrom: undefined } as never)).world).toEqual(loaded.world);
    const resumed = GameSession.fromSave(loaded);
    for (let i = 0; i < 2; i++) expect(rejected(resumed.advance(none(resumed)))).toEqual([]);
    // The view now tells every pair's relation.
    expect(resumed.view().publicRelations?.['china|japan']).toBeDefined();
  }, 60_000);
});

describe('alliances and joint operations with a human seat', () => {
  it('a friend at peace with China joins an alliance against it and goes to war', () => {
    const s = friendAtPeaceWithChina();
    // Asked outright, Japan says no, and says why: it likes China.
    expect(s.negotiate('usa', 'japan', { kind: 'alliance', terms: { against: 'china' } })).toEqual({ accept: false, reason: 'likes_target' });
    const offer = { kind: 'alliance' as const, terms: { against: 'china', give: SWEETENER } };
    expect(s.negotiate('usa', 'japan', offer)).toEqual({ accept: true, reason: 'agreed' });
    const r = s.advance(none(s, [{ target: 'japan', action: 'propose_alliance', terms: offer.terms }]));
    expect(rejected(r)).toEqual([]);
    // The sweetener changed hands on signing (Japan spends it on its own turn, so its stockpile is no measure).
    const paid = r.events.find((e) => e.kind === 'exchange' && e.a === 'usa' && e.b === 'japan');
    expect(paid).toMatchObject({ aGave: SWEETENER, bGave: {} });
    expect(paid).not.toHaveProperty('void');
    expect(s.view('japan').relations.china).toBe('war');
    expect(r.events).toContainEqual(expect.objectContaining({ kind: 'diplomacy', a: 'japan', b: 'china', relation: 'war', broke: 'peace', proposedBy: 'japan' }));
    // And stays in it: Japan makes no peace with China the turns after while its war goes well.
    for (let i = 0; i < 3; i++) {
      expect(rejected(s.advance(none(s)))).toEqual([]);
      expect(s.view('japan').relations.china).toBe('war');
    }
  }, 120_000);

  it('a friend at peace with China accepts a joint operation on a Chinese city, goes to war, and marches on it', () => {
    const s = friendAtPeaceWithChina();
    const japan = s.view('japan');
    // Japan's troops, ashore or aboard the transports that carry them (Japan is an island: the march is a landing).
    const ground = (n: string) => Object.values(s.snapshot().formations).filter((f) => f.owner === n && ['infantry', 'armor', 'mechanized'].includes(f.unitClass));
    const usa = s.view();
    // The Chinese city nearest Japan's army that the player knows of.
    const city = Object.values(usa.sites)
      .filter((x) => x.owner === 'china' && (x.kind === 'city' || x.kind === 'capital') && usa.tiles[x.key]?.visibility !== 'unknown')
      .sort((a, b) => Math.min(...ground('japan').map((f) => keyDistance(f.key, a.key))) - Math.min(...ground('japan').map((f) => keyDistance(f.key, b.key))) || (a.id < b.id ? -1 : 1))[0]!;
    expect(japan.relations.china).toBe('peace');
    expect(s.negotiate('usa', 'japan', { kind: 'joint_op', terms: { site: city.id } })).toEqual({ accept: false, reason: 'likes_target' });
    const offer = { kind: 'joint_op' as const, terms: { site: city.id, give: SWEETENER } };
    expect(s.negotiate('usa', 'japan', offer)).toEqual({ accept: true, reason: 'agreed' });
    const r = s.advance(none(s, [{ target: 'japan', action: 'propose_joint_op', terms: offer.terms }]));
    expect(rejected(r)).toEqual([]);
    const w = s.snapshot();
    expect(treatyIn(w.treaties, 'joint_op', 'japan', 'usa', w.turn)).toMatchObject({ site: city.id });
    expect(s.view('japan').relations.china).toBe('war');
    // Japan's army marches on the prize, and the player's staff plans for it too.
    expect(jointOpTarget(s.view('japan'))).toBe(city.id);
    expect(jointOpTarget(s.view())).toBe(city.id);
    const near = () => Math.min(...ground('japan').map((f) => keyDistance(f.key, city.key)));
    const start = near();
    let best = start;
    for (let i = 0; i < 6 && !s.over; i++) {
      const sug = s.suggest('usa');
      expect(rejected(s.advance({ ...none(s), formations: sug.formations }))).toEqual([]);
      best = Math.min(best, near());
      if (s.snapshot().sites[city.id]!.owner !== 'china') break;
    }
    expect(best < start || s.snapshot().sites[city.id]!.owner !== 'china').toBe(true);
    expect(best).toBeLessThanOrEqual(start - 2);
    // The partners share what they see of the prize: Japanese troops next to it, the player sees it.
    const w2 = s.snapshot();
    if (treatyIn(w2.treaties, 'joint_op', 'japan', 'usa', w2.turn) && Object.values(w2.formations).some((f) => f.owner === 'japan' && !f.aboard && keyDistance(f.key, city.key) <= 1)) {
      expect(s.view().tiles[city.key]!.visibility).toBe('visible');
    }
  }, 180_000);
});

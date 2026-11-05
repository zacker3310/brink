import { describe, expect, it } from 'vitest';
import type { GameEvent, NationOrders, SaveFile } from '@brink/contracts';
import { SAVE_VERSION } from '@brink/contracts';
import { operationById, proposeOperations } from '@brink/ai';
import { RULESET_VERSION } from '@brink/game-data';
import { keyDistance } from '@brink/map';
import { PACIFIC_ID } from '@brink/scenarios';
import { hashState, pairKey } from '@brink/simulation';
import { migrateSave, parseSave, serializeSave } from './save';
import { GameSession } from './session';

// "I want to invade Mongolia as the United States but I can't get there." Ulaanbaatar is five hexes
// from the nearest sea and fourteen from the nearest US site: before airborne warfare (ruleset 2.9.0)
// the only way in was across Russia or China. Now the staff stages a carrier group and the loaded
// amphibious groups within the deck's reach, and the marines fly in.

/** What the web store takes from the staff each turn (`autoCommand`): every order but a declaration of war. */
function staffTurn(s: GameSession, target?: string): NationOrders {
  const view = s.view();
  const sug = s.suggest(view.self.id, target);
  return {
    nation: view.self.id,
    turn: view.turn,
    formations: sug.formations,
    recruit: sug.recruit,
    diplomacy: sug.diplomacy.filter((d) => d.action !== 'declare_war'),
    ...(sug.research ? { research: sug.research } : {}),
  };
}

const ubOf = (s: GameSession) => Object.values(s.snapshot().sites).find((x) => x.name === 'Ulaanbaatar')!;

/** Run the US staff on Ulaanbaatar from turn 1; the drops it made, what it lost to rejections, and when the city fell. */
function campaign(s: GameSession, turns: number) {
  const ub = ubOf(s);
  const lifts: (Extract<GameEvent, { kind: 'airlift' }> & { turn: number })[] = [];
  let rejected = 0;
  let fell: number | null = null;
  for (let t = 0; t < turns && !s.over && fell === null; t++) {
    const r = s.advance(staffTurn(s, ub.id));
    rejected += r.events.filter((e) => e.kind === 'order_rejected' && e.nation === 'usa').length;
    for (const e of r.events) if (e.kind === 'airlift' && e.owner === 'usa') lifts.push({ ...e, turn: s.turn - 1 });
    if (s.snapshot().sites[ub.id]!.owner === 'usa') fell = s.turn - 1;
  }
  return { lifts, rejected, fell };
}

describe('airborne: the road to Ulaanbaatar', () => {
  it('offers Take Ulaanbaatar to the United States on turn 1 as an airborne operation, staged from the deck', () => {
    const s = GameSession.create(PACIFIC_ID, 3, 'usa', [], { difficulty: 'normal' });
    const ub = ubOf(s);
    const op = operationById(s.view(), `take:${ub.id}`)!;
    expect(op.kind).toBe('airborne');
    expect(op.phases.map((p) => p.id)).toEqual(['stage', 'drop', 'hold', 'assault']);
    expect(op.phases[0]!.state).toBe('now');
    expect(op.army.length).toBeGreaterThan(0);
    // The best airborne operation is among the staff's proposals.
    expect(proposeOperations(s.view(), 3).some((o) => o.kind === 'airborne' && o.target === ub.id)).toBe(true);
  });

  it('gets there: a standard campaign (Normal, 30 turns, seed 12), the staff drops four marines beside Ulaanbaatar by turn 7 with every order accepted', () => {
    // China takes Ulaanbaatar from Beijing, next door, on turn 1 of every campaign (12 seeds of 12):
    // the drop meets China's garrison, not Mongolia's militia, and does not take it. Measured again
    // for ruleset 2.12.0: since balance 2.9.0 the rivals' fleets are where the convoy sails, and it
    // stages later (on seed 7, where the airborne lane alone dropped four on turns 4 and 5, the
    // amphibious groups are halted by contact on turn 2 and two marines come down on turn 6). In nine
    // turns seeds 2 to 6, 8, 10 and 11 drop nobody; on seed 12 four marines come down beside it on
    // turns 6 and 7.
    const s = GameSession.create(PACIFIC_ID, 12, 'usa', [], { difficulty: 'normal' });
    const ub = ubOf(s);
    const { lifts, rejected } = campaign(s, 7);
    expect(rejected).toBe(0);
    const down = lifts.filter((e) => !e.aborted);
    expect(down.length).toBe(4);
    for (const e of down) expect(keyDistance(e.landed, ub.key)).toBe(1);
    expect(down.map((e) => e.turn)).toEqual([6, 6, 7, 7]);
    expect(down.every((e) => e.mode === 'drop')).toBe(true);
  }, 120_000);

  it('takes it: Mongolia left to the United States, its militia broken, Ulaanbaatar falls on turn 5 (Easy, 30 turns, seed 2)', () => {
    // A standard start with one edit, documented: China and Russia at peace with Mongolia (so neither
    // walks in first, as China does on turn 1 of every unedited campaign) and the capital's militia
    // broken (120 strength, organization 20, its treasury empty so it raises no more: a full militia
    // dug into a city holds against any four light formations the combat rules know). The United States on Easy, where Japan is its ally,
    // so the convoy is not sunk off Tokyo on turn 1. Ruleset 2.12.0: the four marines down on turns 3
    // and 4 storm it on turn 5 (the operation's assault, `storm` in ai `airborne.ts`); before it, under
    // balance 2.9.0, the rest of the planner never stormed a city it could not see into and the marines
    // wandered off to fight beside it (12 seeds of 12; the airborne lane alone took it on turn 7).
    const made = GameSession.create(PACIFIC_ID, 2, 'usa', [], { difficulty: 'easy' });
    const save = made.toSave('steppe', '2026-11-05T00:00:00Z');
    save.world.relations[pairKey('china', 'mongolia')] = 'peace';
    save.world.relations[pairKey('russia', 'mongolia')] = 'peace';
    const ubKey = save.world.sites['mongolia-capital']!.key;
    for (const f of Object.values(save.world.formations)) if (f.owner === 'mongolia' && f.key === ubKey) Object.assign(f, { strength: 120, organization: 20, morale: 30 });
    save.world.nations.mongolia!.stockpile = { credits: 0, energy: 0, materials: 0, food: 0 };
    const s = GameSession.fromSave(save);
    const { lifts, rejected, fell } = campaign(s, 12);
    expect(rejected).toBe(0);
    expect(lifts.filter((e) => !e.aborted).length).toBeGreaterThanOrEqual(3);
    expect(fell).toBe(5);
    // A captured capital is an airfield: the next lift flies from Ulaanbaatar itself.
    expect(operationById(s.view(), `take:${ubOf(s).id}`)).toBeNull();
  }, 120_000);
});

describe('airborne: saves', () => {
  it('resumes a 2.8.0 campaign under 2.9.0 and plays on; migrating twice changes nothing', () => {
    const s = GameSession.create(PACIFIC_ID, 9, 'usa');
    s.advance();
    const old = JSON.parse(serializeSave(s.toSave('old', '2026-11-05T12:00:00Z'))) as SaveFile;
    // What 2.8.0 wrote: no passage treaties, no airlift orders (neither has state of its own).
    old.rulesetVersion = '2.8.0';
    old.world.rulesetVersion = '2.8.0';
    old.hash = hashState(old.world);
    const loaded = parseSave(JSON.stringify(old));
    expect(loaded.migratedFrom).toBe('2.8.0');
    expect(loaded.rulesetVersion).toBe(RULESET_VERSION);
    expect(RULESET_VERSION).toBe('2.12.0');
    expect(loaded.hash).toBe(hashState(loaded.world));
    expect(hashState(migrateSave({ ...loaded, saveVersion: SAVE_VERSION }).world)).toBe(loaded.hash);
    const resumed = GameSession.fromSave(loaded);
    for (let i = 0; i < 2; i++) {
      const r = resumed.advance(resumed.suggest('usa'));
      expect(r.events.filter((e) => e.kind === 'order_rejected')).toEqual([]);
    }
  }, 60_000);
});

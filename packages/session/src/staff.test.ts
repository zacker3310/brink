import { describe, expect, it } from 'vitest';
import type { NationOrders } from '@brink/contracts';
import { operationById, proposeOperations } from '@brink/ai';
import { PACIFIC_ID } from '@brink/scenarios';
import { parseSave, serializeSave } from './save';
import { GameSession } from './session';

// The staff: the AI's planner drafting the human seat's orders (the web's Staff plan and
// Operations). It must keep winning the war, not stall once an operation is won: a playtest ran
// "Take Taipei" to a capture on turn 4 and then sat on 53 victory points from turn 5 to turn 9,
// because the staff planned every turn from an empty memory and chased a different prize each turn.

/**
 * What the web store takes from the staff's suggestion each turn (`autoCommand` in
 * apps/web/src/store.ts, `staffDiplomacy` in apps/web/src/staff-diplomacy.ts): every formation's
 * order, the recruits, research, and trade and pacts with powers at peace. Since ruleset 2.10 the
 * staff never makes peace or a ceasefire for the player (it advises them): it drafted peace with a
 * power the player had just declared war on.
 */
function staffTurn(s: GameSession, target?: string): NationOrders {
  const view = s.view();
  const sug = s.suggest(view.self.id, target);
  return {
    nation: view.self.id,
    turn: view.turn,
    formations: sug.formations,
    recruit: sug.recruit,
    diplomacy: sug.diplomacy.filter((d) => (d.action === 'propose_trade' || d.action === 'propose_nonaggression') && view.relations[d.target] !== 'war'),
    ...(sug.research ? { research: sug.research } : {}),
  };
}

/** Run China on Normal: the Taipei operation until it is won, then the staff plan alone. */
function campaign(seed: number, turns: number) {
  const s = GameSession.create(PACIFIC_ID, seed, 'china', [], { difficulty: 'normal' });
  const taipei = Object.values(s.snapshot().sites).find((x) => x.name === 'Taipei')!;
  let op: string | null = `take:${taipei.id}`;
  let fell: number | null = null;
  let rejected = 0;
  const vp: number[] = [];
  for (let t = 0; t < turns && !s.over; t++) {
    if (op && !operationById(s.view(), op)) {
      fell = s.turn - 1;
      op = null;
    }
    const r = s.advance(staffTurn(s, op ? op.slice(5) : undefined));
    rejected += r.events.filter((e) => e.kind === 'order_rejected' && e.nation === 'china').length;
    vp.push(s.view().nations.china!.victoryPoints);
  }
  return { s, fell, rejected, vp };
}

describe('the staff', () => {
  it('keeps gaining victory points after its operation takes Taipei', () => {
    const { s, fell, rejected, vp } = campaign(1, 12);
    expect(rejected).toBe(0);
    expect(fell).not.toBeNull();
    expect(fell!).toBeLessThanOrEqual(6);
    // VP the turn Taipei fell, and the best since: the staff picks its next prize and takes it.
    const atFall = vp[fell! - 1]!;
    const after = vp.slice(fell!);
    expect(Math.max(...after)).toBeGreaterThan(atFall);
    // Or the war is already won outright.
    if (!s.over) expect(vp.at(-1)!).toBeGreaterThan(atFall);
  }, 120_000);

  it('remembers its objective from turn to turn, and through a save', () => {
    const s = GameSession.create(PACIFIC_ID, 1, 'china', [], { difficulty: 'normal' });
    expect(s.staffMemory().objective).toBeUndefined();
    const held: string[] = [];
    let gained: number | null = null;
    for (let i = 0; i < 4; i++) {
      const r = s.advance(staffTurn(s));
      held.push(s.staffMemory().objective!);
      if (r.events.some((e) => e.kind === 'site_captured' && e.to === 'china')) gained = s.turn; // the turn the view after it shows
    }
    // An objective from the first turn on, kept from one turn to the next (an empty memory every
    // turn chose afresh each time), and the clock on a stalled war restarted by a capture.
    expect(held.every((o) => o !== undefined)).toBe(true);
    expect(held[1]).toBe(held[0]);
    expect(gained).not.toBeNull();
    expect(s.staffMemory().lastGain).toBe(gained);
    const loaded = GameSession.fromSave(parseSave(serializeSave(s.toSave('staff', '2026-11-04T12:00:00Z'))));
    expect(loaded.staffMemory()).toEqual(s.staffMemory());
    expect(loaded.suggest('china')).toEqual(s.suggest('china'));
  }, 60_000);

  it('offers a next operation once the first is won', () => {
    const { s, fell } = campaign(1, 8);
    expect(fell).not.toBeNull();
    if (s.over) return;
    const next = proposeOperations(s.view(), 3);
    expect(next.length).toBeGreaterThan(0);
    expect(next.every((o) => o.name !== 'Take Taipei')).toBe(true);
  }, 120_000);
});

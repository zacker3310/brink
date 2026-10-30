import { beforeEach, describe, expect, it } from 'vitest';
import { act, createBattle, endTurn, type Battle } from '@brink/arena';
import type { NationView } from '@brink/contracts';
import type { BattleRequest } from './battle';
import { clearResume, readResume, resumeRequest, saveBattle, unplayedReport, warRequest, warSaveFor } from './resume';
import { SKIRMISHES, skirmishRequest } from './skirmish';

// localStorage, as the browser has it.
const data = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) },
});

const skirmish = (): BattleRequest => skirmishRequest(SKIRMISHES[0]!, 0);
/** A war-map attack: the same shape, no skirmish flag, ordered on turn 4 by Korva. */
const attack = (): BattleRequest => {
  const { skirmish: _s, ...rest } = skirmish();
  return { ...rest, target: '3,4', orders: { blue: { type: 'attack', target: '3,4' } as never } };
};
const view = (turn: number, formations: string[] = ['blue']) => ({ turn, self: { id: 'korva' }, formations: Object.fromEntries(formations.map((f) => [f, {}])) }) as unknown as NationView;

beforeEach(() => data.clear());

describe('saving a battle in progress', () => {
  it('saves and resumes a skirmish, carrying what the screen had not shown', () => {
    const req = skirmish();
    const b = createBattle(req.setup);
    const played = b.events.length;
    endTurn(b);
    expect(saveBattle(req, b, played)).toBe(true);
    const s = readResume('skirmish')!;
    expect(s.round).toBe(b.round);
    expect(s.request.title).toBe(req.title);
    expect(s.request.resume).toBeUndefined();
    const again = resumeRequest(s);
    expect(again.resume!.battle.units).toEqual(b.units);
    expect(again.resume!.battle.stream).toBe(b.stream);
    expect(again.resume!.unplayed).toEqual(b.events.slice(played));
    expect(readResume('war')).toBeNull();
  });

  it('clears the save when the battle has ended, and on Abandon', () => {
    const req = skirmish();
    const b = createBattle(req.setup);
    saveBattle(req, b);
    expect(readResume('skirmish')).not.toBeNull();
    saveBattle(req, { ...b, ended: 'lost' } as Battle);
    expect(readResume('skirmish')).toBeNull();
    saveBattle(req, b);
    clearResume('skirmish');
    expect(readResume('skirmish')).toBeNull();
  });

  it('a committed order is in the save once', () => {
    const req = skirmish();
    const b = createBattle(req.setup);
    const tank = b.units.find((u) => u.side === 'blue' && u.type === 'm1a2')!;
    expect(act(b, { type: 'move', unit: tank.id, to: { x: tank.x, y: tank.y - 1 } })).toBe(true);
    saveBattle(req, b);
    const t = readResume('skirmish')!.battle.units.find((u) => u.id === tank.id)!;
    expect([t.y, t.moved]).toEqual([tank.y, true]);
  });

  it('picks a war-map battle up only for the same attack on the same turn', () => {
    const ordered = warRequest(attack(), 4, 'korva');
    expect(ordered.resume).toBeUndefined();
    expect(ordered.campaign).toEqual({ turn: 4, nation: 'korva' });
    const b = createBattle(ordered.setup);
    endTurn(b);
    saveBattle(ordered, b);
    // The page was closed; the campaign is loaded again and the same attack ordered.
    const same = warRequest(attack(), 4, 'korva');
    expect(same.resume?.battle.units).toEqual(b.units);
    // The same setup built with its keys in another order still matches.
    const shuffled = attack();
    shuffled.setup = Object.fromEntries(Object.entries(shuffled.setup).reverse()) as BattleRequest['setup'];
    expect(warRequest(shuffled, 4, 'korva').resume).toBeDefined();
    // Another turn, another nation, another hex or other units: a new battle.
    expect(warRequest(attack(), 5, 'korva').resume).toBeUndefined();
    expect(warRequest(attack(), 4, 'vel').resume).toBeUndefined();
    expect(warRequest({ ...attack(), target: '9,9' }, 4, 'korva').resume).toBeUndefined();
    const weaker = attack();
    weaker.setup = { ...weaker.setup, defenders: weaker.setup.defenders.map((d) => ({ ...d, strength: 500 })) };
    expect(warRequest(weaker, 4, 'korva').resume).toBeUndefined();
  });

  it('tells a loaded campaign about its saved battle, and drops one from a turn now past', () => {
    const ordered = warRequest(attack(), 4, 'korva');
    saveBattle(ordered, createBattle(ordered.setup));
    expect(warSaveFor(view(4))?.request.title).toBe(ordered.title);
    expect(warSaveFor(view(4, ['other']))).toBeNull();
    expect(readResume('war')).not.toBeNull();
    expect(warSaveFor(view(5))).toBeNull();
    expect(readResume('war')).toBeNull();
  });

  it('reports the turn you did not see in words, and nothing for your own last order', () => {
    const side = (id: string) => (id.startsWith('b') ? 'blue' : 'red') as 'blue' | 'red';
    expect(unplayedReport([{ type: 'destroyed', unit: 'r1', how: 'destroyed', x: 0, y: 0, seen: true }], side)).toBeNull();
    expect(
      unplayedReport(
        [
          { type: 'turn', side: 'red', round: 1 },
          { type: 'destroyed', unit: 'b1', how: 'destroyed', x: 0, y: 0, seen: true },
          { type: 'destroyed', unit: 'r2', how: 'destroyed', x: 0, y: 0, seen: true },
          { type: 'destroyed', unit: 'r3', how: 'destroyed', x: 0, y: 0, seen: false },
        ],
        side,
      ),
    ).toBe('1 knocked out · 1 lost');
    expect(unplayedReport([{ type: 'turn', side: 'red', round: 1 }], side)).toBe('No losses either side');
  });
});

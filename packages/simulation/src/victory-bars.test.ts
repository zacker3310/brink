import { describe, expect, it } from 'vitest';
import { victoryBars } from '@brink/game-data';
import { makeWorld } from './fixture.test-util';
import { totalVictoryPoints, victoryThreshold } from './fog';
import { evaluateVictory } from './victory';

// A Total War is won by conquest, not by leading at turn 50: its bars rise with its length.
describe('victory bars by campaign length', () => {
  it('keeps the usual bars up to 60 turns and raises them for a Total War', () => {
    // Ruleset 2.5.0 lowered the usual bars (40% / 38% before): on the Pacific, with four level powers
    // and a third of the victory points in minor states, no campaign of 40 measured reached them.
    expect(victoryBars(30)).toEqual({ dominationShare: 32, supremacyShare: 31, supremacyFromTurn: 8 });
    expect(victoryBars(60).dominationShare).toBe(32);
    expect(victoryBars(250)).toEqual({ dominationShare: 60, supremacyShare: 55, supremacyFromTurn: 50 });
  });

  it('asks a Total War for 60% of all victory points outright', () => {
    const w = makeWorld(8, 6, ['a', 'b']);
    w.maxTurns = 250;
    expect(victoryThreshold(w)).toBe(Math.ceil((totalVictoryPoints(w) * 60) / 100));
    w.maxTurns = 30;
    expect(victoryThreshold(w)).toBe(Math.ceil((totalVictoryPoints(w) * 40) / 100));
  });

  it('declares no supremacy in a Total War before turn 50', () => {
    const w = makeWorld(8, 6, ['a', 'b']);
    w.maxTurns = 250;
    w.turn = 20;
    // Whatever the standing, nothing but the turn limit or a conquest ends it this early.
    expect(evaluateVictory(w)?.reason ?? null).not.toBe('supremacy');
  });
});

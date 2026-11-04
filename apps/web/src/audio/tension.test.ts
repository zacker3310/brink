import { describe, expect, it } from 'vitest';
import type { GameEvent, NationView } from '@brink/contracts';
import { createPacificScenario } from '@brink/scenarios';
import { buildView } from '@brink/simulation';
import { FINAL_TURNS, mapTension, stingerForTurn, threatenedSites, turnStingers } from './tension';

const base = buildView(createPacificScenario(1), 'japan');
const self = base.self.id;
const other = Object.keys(base.nations).find((n) => n !== self)!;
const capital = Object.values(base.sites).find((s) => s.owner === self && s.kind === 'capital')!;

function view(fn: (v: NationView) => void): NationView {
  const v = structuredClone(base);
  for (const n of Object.keys(v.relations)) v.relations[n] = 'peace';
  v.contacts = {};
  v.victory = null;
  v.turn = 1;
  v.maxTurns = 40;
  fn(v);
  return v;
}

const atWar = (v: NationView) => {
  v.relations[other] = 'war';
};
const enemyAt = (v: NationView, key: string, confirmed = true) => {
  v.contacts.x1 = { formation: 'x1', owner: other, unitClass: 'infantry' as never, key, estimatedStrength: 500, confirmed, lastSeen: v.turn };
};

describe('mapTension', () => {
  it('is calm at peace, lifted by a war, higher with a city in reach, highest at the end', () => {
    const peace = mapTension(view(() => undefined));
    const war = mapTension(view(atWar));
    const threat = mapTension(
      view((v) => {
        atWar(v);
        enemyAt(v, capital.key);
      }),
    );
    const finale = mapTension(
      view((v) => {
        atWar(v);
        enemyAt(v, capital.key);
        v.turn = v.maxTurns;
      }),
    );
    expect(peace).toBeLessThan(0.25);
    expect(war).toBeGreaterThan(peace);
    expect(war).toBeGreaterThanOrEqual(0.25);
    expect(threat).toBeGreaterThan(war);
    expect(threat).toBeGreaterThanOrEqual(0.5);
    expect(finale).toBeGreaterThan(threat);
    expect(finale).toBeLessThanOrEqual(1);
  });

  it('an enemy at peace, a stale sighting, or one far off is no threat', () => {
    expect(threatenedSites(view((v) => enemyAt(v, capital.key)))).toBe(0);
    expect(
      threatenedSites(
        view((v) => {
          atWar(v);
          enemyAt(v, capital.key, false);
        }),
      ),
    ).toBe(0);
    expect(
      threatenedSites(
        view((v) => {
          atWar(v);
          enemyAt(v, '999,999');
        }),
      ),
    ).toBe(0);
    // The capital counts twice.
    expect(
      threatenedSites(
        view((v) => {
          atWar(v);
          enemyAt(v, capital.key);
        }),
      ),
    ).toBeGreaterThanOrEqual(2);
  });

  it('the last turns build up turn by turn', () => {
    const at = (left: number) => mapTension(view((v) => (v.turn = v.maxTurns - left)));
    expect(at(FINAL_TURNS + 3)).toBe(at(FINAL_TURNS + 1));
    for (let l = FINAL_TURNS; l > 0; l--) expect(at(l - 1)).toBeGreaterThan(at(l));
  });

  it('settles once the war is decided', () => {
    expect(mapTension(view((v) => (v.victory = { winner: self, reason: 'domination' as never, turn: 3 })))).toBeLessThan(0.3);
  });
});

describe('turn stingers', () => {
  const ev = (e: GameEvent) => e;
  it('reads captures, losses, war on you and a promotion', () => {
    expect(turnStingers(self, [ev({ kind: 'site_captured', site: 's', key: '0,0', from: other, to: self })])).toEqual(['captured']);
    expect(turnStingers(self, [ev({ kind: 'site_captured', site: 's', key: '0,0', from: self, to: other })])).toEqual(['lost']);
    expect(turnStingers(self, [ev({ kind: 'diplomacy', a: other, b: self, relation: 'war', proposedBy: other })])).toEqual(['war']);
    expect(turnStingers(self, [ev({ kind: 'commander', nation: self, commander: 'c', name: 'G', change: 'level_up', level: 2 })])).toEqual(['promotion']);
    // Other powers' business is not yours.
    expect(turnStingers(self, [ev({ kind: 'site_captured', site: 's', key: '0,0', from: other, to: 'x' }), ev({ kind: 'diplomacy', a: other, b: 'x', relation: 'war', proposedBy: other })])).toEqual([]);
  });

  it('one stinger a turn: the biggest, else the turn cue; none once the war is over', () => {
    const v = view(() => undefined);
    expect(stingerForTurn(v, { turn: 2, events: [], victoryPoints: {} })).toBe('turn');
    expect(stingerForTurn(v, null)).toBe('turn');
    expect(
      stingerForTurn(v, {
        turn: 2,
        victoryPoints: {},
        events: [ev({ kind: 'site_captured', site: 's', key: '0,0', from: other, to: self }), ev({ kind: 'site_captured', site: 't', key: '1,0', from: self, to: other })],
      }),
    ).toBe('lost');
    expect(stingerForTurn(view((x) => (x.victory = { winner: self, reason: 'domination' as never, turn: 3 })), null)).toBeNull();
  });
});

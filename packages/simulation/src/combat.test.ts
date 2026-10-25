import { describe, expect, it } from 'vitest';
import { RULES } from '@brink/game-data';
import type { Formation, FormationOrder, GameEvent } from '@brink/contracts';
import { hexKey } from '@brink/map';
import { attackerPower, defenderPower, type AssaultContext } from './combat';
import { makeWorld, orders, setTerrain, unit } from './fixture.test-util';
import { resolveTurn } from './resolve';
import { nationModifiers } from './rules';

const k = hexKey;

function f(id: string, owner: string, unitClass: Formation['unitClass'], over: Partial<Formation> = {}): Formation {
  const w = makeWorld();
  return unit(w, id, owner, unitClass, k(0, 0), over);
}

const mods = nationModifiers({ government: 'union', research: { current: null, progress: 0, unlocked: [] } });
const base: AssaultContext = {
  terrain: 'plains',
  river: false,
  tileOwner: null,
  spotted: true,
  airSupport: false,
  artillerySupport: false,
  attackerMods: { ...mods, homeDefense: 0 },
  defenderMods: () => ({ ...mods, homeDefense: 0 }),
  defending: () => false,
};

describe('combat model', () => {
  it('uses hard attack against armor and soft attack against infantry', () => {
    const armor = [f('t', 'a', 'armor')];
    const inf = [f('i', 'a', 'infantry')];
    const vsArmor = [f('d1', 'b', 'armor')];
    const vsInf = [f('d2', 'b', 'infantry')];
    // Armor's hard attack beats infantry's against armor by far more than against infantry.
    expect(attackerPower(armor, vsArmor, base) / attackerPower(inf, vsArmor, base)).toBeGreaterThan(
      attackerPower(armor, vsInf, base) / attackerPower(inf, vsInf, base),
    );
  });

  it('terrain, entrenchment and a defend order all strengthen the defense', () => {
    const d = [f('d', 'b', 'infantry')];
    const open = defenderPower(d, base);
    expect(defenderPower(d, { ...base, terrain: 'forest' })).toBeGreaterThan(open);
    expect(defenderPower([f('d', 'b', 'infantry', { entrenchment: 60 })], base)).toBeGreaterThan(open);
    expect(defenderPower(d, { ...base, defending: () => true })).toBeGreaterThan(open);
  });

  it('armor loses punch attacking into forest and urban terrain', () => {
    const a = [f('t', 'a', 'armor')];
    const d = [f('d', 'b', 'infantry')];
    expect(attackerPower(a, d, { ...base, terrain: 'urban' })).toBeLessThan(attackerPower(a, d, base));
  });

  it('rewards combined arms, air support, reconnaissance and condition', () => {
    const d = [f('d', 'b', 'infantry')];
    const twoInf = [f('a1', 'a', 'infantry'), f('a2', 'a', 'infantry')];
    const mixed = [f('a1', 'a', 'infantry'), f('a2', 'a', 'mechanized', { strength: 1000 })];
    const plain = attackerPower(twoInf, d, base);
    expect(attackerPower(twoInf, d, { ...base, airSupport: true })).toBeGreaterThan(plain);
    expect(attackerPower(twoInf, d, { ...base, spotted: false })).toBeLessThan(plain);
    // Mixed group beats the same count of one class by more than the raw stat gap explains.
    expect(attackerPower(mixed, d, base)).toBeGreaterThan(attackerPower([f('m', 'a', 'mechanized'), f('m2', 'a', 'mechanized')], d, base) * 0.95);
    expect(attackerPower([f('t', 'a', 'armor', { readiness: 20, supply: 10 })], d, base)).toBeLessThan(attackerPower([f('t', 'a', 'armor')], d, base));
  });
});

function engagement(events: GameEvent[]) {
  return events.find((e) => e.kind === 'engagement' && e.type === 'assault');
}

describe('assaults through the turn resolver', () => {
  it('changes formation state and can take ground', () => {
    const w = makeWorld();
    unit(w, 'a1', 'a', 'armor', k(2, 2));
    unit(w, 'a2', 'a', 'armor', k(2, 3));
    unit(w, 'a3', 'a', 'mechanized', k(3, 1));
    unit(w, 'b1', 'b', 'infantry', k(3, 2), { organization: 30 });
    w.tiles[k(3, 2)]!.owner = 'b';
    const r = resolveTurn(w, [
      orders(w, 'a', {
        a1: { type: 'attack', target: k(3, 2), path: [] },
        a2: { type: 'attack', target: k(3, 2), path: [] },
        a3: { type: 'attack', target: k(3, 2), path: [] },
      }),
    ]);
    const e = engagement(r.events);
    expect(e).toBeDefined();
    if (e?.kind !== 'engagement') throw new Error('no engagement');
    expect(e.outcome).toBe('attacker_victory');
    const b1 = r.world.formations.b1;
    if (b1) {
      expect(b1.strength).toBeLessThan(1000);
      expect(b1.key).not.toBe(k(3, 2));
    }
    expect(r.world.tiles[k(3, 2)]!.owner).toBe('a');
    expect(r.world.formations.a1!.ammunition).toBeLessThan(100);
  });

  it('a lone attack into entrenched infantry in hills is repulsed', () => {
    const w = makeWorld();
    setTerrain(w, k(3, 2), 'hills');
    unit(w, 'a1', 'a', 'infantry', k(2, 2));
    unit(w, 'b1', 'b', 'infantry', k(3, 2), { entrenchment: 80 });
    const r = resolveTurn(w, [orders(w, 'a', { a1: { type: 'attack', target: k(3, 2), path: [] } }), orders(w, 'b', { b1: { type: 'defend' } })]);
    const e = engagement(r.events);
    if (e?.kind !== 'engagement') throw new Error('no engagement');
    expect(e.outcome).toBe('defender_held');
    expect(r.world.formations.b1!.key).toBe(k(3, 2));
  });

  it('artillery strikes hit what is in the target hex before anyone moves', () => {
    const w = makeWorld();
    unit(w, 'art', 'a', 'artillery', k(1, 2));
    unit(w, 'b1', 'b', 'infantry', k(3, 2));
    const r = resolveTurn(w, [
      orders(w, 'a', { art: { type: 'attack', target: k(3, 2), path: [] } }),
      orders(w, 'b', { b1: { type: 'move', path: [k(4, 2)] } }),
    ]);
    const strike = r.events.find((e) => e.kind === 'strike');
    if (strike?.kind !== 'strike') throw new Error('no strike');
    expect(strike.victims.map((v) => v.formation)).toEqual(['b1']);
    expect(strike.victims[0]!.strengthLoss).toBeGreaterThan(0);
  });

  it('bombardment wrecks fieldworks: a shelled formation loses entrenchment', () => {
    const run = (shell: boolean) => {
      const w = makeWorld();
      unit(w, 'art', 'a', 'artillery', k(1, 2));
      unit(w, 'b1', 'b', 'infantry', k(3, 2), { entrenchment: 80 });
      const a: Record<string, FormationOrder> = shell ? { art: { type: 'attack', target: k(3, 2), path: [] } } : {};
      return resolveTurn(w, [orders(w, 'a', a), orders(w, 'b', { b1: { type: 'hold' } })]).world.formations.b1!.entrenchment;
    };
    const quiet = run(false);
    const shelled = run(true);
    expect(quiet).toBe(90);
    expect(shelled).toBe(quiet - RULES.strikeEntrenchment);
  });

  it('two attackers on one defender both fight it from the same snapshot', () => {
    const w = makeWorld(8, 6, ['a', 'b', 'c']);
    unit(w, 'a1', 'a', 'infantry', k(2, 2));
    unit(w, 'c1', 'c', 'infantry', k(4, 2));
    unit(w, 'b1', 'b', 'infantry', k(3, 2));
    const r = resolveTurn(w, [
      orders(w, 'a', { a1: { type: 'attack', target: k(3, 2), path: [] } }),
      orders(w, 'c', { c1: { type: 'attack', target: k(3, 2), path: [] } }),
    ]);
    const fights = r.events.filter((e) => e.kind === 'engagement' && e.type === 'assault');
    expect(fights).toHaveLength(2);
    const before = fights.map((e) => (e.kind === 'engagement' ? e.participants.find((p) => p.formation === 'b1')!.strengthBefore : 0));
    // Out of supply on unowned ground: 10 attrition in logistics, then both fights see 990.
    expect(before).toEqual([990, 990]);
  });
});

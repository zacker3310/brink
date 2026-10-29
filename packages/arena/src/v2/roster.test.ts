import { describe, expect, it } from 'vitest';
import { UNIT_CLASSES, type TechId, type UnitClass } from '@brink/contracts';
import { ABILITIES as V1_ABILITIES, abilitiesFor as v1AbilitiesFor, RANKS as V1_RANKS, rankOf as v1RankOf } from '../rules';
import { buildForce, companySize, TEMPLATES, type UnitSeed } from './forces';
import { isAircraft, isFoot, isVehicle, primary, SUPPORT, TYPE_IDS, TYPES, typeOf } from './roster';
import { ABILITIES, abilitiesFor, RANKS, rankFromSkill, rankOf } from './rules';
import { FACTION_OF, type ArenaSetup, type Arsenal, type ArmourValue, type Side, type SiteKind, type TypeId, type UnitSpec, type UnitType, type WeaponKind } from './types';

const ALL: TypeId[] = [
  'm1a2', 'leo2a7', 'cr3', 't72b3', 't90m', 't80bvm',
  'm2a3', 'bmp3', 'cv90', 'stryker',
  'm10', 'sprut', 'm1134', 'kornetd',
  'ah64e', 'ka52', 'mi35', 'ah6', 'uh60', 'mi8',
  'squad_w', 'squad_e', 'team_w', 'team_e',
  'javelin', 'kornet', 'rpg', 'gustaf', 'stinger', 'igla',
  'sniper_w', 'sniper_e', 'mortar_w', 'mortar_e', 'engineer_w', 'engineer_e', 'medic_w', 'medic_e',
  'fpv_w', 'fpv_e', 'switchblade', 'lancet',
  'gepard', 'tunguska', 'paladin', 'msta', 'm88', 'brem',
  'raven', 'orlan',
];
const ARSENALS: Arsenal[] = ['us', 'europe', 'russia', 'legacy'];
const CALIBRES = ['5.56', '7.62', '12.7', '23', '25', '30', '35', '40', '84', '100', '105', '120', '125', '152', '155', 'atgm', 'rocket', 'manpads', 'fpv'];
const BURST: Record<WeaponKind, number> = { cannon: 1, autocannon: 3, mg: 8, small_arms: 6, sniper: 1, grenade: 1, rocket: 1, atgm: 1, manpads: 1, mortar: 1, howitzer: 1, fpv: 1, loiter: 1 };

const types = (): UnitType[] => TYPE_IDS.map((id) => TYPES[id]);
const weapon = (id: TypeId, w: string) => {
  const found = TYPES[id].weapons.find((x) => x.id === w);
  if (!found) throw new Error(`${id} has no weapon ${w}`);
  return found;
};

function spec(id: string, cls: UnitClass, strength = 1000, rank = 0, list?: TypeId[]): UnitSpec {
  return { id, cls, strength, name: id, color: '#888888', rank, ...(list ? { types: list } : {}) };
}

function setup(p: Partial<ArenaSetup> & Pick<ArenaSetup, 'attackers' | 'defenders'>): ArenaSetup {
  return { seed: 1, terrain: 'plains', river: false, site: null, arsenal: { blue: 'us', red: 'russia' }, skill: 0.4, abilities: [], ...p };
}

const typesOf = (units: UnitSeed[]) => units.map((u) => u.type);
const byFormation = (units: UnitSeed[], id: string) => units.filter((u) => u.formation === id);
/** Every type a template can field (choices and squads included). */
const templateTypes = (arsenal: Arsenal, cls: UnitClass): Set<TypeId> => new Set(TEMPLATES[arsenal][cls].flatMap((s) => (s.squad ? [...s.pick, s.squad] : [...s.pick])));

describe('roster', () => {
  it('has a type for every TypeId, under its own id', () => {
    expect([...TYPE_IDS]).toEqual([...ALL].sort());
    for (const id of ALL) {
      expect(TYPES[id].id).toBe(id);
      expect(typeOf(id)).toBe(TYPES[id]);
    }
  });

  it('fields every roster item in the brief, by designation', () => {
    const names = types().map((t) => t.name);
    const has = (re: RegExp) => expect(names.some((n) => re.test(n)), String(re)).toBe(true);
    for (const re of [
      /^M1A2 SEPv3 Abrams$/, /Leopard 2A7/, /Challenger 3/, /T-72B3/, /T-90M/, /T-80BVM/, /M2A3 Bradley/, /BMP-3/, /CV90/, /Stryker ICV/,
      /M10 Booker/, /AH-64E/, /Ka-52/, /Mi-35M/, /AH-6M/, /UH-60M/, /Mi-8/, /Rifle Squad/, /Javelin/, /Kornet Team/, /RPG-7V2 Team/,
      /Carl Gustaf/, /Stinger/, /Igla/, /Sniper/, /Mortar/, /Engineer/, /FPV/, /Switchblade/, /Paladin/, /2S19/, /Gepard/, /Tunguska/,
      /Medic/,
    ])
      has(re);
    expect(SUPPORT.himars.name).toMatch(/HIMARS/);
    expect(SUPPORT.tornado.name).toMatch(/Tornado-G/);
    expect(types().some((t) => t.role === 'tank_hunter' && t.mobility === 'wheeled' && primary(t)?.kind === 'atgm')).toBe(true);
    expect(types().some((t) => t.role === 'recon_drone')).toBe(true);
    expect(types().some((t) => t.role === 'arv' && t.repair)).toBe(true);
    // Rifle squads have automatic riflemen (or a gunner) and grenadiers, and split into fireteams.
    expect(TYPES.squad_w.men).toEqual(expect.arrayContaining(['leader', 'auto_rifleman', 'grenadier']));
    expect(TYPES.squad_e.men).toEqual(expect.arrayContaining(['leader', 'gunner', 'grenadier', 'at']));
    expect(TYPES.team_w.role).toBe('fireteam');
    expect(TYPES.team_e.role).toBe('fireteam');
    expect(TYPES.sniper_w.men).toEqual(['sniper', 'spotter']);
  });

  it('keeps every number in a sane range', () => {
    for (const t of types()) {
      const at = t.id;
      expect(t.value, at).toBeGreaterThan(0);
      expect(t.move, at).toBeGreaterThan(0);
      expect(t.sight, at).toBeGreaterThan(0);
      expect(t.dims.every((d) => d > 0), at).toBe(true);
      expect(t.name, at).not.toMatch(/\u2014|\u2013/);
      if (isFoot(t)) {
        expect(t.men?.length ?? 0, at).toBeGreaterThanOrEqual(2);
        expect(t.crew, at).toBe(0);
        expect(t.armour, at).toBeNull();
      } else if (t.mobility === 'drone') {
        expect(t.armour, at).toBeNull();
        expect(t.weapons, at).toEqual([]);
      } else {
        expect(t.crew, at).toBeGreaterThan(0);
        expect(t.armour, at).not.toBeNull();
        expect(t.weapons.length, at).toBeGreaterThan(0);
      }
      if (t.armour) for (const v of Object.values(t.armour) as ArmourValue[]) expect(v.every((x) => x >= 0), at).toBe(true);
      const ids = t.weapons.map((w) => w.id);
      expect(new Set(ids).size, at).toBe(ids.length);
      for (const w of t.weapons) {
        const wat = `${at} ${w.id}`;
        expect(w.aim, wat).toBeGreaterThanOrEqual(5);
        expect(w.aim, wat).toBeLessThanOrEqual(95);
        expect(w.range, wat).toBeGreaterThanOrEqual(1);
        expect(w.range, wat).toBeLessThanOrEqual(w.indirect ? 45 : 40);
        expect(w.minRange, wat).toBeGreaterThanOrEqual(0);
        expect(w.minRange, wat).toBeLessThan(w.range);
        expect(w.pen, wat).toBeGreaterThanOrEqual(0);
        expect(w.lethality, wat).toBeGreaterThanOrEqual(0);
        expect(w.supp, wat).toBeGreaterThanOrEqual(0);
        expect(w.blast, wat).toBeGreaterThanOrEqual(0);
        expect(w.demo, wat).toBeGreaterThanOrEqual(0);
        if (w.ammo !== null) expect(w.ammo, wat).toBeGreaterThanOrEqual(1);
        expect(CALIBRES, wat).toContain(w.calibre);
        expect(w.burst, wat).toBe(w.kind === 'rocket' && w.id === 'rockets' ? 6 : BURST[w.kind]);
        expect(w.smoke === undefined || w.indirect === true, wat).toBe(true);
        expect(w.indirect === true, wat).toBe(w.kind === 'mortar' || w.kind === 'howitzer');
        expect(w.name, wat).not.toMatch(/\u2014|\u2013/);
      }
    }
  });

  it('armours tanks heaviest at the front and lightest at the rear', () => {
    for (const t of types().filter((x) => x.role === 'mbt' || x.role === 'light_tank')) {
      const a = t.armour!;
      for (const k of [0, 1] as const) {
        expect(a.tf[k], t.id).toBeGreaterThanOrEqual(a.side[k]);
        expect(a.hf[k], t.id).toBeGreaterThanOrEqual(a.side[k]);
        expect(a.side[k], t.id).toBeGreaterThanOrEqual(a.rear[k]);
      }
      if (t.role === 'mbt') expect(a.tf[0], t.id).toBeGreaterThan(600);
    }
  });

  it('matches every MBT row of section 4.1', () => {
    const rows: [TypeId, number, string, string, number, number, number, ArmourValue, ArmourValue, ArmourValue, ArmourValue, ArmourValue, UnitType['stowage'], number][] = [
      ['m1a2', 4, '66.8 t', '67 km/h', 750, 90, 8, [950, 1300], [600, 900], [80, 400], [40, 80], [40, 60], 'bustle', 24],
      ['leo2a7', 4, '64.5 t', '68 km/h', 780, 90, 8, [920, 1250], [620, 950], [100, 450], [40, 80], [40, 60], 'bustle', 24],
      ['cr3', 4, '66 t', '60 km/h', 780, 90, 7, [960, 1350], [650, 1000], [90, 450], [40, 80], [40, 60], 'hull', 24],
      ['t72b3', 3, '46 t', '60 km/h', 620, 82, 7, [700, 1100], [650, 1000], [80, 350], [40, 60], [30, 50], 'carousel', 22],
      ['t90m', 3, '48 t', '60 km/h', 680, 86, 7, [900, 1300], [750, 1150], [100, 400], [50, 120], [40, 120], 'carousel', 22],
      ['t80bvm', 3, '46 t', '70 km/h', 680, 84, 8, [800, 1200], [700, 1100], [90, 380], [40, 60], [35, 60], 'basket', 22],
    ];
    for (const [id, crew, weight, speed, pen, aim, move, tf, hf, side, rear, top, stowage, range] of rows) {
      const t = TYPES[id];
      expect({ crew: t.crew, weight: t.specs.weight, speed: t.specs.speed, move: t.move, stowage: t.stowage }, id).toEqual({ crew, weight, speed, move, stowage });
      expect(t.armour, id).toEqual({ tf, hf, side, rear, top });
      const main = primary(t)!;
      expect({ kind: main.kind, round: main.round, pen: main.pen, aim: main.aim, range: main.range }, id).toEqual({ kind: 'cannon', round: 'ke', pen, aim, range });
      const he = weapon(id, 'he');
      expect({ pen: he.pen, round: he.round, lethality: he.lethality, blast: he.blast, supp: he.supp, demo: he.demo }, id).toEqual({ pen: 50, round: 'he', lethality: 2.5, blast: 0, supp: 40, demo: 25 });
      expect(t.value, id).toBe(id === 't90m' ? 10 : id === 't80bvm' ? 9 : id === 't72b3' ? 8 : 11);
    }
    expect(TYPES.m1a2.engine).toBe('turbine');
    expect(TYPES.t80bvm.engine).toBe('turbine');
    expect(TYPES.m1a2.dims).toEqual([9.77, 3.66, 2.44]);
    expect(TYPES.cr3.aps).toEqual({ name: 'Trophy', charges: 3, chance: 75 });
    expect(types().filter((t) => t.aps).map((t) => t.id)).toEqual(['cr3']);
  });

  it('matches section 4 for carriers, light tanks, helicopters, infantry and support', () => {
    expect(TYPES.m2a3).toMatchObject({ crew: 3, seats: 6, move: 8, armour: { hf: [45, 250], side: [30, 200], rear: [20, 40], top: [15, 20] } });
    expect(weapon('m2a3', 'cannon')).toMatchObject({ calibre: '25', range: 14, pen: 60 });
    expect(weapon('m2a3', 'tow')).toMatchObject({ range: 25, pen: 900, round: 'ce', top: true, ammo: 4 });
    expect(TYPES.bmp3).toMatchObject({ crew: 3, seats: 7, move: 9, amphibious: true, armour: { tf: [35, 40], side: [20, 25] } });
    expect(TYPES.bmp3.weapons.map((w) => [w.range, w.pen, w.ammo])).toEqual([[20, 50, null], [36, 750, 3], [14, 45, null], [7, 8, null]]);
    expect(weapon('bmp3', 'gun').lethality).toBe(2.5);
    expect(TYPES.cv90).toMatchObject({ seats: 8, move: 9, armour: { tf: [80, 300], side: [45, 200] } });
    expect(weapon('cv90', 'cannon')).toMatchObject({ calibre: '35', range: 18, pen: 120 });
    expect(TYPES.stryker).toMatchObject({ crew: 2, seats: 9, move: 10, mobility: 'wheeled' });
    expect(primary(TYPES.stryker)).toMatchObject({ calibre: '12.7', range: 12 });
    expect(TYPES.m10).toMatchObject({ crew: 4, move: 8, armour: { tf: [200, 400], side: [50, 150] } });
    expect(primary(TYPES.m10)).toMatchObject({ range: 17, pen: 450, calibre: '105' });
    expect(TYPES.sprut).toMatchObject({ amphibious: true, stowage: 'carousel', move: 9 });
    expect(weapon('sprut', 'invar')).toMatchObject({ range: 30, pen: 900, ammo: 2 });
    expect(weapon('m1134', 'tow')).toMatchObject({ range: 25, pen: 900, top: true, ammo: 6 });
    expect(weapon('kornetd', 'kornet')).toMatchObject({ range: 40, pen: 1300, ammo: 8, salvo: 2 });
    expect(TYPES.kornetd.move).toBe(11);

    expect(TYPES.ah64e).toMatchObject({ radar: 40, move: 20, armour: { side: [25, 25] } });
    expect(weapon('ah64e', 'cannon')).toMatchObject({ range: 11, pen: 25, round: 'ce', lethality: 1.2 });
    expect(weapon('ah64e', 'hellfire')).toMatchObject({ range: 40, pen: 900, top: true, ammo: 8 });
    expect(weapon('ah64e', 'rockets')).toMatchObject({ range: 20, lethality: 2, ammo: 2, burst: 6 });
    expect(weapon('ka52', 'vikhr')).toMatchObject({ range: 40, pen: 1000, ammo: 6 });
    expect(TYPES.mi35).toMatchObject({ seats: 8, move: 18, armour: { tf: [30, 30] } });
    expect(weapon('mi35', 'ataka')).toMatchObject({ range: 40, pen: 800, ammo: 4 });
    expect(TYPES.ah6).toMatchObject({ move: 22, spotter: 'spotter', armour: { tf: [5, 5] } });
    expect(weapon('ah6', 'minigun')).toMatchObject({ range: 7, lethality: 2, supp: 30 });
    expect(TYPES.uh60).toMatchObject({ crew: 4, seats: 11 });
    expect(TYPES.mi8).toMatchObject({ crew: 3, seats: 16 });

    expect(TYPES.squad_w.men).toHaveLength(9);
    expect(TYPES.squad_w.weapons.map((w) => w.range)).toEqual([5, 3, 2]);
    expect(weapon('squad_w', 'at4')).toMatchObject({ pen: 500, ammo: 2 });
    expect(TYPES.squad_e.men).toHaveLength(8);
    expect(TYPES.squad_e.weapons.map((w) => w.range)).toEqual([6, 3, 3]);
    expect(weapon('squad_e', 'rpg')).toMatchObject({ pen: 650, ammo: 3 });
    expect(TYPES.team_w.men).toEqual(['team_leader', 'auto_rifleman', 'grenadier', 'rifleman']);
    expect(TYPES.team_e.men).toEqual(['leader', 'gunner', 'at', 'rifleman']);
    expect(weapon('javelin', 'javelin')).toMatchObject({ range: 26, pen: 800, top: true, guidance: 'fnf', ammo: 4 });
    expect(weapon('kornet', 'kornet')).toMatchObject({ range: 36, pen: 1200, ammo: 4, setup: true });
    expect(TYPES.kornet.move).toBe(2);
    expect(weapon('rpg', 'tbg')).toMatchObject({ range: 3, lethality: 3 });
    expect(weapon('gustaf', 'heat')).toMatchObject({ range: 6, pen: 500 });
    expect(weapon('gustaf', 'he')).toMatchObject({ range: 8, lethality: 1.5 });
    expect(weapon('stinger', 'sam')).toMatchObject({ range: 32, air: 'only', ammo: 3 });
    expect(weapon('igla', 'sam')).toMatchObject({ range: 40, air: 'only', ammo: 3 });
    expect(weapon('sniper_w', 'rifle')).toMatchObject({ range: 10, supp: 25, precise: true });
    expect(weapon('sniper_e', 'rifle')).toMatchObject({ range: 7, precise: true });
    expect(weapon('mortar_w', 'mortar')).toMatchObject({ range: 37, lethality: 2, blast: 1, smoke: 3, setup: true, indirect: true });
    expect(weapon('mortar_e', 'mortar')).toMatchObject({ range: 26, setup: true });
    expect(TYPES.engineer_w.men).toHaveLength(6);
    expect(primary(TYPES.engineer_w)?.range).toBe(4);
    expect(primary(TYPES.medic_w)?.range).toBe(3);
    expect(weapon('fpv_e', 'fpv')).toMatchObject({ range: 20, pen: 500, top: true, ammo: 4 });
    expect(weapon('switchblade', 'loiter')).toMatchObject({ range: 40, pen: 800, top: true, ammo: 2 });
    expect(weapon('lancet', 'loiter')).toMatchObject({ range: 40, pen: 600, top: true, ammo: 2 });

    expect(TYPES.gepard).toMatchObject({ crew: 3, move: 8, radar: 40, armour: { tf: [40, 40], side: [25, 25] } });
    expect(weapon('gepard', 'air')).toMatchObject({ range: 26, aim: 80, air: 'only' });
    expect(weapon('gepard', 'ground')).toMatchObject({ range: 20, pen: 90 });
    expect(TYPES.tunguska).toMatchObject({ crew: 4, radar: 40 });
    expect(TYPES.tunguska.weapons.map((w) => [w.range, w.air])).toEqual([[26, 'only'], [15, 'no'], [40, 'only']]);
    for (const id of ['paladin', 'msta'] as const)
      expect(weapon(id, 'gun')).toMatchObject({ range: 45, minRange: 6, lethality: 3, blast: 1, supp: 50, demo: 50, ammo: 8, smoke: 3, top: true });
    expect(TYPES.m88).toMatchObject({ move: 6, repair: true, armour: { tf: [100, 100], side: [50, 50] } });
    expect(TYPES.brem).toMatchObject({ move: 7, repair: true });
    expect(TYPES.raven).toMatchObject({ move: 18, sight: 14, spotter: 'laser' });
    expect(TYPES.orlan).toMatchObject({ move: 18, sight: 14, spotter: 'laser' });
    expect(SUPPORT.himars).toMatchObject({ missions: 2, faction: 'west', weapon: { aim: 95, blast: 1, pen: 300, demo: 80 } });
    expect(SUPPORT.tornado).toMatchObject({ missions: 1, faction: 'east', weapon: { blast: 2, lethality: 2.5, supp: 60 } });
  });

  it('values units as section 4.7 does', () => {
    const want: Partial<Record<TypeId, number>> = {
      m10: 7, sprut: 6, stryker: 5, m1134: 5, kornetd: 5, paladin: 6, msta: 6, gepard: 6, tunguska: 6, m88: 4, brem: 4,
      ah64e: 10, ka52: 10, mi35: 9, ah6: 5, uh60: 5, mi8: 5, squad_w: 4, squad_e: 4, team_w: 2, team_e: 2, javelin: 3, kornet: 3,
      rpg: 2.5, gustaf: 2.5, stinger: 2.5, igla: 2.5, sniper_w: 2, sniper_e: 2, mortar_w: 2.5, mortar_e: 2.5, engineer_w: 3, engineer_e: 3,
      medic_w: 1.5, medic_e: 1.5, fpv_w: 2.5, fpv_e: 2.5, switchblade: 3, lancet: 3, raven: 1.5, orlan: 1.5,
    };
    for (const [id, v] of Object.entries(want)) expect(TYPES[id as TypeId].value, id).toBe(v);
    for (const id of ['m2a3', 'bmp3', 'cv90'] as const) expect([6, 7]).toContain(TYPES[id].value);
  });

  it('sets the sight, transport and support flags by the spec', () => {
    const ids = (p: (t: UnitType) => boolean) => types().filter(p).map((t) => t.id).sort();
    for (const id of ['javelin', 'kornet', 'sniper_w', 'sniper_e', 'fpv_w', 'fpv_e', 'switchblade', 'lancet', 'stinger'] as const) expect(TYPES[id].thermal, id).toBe(true);
    for (const t of types().filter(isFoot)) expect(t.nvg, t.id).toBe(true);
    for (const t of types().filter((x) => x.role === 'mbt' || x.role === 'ifv' || (x.mobility === 'heli' && x.role !== 'transport_heli'))) expect(t.thermal, t.id).toBe(true);
    expect(ids((t) => t.amphibious === true)).toEqual(['bmp3', 'sprut']);
    expect(ids((t) => t.flares === true)).toEqual(ids((t) => t.mobility === 'heli'));
    expect(ids((t) => t.radar !== undefined)).toEqual(['ah64e', 'gepard', 'tunguska']);
    for (const t of types().filter((x) => x.radar !== undefined)) expect(t.radar).toBe(40);
    expect(ids((t) => t.repair === true)).toEqual(['brem', 'm88']);
    expect(ids((t) => t.treat === true)).toEqual(['medic_e', 'medic_w']);
    expect(ids((t) => t.engineer === true)).toEqual(['engineer_e', 'engineer_w']);
    expect(ids((t) => t.spotter === 'laser')).toEqual(['orlan', 'raven']);
    expect(ids((t) => t.spotter === 'spotter')).toEqual(['ah6', 'kornetd', 'm10', 'm1134', 'sniper_e', 'sniper_w', 'sprut']);
    expect(ids((t) => t.stabilised)).toEqual(ids((t) => ['mbt', 'ifv', 'light_tank', 'spaa'].includes(t.role)));
    expect(ids((t) => t.seats > 0)).toEqual(['bmp3', 'cv90', 'm2a3', 'mi35', 'mi8', 'stryker', 'uh60']);
    expect(ids((t) => t.weapons.some((w) => w.setup === true))).toEqual(['javelin', 'kornet', 'mortar_e', 'mortar_w', 'sniper_e', 'sniper_w']);
    for (const t of types()) {
      const smoke = t.role === 'mbt' || t.role === 'ifv' || t.id === 'm10' ? 2 : ['stryker', 'm1134', 'kornetd', 'sprut'].includes(t.id) ? 1 : 0;
      expect(t.smoke, t.id).toBe(smoke);
      const profile = isFoot(t) ? 'foot' : t.mobility === 'heli' ? 'heli' : t.mobility === 'drone' ? 'drone' : ['stryker', 'm1134', 'kornetd', 'sprut', 'bmp3'].includes(t.id) ? 'light' : 'mbt';
      expect(t.profile, t.id).toBe(profile);
      expect(t.sight, t.id).toBe(t.role === 'recon_drone' ? 14 : 30);
    }
  });

  it('sorts types by body with the helpers', () => {
    expect(isVehicle(TYPES.m1a2) && isVehicle(TYPES.stryker)).toBe(true);
    expect(isVehicle(TYPES.ah64e) || isVehicle(TYPES.squad_w) || isVehicle(TYPES.raven)).toBe(false);
    expect(isAircraft(TYPES.ah64e) && isAircraft(TYPES.raven)).toBe(true);
    expect(isAircraft(TYPES.fpv_w) || isAircraft(TYPES.gepard)).toBe(false);
    expect(isFoot(TYPES.javelin) && !isFoot(TYPES.bmp3)).toBe(true);
    expect(primary(TYPES.m1a2)?.id).toBe('gun');
    expect(primary(TYPES.raven)).toBeUndefined();
  });
});

describe('ranks and abilities', () => {
  it('keeps v1 ranks and rankOf', () => {
    expect(RANKS.map((r) => [r.name, r.from, r.aim])).toEqual(V1_RANKS.map((r) => [r.name, r.from, r.aim]));
    for (let xp = -5; xp <= 100; xp++) expect(rankOf(xp), String(xp)).toBe(v1RankOf(xp));
  });

  it('keeps v1 ability ids and techs, and abilitiesFor', () => {
    const ids = Object.keys(ABILITIES).sort();
    expect(ids).toEqual(Object.keys(V1_ABILITIES).sort());
    for (const id of ids) expect(ABILITIES[id as keyof typeof ABILITIES].tech).toBe(V1_ABILITIES[id as keyof typeof V1_ABILITIES].tech);
    const techs: TechId[] = ids.map((id) => ABILITIES[id as keyof typeof ABILITIES].tech);
    for (let mask = 0; mask < 1 << techs.length; mask++) {
      const unlocked = techs.filter((_, i) => mask & (1 << i)).concat(['not_a_tech']);
      expect(abilitiesFor(unlocked)).toEqual(v1AbilitiesFor(unlocked));
    }
  });

  it('marks how each ability is used', () => {
    const which = (p: (a: (typeof ABILITIES)[keyof typeof ABILITIES]) => boolean) => (Object.keys(ABILITIES) as (keyof typeof ABILITIES)[]).filter((k) => p(ABILITIES[k])).sort();
    expect(which((a) => a.needsUnit)).toEqual(['repair']);
    expect(which((a) => a.targeted)).toEqual(['airstrike', 'mines']);
    expect(which((a) => a.passive)).toEqual(['armor']);
    for (const a of Object.values(ABILITIES)) expect(a.text).not.toMatch(/\u2014|\u2013/);
  });

  it('turns enemy skill into a crew rank', () => {
    const cases: [number, number][] = [[0, 0], [0.34, 0], [0.35, 1], [0.59, 1], [0.6, 2], [0.79, 2], [0.8, 3], [1, 3], [Number.NaN, 0]];
    for (const [skill, rank] of cases) expect(rankFromSkill(skill), String(skill)).toBe(rank);
  });
});

describe('forces', () => {
  it('builds templates from their own faction only', () => {
    for (const arsenal of ARSENALS)
      for (const cls of UNIT_CLASSES) for (const t of templateTypes(arsenal, cls)) expect(TYPES[t].faction, `${arsenal} ${cls} ${t}`).toBe(FACTION_OF[arsenal]);
  });

  it('fields every roster item in some arsenal', () => {
    const seen = new Set<TypeId>(['team_w', 'team_e']);
    for (const arsenal of ARSENALS) {
      for (const cls of UNIT_CLASSES) for (const t of templateTypes(arsenal, cls)) seen.add(t);
      // Attachments: medic, air defence, engineers.
      const s = setup({ attackers: [spec('a', 'infantry')], defenders: [spec('d', 'air')], site: 'city', arsenal: { blue: arsenal, red: arsenal } });
      for (const side of ['blue', 'red'] as Side[]) for (const t of typesOf(buildForce(s, side).units)) seen.add(t);
    }
    expect([...seen].sort()).toEqual([...ALL].sort());
  });

  it('makes a company of 10 to 16 for 1 to 6 formations, at least 2 each and 70% from the formations', () => {
    for (const blue of ARSENALS)
      for (let f = 1; f <= 6; f++)
        for (let offset = 0; offset < UNIT_CLASSES.length; offset++) {
          const attackers = Array.from({ length: f }, (_, k) => spec(`a${k}`, UNIT_CLASSES[(k + offset) % UNIT_CLASSES.length]!));
          const defenders = Array.from({ length: f }, (_, k) => spec(`d${k}`, UNIT_CLASSES[(k * 3 + offset) % UNIT_CLASSES.length]!));
          const s = setup({ attackers, defenders, arsenal: { blue, red: blue === 'us' ? 'legacy' : 'russia' }, site: 'objective' });
          for (const side of ['blue', 'red'] as Side[]) {
            const specs = side === 'blue' ? attackers : defenders;
            const { units } = buildForce(s, side);
            const n = companySize(specs);
            expect(units.length, `${blue} ${f} ${side}`).toBe(n);
            expect(n).toBeGreaterThanOrEqual(10);
            expect(n).toBeLessThanOrEqual(16);
            let formed = 0;
            for (const sp of specs) {
              const mine = byFormation(units, sp.id);
              const own = templateTypes(s.arsenal[side], sp.cls);
              const fromTemplate = mine.filter((u) => own.has(u.type)).length;
              expect(fromTemplate, `${sp.id} ${sp.cls}`).toBeGreaterThanOrEqual(2);
              formed += fromTemplate;
            }
            expect(formed / n).toBeGreaterThanOrEqual(0.7);
          }
        }
    expect([1, 2, 3, 4, 5, 6].map((f) => companySize(Array.from({ length: f }, (_, k) => spec(`x${k}`, 'armor'))))).toEqual([10, 14, 16, 16, 16, 16]);
  });

  it('clamps a weak side to 10 and thins its squads', () => {
    expect(companySize([spec('a', 'infantry', 100)])).toBe(10);
    expect(companySize([spec('a', 'infantry', 150), spec('b', 'armor', 150)])).toBe(10);
    const weak = buildForce(setup({ attackers: [spec('a', 'infantry', 100)], defenders: [spec('d', 'armor')] }), 'blue').units;
    expect(weak).toHaveLength(10);
    for (const u of weak) expect(u.men, u.id).toBe(2);
    const half = buildForce(setup({ attackers: [spec('a', 'infantry', 500)], defenders: [spec('d', 'armor')] }), 'blue').units;
    // Nine from the template (cycled: five squads) and a medic; 9 x 0.5 rounds to 5.
    expect(half.filter((u) => u.type === 'squad_w').map((u) => u.men)).toEqual([5, 5, 5, 5, 5]);
    expect(half.find((u) => u.type === 'mortar_w')?.men).toBe(2);
    expect(half.find((u) => u.type === 'javelin')?.men).toBe(2);
  });

  it('gives stronger formations the bigger share', () => {
    const s = setup({ attackers: [spec('weak', 'armor', 400), spec('strong', 'armor', 1000)], defenders: [spec('d', 'infantry')] });
    const units = buildForce(s, 'blue').units;
    expect(byFormation(units, 'strong').length).toBeGreaterThan(byFormation(units, 'weak').length);
    const three = setup({ attackers: [spec('a', 'infantry', 300), spec('b', 'recon', 1000), spec('c', 'drone', 650)], defenders: [spec('d', 'armor')] });
    const u3 = buildForce(three, 'blue').units;
    const own = (id: string, cls: UnitClass) => byFormation(u3, id).filter((u) => templateTypes('us', cls).has(u.type)).length;
    expect(own('b', 'recon')).toBeGreaterThanOrEqual(own('c', 'drone'));
    expect(own('c', 'drone')).toBeGreaterThanOrEqual(own('a', 'infantry'));
    expect(own('b', 'recon')).toBeGreaterThan(own('a', 'infantry'));
  });

  it('puts each carrier squad inside its carrier, sized to the seats', () => {
    const seats: Partial<Record<TypeId, number>> = { m2a3: 6, stryker: 9, cv90: 8, bmp3: 7, uh60: 9, mi8: 8, mi35: 8 };
    for (const arsenal of ARSENALS)
      for (let k = 0; k < 6; k++) {
        const s = setup({ attackers: [spec(`m${k}`, 'mechanized'), spec(`h${k}`, 'air')], defenders: [spec('d', 'armor')], arsenal: { blue: arsenal, red: 'russia' } });
        const units = buildForce(s, 'blue').units;
        const inside = units.filter((u) => u.carrier);
        expect(inside.length).toBeGreaterThan(0);
        for (const u of inside) {
          const at = units.findIndex((c) => c.id === u.carrier);
          expect(at, u.id).toBeGreaterThanOrEqual(0);
          expect(at, u.id).toBe(units.indexOf(u) - 1);
          const carrier = units[at]!;
          expect(carrier.formation).toBe(u.formation);
          expect(isFoot(TYPES[u.type])).toBe(true);
          expect(u.men!, u.id).toBeLessThanOrEqual(TYPES[carrier.type].seats);
          // A full-strength squad fills the seats, or comes whole where it fits.
          expect(u.men, `${carrier.type} ${u.type}`).toBe(seats[carrier.type]);
        }
      }
  });

  it('attaches air defence exactly when the other side fields aircraft', () => {
    const AD: Record<Arsenal, TypeId> = { us: 'stinger', europe: 'gepard', russia: 'tunguska', legacy: 'igla' };
    for (const blue of ARSENALS)
      for (const red of ARSENALS)
        for (const cls of UNIT_CLASSES) {
          const s = setup({ attackers: [spec('a', 'infantry')], defenders: [spec('d', cls)], arsenal: { blue, red } });
          const air = [...templateTypes(red, cls)].some((t) => isAircraft(TYPES[t]));
          expect(air).toBe(cls === 'air' || cls === 'recon' || cls === 'drone');
          const mine = typesOf(buildForce(s, 'blue').units);
          expect(mine.includes(AD[blue]), `${blue} vs ${red} ${cls}`).toBe(air);
          expect(mine.filter((t) => ['spaa', 'aa_team'].includes(TYPES[t].role)).length).toBe(air ? 1 : 0);
          // And the defender the other way round.
          const back = setup({ attackers: [spec('a', cls)], defenders: [spec('d', 'infantry')], arsenal: { blue: red, red: blue } });
          expect(typesOf(buildForce(back, 'red').units).includes(AD[blue])).toBe(air);
        }
  });

  it('attaches a medic first, engineers for built-up ground and rivers, recovery for heavy vehicles', () => {
    const base = { attackers: [spec('a', 'mechanized')], defenders: [spec('d', 'armor')], arsenal: { blue: 'europe', red: 'legacy' } as ArenaSetup['arsenal'] };
    const kinds = (site: SiteKind, river = false) => typesOf(buildForce(setup({ ...base, site, river }), 'blue').units);
    expect(kinds(null)).toContain('medic_w');
    for (const site of ['city', 'capital', 'objective'] as SiteKind[]) expect(kinds(site), String(site)).toContain('engineer_w');
    expect(kinds(null, true)).toContain('engineer_w');
    expect(kinds('depot')).not.toContain('engineer_w');
    expect(kinds(null)).not.toContain('engineer_w');
    // Three CV90s are heavy; the company gets an M88.
    expect(kinds(null)).toContain('m88');
    // An armour formation brings its own M88: no second one.
    const armour = buildForce(setup({ attackers: [spec('a', 'armor')], defenders: [spec('d', 'armor')], arsenal: { blue: 'europe', red: 'legacy' } }), 'blue').units;
    expect(typesOf(armour).filter((t) => t === 'm88')).toHaveLength(1);
    expect(typesOf(armour)).toContain('medic_w');
    // 13 units: at most 3 attachments, in order, after the formations, dealt strongest formation first.
    const two = buildForce(setup({ attackers: [spec('a', 'armor'), spec('b', 'artillery', 600)], defenders: [spec('d', 'air')], site: 'city' }), 'blue').units;
    expect(two).toHaveLength(13);
    expect(two.slice(-3).map((u) => u.type)).toEqual(['medic_w', 'stinger', 'engineer_w']);
    expect(two.slice(-3).map((u) => u.formation)).toEqual(['a', 'b', 'a']);
    expect(typesOf(two)).not.toContain('sniper_w');
  });

  it('settles a template choice per formation, one type throughout', () => {
    const seen = new Set<TypeId>();
    for (let k = 0; k < 40; k++) {
      const s = setup({ attackers: [spec(`f${k}`, 'armor')], defenders: [spec('d', 'infantry')], arsenal: { blue: 'europe', red: 'russia' } });
      const tanks = typesOf(buildForce(s, 'blue').units).filter((t) => TYPES[t].role === 'mbt');
      expect(new Set(tanks).size).toBe(1);
      seen.add(tanks[0]!);
    }
    expect([...seen].sort()).toEqual(['cr3', 'leo2a7']);
  });

  it('honours skirmish lists exactly, with squads embarked', () => {
    const s = setup({
      attackers: [spec('d1', 'mechanized', 1000, 1, ['m2a3', 'squad_w', 'm1a2', 'javelin', 'stryker', 'team_w'])],
      defenders: [spec('e1', 'infantry', 1000, 0, ['squad_e', 'bmp3', 'squad_e', 'kornet']), spec('e2', 'air', 1000, 0, ['mi8', 'squad_e'])],
      skill: 0.7,
    });
    const blue = buildForce(s, 'blue');
    expect(typesOf(blue.units)).toEqual(['m2a3', 'squad_w', 'm1a2', 'javelin', 'stryker', 'team_w']);
    expect(blue.units.map((u) => u.carrier ?? null)).toEqual([null, 'd1:1', null, null, null, 'd1:5']);
    expect(blue.units.map((u) => u.men ?? null)).toEqual([null, 6, null, 2, null, 4]);
    expect(blue.units.every((u) => u.rank === 1)).toBe(true);
    const red = buildForce(s, 'red');
    expect(typesOf(red.units)).toEqual(['squad_e', 'bmp3', 'squad_e', 'kornet', 'mi8', 'squad_e']);
    expect(red.units.map((u) => u.carrier ?? null)).toEqual([null, null, 'e1:2', null, null, 'e2:1']);
    expect(red.units.map((u) => u.men ?? null)).toEqual([8, null, 7, 2, null, 8]);
    expect(red.units.every((u) => u.rank === 2)).toBe(true);
    // A mixed side keeps the list and builds the rest from templates.
    const mixed = buildForce(setup({ attackers: [spec('x', 'recon', 1000, 0, ['m10']), spec('y', 'armor')], defenders: [spec('d', 'armor')] }), 'blue').units;
    expect(byFormation(mixed, 'x').map((u) => u.type)).toEqual(['m10']);
    expect(mixed.length).toBe(1 + companySize([spec('y', 'armor')]));
  });

  it('gives every unit a unique, stable id and a name', () => {
    for (const blue of ARSENALS) {
      const s = setup({
        attackers: [spec('a1', 'armor'), spec('a2', 'mechanized', 800), spec('a3', 'infantry', 600)],
        defenders: [spec('d1', 'air'), spec('d2', 'recon', 700), spec('d3', 'drone')],
        arsenal: { blue, red: blue === 'us' ? 'legacy' : 'russia' },
        site: 'capital',
        river: true,
      });
      const all = [...buildForce(s, 'blue').units, ...buildForce(s, 'red').units];
      expect(new Set(all.map((u) => u.id)).size).toBe(all.length);
      for (const u of all) {
        expect(u.id.startsWith(`${u.formation}:`), u.id).toBe(true);
        expect(u.name.length).toBeGreaterThan(0);
        expect(u.name).not.toMatch(/\u2014|\u2013/);
      }
      for (const f of ['a1', 'a2', 'a3', 'd1', 'd2', 'd3'])
        expect(byFormation(all, f).map((u) => u.id)).toEqual(byFormation(all, f).map((_, k) => `${f}:${k + 1}`));
      expect(JSON.stringify(buildForce(s, 'blue'))).toBe(JSON.stringify(buildForce(s, 'blue')));
      expect(JSON.stringify(buildForce(s, 'red'))).toBe(JSON.stringify(buildForce(JSON.parse(JSON.stringify(s)) as ArenaSetup, 'red')));
    }
    const names = buildForce(setup({ attackers: [spec('a', 'infantry')], defenders: [spec('d', 'armor')] }), 'blue').units.map((u) => u.name);
    expect(names.slice(0, 4)).toEqual(['1st Squad', '2nd Squad', '3rd Squad', 'Javelin Team']);
    const tanks = buildForce(setup({ attackers: [spec('a', 'armor')], defenders: [spec('d', 'armor')] }), 'blue').units.map((u) => u.name);
    expect(tanks.slice(0, 2)).toEqual(['Abrams 1', 'Abrams 2']);
  });

  it('brings off-map rockets with an artillery formation', () => {
    const support = (blue: Arsenal, n: number) =>
      buildForce(setup({ attackers: Array.from({ length: n }, (_, k) => spec(`g${k}`, 'artillery')), defenders: [spec('d', 'armor')], arsenal: { blue, red: 'russia' } }), 'blue').support;
    expect(support('us', 1)).toEqual([{ id: 'himars', missions: 2 }]);
    expect(support('europe', 2)).toEqual([{ id: 'himars', missions: 4 }]);
    expect(support('russia', 1)).toEqual([{ id: 'tornado', missions: 1 }]);
    expect(support('legacy', 1)).toEqual([{ id: 'tornado', missions: 1 }]);
    expect(buildForce(setup({ attackers: [spec('a', 'armor')], defenders: [spec('d', 'armor')] }), 'blue').support).toEqual([]);
  });

  it('ranks blue by experience and red by the larger of its rank and the enemy skill', () => {
    const s = (skill: number) => setup({ attackers: [spec('a', 'armor', 1000, 2)], defenders: [spec('d', 'armor', 1000, 1)], skill });
    expect(buildForce(s(0.95), 'blue').units.every((u) => u.rank === 2)).toBe(true);
    expect(buildForce(s(0.95), 'red').units.every((u) => u.rank === 3)).toBe(true);
    expect(buildForce(s(0.1), 'red').units.every((u) => u.rank === 1)).toBe(true);
  });
});

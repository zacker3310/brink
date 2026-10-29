import type { Armour, ArmourValue, Faction, SoldierRole, SupportAsset, TypeId, UnitType, Weapon, WeaponKind } from './types';

// The v2 roster: every unit type in the arena (docs/arena-v2.md section 4). Specifications are public
// figures; armour is open-source estimates rounded for the game (the real values are classified).
// Where section 4 is silent, each type says what was chosen and why.
//
// Weapon conventions the engine relies on:
// - `range` and `minRange` are cells: real effective range / 150 m, capped at 40. Indirect weapons that
//   reach the whole field use 45.
// - `aim` is the base hit chance at up to half range. The falloff per cell beyond half range comes from
//   `kind` (section 3.4) and is applied by the engine, not stored. Indirect weapons' aim is the on-target
//   chance on an observed cell (mortar 70, guns 65; section 3.9).
// - `lethality` and `supp` on a foot unit's own weapons are for the unit at full strength; the engine
//   scales `small_arms` and `grenade` by fit soldiers / men. Other weapons are per shot.
// - `round: 'he'` is blast penetration: its `pen` meets the CE armour value (section 4.1, "pen 50 CE").
// - `burst` is the rounds the film draws per shot: cannon 1, autocannon 3, mg 8, small_arms 6, sniper 1,
//   grenade 1, rocket 1 (Hydra and S-8 salvos 6), atgm 1, manpads 1, mortar 1, howitzer 1, fpv 1, loiter 1.
// - `calibre` is the audio key, one of '5.56', '7.62', '12.7', '23', '25', '30', '35', '40', '84', '100',
//   '105', '120', '125', '152', '155', 'atgm', 'rocket', 'manpads', 'fpv'. There is no 81 or 82 key, so
//   mortars use '84'; the 5.45 mm AK-12 uses '5.56', the .338 MK22 '7.62', loitering munitions 'fpv'.
// - The first weapon is the primary (the card shows it first). Turreted guns carry their real coaxial
//   7.62 MG last, and the SPGs their roof 12.7, so a firepower kill leaves a secondary MG (section 3.5).
// - Foot teams with no small arms in the table carry their rifles last, for self defence.
//
// Other conventions: `dims` are metres, length x width x height, guns forward; helicopters are
// fuselage length x main rotor diameter x height; foot units are one soldier. `spotter: 'spotter'` is
// on the AH-6, the sniper teams and the recon vehicles (the types only the Recon template fields:
// Booker, M1134, Sprut, Kornet-D); 'laser' on the recon drones.

const BURST: Record<WeaponKind, number> = {
  cannon: 1,
  autocannon: 3,
  mg: 8,
  small_arms: 6,
  sniper: 1,
  grenade: 1,
  rocket: 1,
  atgm: 1,
  manpads: 1,
  mortar: 1,
  howitzer: 1,
  fpv: 1,
  loiter: 1,
};

type WeaponInput = Pick<Weapon, 'id' | 'name' | 'kind' | 'calibre' | 'range' | 'aim' | 'pen' | 'round'> & Partial<Weapon>;

const wpn = (w: WeaponInput): Weapon => ({ minRange: 0, lethality: 0, supp: 0, blast: 0, demo: 0, ammo: null, air: 'no', guidance: 'none', burst: BURST[w.kind], ...w });

const arm = (tf: ArmourValue, hf: ArmourValue, side: ArmourValue, rear: ArmourValue, top: ArmourValue): Armour => ({ tf, hf, side, rear, top });
/** The same plate all round (helicopters). */
const allRound = (v: number): Armour => arm([v, v], [v, v], [v, v], [v, v], [v, v]);

// --- Shared weapons ------------------------------------------------------------------------------

/** Tank gun, kinetic round. Poor against troops; the HE round is the second weapon. */
const gun = (name: string, calibre: string, range: number, aim: number, pen: number): Weapon =>
  wpn({ id: 'gun', name, kind: 'cannon', calibre, range, aim, pen, round: 'ke', lethality: 0.5, supp: 30, demo: 5 });
/** Tank gun, high explosive: pen 50 CE, lethality 2.5, blast 0, suppression 40, demolition 25 (section 4.1). */
const gunHe = (name: string, calibre: string, range: number, aim: number): Weapon =>
  wpn({ id: 'he', name, kind: 'cannon', calibre, range, aim, pen: 50, round: 'he', lethality: 2.5, supp: 40, demo: 25 });
/** Coaxial 7.62 mm MG: about 1,000 m. */
const coax = (name: string): Weapon => wpn({ id: 'coax', name, kind: 'mg', calibre: '7.62', range: 7, aim: 65, pen: 8, round: 'ke', lethality: 1, supp: 25 });
/** 12.7 mm MG on a mount: 1,800 m (the M88's .50 is 12 in section 4.6). */
const hmg = (name: string, aim = 60): Weapon => wpn({ id: 'hmg', name, kind: 'mg', calibre: '12.7', range: 12, aim, pen: 20, round: 'ke', lethality: 1, supp: 25, air: 'yes' });
/** A two or three soldier team's carbines: 450 m. */
const rifles = (name: string): Weapon => wpn({ id: 'rifles', name, kind: 'small_arms', calibre: '5.56', range: 3, aim: 50, pen: 6, round: 'ke', lethality: 0.3, supp: 8, air: 'yes' });
/** A squad's or team's massed rifles and MGs. */
const fire = (name: string, range: number, aim: number, lethality: number, supp: number): Weapon =>
  wpn({ id: 'rifles', name, kind: 'small_arms', calibre: '5.56', range, aim, pen: 6, round: 'ke', lethality, supp, air: 'yes' });
/** M320 with M433 HEDP (63 mm). "blast" in section 4.5 read as radius 1. */
const m320 = (lethality: number, supp: number): Weapon =>
  wpn({ id: 'm320', name: 'M320 · M433 HEDP', kind: 'grenade', calibre: '40', range: 3, aim: 55, pen: 60, round: 'ce', lethality, supp, blast: 1, demo: 2 });
/** GP-34 with VOG-25 HE-frag; blast 1 like the M320, for consistency. One grenadier, so less lethal. */
const gp34 = (): Weapon => wpn({ id: 'gp34', name: 'GP-34 · VOG-25', kind: 'grenade', calibre: '40', range: 3, aim: 50, pen: 5, round: 'he', lethality: 0.5, supp: 15, blast: 1, demo: 2 });
const at4 = (ammo: number): Weapon => wpn({ id: 'at4', name: 'AT4 · HEAT', kind: 'rocket', calibre: '84', range: 2, aim: 60, pen: 500, round: 'ce', lethality: 0.5, supp: 20, demo: 8, ammo });
const pg7vr = (ammo: number): Weapon =>
  wpn({ id: 'rpg', name: 'RPG-7V2 · PG-7VR', kind: 'rocket', calibre: 'rocket', range: 3, aim: 55, pen: 650, round: 'ce', lethality: 0.5, supp: 25, demo: 8, ammo });
/** TOW-2B: top attack, wire guided, 3,750 m. */
const tow = (ammo: number): Weapon =>
  wpn({ id: 'tow', name: 'TOW-2B · BGM-71F', kind: 'atgm', calibre: 'atgm', range: 25, aim: 85, pen: 900, round: 'ce', top: true, lethality: 0.8, supp: 30, demo: 12, ammo, guidance: 'saclos' });
/** Hydra 70 with M151 HE: a salvo, so blast 1 and six rockets on film. */
const hydra = (): Weapon =>
  wpn({ id: 'rockets', name: 'Hydra 70 · M151 HE', kind: 'rocket', calibre: 'rocket', range: 20, aim: 55, pen: 40, round: 'he', lethality: 2, supp: 35, blast: 1, demo: 12, ammo: 2, burst: 6 });
/** S-8OFP2 HE rockets: as the Hydra. */
const s8 = (aim: number): Weapon =>
  wpn({ id: 'rockets', name: 'S-8 · S-8OFP2', kind: 'rocket', calibre: 'rocket', range: 20, aim, pen: 40, round: 'he', lethality: 2, supp: 35, blast: 1, demo: 12, ammo: 2, burst: 6 });
/** Mortars: HE lethality 2, blast 1, smoke 3; cannot fire after moving. A team's load is about a dozen missions. */
const mortar = (name: string, range: number): Weapon =>
  wpn({ id: 'mortar', name, kind: 'mortar', calibre: '84', range, minRange: 1, aim: 70, pen: 40, round: 'he', top: true, lethality: 2, supp: 40, blast: 1, demo: 15, ammo: 12, indirect: true, smoke: 3, setup: true });
/** Self-propelled guns: the whole field, min 6, lethality 3, blast 1, suppression 50, demolition 50, 8 missions, smoke 3. */
const howitzer = (name: string, calibre: string, pen: number): Weapon =>
  wpn({ id: 'gun', name, kind: 'howitzer', calibre, range: 45, minRange: 6, aim: 65, pen, round: 'he', top: true, lethality: 3, supp: 50, blast: 1, demo: 50, ammo: 8, indirect: true, smoke: 3 });
/** Shoulder-launched SAMs: infrared homing, air only. */
const manpads = (name: string, range: number, aim: number): Weapon =>
  wpn({ id: 'sam', name, kind: 'manpads', calibre: 'manpads', range, aim, pen: 100, round: 'he', supp: 30, ammo: 3, air: 'only', guidance: 'fnf' });

// --- Builders ------------------------------------------------------------------------------------

type Dims = [number, number, number];
/** One soldier: depth with kit, shoulder width, standing height. */
const SOLDIER: Dims = [0.5, 0.6, 1.8];

type VehicleInput = Pick<
  UnitType,
  'id' | 'name' | 'short' | 'role' | 'faction' | 'mobility' | 'crew' | 'armour' | 'stowage' | 'move' | 'weapons' | 'smoke' | 'stabilised' | 'value' | 'profile' | 'engine' | 'specs' | 'dims'
> &
  Partial<UnitType>;
const vehicle = (t: VehicleInput): UnitType => ({ sight: 30, thermal: true, seats: 0, ...t });

type HeliInput = Pick<UnitType, 'id' | 'name' | 'short' | 'role' | 'faction' | 'crew' | 'armour' | 'move' | 'weapons' | 'seats' | 'value' | 'specs' | 'dims'> & Partial<UnitType>;
const heli = (t: HeliInput): UnitType => ({
  mobility: 'heli',
  stowage: 'light',
  sight: 30,
  thermal: true,
  smoke: 0,
  flares: true,
  stabilised: false,
  profile: 'heli',
  engine: 'heli',
  ...t,
});

type FootInput = Pick<UnitType, 'id' | 'name' | 'short' | 'role' | 'faction' | 'move' | 'weapons' | 'value' | 'specs'> & { men: SoldierRole[] } & Partial<UnitType>;
const foot = (t: FootInput): UnitType => ({
  mobility: 'foot',
  crew: 0,
  armour: null,
  stowage: 'light',
  sight: 30,
  thermal: false,
  nvg: true,
  seats: 0,
  smoke: 0,
  stabilised: false,
  profile: 'foot',
  engine: 'none',
  dims: SOLDIER,
  ...t,
});

type DroneInput = Pick<UnitType, 'id' | 'name' | 'short' | 'faction' | 'value' | 'specs' | 'dims'> & Partial<UnitType>;
/** Recon drones: no weapons, look down within 14 (the engine handles the view), laser for the guns. */
const drone = (t: DroneInput): UnitType => ({
  role: 'recon_drone',
  mobility: 'drone',
  crew: 0,
  armour: null,
  stowage: 'light',
  move: 18,
  sight: 14,
  thermal: true,
  weapons: [],
  seats: 0,
  smoke: 0,
  spotter: 'laser',
  stabilised: false,
  profile: 'drone',
  engine: 'drone',
  ...t,
});

const SQUAD_W: SoldierRole[] = ['leader', 'team_leader', 'team_leader', 'auto_rifleman', 'auto_rifleman', 'grenadier', 'grenadier', 'rifleman', 'rifleman'];
const SQUAD_E: SoldierRole[] = ['leader', 'gunner', 'at', 'assistant', 'grenadier', 'rifleman', 'rifleman', 'marksman'];

// --- The roster ----------------------------------------------------------------------------------

export const TYPES: Record<TypeId, UnitType> = {
  // Main battle tanks: section 4.1 for every number shown there.
  m1a2: vehicle({
    id: 'm1a2',
    name: 'M1A2 SEPv3 Abrams',
    short: 'Abrams',
    role: 'mbt',
    faction: 'west',
    mobility: 'tracked',
    crew: 4,
    armour: arm([950, 1300], [600, 900], [80, 400], [40, 80], [40, 60]),
    stowage: 'bustle',
    move: 8,
    weapons: [gun('120 mm M256 · M829A4', '120', 24, 90, 750), gunHe('120 mm M256 · M1147 AMP', '120', 24, 90), coax('M240C coax')],
    smoke: 2,
    stabilised: true,
    value: 11,
    profile: 'mbt',
    engine: 'turbine',
    specs: { origin: 'USA, General Dynamics Land Systems', weight: '66.8 t', speed: '67 km/h', note: 'AGT1500 turbine, 1,500 hp' },
    dims: [9.77, 3.66, 2.44],
  }),
  // Dims: Leopard 2A6/2A7 public figures, height to the sight head.
  leo2a7: vehicle({
    id: 'leo2a7',
    name: 'Leopard 2A7',
    short: 'Leopard',
    role: 'mbt',
    faction: 'west',
    mobility: 'tracked',
    crew: 4,
    armour: arm([920, 1250], [620, 950], [100, 450], [40, 80], [40, 60]),
    stowage: 'bustle',
    move: 8,
    weapons: [gun('120 mm L55 · DM53', '120', 24, 90, 780), gunHe('120 mm L55 · DM11', '120', 24, 90), coax('MG3 coax')],
    smoke: 2,
    stabilised: true,
    value: 11,
    profile: 'mbt',
    engine: 'diesel',
    specs: { origin: 'Germany, Krauss-Maffei Wegmann', weight: '64.5 t', speed: '68 km/h', note: 'MTU MB 873, 1,500 hp' },
    dims: [10.97, 3.77, 3.0],
  }),
  // Dims: Challenger 2 hull and turret, which Challenger 3 keeps.
  cr3: vehicle({
    id: 'cr3',
    name: 'Challenger 3',
    short: 'Challenger',
    role: 'mbt',
    faction: 'west',
    mobility: 'tracked',
    crew: 4,
    armour: arm([960, 1350], [650, 1000], [90, 450], [40, 80], [40, 60]),
    stowage: 'hull',
    move: 7,
    weapons: [gun('120 mm L55A1 · APFSDS', '120', 24, 90, 780), gunHe('120 mm L55A1 · HE', '120', 24, 90), coax('L94A1 chain gun')],
    smoke: 2,
    aps: { name: 'Trophy', charges: 3, chance: 75 },
    stabilised: true,
    value: 11,
    profile: 'mbt',
    engine: 'diesel',
    specs: { origin: 'UK, Rheinmetall BAE Systems Land', weight: '66 t', speed: '60 km/h', note: 'CV12, 1,200 hp; Trophy APS' },
    dims: [11.55, 3.52, 2.49],
  }),
  t72b3: vehicle({
    id: 't72b3',
    name: 'T-72B3',
    short: 'T-72B3',
    role: 'mbt',
    faction: 'east',
    mobility: 'tracked',
    crew: 3,
    armour: arm([700, 1100], [650, 1000], [80, 350], [40, 60], [30, 50]),
    stowage: 'carousel',
    move: 7,
    weapons: [gun('125 mm 2A46M-5 · 3BM59 Svinets-1', '125', 22, 82, 620), gunHe('125 mm 2A46M-5 · 3OF26', '125', 22, 82), coax('PKTM coax')],
    smoke: 2,
    stabilised: true,
    value: 8,
    profile: 'mbt',
    engine: 'diesel',
    specs: { origin: 'Russia, Uralvagonzavod', weight: '46 t', speed: '60 km/h', note: '2016 standard; V-92S2F, 1,130 hp' },
    dims: [9.53, 3.59, 2.23],
  }),
  t90m: vehicle({
    id: 't90m',
    name: 'T-90M Proryv',
    short: 'T-90M',
    role: 'mbt',
    faction: 'east',
    mobility: 'tracked',
    crew: 3,
    armour: arm([900, 1300], [750, 1150], [100, 400], [50, 120], [40, 120]),
    stowage: 'carousel',
    move: 7,
    weapons: [gun('125 mm 2A46M-4 · 3BM60 Svinets-2', '125', 22, 86, 680), gunHe('125 mm 2A46M-4 · 3OF26', '125', 22, 86), coax('PKTM coax')],
    smoke: 2,
    stabilised: true,
    value: 10,
    profile: 'mbt',
    engine: 'diesel',
    specs: { origin: 'Russia, Uralvagonzavod', weight: '48 t', speed: '60 km/h', note: 'V-92S2F, 1,130 hp; Relikt ERA' },
    dims: [9.63, 3.78, 2.23],
  }),
  // Dims: T-80U family figures.
  t80bvm: vehicle({
    id: 't80bvm',
    name: 'T-80BVM',
    short: 'T-80BVM',
    role: 'mbt',
    faction: 'east',
    mobility: 'tracked',
    crew: 3,
    armour: arm([800, 1200], [700, 1100], [90, 380], [40, 60], [35, 60]),
    stowage: 'basket',
    move: 8,
    weapons: [gun('125 mm 2A46M-4 · 3BM60', '125', 22, 84, 680), gunHe('125 mm 2A46M-4 · 3OF26', '125', 22, 84), coax('PKTM coax')],
    smoke: 2,
    stabilised: true,
    value: 9,
    profile: 'mbt',
    engine: 'turbine',
    specs: { origin: 'Russia, Omsk Transmash', weight: '46 t', speed: '70 km/h', note: 'GTD-1250 turbine, 1,250 hp' },
    dims: [9.65, 3.58, 2.2],
  }),

  // IFVs and carriers: section 4.2; the table's front value is both turret and hull front.
  // Aims (spec silent): digital fire control 80 to 84, the BMP-3's older sights 70 to 72.
  m2a3: vehicle({
    id: 'm2a3',
    name: 'M2A3 Bradley',
    short: 'Bradley',
    role: 'ifv',
    faction: 'west',
    mobility: 'tracked',
    crew: 3,
    armour: arm([45, 250], [45, 250], [30, 200], [20, 40], [15, 20]),
    stowage: 'hull',
    move: 8,
    weapons: [
      wpn({ id: 'cannon', name: '25 mm M242 · M919 APFSDS', kind: 'autocannon', calibre: '25', range: 14, aim: 80, pen: 60, round: 'ke', lethality: 1, supp: 30, demo: 5, air: 'yes' }),
      tow(4),
      coax('M240C coax'),
    ],
    seats: 6,
    smoke: 2,
    stabilised: true,
    value: 7,
    profile: 'mbt',
    engine: 'diesel',
    specs: { origin: 'USA, BAE Systems', weight: '31 t', speed: '56 km/h', note: 'TOW-2B launcher; 6 dismounts' },
    dims: [6.55, 3.61, 2.98],
  }),
  bmp3: vehicle({
    id: 'bmp3',
    name: 'BMP-3',
    short: 'BMP-3',
    role: 'ifv',
    faction: 'east',
    mobility: 'tracked',
    crew: 3,
    armour: arm([35, 40], [35, 40], [20, 25], [15, 15], [10, 10]),
    stowage: 'hull',
    move: 9,
    weapons: [
      wpn({ id: 'gun', name: '100 mm 2A70 · 3OF32 HE', kind: 'cannon', calibre: '100', range: 20, aim: 70, pen: 50, round: 'he', lethality: 2.5, supp: 40, demo: 25 }),
      wpn({ id: 'arkan', name: '9M117M1 Arkan', kind: 'atgm', calibre: 'atgm', range: 36, aim: 80, pen: 750, round: 'ce', lethality: 0.8, supp: 30, demo: 15, ammo: 3, guidance: 'saclos' }),
      wpn({ id: 'cannon', name: '30 mm 2A72', kind: 'autocannon', calibre: '30', range: 14, aim: 72, pen: 45, round: 'ke', lethality: 0.8, supp: 25, demo: 5, air: 'yes' }),
      coax('PKT coax'),
    ],
    seats: 7,
    amphibious: true,
    smoke: 2,
    stabilised: true,
    value: 6,
    profile: 'light',
    engine: 'diesel',
    specs: { origin: 'Russia, Kurganmashzavod', weight: '18.7 t', speed: '70 km/h, swims', note: 'UTD-29, 500 hp; 7 dismounts' },
    dims: [7.14, 3.15, 2.3],
  }),
  cv90: vehicle({
    id: 'cv90',
    name: 'CV90 Mk IV',
    short: 'CV90',
    role: 'ifv',
    faction: 'west',
    mobility: 'tracked',
    crew: 3,
    armour: arm([80, 300], [80, 300], [45, 200], [25, 40], [20, 25]),
    stowage: 'hull',
    move: 9,
    weapons: [
      wpn({ id: 'cannon', name: '35 mm Bushmaster III · APFSDS and airburst', kind: 'autocannon', calibre: '35', range: 18, aim: 84, pen: 120, round: 'ke', lethality: 1.5, supp: 35, demo: 8, air: 'yes' }),
      coax('FN MAG coax'),
    ],
    seats: 8,
    smoke: 2,
    stabilised: true,
    value: 7,
    profile: 'mbt',
    engine: 'diesel',
    specs: { origin: 'Sweden, BAE Systems Hägglunds', weight: '35 t', speed: '70 km/h', note: 'CV9035; 8 dismounts' },
    dims: [6.55, 3.2, 2.78],
  }),
  // An APC, so not stabilised; light vehicles get one smoke salvo.
  stryker: vehicle({
    id: 'stryker',
    name: 'M1126 Stryker ICV',
    short: 'Stryker',
    role: 'apc',
    faction: 'west',
    mobility: 'wheeled',
    crew: 2,
    armour: arm([30, 250], [30, 250], [25, 250], [20, 150], [10, 10]),
    stowage: 'light',
    move: 10,
    weapons: [hmg('M2 .50 cal RWS', 72)],
    seats: 9,
    smoke: 1,
    stabilised: false,
    value: 5,
    profile: 'light',
    engine: 'diesel',
    specs: { origin: 'USA, General Dynamics Land Systems', weight: '18 t', speed: '97 km/h', note: 'slat armour; 9 dismounts' },
    dims: [6.95, 2.72, 2.64],
  }),

  // Light tanks and tank hunters: section 4.3. Rear and top are silent there: thin plate below the side.
  // Booker: no official dims; ASCOD-based hull with the 105 mm forward, approximate. Bustle stowage.
  m10: vehicle({
    id: 'm10',
    name: 'M10 Booker',
    short: 'Booker',
    role: 'light_tank',
    faction: 'west',
    mobility: 'tracked',
    crew: 4,
    armour: arm([200, 400], [200, 400], [50, 150], [30, 60], [20, 30]),
    stowage: 'bustle',
    move: 8,
    weapons: [
      gun('105 mm M35 · M900 APFSDS', '105', 17, 85, 450),
      wpn({ id: 'he', name: '105 mm M35 · M393 HEP', kind: 'cannon', calibre: '105', range: 17, aim: 85, pen: 100, round: 'he', lethality: 2, supp: 40, demo: 35 }),
      coax('M240C coax'),
    ],
    smoke: 2,
    spotter: 'spotter',
    stabilised: true,
    value: 7,
    profile: 'mbt',
    engine: 'diesel',
    specs: { origin: 'USA, General Dynamics Land Systems', weight: '38 t', speed: '64 km/h', note: 'infantry brigade fire support' },
    dims: [9.0, 3.4, 2.8],
  }),
  // Carousel autoloader per section 3.5; HE added like the MBTs, since the 2A75 fires the 3OF26.
  sprut: vehicle({
    id: 'sprut',
    name: '2S25M Sprut-SDM1',
    short: 'Sprut',
    role: 'light_tank',
    faction: 'east',
    mobility: 'tracked',
    crew: 3,
    armour: arm([25, 30], [25, 30], [15, 15], [10, 10], [10, 10]),
    stowage: 'carousel',
    move: 9,
    weapons: [
      gun('125 mm 2A75 · APFSDS', '125', 20, 78, 600),
      wpn({ id: 'invar', name: '9M119M1 Invar-M', kind: 'atgm', calibre: 'atgm', range: 30, aim: 82, pen: 900, round: 'ce', lethality: 0.8, supp: 30, demo: 12, ammo: 2, guidance: 'saclos' }),
      gunHe('125 mm 2A75 · 3OF26', '125', 20, 78),
      coax('PKTM coax'),
    ],
    amphibious: true,
    smoke: 1,
    spotter: 'spotter',
    stabilised: true,
    value: 6,
    profile: 'light',
    engine: 'diesel',
    specs: { origin: 'Russia, Kurganmashzavod', weight: '18 t', speed: '70 km/h, swims', note: 'air-droppable, on the BMD-4M chassis' },
    dims: [9.77, 3.15, 3.05],
  }),
  // Stryker hull, so the Stryker's rear and top.
  m1134: vehicle({
    id: 'm1134',
    name: 'M1134 Stryker ATGM',
    short: 'Stryker ATGM',
    role: 'tank_hunter',
    faction: 'west',
    mobility: 'wheeled',
    crew: 4,
    armour: arm([30, 250], [30, 250], [25, 250], [20, 150], [10, 10]),
    stowage: 'light',
    move: 10,
    weapons: [tow(6)],
    smoke: 1,
    spotter: 'spotter',
    stabilised: false,
    value: 5,
    profile: 'light',
    engine: 'diesel',
    specs: { origin: 'USA, General Dynamics Land Systems', weight: '18 t', speed: '97 km/h', note: 'twin TOW launcher; ITAS sight' },
    dims: [6.95, 2.72, 3.1],
  }),
  // Missile name as section 4.3 gives it (9M133FM-3; the tandem HEAT round is usually listed as 9M133M-2).
  kornetd: vehicle({
    id: 'kornetd',
    name: '9P163-3 Kornet-D',
    short: 'Kornet-D',
    role: 'tank_hunter',
    faction: 'east',
    mobility: 'wheeled',
    crew: 2,
    armour: arm([10, 10], [10, 10], [10, 10], [10, 10], [5, 5]),
    stowage: 'light',
    move: 11,
    weapons: [
      wpn({ id: 'kornet', name: 'Kornet-EM · 9M133FM-3', kind: 'atgm', calibre: 'atgm', range: 40, aim: 88, pen: 1300, round: 'ce', lethality: 0.8, supp: 30, demo: 15, ammo: 8, salvo: 2, guidance: 'saclos' }),
    ],
    smoke: 1,
    spotter: 'spotter',
    stabilised: false,
    value: 5,
    profile: 'light',
    engine: 'diesel',
    specs: { origin: 'Russia, KBP Tula on a Tigr-M', weight: '13 t', speed: '125 km/h', note: 'two launchers, salvo fire on one beam' },
    dims: [5.7, 2.4, 2.6],
  }),

  // Helicopters: section 4.4. Weight is maximum take-off. Transports fly on NVGs, without a thermal turret.
  ah64e: heli({
    id: 'ah64e',
    name: 'AH-64E Apache Guardian',
    short: 'Apache',
    role: 'attack_heli',
    faction: 'west',
    crew: 2,
    armour: allRound(25),
    move: 20,
    weapons: [
      wpn({ id: 'cannon', name: '30 mm M230 · M789 HEDP', kind: 'autocannon', calibre: '30', range: 11, aim: 72, pen: 25, round: 'ce', lethality: 1.2, supp: 30, demo: 5, air: 'yes' }),
      wpn({ id: 'hellfire', name: 'AGM-114R Hellfire', kind: 'atgm', calibre: 'atgm', range: 40, aim: 90, pen: 900, round: 'ce', top: true, lethality: 1.2, supp: 35, demo: 20, ammo: 8, guidance: 'saclos' }),
      hydra(),
    ],
    seats: 0,
    radar: 40,
    value: 10,
    specs: { origin: 'USA, Boeing', weight: '10.4 t', speed: '293 km/h', note: 'Longbow fire-control radar' },
    dims: [15.06, 14.63, 4.95],
  }),
  ka52: heli({
    id: 'ka52',
    name: 'Ka-52 Alligator',
    short: 'Ka-52',
    role: 'attack_heli',
    faction: 'east',
    crew: 2,
    armour: allRound(25),
    move: 20,
    weapons: [
      wpn({ id: 'cannon', name: '30 mm 2A42', kind: 'autocannon', calibre: '30', range: 14, aim: 70, pen: 45, round: 'ke', lethality: 1.2, supp: 30, demo: 5, air: 'yes' }),
      wpn({ id: 'vikhr', name: '9K121 Vikhr', kind: 'atgm', calibre: 'atgm', range: 40, aim: 88, pen: 1000, round: 'ce', lethality: 0.8, supp: 30, demo: 15, ammo: 6, air: 'yes', guidance: 'saclos' }),
      s8(50),
    ],
    seats: 0,
    value: 10,
    specs: { origin: 'Russia, Kamov', weight: '10.8 t', speed: '300 km/h', note: 'coaxial rotors; ejection seats' },
    dims: [13.53, 14.5, 4.95],
  }),
  // Dims: Mi-24 family figures (height with the tail rotor).
  mi35: heli({
    id: 'mi35',
    name: 'Mi-35M',
    short: 'Mi-35',
    role: 'gunship',
    faction: 'east',
    crew: 2,
    armour: allRound(30),
    move: 18,
    weapons: [
      wpn({ id: 'cannon', name: 'GSh-23V twin 23 mm', kind: 'autocannon', calibre: '23', range: 10, aim: 62, pen: 30, round: 'ke', lethality: 1, supp: 30, demo: 5, air: 'yes' }),
      wpn({ id: 'ataka', name: '9M120 Ataka', kind: 'atgm', calibre: 'atgm', range: 40, aim: 80, pen: 800, round: 'ce', lethality: 0.8, supp: 30, demo: 15, ammo: 4, guidance: 'saclos' }),
      s8(50),
    ],
    seats: 8,
    value: 9,
    specs: { origin: 'Russia, Mil (Rostvertol)', weight: '11.5 t', speed: '300 km/h', note: 'Mi-24 family gunship with a cabin for 8' },
    dims: [17.5, 17.3, 6.5],
  }),
  // Dims: MD 530 airframe.
  ah6: heli({
    id: 'ah6',
    name: 'AH-6M Little Bird',
    short: 'Little Bird',
    role: 'scout_heli',
    faction: 'west',
    crew: 2,
    armour: allRound(5),
    move: 22,
    weapons: [wpn({ id: 'minigun', name: '2 x M134 miniguns', kind: 'mg', calibre: '7.62', range: 7, aim: 70, pen: 8, round: 'ke', lethality: 2, supp: 30, air: 'yes' }), hydra()],
    seats: 0,
    spotter: 'spotter',
    value: 5,
    specs: { origin: 'USA, Boeing', weight: '1.9 t', speed: '280 km/h', note: 'special operations light attack; laser designator' },
    dims: [7.49, 8.33, 2.59],
  }),
  uh60: heli({
    id: 'uh60',
    name: 'UH-60M Black Hawk',
    short: 'Black Hawk',
    role: 'transport_heli',
    faction: 'west',
    crew: 4,
    armour: allRound(10),
    move: 20,
    weapons: [wpn({ id: 'doorguns', name: '2 x M240H door guns', kind: 'mg', calibre: '7.62', range: 7, aim: 55, pen: 8, round: 'ke', lethality: 1, supp: 20, air: 'yes' })],
    seats: 11,
    thermal: false,
    nvg: true,
    value: 5,
    specs: { origin: 'USA, Sikorsky', weight: '9.98 t', speed: '280 km/h', note: '11 troops' },
    dims: [15.26, 16.36, 5.13],
  }),
  mi8: heli({
    id: 'mi8',
    name: 'Mi-8AMTSh',
    short: 'Mi-8',
    role: 'transport_heli',
    faction: 'east',
    crew: 3,
    armour: allRound(10),
    move: 18,
    weapons: [wpn({ id: 'doorguns', name: 'PKT door guns', kind: 'mg', calibre: '7.62', range: 7, aim: 50, pen: 8, round: 'ke', lethality: 1, supp: 20, air: 'yes' }), s8(45)],
    seats: 16,
    thermal: false,
    nvg: true,
    value: 5,
    specs: { origin: 'Russia, Ulan-Ude Aviation Plant (Mil)', weight: '13 t', speed: '250 km/h', note: 'carries up to 36; the game seats 16' },
    dims: [18.17, 21.29, 5.65],
  }),

  // Infantry: section 4.5. Aims (spec silent): rifles 60 to 65, grenades 50 to 55, unguided AT 55 to 65,
  // guided 85 to 88. Lethality and suppression for the whole unit; a fireteam is half its squad.
  squad_w: foot({
    id: 'squad_w',
    name: 'Rifle Squad',
    short: 'Squad',
    role: 'rifle_squad',
    faction: 'west',
    men: SQUAD_W,
    move: 3,
    weapons: [fire('M4A1 and M249', 5, 65, 1, 25), m320(0.8, 20), at4(2)],
    value: 4,
    specs: { origin: 'USA, US Army', weight: 'about 30 kg a soldier', speed: 'on foot', note: 'M4A1, 2 x M249, 2 x M320, AT4' },
  }),
  squad_e: foot({
    id: 'squad_e',
    name: 'Motor Rifle Squad',
    short: 'Squad',
    role: 'rifle_squad',
    faction: 'east',
    men: SQUAD_E,
    move: 3,
    weapons: [fire('AK-12 and PKM', 6, 62, 1, 25), gp34(), pg7vr(3)],
    value: 4,
    specs: { origin: 'Russia, Russian Army', weight: 'about 30 kg a soldier', speed: 'on foot', note: 'AK-12, PKM, RPG-7V2, GP-34, SVDM' },
  }),
  // One M249, one M320 and one AT4 of the squad's two.
  team_w: foot({
    id: 'team_w',
    name: 'Fireteam',
    short: 'Fireteam',
    role: 'fireteam',
    faction: 'west',
    men: ['team_leader', 'auto_rifleman', 'grenadier', 'rifleman'],
    move: 3,
    weapons: [fire('M4A1 and M249', 5, 65, 0.5, 12), m320(0.4, 10), at4(1)],
    value: 2,
    specs: { origin: 'USA, US Army', weight: 'about 30 kg a soldier', speed: 'on foot', note: 'half a rifle squad' },
  }),
  // The PKM and the RPG half of the squad; the RPG gunner carries two of its three rockets.
  team_e: foot({
    id: 'team_e',
    name: 'Fireteam',
    short: 'Fireteam',
    role: 'fireteam',
    faction: 'east',
    men: ['leader', 'gunner', 'at', 'rifleman'],
    move: 3,
    weapons: [fire('AK-12 and PKM', 6, 62, 0.5, 12), pg7vr(2)],
    value: 2,
    specs: { origin: 'Russia, Russian Army', weight: 'about 30 kg a soldier', speed: 'on foot', note: 'half a motor rifle squad' },
  }),
  // ATGM teams cannot fire after moving (section 3.4), so `setup` on both.
  javelin: foot({
    id: 'javelin',
    name: 'FGM-148F Javelin Team',
    short: 'Javelin',
    role: 'at_team',
    faction: 'west',
    men: ['at', 'assistant'],
    move: 3,
    thermal: true,
    weapons: [
      wpn({ id: 'javelin', name: 'FGM-148F Javelin', kind: 'atgm', calibre: 'atgm', range: 26, aim: 88, pen: 800, round: 'ce', top: true, lethality: 0.8, supp: 30, demo: 12, ammo: 4, guidance: 'fnf', setup: true }),
      rifles('M4A1 carbines'),
    ],
    value: 3,
    specs: { origin: 'USA, Javelin Joint Venture (RTX, Lockheed Martin)', weight: '22.3 kg with the CLU', speed: 'on foot', note: 'top attack, fire and forget' },
  }),
  kornet: foot({
    id: 'kornet',
    name: '9K135 Kornet Team',
    short: 'Kornet',
    role: 'at_team',
    faction: 'east',
    men: ['at', 'assistant'],
    move: 2,
    thermal: true,
    weapons: [
      wpn({ id: 'kornet', name: '9M133 Kornet-E', kind: 'atgm', calibre: 'atgm', range: 36, aim: 85, pen: 1200, round: 'ce', lethality: 0.8, supp: 30, demo: 15, ammo: 4, guidance: 'saclos', setup: true }),
      rifles('AK-12 rifles'),
    ],
    value: 3,
    specs: { origin: 'Russia, KBP Tula', weight: '29 kg a round, 25 kg tripod', speed: 'on foot', note: 'laser beam riding' },
  }),
  // "6" rockets read as three of each.
  rpg: foot({
    id: 'rpg',
    name: 'RPG-7V2 Team',
    short: 'RPG',
    role: 'at_team',
    faction: 'east',
    men: ['at', 'assistant'],
    move: 3,
    weapons: [
      pg7vr(3),
      wpn({ id: 'tbg', name: 'RPG-7V2 · TBG-7V thermobaric', kind: 'rocket', calibre: 'rocket', range: 3, aim: 55, pen: 40, round: 'he', lethality: 3, supp: 40, demo: 30, ammo: 3 }),
      rifles('AK-12 rifles'),
    ],
    value: 2.5,
    specs: { origin: 'Russia, Bazalt', weight: '6.3 kg launcher', speed: 'on foot', note: 'tandem HEAT and thermobaric rockets' },
  }),
  // "6" rounds read as three of each.
  gustaf: foot({
    id: 'gustaf',
    name: 'Carl Gustaf M4 Team',
    short: 'Carl Gustaf',
    role: 'at_team',
    faction: 'west',
    men: ['at', 'assistant'],
    move: 3,
    weapons: [
      wpn({ id: 'heat', name: '84 mm M4 · FFV751 HEAT', kind: 'rocket', calibre: '84', range: 6, aim: 65, pen: 500, round: 'ce', lethality: 0.6, supp: 25, demo: 10, ammo: 3 }),
      wpn({ id: 'he', name: '84 mm M4 · HE 441D', kind: 'rocket', calibre: '84', range: 8, aim: 60, pen: 20, round: 'he', lethality: 1.5, supp: 30, demo: 15, ammo: 3 }),
      rifles('M4A1 carbines'),
    ],
    value: 2.5,
    specs: { origin: 'Sweden, Saab', weight: '6.6 kg launcher', speed: 'on foot', note: '84 mm recoilless rifle' },
  }),
  stinger: foot({
    id: 'stinger',
    name: 'FIM-92J Stinger Team',
    short: 'Stinger',
    role: 'aa_team',
    faction: 'west',
    men: ['gunner', 'assistant'],
    move: 3,
    thermal: true,
    weapons: [manpads('FIM-92J Stinger', 32, 75), rifles('M4A1 carbines')],
    value: 2.5,
    specs: { origin: 'USA, RTX', weight: '15.2 kg', speed: 'on foot', note: 'infrared homing; aircraft only' },
  }),
  igla: foot({
    id: 'igla',
    name: '9K338 Igla-S Team',
    short: 'Igla',
    role: 'aa_team',
    faction: 'east',
    men: ['gunner', 'assistant'],
    move: 3,
    weapons: [manpads('9K338 Igla-S', 40, 72), rifles('AK-12 rifles')],
    value: 2.5,
    specs: { origin: 'Russia, KBM', weight: '19 kg', speed: 'on foot', note: 'infrared homing; aircraft only' },
  }),
  // Snipers: one casualty a hit, and `setup` (an aimed shot needs a hide, not a bound).
  sniper_w: foot({
    id: 'sniper_w',
    name: 'MK22 Sniper Team',
    short: 'Sniper',
    role: 'sniper',
    faction: 'west',
    men: ['sniper', 'spotter'],
    move: 3,
    thermal: true,
    spotter: 'spotter',
    weapons: [wpn({ id: 'rifle', name: 'MK22 · .338 Norma Magnum', kind: 'sniper', calibre: '7.62', range: 10, aim: 82, pen: 12, round: 'ke', lethality: 1, supp: 25, precise: true, setup: true })],
    value: 2,
    specs: { origin: 'USA, Barrett', weight: '6.9 kg rifle', speed: 'on foot', note: 'the spotter calls fire' },
  }),
  sniper_e: foot({
    id: 'sniper_e',
    name: 'SV-98M Sniper Team',
    short: 'Sniper',
    role: 'sniper',
    faction: 'east',
    men: ['sniper', 'spotter'],
    move: 3,
    thermal: true,
    spotter: 'spotter',
    weapons: [wpn({ id: 'rifle', name: 'SV-98M · 7.62 x 54R', kind: 'sniper', calibre: '7.62', range: 7, aim: 75, pen: 8, round: 'ke', lethality: 1, supp: 20, precise: true, setup: true })],
    value: 2,
    specs: { origin: 'Russia, Kalashnikov Concern', weight: '6.2 kg rifle', speed: 'on foot', note: 'the spotter calls fire' },
  }),
  // The 2B14 matches the M252's HE, blast and smoke (section 4.5 gives only its range).
  mortar_w: foot({
    id: 'mortar_w',
    name: 'M252A1 81 mm Mortar Team',
    short: 'Mortar',
    role: 'mortar',
    faction: 'west',
    men: ['leader', 'gunner', 'assistant'],
    move: 2,
    weapons: [mortar('M252A1 81 mm · HE', 37), rifles('M4A1 carbines')],
    value: 2.5,
    specs: { origin: 'USA, Watervliet Arsenal (L16 design)', weight: '35 kg', speed: 'on foot', note: 'reaches 5.9 km' },
  }),
  mortar_e: foot({
    id: 'mortar_e',
    name: '2B14 Podnos 82 mm Mortar Team',
    short: 'Mortar',
    role: 'mortar',
    faction: 'east',
    men: ['leader', 'gunner', 'assistant'],
    move: 2,
    weapons: [mortar('2B14 Podnos 82 mm · HE', 26), rifles('AK-12 rifles')],
    value: 2.5,
    specs: { origin: 'Russia, Soviet design', weight: '42 kg', speed: 'on foot', note: 'reaches 4.3 km' },
  }),
  engineer_w: foot({
    id: 'engineer_w',
    name: 'Combat Engineer Squad',
    short: 'Engineers',
    role: 'engineer',
    faction: 'west',
    men: ['leader', 'sapper', 'sapper', 'sapper', 'sapper', 'sapper'],
    move: 3,
    weapons: [fire('M4A1 carbines', 4, 60, 0.6, 15)],
    engineer: true,
    value: 3,
    specs: { origin: 'USA, US Army', weight: 'about 35 kg a soldier', speed: 'on foot', note: 'breaching charges, M21 AT mines, smoke pots' },
  }),
  engineer_e: foot({
    id: 'engineer_e',
    name: 'Sapper Squad',
    short: 'Sappers',
    role: 'engineer',
    faction: 'east',
    men: ['leader', 'sapper', 'sapper', 'sapper', 'sapper', 'sapper'],
    move: 3,
    weapons: [fire('AK-12 rifles', 4, 60, 0.6, 15)],
    engineer: true,
    value: 3,
    specs: { origin: 'Russia, Russian Army', weight: 'about 35 kg a soldier', speed: 'on foot', note: 'breaching charges, TM-62M AT mines, smoke pots' },
  }),
  medic_w: foot({
    id: 'medic_w',
    name: 'Medic Team',
    short: 'Medic',
    role: 'medic',
    faction: 'west',
    men: ['medic', 'medic'],
    move: 3,
    weapons: [fire('M17 pistols and M4A1', 3, 45, 0.2, 5)],
    treat: true,
    value: 1.5,
    specs: { origin: 'USA, US Army', weight: 'about 30 kg a soldier', speed: 'on foot', note: 'treats two wounded a turn' },
  }),
  medic_e: foot({
    id: 'medic_e',
    name: 'Medic Team',
    short: 'Medic',
    role: 'medic',
    faction: 'east',
    men: ['medic', 'medic'],
    move: 3,
    weapons: [fire('pistols and AK-12', 3, 45, 0.2, 5)],
    treat: true,
    value: 1.5,
    specs: { origin: 'Russia, Russian Army', weight: 'about 30 kg a soldier', speed: 'on foot', note: 'treats two wounded a turn' },
  }),
  // Drone teams: the operator flies each strike to impact (`saclos`). FPV teams are the same both sides.
  fpv_w: foot({
    id: 'fpv_w',
    name: 'FPV Drone Team',
    short: 'FPV',
    role: 'fpv_team',
    faction: 'west',
    men: ['operator', 'assistant'],
    move: 3,
    thermal: true,
    weapons: [
      wpn({ id: 'fpv', name: 'FPV drone · PG-7VL warhead', kind: 'fpv', calibre: 'fpv', range: 20, aim: 70, pen: 500, round: 'ce', top: true, lethality: 1, supp: 30, demo: 5, ammo: 4, guidance: 'saclos' }),
      rifles('M4A1 carbines'),
    ],
    value: 2.5,
    specs: { origin: 'Ukraine and USA, various makers', weight: 'about 2 kg a drone', speed: 'on foot', note: 'strikes the top or rear' },
  }),
  fpv_e: foot({
    id: 'fpv_e',
    name: 'FPV Drone Team',
    short: 'FPV',
    role: 'fpv_team',
    faction: 'east',
    men: ['operator', 'assistant'],
    move: 3,
    thermal: true,
    weapons: [
      wpn({ id: 'fpv', name: 'FPV drone · PG-7VL warhead', kind: 'fpv', calibre: 'fpv', range: 20, aim: 70, pen: 500, round: 'ce', top: true, lethality: 1, supp: 30, demo: 5, ammo: 4, guidance: 'saclos' }),
      rifles('AK-12 rifles'),
    ],
    value: 2.5,
    specs: { origin: 'Russia, various makers', weight: 'about 2 kg a drone', speed: 'on foot', note: 'strikes the top or rear' },
  }),
  switchblade: foot({
    id: 'switchblade',
    name: 'Switchblade 600 Team',
    short: 'Switchblade',
    role: 'loiter_team',
    faction: 'west',
    men: ['operator', 'assistant'],
    move: 3,
    thermal: true,
    weapons: [
      wpn({ id: 'loiter', name: 'Switchblade 600', kind: 'loiter', calibre: 'fpv', range: 40, aim: 85, pen: 800, round: 'ce', top: true, lethality: 1.5, supp: 35, demo: 15, ammo: 2, guidance: 'saclos' }),
      rifles('M4A1 carbines'),
    ],
    value: 3,
    specs: { origin: 'USA, AeroVironment', weight: '15 kg air vehicle', speed: 'on foot', note: 'loitering munition, Javelin-class warhead' },
  }),
  lancet: foot({
    id: 'lancet',
    name: 'Lancet-3 Team',
    short: 'Lancet',
    role: 'loiter_team',
    faction: 'east',
    men: ['operator', 'assistant'],
    move: 3,
    thermal: true,
    weapons: [
      wpn({ id: 'loiter', name: 'ZALA Lancet-3', kind: 'loiter', calibre: 'fpv', range: 40, aim: 80, pen: 600, round: 'ce', top: true, lethality: 1.2, supp: 35, demo: 10, ammo: 2, guidance: 'saclos' }),
      rifles('AK-12 rifles'),
    ],
    value: 3,
    specs: { origin: 'Russia, ZALA Aero (Kalashnikov)', weight: '12 kg', speed: 'on foot', note: 'loitering munition' },
  }),

  // Support vehicles: section 4.6. "Armour front/side" is KE and CE alike (plain steel); rear and top
  // thinner. AD and SPGs are radar or observer cued: no thermal sight.
  gepard: vehicle({
    id: 'gepard',
    name: 'Flakpanzer Gepard 1A2',
    short: 'Gepard',
    role: 'spaa',
    faction: 'west',
    mobility: 'tracked',
    crew: 3,
    armour: arm([40, 40], [40, 40], [25, 25], [20, 20], [15, 15]),
    stowage: 'hull',
    move: 8,
    weapons: [
      wpn({ id: 'air', name: '2 x 35 mm KDA · air', kind: 'autocannon', calibre: '35', range: 26, aim: 80, pen: 90, round: 'ke', supp: 30, air: 'only' }),
      wpn({ id: 'ground', name: '2 x 35 mm KDA · ground', kind: 'autocannon', calibre: '35', range: 20, aim: 78, pen: 90, round: 'ke', lethality: 1.2, supp: 35, demo: 8 }),
    ],
    thermal: false,
    radar: 40,
    smoke: 0,
    stabilised: true,
    value: 6,
    profile: 'mbt',
    engine: 'diesel',
    specs: { origin: 'Germany, Krauss-Maffei Wegmann', weight: '47.5 t', speed: '65 km/h', note: 'search and tracking radars' },
    dims: [7.68, 3.71, 4.03],
  }),
  tunguska: vehicle({
    id: 'tunguska',
    name: '2K22M1 Tunguska-M1',
    short: 'Tunguska',
    role: 'spaa',
    faction: 'east',
    mobility: 'tracked',
    crew: 4,
    armour: arm([20, 20], [20, 20], [20, 20], [15, 15], [10, 10]),
    stowage: 'hull',
    move: 8,
    weapons: [
      wpn({ id: 'air', name: '2 x 30 mm 2A38M · air', kind: 'autocannon', calibre: '30', range: 26, aim: 75, pen: 45, round: 'ke', supp: 30, air: 'only' }),
      wpn({ id: 'ground', name: '2 x 30 mm 2A38M · ground', kind: 'autocannon', calibre: '30', range: 15, aim: 72, pen: 45, round: 'ke', lethality: 1, supp: 30, demo: 5 }),
      wpn({ id: 'sam', name: '9M311-M1', kind: 'manpads', calibre: 'manpads', range: 40, aim: 80, pen: 100, round: 'he', supp: 30, ammo: 4, air: 'only', guidance: 'saclos' }),
    ],
    thermal: false,
    radar: 40,
    smoke: 0,
    stabilised: true,
    value: 6,
    profile: 'mbt',
    engine: 'diesel',
    specs: { origin: 'Russia, KBP Tula', weight: '34 t', speed: '65 km/h', note: 'guns and missiles; search and tracking radars' },
    dims: [7.93, 3.24, 4.02],
  }),
  // A direct hit strikes the top; 155 and 152 mm shells defeat any roof here. Dims approximate.
  paladin: vehicle({
    id: 'paladin',
    name: 'M109A7 Paladin',
    short: 'Paladin',
    role: 'spg',
    faction: 'west',
    mobility: 'tracked',
    crew: 4,
    armour: arm([30, 30], [30, 30], [20, 20], [15, 15], [10, 10]),
    stowage: 'hull',
    move: 7,
    weapons: [howitzer('155 mm M284 · HE', '155', 120), hmg('M2 .50 cal')],
    thermal: false,
    smoke: 0,
    stabilised: false,
    value: 6,
    profile: 'mbt',
    engine: 'diesel',
    specs: { origin: 'USA, BAE Systems', weight: '39 t', speed: '61 km/h', note: '155 mm, 39 calibres; M825 smoke' },
    dims: [9.7, 3.9, 3.3],
  }),
  msta: vehicle({
    id: 'msta',
    name: '2S19M2 Msta-S',
    short: 'Msta-S',
    role: 'spg',
    faction: 'east',
    mobility: 'tracked',
    crew: 5,
    armour: arm([30, 30], [30, 30], [20, 20], [15, 15], [10, 10]),
    stowage: 'hull',
    move: 7,
    weapons: [howitzer('152 mm 2A64M · HE', '152', 110), hmg('NSVT 12.7 mm')],
    thermal: false,
    smoke: 0,
    stabilised: false,
    value: 6,
    profile: 'mbt',
    engine: 'diesel',
    specs: { origin: 'Russia, Uraltransmash', weight: '42 t', speed: '60 km/h', note: '152 mm with an autoloader' },
    dims: [11.92, 3.58, 2.99],
  }),
  m88: vehicle({
    id: 'm88',
    name: 'M88A2 Hercules',
    short: 'Hercules',
    role: 'arv',
    faction: 'west',
    mobility: 'tracked',
    crew: 3,
    armour: arm([100, 100], [100, 100], [50, 50], [30, 30], [20, 20]),
    stowage: 'hull',
    move: 6,
    weapons: [hmg('M2 .50 cal')],
    thermal: false,
    smoke: 0,
    stabilised: false,
    repair: true,
    value: 4,
    profile: 'mbt',
    engine: 'diesel',
    specs: { origin: 'USA, BAE Systems', weight: '63.5 t', speed: '48 km/h', note: '35 t boom, 63.5 t winch' },
    dims: [8.6, 3.67, 3.2],
  }),
  brem: vehicle({
    id: 'brem',
    name: 'BREM-1M',
    short: 'BREM',
    role: 'arv',
    faction: 'east',
    mobility: 'tracked',
    crew: 3,
    armour: arm([100, 100], [100, 100], [50, 50], [30, 30], [20, 20]),
    stowage: 'hull',
    move: 7,
    weapons: [hmg('NSVT 12.7 mm')],
    thermal: false,
    smoke: 0,
    stabilised: false,
    repair: true,
    value: 4,
    profile: 'mbt',
    engine: 'diesel',
    specs: { origin: 'Russia, Uralvagonzavod', weight: '41 t', speed: '60 km/h', note: 'T-72 family chassis; crane and winch' },
    dims: [7.98, 3.46, 2.43],
  }),

  // Recon drones: dims are length, wingspan, height.
  raven: drone({
    id: 'raven',
    name: 'RQ-11B Raven',
    short: 'Raven',
    faction: 'west',
    value: 1.5,
    specs: { origin: 'USA, AeroVironment', weight: '2 kg', speed: '95 km/h', note: 'hand-launched; day and thermal camera' },
    dims: [0.9, 1.4, 0.3],
  }),
  orlan: drone({
    id: 'orlan',
    name: 'Orlan-10',
    short: 'Orlan',
    faction: 'east',
    value: 1.5,
    specs: { origin: 'Russia, Special Technology Centre', weight: '18 kg', speed: '150 km/h', note: 'catapult-launched artillery spotter' },
    dims: [1.8, 3.1, 0.6],
  }),
};

/** Every type id, sorted. */
export const TYPE_IDS = (Object.keys(TYPES) as TypeId[]).sort();

export function typeOf(id: TypeId): UnitType {
  return TYPES[id];
}

/** Tracked and wheeled vehicles. */
export const isVehicle = (t: UnitType): boolean => t.mobility === 'tracked' || t.mobility === 'wheeled';
/** Helicopters and recon drones: what air defence and `air` weapons engage. */
export const isAircraft = (t: UnitType): boolean => t.mobility === 'heli' || t.mobility === 'drone';
export const isFoot = (t: UnitType): boolean => t.mobility === 'foot';
/** The weapon the card shows first; recon drones carry none. */
export const primary = (t: UnitType): Weapon | undefined => t.weapons[0];

// --- Off-map support (section 3.9) ---------------------------------------------------------------

export interface SupportType {
  id: SupportAsset['id'];
  name: string;
  short: string;
  faction: Faction;
  /** Missions an artillery formation brings. */
  missions: number;
  weapon: Weapon;
  specs: UnitType['specs'];
}

export const SUPPORT: Record<SupportAsset['id'], SupportType> = {
  himars: {
    id: 'himars',
    name: 'M142 HIMARS',
    short: 'HIMARS',
    faction: 'west',
    missions: 2,
    weapon: wpn({ id: 'gmlrs', name: 'GMLRS · M31 unitary', kind: 'rocket', calibre: 'rocket', range: 45, aim: 95, pen: 300, round: 'he', top: true, lethality: 3, supp: 50, blast: 1, demo: 80, ammo: 2, guidance: 'fnf', indirect: true }),
    specs: { origin: 'USA, Lockheed Martin', weight: '16 t', speed: '85 km/h', note: 'off map; GPS guided' },
  },
  tornado: {
    id: 'tornado',
    name: '9A53-G Tornado-G',
    short: 'Tornado-G',
    faction: 'east',
    missions: 1,
    weapon: wpn({ id: 'salvo', name: '122 mm salvo · 9M22U', kind: 'rocket', calibre: 'rocket', range: 45, aim: 65, pen: 40, round: 'he', top: true, lethality: 2.5, supp: 60, blast: 2, demo: 20, ammo: 1, indirect: true, burst: 6 }),
    specs: { origin: 'Russia, Splav', weight: '24 t', speed: '90 km/h', note: 'off map; 5 x 5 saturation' },
  },
};

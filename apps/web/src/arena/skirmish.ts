import type { Terrain } from '@brink/contracts';
import type { AbilityId, Arsenal, Biome, SiteKind, TimeOfDay, TypeId, Weather } from '@brink/arena';
import type { BattleRequest } from './battle';

// Skirmish: hand-made battles off the war map, for practice and stars. Each one opens when your
// total stars reach its bar; your best result on each is kept. The first eight keep the ids and
// bars they had before the combined-arms battle, so stars already earned stay with them.

export interface Skirmish {
  id: string;
  name: string;
  text: string;
  terrain: Terrain;
  river: boolean;
  site: SiteKind;
  biome: Biome;
  time: TimeOfDay;
  weather: Weather;
  arsenal: { blue: Arsenal; red: Arsenal };
  yours: TypeId[];
  theirs: TypeId[];
  skill: number;
  abilities: AbilityId[];
  /** Total stars needed to play it. */
  stars: number;
}

export const SKIRMISHES: readonly Skirmish[] = [
  { id: 'first-blood', name: 'First Blood', text: 'A tank platoon and a squad against a dug-in village. Move, then fire: the odds show before you shoot.', terrain: 'plains', river: false, site: null, biome: 'temperate', time: 'day', weather: 'clear', arsenal: { blue: 'us', red: 'legacy' }, yours: ['m1a2', 'm1a2', 'm1a2', 'm2a3', 'squad_w', 'medic_w', 'mortar_w', 'm1a2', 'javelin', 'sniper_w'], theirs: ['squad_e', 'squad_e', 'rpg', 'squad_e', 'bmp3', 'sniper_e', 'kornet', 'mortar_e', 'medic_e', 'squad_e'], skill: 0.15, abilities: [], stars: 0 },
  { id: 'bank-shot', name: 'Street Fight', text: 'Streets at dusk. Infantry clear the blocks; tanks stay a street back and fire down the lanes.', terrain: 'urban', river: false, site: null, biome: 'urban', time: 'dusk', weather: 'overcast', arsenal: { blue: 'us', red: 'legacy' }, yours: ['m1a2', 'm1a2', 'stryker', 'squad_w', 'stryker', 'squad_w', 'javelin', 'medic_w', 'engineer_w', 'sniper_w', 'mortar_w'], theirs: ['t72b3', 'bmp3', 'squad_e', 'squad_e', 'rpg', 'rpg', 'sniper_e', 'squad_e', 'kornet', 'mortar_e', 'medic_e'], skill: 0.28, abilities: ['repair'], stars: 2 },
  { id: 'crossing', name: 'The Crossing', text: 'Two bridges on the steppe and a gun line behind them. Smoke the bank, then rush one.', terrain: 'plains', river: true, site: null, biome: 'steppe', time: 'day', weather: 'clear', arsenal: { blue: 'europe', red: 'russia' }, yours: ['leo2a7', 'leo2a7', 'leo2a7', 'cv90', 'squad_w', 'cv90', 'squad_w', 'paladin', 'engineer_w', 'mortar_w', 'medic_w', 'raven'], theirs: ['t90m', 't90m', 'bmp3', 'squad_e', 'kornet', 'msta', 'mortar_e', 'squad_e', 'rpg', 'orlan', 'medic_e'], skill: 0.36, abilities: ['repair', 'mines'], stars: 4 },
  { id: 'the-woods', name: 'The Woods', text: 'Winter forest at night. Your thermal sights see them first; their armour holds the tracks.', terrain: 'forest', river: false, site: null, biome: 'winter', time: 'night', weather: 'clear', arsenal: { blue: 'us', red: 'russia' }, yours: ['squad_w', 'squad_w', 'squad_w', 'javelin', 'javelin', 'sniper_w', 'medic_w', 'mortar_w', 'gustaf', 'fpv_w'], theirs: ['bmp3', 'squad_e', 'bmp3', 'squad_e', 't80bvm', 'squad_e', 'rpg', 'kornet', 'medic_e', 'mortar_e'], skill: 0.42, abilities: ['sweep'], stars: 6 },
  { id: 'take-the-city', name: 'Take the City', text: 'End two rounds in the square with none of them in it. Engineers breach; medics keep squads in the fight.', terrain: 'urban', river: false, site: 'city', biome: 'urban', time: 'day', weather: 'rain', arsenal: { blue: 'us', red: 'legacy' }, yours: ['m1a2', 'm1a2', 'm2a3', 'squad_w', 'm2a3', 'squad_w', 'engineer_w', 'mortar_w', 'medic_w', 'javelin', 'sniper_w', 'm88'], theirs: ['squad_e', 'squad_e', 'squad_e', 'rpg', 'rpg', 't72b3', 'sniper_e', 'kornet', 'mortar_e', 'bmp3', 'medic_e', 'engineer_e'], skill: 0.46, abilities: ['repair', 'airstrike'], stars: 9 },
  { id: 'high-ground', name: 'High Ground', text: 'They hold the ridge hull-down at dawn. Your guns and drones work them before you go up.', terrain: 'hills', river: false, site: 'objective', biome: 'temperate', time: 'dawn', weather: 'clear', arsenal: { blue: 'europe', red: 'russia' }, yours: ['leo2a7', 'cr3', 'cr3', 'cv90', 'squad_w', 'paladin', 'raven', 'fpv_w', 'switchblade', 'mortar_w', 'medic_w', 'm88'], theirs: ['t90m', 't90m', 't80bvm', 'bmp3', 'squad_e', 'kornet', 'mortar_e', 'tunguska', 'squad_e', 'rpg', 'brem'], skill: 0.5, abilities: ['missiles', 'repair'], stars: 12 },
  { id: 'swarm', name: 'Swarm', text: 'FPV drones and Lancets hunt your armour. Keep the Gepard close and the helicopter low.', terrain: 'plains', river: false, site: null, biome: 'steppe', time: 'day', weather: 'overcast', arsenal: { blue: 'europe', red: 'russia' }, yours: ['leo2a7', 'leo2a7', 'gepard', 'cv90', 'squad_w', 'ah64e', 'stinger', 'medic_w', 'mortar_w', 'm88'], theirs: ['fpv_e', 'fpv_e', 'lancet', 'orlan', 'tunguska', 't90m', 'squad_e', 'kornet', 'igla', 'msta'], skill: 0.56, abilities: ['sweep', 'armor'], stars: 15 },
  { id: 'last-stand', name: 'Last Stand', text: 'Their capital in the mountains, in fog, with their best crews. Everything you have.', terrain: 'mountains', river: false, site: 'capital', biome: 'winter', time: 'day', weather: 'fog', arsenal: { blue: 'us', red: 'russia' }, yours: ['m1a2', 'm1a2', 'm1a2', 'm2a3', 'squad_w', 'm2a3', 'squad_w', 'paladin', 'ah64e', 'uh60', 'squad_w', 'javelin', 'medic_w', 'engineer_w', 'm88', 'stinger'], theirs: ['t90m', 't90m', 't80bvm', 'bmp3', 'squad_e', 'kornet', 'tunguska', 'igla', 'msta', 'mortar_e', 'squad_e', 'squad_e', 'rpg', 'engineer_e', 'sniper_e', 'medic_e'], skill: 0.66, abilities: ['repair', 'airstrike', 'missiles', 'armor'], stars: 18 },
  { id: 'desert-raid', name: 'Desert Raid', text: 'Apaches and a Little Bird over open desert. Kill their air defence first, then the armour.', terrain: 'plains', river: false, site: 'depot', biome: 'desert', time: 'day', weather: 'clear', arsenal: { blue: 'us', red: 'legacy' }, yours: ['ah64e', 'ah64e', 'ah6', 'm1134', 'm1134', 'stryker', 'squad_w', 'raven', 'stinger', 'medic_w'], theirs: ['t72b3', 't72b3', 'bmp3', 'squad_e', 'igla', 'igla', 'tunguska', 'kornetd', 'squad_e', 'mortar_e'], skill: 0.3, abilities: [], stars: 3 },
  { id: 'air-assault', name: 'Air Assault', text: 'Black Hawks put two squads on the objective at dawn while the Apache covers them.', terrain: 'plains', river: false, site: 'objective', biome: 'temperate', time: 'dawn', weather: 'clear', arsenal: { blue: 'us', red: 'russia' }, yours: ['uh60', 'squad_w', 'uh60', 'squad_w', 'ah64e', 'ah6', 'javelin', 'gustaf', 'medic_w', 'mortar_w', 'm10'], theirs: ['squad_e', 'squad_e', 'bmp3', 'squad_e', 'igla', 'rpg', 'sniper_e', 'sprut', 'mortar_e', 'medic_e'], skill: 0.45, abilities: ['sweep'], stars: 8 },
  { id: 'night-raid', name: 'Night Raid', text: 'A tank raid across the steppe at night. Turn on the thermal view: their infantry cannot see you.', terrain: 'plains', river: false, site: null, biome: 'steppe', time: 'night', weather: 'clear', arsenal: { blue: 'us', red: 'legacy' }, yours: ['m1a2', 'm1a2', 'm1a2', 'm1a2', 'm2a3', 'squad_w', 'm2a3', 'squad_w', 'm88', 'medic_w', 'paladin'], theirs: ['t72b3', 't72b3', 't72b3', 'bmp3', 'squad_e', 'squad_e', 'rpg', 'kornet', 'msta', 'brem', 'medic_e'], skill: 0.48, abilities: ['missiles'], stars: 11 },
  { id: 'winter-line', name: 'Winter Line', text: 'Snow and a frozen front. Leopards and Challengers against T-80s that can outrun them.', terrain: 'hills', river: false, site: null, biome: 'winter', time: 'day', weather: 'snow', arsenal: { blue: 'europe', red: 'russia' }, yours: ['leo2a7', 'leo2a7', 'cr3', 'cv90', 'squad_w', 'cv90', 'squad_w', 'mortar_w', 'engineer_w', 'gepard', 'medic_w', 'm88', 'paladin'], theirs: ['t80bvm', 't80bvm', 't90m', 'bmp3', 'squad_e', 'bmp3', 'squad_e', 'kornet', 'tunguska', 'msta', 'ka52', 'medic_e'], skill: 0.55, abilities: ['repair', 'armor'], stars: 14 },
];

export function skirmishRequest(s: Skirmish, attempt: number): BattleRequest {
  let seed = 2166136261 ^ attempt;
  for (let i = 0; i < s.id.length; i++) seed = Math.imul(seed ^ s.id.charCodeAt(i), 16777619);
  return {
    target: s.id,
    orders: {},
    title: s.name,
    skirmish: true,
    setup: {
      seed: seed >>> 0,
      terrain: s.terrain,
      river: s.river,
      site: s.site,
      biome: s.biome,
      time: s.time,
      weather: s.weather,
      arsenal: s.arsenal,
      attackers: [{ id: 'blue', cls: 'armor', strength: 1000, name: 'Your Company', color: '#3fa796', rank: 0, types: s.yours }],
      defenders: [{ id: 'red', cls: 'infantry', strength: 1000, name: 'Enemy Company', color: '#c9733a', rank: s.skill > 0.6 ? 1 : 0, types: s.theirs }],
      skill: s.skill,
      abilities: s.abilities,
    },
  };
}

import type { Terrain, UnitClass } from '@brink/contracts';
import { UNITS } from '@brink/game-data';
import type { AbilityId, SiteKind, UnitSpec } from '@brink/arena';
import type { BattleRequest } from './battle';

// Skirmish: hand-made battles off the war map, for practice and stars. Each one opens when your
// total stars reach its bar; your best result on each is kept.

export interface Skirmish {
  id: string;
  name: string;
  text: string;
  terrain: Terrain;
  river: boolean;
  site: SiteKind;
  yours: UnitClass[];
  theirs: UnitClass[];
  skill: number;
  abilities: AbilityId[];
  /** Total stars needed to play it. */
  stars: number;
}

export const SKIRMISHES: readonly Skirmish[] = [
  { id: 'first-blood', name: 'First blood', text: 'One tank against a dug-in squad. Learn to drive and shoot.', terrain: 'plains', river: false, site: null, yours: ['armor'], theirs: ['infantry', 'infantry'], skill: 0.15, abilities: [], stars: 0 },
  { id: 'bank-shot', name: 'Bank shot', text: 'Streets and walls. Bounce your shells round the corner.', terrain: 'urban', river: false, site: null, yours: ['armor', 'recon'], theirs: ['armor', 'infantry'], skill: 0.28, abilities: ['repair'], stars: 2 },
  { id: 'crossing', name: 'The crossing', text: 'Two bridges, a gun line behind them. Pick one and go.', terrain: 'plains', river: true, site: null, yours: ['armor', 'mechanized'], theirs: ['armor', 'artillery'], skill: 0.36, abilities: ['repair', 'mines'], stars: 4 },
  { id: 'the-woods', name: 'The woods', text: 'Infantry hides in trees. Hunt them with rockets.', terrain: 'forest', river: false, site: null, yours: ['infantry', 'infantry'], theirs: ['mechanized', 'recon'], skill: 0.42, abilities: ['sweep'], stars: 6 },
  { id: 'take-the-city', name: 'Take the city', text: 'Hold the square for six seconds with nobody else in it.', terrain: 'urban', river: false, site: 'city', yours: ['armor', 'infantry', 'mechanized'], theirs: ['infantry', 'infantry', 'armor'], skill: 0.46, abilities: ['repair', 'airstrike'], stars: 9 },
  { id: 'high-ground', name: 'High ground', text: 'They hold the ridge. Your guns lob over it.', terrain: 'hills', river: false, site: 'objective', yours: ['armor', 'artillery'], theirs: ['armor', 'armor', 'infantry'], skill: 0.5, abilities: ['missiles', 'repair'], stars: 12 },
  { id: 'swarm', name: 'Swarm', text: 'Drones dive from every side. Keep moving.', terrain: 'plains', river: false, site: null, yours: ['armor', 'air'], theirs: ['drone', 'drone', 'drone', 'recon'], skill: 0.56, abilities: ['sweep', 'armor'], stars: 15 },
  { id: 'last-stand', name: 'Last stand', text: 'Their capital, their best crews. Everything you have.', terrain: 'mountains', river: false, site: 'capital', yours: ['armor', 'armor', 'air', 'infantry'], theirs: ['armor', 'armor', 'artillery', 'mechanized', 'infantry'], skill: 0.66, abilities: ['repair', 'airstrike', 'missiles', 'armor'], stars: 18 },
];

const BLUE = '#3fa796';
const RED = '#c9733a';

function specs(side: 'b' | 'r', classes: UnitClass[], color: string, rank: number): UnitSpec[] {
  return classes.map((cls, i) => ({ id: `${side}${i}`, cls, strength: 1000, name: UNITS[cls].name, color, rank }));
}

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
      attackers: specs('b', s.yours, BLUE, 0),
      defenders: specs('r', s.theirs, RED, s.skill > 0.6 ? 1 : 0),
      skill: s.skill,
      abilities: s.abilities,
    },
  };
}

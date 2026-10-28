import type { ArenaResult } from '@brink/arena';
import type { BattleRequest } from './battle';

// Your record as a commander, kept on this device: battles fought and won, stars earned (best per
// skirmish), and the wars you have won, which unlock new theatres.

const KEY = 'brink.career.v1';

export interface Career {
  battles: number;
  wins: number;
  stars: number;
  /** Best stars per skirmish, keyed by its id. */
  best: Record<string, number>;
  /** Scenario ids of wars won. */
  warsWon: string[];
}

const EMPTY: Career = { battles: 0, wins: 0, stars: 0, best: {}, warsWon: [] };

export function readCareer(): Career {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...EMPTY, ...(JSON.parse(raw) as Partial<Career>) } : { ...EMPTY };
  } catch {
    return { ...EMPTY };
  }
}

function write(c: Career): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    // Storage is optional: the record just does not persist.
  }
}

export function recordStars(req: BattleRequest, result: ArenaResult): void {
  const c = readCareer();
  c.battles += 1;
  if (result.won) c.wins += 1;
  c.stars += result.stars;
  if (req.skirmish) c.best[req.target] = Math.max(c.best[req.target] ?? 0, result.stars);
  write(c);
}

export function recordWarWon(scenarioId: string): void {
  const c = readCareer();
  if (!c.warsWon.includes(scenarioId)) c.warsWon = [...c.warsWon, scenarioId];
  write(c);
}

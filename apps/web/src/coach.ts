import { create } from 'zustand';
import { readPrefs, writePrefs } from './saves';

// The guided first match: a coach that rides a real campaign and teaches it one action at a
// time. Each step finishes when the player actually does the thing, read from the game store.

export interface CoachSnap {
  nation: string;
  turn: number;
  /** Turn the guided match began on. */
  start: number;
  /** Own formations given a real order (anything but hold). */
  ordered: number;
  idle: number;
  recruiting: boolean;
  resolving: boolean;
  playback: boolean;
  showReport: boolean;
  /** The turn summary was opened during the guide. */
  reportSeen: boolean;
  showThreat: boolean;
  attackOrdered: boolean;
  diplomacyOpen: boolean;
}

export interface CoachStep {
  id: string;
  title: string;
  body: (s: CoachSnap) => string;
  /** What finishes the step. Steps without it wait for the player's "Got it". */
  done?: (s: CoachSnap) => boolean;
  /** The step can be passed over (the moment may not have come yet). */
  skippable?: boolean;
  /** Keys worth showing with the step. */
  keys?: string[];
}

export const STEPS: readonly CoachStep[] = [
  {
    id: 'brief',
    title: 'Your war',
    body: (s) =>
      `You command the ${s.nation}. Win by holding 40% of all victory points (cities, capitals and the three objectives), or be the last power standing. Thirty turns. Everyone plans in secret; when the turn ends, every order happens at once.`,
  },
  {
    id: 'move',
    title: 'Move a unit',
    body: () =>
      'A unit is selected: its card is bottom left. Blue hexes are where it can reach this turn. Click one to send it there. To pick a different unit, click it first.',
    done: (s) => s.ordered > 0,
    keys: ['Click', 'M'],
  },
  {
    id: 'all',
    title: 'Orders for everyone',
    body: (s) =>
      `${s.idle} ${s.idle === 1 ? 'unit still waits' : 'units still wait'} for orders (amber dot). Ordering one jumps to the next. N cycles through them; H holds in place, D digs in.`,
    done: (s) => s.idle === 0,
    skippable: true,
    keys: ['N', 'H', 'D'],
  },
  {
    id: 'build',
    title: 'Build',
    body: () => 'Your cities produce. Click a city banner on the map and choose a unit to build. It costs resources now and musters in a few turns.',
    done: (s) => s.recruiting,
    skippable: true,
  },
  {
    id: 'end',
    title: 'End the turn',
    body: () => 'Press Next Turn, bottom right. Your orders lock, the three AI powers lock theirs, and the world moves.',
    done: (s) => s.resolving || s.turn > s.start,
    keys: ['Ctrl+Enter'],
  },
  {
    id: 'watch',
    title: 'Watch it happen',
    body: () => 'This is the replay: every move, strike and battle of the turn, as your units saw it. Space pauses, arrows step through phases.',
    done: (s) => !s.playback && !s.resolving && s.turn > s.start,
    keys: ['Space', '← →'],
  },
  {
    id: 'report',
    title: 'The turn summary',
    body: (s) =>
      s.showReport
        ? 'What you gained and lost, and what your scouts saw. ‹ › pages through earlier turns. Close it to plan the next turn.'
        : 'Results also arrive as notifications on the right. For the full story, open the turn summary (bottom right).',
    done: (s) => s.reportSeen && !s.showReport,
    keys: ['Esc'],
  },
  {
    id: 'threat',
    title: 'Where they can hit you',
    body: () => 'Press V for the threat overlay. Red hexes are where seen enemies could strike next turn; darker means more of them. Hover an enemy to see its own reach.',
    done: (s) => s.showThreat,
    keys: ['V'],
  },
  {
    id: 'attack',
    title: 'Attack',
    body: () =>
      'Enemies you can hit get a red ring when your unit is selected. Right-click one to attack: the combat card shows the odds first. Artillery and air strike from range without moving. Push toward the objectives.',
    done: (s) => s.attackOrdered,
    skippable: true,
    keys: ['Right-click', 'A'],
  },
  {
    id: 'diplomacy',
    title: 'Not everyone has to be an enemy',
    body: () =>
      'Open Diplomacy (key 5). Propose peace to a power you are not fighting; it takes effect when they propose back. Tearing up a peace later costs stability.',
    done: (s) => s.diplomacyOpen,
    skippable: true,
    keys: ['5'],
  },
  {
    id: 'done',
    title: 'Over to you, Commander',
    body: () => 'That is the whole loop: order, end the turn, watch, adapt. ? shows every key, and the Field manual in the menu has the rules. Then bring friends: Multiplayer.',
    keys: ['?'],
  },
];

interface CoachState {
  active: boolean;
  step: number;
  start: number;
  reportSeen: boolean;
  begin(turn: number): void;
  sawReport(): void;
  next(): void;
  /** Leave the guided match (finished or skipped); it will not be offered first again. */
  finish(): void;
  stop(): void;
}

export const useCoach = create<CoachState>((set, get) => ({
  active: false,
  step: 0,
  start: 1,
  reportSeen: false,
  begin: (turn) => set({ active: true, step: 0, start: turn, reportSeen: false }),
  sawReport: () => set({ reportSeen: true }),
  next: () => {
    const step = get().step + 1;
    if (step >= STEPS.length) get().finish();
    else set({ step });
  },
  finish: () => {
    writePrefs({ tutorialDone: true });
    set({ active: false });
  },
  stop: () => set({ active: false }),
}));

export function tutorialDone(): boolean {
  return readPrefs().tutorialDone === true;
}

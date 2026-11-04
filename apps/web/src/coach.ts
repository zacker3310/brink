import { create } from 'zustand';
import { readPrefs, writePrefs } from './saves';

// The guided first match: a coach that rides a real campaign and teaches its first turn by doing,
// in five steps and well under three minutes. Each step finishes when the player actually does the
// thing, read from the game store. What the first turn does not need (building, the threat overlay,
// diplomacy, battles by hand) is named in the last step and left for the player to find.

export interface CoachSnap {
  nation: string;
  turn: number;
  maxTurns: number;
  /** Turn the guided match began on. */
  start: number;
  /** Own formations given a real order (anything but hold). */
  ordered: number;
  idle: number;
  /** Units whose orders the staff drafted this turn. */
  planned: number;
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
  /** Why: one or two sentences of context. */
  body: (s: CoachSnap) => string;
  /** What to do now, in a few words: the coach's highlighted line. */
  action?: (s: CoachSnap) => string;
  /** What finishes the step. Steps without it wait for the player's "Got it". */
  done?: (s: CoachSnap) => boolean;
  /** The step can be passed over. */
  skippable?: boolean;
  /** Keys worth showing with the step. */
  keys?: string[];
  /** The same step said for a touch screen, where there are no keys. */
  touch?: (s: CoachSnap) => string;
  touchAction?: (s: CoachSnap) => string;
}

const units = (n: number) => `${n} ${n === 1 ? 'unit still waits' : 'units still wait'}`;

export const STEPS: readonly CoachStep[] = [
  {
    id: 'move',
    title: 'Your first order',
    body: (s) =>
      `You command the ${s.nation}. Three AI powers plan in secret; when the turn ends, every order happens at once. Your lead unit is selected and the blue hexes are where it can reach.`,
    action: () => 'Right-click a blue hex to move there',
    done: (s) => s.ordered > 0,
    keys: ['Right-click', 'N'],
    touch: (s) => `You command the ${s.nation}. Your stack is selected: blue hexes are where it can reach this turn.`,
    touchAction: () => 'Tap a blue hex to move there',
  },
  {
    id: 'plan',
    title: 'Hand the rest to your staff',
    body: (s) => `${units(s.idle)} for orders (amber dot). Order each by hand, or let your staff draft the rest toward the best targets. It is a draft: change any order you like.`,
    action: () => 'Press P: the staff plans the rest',
    done: (s) => s.planned > 0 || s.idle === 0,
    skippable: true,
    keys: ['P'],
    touch: (s) => `${units(s.idle)} for orders. Your staff can draft the rest; change any order you like.`,
    touchAction: () => 'Tap PLAN',
  },
  {
    id: 'end',
    title: 'End the turn',
    body: () => 'Your orders lock, the three AI powers lock theirs, and the world moves at once.',
    action: () => 'Next Turn, then Commit',
    done: (s) => s.resolving || s.turn > s.start,
    keys: ['Ctrl+Enter', 'Enter'],
    touch: () => 'Your orders lock, the three AI powers lock theirs, and the world moves at once.',
    touchAction: () => 'Tap END TURN, then COMMIT',
  },
  {
    id: 'watch',
    title: 'Watch it happen',
    body: () => 'Every move, strike and battle of the turn, as your units saw it.',
    action: () => 'Watch, or press Enter to skip',
    done: (s) => !s.playback && !s.resolving && s.turn > s.start,
    keys: ['Space', 'Enter'],
    touch: () => 'Every move, strike and battle of the turn, as your units saw it.',
    touchAction: () => 'Watch, or tap Skip',
  },
  {
    id: 'done',
    title: 'Turn one is history',
    body: () =>
      'That is the whole loop: order, end the turn, watch, adapt. Next, build in your cities (click a banner), press V to see where the enemy can strike, and attack a red-ringed enemy to fight the battle by hand.',
    action: () => 'Over to you, Commander',
    keys: ['Enter', 'V', '?'],
    touch: () => 'That is the whole loop: order, end the turn, watch, adapt. Next, build in your cities (tap a banner), and attack a red-ringed enemy to fight the battle by hand.',
    touchAction: () => 'Over to you, Commander',
  },
];

interface CoachState {
  active: boolean;
  step: number;
  start: number;
  reportSeen: boolean;
  /** When the guide began (ms), to tell the player how long it took. */
  startedAt: number;
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
  startedAt: 0,
  begin: (turn) => set({ active: true, step: 0, start: turn, reportSeen: false, startedAt: Date.now() }),
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

// The game's sound, in one place: the mixer (mixer.ts, output.ts), the adaptive score and its
// stingers (music.ts, score.ts, stingers.ts), the interface sounds (ui.ts), the battle's mood
// (battleMood.ts) and the war map's tension (tension.ts, read by bridge.ts). Everything is
// synthesised with Web Audio; there are no audio files.

import type { Battle, BattleEvent } from '@brink/arena/v2';
import { moodIntensity, newMood, feedMood, type BattleScoreHooks, type Mood } from './battleMood';
import { MusicDirector } from './music';
import { mixer, whenUnlocked } from './output';
import type { StingerKind } from './stingers';
import { UI_GAP, UI_RECIPES, type UiSound } from './ui';
import { setLite } from './voices';

export { mixer } from './output';
export type { StingerKind } from './stingers';
export type { UiSound } from './ui';

// A phone plays the score with half the oscillators.
if (typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)) setLite(true);

export const music = new MusicDirector(mixer);
// The score waits for the first touch; then whatever scene was set starts playing.
whenUnlocked(() => music.tick());

const clock = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;

const lastUi: Partial<Record<UiSound, number>> = {};
let soundSeq = 0;

/** Something played its own sound for this gesture: the generic tap stands down. */
export function markSound(): void {
  soundSeq++;
}

/** An interface sound on the ui bus. */
export function uiSound(s: UiSound): void {
  const now = clock();
  markSound();
  if ((lastUi[s] ?? -Infinity) + UI_GAP[s] > now) return;
  lastUi[s] = now;
  const ctx = mixer.context();
  const out = ctx && mixer.bus('ui', ctx);
  if (!ctx || !out) return;
  UI_RECIPES[s](ctx, out, ctx.currentTime + 0.005);
}

export function stinger(kind: StingerKind): void {
  music.stinger(kind);
}

// --- The arena ---------------------------------------------------------------------------------

let mood: Mood | null = null;
let owners = 0;

export const battleScore: BattleScoreHooks = {
  begin(battle: Battle) {
    owners++;
    mood = newMood(battle.units, clock());
    music.setBattle(true, () => (mood ? moodIntensity(mood, clock()) : 0));
  },
  feed(events: readonly BattleEvent[]) {
    if (!mood) return;
    feedMood(mood, events, clock());
    // The stage calls `ended` when its film gets there; a skipped film still gets its stinger.
    const end = events.find((e) => e.type === 'end');
    if (end?.type === 'end') {
      const m = mood;
      setTimeout(() => {
        if (mood === m) battleScore.ended(end.won);
      }, 9000);
    }
  },
  ended(won: boolean) {
    if (!mood || mood.ended) return;
    mood.ended = won ? 'won' : 'lost';
    music.stinger(won ? 'battleWon' : 'battleLost');
  },
  end() {
    owners = Math.max(0, owners - 1);
    if (owners > 0) return;
    mood = null;
    music.setBattle(false);
  },
};

// --- Taps on any button ------------------------------------------------------------------------

/** Buttons with their own sound, by test id (the arena's command bar). */
const BY_ID: Record<string, UiSound> = {
  'arena-fire': 'radio',
  'arena-move': 'radio',
  'arena-hold': 'radio',
  'arena-execute': 'radio',
  'arena-do-it': 'radio',
  'arena-retreat': 'radio',
  'arena-end-turn': 'endTurn',
  'arena-fight': 'deploy',
  'arena-undo': 'back',
  'arena-back': 'back',
};

let taps = false;

/**
 * A soft tap on every button press, without touching the components: one listener on the document.
 * A button whose handler plays its own sound (an order, a card) wins: the tap waits a moment and
 * stands down if another sound came meanwhile.
 */
export function installTaps(): void {
  if (taps || typeof document === 'undefined') return;
  taps = true;
  document.addEventListener(
    'click',
    (e) => {
      const el = (e.target as Element | null)?.closest?.('button, [role="button"], [role="tab"], [role="switch"], a[href]');
      if (!el || (el as HTMLButtonElement).disabled) return;
      const id = el.getAttribute('data-testid') ?? '';
      const named = BY_ID[id];
      const seq = soundSeq;
      setTimeout(() => {
        if (soundSeq !== seq) return;
        uiSound(named ?? (el.getAttribute('aria-pressed') !== null || el.getAttribute('role') === 'switch' ? 'toggle' : 'tap'));
      }, 0);
    },
    true,
  );
}

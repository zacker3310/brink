// The page's one mixer, muted from the saved preference. iOS only lets audio start inside a user
// gesture: the context is made (or resumed) on the first touch, click or key, with a silent buffer
// played into it, which is what older iOS needs to really unlock.

import { readPrefs } from '../saves';
import { Mixer } from './mixer';

function makeContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  return Ctor ? new Ctor({ latencyHint: 'interactive' }) : null;
}

export const mixer = new Mixer({ create: makeContext, muted: readPrefs().muted === true });

/** Functions run once the context first runs (the score starts on the first touch). */
const onUnlock = new Set<() => void>();
let unlocked = false;

export function whenUnlocked(fn: () => void): void {
  if (unlocked) fn();
  else onUnlock.add(fn);
}

const events = ['pointerdown', 'touchend', 'keydown'] as const;

/** Make or resume the context from inside a gesture; runs the waiting starters the first time. */
export function unlockNow(): void {
  const ctx = mixer.context();
  if (!ctx || unlocked) return;
  try {
    const src = ctx.createBufferSource();
    src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    src.connect(ctx.destination);
    src.start(0);
  } catch {
    // Nothing to unlock.
  }
  unlocked = true;
  for (const e of events) window.removeEventListener(e, unlockNow, true);
  for (const fn of onUnlock) fn();
  onUnlock.clear();
}

if (typeof window !== 'undefined') {
  for (const e of events) window.addEventListener(e, unlockNow, true);
  document.addEventListener('visibilitychange', () => mixer.visible(document.visibilityState === 'visible'));
}

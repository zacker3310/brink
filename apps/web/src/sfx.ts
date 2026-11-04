import { markSound, mixer, stinger, uiSound } from './audio';
import { unlockNow } from './audio/output';
import { noise, tone } from './audio/voices';
import { writePrefs } from './saves';

// Sound, synthesised with Web Audio: no audio files to download. The mixer (audio/mixer.ts) owns
// the one context, its music, sfx and ui buses and the mute; iOS only lets audio start inside a
// user gesture, so the context is made (or resumed) on the first touch, click or key.

/** The game's AudioContext, or null when muted (or the platform has none). */
export function audio(): AudioContext | null {
  return mixer.context();
}

export function isMuted(): boolean {
  return mixer.isMuted;
}

export function setMuted(m: boolean): void {
  mixer.setMuted(m);
  writePrefs({ muted: m });
  // Unmuting is a tap: the context may start now.
  if (!m) unlockNow();
}

/** A war-map sound on the sfx bus. */
function onSfx(fn: (ctx: AudioContext, out: AudioNode, t: number) => void): void {
  markSound();
  const ctx = mixer.context();
  const out = ctx && mixer.bus('sfx', ctx);
  if (ctx && out) fn(ctx, out, ctx.currentTime + 0.01);
}

export const sfx = {
  /** Selecting a unit or city. */
  select: () => uiSound('select'),
  /** An order given. */
  order: () => uiSound('order'),
  /** A card played from the hand. */
  card: () => uiSound('card'),
  /** A target in crosshairs, waiting for the confirming tap. */
  arm: () => uiSound('arm'),
  /** Orders locked: the turn goes. */
  endTurn: () => uiSound('endTurn'),
  /** A gun, a strike landing. */
  boom: () =>
    onSfx((c, o, t) => {
      noise(c, o, t, 0.7, 0.3, { freq: 900, freqEnd: 60 });
      tone(c, o, t, 85, 0.45, 0.32, { type: 'sine', attack: 0.003, slideTo: 38 });
    }),
  /** Small arms and a crump: a battle in a hex. */
  battle: () =>
    onSfx((c, o, t) => {
      for (const [i, j] of [
        [0, 0.01],
        [1, 0.025],
        [2, 0.0],
        [3, 0.018],
        [4, 0.03],
      ] as const)
        noise(c, o, t + i * 0.07 + j, 0.05, 0.1, { type: 'bandpass', freq: 3000, freqEnd: 1200, q: 0.8 });
      noise(c, o, t + 0.25, 0.5, 0.2, { freq: 650, freqEnd: 70 });
      tone(c, o, t + 0.25, 70, 0.35, 0.18, { type: 'sine', attack: 0.003, slideTo: 40 });
    }),
  /** Victory and defeat stingers, over the score. */
  win: () => stinger('victory'),
  lose: () => stinger('defeat'),
};

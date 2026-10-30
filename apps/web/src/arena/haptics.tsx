import { useCallback, type MouseEvent } from 'react';

// A haptic tick on your own Fire and End Turn taps, on an iPhone. iOS Safari has no
// navigator.vibrate, but since Safari 17.4 a checkbox with the `switch` attribute ticks when it is
// toggled (the trick behind the ios-haptics package). Recent iOS ignores toggles made by script, so
// the tick has to come from your own finger: a label laid over the button takes the tap, the browser
// toggles the label's hidden switch (the tick), and the button's own click follows a moment later.
// Nothing ticks during playback (the buttons are not live then), and other browsers just toggle a
// hidden checkbox.

/**
 * Put inside a `relative` button. `on`: the Haptics setting, and the button live; off renders nothing
 * and the button works as before. Keyboard and screen-reader presses reach the button directly.
 */
export function HapticTick({ on }: { on: boolean }) {
  // `switch` is not in React's input attributes yet.
  const sw = useCallback((el: HTMLInputElement | null) => el?.setAttribute('switch', ''), []);
  if (!on) return null;
  const tap = (e: MouseEvent<HTMLLabelElement>) => {
    // The label's own click toggles the switch after this handler; the switch's click comes back up
    // through here too. Neither reaches the button: the button gets one click of its own, once the
    // toggle (and the tick) has happened.
    e.stopPropagation();
    if (e.target !== e.currentTarget) return;
    const button = e.currentTarget.closest('button');
    setTimeout(() => button?.click(), 0);
  };
  return (
    <label className="arena-tick" aria-hidden="true" onClick={tap} data-testid="haptic-tick">
      <input ref={sw} type="checkbox" tabIndex={-1} hidden />
    </label>
  );
}

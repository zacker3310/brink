import { useSyncExternalStore } from 'react';
import { mixer } from './output';
import type { LevelKey } from './mixer';

// Volume sliders for the music, effects and interface buses, kept on the device. Dropped into a
// settings list with one line; `rowClass` styles each row to match its host.

const ROWS: [LevelKey, string][] = [
  ['music', 'Music'],
  ['sfx', 'Effects'],
  ['ui', 'Interface'],
];

let snapshot = mixer.levels();
mixer.subscribe(() => {
  snapshot = mixer.levels();
});
const subscribe = (fn: () => void) => mixer.subscribe(fn);
const read = () => snapshot;

export function AudioMix({ rowClass = 'flex min-h-12 items-center gap-3 px-4 py-2' }: { rowClass?: string }) {
  const levels = useSyncExternalStore(subscribe, read, read);
  return (
    <>
      {ROWS.map(([k, label]) => (
        <label key={k} className={rowClass}>
          <span className="w-24 shrink-0 text-[15px] font-semibold">{label}</span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={levels[k]}
            onChange={(e) => mixer.setLevel(k, Number(e.target.value))}
            className="h-11 min-w-0 flex-1 accent-white"
            aria-label={`${label} volume`}
            data-testid={`volume-${k}`}
          />
          <span className="w-12 shrink-0 text-right text-[14px] text-muted tabular-nums">{levels[k]}%</span>
        </label>
      ))}
    </>
  );
}

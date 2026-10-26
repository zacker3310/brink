// Interface glyphs: 16 px grid, square caps, 1.75 stroke. Drawn for Brink so the HUD speaks one
// visual language with the map instead of borrowing emoji.

const PATHS = {
  close: 'M4 4l8 8M12 4l-8 8',
  alert: 'M8 2.5l6 11H2zM8 6.5v3.5M8 11.8v.4',
  report: 'M3.5 2.5h6l3 3v8h-9zM9.5 2.5v3h3M5.5 8.5h5M5.5 11h5',
  build: 'M2.5 13.5l6-6M7 3.5l2-1 4.5 4.5-1 2zM6.5 4.5l5 5',
  check: 'M3 8.5l3 3 7-7',
  next: 'M5 3l5 5-5 5',
  capital: 'M8 2l1.8 3.9 4.2.5-3.1 2.9.8 4.2L8 11.4l-3.7 2.1.8-4.2L2 6.4l4.2-.5z',
  objective: 'M8 2.5v2M8 11.5v2M2.5 8h2M11.5 8h2M8 5a3 3 0 100 6 3 3 0 000-6z',
  flag: 'M3.5 14V2.5M3.5 3h8l-2 3 2 3h-8',
  attack: 'M3 13L13 3M10 3h3v3M3 3l4 4M9 9l4 4M11 13h2v-2',
  defense: 'M8 2l5 2v4c0 3-2.2 5-5 6-2.8-1-5-3-5-6V4z',
  health: 'M6.2 2.5h3.6v3.7h3.7v3.6H9.8v3.7H6.2V9.8H2.5V6.2h3.7z',
  move: 'M2.5 8h10M9 4.5L12.5 8 9 11.5',
  lock: 'M4 7.5h8v6H4zM5.5 7.5V5a2.5 2.5 0 015 0v2.5',
  dice: 'M3 3h10v10H3zM6 6h.01M10 10h.01M8 8h.01',
  replay: 'M3 8a5 5 0 105-5H5M5 3L3 5l2 2',
  play: 'M5 3l8 5-8 5z',
  pause: 'M5 3v10M11 3v10',
  up: 'M4 10l4-4 4 4',
  down: 'M4 6l4 4 4-4',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className = 'h-3.5 w-3.5', title }: { name: IconName; className?: string; title?: string }) {
  const filled = name === 'capital' || name === 'play';
  return (
    <svg viewBox="0 0 16 16" className={`inline-block shrink-0 ${className}`} aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}>
      {title && <title>{title}</title>}
      <path d={PATHS[name]} fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={filled ? 0 : 1.75} strokeLinecap="square" strokeLinejoin="miter" />
    </svg>
  );
}

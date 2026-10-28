import { useEffect, type ReactNode } from 'react';

// Shared visual language for the front end: bracketed frames, section labels, key hints.

export function Frame({ children, className = '', accent }: { children: ReactNode; className?: string; accent?: string }) {
  return (
    <div className={`frame ds-panel backdrop-blur-sm ${className}`} style={accent ? { ['--accent' as string]: accent } : undefined}>
      <span className="frame-tick tl" aria-hidden />
      <span className="frame-tick tr" aria-hidden />
      <span className="frame-tick bl" aria-hidden />
      <span className="frame-tick br" aria-hidden />
      {children}
    </div>
  );
}

export function Label({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <h3 className={`ds-label ${className}`}>{children}</h3>;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-[3px] border border-line bg-ink-800 px-1.5 py-px font-mono text-[10px] text-muted">{children}</kbd>;
}

/** The Brink mark: a hexagon with the frontline cut through it. */
export function Mark({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden>
      <path d="M12 2.5l8.2 4.75v9.5L12 21.5l-8.2-4.75v-9.5z" fill="currentColor" />
      <path d="M5.5 14.5l4-3 3 2.2 6-5.2" stroke="#000" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** A console top bar: the mark, a breadcrumb back to the title, and room on the right. */
export function ScreenHeader({ title, kicker, onBack, right }: { title: string; kicker: string; onBack: () => void; right?: ReactNode }) {
  return (
    <header className="safe-x sticky top-0 z-20 border-b border-line bg-black/80 backdrop-blur-md">
      <div className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 sm:px-6">
        <button type="button" onClick={onBack} className="group flex h-10 items-center gap-2 rounded-md text-sm text-text" data-testid="menu-back" aria-label="Back to the title">
          <Mark />
          <span className="font-semibold tracking-tight">Brink</span>
        </button>
        <span className="text-ink-600" aria-hidden>
          /
        </span>
        <span className="text-sm text-muted">{kicker}</span>
        <span className="text-ink-600" aria-hidden>
          /
        </span>
        <h1 className="text-sm font-medium text-text">{title}</h1>
        <span className="ml-1 hidden sm:inline">
          <Kbd>Esc</Kbd>
        </span>
        <div className="ml-auto">{right}</div>
      </div>
    </header>
  );
}

/** Keyboard handler that ignores keys typed into form fields. */
export function useKeys(handler: (e: KeyboardEvent) => void, deps: readonly unknown[]) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) && e.key !== 'Escape') return;
      handler(e);
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, deps);
}

export function relativeTime(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

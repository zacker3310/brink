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

export function ScreenHeader({ title, kicker, onBack, right }: { title: string; kicker: string; onBack: () => void; right?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-center gap-4 border-b border-line bg-ink-950/80 px-4 py-3 backdrop-blur sm:px-6">
      <button type="button" onClick={onBack} className="group flex items-center gap-2 text-xs text-muted hover:text-text" data-testid="menu-back">
        <span className="transition-transform group-hover:-translate-x-0.5" aria-hidden>
          ←
        </span>
        Command <Kbd>Esc</Kbd>
      </button>
      <div className="h-6 w-px bg-line" aria-hidden />
      <div className="leading-tight">
        <div className="font-display text-[10px] font-semibold tracking-[0.1em] text-signal uppercase">{kicker}</div>
        <h1 className="text-lg font-bold tracking-tight">{title}</h1>
      </div>
      <div className="ml-auto">{right}</div>
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

import type { ReactNode } from 'react';
import type { Stockpile } from '@brink/contracts';

export function Panel({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="border-b border-line px-3 py-3">
      <header className="mb-2 flex items-center justify-between">
        <h2 className="text-[11px] font-semibold tracking-[0.14em] text-muted uppercase">{title}</h2>
        {actions}
      </header>
      {children}
    </section>
  );
}

export function Button({
  children,
  onClick,
  active,
  disabled,
  tone = 'default',
  testId,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  tone?: 'default' | 'primary' | 'danger';
  testId?: string;
  title?: string;
}) {
  const base = 'rounded-sm border px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40';
  const tones = {
    default: active ? 'border-signal bg-signal/15 text-signal' : 'border-line bg-ink-800 text-text hover:border-faint hover:bg-ink-700',
    primary: 'border-signal bg-signal text-ink-950 hover:bg-signal/90',
    danger: 'border-hostile/60 bg-hostile/10 text-hostile hover:bg-hostile/20',
  };
  return (
    <button type="button" className={`${base} ${tones[tone]}`} onClick={onClick} disabled={disabled} data-testid={testId} title={title} aria-pressed={active}>
      {children}
    </button>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-0.5 text-xs">
      <span className="text-muted">{label}</span>
      <span className="font-mono text-text tabular-nums">
        {value}
        {sub !== undefined && <span className="ml-1 text-faint">{sub}</span>}
      </span>
    </div>
  );
}

export function Meter({ value, max = 100, tone = 'neutral' }: { value: number; max?: number; tone?: 'neutral' | 'good' | 'bad' }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const color = tone === 'good' ? 'bg-friendly' : tone === 'bad' ? 'bg-hostile' : 'bg-signal';
  return (
    <div className="h-1.5 w-full rounded-full bg-ink-700" role="meter" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}>
      <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Swatch({ color }: { color: string }) {
  return <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ background: color }} aria-hidden />;
}

export function costText(c: Stockpile): string {
  const parts: string[] = [];
  if (c.credits) parts.push(`${c.credits} cr`);
  if (c.materials) parts.push(`${c.materials} mat`);
  if (c.energy) parts.push(`${c.energy} en`);
  if (c.food) parts.push(`${c.food} food`);
  return parts.join(' · ');
}

export function signed(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

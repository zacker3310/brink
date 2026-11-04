import type { ReactNode } from 'react';
import { sideValue, startValue, typeOf, type Battle, type SupportId, type TypeId } from '@brink/arena';
import { UnitGlyph } from '../glyphs';
import { classOf } from './units';
import './mission-card.css';

// The battle as a tabletop scenario: a mission card before it (the ground, the objective, the
// counters each side brings, the fire-support chits on call and what earns each star) and an
// after-action card after it in the same frame, the stars you earned against the same three rules.
// Presentation only: every number comes from the battle or its setup.

/** The card frame: hairline, a printed rule inset, amber registration corners. */
export function Card({ children, className = '', testid }: { children: ReactNode; className?: string; testid?: string }) {
  return (
    <section className={`mc ${className}`} data-testid={testid}>
      <span className="mc-corner" data-at="tl" aria-hidden />
      <span className="mc-corner" data-at="tr" aria-hidden />
      <span className="mc-corner" data-at="bl" aria-hidden />
      <span className="mc-corner" data-at="br" aria-hidden />
      <div className="relative px-4 py-4">{children}</div>
    </section>
  );
}

/** A section head in the card's condensed caps, ruled to the edge. */
export function Head({ children }: { children: ReactNode }) {
  return <h2 className="mc-head mt-4 mb-2">{children}</h2>;
}

/** Counters for a force: one per type, a count badge when there are several. */
export function Counters({ types, side }: { types: TypeId[]; side: 'blue' | 'red' }) {
  const n = new Map<TypeId, number>();
  for (const t of types) n.set(t, (n.get(t) ?? 0) + 1);
  return (
    <ul className="flex flex-wrap gap-x-2.5 gap-y-3 pt-1.5" aria-label={side === 'blue' ? 'Your force' : 'Their force'}>
      {[...n].map(([t, c]) => {
        const def = typeOf(t);
        return (
          <li key={t} className="mc-counter" data-side={side} aria-label={`${c} ${def.short}`}>
            <UnitGlyph unitClass={classOf(def.role)} color={side === 'blue' ? '#e8eef4' : '#ffd4cf'} className="h-5 w-7" />
            <span className="max-w-[72px] truncate text-[11px] leading-none font-semibold">{def.short}</span>
            {c > 1 && <span className="mc-count">{c}</span>}
          </li>
        );
      })}
    </ul>
  );
}

/** Each kind of off-map support as a simple emblem (24 x 24, drawn in the token's colour). */
const EMBLEM: Record<SupportId, ReactNode> = {
  // Rockets: three going up on their trails.
  himars: <path d="M6 20V9l1.5-3L9 9v11M11 20V6l1.5-3L14 6v14M16 20v-9l1.5-3 1.5 3v9" />,
  tornado: <path d="M5 20v-8l1.5-3L8 12v8M10.5 20V9L12 6l1.5 3v11M16 20v-8l1.5-3 1.5 3v8" />,
  // A ship broadside: hull, deckhouse, mast, the gun's line.
  naval_gun: <path d="M3 15h18l-2.5 4h-13zM8 15v-3h6v3M11 12V7M14 13l5-4" />,
  // A cruise missile in flight: body, wing, tail.
  cruise_missile: <path d="M3 13l14-2 4 1-4 1-14 2zM10 12.5l-2-4M10 13.5l-2 4M4 13l-1-3M4 13l-1 3" />,
  // A jet from above.
  strike_jet: <path d="M12 3l1.5 5 6.5 5v1.5l-6.5-2 .5 5 2.5 2v1l-4-1-4 1v-1l2.5-2 .5-5-6.5 2V13l6.5-5z" />,
  // A delta one-way drone from above.
  kamikaze: <path d="M12 4l8 13-8-3-8 3zM12 14v6" />,
};

/** A fire-support chit: its emblem, its name and role, its missions as pips (spent ones hollow). */
export function SupportChit({ id, name, role, missions, spent = 0, side = 'blue', testid }: { id: SupportId; name: string; role: string; missions: number; spent?: number; side?: 'blue' | 'red'; testid?: string }) {
  return (
    <li className="flex min-h-[52px] items-center gap-3 py-1.5" data-testid={testid}>
      <span className="mc-token" data-side={side} aria-hidden>
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          {EMBLEM[id]}
        </svg>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold">{name}</span>
        <span className="block text-[13px] text-muted">{role}</span>
      </span>
      <span className="flex shrink-0 items-center gap-1" data-side={side} aria-label={`${missions - spent} of ${missions} ${missions === 1 ? 'mission' : 'missions'} left`}>
        {Array.from({ length: missions }, (_, i) => (
          <span key={i} className="mc-pip" data-spent={i >= missions - spent} />
        ))}
      </span>
    </li>
  );
}

export function StarIcon({ earned, className = 'mc-star' }: { earned: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} data-earned={earned} aria-hidden>
      <path d="M12 2l3 6.6 7.2.8-5.4 4.9 1.5 7.1L12 17.8 5.7 21.4l1.5-7.1L1.8 9.4 9 8.6z" fill={earned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={earned ? 0 : 1.6} strokeLinejoin="round" />
    </svg>
  );
}

/** The three rules a battle's stars are earned by (the engine's `arenaResult`), in words. */
export const STAR_RULES = ['Win the battle', 'Lose under a tenth of your force', 'Win by round 9, or lose under a fifth'] as const;

/** Which of the three stars a finished battle earned, rule by rule (as `arenaResult` counts them). */
export function starsEarned(b: Battle): [boolean, boolean, boolean] {
  const won = b.ended === 'won';
  const lost = 1 - sideValue(b, 'blue') / Math.max(1, startValue(b, 'blue'));
  return [won, won && lost < 0.1, won && (b.round <= 9 || lost < 0.2)];
}

/** The star rules as a list, each marked earned or not (all hollow before the battle). */
export function StarRules({ earned }: { earned?: readonly boolean[] }) {
  return (
    <ul className="space-y-1.5" data-testid="mission-stars">
      {STAR_RULES.map((r, i) => {
        const got = !!earned?.[i];
        return (
          <li key={r} className="flex min-h-[24px] items-center gap-2.5 text-[14px]" aria-label={earned ? `${r}: ${got ? 'earned' : 'not earned'}` : r}>
            <StarIcon earned={got} />
            <span className={earned && !got ? 'text-muted' : ''}>{r}</span>
          </li>
        );
      })}
    </ul>
  );
}

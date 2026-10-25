import type { GovernmentId, UnitClass } from '@brink/contracts';

// Small SVG marks shared by the menus and the game screen.

/** A NATO-style unit frame with a class symbol, drawn small. */
export function UnitGlyph({ unitClass, color, className = 'h-3.5 w-5' }: { unitClass: UnitClass; color: string; className?: string }) {
  return (
    <svg viewBox="0 0 20 14" className={`${className} shrink-0`} aria-hidden>
      <rect x="0.75" y="0.75" width="18.5" height="12.5" fill="none" stroke={color} strokeWidth="1.5" />
      {unitClass === 'infantry' && <path d="M1 1 L19 13 M19 1 L1 13" stroke={color} strokeWidth="1.2" />}
      {unitClass === 'mechanized' && (
        <>
          <path d="M1 1 L19 13 M19 1 L1 13" stroke={color} strokeWidth="1.2" />
          <ellipse cx="10" cy="7" rx="6" ry="3.2" fill="none" stroke={color} strokeWidth="1.2" />
        </>
      )}
      {unitClass === 'armor' && <ellipse cx="10" cy="7" rx="6.5" ry="3.4" fill="none" stroke={color} strokeWidth="1.4" />}
      {unitClass === 'artillery' && <circle cx="10" cy="7" r="2.2" fill={color} />}
      {unitClass === 'recon' && <path d="M1 13 L19 1" stroke={color} strokeWidth="1.2" />}
      {unitClass === 'air' && <path d="M3 8 Q6.5 3 10 8 Q13.5 3 17 8" fill="none" stroke={color} strokeWidth="1.3" />}
    </svg>
  );
}

/** A simple heraldic mark per government, so the roster reads at a glance. */
export function Emblem({ color, government, className = 'h-8 w-8' }: { color: string; government: GovernmentId; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`${className} shrink-0`} aria-hidden>
      <path d="M12 1.5 L21.5 6 V13 C21.5 18 17 21.5 12 22.5 C7 21.5 2.5 18 2.5 13 V6 Z" fill="#0b111b" stroke={color} strokeWidth="1.4" />
      {government === 'commonwealth' && <path d="M7 15 L12 7 L17 15 Z M9.5 15 V17.5 H14.5 V15" fill="none" stroke={color} strokeWidth="1.3" />}
      {government === 'directorate' && <path d="M12 6 L13.6 10.4 L18 10.6 L14.5 13.3 L15.8 17.6 L12 15 L8.2 17.6 L9.5 13.3 L6 10.6 L10.4 10.4 Z" fill={color} />}
      {government === 'federation' && (
        <>
          <circle cx="12" cy="12" r="4.5" fill="none" stroke={color} strokeWidth="1.3" />
          <path d="M12 5.5 V18.5 M5.5 12 H18.5" stroke={color} strokeWidth="1.1" />
        </>
      )}
      {government === 'union' && <path d="M12 6 V18 M8 9 Q12 12 16 9 M8 13 Q12 16 16 13" fill="none" stroke={color} strokeWidth="1.4" />}
    </svg>
  );
}

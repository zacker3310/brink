import type { GovernmentId, UnitClass } from '@brink/contracts';
import { unitImage } from './art';
import { symbolSvg, type Affiliation } from './design/symbols';

// Small SVG marks shared by the menus and the game screen.

/** The top-down render of a unit class, as the map draws it. */
export function ModelPortrait({ unitClass, className = 'h-10 w-10' }: { unitClass: UnitClass; color?: string; className?: string }) {
  return <img src={unitImage(unitClass)} alt="" draggable={false} className={`shrink-0 object-contain ${className}`} />;
}

/** A unit's APP-6 symbol, inline. Affiliation defaults to friend (the viewer's own). */
export function UnitGlyph({
  unitClass,
  color,
  className = 'h-3.5 w-5',
  affiliation = 'friend',
  planned = false,
}: {
  unitClass: UnitClass;
  color: string;
  className?: string;
  affiliation?: Affiliation;
  planned?: boolean;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center [&>svg]:h-full [&>svg]:w-full ${className}`}
      aria-hidden
      dangerouslySetInnerHTML={{ __html: symbolSvg({ cls: unitClass, aff: affiliation, fill: color, planned, size: 30, echelon: false }) }}
    />
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

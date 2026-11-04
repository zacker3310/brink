import type { GovernmentId } from '@brink/contracts';

// The commander you serve under, on the campaign briefing: a portrait placeholder (a silhouette
// in the nation's light, until painted portraits exist), a name, a post and one line of voice.
// Every leader is fictional.

interface Leader {
  name: string;
  post: string;
  line: string;
  /** Headgear on the silhouette. */
  hat: 'peaked' | 'beret' | 'bare';
}

const LEADERS: Record<GovernmentId, Leader> = {
  commonwealth: { name: 'Adm. Grace Halloran', post: 'Theatre commander, Pacific', line: 'Money is ammunition. We spend it before they do.', hat: 'bare' },
  directorate: { name: 'Gen. Arkady Volkov', post: 'Chief of the General Staff', line: 'Strike first. Explain afterwards.', hat: 'peaked' },
  union: { name: 'Marshal Wei Lan', post: 'Eastern Theatre Command', line: 'Let every hex they take cost them a city.', hat: 'peaked' },
  federation: { name: 'Gen. Kenji Arata', post: 'Chief of Staff, Joint Staff', line: 'We see them first, and we hit them from further away.', hat: 'beret' },
};

function Portrait({ hat }: { hat: Leader['hat'] }) {
  return (
    <svg viewBox="0 0 64 76" className="absolute inset-0 h-full w-full" aria-hidden>
      <defs>
        <linearGradient id="leader-rim" x1="0" x2="1">
          <stop offset="0" style={{ stopColor: 'var(--nation)' }} stopOpacity="0.9" />
          <stop offset="0.5" stopColor="#0b0f12" stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* Shoulders and collar. */}
      <path d="M4 76c1-14 9-21 20-23l8 7 8-7c11 2 19 9 20 23z" fill="#0b0f12" />
      <path d="M24 53l8 7 8-7 2 4-10 9-10-9z" fill="#1b232a" />
      <path d="M4 76c1-14 9-21 20-23l2 3c-9 3-15 9-16 20z" fill="url(#leader-rim)" opacity="0.8" />
      {/* Head and neck. */}
      <path d="M27 45h10v9l-5 4-5-4z" fill="#0d1216" />
      <ellipse cx="32" cy="33" rx="11" ry="13.5" fill="#10161a" />
      <path d="M21.5 31c0-8 4.5-13.5 10.5-13.5" style={{ stroke: 'var(--nation)' }} strokeOpacity="0.7" strokeWidth="1.4" fill="none" />
      {hat === 'peaked' && (
        <g>
          <path d="M18 24c2-8 9-11 14-11s12 3 14 11z" fill="#0b0f12" />
          <path d="M17 24h30l-3 4H20z" fill="#151c21" />
          <circle cx="32" cy="19" r="2" style={{ fill: 'var(--nation)' }} />
        </g>
      )}
      {hat === 'beret' && <path d="M20 25c0-7 7-11 14-10 8 1 12 5 11 9-6-2-17-1-25 1z" fill="#0b0f12" />}
      {/* Rank on the shoulders. */}
      <rect x="10" y="62" width="9" height="2" rx="1" style={{ fill: 'var(--nation)' }} opacity="0.8" />
      <rect x="45" y="62" width="9" height="2" rx="1" style={{ fill: 'var(--nation)' }} opacity="0.8" />
    </svg>
  );
}

export function LeaderCard({ government }: { government: GovernmentId }) {
  const l = LEADERS[government];
  return (
    <div className="leader" data-testid="leader">
      <div className="leader-portrait">
        <Portrait hat={l.hat} />
      </div>
      <div className="min-w-0">
        <div className="leader-name" data-testid="leader-name">
          {l.name}
        </div>
        <div className="leader-role">{l.post}</div>
        <p className="leader-quote">“{l.line}”</p>
      </div>
    </div>
  );
}

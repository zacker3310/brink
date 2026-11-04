import { useState } from 'react';
import type { CardId, CardPlay, NationView } from '@brink/contracts';
import { CARDS, DOCTRINE, describeCard, type CardDef } from '@brink/game-data';
import { cpIncome } from '@brink/simulation';
import { hexLabel } from './insight';
import { useGame } from './store';

// Doctrine cards as a tabletop hand: fanned at the bottom edge, each with its cost in pips, its name,
// a line of flavour and what it does in plain words. A card that needs a target is armed by tapping
// it, and the next hex tap aims it. Cards played this turn wear a stamp until the turn resolves.

const TARGET_HINT: Record<CardDef['target'], string> = {
  none: 'No target',
  'own-hex': 'Your ground',
  'enemy-hex': 'Enemy ground',
  hex: 'Any hex',
  nation: 'A rival power',
};

/** Cost as pips, filled up to what you can pay. */
function Pips({ cost, cp }: { cost: number; cp: number }) {
  return (
    <span className="flex gap-0.5" aria-label={`Costs ${cost} Command Points`}>
      {Array.from({ length: cost }, (_, i) => (
        <span key={i} className={`h-2 w-2 rounded-full border ${cost <= cp ? 'border-signal bg-signal' : 'border-hostile/80 bg-transparent'}`} />
      ))}
    </span>
  );
}

export function CardFace({ def, cp, played, armed, compact }: { def: CardDef; cp: number; played?: CardPlay; armed?: boolean; compact?: boolean }) {
  const view = useGame((s) => s.view);
  const affordable = def.cost <= cp || !!played;
  return (
    <div
      className={`relative flex h-full w-full flex-col overflow-hidden rounded-xl border-2 bg-gradient-to-b from-ink-800 to-ink-900 p-2 text-left shadow-[0_6px_18px_rgba(0,0,0,0.5)] ${
        armed ? 'border-friend ring-2 ring-friend/60' : played ? 'border-good/70' : affordable ? 'border-signal/70' : 'border-line opacity-70'
      }`}
    >
      <div className="flex items-center justify-between">
        <Pips cost={def.cost} cp={cp} />
        <span className="font-mono text-[9px] tracking-wide text-faint uppercase">{TARGET_HINT[def.target]}</span>
      </div>
      <div className={`font-display mt-1 leading-[1.05] font-extrabold uppercase ${compact ? 'text-[13px]' : 'text-[15px]'}`}>{def.name}</div>
      <div className="mt-0.5 text-[10px] leading-snug text-faint italic">{def.flavour}</div>
      <div className={`mt-auto pt-1 leading-[1.3] text-text ${compact ? 'text-[10.5px]' : 'text-[11.5px]'}`}>{describeCard(def)}</div>
      {played && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center" data-testid={`stamp-${def.id}`}>
          <span className="font-display -rotate-[14deg] rounded-md border-[3px] border-good bg-ink-950/80 px-2 py-0.5 text-center text-[15px] leading-tight font-black tracking-[0.08em] text-good uppercase shadow-lg">
            Played
            {view && (played.target || played.nation) && <span className="block text-[9px] tracking-normal normal-case">{played.target ? hexLabel(view, played.target) : view.nations[played.nation!]?.name}</span>}
          </span>
        </div>
      )}
    </div>
  );
}

/** The hand with the turn's plays: each card once per copy, a play matched to its copy. */
function handSlots(view: NationView, plays: readonly CardPlay[]): { id: CardId; key: string; play?: CardPlay; index?: number }[] {
  const left = plays.map((p, i) => ({ p, i }));
  return (view.self.doctrine?.hand ?? []).map((id, n) => {
    const at = left.findIndex((x) => x.p.card === id);
    const hit = at >= 0 ? left.splice(at, 1)[0] : undefined;
    return { id, key: `${id}-${n}`, ...(hit ? { play: hit.p, index: hit.i } : {}) };
  });
}

/** Command Points left after this turn's plays. */
export function cpLeft(view: NationView, plays: readonly CardPlay[] = []): number {
  return (view.self.doctrine?.cp ?? 0) - plays.reduce((a, p) => a + (CARDS[p.card]?.cost ?? 0), 0);
}

/** The fan itself. `width` is the card width in px; cards overlap and lean like a hand of cards. */
function Fan({ width, onPicked, spread = 0.78 }: { width: number; onPicked?: () => void; spread?: number }) {
  const view = useGame((s) => s.view)!;
  const draft = useGame((s) => s.draft);
  const aiming = useGame((s) => s.aimingCard);
  const playCard = useGame((s) => s.playCard);
  const unplayCard = useGame((s) => s.unplayCard);
  const resolving = useGame((s) => s.resolving);
  const [open, setOpen] = useState<string | null>(null);
  const plays = draft?.play ?? [];
  const cp = cpLeft(view, plays);
  const slots = handSlots(view, plays);
  const n = slots.length;
  const rivals = Object.values(view.nations).filter((x) => x.id !== view.self.id && !x.minor && !x.eliminated);
  if (n === 0) return <p className="px-4 py-6 text-center text-[13px] text-muted">No cards in hand. You draw back to {DOCTRINE.handSize} at the end of the turn.</p>;
  const height = Math.round(width * 1.55);
  return (
    <div className="relative mx-auto" style={{ width: width + (n - 1) * width * spread, height: height + 18 }} data-testid="hand-fan">
      {slots.map((s, i) => {
        const def = CARDS[s.id];
        if (!def) return null;
        const mid = (n - 1) / 2;
        const tilt = (i - mid) * 6;
        const lifted = open === s.key || aiming === s.id;
        return (
          <div
            key={s.key}
            className="absolute bottom-0 origin-bottom transition-transform duration-[240ms] ease-[cubic-bezier(0.2,0.7,0.2,1)]"
            style={{ left: i * width * spread, width, height, transform: `rotate(${lifted ? 0 : tilt}deg) translateY(${lifted ? -14 : Math.abs(i - mid) * 5}px)`, zIndex: lifted ? 10 : i }}
          >
            <button
              type="button"
              className="h-full w-full"
              onClick={() => setOpen(open === s.key ? null : s.key)}
              aria-label={`${def.name}, ${def.cost} Command Points${s.play ? ', played' : ''}`}
              data-testid={`card-${s.id}`}
            >
              <CardFace def={def} cp={s.play ? def.cost : cp} played={s.play} armed={aiming === s.id} compact={width < 130} />
            </button>
            {open === s.key && !resolving && (
              <div className="absolute inset-x-1 -bottom-1 flex flex-col gap-1">
                {s.play ? (
                  <button type="button" className="h-9 rounded-lg border border-line bg-ink-950/95 text-[12px] font-semibold text-muted" onClick={() => unplayCard(s.index!)} data-testid="unplay-card">
                    Take back
                  </button>
                ) : def.target === 'nation' ? (
                  rivals.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      className="h-8 rounded-lg bg-signal text-[12px] font-extrabold text-ink-950 uppercase disabled:opacity-40"
                      disabled={def.cost > cp}
                      onClick={() => {
                        playCard(s.id, r.id);
                        setOpen(null);
                      }}
                    >
                      {r.name}
                    </button>
                  ))
                ) : (
                  <button
                    type="button"
                    className="font-display h-9 rounded-lg bg-signal text-[14px] font-extrabold tracking-wide text-ink-950 uppercase disabled:bg-ink-700 disabled:text-faint"
                    disabled={def.cost > cp}
                    onClick={() => {
                      playCard(s.id);
                      setOpen(null);
                      if (def.target !== 'none') onPicked?.();
                    }}
                    data-testid="play-card"
                  >
                    {def.cost > cp ? `Needs ${def.cost} CP` : def.target === 'none' ? 'Play' : 'Aim'}
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** While a card waits for its target: what it is, and a way out. */
export function AimBanner() {
  const aiming = useGame((s) => s.aimingCard);
  const cancel = useGame((s) => s.cancelAim);
  const def = aiming ? CARDS[aiming] : undefined;
  if (!def) return null;
  return (
    <div className="pointer-events-auto mx-3 mb-2 flex items-center gap-3 rounded-xl border-2 border-friend bg-ink-900/95 px-3 py-2 shadow-lg" data-testid="aim-banner">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-friend text-friend" aria-hidden>
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="7" />
          <path d="M12 2v5M12 17v5M2 12h5M17 12h5" strokeLinecap="round" />
        </svg>
      </span>
      <p className="min-w-0 flex-1 text-[13px] leading-snug">
        <b className="font-display tracking-wide uppercase">{def.name}</b>: tap {TARGET_HINT[def.target].toLowerCase()} on the map.
      </p>
      <button type="button" onClick={cancel} className="h-10 shrink-0 rounded-lg border border-line px-3 text-[13px] font-semibold" data-testid="aim-cancel">
        Cancel
      </button>
    </div>
  );
}

/** The chip that stands for the hand on a phone: "Hand 3 · CP 5". */
export function HandChip({ onOpen }: { onOpen: () => void }) {
  const view = useGame((s) => s.view)!;
  const plays = useGame((s) => s.draft?.play) ?? [];
  const d = view.self.doctrine;
  if (!d) return null;
  return (
    <button type="button" onClick={onOpen} className="flex shrink-0 items-center gap-1.5 rounded-full border border-signal/60 bg-ink-900/90 py-1.5 pr-3 pl-2 text-[13px] active:bg-ink-800" data-testid="hand-chip">
      <span className="relative h-4 w-5" aria-hidden>
        <span className="absolute left-0 top-0 h-4 w-3 -rotate-12 rounded-[3px] border border-signal bg-ink-800" />
        <span className="absolute left-2 top-0 h-4 w-3 rotate-12 rounded-[3px] border border-signal bg-ink-700" />
      </span>
      <span className="font-semibold">Hand {d.hand.length - plays.length}</span>
      <span className="text-faint">·</span>
      <span className="font-semibold text-signal tabular-nums">CP {cpLeft(view, plays)}</span>
      {plays.length > 0 && <span className="ml-0.5 rounded-full bg-good px-1.5 text-[11px] font-bold text-ink-950">{plays.length} played</span>}
    </button>
  );
}

/** Command Points, their income, and the turn's limit, in one line. */
function CpLine() {
  const view = useGame((s) => s.view)!;
  const plays = useGame((s) => s.draft?.play) ?? [];
  const d = view.self.doctrine!;
  const rivals = Object.values(view.nations).filter((x) => x.id !== view.self.id && !x.minor && !x.eliminated && x.doctrine);
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-[12px] text-muted">
      <span>
        <b className="text-signal tabular-nums">{cpLeft(view, plays)}</b> of {d.cp} Command Points left · +{cpIncome(view, view.self.id)} a turn · up to {DOCTRINE.maxPlays} cards a turn · {d.deck.length} in the deck
      </span>
      <span className="text-faint">
        {rivals.map((r) => `${r.name.split(' ').at(-1)} ${r.doctrine!.hand} cards, ${r.doctrine!.cp} CP`).join(' · ')}
      </span>
    </div>
  );
}

/** Phone: the hand as a sheet rising from the bottom edge. */
export function PhoneHand({ onClose }: { onClose: () => void }) {
  const view = useGame((s) => s.view)!;
  if (!view.self.doctrine) return null;
  return (
    <div className="fixed inset-0 z-30 flex flex-col justify-end bg-ink-950/55" onClick={onClose} data-testid="hand">
      <div className="sheet-in safe-bottom safe-x rounded-t-2xl border-t border-signal/50 bg-ink-950/95" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 pt-2 pb-3">
        <div className="flex items-center justify-between">
          <span className="font-display text-sm font-black tracking-[0.08em] text-signal uppercase">Doctrine</span>
          <button type="button" onClick={onClose} className="h-9 px-2 text-[13px] text-faint" data-testid="hand-close">
            Close
          </button>
        </div>
        <CpLine />
        <div className="mt-3 overflow-x-auto overflow-y-visible px-3 pt-4 pb-12">
          <Fan width={Math.min(140, Math.floor((Math.min(window.innerWidth, 480) - 76) / 2.56))} onPicked={onClose} />
        </div>
        </div>
      </div>
    </div>
  );
}

/** Desktop: the hand peeking up from the bottom edge of the map; it rises on hover. */
export function DesktopHand() {
  const view = useGame((s) => s.view);
  const playback = useGame((s) => s.playback);
  const plays = useGame((s) => s.draft?.play);
  const [up, setUp] = useState(false);
  if (!view?.self.doctrine || playback || view.victory) return null;
  return (
    // Folded down, only the tab takes the mouse: the peeking cards never steal a click from the
    // unit panel or the map under them. Hovering or clicking the tab raises the hand.
    <div
      className={`absolute bottom-0 left-1/2 z-20 -translate-x-1/2 transition-transform duration-[240ms] ease-[cubic-bezier(0.2,0.7,0.2,1)] ${up ? 'pointer-events-auto translate-y-0' : 'pointer-events-none translate-y-[78%]'}`}
      onMouseLeave={() => setUp(false)}
      data-testid="hand"
    >
      <div className="mb-1 flex justify-center">
        <button
          type="button"
          className="pointer-events-auto rounded-full border border-signal/60 bg-ink-950/90 px-3 py-0.5 text-[11px] font-semibold text-muted hover:text-text"
          onMouseEnter={() => setUp(true)}
          onClick={() => setUp(!up)}
          aria-expanded={up}
          data-testid="hand-tab"
        >
          Doctrine · <span className="text-signal">CP {cpLeft(view, plays)}</span>
        </button>
      </div>
      <div className="pb-14">
        <Fan width={150} spread={0.96} />
      </div>
    </div>
  );
}

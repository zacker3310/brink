import { NATIONS } from '@brink/scenarios';
import { Chat } from './Chat';
import { Emblem } from './glyphs';
import { useNet } from './net/room';
import { useGame } from './store';

// In-game multiplayer chrome: the hotseat curtain, the room chip, the seat status board and comms.

export function Curtain() {
  const curtain = useNet((s) => s.curtain);
  const busy = useNet((s) => s.busy);
  const reveal = useNet((s) => s.reveal);
  if (!curtain) return null;
  const spec = NATIONS.find((n) => n.id === curtain)!;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950" data-testid="curtain" role="dialog" aria-modal="true" aria-label={`Pass to ${spec.name}`}>
      <div className="absolute inset-x-0 top-0 h-2 ds-hazard" aria-hidden />
      <div className="absolute inset-x-0 bottom-0 h-2 ds-hazard" aria-hidden />
      <div className="screen-in flex flex-col items-center text-center">
        <div className="ds-label">Hotseat · eyes only</div>
        <Emblem color={spec.color} government={spec.government} className="mt-6 h-24 w-24" />
        <div className="mt-4 font-display text-xl tracking-[0.3em] text-muted uppercase">Pass to</div>
        <div className="font-display text-6xl font-extrabold tracking-wide uppercase" style={{ color: spec.color }}>
          {spec.name}
        </div>
        <p className="mt-3 max-w-sm text-sm text-muted">Everyone else, look away. Your orders stay secret until the world moves.</p>
        <button
          type="button"
          disabled={busy}
          onClick={reveal}
          data-testid="reveal"
          className="mt-8 border-2 px-8 py-3 font-display text-xl font-bold tracking-wider uppercase transition-all hover:brightness-125 disabled:opacity-50"
          style={{ borderColor: spec.color, color: spec.color }}
        >
          {busy ? 'Resolving…' : `I'm ${spec.name.split(' ')[0]}: show my front`}
        </button>
      </div>
    </div>
  );
}

/** Room chip and comms toggle for the top bar. */
export function RoomChip({ onChat }: { onChat: () => void }) {
  const role = useNet((s) => s.role);
  const code = useNet((s) => s.code);
  const unread = useNet((s) => s.unread);
  if (!role) return null;
  return (
    <div className="flex items-center gap-2">
      <span className="border border-friend/50 bg-friend/10 px-2 py-1 whitespace-nowrap font-display text-[11px] font-bold tracking-[0.18em] text-friend uppercase" data-testid="room-chip">
        {role === 'hotseat' ? 'Hotseat' : `Online · ${code}`}
      </span>
      {role !== 'hotseat' && (
        <button type="button" onClick={onChat} className="relative border border-line px-2.5 py-1.5 text-xs whitespace-nowrap hover:border-faint" title="Comms (T)" data-testid="open-chat">
          Comms
          {unread > 0 && <span className="absolute -top-1.5 -right-1.5 rounded-full bg-hostile px-1.5 text-[10px] font-bold text-ink-950">{unread}</span>}
        </button>
      )}
    </div>
  );
}

export function ChatOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div className="panel-in absolute top-14 left-1/2 z-30 w-[380px] -translate-x-1/2">
      <Chat className="h-80" autoFocus onClose={onClose} />
    </div>
  );
}

/** Who is still planning this turn. Shown above Next Turn in online rooms. */
export function SeatBoard() {
  const role = useNet((s) => s.role);
  const seats = useNet((s) => s.seats);
  const locked = useNet((s) => s.locked);
  const me = useNet((s) => s.me);
  const forceResolve = useNet((s) => s.forceResolve);
  const resolving = useGame((s) => s.resolving);
  const playback = useGame((s) => s.playback);
  if (role !== 'host' && role !== 'guest') return null;
  const humans = seats.filter((s) => s.player !== null);
  const waiting = humans.filter((s) => !locked.includes(s.nation));
  return (
    <div className="ds-panel px-2.5 py-2 text-[11px]" data-testid="seat-board">
      <div className="mb-1 flex justify-between">
        <span className="ds-label">Commanders</span>
        <span className="font-mono text-faint">
          {humans.length - waiting.length}/{humans.length} locked
        </span>
      </div>
      <ul className="space-y-0.5">
        {humans.map((s) => {
          const spec = NATIONS.find((n) => n.id === s.nation)!;
          const done = locked.includes(s.nation);
          return (
            <li key={s.nation} className="flex items-center gap-1.5">
              <Emblem color={spec.color} government={spec.government} className="h-3.5 w-3.5" />
              <span className={s.player === me || (role === 'host' && s.host) ? 'font-semibold' : ''}>{s.player}</span>
              <span className={`ml-auto font-display text-[10px] font-bold tracking-wider uppercase ${!s.connected ? 'text-hostile' : done ? 'text-good' : 'text-signal'}`}>
                {!s.connected ? 'offline' : done ? '✓ locked' : 'planning'}
              </span>
            </li>
          );
        })}
      </ul>
      {role === 'host' && resolving && !playback && waiting.length > 0 && (
        <button type="button" onClick={forceResolve} className="mt-1.5 w-full border border-hostile/50 py-1 text-[11px] text-hostile hover:bg-hostile/10" data-testid="force-resolve">
          Resolve now · {waiting.length} will hold
        </button>
      )}
    </div>
  );
}

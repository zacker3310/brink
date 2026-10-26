import { useEffect, useState } from 'react';
import type { FormationOrder, SupplyPriority } from '@brink/contracts';
import { EVENTS, UNITS } from '@brink/game-data';
import { movementAllowance, type AssaultPreview, type StrikePreview } from '@brink/simulation';
import { engine } from './engine';
import { UnitGlyph } from './glyphs';
import { describeEffect, hexLabel, idleFormations } from './insight';
import { Minimap } from './MapOverlays';
import { useNet } from './net/room';
import { describeOrder, type Mode } from './planning';
import { SeatBoard } from './RoomUi';
import { healthColor } from './design/tokens';
import { useGame } from './store';

// Civ-style unit panel (bottom-left) and turn controls (bottom-right), floating over the map.

function usePreview(order: FormationOrder | undefined, fid: string | null) {
  const [preview, setPreview] = useState<{ assault?: AssaultPreview | null; strike?: StrikePreview | null } | null>(null);
  useEffect(() => {
    let live = true;
    setPreview(null);
    if (!fid || order?.type !== 'attack') return;
    const view = useGame.getState().view!;
    const ranged = UNITS[view.formations[fid]!.unitClass].range > 0;
    void engine.call(ranged ? { type: 'previewStrike', source: fid, target: order.target } : { type: 'previewAssault', attackers: [fid], target: order.target }).then((r) => {
      if (!live) return;
      if (r.type === 'assault') setPreview({ assault: r.preview });
      if (r.type === 'strike') setPreview({ strike: r.preview });
    });
    return () => {
      live = false;
    };
  }, [order, fid]);
  return preview;
}

const ICONS: Record<string, string> = {
  move: 'M5 12h12 M13 7l5 5-5 5',
  attack: 'M5 19L19 5 M14 5h5v5 M5 14l5 5 M4 20l2-2',
  recon: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  withdraw: 'M19 12H7 M11 7l-5 5 5 5',
  hold: 'M8 5v14 M16 5v14',
  defend: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  clear: 'M6 6l12 12 M18 6L6 18',
};

function Action({
  icon,
  label,
  hotkey,
  onClick,
  active,
  disabled,
  testId,
  danger,
}: {
  icon: string;
  label: string;
  hotkey: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  testId: string;
  danger?: boolean;
}) {
  const on = danger ? 'border-hostile bg-hostile/25 text-hostile' : 'border-friend bg-friend/20 text-friend';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      aria-pressed={active}
      aria-label={label}
      title={`${label} (${hotkey})`}
      className={`group relative flex h-10 w-10 items-center justify-center rounded-full border-2 transition-all disabled:cursor-not-allowed disabled:opacity-30 ${
        active ? on : 'border-line bg-ink-850 text-text/85 hover:-translate-y-0.5 hover:border-faint hover:bg-ink-800'
      }`}
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d={ICONS[icon]} />
      </svg>
      <span className="absolute -top-1 -right-1 rounded-full bg-ink-950 px-1 font-mono text-[8px] text-faint">{hotkey}</span>
      <span className="pointer-events-none absolute bottom-full mb-2 hidden border border-line bg-ink-950 px-2 py-1 text-[11px] whitespace-nowrap text-text group-hover:block">{label}</span>
    </button>
  );
}

const OUTCOME: Record<string, { text: string; tone: string }> = {
  attacker_victory: { text: 'Breakthrough', tone: 'text-good' },
  inconclusive: { text: 'Stalemate', tone: 'text-signal' },
  defender_held: { text: 'Repulsed', tone: 'text-hostile' },
};

export function UnitPanel() {
  const view = useGame((s) => s.view)!;
  const draft = useGame((s) => s.draft)!;
  const fid = useGame((s) => s.selectedFormation);
  const mode = useGame((s) => s.mode);
  const setMode = useGame((s) => s.setMode);
  const setOrder = useGame((s) => s.setOrder);
  const issueOrder = useGame((s) => s.issueOrder);
  const setPriority = useGame((s) => s.setPriority);
  const resolving = useGame((s) => s.resolving);
  const rejected = useGame((s) => s.rejected);
  const [details, setDetails] = useState(false);
  // Sit beside an open drawer or city panel instead of under it.
  const shifted = useGame((s) => s.panelOpen || s.selectedCity !== null);
  const f = fid ? view.formations[fid] : undefined;
  const order = fid ? draft.formations[fid] : undefined;
  const preview = usePreview(order, fid);
  if (!f) return null;
  const def = UNITS[f.unitClass];
  const color = view.self.color;
  const mp = movementAllowance(f);
  const hp = f.strength / 10;
  const hpColor = `#${healthColor(hp / 100).toString(16).padStart(6, '0')}`;
  const priority: SupplyPriority = draft.supplyPriority?.[f.id] ?? f.supplyPriority;
  const modes: [Mode, string, string][] = [
    ['move', def.ground ? 'Move' : 'Rebase', 'M'],
    ['attack', def.range ? 'Strike' : 'Attack', 'A'],
    ['recon', 'Recon', 'R'],
    ['withdraw', 'Withdraw', 'W'],
  ];

  return (
    <div className={`pointer-events-auto absolute bottom-3 z-10 w-[380px] transition-[left] ${shifted ? 'left-[336px]' : 'left-3'}`} data-testid="unit-panel">
      {rejected.length > 0 && (
        <ul className="mb-1.5 border border-hostile/50 bg-ink-950/95 px-3 py-1.5 text-[11px] text-hostile" data-testid="rejections">
          {rejected.slice(0, 3).map((e, i) => (
            <li key={i}>⚠ {e.kind === 'order_rejected' ? `${e.formation ? `${view.formations[e.formation]?.name ?? e.formation}: ` : ''}${e.reason}` : ''}</li>
          ))}
        </ul>
      )}
      <div className="ds-panel backdrop-blur">
        <div className="flex items-start gap-3 p-3">
          <div className="relative flex h-16 w-16 shrink-0 items-center justify-center rounded-full border-2" style={{ borderColor: color, background: `radial-gradient(circle at 35% 30%, ${color}55, #0b111b 70%)` }}>
            <UnitGlyph unitClass={f.unitClass} color="#e6e1d3" className="h-6 w-9" />
            <svg viewBox="0 0 36 36" className="absolute inset-0 -rotate-90" aria-hidden>
              <circle cx="18" cy="18" r="16.5" fill="none" stroke="#1b2738" strokeWidth="2.5" />
              <circle cx="18" cy="18" r="16.5" fill="none" stroke={hpColor} strokeWidth="2.5" strokeDasharray={`${(hp / 100) * 103.7} 103.7`} />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-display truncate text-base leading-tight font-black">{f.name}</div>
            <div className="text-[10px] font-semibold tracking-wider uppercase" style={{ color }}>
              {def.name} · {hexLabel(view, f.key)}
            </div>
            <div className="mt-1.5 flex gap-3 font-mono text-xs">
              <span title="Strength">
                <span style={{ color: hpColor }}>♥</span> {Math.round(hp)}%
              </span>
              <span title="Movement points this turn">➜ {mp || '—'} MP</span>
              <span title="Soft / hard attack">⚔ {def.softAttack}/{def.hardAttack}</span>
              <span title="Defense">⛨ {def.defense}</span>
            </div>
            <div className="mt-1 truncate text-[11px]" data-testid="planned-order">
              <span className={order ? 'font-semibold text-friend' : 'text-signal'}>{order ? describeOrder(order, view) : 'Needs orders · Hold (default)'}</span>
            </div>
          </div>
        </div>

        {preview && order?.type === 'attack' && (
          <div className="border-t border-line px-3 py-2 text-[11px]" data-testid="preview">
            {preview.assault &&
              (preview.assault.defenders === 0 ? (
                <span className="text-muted">No enemy seen there: you will try to take the hex.</span>
              ) : (
                <span>
                  Expected: you −{preview.assault.attackerLoss[0]}–{preview.assault.attackerLoss[1]}, they −{preview.assault.defenderLoss[0]}–{preview.assault.defenderLoss[1]} ·{' '}
                  {preview.assault.outcomes.map((o) => (
                    <b key={o} className={`mr-1 ${OUTCOME[o]?.tone}`}>
                      {OUTCOME[o]?.text}
                    </b>
                  ))}
                </span>
              ))}
            {preview.strike && (preview.strike.targets === 0 ? <span className="text-muted">No confirmed targets.</span> : <span>Strike: {preview.strike.targets} target(s), −{preview.strike.loss[0]}–{preview.strike.loss[1]} each</span>)}
          </div>
        )}

        <div className="flex items-center gap-1.5 border-t border-line px-3 py-2.5" role="toolbar" aria-label="Orders">
          {modes.map(([m, label, key]) => (
            <Action
              key={m}
              icon={m}
              label={label}
              hotkey={key}
              testId={`mode-${m}`}
              active={mode === m}
              danger={m === 'attack'}
              disabled={resolving || (!def.ground && (m === 'recon' || m === 'withdraw'))}
              onClick={() => setMode(m)}
            />
          ))}
          <span className="mx-0.5 h-6 w-px bg-line" aria-hidden />
          <Action icon="defend" label="Fortify (defend and dig in)" hotkey="D" testId="order-defend" active={order?.type === 'defend'} disabled={resolving || !def.ground} onClick={() => issueOrder(f.id, { type: 'defend' })} />
          <Action icon="hold" label="Hold position" hotkey="H" testId="order-hold" active={order?.type === 'hold'} disabled={resolving} onClick={() => issueOrder(f.id, { type: 'hold' })} />
          <Action icon="clear" label="Cancel order" hotkey="X" testId="order-clear" disabled={resolving || !order} onClick={() => setOrder(f.id, null)} />
          <button type="button" onClick={() => setDetails(!details)} className="ml-auto text-[10px] text-faint hover:text-text" aria-expanded={details}>
            {details ? 'less ▴' : 'more ▾'}
          </button>
        </div>
        <div className="border-t border-line/60 px-3 py-1.5 text-[10px] text-faint">
          Right-click the map to order · {def.ground ? 'blue = reachable, red = attackable' : 'click one of your cities to rebase, or a target to strike'}
        </div>

        {details && (
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 border-t border-line px-3 py-2.5 text-[10px]">
            {(
              [
                ['Organization', f.organization],
                ['Morale', f.morale],
                ['Readiness', f.readiness],
                ['Supply', f.supply],
                ['Fuel', f.fuel],
                ['Ammunition', f.ammunition],
                ['Dug in', f.entrenchment],
                ['Experience', f.experience],
              ] as const
            ).map(([l, n]) => (
              <div key={l}>
                <div className="flex justify-between">
                  <span className="text-muted">{l}</span>
                  <span className="font-mono">{n}</span>
                </div>
                <div className="h-1 bg-ink-700">
                  <div className={`h-full ${n < 35 ? 'bg-hostile' : n < 60 ? 'bg-signal' : 'bg-good'}`} style={{ width: `${Math.min(100, n)}%` }} />
                </div>
              </div>
            ))}
            <div className="col-span-2 mt-1 flex items-center gap-2">
              <span className="text-muted">Supply priority</span>
              {(['high', 'normal', 'low'] as const).map((p) => (
                <button key={p} type="button" onClick={() => setPriority(f.id, p)} aria-pressed={priority === p} className={`border px-1.5 py-px ${priority === p ? 'border-signal/70 text-signal' : 'border-line text-muted hover:text-text'}`}>
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** A world event awaiting an answer. The choice rides on the draft; no answer takes option 0. */
function EventCard() {
  const event = useGame((s) => s.view?.self.event);
  const choice = useGame((s) => s.draft?.eventChoice);
  const setEventChoice = useGame((s) => s.setEventChoice);
  const resolving = useGame((s) => s.resolving);
  if (!event) return null;
  const def = EVENTS[event.id];
  const picked = choice ?? 0;
  return (
    <div className="ds-panel border-signal/60 px-2.5 py-2" data-testid="world-event">
      <div className="ds-label text-signal">Decision</div>
      <div className="font-display text-sm font-bold tracking-wide uppercase">{def.title}</div>
      <p className="mt-0.5 text-[11px] leading-snug text-muted">{def.text}</p>
      <div className="mt-1.5 flex flex-col gap-1">
        {def.options.map((o, i) => (
          <button
            key={o.label}
            type="button"
            disabled={resolving}
            onClick={() => setEventChoice(i as 0 | 1)}
            aria-pressed={picked === i}
            data-testid={`event-option-${i}`}
            className={`border px-2 py-1 text-left text-[11px] disabled:opacity-60 ${picked === i ? 'border-signal bg-signal/15 text-text' : 'border-line text-muted hover:border-faint hover:text-text'}`}
          >
            <div className="font-semibold">
              {o.label}
              {i === 0 && choice === undefined && <span className="ml-1 text-[9px] text-faint uppercase">default</span>}
            </div>
            <div className="font-mono text-[10px] text-faint">{describeEffect(o.effect)}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

export function TurnControls() {
  const view = useGame((s) => s.view)!;
  const draft = useGame((s) => s.draft)!;
  const submit = useGame((s) => s.submit);
  const nextIdle = useGame((s) => s.nextIdle);
  const resolving = useGame((s) => s.resolving);
  const report = useGame((s) => s.report);
  const setShowReport = useGame((s) => s.setShowReport);
  const playback = useGame((s) => s.playback);
  const lastTurn = useGame((s) => s.lastTurn);
  const rewatch = useGame((s) => s.rewatch);
  const role = useNet((s) => s.role);
  const total = Object.keys(view.formations).length;
  const idle = idleFormations(view, draft.formations).length;
  const over = view.victory !== null;
  const idleCities = Object.values(view.sites).filter(
    (s) => s.owner === view.self.id && (s.kind === 'capital' || s.kind === 'city') && !view.self.productionQueue.some((q) => q.siteId === s.id) && !draft.recruit.some((r) => r.siteId === s.id),
  ).length;
  const waitingOthers = role && role !== 'hotseat' && resolving && !playback;
  return (
    <div className="pointer-events-auto absolute right-3 bottom-3 z-10 flex w-56 flex-col items-stretch gap-1.5">
      <SeatBoard />
      <EventCard />
      {lastTurn && !resolving && (
        <button type="button" onClick={rewatch} data-testid="rewatch" className="border border-line bg-ink-950/90 px-2.5 py-1.5 text-left text-[11px] text-muted hover:border-faint hover:text-text">
          ⟲ Rewatch turn {lastTurn.before.turn}
        </button>
      )}
      {report && (
        <button type="button" onClick={() => setShowReport(true)} data-testid="open-report" className="border border-line bg-ink-950/90 px-2.5 py-1.5 text-left text-[11px] text-muted hover:border-faint hover:text-text">
          📜 Turn {report.turn} summary
        </button>
      )}
      {idleCities > 0 && !resolving && (
        <div className="border border-signal/40 bg-ink-950/90 px-2.5 py-1.5 text-[11px] text-signal" title="Click a city banner on the map to choose what it builds">
          ⚒ {idleCities} {idleCities === 1 ? 'city' : 'cities'} could be building
        </div>
      )}
      <button
        type="button"
        onClick={nextIdle}
        disabled={idle === 0 || resolving}
        data-testid="next-idle"
        className={`border px-2.5 py-1.5 text-left text-xs font-semibold disabled:opacity-50 ${idle ? 'border-signal/60 bg-signal/15 text-signal hover:bg-signal/25' : 'border-good/40 bg-ink-950/90 text-good'}`}
        title="Select the next unit that needs orders (N)"
      >
        {idle ? `▸ ${idle} of ${total} units need orders` : `✓ All ${total} units have orders`}
      </button>
      <button
        type="button"
        onClick={() => void submit()}
        disabled={resolving || over}
        data-testid="end-turn"
        className="end-turn relative overflow-hidden rounded-sm border-2 border-signal bg-gradient-to-b from-[#f2c06a] to-[#c98a2c] px-4 py-3 text-ink-950 shadow-[0_0_24px_rgba(224,168,74,0.35)] transition-all hover:brightness-110 disabled:opacity-60"
      >
        <div className="font-display text-lg leading-none font-black tracking-wider uppercase">{waitingOthers ? 'Waiting…' : resolving ? 'Resolving…' : over ? 'Game over' : 'Next turn'}</div>
        <div className="font-display mt-1 text-[10px] font-bold tracking-[0.2em] uppercase opacity-70">{resolving ? 'orders locked' : `turn ${view.turn} · ctrl+enter`}</div>
      </button>
      <Minimap />
    </div>
  );
}

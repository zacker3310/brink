import { useEffect, useState } from 'react';
import type { Resource } from '@brink/contracts';
import { TERRAIN, UNITS } from '@brink/game-data';
import { movementAllowance } from '@brink/simulation';
import { useCamera } from './camera';
import { CityBanners, CityPanel } from './Cities';
import { Coach } from './Coach';
import { healthColor } from './design/tokens';
import { VictoryOverlay } from './Game';
import { Emblem, ModelPortrait } from './glyphs';
import { Icon } from './icons';
import { hexLabel, idleFormations, netChange, selfLedger, turnClock } from './insight';
import { MapView } from './MapView';
import { useNet } from './net/room';
import { Diplomacy, Economy, Military, Overview, Research } from './Panels';
import { describeOrder, hostilesAt } from './planning';
import { useReplay } from './replay';
import { ICON, notesFor, TONE } from './Notifications';
import { Report } from './Report';
import { ChatOverlay, Curtain } from './RoomUi';
import { SLOT_NAMES } from './saves';
import { isMuted, setMuted } from './sfx';
import { useGame, type Tab } from './store';
import { EventCard, OUTCOME, usePreview } from './UnitPanel';
import { signed } from './ui';

// The game on a phone: the map edge to edge, a slim status strip under the notch, and everything
// you do within reach of a thumb. Tap a unit, tap where it goes; tap an enemy twice to attack.

const RES: [Resource, string, string][] = [
  ['credits', '$', 'Treasury'],
  ['energy', 'E', 'Energy'],
  ['materials', 'M', 'Materials'],
  ['food', 'F', 'Food'],
];

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

function Hud({ onMenu }: { onMenu: () => void }) {
  const view = useGame((s) => s.view)!;
  const report = useGame((s) => s.report);
  const showThreat = useGame((s) => s.showThreat);
  const toggleThreat = useGame((s) => s.toggleThreat);
  const s = view.self;
  const ledger = selfLedger(view, report);
  const net = ledger ? netChange(ledger) : null;
  const turn = Math.min(view.turn, view.maxTurns);
  const clock = turnClock(turn);
  const ranked = Object.values(view.nations).sort((a, b) => b.victoryPoints - a.victoryPoints);
  const leader = ranked[0]!;
  const mine = view.nations[s.id]?.victoryPoints ?? 0;
  return (
    <header className="safe-top safe-x pointer-events-auto absolute inset-x-0 top-0 z-20 bg-gradient-to-b from-ink-950 via-ink-950/90 to-transparent pb-3" data-testid="top-bar">
      <div className="flex items-center gap-2 px-2 pt-1">
        <Emblem color={s.color} government={s.government} className="h-8 w-8 shrink-0" />
        <div className="leading-none" data-testid="turn">
          <div className="font-mono text-base font-bold tabular-nums">
            {turn}
            <span className="text-faint">/{view.maxTurns}</span>
          </div>
          <div className="font-display text-[9px] tracking-[0.06em] text-faint uppercase">
            Day {clock.day} · {clock.hour}
          </div>
        </div>
        <div className="min-w-0 flex-1 px-1" data-testid="vp-race" title={`${view.victoryThreshold} VP wins`}>
          <div className="font-display flex justify-between text-[9px] tracking-[0.06em] uppercase">
            <span style={{ color: s.color }}>
              You {mine} VP
            </span>
            <span className="text-faint">
              {leader.id === s.id ? 'leading' : `${leader.name.split(' ')[0]} ${leader.victoryPoints}`} · win {view.victoryThreshold}
            </span>
          </div>
          <div className="relative mt-1 h-1.5 bg-ink-700">
            {ranked
              .filter((n) => n.id !== s.id)
              .map((n) => (
                <span key={n.id} className="absolute top-[-2px] h-[10px] w-0.5" style={{ left: `${Math.min(100, (n.victoryPoints / view.victoryThreshold) * 100)}%`, background: n.color }} />
              ))}
            <div className="h-full" style={{ width: `${Math.min(100, (mine / view.victoryThreshold) * 100)}%`, background: s.color }} />
          </div>
        </div>
        <button
          type="button"
          onClick={toggleThreat}
          aria-pressed={showThreat}
          aria-label="Threat overlay"
          data-testid="threat-toggle"
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border ${showThreat ? 'border-hostile bg-hostile/25 text-hostile' : 'border-line bg-ink-900/80 text-muted'}`}
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
            <circle cx="12" cy="12" r="9" />
            <circle cx="12" cy="12" r="5" />
            <path d="M12 12L18 6" strokeLinecap="round" />
          </svg>
        </button>
        <button type="button" onClick={onMenu} aria-label="Menu" data-testid="phone-menu" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line bg-ink-900/80 text-muted">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden>
            <circle cx="5" cy="12" r="1.8" />
            <circle cx="12" cy="12" r="1.8" />
            <circle cx="19" cy="12" r="1.8" />
          </svg>
        </button>
      </div>
      <dl className="mt-1.5 flex items-center justify-between gap-1 px-3 font-mono text-[12px] tabular-nums">
        {RES.map(([r, short, label]) => {
          const d = net?.[r];
          const low = ledger?.shortages.includes(r);
          return (
            <div key={r} className="flex items-baseline gap-1" title={label}>
              <dt className="font-display text-[10px] font-bold text-faint">{short}</dt>
              <dd className={low ? 'text-hostile' : ''}>
                {s.stockpile[r]}
                {d !== undefined && d !== 0 && <span className={`ml-0.5 text-[9px] ${d > 0 ? 'text-good' : 'text-hostile'}`}>{signed(d)}</span>}
              </dd>
            </div>
          );
        })}
        <div className="flex items-baseline gap-1" title="Stability">
          <dt className="font-display text-[10px] font-bold text-faint">STB</dt>
          <dd className={s.stability < 40 ? 'text-hostile' : ''}>{s.stability}</dd>
        </div>
      </dl>
    </header>
  );
}

function MenuSheet({ onClose }: { onClose: () => void }) {
  const save = useGame((s) => s.save);
  const exportSave = useGame((s) => s.exportSave);
  const animate = useGame((s) => s.animate);
  const setAnimate = useGame((s) => s.setAnimate);
  const toMenu = useGame((s) => s.toMenu);
  const resolving = useGame((s) => s.resolving);
  const role = useNet((n) => n.role);
  const leave = useNet((n) => n.leave);
  const fit = useCamera((s) => s.control);
  const [muted, setM] = useState(isMuted());
  const row = 'flex w-full items-center justify-between border-b border-line/60 px-4 py-3.5 text-left text-sm active:bg-ink-800 disabled:opacity-40';
  return (
    <Sheet title="Menu" onClose={onClose} testId="menu-sheet">
      {role !== 'guest' &&
        SLOT_NAMES.map((slot) => (
          <button
            key={slot}
            type="button"
            className={row}
            disabled={resolving}
            data-testid={`save-${slot.replace(' ', '-').toLowerCase()}`}
            onClick={() => {
              onClose();
              void save(slot);
            }}
          >
            Save to {slot}
          </button>
        ))}
      {role !== 'guest' && (
        <button
          type="button"
          className={row}
          onClick={() => {
            onClose();
            void exportSave();
          }}
        >
          Export save file
        </button>
      )}
      <button type="button" className={row} onClick={() => setAnimate(!animate)} aria-pressed={animate} data-testid="toggle-replay">
        Turn replay <span className={animate ? 'text-signal' : 'text-faint'}>{animate ? 'On' : 'Off'}</span>
      </button>
      <button
        type="button"
        className={row}
        onClick={() => {
          setMuted(!muted);
          setM(!muted);
        }}
        aria-pressed={!muted}
        data-testid="toggle-sound"
      >
        Sound <span className={muted ? 'text-faint' : 'text-signal'}>{muted ? 'Off' : 'On'}</span>
      </button>
      <button
        type="button"
        className={row}
        onClick={() => {
          onClose();
          fit?.fit();
        }}
      >
        Show the whole map
      </button>
      <button
        type="button"
        className={`${row} text-hostile`}
        onClick={() => {
          if (role && role !== 'hotseat' && !window.confirm('Leave the war room? Your friends will see you go offline.')) return;
          if (role) leave();
          toMenu();
        }}
      >
        Quit to title
      </button>
    </Sheet>
  );
}

function Sheet({ title, onClose, children, testId, tabs }: { title: string; onClose: () => void; children: React.ReactNode; testId: string; tabs?: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-30 flex flex-col justify-end bg-ink-950/60" onClick={onClose} data-testid={testId}>
      <div className="sheet-in safe-bottom safe-x flex max-h-[88dvh] flex-col border-t border-line bg-ink-900 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <span className="font-display text-sm font-black tracking-[0.08em] uppercase">{title}</span>
          <button type="button" onClick={onClose} aria-label="Close" data-testid="close-sheet" className="-mr-2 flex h-9 w-9 items-center justify-center text-faint">
            <Icon name="close" className="h-4 w-4" />
          </button>
        </div>
        {tabs}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
      </div>
    </div>
  );
}

const TABS: [Tab, string][] = [
  ['overview', 'Overview'],
  ['military', 'Forces'],
  ['economy', 'Economy'],
  ['research', 'Research'],
  ['diplomacy', 'Diplomacy'],
];

function CommandSheet({ onClose }: { onClose: () => void }) {
  const tab = useGame((s) => s.tab);
  const setTab = useGame((s) => s.setTab);
  // Panels act on the map (focus a unit, open a city): get out of the way when they do.
  useEffect(
    () =>
      useGame.subscribe((s, p) => {
        if ((s.focus !== p.focus && s.focus) || (s.selectedCity && s.selectedCity !== p.selectedCity)) onClose();
      }),
    [onClose],
  );
  return (
    <Sheet
      title="Command"
      onClose={onClose}
      testId={`panel-${tab}`}
      tabs={
        <nav className="flex overflow-x-auto border-b border-line" aria-label="Command">
          {TABS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              data-testid={`tab-${id}`}
              onClick={() => setTab(id)}
              aria-current={tab === id ? 'page' : undefined}
              className={`font-display flex-1 shrink-0 border-b-2 px-2 py-2.5 text-[10px] font-bold tracking-[0.04em] uppercase ${tab === id ? 'border-signal text-signal' : 'border-transparent text-faint'}`}
            >
              {label}
            </button>
          ))}
        </nav>
      }
    >
      {tab === 'overview' && <Overview />}
      {tab === 'military' && <Military />}
      {tab === 'economy' && <Economy />}
      {tab === 'research' && <Research />}
      {tab === 'diplomacy' && <Diplomacy />}
    </Sheet>
  );
}

function Toasts() {
  const notices = useGame((s) => s.notices);
  const dismiss = useGame((s) => s.dismiss);
  return (
    <ul className="pointer-events-none absolute inset-x-3 top-[calc(env(safe-area-inset-top)+82px)] z-20 flex flex-col items-center gap-1.5" aria-live="polite">
      {notices.slice(-3).map((n) => (
        <li key={n.id} className="pointer-events-auto">
          <button
            type="button"
            onClick={() => dismiss(n.id)}
            className={`toast-in border bg-ink-950/95 px-3 py-2 text-[13px] shadow-xl ${n.tone === 'error' ? 'border-hostile/60 text-hostile' : n.tone === 'warn' ? 'border-signal/60 text-signal' : 'border-line text-text'}`}
          >
            {n.text}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Replay transport, at the thumb: phase, pause, speed, skip. */
function ReplayDock() {
  const playback = useGame((s) => s.playback)!;
  const finishPlayback = useGame((s) => s.finishPlayback);
  const { paused, speed, progress } = useReplay();
  const btn = 'flex h-11 min-w-11 items-center justify-center border border-line bg-ink-900 px-3 text-sm';
  return (
    <div className="pointer-events-auto relative border-t border-signal/60 bg-ink-950/95 px-3 pt-2.5" data-testid="replay" role="status">
      <div className="absolute inset-x-0 top-0 h-0.5 bg-ink-700">
        <div className="h-full bg-signal" style={{ width: `${progress * 100}%` }} />
      </div>
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1 leading-tight">
          <div className="font-display text-[10px] font-bold tracking-[0.1em] text-signal uppercase">Turn {playback.before.turn} · {playback.rewatch ? 'rewatch' : 'live'}</div>
          <div className="font-display text-lg font-black tracking-wide uppercase">{playback.phase}</div>
        </div>
        <button type="button" onClick={() => useReplay.setState({ paused: !paused })} className={`${btn} ${paused ? 'border-signal text-signal' : ''}`} aria-pressed={paused} aria-label={paused ? 'Play' : 'Pause'} data-testid="replay-pause">
          <Icon name={paused ? 'play' : 'pause'} className="h-4 w-4" />
        </button>
        <button type="button" onClick={() => useReplay.setState({ speed: speed === 2 ? 1 : 2 })} className={`${btn} font-mono ${speed === 2 ? 'border-signal text-signal' : ''}`} aria-pressed={speed === 2}>
          2×
        </button>
        <button type="button" onClick={finishPlayback} className={`${btn} font-display font-bold tracking-wide uppercase`} data-testid="skip-replay">
          {playback.rewatch ? 'Done' : 'Skip'}
        </button>
      </div>
    </div>
  );
}

function UnitCard() {
  const view = useGame((s) => s.view)!;
  const draft = useGame((s) => s.draft)!;
  const fid = useGame((s) => s.selectedFormation)!;
  const armed = useGame((s) => s.armed);
  const armAttack = useGame((s) => s.armAttack);
  const issueOrder = useGame((s) => s.issueOrder);
  const setOrder = useGame((s) => s.setOrder);
  const selectFormation = useGame((s) => s.selectFormation);
  const resolving = useGame((s) => s.resolving);
  const f = view.formations[fid];
  const order = draft.formations[fid];
  const locked = armed && armed.formation === fid ? armed : null;
  const preview = usePreview(locked?.order ?? order, fid);
  if (!f) return null;
  const def = UNITS[f.unitClass];
  const ratio = f.strength / 1000;
  const color = view.self.color;
  const target = locked ? hostilesAt(view, locked.target) : [];
  const btn = 'flex h-11 flex-1 flex-col items-center justify-center gap-0.5 border border-line bg-ink-850 text-[10px] font-semibold tracking-wide uppercase active:bg-ink-700 disabled:opacity-30';
  const odds = preview && (locked || order?.type === 'attack') && (
    <div className="text-[12px]" data-testid="preview">
      {preview.assault &&
        (preview.assault.defenders === 0 ? (
          <span className="text-muted">No enemy seen there: you will try to take the hex.</span>
        ) : (
          <span>
            You −{preview.assault.attackerLoss[0]}–{preview.assault.attackerLoss[1]}, they −{preview.assault.defenderLoss[0]}–{preview.assault.defenderLoss[1]} ·{' '}
            {preview.assault.outcomes.map((o) => (
              <b key={o} className={`mr-1 ${OUTCOME[o]?.tone}`}>
                {OUTCOME[o]?.text}
              </b>
            ))}
          </span>
        ))}
      {preview.strike && (preview.strike.targets === 0 ? <span className="text-muted">No confirmed targets.</span> : <span>Strike {preview.strike.targets} target(s), −{preview.strike.loss[0]}–{preview.strike.loss[1]} each</span>)}
    </div>
  );
  return (
    <div className="pointer-events-auto border-t border-line bg-ink-950/95" data-testid="unit-panel">
      <div className="flex items-center gap-3 px-3 pt-2.5">
        <div className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-2" style={{ borderColor: color, background: `radial-gradient(circle at 35% 30%, ${color}55, #0b111b 70%)` }}>
          <ModelPortrait unitClass={f.unitClass} className="h-12 w-12 -rotate-90" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-display truncate text-base leading-tight font-black">{f.name}</span>
            <span className="font-mono text-xs" style={{ color: hex(healthColor(ratio)) }}>
              {Math.round(ratio * 100)}%
            </span>
          </div>
          <div className="text-[10px] font-semibold tracking-wide uppercase" style={{ color }}>
            {def.name} · {movementAllowance(f) || '—'} MP · atk {def.softAttack}/{def.hardAttack} · def {def.defense}
          </div>
          <div className="mt-1 h-1 bg-ink-700">
            <div className="h-full" style={{ width: `${ratio * 100}%`, background: hex(healthColor(ratio)) }} />
          </div>
          <div className="mt-1 truncate text-[12px]" data-testid="planned-order">
            <span className={order ? 'font-semibold text-friend' : 'text-signal'}>{order ? describeOrder(order, view) : def.ground ? 'Tap a blue hex to move · an enemy to attack' : 'Tap a target to strike · a city to rebase'}</span>
          </div>
        </div>
      </div>
      {locked ? (
        <div className="lock-in mx-3 mt-2 border border-hostile/70 bg-hostile/10 px-3 py-2" data-testid="armed">
          <div className="font-display text-[11px] font-black tracking-[0.1em] text-hostile uppercase">
            Target locked · {target.length ? target.map((c) => UNITS[c.unitClass].name).join(', ') : hexLabel(view, locked.target)}
          </div>
          {odds || <div className="text-[12px] text-muted">Reading the odds…</div>}
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => armAttack(null)} className="h-11 flex-1 border border-line bg-ink-900 text-sm font-semibold" data-testid="cancel-attack">
              Cancel
            </button>
            <button type="button" onClick={() => issueOrder(fid, locked.order)} className="font-display h-11 flex-[2] bg-hostile text-base font-black tracking-wide text-white uppercase active:brightness-90" data-testid="confirm-attack">
              {def.range ? 'Fire' : 'Attack'}
            </button>
          </div>
        </div>
      ) : (
        odds && <div className="mx-3 mt-1.5">{odds}</div>
      )}
      <div className="flex gap-1.5 px-3 pt-2 pb-1">
        <button type="button" className={`${btn} ${order?.type === 'defend' ? 'border-friend text-friend' : ''}`} disabled={resolving || !def.ground} onClick={() => issueOrder(fid, { type: 'defend' })} data-testid="order-defend">
          <Icon name="defense" className="h-4 w-4" />
          Dig in
        </button>
        <button type="button" className={`${btn} ${order?.type === 'hold' ? 'border-friend text-friend' : ''}`} disabled={resolving} onClick={() => issueOrder(fid, { type: 'hold' })} data-testid="order-hold">
          <Icon name="pause" className="h-4 w-4" />
          Hold
        </button>
        <button type="button" className={btn} disabled={resolving || !order} onClick={() => setOrder(fid, null)} data-testid="order-clear">
          <Icon name="close" className="h-4 w-4" />
          Clear
        </button>
        <button type="button" className={btn} onClick={() => selectFormation(null)} data-testid="deselect">
          <Icon name="down" className="h-4 w-4" />
          Done
        </button>
      </div>
    </div>
  );
}

/** What is on a tapped hex, when no unit is selected. */
function HexCard() {
  const view = useGame((s) => s.view)!;
  const key = useGame((s) => s.selectedHex);
  const selectHex = useGame((s) => s.selectHex);
  if (!key) return null;
  const t = view.tiles[key];
  if (!t) return null;
  const contacts = Object.values(view.contacts).filter((c) => c.key === key);
  const owner = t.owner ? view.nations[t.owner] : null;
  return (
    <div className="pointer-events-auto flex items-start gap-2 border-t border-line bg-ink-950/95 px-3 py-2 text-[12px]" data-testid="hex-card">
      <div className="min-w-0 flex-1">
        <div className="font-semibold">{hexLabel(view, key)}</div>
        <div className="text-muted">
          {t.terrain ? `${TERRAIN[t.terrain].name}${TERRAIN[t.terrain].defense ? `, +${TERRAIN[t.terrain].defense}% defense` : ''}${t.river ? ', river' : ''}` : 'Unknown ground'}
          {owner && <span style={{ color: owner.color }}> · {owner.name}</span>}
        </div>
        {contacts.map((c) => (
          <div key={c.formation} style={{ color: view.nations[c.owner]?.color }}>
            {UNITS[c.unitClass].name} ~{Math.round(c.estimatedStrength / 10)}%{c.confirmed ? '' : ' (last seen)'}
          </div>
        ))}
      </div>
      <button type="button" onClick={() => selectHex(null)} aria-label="Close" className="-mr-1 flex h-8 w-8 items-center justify-center text-faint">
        <Icon name="close" />
      </button>
    </div>
  );
}

/** What the turn did, the moment it is over: the top few results, each a tap from where it happened. */
function Debrief({ onDone }: { onDone: () => void }) {
  const view = useGame((s) => s.view)!;
  const report = useGame((s) => s.report)!;
  const focusOn = useGame((s) => s.focusOn);
  const setShowReport = useGame((s) => s.setShowReport);
  const notes = notesFor(view, report);
  const vp = report.victoryPoints[view.self.id] ?? 0;
  return (
    <div className="sheet-in pointer-events-auto border-t border-signal/60 bg-ink-950/95 px-3 pt-2.5 pb-1" data-testid="debrief">
      <div className="flex items-center justify-between">
        <span className="font-display text-[11px] font-black tracking-[0.1em] text-signal uppercase">Turn {report.turn} debrief</span>
        <span className="font-mono text-[11px] text-muted">{vp} VP</span>
      </div>
      <ul className="mt-1.5 flex flex-col gap-1">
        {notes.length === 0 && <li className="text-[12px] text-muted">A quiet turn. Nothing your forces saw changed hands.</li>}
        {notes.slice(0, 3).map((n) => (
          <li key={n.id}>
            <button
              type="button"
              className="flex w-full items-center gap-2.5 text-left active:bg-ink-800"
              onClick={() => {
                if (n.at) focusOn(n.at);
                else setShowReport(true);
              }}
            >
              <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 ${TONE[n.tone]}`}>
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d={ICON[n.icon]} />
                </svg>
              </span>
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block truncate text-[13px] font-semibold">{n.title}</span>
                <span className="block truncate text-[11px] text-muted">{n.text}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex gap-2">
        <button type="button" onClick={() => setShowReport(true)} className="h-10 flex-1 border border-line bg-ink-900 text-[13px]" data-testid="debrief-report">
          Full report{notes.length > 3 ? ` (+${notes.length - 3})` : ''}
        </button>
        <button type="button" onClick={onDone} className="font-display h-10 flex-1 bg-friend/90 text-[13px] font-bold tracking-wide text-ink-950 uppercase" data-testid="debrief-close">
          To orders
        </button>
      </div>
    </div>
  );
}

function Dock({ onCommand, cooling }: { onCommand: () => void; cooling: boolean }) {
  const view = useGame((s) => s.view)!;
  const draft = useGame((s) => s.draft)!;
  const submit = useGame((s) => s.submit);
  const nextIdle = useGame((s) => s.nextIdle);
  const autoCommand = useGame((s) => s.autoCommand);
  const resolving = useGame((s) => s.resolving);
  const report = useGame((s) => s.report);
  const setShowReport = useGame((s) => s.setShowReport);
  const lastTurn = useGame((s) => s.lastTurn);
  const rewatch = useGame((s) => s.rewatch);
  const fid = useGame((s) => s.selectedFormation);
  const role = useNet((s) => s.role);
  const idle = idleFormations(view, draft.formations).length;
  const over = view.victory !== null;
  const idleCities = Object.values(view.sites).filter(
    (s) => s.owner === view.self.id && (s.kind === 'capital' || s.kind === 'city') && !view.self.productionQueue.some((q) => q.siteId === s.id) && !draft.recruit.some((r) => r.siteId === s.id),
  ).length;
  const waiting = role && role !== 'hotseat' && resolving;
  const chip = 'shrink-0 border border-line bg-ink-950/90 px-2.5 py-1.5 text-[12px] text-muted active:bg-ink-800';
  const key = 'flex h-14 w-14 shrink-0 flex-col items-center justify-center gap-0.5 border border-line bg-ink-900 text-[9px] font-bold tracking-wide uppercase active:bg-ink-700 disabled:opacity-35';
  return (
    <>
      {!fid && !resolving && (
        <div className="pointer-events-auto flex gap-1.5 overflow-x-auto px-3 pb-2">
          {report && (
            <button type="button" className={chip} onClick={() => setShowReport(true)} data-testid="open-report">
              <Icon name="report" className="mr-1 h-3 w-3 align-[-2px]" />
              Turn {report.turn} report
            </button>
          )}
          {lastTurn && (
            <button type="button" className={chip} onClick={rewatch} data-testid="rewatch">
              <Icon name="replay" className="mr-1 h-3 w-3 align-[-2px]" />
              Rewatch
            </button>
          )}
          {idleCities > 0 && (
            <span className={`${chip} border-signal/50 text-signal`}>
              <Icon name="build" className="mr-1 h-3 w-3 align-[-2px]" />
              {idleCities} {idleCities === 1 ? 'city' : 'cities'} idle: tap a banner
            </span>
          )}
        </div>
      )}
      <div className="pointer-events-auto flex items-stretch gap-1.5 border-t border-line bg-ink-950/95 px-3 pt-2">
        <button type="button" className={key} onClick={onCommand} data-testid="open-command">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
            <path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" />
          </svg>
          Command
        </button>
        {role !== 'guest' && (
          <button type="button" className={key} onClick={() => void autoCommand()} disabled={resolving || over || idle === 0} data-testid="auto-command" title="Your staff drafts orders for every unit still waiting">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden>
              <path d="M13 2L4 14h7l-1 8 9-12h-7z" />
            </svg>
            Auto
          </button>
        )}
        <button type="button" className={`${key} relative ${idle ? 'text-signal' : 'text-good'}`} onClick={nextIdle} disabled={resolving || idle === 0} data-testid="next-idle">
          <Icon name={idle ? 'next' : 'check'} className="h-5 w-5" />
          {idle ? 'Next' : 'Ready'}
          {idle > 0 && <span className="absolute -top-1.5 -right-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-signal px-1 font-mono text-[11px] text-ink-950">{idle}</span>}
        </button>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={resolving || over || cooling}
          data-testid="end-turn"
          className="end-turn relative flex-1 overflow-hidden bg-signal px-3 text-ink-950 active:brightness-90 disabled:opacity-60"
        >
          <div className="font-display text-xl leading-none font-black uppercase">{waiting ? 'Waiting…' : resolving ? 'Resolving…' : over ? 'Game over' : 'End turn'}</div>
          <div className="font-display mt-1 text-[10px] font-bold tracking-[0.06em] uppercase opacity-70">{resolving ? 'orders locked' : idle ? `${idle} will hold` : 'all units ordered'}</div>
        </button>
      </div>
    </>
  );
}

export function PhoneGame() {
  const showReport = useGame((s) => s.showReport);
  const playback = useGame((s) => s.playback);
  const fid = useGame((s) => s.selectedFormation);
  const city = useGame((s) => s.selectedCity);
  const selectedHex = useGame((s) => s.selectedHex);
  const event = useGame((s) => s.view?.self.event);
  const resolving = useGame((s) => s.resolving);
  const [menu, setMenu] = useState(false);
  const [command, setCommand] = useState(false);
  const [chat, setChat] = useState(false);
  const reportTurn = useGame((s) => s.report?.turn ?? 0);
  const [briefed, setBriefed] = useState(reportTurn);
  const debrief = reportTurn > briefed && !resolving;
  // Skip sits where End Turn comes back: a late tap on one must not end the next turn.
  const [cooling, setCooling] = useState(false);
  const playing = playback !== null;
  useEffect(() => {
    if (playing) return;
    setCooling(true);
    const t = setTimeout(() => setCooling(false), 900);
    return () => clearTimeout(t);
  }, [playing]);
  return (
    <div className="map-stage no-select relative h-full overflow-hidden bg-ink-950" data-testid="map">
      <div className="absolute inset-0">
        <MapView />
      </div>
      <div className="map-vignette pointer-events-none absolute inset-0" aria-hidden />
      <CityBanners />
      {resolving && !playback && (
        <div className="resolving-banner pointer-events-none absolute top-[calc(env(safe-area-inset-top)+86px)] left-1/2 z-10 -translate-x-1/2 overflow-hidden border border-signal/70 bg-ink-950/90 px-4 py-2 text-center" role="status">
          <div className="font-display text-[10px] font-bold tracking-[0.1em] text-signal uppercase">Orders locked</div>
          <div className="text-sm font-semibold">The world moves…</div>
        </div>
      )}
      <Hud onMenu={() => setMenu(true)} />
      <Toasts />
      <div className="safe-bottom safe-x pointer-events-none absolute inset-x-0 bottom-0 z-10 flex flex-col">
        {playback ? (
          <ReplayDock />
        ) : (
          <>
            {event && !fid && (
              <div className="pointer-events-auto mx-3 mb-2">
                <EventCard />
              </div>
            )}
            {debrief ? <Debrief onDone={() => setBriefed(reportTurn)} /> : fid ? <UnitCard /> : !city && selectedHex && <HexCard />}
            <Dock onCommand={() => setCommand(true)} cooling={cooling} />
          </>
        )}
      </div>
      <CityPanel />
      {command && <CommandSheet onClose={() => setCommand(false)} />}
      {menu && <MenuSheet onClose={() => setMenu(false)} />}
      <ChatOverlay open={chat} onClose={() => setChat(false)} />
      <VictoryOverlay />
      {showReport && <Report />}
      <Coach />
      <Curtain />
    </div>
  );
}

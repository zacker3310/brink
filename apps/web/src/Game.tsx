import { useState } from 'react';
import type { Resource } from '@brink/contracts';
import { GOVERNMENTS, UNITS } from '@brink/game-data';
import { useCamera } from './camera';
import { Kbd, Label, useKeys } from './chrome';
import { CityBanners, CityPanel } from './Cities';
import { Emblem } from './glyphs';
import { netChange, selfLedger, turnClock } from './insight';
import { HoverCard, ModeBanner, Toasts, ZoomControls } from './MapOverlays';
import { MapView } from './MapView';
import { Diplomacy, Economy, Military, Overview, Research } from './Panels';
import { useNet } from './net/room';
import { Notifications } from './Notifications';
import { ChatOverlay, Curtain, RoomChip } from './RoomUi';
import { Report } from './Report';
import { SLOT_NAMES } from './saves';
import { useGame, type Tab } from './store';
import { TurnControls, UnitPanel } from './UnitPanel';
import { Meter, signed, Swatch } from './ui';

const RES: [Resource, string][] = [
  ['credits', 'Treasury'],
  ['energy', 'Energy'],
  ['materials', 'Materials'],
  ['food', 'Food'],
];

function TopBar({ onChat }: { onChat: () => void }) {
  const view = useGame((s) => s.view)!;
  const report = useGame((s) => s.report);
  const toMenu = useGame((s) => s.toMenu);
  const save = useGame((s) => s.save);
  const resolving = useGame((s) => s.resolving);
  const animate = useGame((s) => s.animate);
  const setAnimate = useGame((s) => s.setAnimate);
  const [saving, setSaving] = useState(false);
  const role = useNet((n) => n.role);
  const leave = useNet((n) => n.leave);
  const exit = () => {
    if (role && role !== 'hotseat' && !window.confirm('Leave the war room? Your friends will see you go offline.')) return;
    if (role) leave();
    toMenu();
  };
  const s = view.self;
  const ledger = selfLedger(view, report);
  const net = ledger ? netChange(ledger) : null;
  const turn = Math.min(view.turn, view.maxTurns);
  const clock = turnClock(turn);
  return (
    <header className="relative z-20 flex items-stretch border-b border-line bg-ink-950" data-testid="top-bar">
      <div className="font-display flex items-center border-r border-line px-4 text-sm font-black tracking-[0.28em] text-signal" aria-label="Brink">
        BRINK
      </div>
      <div className="flex items-center gap-2.5 border-r border-line px-4" style={{ background: `linear-gradient(90deg, ${s.color}1f, transparent)` }}>
        <Emblem color={s.color} government={s.government} className="h-7 w-7" />
        <div className="leading-tight whitespace-nowrap">
          <div className="font-display text-base font-bold tracking-wide uppercase">{s.name}</div>
          <div className="text-[10px] font-semibold tracking-wider uppercase" style={{ color: s.color }}>
            {GOVERNMENTS[s.government].name}
          </div>
        </div>
      </div>

      <dl className="flex items-center gap-x-5 px-4">
        {RES.map(([r, label]) => {
          const short = ledger?.shortages.includes(r);
          const d = net?.[r];
          return (
            <div key={r} className="leading-tight" title={ledger ? `${label}: ${signed(d ?? 0)} last turn` : label}>
              <dt className="font-display text-[9px] tracking-[0.16em] text-faint uppercase">{label}</dt>
              <dd className={`font-mono text-sm tabular-nums ${short ? 'text-hostile' : ''}`}>
                {s.stockpile[r]}
                {d !== undefined && d !== 0 && <span className={`ml-1 text-[10px] ${d > 0 ? 'text-good' : 'text-hostile'}`}>{signed(d)}</span>}
              </dd>
            </div>
          );
        })}
        <div className="leading-tight">
          <dt className="font-display text-[9px] tracking-[0.16em] text-faint uppercase">Industry</dt>
          <dd className="font-mono text-sm tabular-nums">{s.industrialCapacity}</dd>
        </div>
        <div className="leading-tight">
          <dt className="font-display text-[9px] tracking-[0.16em] text-faint uppercase">Research</dt>
          <dd className="font-mono text-sm tabular-nums">{s.researchOutput}</dd>
        </div>
        <div className="w-20 leading-tight">
          <dt className="font-display text-[9px] tracking-[0.16em] text-faint uppercase">Stability</dt>
          <dd className={`font-mono text-sm tabular-nums ${s.stability < 40 ? 'text-hostile' : ''}`}>{s.stability}</dd>
          <Meter value={s.stability} tone={s.stability < 40 ? 'bad' : 'good'} />
        </div>
      </dl>

      <VpRace />

      <div className="ml-auto flex items-center gap-3 border-l border-line px-4">
        <div className="text-right leading-tight" data-testid="turn">
          <div className="font-display text-[9px] tracking-[0.16em] text-faint uppercase">
            Day {clock.day} · {clock.hour}
          </div>
          <div className="font-mono text-sm font-semibold">
            {turn} / {view.maxTurns}
          </div>
          <div className="mt-0.5 h-0.5 w-20 bg-ink-700">
            <div className="h-full bg-signal" style={{ width: `${((turn - 1) / view.maxTurns) * 100}%` }} />
          </div>
        </div>
        <button
          type="button"
          onClick={() => setAnimate(!animate)}
          aria-pressed={animate}
          data-testid="toggle-replay"
          title="Replay each resolved turn on the map before the report"
          className={`border px-2 py-1.5 text-[11px] whitespace-nowrap ${animate ? 'border-signal/50 text-signal' : 'border-line text-faint'} hover:border-faint`}
        >
          Replay {animate ? 'on' : 'off'}
        </button>
        <RoomChip onChat={onChat} />
        <div className={`relative ${role === 'guest' ? 'hidden' : ''}`}>
          <button type="button" onClick={() => setSaving(!saving)} disabled={resolving} data-testid="save-menu" className="border border-line px-2.5 py-1.5 text-xs hover:border-faint disabled:opacity-40">
            Save
          </button>
          {saving && (
            <div className="absolute right-0 z-30 mt-1 w-40 border border-line bg-ink-850 p-1 shadow-xl" role="menu">
              {SLOT_NAMES.map((slot) => (
                <button
                  key={slot}
                  type="button"
                  role="menuitem"
                  data-testid={`save-${slot.replace(' ', '-').toLowerCase()}`}
                  className="block w-full px-2 py-1.5 text-left text-xs hover:bg-ink-700"
                  onClick={() => {
                    setSaving(false);
                    void save(slot);
                  }}
                >
                  Save to {slot}
                </button>
              ))}
            </div>
          )}
        </div>
        <button type="button" onClick={exit} className="border border-line px-2.5 py-1.5 text-xs text-muted hover:border-faint hover:text-text">
          Menu
        </button>
      </div>
    </header>
  );
}

/** Every nation's victory points as a bar against the outright-win threshold. */
function VpRace() {
  const view = useGame((s) => s.view)!;
  const ranked = Object.values(view.nations).sort((a, b) => b.victoryPoints - a.victoryPoints || (a.id < b.id ? -1 : 1));
  return (
    <div className="hidden min-w-48 flex-1 flex-col justify-center gap-0.5 border-l border-line px-4 xl:flex" title={`${view.victoryThreshold} VP wins outright`} data-testid="vp-race">
      <div className="font-display flex justify-between text-[9px] tracking-[0.16em] text-faint uppercase">
        <span>Victory points</span>
        <span>win at {view.victoryThreshold}</span>
      </div>
      {ranked.map((n) => (
        <div key={n.id} className="flex items-center gap-1.5">
          <div className="relative h-1 flex-1 bg-ink-700">
            <div className="h-full" style={{ width: `${Math.min(100, (n.victoryPoints / view.victoryThreshold) * 100)}%`, background: n.color, opacity: n.eliminated ? 0.3 : 1 }} />
          </div>
          <span className={`w-5 text-right font-mono text-[9px] tabular-nums ${n.id === view.self.id ? 'text-text' : 'text-faint'}`}>{n.victoryPoints}</span>
        </div>
      ))}
    </div>
  );
}

const TABS: [Tab, string, string][] = [
  ['overview', 'Overview', 'M3 12h4l3-8 4 16 3-8h4'],
  ['military', 'Military', 'M4 6h16v12H4z M4 6l16 12 M20 6L4 18'],
  ['economy', 'Economy', 'M4 20V10 M10 20V4 M16 20v-7 M22 20H2'],
  ['research', 'Research', 'M9 3h6 M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3'],
  ['diplomacy', 'Diplomacy', 'M3 12l5-5 4 4 4-4 5 5-9 9z'],
];

function LeftRail() {
  const tab = useGame((s) => s.tab);
  const setTab = useGame((s) => s.setTab);
  const open = useGame((s) => s.panelOpen);
  const togglePanel = useGame((s) => s.togglePanel);
  return (
    <nav className="flex flex-col border-r border-line bg-ink-950" aria-label="Command">
      {TABS.map(([id, label, d], i) => {
        const active = tab === id && open;
        return (
          <button
            key={id}
            type="button"
            data-testid={`tab-${id}`}
            onClick={() => (tab === id && open ? togglePanel(false) : setTab(id))}
            aria-current={active ? 'page' : undefined}
            title={`${label} (${i + 1})`}
            className={`group relative flex flex-col items-center gap-1 border-l-2 py-3 text-[9px] font-semibold tracking-wider uppercase transition-colors ${
              active ? 'border-signal bg-ink-850 text-signal' : 'border-transparent text-faint hover:bg-ink-900 hover:text-text'
            }`}
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" aria-hidden>
              <path d={d} />
            </svg>
            {label}
          </button>
        );
      })}
      <button
        type="button"
        onClick={() => togglePanel()}
        className="mt-auto py-3 text-faint hover:text-text"
        title={open ? 'Hide panel (Tab)' : 'Show panel (Tab)'}
        aria-label={open ? 'Hide panel' : 'Show panel'}
        data-testid="toggle-panel"
      >
        {open ? '«' : '»'}
      </button>
    </nav>
  );
}

function SidePanel() {
  const tab = useGame((s) => s.tab);
  const open = useGame((s) => s.panelOpen);
  const togglePanel = useGame((s) => s.togglePanel);
  if (!open) return null;
  return (
    <aside className="panel-in absolute top-0 bottom-0 left-0 z-20 w-[320px] overflow-y-auto border-r border-line bg-ink-900/97 shadow-2xl backdrop-blur" data-testid={`panel-${tab}`}>
      <button type="button" onClick={() => togglePanel(false)} className="absolute top-2 right-2 z-10 text-faint hover:text-text" aria-label="Close panel">
        ✕
      </button>
      {tab === 'overview' && <Overview />}
      {tab === 'military' && <Military />}
      {tab === 'economy' && <Economy />}
      {tab === 'research' && <Research />}
      {tab === 'diplomacy' && <Diplomacy />}
    </aside>
  );
}

function KeyHelp({ onClose }: { onClose: () => void }) {
  const rows: [string, string][] = [
    ['Left-click', 'Select a unit or city; with a unit selected, order it there'],
    ['Right-click', 'Order the selected unit: move, or attack an enemy'],
    ['Drag  Wheel', 'Pan, zoom'],
    ['1–5', 'Panels'],
    ['Tab', 'Hide / show panel'],
    ['N', 'Next unit that needs orders'],
    ['H D', 'Hold, defend'],
    ['M A R W', 'Move, attack, recon, withdraw'],
    ['X', 'Clear order'],
    ['Esc', 'Deselect, close'],
    ['?', 'This card'],
    ['F  + −', 'Fit, zoom'],
    ['V', 'Threat overlay'],
    ['Ctrl Enter', 'End turn'],
  ];
  return (
    <div className="panel-in absolute top-14 right-14 z-30 w-80 ds-panel p-4 text-xs shadow-2xl" data-testid="key-help">
      <div className="flex justify-between">
        <Label>Controls</Label>
        <button type="button" onClick={onClose} className="text-faint hover:text-text" aria-label="Close">
          ✕
        </button>
      </div>
      <dl className="mt-2 grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="flex gap-1">
              {k.split(' ').filter(Boolean).map((x) => (
                <Kbd key={x}>{x}</Kbd>
              ))}
            </dt>
            <dd className="text-muted">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function VictoryOverlay() {
  const view = useGame((s) => s.view)!;
  const toMenu = useGame((s) => s.toMenu);
  const [hidden, setHidden] = useState(false);
  if (!view.victory || hidden) return null;
  const winner = view.nations[view.victory.winner]!;
  const reason = { victory_points: 'by holding the victory-point threshold', last_standing: 'as the last nation standing', turn_limit: 'by leading at the turn limit' }[view.victory.reason];
  const won = winner.id === view.self.id;
  const ranked = Object.values(view.nations).sort((a, b) => b.victoryPoints - a.victoryPoints);
  return (
    <div className="screen-in absolute inset-0 z-20 flex items-center justify-center bg-ink-950/75 backdrop-blur-sm" data-testid="victory" role="status">
      <div className="w-full max-w-md border border-line bg-ink-900 p-6 text-center shadow-2xl" style={{ borderTop: `3px solid ${won ? 'var(--color-good)' : 'var(--color-hostile)'}` }}>
        <div className="font-display text-[10px] font-bold tracking-[0.36em] text-faint uppercase">Campaign concluded · turn {view.victory.turn}</div>
        <div className={`font-display mt-2 text-5xl font-black tracking-tight ${won ? 'text-good' : 'text-hostile'}`}>{won ? 'VICTORY' : 'DEFEAT'}</div>
        <div className="mt-2 text-sm text-muted">
          <span style={{ color: winner.color }}>{winner.name}</span> wins {reason}.
        </div>
        <ul className="mt-4 space-y-1 text-left text-xs">
          {ranked.map((n, i) => (
            <li key={n.id} className="flex items-center gap-2">
              <span className="w-4 font-mono text-faint">{i + 1}</span>
              <Swatch color={n.color} />
              <span className={n.id === view.self.id ? 'font-bold' : ''}>{n.name}</span>
              <span className="ml-auto font-mono">{n.victoryPoints} VP</span>
            </li>
          ))}
        </ul>
        <div className="mt-5 flex justify-center gap-2">
          <button type="button" onClick={() => setHidden(true)} className="border border-line px-3 py-1.5 text-xs hover:border-faint">
            View the map
          </button>
          <button type="button" onClick={toMenu} className="border border-signal bg-signal px-3 py-1.5 text-xs font-bold text-ink-950">
            Back to command
          </button>
        </div>
      </div>
    </div>
  );
}

function useShortcuts(toggleHelp: () => void, openChat: () => void) {
  const s = useGame;
  useKeys((e) => {
    const g = s.getState();
    if (g.playback) {
      if (e.key === 'Escape' || e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        g.finishPlayback();
      }
      return;
    }
    if (g.showReport) {
      if (e.key === 'Escape' || e.key === 'Enter') g.setShowReport(false);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      void g.submit();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const cam = useCamera.getState().control;
    const f = g.selectedFormation && g.view ? g.view.formations[g.selectedFormation] : undefined;
    const k = e.key.toLowerCase();
    const tab = Number(e.key);
    if (e.key === '?') toggleHelp();
    else if (e.key === 't' && useNet.getState().role && useNet.getState().role !== 'hotseat') {
      e.preventDefault();
      openChat();
    }
    else if (tab >= 1 && tab <= TABS.length) g.setTab(TABS[tab - 1]![0]);
    else if (e.key === 'Tab') {
      e.preventDefault();
      g.togglePanel();
    } else if (k === 'n') g.nextIdle();
    else if (e.key === 'Escape') {
      if (g.selectedCity) return;
      if (g.panelOpen) g.togglePanel(false);
      g.selectFormation(null);
      g.selectHex(null);
    } else if (k === 'f') cam?.fit();
    else if (k === 'v') g.toggleThreat();
    else if (e.key === '+' || e.key === '=') cam?.zoomBy(1.25);
    else if (e.key === '-' || e.key === '_') cam?.zoomBy(0.8);
    else if (f && !g.resolving) {
      if (k === 'h') g.issueOrder(f.id, { type: 'hold' });
      else if (k === 'd' && UNITS[f.unitClass].ground) g.issueOrder(f.id, { type: 'defend' });
      else if (k === 'x') g.setOrder(f.id, null);
      else if (k === 'm') g.setMode('move');
      else if (k === 'a') g.setMode('attack');
      else if (k === 'r') g.setMode('recon');
      else if (k === 'w') g.setMode('withdraw');
    }
  }, []);
}

export function Game() {
  const showReport = useGame((s) => s.showReport);
  const [help, setHelp] = useState(false);
  const [chat, setChat] = useState(false);
  useShortcuts(
    () => setHelp((h) => !h),
    () => setChat(true),
  );
  return (
    <div className="grid h-full grid-rows-[auto_1fr] bg-ink-950">
      <TopBar onChat={() => setChat(!chat)} />
      <div className="flex min-h-0">
        <LeftRail />
        <div className="map-stage relative min-h-0 min-w-0 flex-1 overflow-hidden" data-testid="map">
          <MapView />
          <div className="map-vignette pointer-events-none absolute inset-0" aria-hidden />
          <CityBanners />
          <ModeBanner />
          <HoverCard />
          <ZoomControls onHelp={() => setHelp(!help)} />
          <Notifications />
          <UnitPanel />
          <TurnControls />
          <SidePanel />
          <CityPanel />
          <Toasts />
          {help && <KeyHelp onClose={() => setHelp(false)} />}
          <ChatOverlay open={chat} onClose={() => setChat(false)} />
          <VictoryOverlay />
        </div>
      </div>
      {showReport && <Report />}
      <Curtain />
    </div>
  );
}

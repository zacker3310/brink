import { useEffect, useState } from 'react';
import type { Formation, FormationOrder, Resource } from '@brink/contracts';
import { TERRAIN, UNITS } from '@brink/game-data';
import { useCamera } from './camera';
import { CityBanners, CityPanel } from './Cities';
import { Coach } from './Coach';
import { useCoach } from './coach';
import { steps } from './counters';
import { VictoryOverlay } from './Game';
import { UnitGlyph } from './glyphs';
import { Icon } from './icons';
import { hexLabel, idleFormations, netChange, selfLedger } from './insight';
import { MapView } from './MapView';
import { useNet } from './net/room';
import { Diplomacy, Economy, Military, Overview, Research } from './Panels';
import { describeOrder, hostilesAt } from './planning';
import { useReplay } from './replay';
import { ICON, notesFor, TONE } from './Notifications';
import { nextObjective } from './objective';
import { Report } from './Report';
import { ChatOverlay, Curtain } from './RoomUi';
import { SLOT_NAMES } from './saves';
import { isMuted, setMuted } from './sfx';
import { useGame, type Tab } from './store';
import { EventCard } from './UnitPanel';
import { lossText, oddsFor, ODDS_TEXT, ROLE } from './odds';
import { signed } from './ui';

// The game on a phone: the map edge to edge, a slim status strip under the notch, and everything
// you do within reach of a thumb. Tap your units, tap where they go; enemies you can hit already say
// how the fight would go, and a second tap attacks.

const RES_NAME: Record<Resource, string> = { credits: 'funds', energy: 'energy', materials: 'materials', food: 'food' };

function Hud({ onMenu, onEconomy, onWorld }: { onMenu: () => void; onEconomy: () => void; onWorld: () => void }) {
  const view = useGame((s) => s.view)!;
  const report = useGame((s) => s.report);
  const showThreat = useGame((s) => s.showThreat);
  const toggleThreat = useGame((s) => s.toggleThreat);
  const selectStack = useGame((s) => s.selectStack);
  const focusOn = useGame((s) => s.focusOn);
  const resolving = useGame((s) => s.resolving);
  const s = view.self;
  const ledger = selfLedger(view, report);
  const net = ledger ? netChange(ledger) : null;
  const turn = Math.min(view.turn, view.maxTurns);
  const ranked = Object.values(view.nations).sort((a, b) => b.victoryPoints - a.victoryPoints);
  const rival = ranked.find((n) => n.id !== s.id)!;
  const mine = view.nations[s.id]?.victoryPoints ?? 0;
  const short = ledger?.shortages ?? [];
  const goal = nextObjective(view);
  const pct = (n: number) => `${Math.min(100, (n / view.victoryThreshold) * 100)}%`;
  return (
    <header className="safe-top safe-x pointer-events-none absolute inset-x-0 top-0 z-20 bg-gradient-to-b from-ink-950 via-ink-950/90 to-transparent pb-4" data-testid="top-bar">
      <div className="pointer-events-auto flex items-center gap-2.5 px-3 pt-1.5">
        <div className="leading-none" data-testid="turn">
          <div className="font-display text-[11px] font-bold tracking-[0.08em] text-muted uppercase">Turn</div>
          <div className="font-display text-2xl font-extrabold tabular-nums">
            {turn}
            <span className="text-base text-faint">/{view.maxTurns}</span>
          </div>
        </div>
        <div className="min-w-0 flex-1" data-testid="vp-race">
          <div className="flex items-baseline justify-between">
            <span className="font-display text-[11px] font-bold tracking-[0.08em] text-muted uppercase">Victory</span>
            <span className="font-display text-sm font-bold tabular-nums">
              <span style={{ color: s.color }}>{mine}</span>
              <span className="text-faint"> / {view.victoryThreshold}</span>
            </span>
          </div>
          <div className="relative mt-1 h-2 rounded-full bg-ink-700">
            <div className="h-full rounded-full" style={{ width: pct(mine), background: s.color }} />
            <span className="absolute -top-1 h-4 w-1 rounded-full ring-2 ring-ink-950" style={{ left: pct(rival.victoryPoints), background: rival.color }} title={`${rival.name}: ${rival.victoryPoints}`} />
          </div>
          <div className="mt-0.5 truncate text-[11px] text-faint">
            {mine >= rival.victoryPoints ? 'You lead' : `${rival.name} leads with ${rival.victoryPoints}`}
          </div>
        </div>
        <button type="button" onClick={onWorld} aria-label="World map" data-testid="world" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-line bg-ink-900/80 text-muted">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
            <circle cx="12" cy="12" r="9" />
            <path d="M3 12h18M12 3c2.8 3 2.8 15 0 18M12 3c-2.8 3-2.8 15 0 18" />
          </svg>
        </button>
        <button
          type="button"
          onClick={toggleThreat}
          aria-pressed={showThreat}
          aria-label="Show where enemies can strike"
          data-testid="threat-toggle"
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border ${showThreat ? 'border-hostile bg-hostile/25 text-hostile' : 'border-line bg-ink-900/80 text-muted'}`}
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
            <circle cx="12" cy="12" r="9" />
            <circle cx="12" cy="12" r="5" />
            <path d="M12 12L18 6" strokeLinecap="round" />
          </svg>
        </button>
        <button type="button" onClick={onMenu} aria-label="Menu" data-testid="phone-menu" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-line bg-ink-900/80 text-muted">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden>
            <circle cx="5" cy="12" r="1.8" />
            <circle cx="12" cy="12" r="1.8" />
            <circle cx="19" cy="12" r="1.8" />
          </svg>
        </button>
      </div>
      <div className="pointer-events-auto mt-2 flex items-center gap-2 px-3">
        <button type="button" onClick={onEconomy} className="flex items-center gap-2 rounded-full border border-line bg-ink-900/85 py-1 pr-3 pl-2 text-sm" data-testid="funds">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-signal text-[11px] font-bold text-ink-950">$</span>
          <span className="font-semibold tabular-nums">{s.stockpile.credits}</span>
          {net && net.credits !== 0 && <span className={`text-xs tabular-nums ${net.credits > 0 ? 'text-good' : 'text-hostile'}`}>{signed(net.credits)} last turn</span>}
          {short.length > 0 && <span className="text-xs font-semibold text-hostile">· short of {short.map((r) => RES_NAME[r]).join(', ')}</span>}
        </button>
        {goal && !resolving && (
          <button
            type="button"
            onClick={() => {
              selectStack(goal.by.key);
              focusOn(goal.site.key);
            }}
            className="flex min-w-0 flex-1 items-center gap-1.5 rounded-full border border-signal/60 bg-ink-900/85 py-1 pr-3 pl-2 text-sm"
            data-testid="goal"
          >
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-signal" aria-hidden>
              <span className="h-1.5 w-1.5 rounded-full bg-signal" />
            </span>
            <span className="truncate">
              <b className="font-semibold">Take {goal.site.name}</b> <span className="text-signal">+{goal.site.victoryPoints}</span>
              <span className="text-faint"> · {goal.distance} hex{goal.distance === 1 ? '' : 'es'}</span>
            </span>
          </button>
        )}
      </div>
    </header>
  );
}

function MenuSheet({ onClose, onHowTo }: { onClose: () => void; onHowTo: () => void }) {
  const mapStyle = useGame((s) => s.mapStyle);
  const setMapStyle = useGame((s) => s.setMapStyle);
  const save = useGame((s) => s.save);
  const exportSave = useGame((s) => s.exportSave);
  const animate = useGame((s) => s.animate);
  const setAnimate = useGame((s) => s.setAnimate);
  const toMenu = useGame((s) => s.toMenu);
  const resolving = useGame((s) => s.resolving);
  const role = useNet((n) => n.role);
  const leave = useNet((n) => n.leave);
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
      <button type="button" className={row} onClick={() => setMapStyle(mapStyle === 'atlas' ? 'satellite' : 'atlas')} data-testid="toggle-map-style">
        Map style <span className="text-signal">{mapStyle === 'atlas' ? 'Clean' : 'Satellite'}</span>
      </button>
      <button
        type="button"
        className={row}
        onClick={() => {
          onClose();
          onHowTo();
        }}
      >
        How to win
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
    <ul className="pointer-events-none absolute inset-x-3 top-[calc(env(safe-area-inset-top)+112px)] z-20 flex flex-col items-center gap-1.5" aria-live="polite">
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

/** A unit as a small counter, the same tile the map draws. */
function Chip({ cls, color, strength, done, size = 'h-9 w-9' }: { cls: Formation['unitClass']; color: string; strength: number; done?: boolean; size?: string }) {
  return (
    <span className={`relative flex shrink-0 items-center justify-center rounded-md border-2 border-white/90 ${size}`} style={{ background: color }}>
      <UnitGlyph unitClass={cls} color="#0d1114" className="h-[60%] w-[70%] -translate-y-1" />
      <span className="font-display absolute right-0.5 bottom-0 text-[11px] leading-none font-extrabold text-ink-950">{steps(strength)}</span>
      {done && (
        <span className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-friend text-ink-950">
          <Icon name="check" className="h-2.5 w-2.5" />
        </span>
      )}
    </span>
  );
}

function UnitCard() {
  const view = useGame((s) => s.view)!;
  const draft = useGame((s) => s.draft)!;
  const fid = useGame((s) => s.selectedFormation)!;
  const group = useGame((s) => s.group);
  const armed = useGame((s) => s.armed);
  const armAttack = useGame((s) => s.armAttack);
  const issueGroup = useGame((s) => s.issueGroup);
  const setOrder = useGame((s) => s.setOrder);
  const toggleGroup = useGame((s) => s.toggleGroup);
  const selectFormation = useGame((s) => s.selectFormation);
  const resolving = useGame((s) => s.resolving);
  const f = view.formations[fid];
  if (!f) return null;
  const color = view.self.color;
  const stack = Object.values(view.formations)
    .filter((x) => x.key === f.key)
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  const members = (group.length ? group : [fid]).map((id) => view.formations[id]).filter((x): x is Formation => !!x);
  const order = draft.formations[fid];
  const def = UNITS[f.unitClass];
  const anyGround = members.some((m) => UNITS[m.unitClass].ground);
  const attackers = armed?.orders ? Object.keys(armed.orders).filter((id) => armed.orders![id]!.type === 'attack').map((id) => view.formations[id]!).filter(Boolean) : [];
  const odds = armed ? oddsFor(view, attackers, armed.target) : null;
  const target = armed ? hostilesAt(view, armed.target) : [];
  const forAll = (o: FormationOrder) => issueGroup(Object.fromEntries(members.filter((m) => o.type !== 'defend' || UNITS[m.unitClass].ground).map((m) => [m.id, o])));
  const btn = 'flex h-11 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg border border-line bg-ink-850 text-[11px] font-semibold tracking-wide uppercase active:bg-ink-700 disabled:opacity-30';
  const oddsTone = odds === 'good' ? 'text-good' : odds === 'bad' ? 'text-hostile' : 'text-signal';
  return (
    <div className="pointer-events-auto rounded-t-2xl border-t border-line bg-ink-900/97 shadow-[0_-8px_24px_rgba(0,0,0,0.4)]" data-testid="unit-panel">
      {stack.length > 1 && (
        <div className="flex items-center gap-2 overflow-x-auto px-4 pt-2.5" data-testid="stack">
          <span className="font-display shrink-0 text-[11px] font-bold tracking-[0.08em] text-muted uppercase">
            {members.length} of {stack.length} moving
          </span>
          {stack.map((m) => (
            <button key={m.id} type="button" onClick={() => toggleGroup(m.id)} aria-pressed={group.includes(m.id)} aria-label={`${m.name}: ${group.includes(m.id) ? 'moving with the stack' : 'staying'}`} className={`rounded-lg p-0.5 transition-opacity ${group.includes(m.id) ? 'ring-2 ring-friend' : 'opacity-40'}`}>
              <Chip cls={m.unitClass} color={color} strength={m.strength} done={!!draft.formations[m.id]} />
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center gap-3 px-4 pt-2.5">
        <Chip cls={f.unitClass} color={color} strength={f.strength} size="h-12 w-12" />
        <div className="min-w-0 flex-1">
          <div className="font-display truncate text-lg leading-tight font-extrabold">{members.length > 1 ? `${def.name} + ${members.length - 1} more` : f.name}</div>
          <div className="truncate text-[13px] text-muted">{ROLE[f.unitClass]}</div>
        </div>
      </div>
      <div className={`mx-4 mt-2 rounded-lg bg-ink-850 px-3 py-1.5 text-[13px] leading-snug ${armed ? 'hidden' : ''}`} data-testid="planned-order">
        {order ? (
          <span className="font-semibold text-friend">{describeOrder(order, view)}</span>
        ) : (
          <span className="text-signal">{anyGround ? 'Tap a blue hex to move, or an enemy marked WIN to attack.' : 'Tap an enemy in range to strike, or your city to fly there.'}</span>
        )}
      </div>
      {armed ? (
        <div className="lock-in mx-4 mt-2 rounded-lg border-2 border-hostile bg-hostile/10 px-3 py-2.5" data-testid="armed">
          <div className="font-display text-[13px] font-extrabold tracking-[0.06em] text-hostile uppercase">
            Attack {target.length ? target.map((c) => UNITS[c.unitClass].name).join(', ') : hexLabel(view, armed.target)} with {attackers.length}
          </div>
          {odds && <div className={`font-display text-2xl font-extrabold uppercase ${oddsTone}`} data-testid="preview">{ODDS_TEXT[odds]}</div>}
          <div className="text-[13px] text-muted">{lossText(view, attackers, armed.target) ?? 'Reading the odds…'}</div>
          <div className="mt-2.5 flex gap-2">
            <button type="button" onClick={() => armAttack(null)} className="h-12 flex-1 rounded-lg border border-line bg-ink-900 text-base font-semibold" data-testid="cancel-attack">
              Cancel
            </button>
            <button type="button" onClick={() => issueGroup(armed.orders ?? { [armed.formation]: armed.order })} className="font-display h-12 flex-[2] rounded-lg bg-hostile text-lg font-extrabold tracking-wide text-white uppercase active:brightness-90" data-testid="confirm-attack">
              {attackers.every((x) => UNITS[x.unitClass].range > 0) ? 'Fire' : 'Attack'}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2 px-4 pt-2.5 pb-1">
          <button type="button" className={btn} disabled={resolving || !anyGround} onClick={() => forAll({ type: 'defend' })} data-testid="order-defend">
            <Icon name="defense" className="h-4 w-4" />
            Dig in
          </button>
          <button type="button" className={btn} disabled={resolving} onClick={() => forAll({ type: 'hold' })} data-testid="order-hold">
            <Icon name="pause" className="h-4 w-4" />
            Hold
          </button>
          <button type="button" className={btn} disabled={resolving || !members.some((m) => draft.formations[m.id])} onClick={() => members.forEach((m) => setOrder(m.id, null))} data-testid="order-clear">
            <Icon name="close" className="h-4 w-4" />
            Undo
          </button>
          <button type="button" className={btn} onClick={() => selectFormation(null)} data-testid="deselect">
            <Icon name="down" className="h-4 w-4" />
            Close
          </button>
        </div>
      )}
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
  const chip = 'shrink-0 rounded-full border border-line bg-ink-900/90 px-3 py-1.5 text-[13px] text-muted active:bg-ink-800';
  const key = 'font-display flex h-14 w-[3.6rem] shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl border border-line bg-ink-850 text-[11px] font-bold tracking-wide uppercase active:bg-ink-700 disabled:opacity-35';
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
      <div className="pointer-events-auto flex items-stretch gap-2 border-t border-line bg-ink-900/97 px-3 pt-2">
        <button type="button" className={key} onClick={onCommand} data-testid="open-command">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
            <path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" />
          </svg>
          Nation
        </button>
        {role !== 'guest' && (
          <button type="button" className={key} onClick={() => void autoCommand()} disabled={resolving || over || idle === 0} data-testid="auto-command" title="Your staff drafts orders for every unit still waiting">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden>
              <path d="M13 2L4 14h7l-1 8 9-12h-7z" />
            </svg>
            Plan
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
          className="end-turn relative flex-1 overflow-hidden rounded-xl bg-signal px-3 text-ink-950 active:brightness-90 disabled:opacity-60"
        >
          <div className="font-display text-xl leading-none font-black uppercase">{waiting ? 'Waiting…' : resolving ? 'Resolving…' : over ? 'Game over' : 'End turn'}</div>
          <div className="font-display mt-1 text-[10px] font-bold tracking-[0.06em] uppercase opacity-70">{resolving ? 'orders locked' : idle ? `${idle} without orders` : 'everyone has orders'}</div>
        </button>
      </div>
    </>
  );
}

/** The whole theatre: every nation ranked, with where you stand with it. */
function WorldCard({ onClose, onDiplomacy }: { onClose: () => void; onDiplomacy: () => void }) {
  const view = useGame((s) => s.view)!;
  const ranked = Object.values(view.nations).sort((a, b) => b.victoryPoints - a.victoryPoints);
  const cities = (id: string) => Object.values(view.sites).filter((s) => s.owner === id && (s.kind === 'city' || s.kind === 'capital')).length;
  const tag = (id: string) => (id === view.self.id ? ['You', 'bg-friend text-ink-950'] : view.relations[id] === 'war' ? ['War', 'bg-hostile text-white'] : view.relations[id] === 'alliance' ? ['Ally', 'bg-friend text-ink-950'] : ['Peace', 'bg-good text-ink-950']);
  return (
    <div className="sheet-in pointer-events-auto rounded-t-2xl border-t border-line bg-ink-900/97 px-4 pt-3" data-testid="world-card">
      <div className="flex items-baseline justify-between">
        <span className="font-display text-lg font-extrabold uppercase">The theatre</span>
        <span className="text-[12px] text-faint">{view.victoryThreshold} VP wins</span>
      </div>
      <ul className="mt-2 space-y-1.5">
        {ranked.map((n, i) => {
          const [label, tone] = tag(n.id);
          return (
            <li key={n.id} className="flex items-center gap-2.5">
              <span className="w-4 text-[13px] text-faint">{i + 1}</span>
              <span className="h-4 w-4 shrink-0 rounded" style={{ background: n.color }} />
              <span className={`min-w-0 flex-1 truncate text-[14px] ${n.id === view.self.id ? 'font-bold' : ''} ${n.eliminated ? 'text-faint line-through' : ''}`}>{n.name}</span>
              <span className="text-[12px] text-faint">{cities(n.id)} cities</span>
              <span className="w-12 text-right text-[14px] font-semibold tabular-nums">{n.victoryPoints}</span>
              <span className={`w-14 rounded-full py-0.5 text-center text-[10px] font-bold uppercase ${n.eliminated ? 'bg-ink-700 text-faint' : tone}`}>{n.eliminated ? 'Out' : label}</span>
            </li>
          );
        })}
      </ul>
      <div className="mt-3 flex gap-2 pb-1">
        <button type="button" onClick={onDiplomacy} className="h-11 flex-1 rounded-lg border border-line bg-ink-850 text-[14px] font-semibold">
          Diplomacy
        </button>
        <button type="button" onClick={onClose} className="font-display h-11 flex-[1.4] rounded-lg bg-signal text-[15px] font-extrabold text-ink-950 uppercase" data-testid="world-close">
          Back to my army
        </button>
      </div>
    </div>
  );
}

/** The whole game in three steps, at the start of a campaign and from the menu. */
function HowToWin({ onClose }: { onClose: () => void }) {
  const view = useGame((s) => s.view)!;
  const goal = nextObjective(view);
  const steps: [string, string][] = [
    ['Take places', `Cities, capitals and the gold objectives are worth victory points. Reach ${view.victoryThreshold}, or lead after turn ${view.maxTurns}, and you win.${goal ? ` Start with ${goal.site.name}: the amber ring.` : ''}`],
    ['Move and attack', 'Tap your tile, then a blue hex to move there. Enemies you can hit are tagged WIN, EVEN or RISKY: attack the WINs.'],
    ['End the turn', 'Everyone moves at once. Watch what happens, read the debrief, go again. Stuck? Tap Plan and your generals give every unit orders.'],
  ];
  return (
    <div className="fixed inset-0 z-40 flex items-end bg-ink-950/70" data-testid="how-to-win">
      <div className="sheet-in safe-bottom w-full rounded-t-2xl border-t border-line bg-ink-900 px-5 pt-5">
        <div className="font-display text-2xl font-extrabold uppercase">How to win</div>
        {view.difficulty === 'easy' && <p className="mt-1 text-[13px] text-good">Easy: you face one enemy. The others stay at peace with you.</p>}
        <ol className="mt-3 space-y-3">
          {steps.map(([title, text], i) => (
            <li key={title} className="flex gap-3">
              <span className="font-display flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-signal text-lg font-extrabold text-ink-950">{i + 1}</span>
              <div>
                <div className="font-display text-base font-bold uppercase">{title}</div>
                <p className="text-[14px] leading-snug text-muted">{text}</p>
              </div>
            </li>
          ))}
        </ol>
        <button type="button" onClick={onClose} className="font-display mt-4 mb-1 h-12 w-full rounded-xl bg-signal text-lg font-extrabold text-ink-950 uppercase" data-testid="how-to-close">
          Got it
        </button>
      </div>
    </div>
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
  const [world, setWorld] = useState(false);
  const firstTurn = useGame((s) => s.view?.turn === 1 && !s.view.victory);
  const [howTo, setHowTo] = useState(firstTurn && !useCoach.getState().active);
  const control = useCamera((s) => s.control);
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
        <div className="resolving-banner pointer-events-none absolute top-[calc(env(safe-area-inset-top)+112px)] left-1/2 z-10 -translate-x-1/2 overflow-hidden border border-signal/70 bg-ink-950/90 px-4 py-2 text-center" role="status">
          <div className="font-display text-[10px] font-bold tracking-[0.1em] text-signal uppercase">Orders locked</div>
          <div className="text-sm font-semibold">The world moves…</div>
        </div>
      )}
      <Hud
        onMenu={() => setMenu(true)}
        onEconomy={() => {
          useGame.getState().setTab('economy');
          setCommand(true);
        }}
        onWorld={() => {
          useGame.getState().selectFormation(null);
          control?.fit();
          setWorld(true);
        }}
      />
      <Toasts />
      <div className="safe-bottom safe-x pointer-events-none absolute inset-x-0 bottom-0 z-10 flex flex-col">
        {playback ? (
          <ReplayDock />
        ) : world ? (
          <WorldCard
            onClose={() => {
              control?.home();
              setWorld(false);
            }}
            onDiplomacy={() => {
              useGame.getState().setTab('diplomacy');
              setCommand(true);
            }}
          />
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
      {menu && <MenuSheet onClose={() => setMenu(false)} onHowTo={() => setHowTo(true)} />}
      {howTo && <HowToWin onClose={() => setHowTo(false)} />}
      <ChatOverlay open={chat} onClose={() => setChat(false)} />
      <VictoryOverlay />
      {showReport && <Report />}
      <Coach />
      <Curtain />
    </div>
  );
}

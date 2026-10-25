import { useEffect, useState } from 'react';
import type { FormationOrder } from '@brink/contracts';
import { GOVERNMENTS, TERRAIN, UNITS } from '@brink/game-data';
import type { AssaultPreview, StrikePreview } from '@brink/simulation';
import { engine } from './engine';
import { MapView } from './MapView';
import { Diplomacy, Economy, Military, Overview, Research } from './Panels';
import { describeOrder, hostilesAt, type Mode } from './planning';
import { Report } from './Report';
import { SLOT_NAMES } from './saves';
import { useGame, type Tab } from './store';
import { Button, Meter, Panel, Stat, Swatch } from './ui';

function TopBar() {
  const view = useGame((s) => s.view)!;
  const toMenu = useGame((s) => s.toMenu);
  const save = useGame((s) => s.save);
  const [saving, setSaving] = useState(false);
  const s = view.self;
  const items: [string, number][] = [
    ['Treasury', s.stockpile.credits],
    ['Energy', s.stockpile.energy],
    ['Materials', s.stockpile.materials],
    ['Food', s.stockpile.food],
    ['Industry', s.industrialCapacity],
    ['Research', s.researchOutput],
  ];
  return (
    <header className="flex items-center gap-5 border-b border-line bg-ink-900 px-4 py-2" data-testid="top-bar">
      <div className="border-r border-line pr-4 text-sm font-black tracking-[0.24em] text-signal" aria-label="Brink">
        BRINK
      </div>
      <div className="flex items-center gap-2">
        <Swatch color={s.color} />
        <div>
          <div className="text-sm leading-tight font-semibold">{s.name}</div>
          <div className="text-[11px] leading-tight text-muted">{GOVERNMENTS[s.government].name}</div>
        </div>
      </div>
      <dl className="flex flex-wrap gap-x-5 gap-y-1">
        {items.map(([label, v]) => (
          <div key={label} className="leading-tight">
            <dt className="text-[10px] tracking-[0.12em] text-faint uppercase">{label}</dt>
            <dd className="font-mono text-sm tabular-nums">{v}</dd>
          </div>
        ))}
        <div className="leading-tight">
          <dt className="text-[10px] tracking-[0.12em] text-faint uppercase">Stability</dt>
          <dd className={`font-mono text-sm tabular-nums ${s.stability < 40 ? 'text-hostile' : ''}`}>{s.stability}</dd>
        </div>
      </dl>
      <div className="ml-auto flex items-center gap-3">
        <div className="text-right leading-tight" data-testid="turn">
          <div className="text-[10px] tracking-[0.12em] text-faint uppercase">Turn</div>
          <div className="font-mono text-sm">
            {Math.min(view.turn, view.maxTurns)} / {view.maxTurns}
          </div>
        </div>
        <div className="relative">
          <Button onClick={() => setSaving(!saving)} testId="save-menu">
            Save
          </Button>
          {saving && (
            <div className="absolute right-0 z-20 mt-1 w-40 rounded-sm border border-line bg-ink-850 p-1 shadow-xl" role="menu">
              {SLOT_NAMES.map((slot) => (
                <button
                  key={slot}
                  type="button"
                  role="menuitem"
                  data-testid={`save-${slot.replace(' ', '-').toLowerCase()}`}
                  className="block w-full rounded-sm px-2 py-1 text-left text-xs hover:bg-ink-700"
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
        <Button onClick={toMenu}>Menu</Button>
      </div>
    </header>
  );
}

const TABS: [Tab, string][] = [
  ['overview', 'Overview'],
  ['military', 'Military'],
  ['economy', 'Economy'],
  ['research', 'Research'],
  ['diplomacy', 'Diplomacy'],
];

function LeftNav() {
  const tab = useGame((s) => s.tab);
  const setTab = useGame((s) => s.setTab);
  return (
    <nav className="flex flex-col border-r border-line bg-ink-900" aria-label="Command">
      {TABS.map(([id, label]) => (
        <button
          key={id}
          type="button"
          data-testid={`tab-${id}`}
          onClick={() => setTab(id)}
          aria-current={tab === id ? 'page' : undefined}
          className={`border-l-2 px-3 py-3 text-left text-xs font-medium ${tab === id ? 'border-signal bg-ink-800 text-text' : 'border-transparent text-muted hover:bg-ink-850 hover:text-text'}`}
        >
          {label}
        </button>
      ))}
    </nav>
  );
}

function SidePanel() {
  const tab = useGame((s) => s.tab);
  return (
    <aside className="min-h-0 overflow-y-auto border-r border-line bg-ink-900">
      {tab === 'overview' && <Overview />}
      {tab === 'military' && <Military />}
      {tab === 'economy' && <Economy />}
      {tab === 'research' && <Research />}
      {tab === 'diplomacy' && <Diplomacy />}
    </aside>
  );
}

function Inspector() {
  const view = useGame((s) => s.view)!;
  const key = useGame((s) => s.selectedHex);
  const selectFormation = useGame((s) => s.selectFormation);
  const selected = useGame((s) => s.selectedFormation);
  if (!key) {
    return (
      <aside className="min-h-0 overflow-y-auto border-l border-line bg-ink-900 p-3 text-xs text-muted">
        Select a hex, a city or a formation. Drag to pan, scroll to zoom, right-click to deselect.
      </aside>
    );
  }
  const t = view.tiles[key]!;
  const site = t.siteId ? view.sites[t.siteId] : undefined;
  const own = Object.values(view.formations).filter((f) => f.key === key);
  const contacts = Object.values(view.contacts).filter((c) => c.key === key);
  return (
    <aside className="min-h-0 overflow-y-auto border-l border-line bg-ink-900" data-testid="inspector">
      <Panel title={`Hex ${key}`}>
        <Stat label="Terrain" value={t.terrain ? TERRAIN[t.terrain].name : 'Unknown'} />
        {t.terrain && <Stat label="Defense" value={`+${TERRAIN[t.terrain].defense}%`} />}
        {t.river && <Stat label="River" value="yes" />}
        <Stat label="Roads" value={t.infrastructure} />
        <Stat label="Owner" value={t.owner ? view.nations[t.owner]?.name : 'none'} />
        <Stat label="Visibility" value={t.visibility === 'observed' ? `last seen turn ${t.lastObserved}` : t.visibility} />
      </Panel>
      {site && (
        <Panel title={site.kind}>
          <div className="text-sm font-semibold">{site.name}</div>
          <Stat label="Held by" value={site.owner ? view.nations[site.owner]?.name : 'nobody'} />
          <Stat label="Victory points" value={site.victoryPoints} />
          <Stat label="Population" value={`${site.population}k`} />
          <Stat label="Yields" value={`${site.yields.credits} cr · ${site.yields.industry} ind`} />
        </Panel>
      )}
      {own.map((f) => (
        <Panel key={f.id} title={UNITS[f.unitClass].name}>
          <button type="button" className={`text-left text-sm font-semibold ${selected === f.id ? 'text-signal' : 'hover:text-signal'}`} onClick={() => selectFormation(f.id)}>
            {f.name}
          </button>
          {(
            [
              ['Strength', f.strength, 1000],
              ['Organization', f.organization, 100],
              ['Morale', f.morale, 100],
              ['Readiness', f.readiness, 100],
              ['Supply', f.supply, 100],
              ['Fuel', f.fuel, 100],
              ['Ammunition', f.ammunition, 100],
            ] as const
          ).map(([label, v, max]) => (
            <div key={label} className="mt-1">
              <Stat label={label} value={v} />
              <Meter value={v} max={max} tone={v / max < 0.35 ? 'bad' : 'good'} />
            </div>
          ))}
          <Stat label="Experience" value={f.experience} />
          <Stat label="Entrenchment" value={f.entrenchment} />
          <Stat label="Last order" value={f.lastOrder} />
        </Panel>
      ))}
      {contacts.map((c) => (
        <Panel key={c.formation} title={c.confirmed ? 'Enemy contact' : 'Last known contact'}>
          <div className="flex items-center gap-2 text-sm">
            <Swatch color={view.nations[c.owner]?.color ?? '#888'} />
            {view.nations[c.owner]?.name} {UNITS[c.unitClass].name}
          </div>
          <Stat label="Strength (est.)" value={`~${c.estimatedStrength}`} />
          <Stat label="Seen" value={c.confirmed ? 'now' : `turn ${c.lastSeen}`} />
          <Stat label="Relation" value={view.relations[c.owner]} />
        </Panel>
      ))}
    </aside>
  );
}

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

const OUTCOME: Record<string, string> = { attacker_victory: 'breakthrough', inconclusive: 'stalemate', defender_held: 'repulsed' };

function BottomBar() {
  const view = useGame((s) => s.view)!;
  const draft = useGame((s) => s.draft)!;
  const fid = useGame((s) => s.selectedFormation);
  const mode = useGame((s) => s.mode);
  const setMode = useGame((s) => s.setMode);
  const setOrder = useGame((s) => s.setOrder);
  const setPriority = useGame((s) => s.setPriority);
  const submit = useGame((s) => s.submit);
  const resolving = useGame((s) => s.resolving);
  const rejected = useGame((s) => s.rejected);
  const notices = useGame((s) => s.notices);
  const report = useGame((s) => s.report);
  const setShowReport = useGame((s) => s.setShowReport);
  const f = fid ? view.formations[fid] : undefined;
  const order = fid ? draft.formations[fid] : undefined;
  const preview = usePreview(order, fid);
  const planned = Object.keys(draft.formations).length;
  const over = view.victory !== null;
  const modes: [Mode, string][] = [
    ['move', 'Move'],
    ['attack', 'Attack'],
    ['recon', 'Recon'],
    ['withdraw', 'Withdraw'],
  ];
  return (
    <footer className="grid grid-cols-[1fr_auto] gap-4 border-t border-line bg-ink-900 px-4 py-2.5">
      <div className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-2">
        {f ? (
          <>
            <div className="min-w-44">
              <div className="text-sm font-semibold">{f.name}</div>
              <div className="text-[11px] text-muted" data-testid="planned-order">
                <span className="mr-1 inline-block rounded-[2px] bg-signal/15 px-1 text-signal">planned</span>
                {describeOrder(order)}
              </div>
            </div>
            <div className="flex flex-wrap gap-1" role="toolbar" aria-label="Orders">
              <Button onClick={() => setOrder(f.id, { type: 'hold' })} active={order?.type === 'hold'} testId="order-hold" disabled={resolving}>
                Hold
              </Button>
              <Button onClick={() => setOrder(f.id, { type: 'defend' })} active={order?.type === 'defend'} testId="order-defend" disabled={resolving || !UNITS[f.unitClass].ground}>
                Defend
              </Button>
              {modes.map(([m, label]) => (
                <Button key={m} onClick={() => setMode(m)} active={mode === m} testId={`mode-${m}`} disabled={resolving} title={`Click the map to ${label.toLowerCase()}`}>
                  {label}
                </Button>
              ))}
              {order && (
                <Button onClick={() => setOrder(f.id, null)} disabled={resolving}>
                  Clear
                </Button>
              )}
            </div>
            <label className="text-[11px] text-muted">
              Supply
              <select
                className="ml-1 rounded-sm border border-line bg-ink-850 px-1 py-0.5 text-text"
                value={draft.supplyPriority?.[f.id] ?? f.supplyPriority}
                onChange={(e) => setPriority(f.id, e.target.value as 'high' | 'normal' | 'low')}
              >
                <option value="high">high</option>
                <option value="normal">normal</option>
                <option value="low">low</option>
              </select>
            </label>
            {preview?.assault && (
              <div className="text-[11px]" data-testid="preview">
                <span className="text-muted">Estimate ({preview.assault.confidence}): </span>
                {preview.assault.defenders === 0 ? (
                  <span>no enemy seen there; you will try to take the hex</span>
                ) : (
                  <span>
                    you lose {preview.assault.attackerLoss[0]}-{preview.assault.attackerLoss[1]}, they lose {preview.assault.defenderLoss[0]}-
                    {preview.assault.defenderLoss[1]}; likely {preview.assault.outcomes.map((o) => OUTCOME[o]).join(' or ')}
                  </span>
                )}
              </div>
            )}
            {preview?.strike && (
              <div className="text-[11px]" data-testid="preview">
                <span className="text-muted">Estimate ({preview.strike.confidence}): </span>
                {preview.strike.targets === 0 ? 'no confirmed targets' : `${preview.strike.targets} target(s), ${preview.strike.loss[0]}-${preview.strike.loss[1]} strength each`}
              </div>
            )}
            {order?.type === 'attack' && hostilesAt(view, order.target).length === 0 && !preview && <span className="text-[11px] text-faint">No contact at target</span>}
          </>
        ) : (
          <span className="text-xs text-muted">Select a formation on the map or in Military to give it orders.</span>
        )}
        {rejected.length > 0 && (
          <ul className="w-full text-[11px] text-hostile" data-testid="rejections">
            {rejected.slice(0, 3).map((e, i) => (
              <li key={i}>{e.kind === 'order_rejected' ? `${e.formation ? `${view.formations[e.formation]?.name ?? e.formation}: ` : ''}${e.reason}` : ''}</li>
            ))}
          </ul>
        )}
        <ul className="w-full space-y-0.5" aria-live="polite">
          {notices.map((n) => (
            <li key={n.id} className={`text-[11px] ${n.tone === 'error' ? 'text-hostile' : n.tone === 'warn' ? 'text-signal' : 'text-muted'}`}>
              {n.text}
            </li>
          ))}
        </ul>
      </div>
      <div className="flex items-center gap-2">
        {report && (
          <Button onClick={() => setShowReport(true)} testId="open-report">
            Turn {report.turn} report
          </Button>
        )}
        <div className="text-right text-[11px] text-muted">
          {planned} order{planned === 1 ? '' : 's'} planned
          {draft.recruit.length > 0 && `, ${draft.recruit.length} recruit`}
        </div>
        <Button tone="primary" onClick={() => void submit()} disabled={resolving || over} testId="end-turn">
          {resolving ? 'Resolving…' : over ? 'Match over' : 'Lock orders & end turn'}
        </Button>
      </div>
    </footer>
  );
}

function VictoryBanner() {
  const view = useGame((s) => s.view)!;
  const toMenu = useGame((s) => s.toMenu);
  if (!view.victory) return null;
  const winner = view.nations[view.victory.winner]!;
  const reason = { victory_points: 'by holding the victory-point threshold', last_standing: 'as the last nation standing', turn_limit: 'by leading at the turn limit' }[view.victory.reason];
  const won = winner.id === view.self.id;
  return (
    <div className="absolute inset-x-0 top-4 z-10 mx-auto w-fit rounded-sm border border-signal bg-ink-850/95 px-5 py-3 text-center shadow-2xl" data-testid="victory" role="status">
      <div className={`text-lg font-bold ${won ? 'text-friendly' : 'text-hostile'}`}>{won ? 'Victory' : 'Defeat'}</div>
      <div className="text-sm">
        {winner.name} wins {reason} on turn {view.victory.turn}.
      </div>
      <div className="mt-2">
        <Button onClick={toMenu}>Back to menu</Button>
      </div>
    </div>
  );
}

export function Game() {
  const showReport = useGame((s) => s.showReport);
  return (
    <div className="grid h-full grid-rows-[auto_1fr_auto]">
      <TopBar />
      <div className="grid min-h-0 grid-cols-[96px_300px_1fr_280px]">
        <LeftNav />
        <SidePanel />
        <div className="relative min-h-0 overflow-hidden" data-testid="map">
          <MapView />
          <VictoryBanner />
          <Legend />
        </div>
        <Inspector />
      </div>
      <BottomBar />
      {showReport && <Report />}
    </div>
  );
}

function Legend() {
  return (
    <div className="pointer-events-none absolute bottom-2 left-2 rounded-sm border border-line bg-ink-900/85 px-2 py-1 text-[10px] text-muted">
      <span className="text-signal">amber</span> planned · <span className="text-text">white</span> submitted · <span className="text-hostile">red ✕</span> last turn's
      fighting · faded marker = last known position
    </div>
  );
}


import { useState } from 'react';
import type { DiplomaticAction, Ledger, UnitClass } from '@brink/contracts';
import { RESOURCES, UNIT_CLASSES } from '@brink/contracts';
import { TECH_IDS, TECHS, UNITS } from '@brink/game-data';
import { checkResearchView, recruitCostFor } from './rules-view';
import { describeOrder } from './planning';
import { useGame } from './store';
import { Button, costText, Meter, Panel, Stat, Swatch } from './ui';

function lastLedger(): Ledger | null {
  const { report, view } = useGame.getState();
  const e = report?.events.find((x) => x.kind === 'economy' && x.nation === view?.self.id);
  return e?.kind === 'economy' ? e.ledger : null;
}

export function Overview() {
  const view = useGame((s) => s.view)!;
  const focusOn = useGame((s) => s.focusOn);
  const ranked = Object.values(view.nations).sort((a, b) => b.victoryPoints - a.victoryPoints || (a.id < b.id ? -1 : 1));
  const objectives = view.self.objectives.map((id) => view.sites[id]).filter((s) => s !== undefined);
  return (
    <>
      <Panel title="Victory progress">
        <p className="mb-2 text-xs text-muted">
          {view.victoryThreshold} of {view.totalVictoryPoints} VP wins outright. Turn {Math.min(view.turn, view.maxTurns)} of {view.maxTurns}.
        </p>
        <ul className="space-y-2" data-testid="standings">
          {ranked.map((n) => (
            <li key={n.id}>
              <div className="mb-0.5 flex items-center gap-2 text-xs">
                <Swatch color={n.color} />
                <span className={n.id === view.self.id ? 'font-semibold' : ''}>{n.name}</span>
                {n.eliminated && <span className="text-hostile">eliminated</span>}
                <span className="ml-auto font-mono tabular-nums">{n.victoryPoints} VP</span>
              </div>
              <Meter value={n.victoryPoints} max={view.victoryThreshold} tone={n.id === view.self.id ? 'good' : 'neutral'} />
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title="Strategic objectives">
        <ul className="space-y-1">
          {objectives.map((s) => (
            <li key={s.id}>
              <button type="button" className="flex w-full items-center justify-between text-left text-xs hover:text-signal" onClick={() => focusOn(s.key)}>
                <span>{s.name}</span>
                <span className="text-faint">{s.owner ? view.nations[s.owner]?.name : 'unheld'} · {s.victoryPoints} VP</span>
              </button>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title="Nation">
        <Stat label="Population" value={`${(view.self.population / 1000).toFixed(1)}M`} />
        <Stat label="Stability" value={view.self.stability} />
        <Meter value={view.self.stability} tone={view.self.stability < 40 ? 'bad' : 'good'} />
        <Stat label="War losses" value={view.self.warLosses} />
      </Panel>
    </>
  );
}

export function Military() {
  const view = useGame((s) => s.view)!;
  const draft = useGame((s) => s.draft)!;
  const selected = useGame((s) => s.selectedFormation);
  const selectFormation = useGame((s) => s.selectFormation);
  const focusOn = useGame((s) => s.focusOn);
  const addRecruit = useGame((s) => s.addRecruit);
  const removeRecruit = useGame((s) => s.removeRecruit);
  const sites = Object.values(view.sites).filter((s) => s.owner === view.self.id && (s.kind === 'capital' || s.kind === 'city'));
  const [site, setSite] = useState(sites[0]?.id ?? '');
  const [cls, setCls] = useState<UnitClass>('infantry');
  const formations = Object.values(view.formations).sort((a, b) => (a.id < b.id ? -1 : 1));
  const cost = recruitCostFor(view, cls);
  const reserved = draft.recruit.reduce(
    (acc, r) => {
      const c = recruitCostFor(view, r.unitClass);
      for (const res of RESOURCES) acc[res] += c[res];
      return acc;
    },
    { credits: 0, energy: 0, materials: 0, food: 0 },
  );
  const affordable = RESOURCES.every((r) => reserved[r] + cost[r] <= view.self.stockpile[r]);
  return (
    <>
      <Panel title={`Formations (${formations.length})`}>
        <ul className="space-y-1" data-testid="formation-list">
          {formations.map((f) => (
            <li key={f.id}>
              <button
                type="button"
                data-testid={`formation-${f.id}`}
                onClick={() => {
                  selectFormation(f.id);
                  focusOn(f.key);
                }}
                className={`w-full rounded-sm border px-2 py-1.5 text-left text-xs ${selected === f.id ? 'border-signal bg-ink-800' : 'border-transparent hover:border-line hover:bg-ink-850'}`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{f.name}</span>
                  <span className="font-mono text-faint">{UNITS[f.unitClass].short}</span>
                </div>
                <div className="mt-1 grid grid-cols-[1fr_auto] items-center gap-2">
                  <Meter value={f.strength} max={1000} tone={f.strength < 400 ? 'bad' : 'good'} />
                  <span className={`text-[11px] ${draft.formations[f.id] ? 'text-signal' : 'text-faint'}`}>{describeOrder(draft.formations[f.id])}</span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title="Recruit">
        {sites.length === 0 ? (
          <p className="text-xs text-muted">No city under your control can recruit.</p>
        ) : (
          <div className="space-y-2 text-xs">
            <label className="flex items-center justify-between gap-2">
              <span className="text-muted">Site</span>
              <select className="rounded-sm border border-line bg-ink-850 px-1 py-0.5" value={site} onChange={(e) => setSite(e.target.value)}>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center justify-between gap-2">
              <span className="text-muted">Class</span>
              <select className="rounded-sm border border-line bg-ink-850 px-1 py-0.5" value={cls} onChange={(e) => setCls(e.target.value as UnitClass)} data-testid="recruit-class">
                {UNIT_CLASSES.map((c) => (
                  <option key={c} value={c}>
                    {UNITS[c].name}
                  </option>
                ))}
              </select>
            </label>
            <p className="text-faint">
              {costText(cost)} · {UNITS[cls].industry} industry
            </p>
            <Button onClick={() => addRecruit(site, cls)} disabled={!affordable || !site} testId="recruit">
              Queue {UNITS[cls].name}
            </Button>
            {draft.recruit.length > 0 && (
              <ul className="space-y-1 border-t border-line pt-2">
                {draft.recruit.map((r, i) => (
                  <li key={r.siteId} className="flex items-center justify-between">
                    <span className="text-signal">
                      {UNITS[r.unitClass].name} at {view.sites[r.siteId]?.name}
                    </span>
                    <button type="button" className="text-faint hover:text-hostile" onClick={() => removeRecruit(i)} aria-label="Remove">
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Panel>
      <Panel title="In production">
        {view.self.productionQueue.length === 0 ? (
          <p className="text-xs text-faint">Nothing queued.</p>
        ) : (
          <ul className="space-y-2 text-xs">
            {view.self.productionQueue.map((p) => (
              <li key={p.id}>
                <div className="flex justify-between">
                  <span>{UNITS[p.unitClass].name}</span>
                  <span className="text-faint">{view.sites[p.siteId]?.name}</span>
                </div>
                <Meter value={p.progress} max={p.required} />
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-[11px] text-faint">Industrial capacity: {view.self.industrialCapacity} per turn</p>
      </Panel>
    </>
  );
}

export function Economy() {
  const view = useGame((s) => s.view)!;
  const draft = useGame((s) => s.draft)!;
  const setBudget = useGame((s) => s.setBudget);
  const budget = draft.budget ?? view.self.budget;
  const ledger = lastLedger();
  const total = budget.research + budget.infrastructure + budget.welfare;
  const slider = (key: keyof typeof budget, label: string, help: string) => (
    <label className="block text-xs">
      <div className="flex justify-between">
        <span>{label}</span>
        <span className="font-mono">{budget[key]}%</span>
      </div>
      <input
        type="range"
        min={0}
        max={50}
        step={5}
        value={budget[key]}
        className="w-full accent-[#e0a84a]"
        onChange={(e) => {
          const next = { ...budget, [key]: Number(e.target.value) };
          if (next.research + next.infrastructure + next.welfare <= 60) setBudget(next);
        }}
      />
      <span className="text-[11px] text-faint">{help}</span>
    </label>
  );
  return (
    <>
      <Panel title="Stockpiles">
        {RESOURCES.map((r) => (
          <Stat key={r} label={r[0]!.toUpperCase() + r.slice(1)} value={view.self.stockpile[r]} />
        ))}
        <Stat label="Industrial capacity" value={view.self.industrialCapacity} sub="/turn" />
        <Stat label="Research output" value={view.self.researchOutput} sub="/turn" />
      </Panel>
      <Panel title="Budget (share of credit income)">
        <div className="space-y-3">
          {slider('research', 'Research', 'Half of every credit becomes a research point.')}
          {slider('infrastructure', 'Logistics', 'Each percent adds a percent of supply capacity.')}
          {slider('welfare', 'Welfare', 'Raises stability; low stability cuts output.')}
          <p className="text-[11px] text-faint">{total}% of 60% allowed</p>
        </div>
      </Panel>
      {ledger && (
        <Panel title="Last turn ledger">
          <table className="w-full text-[11px]">
            <thead className="text-faint">
              <tr>
                <th className="text-left font-normal" />
                {RESOURCES.map((r) => (
                  <th key={r} className="text-right font-normal">
                    {r.slice(0, 3)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="font-mono tabular-nums">
              {(['income', 'upkeep', 'production', 'logistics', 'spending'] as const).map((row) => (
                <tr key={row}>
                  <td className="text-muted">{row}</td>
                  {RESOURCES.map((r) => (
                    <td key={r} className={`text-right ${row === 'income' ? 'text-friendly' : ''}`}>
                      {row === 'income' ? '+' : '-'}
                      {ledger[row][r]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {ledger.shortages.length > 0 && <p className="mt-2 text-xs text-hostile">Shortage: {ledger.shortages.join(', ')}</p>}
        </Panel>
      )}
    </>
  );
}

export function Research() {
  const view = useGame((s) => s.view)!;
  const draft = useGame((s) => s.draft)!;
  const setResearch = useGame((s) => s.setResearch);
  const current = draft.research !== undefined ? draft.research : view.self.research.current;
  return (
    <Panel title="Technology">
      <p className="mb-2 text-xs text-muted">
        {view.self.researchOutput} points per turn · {view.self.research.progress} banked
      </p>
      <ul className="space-y-1.5">
        {TECH_IDS.map((id) => {
          const t = TECHS[id]!;
          const done = view.self.research.unlocked.includes(id);
          const why = checkResearchView(view, id);
          return (
            <li key={id} className={`rounded-sm border p-2 text-xs ${current === id ? 'border-signal bg-ink-800' : 'border-line bg-ink-850'}`}>
              <div className="flex justify-between">
                <span className="font-medium">{t.name}</span>
                <span className="font-mono text-faint">{t.cost}</span>
              </div>
              <p className="text-[11px] text-muted">{t.summary}</p>
              {t.requires.length > 0 && <p className="text-[11px] text-faint">Requires {t.requires.map((r) => TECHS[r]?.name).join(', ')}</p>}
              <div className="mt-1">
                {done ? (
                  <span className="text-friendly">Researched</span>
                ) : current === id ? (
                  <Button onClick={() => setResearch(null)}>Stop</Button>
                ) : (
                  <Button onClick={() => setResearch(id)} disabled={!!why} title={why ?? undefined}>
                    Research
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

export function Diplomacy() {
  const view = useGame((s) => s.view)!;
  const draft = useGame((s) => s.draft)!;
  const setDiplomacy = useGame((s) => s.setDiplomacy);
  const others = Object.values(view.nations).filter((n) => n.id !== view.self.id);
  const planned = (id: string) => draft.diplomacy.find((d) => d.target === id)?.action ?? null;
  const toggle = (id: string, action: DiplomaticAction) => setDiplomacy(id, planned(id) === action ? null : action);
  return (
    <Panel title="Relations">
      <ul className="space-y-2">
        {others.map((n) => {
          const rel = view.relations[n.id];
          const incoming = view.proposals.find((p) => p.from === n.id && p.to === view.self.id);
          const outgoing = view.proposals.find((p) => p.from === view.self.id && p.to === n.id);
          return (
            <li key={n.id} className="rounded-sm border border-line bg-ink-850 p-2 text-xs">
              <div className="flex items-center gap-2">
                <Swatch color={n.color} />
                <span className="font-medium">{n.name}</span>
                <span className={`ml-auto uppercase ${rel === 'war' ? 'text-hostile' : rel === 'alliance' ? 'text-friendly' : 'text-muted'}`}>{rel}</span>
              </div>
              {n.eliminated ? (
                <p className="mt-1 text-faint">Eliminated</p>
              ) : (
                <>
                  {incoming && <p className="mt-1 text-signal">They propose {incoming.kind}. Propose it back to accept.</p>}
                  {outgoing && <p className="mt-1 text-faint">Your {outgoing.kind} proposal is pending.</p>}
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {rel === 'war' && (
                      <Button active={planned(n.id) === 'propose_peace'} onClick={() => toggle(n.id, 'propose_peace')}>
                        Propose peace
                      </Button>
                    )}
                    {rel === 'peace' && (
                      <Button active={planned(n.id) === 'propose_alliance'} onClick={() => toggle(n.id, 'propose_alliance')}>
                        Propose alliance
                      </Button>
                    )}
                    {rel !== 'war' && (
                      <Button tone="danger" active={planned(n.id) === 'declare_war'} onClick={() => toggle(n.id, 'declare_war')}>
                        Declare war
                      </Button>
                    )}
                  </div>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

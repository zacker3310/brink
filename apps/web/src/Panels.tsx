import { useState, type ReactNode } from 'react';
import type { DiplomaticAction, UnitClass } from '@brink/contracts';
import { RESOURCES, UNIT_CLASSES } from '@brink/contracts';
import { GOVERNMENTS, RULES, TECH_IDS, TECHS, UNITS } from '@brink/game-data';
import { Label } from './chrome';
import { Emblem, UnitGlyph } from './glyphs';
import { hexLabel, idleFormations, netChange, selfLedger } from './insight';
import { checkResearchView, recommendedTech, recruitCostFor, researchPerTurn } from './rules-view';
import { describeOrder } from './planning';
import { useGame } from './store';
import { Button, costText, Meter, Stat, Swatch } from './ui';
import { Icon } from './icons';
import { ABILITIES, type AbilityId } from '@brink/arena';

function Section({ title, children, right }: { title: ReactNode; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="border-b border-line px-3 py-3">
      <header className="mb-2.5 flex items-center justify-between gap-2">
        <Label>{title}</Label>
        {right}
      </header>
      {children}
    </section>
  );
}

export function Overview() {
  const view = useGame((s) => s.view)!;
  const draft = useGame((s) => s.draft)!;
  const focusOn = useGame((s) => s.focusOn);
  const nextIdle = useGame((s) => s.nextIdle);
  const ranked = Object.values(view.nations).sort((a, b) => b.victoryPoints - a.victoryPoints || (a.id < b.id ? -1 : 1));
  const objectives = view.self.objectives.map((id) => view.sites[id]).filter((s) => s !== undefined);
  const idle = idleFormations(view, draft.formations).length;
  const atWar = Object.entries(view.relations).filter(([, r]) => r === 'war').length;
  const threshold = view.victoryThreshold;
  const scale = Math.max(threshold, ...ranked.map((n) => n.victoryPoints)) * 1.08;
  return (
    <>
      <Section title="Situation">
        <div className="grid grid-cols-3 gap-1.5 text-center">
          {(
            [
              ['Formations', Object.keys(view.formations).length, ''],
              ['Idle', idle, idle ? 'text-signal' : 'text-good'],
              ['At war', atWar, atWar ? 'text-hostile' : ''],
            ] as const
          ).map(([l, v, tone]) => (
            <div key={l} className="border border-line/70 bg-ink-850 py-1.5">
              <div className={`font-mono text-lg leading-tight font-semibold ${tone}`}>{v}</div>
              <div className="font-display text-[9px] tracking-[0.06em] text-faint uppercase">{l}</div>
            </div>
          ))}
        </div>
        {idle > 0 && (
          <button type="button" onClick={nextIdle} className="mt-2 w-full border border-signal/50 bg-signal/10 py-1.5 text-xs font-semibold text-signal hover:bg-signal/20">
            Order idle formations <Icon name="next" className="h-3 w-3 align-[-2px]" />
          </button>
        )}
      </Section>
      <Section title="Victory race" right={<span className="text-[10px] text-faint">{threshold} VP wins</span>}>
        <ul className="space-y-2" data-testid="standings">
          {ranked.map((n, i) => (
            <li key={n.id}>
              <div className="mb-1 flex items-center gap-2 text-xs">
                <span className="w-3 font-mono text-[10px] text-faint">{i + 1}</span>
                <Emblem color={n.color} government={n.government} className="h-4 w-4" />
                <span className={n.id === view.self.id ? 'font-bold' : ''}>{n.name}</span>
                {n.eliminated && <span className="text-[10px] text-hostile uppercase">out</span>}
                {n.id !== view.self.id && !n.eliminated && (
                  <span className={`text-[9px] uppercase ${view.relations[n.id] === 'war' ? 'text-hostile' : view.relations[n.id] === 'alliance' ? 'text-good' : 'text-faint'}`}>{view.relations[n.id]}</span>
                )}
                <span className="ml-auto font-mono tabular-nums">{n.victoryPoints}</span>
              </div>
              <div className="relative h-1.5 bg-ink-700">
                <div className="h-full" style={{ width: `${(n.victoryPoints / scale) * 100}%`, background: n.color, opacity: n.eliminated ? 0.3 : 1 }} />
                <div className="absolute -top-0.5 -bottom-0.5 w-px bg-text/70" style={{ left: `${(threshold / scale) * 100}%` }} aria-hidden />
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[10px] text-faint">
          {view.totalVictoryPoints} VP on the map. Turn {Math.min(view.turn, view.maxTurns)} of {view.maxTurns}; the leader at the limit wins.
        </p>
      </Section>
      <Section title="Strategic objectives">
        <ul className="space-y-1">
          {objectives.map((s) => {
            const owner = s.owner ? view.nations[s.owner] : undefined;
            return (
              <li key={s.id}>
                <button type="button" className="flex w-full items-center gap-2 border border-line/60 bg-ink-850 px-2 py-1.5 text-left text-xs hover:border-signal/60" onClick={() => focusOn(s.key)}>
                  <Icon name="objective" className="h-3 w-3 text-signal" />
                  <span className="font-semibold">{s.name}</span>
                  <span className="ml-auto flex items-center gap-1.5 text-[10px] text-muted">
                    {owner ? <Swatch color={owner.color} /> : null}
                    {owner ? owner.name.split(' ')[0] : 'unheld'} · {s.victoryPoints} VP
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </Section>
      <Section title="Home front">
        <Stat label="Government" value={GOVERNMENTS[view.self.government].name} />
        <Stat label="Population" value={`${(view.self.population / 1000).toFixed(1)}M`} />
        <Stat label="Stability" value={view.self.stability} />
        <Meter value={view.self.stability} tone={view.self.stability < 40 ? 'bad' : 'good'} />
        <Stat label="War losses" value={view.self.warLosses} />
      </Section>
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
  const reserved = draft.recruit.reduce(
    (acc, r) => {
      const c = recruitCostFor(view, r.unitClass);
      for (const res of RESOURCES) acc[res] += c[res];
      return acc;
    },
    { credits: 0, energy: 0, materials: 0, food: 0 },
  );
  const canAfford = (c: UnitClass) => {
    const cost = recruitCostFor(view, c);
    return RESOURCES.every((r) => reserved[r] + cost[r] <= view.self.stockpile[r]);
  };
  const ordered = formations.filter((f) => draft.formations[f.id]).length;
  return (
    <>
      <Section title={`Formations (${formations.length})`} right={<span className="font-mono text-[10px] text-faint">{ordered} ordered</span>}>
        <ul className="space-y-1" data-testid="formation-list">
          {formations.map((f) => {
            const o = draft.formations[f.id];
            return (
              <li key={f.id}>
                <button
                  type="button"
                  data-testid={`formation-${f.id}`}
                  onClick={() => {
                    selectFormation(f.id);
                    focusOn(f.key);
                  }}
                  className={`w-full border px-2 py-1.5 text-left text-xs transition-colors ${selected === f.id ? 'border-signal/80 bg-ink-800' : 'border-line/50 bg-ink-900 hover:border-faint hover:bg-ink-850'}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="flex-1 truncate font-semibold">{f.name}</span>
                    <UnitGlyph unitClass={f.unitClass} color={view.self.color} />
                    {!o && <span className="h-1.5 w-1.5 rounded-full bg-signal" title="No orders" />}
                  </div>
                  <div className="mt-1 grid grid-cols-[1fr_auto] items-center gap-2">
                    <Meter value={f.strength} max={1000} tone={f.strength < 400 ? 'bad' : 'good'} />
                    <span className={`max-w-36 truncate text-[10px] ${o ? 'text-signal' : 'text-faint'}`}>{describeOrder(o, view)}</span>
                  </div>
                  <div className="mt-0.5 text-[10px] text-faint">{hexLabel(view, f.key)}</div>
                </button>
              </li>
            );
          })}
        </ul>
      </Section>
      <Section title="Recruit">
        {sites.length === 0 ? (
          <p className="text-xs text-muted">No city under your control can recruit.</p>
        ) : (
          <div className="space-y-2 text-xs">
            <div className="flex flex-wrap gap-1">
              {sites.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSite(s.id)}
                  className={`border px-2 py-1 text-[11px] ${site === s.id ? 'border-signal/70 bg-signal/10 text-signal' : 'border-line text-muted hover:text-text'}`}
                >
                  {s.kind === 'capital' && <Icon name="capital" className="mr-1 h-2.5 w-2.5 align-[-1px]" />}
                  {s.name}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-1" data-testid="recruit-class" role="radiogroup" aria-label="Unit class">
              {UNIT_CLASSES.map((c) => {
                const ok = canAfford(c);
                return (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={cls === c}
                    onClick={() => setCls(c)}
                    className={`border p-1.5 text-left ${cls === c ? 'border-signal/70 bg-ink-800' : 'border-line bg-ink-850 hover:border-faint'} ${ok ? '' : 'opacity-50'}`}
                  >
                    <div className="flex items-center gap-1.5">
                      <UnitGlyph unitClass={c} color={view.self.color} />
                      <span className="truncate text-[11px] font-semibold">{UNITS[c].name.replace(' Infantry', '').replace('Reconnaissance', 'Recon')}</span>
                    </div>
                    <div className="mt-0.5 font-mono text-[9px] text-faint">{recruitCostFor(view, c).credits} cr</div>
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-muted">
              {costText(recruitCostFor(view, cls))} · {UNITS[cls].industry} industry
            </p>
            <Button onClick={() => addRecruit(site, cls)} disabled={!canAfford(cls) || !site} testId="recruit" tone="primary">
              Queue {UNITS[cls].name} at {view.sites[site]?.name}
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
            <p className="text-[10px] text-faint">One recruit per site per turn.</p>
          </div>
        )}
      </Section>
      <Section title="In production" right={<span className="font-mono text-[10px] text-faint">{view.self.industrialCapacity} ind/turn</span>}>
        {view.self.productionQueue.length === 0 ? (
          <p className="text-xs text-faint">Nothing queued.</p>
        ) : (
          <ul className="space-y-2 text-xs">
            {view.self.productionQueue.map((p) => (
              <li key={p.id}>
                <div className="flex items-center gap-1.5">
                  <UnitGlyph unitClass={p.unitClass} color={view.self.color} />
                  <span>{UNITS[p.unitClass].name}</span>
                  <span className="ml-auto text-faint">{view.sites[p.siteId]?.name}</span>
                </div>
                <Meter value={p.progress} max={p.required} />
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}

export function Economy() {
  const view = useGame((s) => s.view)!;
  const draft = useGame((s) => s.draft)!;
  const report = useGame((s) => s.report);
  const setBudget = useGame((s) => s.setBudget);
  const budget = draft.budget ?? view.self.budget;
  const ledger = selfLedger(view, report);
  const net = ledger ? netChange(ledger) : null;
  const total = budget.research + budget.infrastructure + budget.welfare;
  const slider = (key: keyof typeof budget, label: string, help: string) => (
    <label className="block text-xs">
      <div className="flex justify-between">
        <span className="font-semibold">{label}</span>
        <span className="font-mono text-signal">{budget[key]}%</span>
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
      <span className="text-[10px] text-faint">{help}</span>
    </label>
  );
  return (
    <>
      <Section title="Stockpiles">
        <div className="grid grid-cols-2 gap-1.5">
          {RESOURCES.map((r) => {
            const d = net?.[r];
            const short = ledger?.shortages.includes(r);
            return (
              <div key={r} className={`border px-2 py-1.5 ${short ? 'border-hostile/60 bg-hostile/10' : 'border-line/70 bg-ink-850'}`}>
                <div className="font-display text-[9px] tracking-[0.06em] text-faint uppercase">{r}</div>
                <div className="font-mono text-base leading-tight font-semibold tabular-nums">
                  {view.self.stockpile[r]}
                  {d !== undefined && <span className={`ml-1 text-[10px] ${d >= 0 ? 'text-good' : 'text-hostile'}`}>{d >= 0 ? `+${d}` : d}</span>}
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-2">
          <Stat label="Industrial capacity" value={view.self.industrialCapacity} sub="/turn" />
          <Stat label="Research output" value={view.self.researchOutput} sub="/turn" />
        </div>
      </Section>
      <Section title="Budget" right={<span className={`font-mono text-[10px] ${total >= 60 ? 'text-signal' : 'text-faint'}`}>{total}/60%</span>}>
        <div className="space-y-3">
          {slider('research', 'Research', 'Half of every credit becomes a research point.')}
          {slider('infrastructure', 'Logistics', 'Each percent adds a percent of supply capacity.')}
          {slider('welfare', 'Welfare', 'Raises stability; low stability cuts output.')}
        </div>
      </Section>
      {ledger && (
        <Section title="Last turn ledger">
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
                <tr key={row} className="border-t border-line/40">
                  <td className="py-0.5 font-sans text-muted">{row}</td>
                  {RESOURCES.map((r) => (
                    <td key={r} className={`text-right ${row === 'income' ? 'text-good' : ledger[row][r] ? '' : 'text-faint'}`}>
                      {ledger[row][r] ? `${row === 'income' ? '+' : '−'}${ledger[row][r]}` : '·'}
                    </td>
                  ))}
                </tr>
              ))}
              {net && (
                <tr className="border-t border-line font-semibold">
                  <td className="py-0.5 font-sans">net</td>
                  {RESOURCES.map((r) => (
                    <td key={r} className={`text-right ${net[r] >= 0 ? 'text-good' : 'text-hostile'}`}>
                      {net[r] >= 0 ? `+${net[r]}` : net[r]}
                    </td>
                  ))}
                </tr>
              )}
            </tbody>
          </table>
          {ledger.shortages.length > 0 && <p className="mt-2 text-xs text-hostile">Shortage: {ledger.shortages.join(', ')}. Upkeep went unpaid.</p>}
        </Section>
      )}
    </>
  );
}

/** Each technology in plain words: what it is called, and what you get. */
/** The arena weapon each breakthrough hands your crews. */
const BATTLE_UNLOCK: Record<string, string> = Object.fromEntries((Object.keys(ABILITIES) as AbilityId[]).map((a) => [ABILITIES[a].tech, `${ABILITIES[a].name}. ${ABILITIES[a].text}`]));

export const TECH_PLAIN: Record<string, { name: string; gives: string }> = {
  logistics_doctrine: { name: 'Better supply lines', gives: 'Your units stay supplied further from home.' },
  signals_intelligence: { name: 'Better scouting', gives: 'Every unit sees one hex further.' },
  industrial_automation: { name: 'Faster factories', gives: 'Your cities build units 20% faster.' },
  combined_arms: { name: 'Combined arms', gives: 'Attacks with mixed unit types hit harder.' },
  precision_munitions: { name: 'Precision strikes', gives: 'Artillery, helicopters and drones hit 20% harder.' },
  composite_armor: { name: 'Tougher armour', gives: 'Tanks and IFVs take 20% less damage.' },
};

export function Research() {
  const view = useGame((s) => s.view)!;
  const draft = useGame((s) => s.draft)!;
  const setResearch = useGame((s) => s.setResearch);
  const setBudget = useGame((s) => s.setBudget);
  const current = draft.research !== undefined ? draft.research : view.self.research.current;
  const budget = draft.budget ?? view.self.budget;
  const output = researchPerTurn(view, budget.research);
  const others = budget.infrastructure + budget.welfare;
  const levels: [string, number][] = [
    ['Low', 10],
    ['Normal', 25],
    ['High', 40],
  ];
  const done = view.self.research.unlocked;
  // What you can start now first, cheapest first; what needs an earlier breakthrough after.
  const open = TECH_IDS.filter((id) => !done.includes(id) && id !== current).sort(
    (x, y) => Number(!!checkResearchView(view, x)) - Number(!!checkResearchView(view, y)) || TECHS[x]!.cost - TECHS[y]!.cost,
  );
  const best = recommendedTech(view);
  const turnsFor = (id: string, progress = 0) => Math.max(1, Math.ceil((TECHS[id]!.cost - progress) / output));
  return (
    <Section title="Research">
      <p className="mb-3 text-[13px] leading-snug text-muted">
        One breakthrough at a time. Pick one and it finishes by itself. If you never pick, your scientists start the recommended one.
      </p>
      {current ? (
        <div className="mb-3 rounded-lg border-2 border-signal/70 bg-ink-850 p-3" data-testid="research-current">
          <div className="font-display text-[11px] font-bold tracking-[0.08em] text-signal uppercase">Working on</div>
          <div className="font-display text-lg font-extrabold">{TECH_PLAIN[current]?.name ?? TECHS[current]?.name}</div>
          <div className="text-[13px] text-muted">{TECH_PLAIN[current]?.gives}</div>
          <div className="mt-2">
            <Meter value={view.self.research.progress} max={TECHS[current]!.cost} />
          </div>
          <div className="mt-1 text-[12px] text-faint">Ready in about {turnsFor(current, current === view.self.research.current ? view.self.research.progress : 0)} turns</div>
        </div>
      ) : (
        <p className="mb-3 rounded-lg border border-line bg-ink-850 p-3 text-[13px] text-signal">Nothing in progress. Pick one below.</p>
      )}
      <ul className="space-y-2">
        {open.map((id) => {
          const why = checkResearchView(view, id);
          const plain = TECH_PLAIN[id];
          return (
            <li key={id}>
              <button
                type="button"
                onClick={() => setResearch(id)}
                disabled={!!why}
                data-testid={`research-${id}`}
                className="w-full rounded-lg border border-line bg-ink-850 p-3 text-left active:bg-ink-700 disabled:opacity-45"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-display text-base font-bold">{plain?.name ?? TECHS[id]!.name}</span>
                  {id === best && !why && <span className="rounded-full bg-signal px-2 py-0.5 text-[10px] font-bold text-ink-950 uppercase">Recommended</span>}
                </div>
                <div className="text-[13px] text-muted">{plain?.gives ?? TECHS[id]!.summary}</div>
                {BATTLE_UNLOCK[id] && <div className="mt-1 text-[12px] font-semibold text-signal">In battle: {BATTLE_UNLOCK[id]}</div>}
                <div className="mt-1 text-[12px] text-faint">{why ? `First: ${TECH_PLAIN[TECHS[id]!.requires[0]!]?.name ?? 'an earlier breakthrough'}` : `About ${turnsFor(id)} turns · tap to research`}</div>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mt-4">
        <div className="font-display text-[11px] font-bold tracking-[0.08em] text-muted uppercase">Research funding</div>
        <div className="mt-1.5 grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Research funding">
          {levels.map(([label, share]) => {
            const ok = share + others <= 60;
            const on = budget.research === share || (label === 'Normal' && !levels.some(([, x]) => x === budget.research));
            return (
              <button
                key={label}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={!ok}
                onClick={() => setBudget({ ...budget, research: share })}
                data-testid={`research-funding-${label.toLowerCase()}`}
                className={`rounded-lg border px-2 py-2 text-center disabled:opacity-40 ${on ? 'border-signal bg-signal/15 text-signal' : 'border-line'}`}
              >
                <div className="font-display text-sm font-bold uppercase">{label}</div>
                <div className="text-[11px] text-muted">{researchPerTurn(view, share)} pts/turn</div>
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 text-[12px] text-faint">More funding spends more of your income each turn and finishes breakthroughs sooner.</p>
      </div>
      {done.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {done.map((id) => (
            <span key={id} className="rounded-full border border-good/50 bg-good/10 px-2.5 py-1 text-[12px] text-good">
              <Icon name="check" className="mr-1 h-3 w-3 align-[-2px]" />
              {TECH_PLAIN[id]?.name ?? TECHS[id]?.name}
            </span>
          ))}
        </div>
      )}
    </Section>
  );
}

const RELATION_TEXT: Record<string, { label: string; tone: string; means: string }> = {
  war: { label: 'At war', tone: 'bg-hostile text-white', means: 'You fight: each side can attack the other and take its cities.' },
  peace: { label: 'At peace', tone: 'bg-good text-ink-950', means: 'Neither side can attack. Breaking it costs stability.' },
  alliance: { label: 'Allies', tone: 'bg-friend text-ink-950', means: 'Allied: you fight side by side.' },
};

export function Diplomacy() {
  const view = useGame((s) => s.view)!;
  const draft = useGame((s) => s.draft)!;
  const setDiplomacy = useGame((s) => s.setDiplomacy);
  const others = Object.values(view.nations)
    .filter((n) => n.id !== view.self.id)
    .sort((a, b) => b.victoryPoints - a.victoryPoints);
  const planned = (id: string) => draft.diplomacy.find((d) => d.target === id)?.action ?? null;
  const toggle = (id: string, action: DiplomaticAction) => setDiplomacy(id, planned(id) === action ? null : action);
  const wars = others.filter((n) => !n.eliminated && view.relations[n.id] === 'war').length;
  const easy = view.difficulty === 'easy';
  const big = 'mt-2.5 h-11 w-full rounded-lg text-[14px] font-semibold';
  return (
    <Section title="Diplomacy">
      <p className="mb-3 text-[13px] leading-snug text-muted">
        {wars === 0 ? 'You are at peace with everyone.' : `You are at war with ${wars} ${wars === 1 ? 'nation' : 'nations'}.`} Fewer wars means you can mass your army against one enemy.
        {easy ? ' On Easy, anyone accepts your peace offer.' : ' A peace offer is accepted when they are busy fighting someone else.'}
      </p>
      <ul className="space-y-2.5">
        {others.map((n) => {
          const rel = view.relations[n.id] ?? 'war';
          const r = RELATION_TEXT[rel]!;
          const incoming = view.proposals.find((p) => p.from === n.id && p.to === view.self.id);
          const outgoing = view.proposals.find((p) => p.from === view.self.id && p.to === n.id);
          const seen = Object.values(view.contacts).filter((c) => c.owner === n.id && c.confirmed).length;
          const perfidy = RULES.perfidy[rel === 'alliance' ? 'alliance' : 'peace'];
          return (
            <li key={n.id} className="rounded-lg border border-line bg-ink-850 p-3" style={{ borderLeft: `4px solid ${n.color}` }} data-testid={`nation-card-${n.id}`}>
              <div className="flex items-center gap-2.5">
                <Emblem color={n.color} government={n.government} className="h-8 w-8" />
                <div className="min-w-0 flex-1 leading-tight">
                  <div className="font-display truncate text-base font-bold">{n.name}</div>
                  <div className="text-[12px] text-faint">
                    {n.victoryPoints} VP{seen ? ` · ${seen} units seen` : ''}
                  </div>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase ${n.eliminated ? 'bg-ink-700 text-faint' : r.tone}`}>{n.eliminated ? 'Defeated' : r.label}</span>
              </div>
              {!n.eliminated && (
                <>
                  <p className="mt-1.5 text-[13px] text-muted">{r.means}</p>
                  {incoming && rel === 'war' && <p className="mt-1.5 text-[13px] font-semibold text-signal">They are offering peace.</p>}
                  {outgoing && !planned(n.id) && <p className="mt-1.5 text-[12px] text-faint">Your {outgoing.kind} offer is waiting for their answer.</p>}
                  {rel === 'war' && (
                    <button
                      type="button"
                      onClick={() => toggle(n.id, 'propose_peace')}
                      aria-pressed={planned(n.id) === 'propose_peace'}
                      className={`${big} ${planned(n.id) === 'propose_peace' ? 'border-2 border-good bg-good/15 text-good' : 'bg-good text-ink-950'}`}
                    >
                      {planned(n.id) === 'propose_peace' ? 'Peace offered when the turn ends (tap to cancel)' : incoming ? 'Accept peace' : 'Offer peace'}
                    </button>
                  )}
                  {rel !== 'war' && (
                    <div className="flex gap-2">
                      {rel === 'peace' && (
                        <button type="button" onClick={() => toggle(n.id, 'propose_alliance')} aria-pressed={planned(n.id) === 'propose_alliance'} className={`${big} border border-line ${planned(n.id) === 'propose_alliance' ? 'border-friend text-friend' : 'bg-ink-800'}`}>
                          {planned(n.id) === 'propose_alliance' ? 'Alliance offered' : incoming ? 'Accept alliance' : 'Offer alliance'}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => toggle(n.id, 'declare_war')}
                        aria-pressed={planned(n.id) === 'declare_war'}
                        className={`${big} border ${planned(n.id) === 'declare_war' ? 'border-hostile bg-hostile text-white' : 'border-hostile/60 text-hostile'}`}
                      >
                        {planned(n.id) === 'declare_war' ? 'War declared at turn end (cancel)' : `Declare war · −${perfidy} stability`}
                      </button>
                    </div>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

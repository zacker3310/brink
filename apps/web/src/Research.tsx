import { useState } from 'react';
import type { FacilityId, NationView, TechId } from '@brink/contracts';
import { BRANCHES, FACILITIES, FACILITY_ORDER, TECH_BRANCHES, TECH_IDS, TECHS, type TechBranch } from '@brink/game-data';
import { ABILITIES, type AbilityId } from '@brink/arena';
import { Label } from './chrome';
import { Icon } from './icons';
import { checkResearchView, recommendedTech, researchPerTurn } from './rules-view';
import { useGame } from './store';
import { Meter } from './ui';

// The research tree, phone first: what is in progress, the five branches as chips, and each
// branch's technologies in order of depth, every one a 44 px card saying what it gives, what it
// unlocks and when it would be ready. Funding sits under the tree.

/** The arena ability each breakthrough hands your crews. */
const BATTLE_UNLOCK: Record<string, string> = Object.fromEntries((Object.keys(ABILITIES) as AbilityId[]).map((a) => [ABILITIES[a].tech, `${ABILITIES[a].name}. ${ABILITIES[a].text}`]));

/** Facilities each technology unlocks. */
const BUILDS: Record<string, FacilityId[]> = {};
for (const f of FACILITY_ORDER) {
  const t = FACILITIES[f].requires;
  if (t) BUILDS[t] = [...(BUILDS[t] ?? []), f];
}

const ASSET: Record<string, string> = {
  strike_jet: 'strike sortie',
  kamikaze: 'kamikaze swarm',
  cruise_missile: 'cruise missile',
  naval_gun: 'naval gunfire mission',
  himars: 'rocket strike',
  tornado: 'rocket strike',
};

/** What a technology adds to your hand-fought battles, in words. */
function battleLines(id: TechId): string[] {
  const out: string[] = [];
  if (BATTLE_UNLOCK[id]) out.push(BATTLE_UNLOCK[id]!);
  for (const s of TECHS[id]?.support ?? []) out.push(`+${s.missions} ${ASSET[s.asset] ?? s.asset}${s.missions > 1 ? 's' : ''} ${s.coastal ? 'in coastal battles' : 'in every battle'}.`);
  return out;
}

type Status = 'done' | 'current' | 'open' | 'locked';

function statusOf(view: NationView, current: TechId | null, id: TechId): Status {
  if (view.self.research.unlocked.includes(id)) return 'done';
  if (id === current) return 'current';
  return checkResearchView(view, id) ? 'locked' : 'open';
}

export function ResearchScreen() {
  const view = useGame((s) => s.view)!;
  const draft = useGame((s) => s.draft)!;
  const setResearch = useGame((s) => s.setResearch);
  const setBudget = useGame((s) => s.setBudget);
  const [branch, setBranch] = useState<TechBranch | 'all'>('all');
  const current = draft.research !== undefined ? draft.research : view.self.research.current;
  const budget = draft.budget ?? view.self.budget;
  const output = researchPerTurn(view, budget.research);
  const others = budget.infrastructure + budget.welfare;
  const done = view.self.research.unlocked;
  const best = recommendedTech(view);
  const progressOn = (id: TechId) => (id === view.self.research.current || !view.self.research.current ? view.self.research.progress : 0);
  const turnsFor = (id: TechId) => Math.max(1, Math.ceil((TECHS[id]!.cost - progressOn(id)) / Math.max(1, output)));
  const levels: [string, number][] = [
    ['Low', 10],
    ['Normal', 25],
    ['High', 40],
  ];
  const branches = branch === 'all' ? TECH_BRANCHES : [branch];
  return (
    <section className="px-3 py-3" data-testid="research-screen">
      <header className="mb-2 flex items-baseline justify-between gap-2">
        <Label>Research</Label>
        <span className="font-mono text-[12px] text-muted" data-testid="research-output">
          {output} pts/turn · {done.length}/{TECH_IDS.length} done
        </span>
      </header>
      {current && TECHS[current] ? (
        <div className="mb-3 rounded-lg border-2 border-signal/70 bg-ink-850 p-3" data-testid="research-current">
          <div className="font-display text-[11px] font-bold tracking-[0.08em] text-signal uppercase">Working on · {BRANCHES[TECHS[current]!.branch].name}</div>
          <div className="font-display text-lg font-extrabold">{TECHS[current]!.name}</div>
          <div className="text-[13px] text-muted">{TECHS[current]!.gives}</div>
          <div className="mt-2">
            <Meter value={progressOn(current)} max={TECHS[current]!.cost} />
          </div>
          <div className="mt-1 text-[12px] text-faint">
            {progressOn(current)}/{TECHS[current]!.cost} · ready in about {turnsFor(current)} turns
          </div>
        </div>
      ) : (
        <p className="mb-3 rounded-lg border border-line bg-ink-850 p-3 text-[13px] text-signal">Nothing in progress. Pick a breakthrough below; if you do not, your scientists start the recommended one.</p>
      )}

      <nav className="-mx-3 mb-2 flex gap-1.5 overflow-x-auto px-3 pb-1" aria-label="Research branches">
        {(['all', ...TECH_BRANCHES] as const).map((b) => {
          const on = branch === b;
          const count = b === 'all' ? null : TECH_IDS.filter((t) => TECHS[t]!.branch === b);
          return (
            <button
              key={b}
              type="button"
              onClick={() => setBranch(b)}
              aria-pressed={on}
              data-testid={`research-branch-${b}`}
              className={`min-h-11 shrink-0 rounded-full border px-3.5 text-[12px] font-semibold whitespace-nowrap ${on ? 'border-signal bg-signal/15 text-signal' : 'border-line bg-ink-850 text-muted'}`}
            >
              {b === 'all' ? 'All' : BRANCHES[b].name}
              {count && <span className="ml-1.5 font-mono text-[11px] text-faint">{count.filter((t) => done.includes(t)).length}/{count.length}</span>}
            </button>
          );
        })}
      </nav>

      {branches.map((b) => (
        <div key={b} className="mb-3" data-testid={`research-tree-${b}`}>
          <div className="mb-1.5 flex items-baseline justify-between">
            <h4 className="font-display text-[13px] font-bold tracking-[0.06em] text-text uppercase">{BRANCHES[b].name}</h4>
            <span className="text-[11px] text-faint">{BRANCHES[b].summary}</span>
          </div>
          <ol className="relative space-y-2 border-l-2 border-line/70 pl-3">
            {TECH_IDS.filter((t) => TECHS[t]!.branch === b)
              .sort((x, y) => TECHS[x]!.tier - TECHS[y]!.tier || TECHS[x]!.cost - TECHS[y]!.cost || (x < y ? -1 : 1))
              .map((id) => (
                <TechCard
                  key={id}
                  id={id}
                  status={statusOf(view, current, id)}
                  recommended={id === best && !current}
                  turns={turnsFor(id)}
                  why={checkResearchView(view, id)}
                  onPick={() => setResearch(id)}
                />
              ))}
          </ol>
        </div>
      ))}

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
                className={`min-h-11 rounded-lg border px-2 py-2 text-center disabled:opacity-40 ${on ? 'border-signal bg-signal/15 text-signal' : 'border-line'}`}
              >
                <div className="font-display text-sm font-bold uppercase">{label}</div>
                <div className="text-[11px] text-muted">{researchPerTurn(view, share)} pts/turn</div>
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 text-[12px] text-faint">Cities, labs and bigger cities make research; more funding spends income on it too.</p>
      </div>
    </section>
  );
}

function TechCard({ id, status, recommended, turns, why, onPick }: { id: TechId; status: Status; recommended: boolean; turns: number; why: string | null; onPick: () => void }) {
  const def = TECHS[id]!;
  const builds = BUILDS[id] ?? [];
  const battle = battleLines(id);
  const tone =
    status === 'done' ? 'border-good/50 bg-good/5' : status === 'current' ? 'border-signal bg-signal/10' : status === 'open' ? 'border-line bg-ink-850 active:bg-ink-700' : 'border-line/60 bg-ink-900 opacity-60';
  return (
    <li className="relative">
      <span
        className={`absolute top-4 -left-[19px] h-2.5 w-2.5 rounded-full border-2 ${status === 'done' ? 'border-good bg-good' : status === 'current' ? 'border-signal bg-signal' : 'border-line bg-ink-900'}`}
        aria-hidden
      />
      <button
        type="button"
        onClick={onPick}
        disabled={status !== 'open'}
        data-testid={`research-${id}`}
        data-status={status}
        aria-label={`${def.name}: ${status === 'done' ? 'researched' : status === 'current' ? 'in progress' : status === 'open' ? `about ${turns} turns` : (why ?? 'locked')}`}
        className={`min-h-11 w-full rounded-lg border p-3 text-left disabled:cursor-default ${tone}`}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="font-display text-base leading-tight font-bold">{def.name}</span>
          {status === 'done' && (
            <span className="flex items-center gap-1 text-[11px] font-semibold text-good">
              <Icon name="check" className="h-3 w-3" />
              Done
            </span>
          )}
          {status === 'current' && <span className="rounded-full bg-signal px-2 py-0.5 text-[10px] font-bold text-ink-950 uppercase">Researching</span>}
          {status === 'open' && recommended && <span className="rounded-full bg-signal px-2 py-0.5 text-[10px] font-bold text-ink-950 uppercase">Recommended</span>}
          {status === 'locked' && <Icon name="lock" className="h-3.5 w-3.5 text-faint" />}
        </div>
        <div className="mt-0.5 text-[13px] leading-snug text-muted">{def.gives}</div>
        {builds.length > 0 && <div className="mt-1 text-[12px] font-semibold text-friend">Build: {builds.map((f) => FACILITIES[f].name).join(', ')}</div>}
        {battle.map((line) => (
          <div key={line} className="mt-1 text-[12px] font-semibold text-signal">
            In battle: {line}
          </div>
        ))}
        <div className="mt-1 font-mono text-[11px] text-faint">
          {def.cost} pts
          {status === 'open' && ` · about ${turns} turns · tap to research`}
          {status === 'locked' && why && ` · ${why}`}
        </div>
      </button>
    </li>
  );
}

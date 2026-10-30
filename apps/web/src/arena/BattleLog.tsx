import { useMemo, useState } from 'react';
import { rollLog, typeOf, type Battle, type LogEntry, type LogResult } from '@brink/arena';

// The battle log: every roll you saw, newest first, grouped by round, so the chance on the card can
// be checked against what came of it. It reads the battle as you know it (`rollLog`): enemies you
// never had in sight stay unnamed, and what you could not see is not there.

type Filter = 'all' | 'mine' | 'theirs';

const article = (s: string) => (/^[AEIOU]/.test(s) ? 'an' : 'a');

/** A unit as the log names it: yours by name, theirs by type ("a T-72B3"). */
function nameOf(b: Battle, id: string): string {
  if (id === 'support:himars') return 'HIMARS';
  if (id === 'support:tornado') return 'Tornado-G';
  const u = b.units.find((x) => x.id === id);
  if (!u) return 'a unit';
  if (u.side === 'blue') return u.name;
  const t = typeOf(u.type).short;
  return `${article(t)} ${t}`;
}

const upper = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const EFFECT: Record<string, string> = {
  catastrophic: 'destroyed',
  knocked_out: 'knocked out',
  mobility: 'immobilised',
  firepower: 'gun out',
  crew: 'crew hit',
  none: 'no damage',
  forced_landing: 'forced down',
  shot_down: 'shot down',
};
const HOW: Record<string, string> = { destroyed: 'destroyed', knocked_out: 'knocked out', shot_down: 'shot down', landed: 'forced down', wiped: 'wiped out' };
/** Effects that already say the unit is gone (its 'destroyed' adds nothing). */
const FINAL = new Set(['catastrophic', 'knocked_out', 'shot_down', 'forced_landing']);

function resultWords(b: Battle, r: LogResult, said: Set<string>): string | null {
  switch (r.type) {
    case 'intercept': {
      const target = r.aps && r.by ? b.units.find((x) => x.id === r.by) : undefined;
      if (r.aps) return `stopped by ${(target && typeOf(target.type).aps?.name) || 'its APS'}`;
      return `shot down by ${r.by ? nameOf(b, r.by) : 'air defence'}`;
    }
    case 'impact':
      if (!r.pen) return r.effect === 'tracks' ? 'bounced, tracks hit' : r.effect === 'optics' ? 'bounced, optics out' : 'bounced';
      if (FINAL.has(r.effect)) said.add(r.unit);
      return `penetrated, ${EFFECT[r.effect] ?? 'damaged'}`;
    case 'casualties':
      return [r.killed ? `${r.killed} down` : '', r.wounded ? `${r.wounded} wounded` : ''].filter(Boolean).join(', ') || null;
    case 'suppressed':
      return r.level;
    case 'destroyed':
      if (said.has(r.unit) || !HOW[r.how]) return null;
      said.add(r.unit);
      return HOW[r.how]!;
  }
}

/** One line: "Abrams 1 fired at a T-72B3: 64%, hit, penetrated, knocked out". */
export function logLine(b: Battle, e: LogEntry): { lead: string; chance: string | null; tail: string } {
  const said = new Set<string>();
  // What it did, unit by unit: the one fired at first and without its name.
  const byUnit = new Map<string, string[]>();
  for (const r of e.results) {
    const unit = r.type === 'intercept' ? (r.aps ? r.by ?? r.unit : e.target ?? r.unit) : r.unit;
    const w = resultWords(b, r, said);
    if (!w) continue;
    byUnit.set(unit, [...(byUnit.get(unit) ?? []), w]);
  }
  const parts: string[] = [];
  const own = e.target ? byUnit.get(e.target) : undefined;
  const intercepted = e.results.some((r) => r.type === 'intercept' && !r.aps) && !e.hit;
  if (e.kind === 'shot') parts.push(intercepted ? '' : e.hit ? 'hit' : 'missed');
  else if (e.kind === 'called' || e.kind === 'smoke') parts.push(e.hit ? 'on target' : 'off target');
  if (own && e.kind !== 'mine') parts.push(...own);
  for (const [unit, words] of byUnit) if (unit !== e.target || e.kind === 'mine') parts.push(e.kind === 'mine' && unit === e.target ? words.join(', ') : `${nameOf(b, unit)}: ${words.join(', ')}`);
  const tail = parts.filter(Boolean).join(', ');
  // An enemy you never saw is fire from out of sight: no unit, no weapon.
  const shooter = e.shooter ? nameOf(b, e.shooter) : null;
  let lead: string;
  if (e.kind === 'mine') lead = `${upper(e.target ? nameOf(b, e.target) : 'a vehicle')} ran onto a mine`;
  else if (e.kind === 'airstrike') lead = 'Air strike';
  else if (!shooter) lead = e.kind === 'shot' ? `Fire from out of sight at ${e.target ? nameOf(b, e.target) : 'a cell'}` : e.kind === 'smoke' ? 'Smoke from out of sight' : 'Fire from out of sight';
  else if (e.kind === 'smoke') lead = `${upper(shooter)} laid smoke`;
  else if (e.kind === 'called') lead = `${upper(shooter)} ${e.side === 'blue' && !e.shooter?.startsWith('support:') ? 'called fire' : 'fired'}`;
  else lead = `${upper(shooter)} fired at ${e.target ? nameOf(b, e.target) : 'a cell'}${e.overwatch ? ' on overwatch' : ''}`;
  return { lead, chance: e.chance === null ? null : `${e.chance}%`, tail };
}

export function BattleLog({ b, upTo, onClose }: { b: Battle; upTo: number; onClose: () => void }) {
  const [filter, setFilter] = useState<Filter>('all');
  const log = useMemo(() => rollLog(b, upTo), [b, upTo]);
  const shown = log.filter((e) => filter === 'all' || (filter === 'mine' ? e.side === 'blue' : e.side === 'red'));
  const rounds = [...new Set(shown.map((e) => e.round))].sort((p, q) => q - p);
  return (
    <div className="vercel absolute inset-0 z-30 flex flex-col bg-black" role="dialog" aria-label="Battle Log" data-testid="arena-log">
      <div className="safe-top safe-x">
        <div className="flex items-center gap-2 px-4 pt-3">
          <h2 className="min-w-0 flex-1 text-[22px] font-bold tracking-tight">Battle Log</h2>
          <button type="button" onClick={onClose} className="v-btn v-btn-secondary h-11 px-4 text-[15px] font-semibold" data-testid="arena-log-close">
            Done
          </button>
        </div>
        <p className="px-4 pt-1 text-[13px] text-muted">Every roll you saw, newest first. Each chance is the one rolled.</p>
        <div className="mx-4 mt-2 grid grid-cols-3 gap-1 rounded-xl bg-ink-900 p-1" role="radiogroup" aria-label="Show">
          {(
            [
              ['all', 'All'],
              ['mine', 'My Units'],
              ['theirs', 'Enemy'],
            ] as const
          ).map(([k, label]) => (
            <button key={k} type="button" role="radio" aria-checked={filter === k} onClick={() => setFilter(k)} className={`h-11 rounded-lg text-[14px] font-semibold ${filter === k ? 'bg-white text-black' : 'text-text'}`} data-testid={`log-filter-${k}`}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="safe-bottom safe-x mt-2 min-h-0 flex-1 overflow-y-auto" data-testid="log-list">
        <div className="px-4 pb-4">
          {rounds.length === 0 && <p className="py-8 text-center text-[15px] text-muted">{filter === 'all' ? 'No rolls yet.' : 'None of these yet.'}</p>}
          {rounds.map((r) => (
            <section key={r} aria-label={`Round ${r}`}>
              <h3 className="sticky top-0 bg-black py-2 text-[13px] font-semibold text-muted">Round {r}</h3>
              <ul className="divide-y divide-line rounded-xl bg-ink-900">
                {shown
                  .filter((e) => e.round === r)
                  .reverse()
                  .map((e) => {
                    const l = logLine(b, e);
                    return (
                      <li key={e.at} className="px-3 py-2 text-[14px] leading-snug" data-testid="log-line" data-side={e.side}>
                        <span className="font-semibold">{l.lead}</span>
                        {l.chance || l.tail ? ': ' : ''}
                        {l.chance && <b className="tabular-nums">{l.chance}</b>}
                        {l.chance && l.tail ? ', ' : ''}
                        {l.tail}
                      </li>
                    );
                  })}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

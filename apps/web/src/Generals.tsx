import { useEffect, useState } from 'react';
import { create } from 'zustand';
import type { Commander, FormationId, NationView } from '@brink/contracts';
import { COMMANDER_TRAITS, PERKS } from '@brink/game-data';
import { Label } from './chrome';
import { useGame } from './store';
import { available, canLead, generalsOf, leaderAfter, perkName, postings, rankTitle, traitLine, xpProgress } from './generals';

// Generals: the commander row on a formation's card, the roster (Command, Generals), and the
// promotion modal that deals two perk cards on a level-up.

/** Which promotion is open, and the ones put off this turn (`<id>@<offer turn>`). */
const usePromotion = create<{ open: string | null; later: string[]; show(id: string | null): void; putOff(key: string): void }>((set, get) => ({
  open: null,
  later: [],
  show: (id) => set({ open: id }),
  putOff: (key) => set({ open: null, later: [...get().later, key] }),
}));

export function GeneralBadge({ c, color, size = 40 }: { c: Pick<Commander, 'portrait' | 'level' | 'status'>; color: string; size?: number }) {
  const fallen = c.status === 'killed';
  return (
    <span className="relative inline-flex shrink-0 items-center justify-center rounded-full border-2" style={{ width: size, height: size, borderColor: fallen ? '#8794a0' : color, background: `radial-gradient(circle at 35% 30%, ${color}66, #0d1114 72%)`, opacity: fallen ? 0.55 : 1 }} aria-hidden>
      <span className="font-display leading-none font-extrabold text-text" style={{ fontSize: Math.round(size * 0.38) }}>
        {c.portrait}
      </span>
      <span className="font-display absolute -right-1 -bottom-1 flex h-4 min-w-4 items-center justify-center rounded-full border border-ink-950 bg-signal px-0.5 text-[10px] leading-none font-extrabold text-ink-950">{c.level}</span>
    </span>
  );
}

function XpBar({ c }: { c: Pick<Commander, 'level' | 'xp'> }) {
  const p = xpProgress(c);
  return (
    <span className="flex items-center gap-1.5" title={p ? `${p[0]} of ${p[1]} experience to the next rank` : 'Highest rank'}>
      <span className="h-1 w-16 overflow-hidden rounded-full bg-ink-700">
        <span className="block h-full bg-signal" style={{ width: `${p ? Math.min(100, Math.floor((p[0] * 100) / Math.max(1, p[1]))) : 100}%` }} />
      </span>
      <span className="font-mono text-[11px] text-faint">{p ? `${p[0]}/${p[1]}` : 'max'}</span>
    </span>
  );
}

function PerkChips({ c }: { c: Commander }) {
  if (c.perks.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {c.perks.map((p) => (
        <span key={p} title={PERKS[p]?.summary} className="rounded-full border border-signal/40 px-1.5 py-px text-[11px] leading-tight text-signal">
          {perkName(p)}
        </span>
      ))}
    </span>
  );
}

/** The commander row on a formation's card: who leads it, or a general to send. */
export function CommandRow({ fid, compact = false }: { fid: FormationId; compact?: boolean }) {
  const view = useGame((s) => s.view);
  const draft = useGame((s) => s.draft);
  const resolving = useGame((s) => s.resolving);
  const setPosting = useGame((s) => s.setPosting);
  const [picking, setPicking] = useState(false);
  useEffect(() => setPicking(false), [fid]);
  if (!view?.commanders || !draft || !canLead(view, fid)) return null;
  const lead = leaderAfter(view, draft, fid);
  const color = view.self.color;
  const pad = compact ? 'mx-3 mt-2' : 'mx-4 mt-2';
  if (lead) {
    const c = lead.general;
    return (
      <div className={`${pad} flex items-center gap-2.5 rounded-lg border border-line bg-ink-850 px-2.5 py-1.5`} data-testid="commander-card">
        <GeneralBadge c={c} color={color} size={34} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            <span className="truncate text-[13px] font-semibold">{c.name}</span>
            <span className="shrink-0 text-[11px] text-muted">{rankTitle(c.level)}</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted">
            {lead.incoming ? <span className="text-signal">Takes command as the turn resolves</span> : <XpBar c={c} />}
            <span title={COMMANDER_TRAITS[c.traits[0] ?? '']?.summary}>{traitLine(c)}</span>
            {c.offer && draft.commanders?.perks?.[c.id] === undefined && <span className="font-semibold text-signal">Promotion waiting</span>}
          </div>
          {!compact && <PerkChips c={c} />}
        </div>
        <button type="button" disabled={resolving} onClick={() => setPosting(c.id, lead.incoming ? (c.formation ?? null) : null)} className="h-9 shrink-0 rounded-md border border-line px-2 text-[11px] font-semibold tracking-wide text-muted uppercase active:bg-ink-700 disabled:opacity-40" data-testid="relieve-general">
          {lead.incoming ? 'Cancel' : 'Relieve'}
        </button>
      </div>
    );
  }
  const post = postings(view, draft);
  const free = available(view).filter((c) => post[c.id] !== fid);
  if (free.length === 0) return null;
  return (
    <div className={`${pad} rounded-lg border border-dashed border-line px-2.5 py-1.5`} data-testid="commander-card">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] text-muted">No general in command</span>
        <button type="button" disabled={resolving} onClick={() => setPicking(!picking)} aria-expanded={picking} className="h-9 rounded-md border border-signal/60 px-2.5 text-[11px] font-semibold tracking-wide text-signal uppercase active:bg-ink-700 disabled:opacity-40" data-testid="assign-general">
          {picking ? 'Close' : 'Assign general'}
        </button>
      </div>
      {picking && (
        <ul className="mt-1.5 space-y-1" data-testid="general-picker">
          {free.map((c) => {
            const at = post[c.id];
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => {
                    setPosting(c.id, fid);
                    setPicking(false);
                  }}
                  className="flex w-full items-center gap-2.5 rounded-md border border-line bg-ink-900 px-2 py-1.5 text-left active:bg-ink-700"
                  data-testid={`general-option-${c.id}`}
                >
                  <GeneralBadge c={c} color={color} size={30} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold">{c.name}</span>
                    <span className="block truncate text-[11px] text-muted">
                      {traitLine(c)} · {at ? `leads ${view.formations[at]?.name ?? 'a formation'}` : 'in reserve'}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function status(c: Commander, view: NationView, at: FormationId | null): { text: string; tone: string } {
  if (c.status === 'killed') return { text: 'Fallen in battle', tone: 'text-hostile' };
  if (c.status === 'wounded') return { text: `Wounded: back in ${c.woundedTurns} turn${c.woundedTurns === 1 ? '' : 's'}`, tone: 'text-hostile' };
  if (at) return { text: `${at === c.formation ? 'Leads' : 'Takes command of'} ${view.formations[at]?.name ?? 'a formation'}`, tone: 'text-friend' };
  return { text: c.formation ? 'Called back to the reserve' : 'In reserve', tone: 'text-muted' };
}

/** Command, Generals: every general you have, their record and their perks. */
export function GeneralsRoster() {
  const view = useGame((s) => s.view)!;
  const draft = useGame((s) => s.draft);
  const selectFormation = useGame((s) => s.selectFormation);
  const focusOn = useGame((s) => s.focusOn);
  const show = usePromotion((s) => s.show);
  const all = generalsOf(view);
  const post = postings(view, draft);
  const seen = Object.entries(view.enemyCommanders ?? {}).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  return (
    <div data-testid="generals-roster">
      <section className="border-b border-line px-3 py-3">
        <header className="mb-2.5">
          <Label>Generals ({all.filter((c) => c.status !== 'killed').length})</Label>
        </header>
        {all.length === 0 && <p className="text-[13px] text-muted">No generals serve this nation.</p>}
        <ul className="space-y-2">
          {all.map((c) => {
            const at = post[c.id] ?? null;
            const s = status(c, view, at);
            const f = at ? view.formations[at] : undefined;
            const answered = draft?.commanders?.perks?.[c.id];
            return (
              <li key={c.id} className="rounded-lg border border-line bg-ink-850 p-2.5" data-testid={`general-${c.id}`}>
                <div className="flex items-start gap-2.5">
                  <GeneralBadge c={c} color={view.self.color} size={44} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className={`truncate text-sm font-semibold ${c.status === 'killed' ? 'text-faint line-through' : ''}`}>{c.name}</span>
                      <span className="shrink-0 font-mono text-[11px] text-faint">{c.battles} battles</span>
                    </div>
                    <div className="text-[11px] text-muted">
                      {rankTitle(c.level)} · level {c.level}
                    </div>
                    <div className="mt-1">
                      <XpBar c={c} />
                    </div>
                  </div>
                </div>
                <div className="mt-2 text-[13px] leading-snug">
                  <span className="font-semibold">{traitLine(c)}</span>
                  <span className="text-muted"> · {c.traits.map((t) => COMMANDER_TRAITS[t]?.summary).join(', ')}</span>
                </div>
                <div className="mt-1.5">
                  <PerkChips c={c} />
                </div>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className={`text-[13px] ${s.tone}`}>{s.text}</span>
                  <span className="flex gap-1.5">
                    {c.offer && (
                      <button type="button" onClick={() => show(c.id)} className="h-9 rounded-md bg-signal px-2.5 text-[11px] font-bold tracking-wide text-ink-950 uppercase" data-testid={`promote-${c.id}`}>
                        {answered === undefined ? 'Choose perk' : 'Perk chosen'}
                      </button>
                    )}
                    {f && (
                      <button
                        type="button"
                        onClick={() => {
                          selectFormation(f.id);
                          focusOn(f.key);
                        }}
                        className="h-9 rounded-md border border-line px-2.5 text-[11px] font-semibold tracking-wide text-muted uppercase"
                      >
                        Show
                      </button>
                    )}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
        <p className="mt-2.5 text-[11px] leading-snug text-faint">Select a land or air formation to give it a general. Every general adds 5% attack and defence; they earn experience fighting, striking and taking cities, and each rank brings a perk.</p>
      </section>
      {seen.length > 0 && (
        <section className="px-3 py-3" data-testid="enemy-generals">
          <header className="mb-2">
            <Label>Enemy generals seen</Label>
          </header>
          <ul className="space-y-1 text-[13px]">
            {seen.map(([fid, g]) => (
              <li key={fid} className="flex justify-between gap-2">
                <span className="truncate">{g.name}</span>
                <span className="shrink-0 text-muted">
                  {view.nations[g.nation]?.name ?? g.nation} · {rankTitle(g.level)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** A level-up: two perk cards dealt face up; pick one. Unanswered, the first stands at the end of next turn. */
export function PromotionModal() {
  const view = useGame((s) => s.view);
  const draft = useGame((s) => s.draft);
  const busy = useGame((s) => s.resolving || s.playback !== null || s.showReport || s.battle !== null || s.review);
  const { open, later, show } = usePromotion();
  const waiting = view ? generalsOf(view).filter((c) => c.offer && draft?.commanders?.perks?.[c.id] === undefined && !later.includes(`${c.id}@${c.offer.turn}`)) : [];
  const auto = waiting[0]?.id ?? null;
  useEffect(() => {
    if (!busy && !open && auto) show(auto);
  }, [busy, open, auto, show]);
  const c = open && view?.commanders ? view.commanders[open] : undefined;
  if (!view || !c?.offer || busy) return null;
  return <PerkDeal key={`${c.id}@${c.offer.turn}`} c={c} color={view.self.color} chosen={draft?.commanders?.perks?.[c.id]} />;
}

function PerkDeal({ c, color, chosen }: { c: Commander; color: string; chosen: 0 | 1 | undefined }) {
  const setPerkChoice = useGame((s) => s.setPerkChoice);
  const { show, putOff } = usePromotion();
  const [pick, setPick] = useState<0 | 1>(chosen ?? 0);
  const offer = c.offer!;
  const close = () => putOff(`${c.id}@${offer.turn}`);
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-ink-950/75 sm:items-center" onClick={close} data-testid="promotion">
      <div className="vercel sheet-in safe-bottom w-full max-w-[460px] rounded-t-2xl border-t border-signal/60 bg-ink-900 px-4 pt-4 pb-3 shadow-2xl sm:rounded-2xl sm:border" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`Promotion: ${c.name}`}>
        <div className="flex items-center gap-3">
          <GeneralBadge c={c} color={color} size={48} />
          <div className="min-w-0">
            <div className="ds-label text-signal">Promotion</div>
            <div className="truncate text-lg leading-tight font-semibold">{c.name}</div>
            <div className="text-[13px] text-muted">Now {rankTitle(c.level)}. Choose one perk.</div>
          </div>
        </div>
        <div className="mt-3.5 grid grid-cols-2 gap-2.5">
          {offer.options.map((p, i) => {
            const def = PERKS[p];
            const on = pick === i;
            return (
              <button
                key={p}
                type="button"
                onClick={() => setPick(i as 0 | 1)}
                aria-pressed={on}
                data-testid={`perk-card-${i}`}
                className={`relative flex min-h-[176px] flex-col rounded-xl border-2 p-3 text-left transition-[transform,border-color] duration-[120ms] ${on ? '-translate-y-1 border-signal bg-signal/10' : 'border-line bg-ink-850'}`}
              >
                <span className="font-mono text-[11px] tracking-wide text-faint uppercase">Perk · rank {offer.level}</span>
                <span className="font-display mt-2 text-xl leading-[1.05] font-extrabold tracking-wide uppercase">{def?.name ?? p}</span>
                <span className="mt-auto text-[13px] leading-snug text-muted">{def?.summary}</span>
                {on && <span className="font-display absolute top-2 right-2 rounded-full bg-signal px-1.5 text-[11px] font-extrabold text-ink-950 uppercase">Pick</span>}
              </button>
            );
          })}
        </div>
        <div className="mt-3.5 flex gap-2">
          <button type="button" onClick={close} className="h-11 flex-1 rounded-lg border border-line text-[13px] font-semibold text-muted" data-testid="later-perk">
            Decide later
          </button>
          <button
            type="button"
            onClick={() => {
              setPerkChoice(c.id, pick);
              show(null);
            }}
            className="font-display h-11 flex-[2] rounded-lg bg-signal text-base font-extrabold tracking-wide text-ink-950 uppercase"
            data-testid="confirm-perk"
          >
            Take {perkName(offer.options[pick])}
          </button>
        </div>
        <p className="mt-2 text-center text-[11px] text-faint">Left unanswered, {perkName(offer.options[0])} is taken at the end of next turn.</p>
      </div>
    </div>
  );
}

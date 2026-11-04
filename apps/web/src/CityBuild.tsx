import type { FacilityId, Stockpile } from '@brink/contracts';
import { RESOURCES } from '@brink/contracts';
import { CITY_GROWTH, FACILITIES, FACILITY_ORDER, LEVEL_NAMES, LEVEL_SLOT_AT, LEVEL_YIELDS } from '@brink/game-data';
import { facilityCost, facilitySlots, grows, growthOf, levelProgress } from '@brink/simulation';
import { buildBlocked, recruitCostFor } from './rules-view';
import { useGame } from './store';
import { costText, Meter } from './ui';

// A city's development and its build queue: how big it is and how fast it grows, what stands
// there, what is being built (in queue order, with turns), and every facility it could start.
// Opened from the city panel; every control is a 44 px target.

/** What the draft already commits elsewhere: recruits and buildings share one stockpile. */
function reservedExcept(siteId: string): Stockpile {
  const { view, draft } = useGame.getState();
  const acc = { credits: 0, energy: 0, materials: 0, food: 0 };
  if (!view || !draft) return acc;
  for (const r of draft.recruit) {
    const c = recruitCostFor(view, r.unitClass);
    for (const res of RESOURCES) acc[res] += c[res];
  }
  for (const b of draft.build ?? []) {
    if (b.siteId === siteId) continue;
    const c = facilityCost(view.self, b.facility);
    for (const res of RESOURCES) acc[res] += c[res];
  }
  return acc;
}

export function CityBuild({ siteId }: { siteId: string }) {
  const view = useGame((s) => s.view)!;
  const draft = useGame((s) => s.draft)!;
  const setBuild = useGame((s) => s.setBuild);
  const site = view.sites[siteId];
  if (!site) return null;
  const planned = draft.build?.find((b) => b.siteId === site.id)?.facility ?? null;
  const works = view.self.construction.filter((c) => c.siteId === site.id);
  const capacity = Math.max(1, view.self.industrialCapacity);
  /** Construction takes industry in queue order, ahead of units. */
  const buildTurns = (upTo: number, extra = 0) => {
    const ahead = view.self.construction.slice(0, upTo).reduce((a, c) => a + c.required - c.progress, 0);
    return Math.max(1, Math.ceil((ahead + extra) / capacity));
  };
  const reserved = reservedExcept(site.id);
  const affordBuild = (f: FacilityId) => {
    const cost = facilityCost(view.self, f);
    return RESOURCES.every((r) => reserved[r] + cost[r] <= view.self.stockpile[r]);
  };
  const slots = facilitySlots(site);
  const used = site.facilities.length + works.length + (planned ? 1 : 0);
  const growing = grows(site.kind);
  const lp = levelProgress(site.development);
  const perTurn = growing ? growthOf({ nations: { [view.self.id]: view.self } }, site) : 0;
  const settled = view.self.stability >= CITY_GROWTH.minStability;
  const nextSlotAt = LEVEL_SLOT_AT.find((l) => l > lp.level);
  const bonus = [LEVEL_YIELDS.credits ? `+${LEVEL_YIELDS.credits} cr` : '', LEVEL_YIELDS.industry ? `+${LEVEL_YIELDS.industry} ind` : '', LEVEL_YIELDS.research ? `+${LEVEL_YIELDS.research} sci` : '']
    .filter(Boolean)
    .join(', ');
  return (
    <section className="mt-3" data-testid="facilities">
      {growing && (
        <div className="mb-3 rounded-lg border border-line bg-ink-900 p-2.5" data-testid="city-growth">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-display text-[13px] font-bold tracking-[0.04em] uppercase">
              Level {lp.level} · {LEVEL_NAMES[lp.level - 1]}
            </span>
            <span className="font-mono text-[11px] text-muted" data-testid="city-level">
              {lp.span ? `${lp.into}/${lp.span}` : 'max'}
            </span>
          </div>
          <div className="mt-1.5">
            <Meter value={lp.span ? lp.into : 1} max={lp.span || 1} tone="good" />
          </div>
          <p className="mt-1 text-[12px] leading-snug text-faint">
            {!settled
              ? `Not growing: stability under ${CITY_GROWTH.minStability}.`
              : lp.span
                ? `+${perTurn} a turn · level ${lp.level + 1} in about ${Math.max(1, Math.ceil((lp.span - lp.into) / Math.max(1, perTurn)))} turns.`
                : 'Fully grown.'}{' '}
            Each level {bonus}
            {nextSlotAt ? `; level ${nextSlotAt} opens a building slot.` : '.'} Buildings speed growth.
          </p>
        </div>
      )}

      <h3 className="font-display mb-1.5 flex justify-between text-[10px] font-bold tracking-[0.06em] text-faint uppercase">
        <span>Buildings</span>
        <span className="font-mono tracking-normal" data-testid="city-slots">
          {Math.min(used, slots)}/{slots} slots
        </span>
      </h3>
      {site.facilities.length > 0 && (
        <ul className="mb-1.5 flex flex-wrap gap-1.5">
          {site.facilities.map((f) => (
            <li key={f} className="rounded-full border border-good/50 px-2.5 py-1 text-[12px] font-semibold text-good" title={FACILITIES[f].summary} data-testid={`facility-built-${f}`}>
              {FACILITIES[f].name}
            </li>
          ))}
        </ul>
      )}
      {works.length > 0 && (
        <ol className="mb-1.5" aria-label="Build queue" data-testid="build-queue">
          {works.map((c) => (
            <li key={c.id} className="mb-1.5 rounded-lg border border-line bg-ink-900 p-2">
              <div className="flex items-center text-sm font-semibold">
                {FACILITIES[c.facility].name}
                <span className="ml-auto font-mono text-xs text-signal">{buildTurns(view.self.construction.indexOf(c) + 1)} turns</span>
              </div>
              <div className="mt-1.5">
                <Meter value={c.progress} max={c.required} />
              </div>
            </li>
          ))}
        </ol>
      )}
      <ul className="space-y-1">
        {FACILITY_ORDER.map((f) => {
          const why = buildBlocked(view, site.id, f);
          const active = planned === f;
          if (why === 'Already built' || why === 'Under construction') return null;
          const blocked = why ?? (affordBuild(f) ? null : 'Not enough in the treasury');
          const def = FACILITIES[f];
          const cost = facilityCost(view.self, f);
          return (
            <li key={f}>
              <button
                type="button"
                disabled={!!blocked && !active}
                onClick={() => setBuild(site.id, active ? null : f)}
                aria-pressed={active}
                data-testid={`facility-${f}`}
                className={`flex min-h-11 w-full items-center gap-3 rounded-lg border px-2.5 py-2 text-left disabled:cursor-not-allowed disabled:opacity-45 ${active ? 'border-signal bg-signal/15' : 'border-line bg-ink-900 hover:border-faint'}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold">{def.name}</div>
                  <div className="text-[12px] leading-snug text-muted">{def.summary}</div>
                  <div className="text-[11px] text-faint">{blocked && !active ? blocked : `${costText(cost)} · ${def.industry} ind`}</div>
                </div>
                <div className={`text-right font-mono text-xs ${active ? 'text-signal' : 'text-faint'}`}>{active ? 'queued' : `${buildTurns(view.self.construction.length, def.industry)}t`}</div>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-[11px] text-faint">One new building per site per turn, paid when the turn resolves. Construction takes industry before units, in queue order. Buildings pass to whoever takes the site.</p>
    </section>
  );
}

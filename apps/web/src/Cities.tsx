import type { FacilityId, UnitClass } from '@brink/contracts';
import { RESOURCES, UNIT_CLASSES } from '@brink/contracts';
import { FACILITIES, FACILITY_ORDER, FACILITY_SLOTS, UNITS } from '@brink/game-data';
import { hexToPixel, parseKey } from '@brink/map';
import { HEX_SIZE, useCamera } from './camera';
import { useKeys } from './chrome';
import { ModelPortrait, UnitGlyph } from './glyphs';
import { buildBlocked, recruitCostFor } from './rules-view';
import { usePhone } from './phone';
import { useGame } from './store';
import { costText } from './ui';
import { Icon } from './icons';

// Civ-style city banners floating over the map, and the production panel they open.

/** Turns to finish `required` industry when the nation's capacity is shared across its queue. */
function turnsFor(required: number, progress: number, capacity: number, queue: number): number {
  const share = Math.max(1, Math.floor(capacity / Math.max(1, queue)));
  return Math.max(1, Math.ceil((required - progress) / share));
}

export function CityBanners() {
  const view = useGame((s) => s.view);
  const draft = useGame((s) => s.draft);
  const playback = useGame((s) => s.playback);
  const selectedFormation = useGame((s) => s.selectedFormation);
  const selectedCity = useGame((s) => s.selectedCity);
  const openCity = useGame((s) => s.openCity);
  const cam = useCamera((s) => s.camera);
  const phone = usePhone();
  const v = playback?.before ?? view;
  // Zoomed out on a phone the map is political: nation names, no city banners.
  if (!v || !draft || (phone && cam.scale < 0.95)) return null;
  const queue = v.self.productionQueue;
  return (
    <div className="pointer-events-none absolute inset-0 z-[5] overflow-hidden" aria-label="Cities">
      {Object.values(v.sites)
        .filter((s) => s.kind !== 'depot' && v.tiles[s.key]?.visibility !== 'unknown')
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .map((s) => {
          const p = hexToPixel(parseKey(s.key), HEX_SIZE);
          const x = cam.x + p.x * cam.scale;
          // On a phone the banner sits under the counter, inside its own hex, so every counter stays readable.
          const y = cam.y + (p.y + (phone ? HEX_SIZE * 0.5 : -HEX_SIZE * 0.78)) * cam.scale;
          // A city the selected stack could attack shows its odds there instead.
          if (phone && selectedFormation && Object.values(v.contacts).some((c) => c.key === s.key && v.relations[c.owner] === 'war')) return null;
          const owner = s.owner ? v.nations[s.owner] : undefined;
          const mine = s.owner === v.self.id;
          const color = owner?.color ?? '#e0a84a';
          const building = queue.find((q) => q.siteId === s.id);
          const pending = draft.recruit.find((r) => r.siteId === s.id);
          const clickable = mine && (phone || !selectedFormation) && !playback;
          const capital = s.kind === 'capital';
          return (
            <button
              key={s.id}
              type="button"
              tabIndex={clickable ? 0 : -1}
              onClick={() => clickable && openCity(s.id)}
              data-testid={`city-${s.id}`}
              className={`city-banner font-display absolute flex -translate-x-1/2 ${phone ? '' : '-translate-y-full'} items-stretch overflow-hidden text-left shadow-lg ${clickable ? 'pointer-events-auto cursor-pointer' : ''} ${
                selectedCity === s.id ? 'ring-2 ring-white' : ''
              }`}
              style={{ left: x, top: y, fontSize: Math.max(9, Math.min(phone ? 10 : 13, 11 * cam.scale)) }}
              title={mine ? `${s.name}: click to set production` : s.name}
            >
              <span className="flex items-center justify-center px-1.5 font-mono font-black text-ink-950" style={{ background: color }}>
                {s.kind === 'objective' ? <Icon name="objective" className="h-3 w-3" /> : Math.max(1, Math.round(s.population / 300))}
              </span>
              <span className="flex items-center gap-1 border-y border-ink-950/60 bg-ink-950/85 px-2 py-0.5 font-bold tracking-wide whitespace-nowrap text-text uppercase">
                {capital && <Icon name="capital" className="h-2.5 w-2.5" />}
                {s.name}
                <span className="ml-1 font-mono text-[0.85em] font-semibold text-signal">{s.victoryPoints}</span>
              </span>
              {mine && (building || pending) && (
                <span className="flex items-center gap-1 bg-ink-800/95 px-1.5 text-[0.85em] text-muted">
                  <UnitGlyph unitClass={(building ?? pending)!.unitClass} color={color} className="h-2.5 w-4" />
                  {building ? `${turnsFor(building.required, building.progress, v.self.industrialCapacity, queue.length)}t` : 'new'}
                </span>
              )}
              {mine && !building && !pending && (s.kind === 'capital' || s.kind === 'city') && (
                <span className="font-display flex items-center bg-signal/90 px-1.5 text-[0.85em] font-black text-ink-950" title="Idle: nothing in production">
                  <Icon name="build" className="h-2.5 w-2.5" />
                </span>
              )}
            </button>
          );
        })}
    </div>
  );
}

export function CityPanel() {
  const view = useGame((s) => s.view)!;
  const draft = useGame((s) => s.draft)!;
  const id = useGame((s) => s.selectedCity);
  const openCity = useGame((s) => s.openCity);
  const addRecruit = useGame((s) => s.addRecruit);
  const removeRecruit = useGame((s) => s.removeRecruit);
  const setBuild = useGame((s) => s.setBuild);
  const selectFormation = useGame((s) => s.selectFormation);
  useKeys((e) => e.key === 'Escape' && id && openCity(null), [id]);
  const phone = usePhone();
  const site = id ? view.sites[id] : undefined;
  if (!site) return null;
  const color = view.self.color;
  const canRecruit = site.kind === 'capital' || site.kind === 'city';
  const pendingIndex = draft.recruit.findIndex((r) => r.siteId === site.id);
  const pending = pendingIndex >= 0 ? draft.recruit[pendingIndex] : undefined;
  const queue = view.self.productionQueue;
  const here = queue.filter((q) => q.siteId === site.id);
  const garrison = Object.values(view.formations).filter((f) => f.key === site.key);
  // What the rest of the draft already commits: recruits and buildings share one budget.
  const reservedExcept = (skipRecruit: boolean, skipBuild: boolean) => {
    const acc = { credits: 0, energy: 0, materials: 0, food: 0 };
    for (const r of draft.recruit) {
      if (skipRecruit && r.siteId === site.id) continue;
      const c = recruitCostFor(view, r.unitClass);
      for (const res of RESOURCES) acc[res] += c[res];
    }
    for (const b of draft.build ?? []) {
      if (skipBuild && b.siteId === site.id) continue;
      for (const res of RESOURCES) acc[res] += FACILITIES[b.facility].cost[res];
    }
    return acc;
  };
  const afford = (c: UnitClass) => {
    const reserved = reservedExcept(true, false);
    const cost = recruitCostFor(view, c);
    return RESOURCES.every((r) => reserved[r] + cost[r] <= view.self.stockpile[r]);
  };
  const affordBuild = (f: FacilityId) => {
    const reserved = reservedExcept(false, true);
    return RESOURCES.every((r) => reserved[r] + FACILITIES[f].cost[r] <= view.self.stockpile[r]);
  };
  const planned = draft.build?.find((b) => b.siteId === site.id)?.facility ?? null;
  const works = view.self.construction.filter((c) => c.siteId === site.id);
  /** Construction takes industry in queue order, ahead of units. */
  const buildTurns = (upTo: number, extra = 0) => {
    const ahead = view.self.construction.slice(0, upTo).reduce((a, c) => a + c.required - c.progress, 0);
    return Math.max(1, Math.ceil((ahead + extra) / Math.max(1, view.self.industrialCapacity)));
  };
  const boost = (key: 'credits' | 'energy' | 'materials' | 'food' | 'industry' | 'research') => site.facilities.reduce((a, f) => a + (FACILITIES[f].yields[key] ?? 0), 0);
  const capacity = view.self.industrialCapacity;
  return (
    <aside className={'vercel ' + (phone ? 'sheet-in safe-bottom fixed inset-x-0 bottom-0 z-30 flex max-h-[78dvh] flex-col ds-panel backdrop-blur' : 'panel-in absolute top-3 bottom-3 left-3 z-20 flex w-[340px] flex-col ds-panel backdrop-blur')} data-testid="city-panel" aria-label={`${site.name} production`}>
      <header className="flex items-center gap-3 border-b border-line px-4 py-3" style={{ background: `linear-gradient(90deg, ${color}33, transparent)` }}>
        <div className="flex h-11 w-11 items-center justify-center font-mono text-lg font-black text-ink-950" style={{ background: color }}>
          {Math.max(1, Math.round(site.population / 300))}
        </div>
        <div className="flex-1 leading-tight">
          <div className="font-display text-[10px] font-bold tracking-[0.06em] text-muted uppercase">{site.kind}</div>
          <div className="font-display text-xl font-black tracking-tight">{site.name}</div>
          <div className="text-[11px] text-muted">
            {site.population}k people · <span className="text-signal">{site.victoryPoints} VP</span>
          </div>
        </div>
        <button type="button" onClick={() => openCity(null)} className="self-start text-faint hover:text-text" aria-label="Close" data-testid="close-city">
          <Icon name="close" />
        </button>
      </header>

      <div className="grid grid-cols-6 border-b border-line text-center font-mono text-[11px]">
        {(
          [
            ['cr', site.yields.credits + boost('credits')],
            ['en', site.yields.energy + boost('energy')],
            ['mat', site.yields.materials + boost('materials')],
            ['food', site.yields.food + boost('food')],
            ['ind', site.yields.industry + boost('industry')],
            ['sci', site.yields.research + boost('research')],
          ] as const
        ).map(([l, n]) => (
          <div key={l} className="border-r border-line/50 py-1.5 last:border-r-0">
            <div className={n ? 'font-semibold text-good' : 'text-faint'}>+{n}</div>
            <div className="text-[9px] text-faint uppercase">{l}</div>
          </div>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {here.length > 0 && (
          <section className="mb-3">
            <h3 className="font-display mb-1.5 text-[10px] font-bold tracking-[0.06em] text-faint uppercase">In production</h3>
            {here.map((q) => (
              <div key={q.id} className="mb-1.5 border border-line bg-ink-900 p-2">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <UnitGlyph unitClass={q.unitClass} color={color} />
                  {UNITS[q.unitClass].name}
                  <span className="ml-auto font-mono text-xs text-signal">{turnsFor(q.required, q.progress, capacity, queue.length)} turns</span>
                </div>
                <div className="mt-1.5 h-1.5 bg-ink-700">
                  <div className="h-full bg-signal" style={{ width: `${(q.progress / q.required) * 100}%` }} />
                </div>
              </div>
            ))}
          </section>
        )}

        {canRecruit ? (
          <section>
            <h3 className="font-display mb-1.5 flex justify-between text-[10px] font-bold tracking-[0.06em] text-faint uppercase">
              <span>Choose production</span>
              <span className="font-mono tracking-normal">{capacity} ind/turn</span>
            </h3>
            <ul className="space-y-1">
              {UNIT_CLASSES.map((c) => {
                const ok = afford(c);
                const active = pending?.unitClass === c;
                const d = UNITS[c];
                return (
                  <li key={c}>
                    <button
                      type="button"
                      disabled={!ok && !active}
                      onClick={() => (active ? removeRecruit(pendingIndex) : addRecruit(site.id, c))}
                      data-testid={`build-${c}`}
                      className={`flex w-full items-center gap-3 border px-2.5 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                        active ? 'border-signal bg-signal/15' : 'border-line bg-ink-900 hover:border-faint hover:bg-ink-850'
                      }`}
                    >
                      <div className="flex h-9 w-11 items-center justify-center border border-line" style={{ background: `${color}22` }}>
                        <ModelPortrait unitClass={c} color={color} className="h-9 w-9 -rotate-90" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-bold">{d.name}</div>
                        <div className="truncate text-[10px] text-muted">{costText(recruitCostFor(view, c))}</div>
                      </div>
                      <div className="text-right font-mono text-xs">
                        <div className={active ? 'text-signal' : ''}>{turnsFor(d.industry, 0, capacity, queue.length + 1)}t</div>
                        <div className="text-[9px] text-faint">
                          atk {d.softAttack} · def {d.defense}
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
            <p className="mt-2 text-[10px] text-faint">One new order per city per turn. Paid when the turn resolves; industry is shared across everything in production.</p>
          </section>
        ) : (
          <p className="text-xs text-muted">{site.kind === 'depot' ? 'Depots supply the front; they cannot raise units.' : 'Objectives are prizes, not factories.'}</p>
        )}

        <section className="mt-3" data-testid="facilities">
          <h3 className="font-display mb-1.5 flex justify-between text-[10px] font-bold tracking-[0.06em] text-faint uppercase">
            <span>Facilities</span>
            <span className="font-mono tracking-normal">
              {site.facilities.length + works.length}/{FACILITY_SLOTS[site.kind]} slots
            </span>
          </h3>
          {site.facilities.length > 0 && (
            <ul className="mb-1.5 flex flex-wrap gap-1.5">
              {site.facilities.map((f) => (
                <li key={f} className="rounded-full border border-good/50 px-2 py-0.5 text-[11px] font-semibold text-good" title={FACILITIES[f].summary}>
                  {FACILITIES[f].name}
                </li>
              ))}
            </ul>
          )}
          {works.map((c) => (
            <div key={c.id} className="mb-1.5 border border-line bg-ink-900 p-2">
              <div className="flex items-center text-sm font-semibold">
                {FACILITIES[c.facility].name}
                <span className="ml-auto font-mono text-xs text-signal">{buildTurns(view.self.construction.indexOf(c) + 1)} turns</span>
              </div>
              <div className="mt-1.5 h-1.5 bg-ink-700">
                <div className="h-full bg-signal" style={{ width: `${(c.progress / c.required) * 100}%` }} />
              </div>
            </div>
          ))}
          <ul className="space-y-1">
            {FACILITY_ORDER.map((f) => {
              const why = buildBlocked(view, site.id, f);
              const active = planned === f;
              if (why === 'Already built' || why === 'Under construction') return null;
              const blocked = why ?? (affordBuild(f) ? null : 'Not enough in the treasury');
              const def = FACILITIES[f];
              return (
                <li key={f}>
                  <button
                    type="button"
                    disabled={!!blocked && !active}
                    onClick={() => setBuild(site.id, active ? null : f)}
                    aria-pressed={active}
                    data-testid={`facility-${f}`}
                    className={`flex min-h-11 w-full items-center gap-3 border px-2.5 py-2 text-left disabled:cursor-not-allowed disabled:opacity-45 ${active ? 'border-signal bg-signal/15' : 'border-line bg-ink-900 hover:border-faint'}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-bold">{def.name}</div>
                      <div className="text-[11px] text-muted">{def.summary}</div>
                      <div className="text-[10px] text-faint">{blocked && !active ? blocked : `${costText(def.cost)} · ${def.industry} ind`}</div>
                    </div>
                    <div className={`text-right font-mono text-xs ${active ? 'text-signal' : 'text-faint'}`}>{active ? 'queued' : `${buildTurns(view.self.construction.length, def.industry)}t`}</div>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-[10px] text-faint">One new building per site per turn, paid when the turn resolves. Construction takes industry before units. Buildings pass to whoever takes the site.</p>
        </section>

        {garrison.length > 0 && (
          <section className="mt-3">
            <h3 className="font-display mb-1.5 text-[10px] font-bold tracking-[0.06em] text-faint uppercase">Garrison</h3>
            {garrison.map((f) => (
              <button key={f.id} type="button" onClick={() => selectFormation(f.id)} className="flex w-full items-center gap-2 border border-line/60 px-2 py-1.5 text-left text-xs hover:border-faint">
                <UnitGlyph unitClass={f.unitClass} color={color} />
                <span className="flex-1">{f.name}</span>
                <span className="font-mono text-faint">{Math.round(f.strength / 10)}%</span>
              </button>
            ))}
          </section>
        )}
      </div>
    </aside>
  );
}

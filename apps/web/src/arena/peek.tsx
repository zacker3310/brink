import { bestFire, canSee, RANKS, sightRange, suppLevel, typeOf, usableWeapons, type Battle, type BattleEvent, type Effect, type FireInfo, type Point, type SoldierRole, type Unit, type Weapon } from '@brink/arena';
import { health } from './units';

// What a long-press opens: an enemy's card (what your side knows of it), what the selected unit
// could see and hit from a cell, and the full card of a unit of yours. Everything about the enemy
// comes from your side's picture: what is on show now, and what you saw happen to it.

/** One cell is 150 m of ground. */
const CELL_M = 150;

function rangeText(cells: number): string {
  const m = cells * CELL_M;
  return `${cells} ${cells === 1 ? 'cell' : 'cells'}, ${m >= 1000 ? `${(m / 1000).toLocaleString('en-GB', { maximumFractionDigits: 1 })} km` : `${m} m`}`;
}

const SEEN_EFFECT: Partial<Record<Effect, string>> = { mobility: 'Immobilised', tracks: 'Tracks hit', firepower: 'Gun out', optics: 'Optics out', crew: 'Crew hit' };
const LEVEL_TEXT = { steady: '', suppressed: 'Suppressed', pinned: 'Pinned', broken: 'Broken' } as const;
const PLACE: Partial<Record<number, string>> = { 1: 'on the road', 2: 'in the trees', 4: 'on the bridge', 5: 'in the building', 6: 'in the rubble', 8: 'in the rocks' };

function airText(w: Weapon): string {
  return w.air === 'only' ? 'Aircraft only' : w.air === 'yes' ? 'Aircraft too' : '';
}

function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button type="button" onClick={onClose} className="v-btn v-btn-secondary h-11 shrink-0 px-4 text-[15px]" data-testid="peek-close">
      Close
    </button>
  );
}

/** A seen enemy: its type, its strength as far as you have seen it fall, what you saw hit it, its weapons. */
export function EnemyCard({ b, u, onClose }: { b: Battle; u: Unit; onClose: () => void }) {
  const t = typeOf(u.type);
  const hits = b.events
    .filter((e): e is Extract<BattleEvent, { type: 'impact' }> => e.type === 'impact' && e.unit === u.id && e.seen && e.pen)
    .map((e) => SEEN_EFFECT[e.effect])
    .filter((x): x is string => !!x);
  const bits = [`${Math.round(health(u) * 100)}% strength as seen`, LEVEL_TEXT[suppLevel(u.supp)], u.overwatch ? 'On overwatch' : '', ...new Set(hits)].filter(Boolean);
  const a = t.armour;
  return (
    <div className="mb-2 rounded-xl bg-ink-900 p-3" data-testid="enemy-card">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[16px] font-bold">{t.name}</div>
          <div className="text-[13px] text-muted">{bits.join(' · ')}</div>
        </div>
        <CloseButton onClose={onClose} />
      </div>
      <ul className="mt-1.5 space-y-0.5 text-[14px] leading-snug">
        {t.weapons.slice(0, 4).map((w) => (
          <li key={w.id} className="flex justify-between gap-2">
            <span className="min-w-0 truncate font-semibold">{w.name.split(' · ')[0]}</span>
            <span className="shrink-0 text-muted">{[rangeText(w.range), airText(w)].filter(Boolean).join(' · ')}</span>
          </li>
        ))}
      </ul>
      {a && (
        <div className="mt-1 text-[13px] text-muted">
          Armour against shot: front {a.hf[0]}, side {a.side[0]}, rear {a.rear[0]} mm
        </div>
      )}
    </div>
  );
}

export interface SightRow {
  u: Unit;
  /** Its best shot from the cell, or null. */
  shot: FireInfo | null;
  /** It could see it from the cell. */
  sees: boolean;
}

/**
 * What a unit could see and hit from a cell, among the enemies its side sees now, by the rules'
 * own sight and fire functions and that side's knowledge only. Best shots first.
 */
export function sightFrom(b: Battle, me: Unit, at: Point, known: Set<string>): SightRow[] {
  const there: Unit = { ...me, x: at.x, y: at.y, moved: me.moved || at.x !== me.x || at.y !== me.y };
  return b.units
    .filter((u) => u.side !== me.side && u.alive && !u.carrier && known.has(u.id))
    .map((u) => ({ u, shot: bestFire(b, there, u, at, false, known), sees: canSee(b, there, u) }))
    .sort((p, q) => (q.shot?.chance ?? -1) - (p.shot?.chance ?? -1) || Number(q.sees) - Number(p.sees) || p.u.id.localeCompare(q.u.id));
}

/** The view from a cell for the selected unit: which enemies it could see there, and its odds on each. */
export function SightCard({ b, me, at, rows, onClose }: { b: Battle; me: Unit; at: Point; rows: SightRow[]; onClose: () => void }) {
  const steps = Math.max(Math.abs(at.x - me.x), Math.abs(at.y - me.y));
  const cell = b.map.cells[at.y * b.map.w + at.x] ?? 0;
  const seen = rows.filter((r) => r.sees || r.shot);
  const shots = rows.filter((r) => r.shot).length;
  const where = `${steps ? `${steps} ${steps === 1 ? 'cell' : 'cells'} away` : 'Where it stands'}${PLACE[cell] ? `, ${PLACE[cell]}` : ''}`;
  return (
    <div className="mb-3 rounded-xl bg-ink-900 p-3" data-testid="sight-card">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[16px] font-bold">{typeOf(me.type).short} From Here</div>
          <div className="truncate text-[13px] text-muted">{where}</div>
        </div>
        <CloseButton onClose={onClose} />
      </div>
      <p className="mt-1.5 text-[14px] leading-snug" data-testid="sight-summary">
        {rows.length ? `Sees ${seen.length} of the ${rows.length} ${rows.length === 1 ? 'enemy' : 'enemies'} in sight now; could fire on ${shots}.` : 'None of the enemy is in sight now.'}
      </p>
      {seen.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-[14px]" data-testid="sight-list">
          {seen.slice(0, 3).map((r) => (
            <li key={r.u.id} className="flex justify-between gap-2">
              <span className="truncate font-semibold">{typeOf(r.u.type).short}</span>
              <span className={`shrink-0 tabular-nums ${r.shot ? 'font-bold' : 'text-muted'}`}>{r.shot ? `${r.shot.chance}%` : 'In sight, no shot'}</span>
            </li>
          ))}
          {seen.length > 3 && <li className="text-[13px] text-muted">And {seen.length - 3} more</li>}
        </ul>
      )}
    </div>
  );
}

const ROLE_TEXT: Record<SoldierRole, string> = {
  leader: 'Leader',
  team_leader: 'Team leader',
  rifleman: 'Rifleman',
  auto_rifleman: 'Automatic rifleman',
  grenadier: 'Grenadier',
  gunner: 'Gunner',
  at: 'Anti-tank gunner',
  assistant: 'Assistant',
  marksman: 'Marksman',
  sniper: 'Sniper',
  spotter: 'Spotter',
  medic: 'Medic',
  sapper: 'Sapper',
  operator: 'Operator',
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-3">
      <h3 className="text-[13px] font-semibold text-muted">{title}</h3>
      <div className="mt-1">{children}</div>
    </section>
  );
}

/** Everything about a unit of yours: its people, every weapon with range and ammunition, its armour by facing, what it can do. */
export function UnitSheet({ b, u, status, onClose }: { b: Battle; u: Unit; status: string; onClose: () => void }) {
  const t = typeOf(u.type);
  const usable = new Set(usableWeapons(u).map((w) => w.id));
  const fit = u.men.filter((m) => m.state === 'fit');
  const roles = new Map<string, number>();
  for (const m of fit) roles.set(ROLE_TEXT[m.role], (roles.get(ROLE_TEXT[m.role]) ?? 0) + 1);
  const can = [
    `Moves ${t.move} cells a turn, twice that on a dash`,
    `Sees ${Math.round(sightRange(b, t))} cells in this light${t.thermal ? ', with thermal sights' : t.nvg ? ', with night vision' : ''}`,
    t.seats ? `Carries ${t.seats} soldiers${u.passengers.length ? `, ${u.passengers.length} ${u.passengers.length === 1 ? 'squad' : 'squads'} aboard now` : ''}` : '',
    t.stabilised ? 'Fires on the move with little loss of aim' : '',
    t.aps ? `${t.aps.name} stops ${t.aps.chance}% of missiles, ${u.aps} of ${t.aps.charges} charges left` : '',
    t.smoke ? `Smoke grenades, ${u.smoke.grenades ?? 0} of ${t.smoke} left` : '',
    t.radar ? `Radar finds aircraft within ${t.radar} cells` : '',
    t.spotter ? (t.spotter === 'laser' ? 'Lasers targets for called fire' : 'Spots for called fire') : '',
    t.flares ? 'Flares against heat-seeking missiles' : '',
    t.amphibious ? 'Swims rivers' : '',
    t.repair ? 'Repairs damaged vehicles' : '',
    t.treat ? 'Treats the wounded' : '',
    t.engineer ? 'Breaches walls, lays mines and smoke pots' : '',
    'Overwatch: fires on the first enemy that moves in sight',
  ].filter(Boolean);
  return (
    <div className="vercel absolute inset-0 z-20 flex items-end bg-black/60" data-testid="unit-sheet" onClick={onClose}>
      <div className="safe-bottom safe-x w-full" onClick={(e) => e.stopPropagation()}>
        <div className="mx-2 mb-2 max-h-[82vh] overflow-y-auto rounded-2xl bg-ink-900 p-4" role="dialog" aria-label={t.name}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[19px] leading-tight font-bold">{t.name}</div>
              <div className="text-[14px] text-muted">
                {u.name} · {RANKS[u.rank]!.name}
              </div>
            </div>
            <CloseButton onClose={onClose} />
          </div>
          <p className="mt-2 text-[14px]">{status}</p>
          <Section title={t.mobility === 'foot' ? 'Men' : 'Crew'}>
            {t.mobility === 'foot' ? (
              <p className="text-[14px]">
                {fit.length} fit of {u.men.length}
                {roles.size ? `: ${[...roles].map(([r, n]) => (n > 1 ? `${r} x${n}` : r)).join(', ')}` : ''}
              </p>
            ) : (
              <p className="text-[14px]">{t.crew ? `${u.crew} of ${t.crew}` : 'Flown from the ground'}</p>
            )}
          </Section>
          <Section title="Weapons">
            <ul className="space-y-1.5">
              {t.weapons.map((w) => (
                <li key={w.id} className="text-[14px] leading-snug">
                  <div className="font-semibold">{w.name}</div>
                  <div className="text-muted">
                    {[
                      `Range ${rangeText(w.range)}${w.minRange ? `, not under ${w.minRange}` : ''}`,
                      w.ammo === null ? 'No ammunition limit' : `${u.ammo[w.id] ?? 0} of ${w.ammo} rounds left`,
                      w.smoke ? `${u.smoke[w.id] ?? 0} smoke` : '',
                      airText(w),
                      w.indirect ? 'Fires over hills' : '',
                      w.setup ? 'Not after moving' : '',
                      usable.has(w.id) ? '' : 'Cannot fire now',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                </li>
              ))}
            </ul>
          </Section>
          <Section title="Armour">
            {t.armour ? (
              <table className="w-full text-left text-[14px] tabular-nums">
                <thead className="text-[13px] text-muted">
                  <tr>
                    <th className="py-0.5 font-semibold">Facing</th>
                    <th className="py-0.5 font-semibold">Against Shot</th>
                    <th className="py-0.5 font-semibold">Against Missiles</th>
                  </tr>
                </thead>
                <tbody>
                  {(
                    [
                      ['Turret front', t.armour.tf],
                      ['Hull front', t.armour.hf],
                      ['Side', t.armour.side],
                      ['Rear', t.armour.rear],
                      ['Top', t.armour.top],
                    ] as const
                  ).map(([k, v]) => (
                    <tr key={k}>
                      <td className="py-0.5">{k}</td>
                      <td className="py-0.5">{v[0]} mm</td>
                      <td className="py-0.5">{v[1]} mm</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-[14px]">None: cover is its protection.</p>
            )}
          </Section>
          <Section title="What It Can Do">
            <ul className="list-disc space-y-0.5 pl-5 text-[14px]">
              {can.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </Section>
          <p className="mt-3 text-[13px] text-muted">
            {t.specs.origin} · {t.specs.weight} · {t.specs.speed}
            {t.specs.note ? ` · ${t.specs.note}` : ''}
          </p>
          <p className="mt-1 text-[13px] text-muted">Strength {Math.round(health(u) * 100)}%</p>
        </div>
      </div>
    </div>
  );
}

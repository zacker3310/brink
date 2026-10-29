import { HOURS_PER_TURN, RIVER_MOVE_COST, STACK_LIMIT, TERRAIN, UNITS } from '@brink/game-data';
import { CAPTURE_ROUNDS, ROUND_LIMIT } from '@brink/arena';
import { SCENARIOS } from '@brink/scenarios';
import { costText } from '../ui';
import { Frame, Label, ScreenHeader, useKeys } from '../chrome';
import { CLASS_ORDER, VICTORY_SHARE } from './intel';
import { UnitGlyph } from '../glyphs';

// Every number on this page is read from game-data, so the manual is never out of date.

const LOOP = [
  ['Plan', 'Move, attack, recon, defend or withdraw each formation. Queue recruits, set the budget, pick research, make diplomatic moves.'],
  ['Lock', 'End the turn. Your orders seal. Three rival governments seal theirs, in secret, against the same world.'],
  ['Resolve', `The engine plays ${HOURS_PER_TURN} hours at once: movement collides, assaults land, supply flows, economies settle.`],
  ['Debrief', 'Read the after-action report. What you saw is all you know: fog hides the rest.'],
] as const;

export function Manual({ onBack }: { onBack: () => void }) {
  const scenario = SCENARIOS[0]!;
  useKeys((e) => e.key === 'Escape' && onBack(), [onBack]);
  const terrains = (Object.keys(TERRAIN) as (keyof typeof TERRAIN)[]).filter((t) => t !== 'water');

  return (
    <main className="flex min-h-full flex-col">
      <ScreenHeader kicker="Field manual" title="How war works here" onBack={onBack} />
      <div className="mx-auto grid w-full max-w-6xl gap-4 p-4 sm:p-6 lg:grid-cols-2">
        <Frame className="enter-1 p-4 lg:col-span-2">
          <Label>The turn</Label>
          <ol className="mt-3 grid gap-3 sm:grid-cols-4">
            {LOOP.map(([title, text], i) => (
              <li key={title} className="relative border-l-2 border-signal/60 pl-3">
                <div className="font-mono text-[10px] text-signal">{String(i + 1).padStart(2, '0')}</div>
                <div className="font-bold tracking-wide uppercase">{title}</div>
                <p className="mt-1 text-xs leading-relaxed text-muted">{text}</p>
              </li>
            ))}
          </ol>
        </Frame>

        <Frame className="enter-2 p-4 lg:col-span-2">
          <Label>Battles</Label>
          <p className="mt-3 text-sm text-muted">
            Attack a hex with enemies in it and you can fight the battle yourself: your formations become a company of 10 to 16 real units (tanks, IFVs carrying
            squads, helicopters, drones, guns, air defence, engineers, medics) against theirs, in turns. Each unit moves, then acts: fire (the hit chance, the chance to
            penetrate and to kill show before you commit), overwatch, hunker, smoke, dismount, call fire. Armour is thickest at the front: hit it in the side or rear. Hills
            hide what is behind them and a tank behind a crest is hull-down; smoke blocks sight for a turn; suppressed squads aim worse and can break. Each side sees only
            what its units see. Cities, capitals and objectives are taken by ending {CAPTURE_ROUNDS} rounds in the amber circle with no enemy in it; anywhere else you
            destroy them or break them; after {ROUND_LIMIT} rounds the defenders have held. Win and the hex falls when the turn ends, unless the enemy there changes first,
            in which case the odds decide. Quick resolve skips the fight and uses the odds.
          </p>
          <p className="mt-2 text-xs text-muted">
            Units rank up with experience (Veteran, Elite, Ace: more armour, steadier aim). Research unlocks battle abilities. Stars earned in battle open Skirmishes, and each war won opens
            a new theatre.
          </p>
        </Frame>

        <Frame className="enter-2 p-4">
          <Label>Victory</Label>
          <ul className="mt-3 space-y-2 text-sm">
            <li>
              <span className="font-semibold text-signal">Domination.</span> <span className="text-muted">Hold {VICTORY_SHARE}% of all victory points.</span>
            </li>
            <li>
              <span className="font-semibold text-signal">Survival.</span> <span className="text-muted">Be the last power with a city.</span>
            </li>
            <li>
              <span className="font-semibold text-signal">Attrition.</span> <span className="text-muted">Lead on victory points when turn {scenario.maxTurns} resolves.</span>
            </li>
          </ul>
          <p className="mt-3 text-xs text-muted">Capitals are worth the most, then cities, objectives and depots. Vessa, Halden Fields and Corrin Mines start unclaimed.</p>
        </Frame>

        <Frame className="enter-2 p-4">
          <Label>Hard rules</Label>
          <ul className="mt-3 space-y-1.5 text-xs text-muted">
            <li>
              Up to <span className="text-text">{STACK_LIMIT} formations</span> share a hex.
            </li>
            <li>
              Rivers cost <span className="text-text">+{RIVER_MOVE_COST} movement</span> to enter and blunt assaults across them.
            </li>
            <li>Formations outside friendly supply bleed strength every turn.</li>
            <li>Air does not hold ground. Recon sees further and spots concealed units.</li>
            <li>Combined arms pay: mixed assaults hit harder than a stack of one class.</li>
            <li>Everything is deterministic. Same seed, same orders, same war.</li>
          </ul>
        </Frame>

        <Frame className="enter-3 overflow-x-auto p-4 lg:col-span-2">
          <Label>Order of battle</Label>
          <table className="mt-3 w-full min-w-[640px] text-left text-xs">
            <thead className="font-display text-[10px] tracking-[0.06em] text-faint uppercase">
              <tr>
                <th className="py-1 font-semibold">Class</th>
                <th className="font-semibold">Move</th>
                <th className="font-semibold">Soft atk</th>
                <th className="font-semibold">Hard atk</th>
                <th className="font-semibold">Defense</th>
                <th className="font-semibold">Range</th>
                <th className="font-semibold">Vision</th>
                <th className="font-semibold">Cost</th>
              </tr>
            </thead>
            <tbody className="font-mono tabular-nums">
              {CLASS_ORDER.map((c) => {
                const u = UNITS[c];
                return (
                  <tr key={c} className="border-t border-line/50">
                    <td className="flex items-center gap-2 py-1.5 font-sans font-semibold">
                      <UnitGlyph unitClass={c} color="#e0a84a" />
                      {u.name}
                    </td>
                    <td>{u.movement || 'rebase'}</td>
                    <td>{u.softAttack}</td>
                    <td>{u.hardAttack}</td>
                    <td>{u.defense}</td>
                    <td>{u.range || '—'}</td>
                    <td>{u.vision}</td>
                    <td className="text-muted">{costText(u.cost)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Frame>

        <Frame className="enter-4 overflow-x-auto p-4">
          <Label>Terrain</Label>
          <table className="mt-3 w-full text-left text-xs">
            <thead className="font-display text-[10px] tracking-[0.06em] text-faint uppercase">
              <tr>
                <th className="py-1 font-semibold">Ground</th>
                <th className="font-semibold">Move</th>
                <th className="font-semibold">Defense</th>
                <th className="font-semibold">Armor</th>
                <th className="font-semibold">Hides</th>
              </tr>
            </thead>
            <tbody className="font-mono tabular-nums">
              {terrains.map((t) => {
                const d = TERRAIN[t];
                return (
                  <tr key={t} className="border-t border-line/50">
                    <td className="py-1.5 font-sans font-semibold">{d.name}</td>
                    <td>{d.moveCost}</td>
                    <td>+{d.defense}%</td>
                    <td className={d.armorPenalty ? 'text-hostile' : ''}>{d.armorPenalty ? `−${d.armorPenalty}%` : '—'}</td>
                    <td>{d.concealing ? 'yes' : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Frame>

        <Frame className="enter-4 p-4">
          <Label>Command controls</Label>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
            <dt className="font-semibold">Click</dt>
            <dd className="text-muted">Select a hex or formation; with a formation selected, order it there.</dd>
            <dt className="font-semibold">Drag</dt>
            <dd className="text-muted">Pan the map.</dd>
            <dt className="font-semibold">Wheel</dt>
            <dd className="text-muted">Zoom.</dd>
            <dt className="font-semibold">Right-click</dt>
            <dd className="text-muted">Deselect.</dd>
            <dt className="font-semibold">Order bar</dt>
            <dd className="text-muted">Switch between move, attack, recon and withdraw; defend in place.</dd>
          </dl>
        </Frame>

        <Frame className="enter-4 p-4 lg:col-span-2">
          <Label>Credits</Label>
          <ul className="mt-3 space-y-1 text-xs text-muted" data-testid="credits">
            <li>Ground: contains modified Copernicus Sentinel data 2023 (ESA), Poltava, Polesia, Codri, Greater Caucasus, Dnipro, Black Sea.</li>
            <li>Relief: Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the EU and ESA.</li>
            <li>Cities, refinery, depots: SpaceNet 6 Rotterdam imagery (WorldView-2, SpaceNet on AWS), CC BY-SA 4.0.</li>
            <li>T-72 tank by Nekis5_3D. AH-64D Apache by Muhamad Mirza Arrafi (CC BY 4.0). Quadcopter drone by Annelida (CC BY 4.0).</li>
            <li>Hesco barrier by polbrainstorm, watch tower by _SeF_, military tent by dark-minaz, containers by Sousinho and Sebastian Webster (all CC BY 4.0).</li>
            <li>Soldiers and animation from Mixamo (Adobe). Explosions and smoke by Kenney (CC0).</li>
            <li>
              Full list with sources and licenses:{' '}
              <a className="text-signal underline" href={`${import.meta.env.BASE_URL}art/CREDITS.md`} target="_blank" rel="noreferrer">
                art credits
              </a>
              . Renders modify the originals; no endorsement implied.
            </li>
          </ul>
        </Frame>
      </div>
    </main>
  );
}

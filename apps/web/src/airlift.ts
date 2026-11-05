import type { AirliftMode, Formation, GameEvent, HexKey, NationView } from '@brink/contracts';
import { AIRBORNE, UNITS } from '@brink/game-data';
import { airliftOrigin, airliftTargets, canAirlift, checkAirlift, liftContextOfView } from '@brink/simulation';
import { atPlace, hexLabel } from './insight';

// Airlift on the map: where a formation can fly this turn, how it would come down and the risk the
// player's own picture shows (the engine's `airliftTargets`, run on the view), and the words for it.

export interface LiftTarget {
  key: HexKey;
  mode: AirliftMode;
  /** Interception risk in percent, from the threats the view knows of. */
  chance: number;
}

let memo: { view: NationView; id: string; targets: LiftTarget[] } | null = null;

/** Every hex `f` can fly to this turn, worked out once per view and formation. */
export function liftTargets(view: NationView, f: Formation): LiftTarget[] {
  if (memo?.view !== view || memo.id !== f.id) memo = { view, id: f.id, targets: airliftTargets(view, f) };
  return memo.targets;
}

/** Whether `f` can fly from where it is this turn, and from what. */
export function liftOrigin(view: NationView, f: Formation): { name: string; range: number } | null {
  if (!canAirlift(f.unitClass)) return null;
  const o = airliftOrigin(liftContextOfView(view), f);
  return o ? { name: o.name, range: o.range } : null;
}

export const MODE_TEXT: Record<AirliftMode, string> = { airland: 'Air-land', drop: 'Drop', assault: 'Air assault' };

/** The order a tap on `key` means while aiming a lift, or why it means nothing. */
export function liftFor(view: NationView, f: Formation, key: HexKey): { target: LiftTarget; label: string } | { error: string } {
  const t = liftTargets(view, f).find((x) => x.key === key);
  if (!t) {
    const why = checkAirlift(liftContextOfView(view), f, key);
    return { error: why ? why.charAt(0).toUpperCase() + why.slice(1) : 'A power at peace holds that ground: ask it for passage first' };
  }
  const risk = t.chance > 0 ? `, ${t.chance}% risk of interception` : '';
  return { target: t, label: `${MODE_TEXT[t.mode]} ${atPlace(view, key)}${risk}` };
}

/** What a lift costs, in words. */
export const LIFT_COST = `${AIRBORNE.cost.credits} cr`;

/** The colour band for a risk: none, some, heavy. */
export function riskBand(chance: number): 'clear' | 'some' | 'heavy' {
  return chance === 0 ? 'clear' : chance < 25 ? 'some' : 'heavy';
}

/**
 * The turn's lifts for the debrief, one line each for the player's own: who came down where, and
 * what interception cost. Lifts against the player (shot at by it) in a line of their own.
 */
export function liftLines(view: NationView, events: readonly GameEvent[]): string[] {
  const out: string[] = [];
  const own = events.filter((e): e is Extract<GameEvent, { kind: 'airlift' }> => e.kind === 'airlift' && e.owner === view.self.id);
  const down = own.filter((e) => !e.aborted);
  if (down.length > 0) {
    const where = [...new Set(down.map((e) => atPlace(view, e.to)))].join(', ');
    const verb = down.every((e) => e.mode === 'airland') ? 'Air-landed' : 'Dropped';
    const hit = down.filter((e) => e.hit);
    const lost = hit.reduce((a, e) => a + e.strengthLoss, 0);
    const killed = down.filter((e) => e.destroyed).length;
    const by = [...new Set(hit.flatMap((e) => e.by))].map((n) => view.nations[n]?.name ?? n).join(' and ');
    out.push(
      `${verb} ${down.length} unit${down.length === 1 ? '' : 's'} ${where}` +
        (hit.length ? `; ${hit.length} hit by ${by} on the way in (-${Math.round(lost / 10)}% strength${killed ? `, ${killed} lost` : ''})` : '; nobody hit on the way in'),
    );
  }
  for (const e of own.filter((x) => x.aborted)) out.push(`${view.formations[e.formation]?.name ?? 'A lift'} turned back: ${e.aborted}`);
  const shot = events.filter((e): e is Extract<GameEvent, { kind: 'airlift' }> => e.kind === 'airlift' && e.owner !== view.self.id && e.by.includes(view.self.id) && e.hit);
  if (shot.length > 0) out.push(`Our air defences hit ${shot.length} enemy lift${shot.length === 1 ? '' : 's'}`);
  const seen = events.filter((e): e is Extract<GameEvent, { kind: 'airlift' }> => e.kind === 'airlift' && e.owner !== view.self.id && !e.aborted && !e.by.includes(view.self.id));
  if (seen.length > 0) out.push(`${[...new Set(seen.map((e) => view.nations[e.owner]?.name ?? e.owner))].join(' and ')} flew ${seen.length} unit${seen.length === 1 ? '' : 's'} in near ${[...new Set(seen.map((e) => hexLabel(view, e.landed)))].join(', ')}`);
  return out;
}

/** Light units that can fly from where they stand: the unit card offers them the Airlift action. */
export function canFly(view: NationView, f: Formation): boolean {
  return UNITS[f.unitClass].ground && liftOrigin(view, f) !== null;
}

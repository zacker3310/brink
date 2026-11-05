import type { Formation } from '@brink/contracts';
import { AIRBORNE } from '@brink/game-data';
import { canFly, LIFT_COST, liftOrigin, liftTargets, MODE_TEXT, riskBand } from './airlift';
import { Icon } from './icons';
import { hexLabel } from './insight';
import { useGame } from './store';

// The Airlift action on the phone's unit card: one button while the unit can fly, and while it is
// waiting for its landing hex a panel saying what the colours on the map mean, where the safest
// landing is and what the lift costs. The map does the rest (a tap there flies it).

const BAND_TEXT = { clear: 'text-friend', some: 'text-signal', heavy: 'text-hostile' } as const;

export function AirliftRow({ f }: { f: Formation }) {
  const view = useGame((s) => s.view)!;
  const aiming = useGame((s) => s.aimingLift);
  const start = useGame((s) => s.startLift);
  const cancel = useGame((s) => s.cancelLift);
  const resolving = useGame((s) => s.resolving);
  const order = useGame((s) => s.draft?.formations[f.id]);
  if (!canFly(view, f)) return null;
  const from = liftOrigin(view, f)!;
  if (aiming !== f.id) {
    return (
      <div className="px-4 pt-2">
        <button
          type="button"
          disabled={resolving}
          onClick={() => start(f.id)}
          className={`flex h-11 w-full items-center justify-center gap-2 rounded-lg border text-[13px] font-semibold tracking-wide uppercase active:bg-ink-700 disabled:opacity-30 ${order?.type === 'airlift' ? 'border-friend bg-friend/15 text-friend' : 'border-friend/60 bg-ink-850 text-friend'}`}
          data-testid="order-airlift"
        >
          <Icon name="next" className="h-4 w-4 -rotate-90" />
          {order?.type === 'airlift' ? 'Change the landing' : 'Airlift / air assault'}
          <span className="font-mono text-[11px] font-normal text-muted normal-case">
            {from.range} hexes · {LIFT_COST}
          </span>
        </button>
      </div>
    );
  }
  const targets = liftTargets(view, f);
  const safest = [...targets].sort((a, b) => a.chance - b.chance || Number(b.mode === 'airland') - Number(a.mode === 'airland') || (a.key < b.key ? -1 : 1));
  const worst = Math.max(0, ...targets.map((t) => t.chance));
  return (
    <div className="lock-in mx-4 mt-2 rounded-lg border-2 border-friend bg-friend/10 px-3 py-2.5" data-testid="airlift-aim">
      <div className="font-display text-[13px] font-extrabold tracking-[0.06em] text-friend uppercase">
        Fly from the {from.name}: tap where to come down
      </div>
      <div className="mt-1 text-[13px] text-muted">
        {targets.length} landing hexes in reach. <span className="text-friend">Blue</span> clear, <span className="text-signal">amber</span> some risk, <span className="text-hostile">red</span> heavy risk of interception
        {worst > 0 ? ` (up to ${worst}%)` : ''}. A drop comes down scattered ({AIRBORNE.dropOrganization} organization lost) and out of supply; onto a held hex it storms it at once, {AIRBORNE.assaultPenalty}% weaker.
      </div>
      {safest[0] && (
        <div className="mt-1 text-[12px]">
          Safest: <b className={BAND_TEXT[riskBand(safest[0].chance)]}>{MODE_TEXT[safest[0].mode]}</b> at {hexLabel(view, safest[0].key)}, {safest[0].chance}% risk
        </div>
      )}
      <button type="button" onClick={cancel} className="mt-2 h-11 w-full rounded-lg border border-line bg-ink-900 text-[13px] font-semibold" data-testid="cancel-airlift">
        Cancel
      </button>
    </div>
  );
}

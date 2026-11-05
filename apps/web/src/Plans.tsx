import { useMemo } from 'react';
import { create } from 'zustand';
import type { NationId, NationView, TurnReport } from '@brink/contracts';
import { operationById } from '@brink/ai';
import { crisisOf } from '@brink/scenarios';
import { useCoach } from './coach';
import { engine } from './engine';
import { Icon } from './icons';
import { idleFormations } from './insight';
import { nextObjective } from './objective';
import { ODDS_TAG, ODDS_TEXT } from './odds';
import { fightsFor, holdOrders, proposePlans, type Fight, type Plan } from './plans';
import type { ActiveOperation } from './saves';
import { useGame } from './store';

// The plan picker, the plan row on the command card, the Enter Battle button and the one-tap turn:
// what makes the war drivable with a thumb. A plan is adopted in one tap (an operation launched,
// troops dug in, peace offered); a battle is entered in one; with the staff's plan up, Execute
// ends the turn in one.

interface PlanState {
  /** The picker sheet is open (the first turn opens on it). */
  open: boolean;
  setOpen(open: boolean): void;
  /** Powers that turned peace down, and on which turn: not offered again that turn. */
  refused: { turn: number; nations: NationId[] };
  /** A city the player chose to hold: its garrison digs in every turn while the enemy is close. */
  hold: { site: string; name: string } | null;
  /** The plan as the turn was ended, for the debrief's first line. */
  before: { turn: number; operation: ActiveOperation | null; done: number; phases: number; step: string | null; hold: PlanState['hold'] } | null;
}

export const usePlans = create<PlanState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  refused: { turn: 0, nations: [] },
  hold: null,
  before: null,
}));

// The turn as it was ended: what the plan stood at, so the debrief can say what moved.
useGame.subscribe((s, p) => {
  if (!s.resolving || p.resolving || !s.view) return;
  const op = s.operation ? operationById(s.view, s.operation.id, s.operation.kind) : null;
  const now = op?.phases.find((x) => x.state === 'now');
  usePlans.setState({
    before: { turn: s.view.turn, operation: s.operation, done: op?.phases.filter((x) => x.state === 'done').length ?? 0, phases: op?.phases.length ?? 0, step: now?.title ?? null, hold: usePlans.getState().hold },
  });
});

// A held city keeps its garrison dug in each new turn while the threat lasts; the staff plans the rest.
useGame.subscribe((s, p) => {
  const hold = usePlans.getState().hold;
  if (!hold || !s.view || s.view === p.view || s.view.turn === p.view?.turn) return;
  const site = s.view.sites[hold.site];
  if (!site || site.owner !== s.view.self.id) {
    usePlans.setState({ hold: null });
    return;
  }
  const plan = proposePlans(s.view, { max: 8 }).find((x) => x.id === `hold:${hold.site}`);
  if (!plan?.hold) {
    usePlans.setState({ hold: null });
    return;
  }
  const orders = holdOrders(s.view, plan.hold);
  // After the staff has drafted (it fills only units without orders, so dug-in units stay dug in).
  setTimeout(() => {
    if (useGame.getState().view === s.view) useGame.getState().issueGroup(orders);
  }, 0);
});

/** Adopt a plan: one tap does all of it. */
export async function adopt(plan: Plan): Promise<void> {
  const g = useGame.getState();
  const view = g.view;
  if (!view || g.resolving) return;
  usePlans.setState({ open: false });
  if (plan.operation) {
    g.launchOperation(plan.operation);
    return;
  }
  if (plan.hold) {
    const orders = holdOrders(view, plan.hold);
    g.issueGroup(orders);
    g.selectFormation(null);
    const site = view.sites[plan.hold.site];
    usePlans.setState({ hold: site ? { site: site.id, name: site.name } : null });
    g.notify(`Holding ${site?.name ?? 'the line'}: ${Object.keys(orders).length} unit${Object.keys(orders).length === 1 ? '' : 's'} dig in. The staff plans the rest.`);
    if (plan.at) g.focusOn(plan.at);
    return;
  }
  if (plan.peace) {
    const nation = plan.peace.nation;
    const name = view.nations[nation]?.name ?? nation;
    // The leader answers on the spot, exactly as at resolution.
    const r = await engine.call({ type: 'negotiate', from: view.self.id, to: nation, kind: 'peace' });
    if (r.type !== 'verdict') return;
    if (r.verdict.accept) {
      useGame.getState().setDiplomacy(nation, 'propose_peace');
      g.notify(`${name} will sign: peace when the turn ends, and ${plan.peace.frees} divisions free for the main war.`);
    } else {
      const refused = usePlans.getState().refused;
      usePlans.setState({ refused: { turn: view.turn, nations: [...(refused.turn === view.turn ? refused.nations : []), nation] } });
      g.notify(`${name} turns peace down for now.`, 'warn');
    }
    return;
  }
  if (plan.kind === 'staff') g.setStaffPlan(true);
}

/** The turn's plans, recomputed only when the picture changes. */
export function usePlanList(max = 4): Plan[] {
  const view = useGame((s) => s.view);
  const operation = useGame((s) => s.operation);
  const staffPlan = useGame((s) => s.staffPlan);
  const refused = usePlans((s) => s.refused);
  const holding = usePlans((s) => s.hold);
  return useMemo(() => {
    if (!view) return [];
    const nations = refused.turn === view.turn ? refused.nations : [];
    return proposePlans(view, { operation, staffPlan, refused: nations, max: max + 1 })
      .filter((p) => p.id !== `hold:${holding?.site}`)
      .slice(0, max);
  }, [view, operation, staffPlan, refused, holding, max]);
}

const TONE: Record<string, string> = { good: 'text-good', even: 'text-signal', bad: 'text-hostile', unknown: 'text-muted' };
const KIND_ICON: Record<Plan['kind'], 'objective' | 'defense' | 'flag' | 'next'> = { operation: 'objective', hold: 'defense', peace: 'flag', staff: 'next' };

/** One plan: what, how long and how likely, and the one tap that adopts it. */
export function PlanRow({ plan, rank, compact = false, onAdopt }: { plan: Plan; rank?: number; compact?: boolean; onAdopt?: () => void }) {
  const resolving = useGame((s) => s.resolving);
  return (
    <li className={`flex items-center gap-3 ${compact ? 'py-1.5' : 'rounded-xl border border-line bg-ink-850 px-3 py-2.5'}`} data-testid="plan" data-plan={plan.id}>
      {rank !== undefined ? (
        <span className="font-display flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-signal text-[14px] font-extrabold text-signal">{rank}</span>
      ) : (
        <Icon name={KIND_ICON[plan.kind]} className="h-5 w-5 shrink-0 text-signal" />
      )}
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block truncate text-[15px] font-semibold">{plan.title}</span>
        <span className={`block truncate text-[12px] ${plan.odds ? TONE[plan.odds] : 'text-muted'}`}>{plan.line}</span>
        {!compact && <span className="mt-0.5 block text-[12px] leading-snug text-muted">{plan.why}</span>}
      </span>
      <button
        type="button"
        disabled={resolving}
        onClick={() => {
          onAdopt?.();
          void adopt(plan);
        }}
        className="font-display h-11 min-w-[5.5rem] shrink-0 rounded-lg bg-signal px-3 text-[14px] font-extrabold tracking-wide text-ink-950 uppercase active:brightness-90 disabled:opacity-40"
        data-testid="plan-adopt"
      >
        {plan.cta}
      </button>
    </li>
  );
}

/**
 * The plan picker: the staff's best few plans for this turn, each one tap. The first turn opens on
 * it, with how the game is won under it; Plans on the command card opens it any turn.
 */
export function PlanPicker({ intro = false, onClose }: { intro?: boolean; onClose: () => void }) {
  const view = useGame((s) => s.view)!;
  const operation = useGame((s) => s.operation);
  const plans = usePlanList(5);
  const goal = nextObjective(view, operation);
  const crisis = intro ? crisisOf(view.crisis) : undefined;
  const steps: [string, string][] = [
    ['Take places', `Cities and capitals are worth victory points, the minor states' most of all. Reach ${view.victoryThreshold} and you win; allies can win together, and a power far ahead in land, army and output wins by supremacy. Otherwise the best standing after turn ${view.maxTurns} wins.${goal ? ` Start with ${goal.site.name}: the amber ring.` : ''}`],
    ['Move and attack', 'Tap your tile, then a blue hex to move there. Enemies you can hit are tagged WIN, EVEN or RISKY: attack the WINs.'],
    ['End the turn', 'Everyone moves at once. Watch what happens, read the debrief, go again. Stuck? Tap Plan and your generals give every unit orders.'],
  ];
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-ink-950/70 sm:items-center" data-testid={intro ? 'how-to-win' : 'plan-picker'} onClick={intro ? undefined : onClose}>
      <div className="sheet-in safe-bottom max-h-[92dvh] w-full max-w-xl overflow-y-auto overscroll-contain rounded-t-2xl border-t border-line bg-ink-900 px-4 pt-4 sm:rounded-2xl sm:border" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Pick a plan">
        {crisis && (
          <div className="mb-3 rounded-xl border border-hostile/40 bg-hostile/10 p-3" data-testid="how-to-crisis">
            <div className="text-[11px] font-semibold tracking-[0.12em] text-hostile uppercase">Opening crisis</div>
            <div className="font-display text-xl font-extrabold uppercase">{crisis.name}</div>
            <p className="mt-1 text-[14px] leading-snug text-text/90">{crisis.story}</p>
            <p className="mt-1.5 text-[13px] leading-snug text-muted">{crisis.setup}</p>
          </div>
        )}
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="font-display text-2xl font-extrabold uppercase">Pick a plan</h2>
          <span className="font-mono text-[11px] text-faint uppercase">Turn {view.turn}</span>
        </div>
        <p className="mt-0.5 text-[13px] leading-snug text-muted">Your staff&apos;s best options, best first. One tap and the staff drafts every order for it, this turn and after; you can change any of them.</p>
        {view.difficulty === 'easy' && intro && !crisis && <p className="mt-1 text-[13px] text-good">Easy: you face one enemy. The others stay at peace with you.</p>}
        {plans.length === 0 ? (
          <p className="mt-3 text-[13px] text-muted" data-testid="plans-none">No plan to offer: you are at war with no one you can reach. Build up, or make war from the Leaders screen.</p>
        ) : (
          <ol className="mt-3 flex flex-col gap-2" data-testid="plans">
            {plans.map((p, i) => (
              <PlanRow key={p.id} plan={p} rank={i + 1} onAdopt={onClose} />
            ))}
          </ol>
        )}
        <div className="mt-3 rounded-xl border border-signal/40 bg-signal/5 p-3" data-testid="how-to-ops">
          <div className="font-display text-[13px] font-bold tracking-wide text-signal uppercase">Or let the staff run it</div>
          <p className="mt-0.5 text-[13px] leading-snug text-muted">Every operation the staff can run, phase by phase: marching, sailing, landing and the assault.</p>
          <button
            type="button"
            onClick={() => {
              onClose();
              useGame.getState().setOpsOpen(true);
            }}
            className="font-display mt-2 h-11 w-full rounded-lg border border-signal/70 text-[14px] font-extrabold tracking-wide text-signal uppercase active:bg-signal/15"
            data-testid="how-to-operations"
          >
            All operations
          </button>
        </div>
        {intro && (
          <details className="mt-3 rounded-xl border border-line px-3 py-2" data-testid="how-to-steps">
            <summary className="font-display flex h-9 cursor-pointer items-center text-base font-bold uppercase">How to win</summary>
            <ol className="mt-1 mb-1 space-y-3">
              {steps.map(([title, text], i) => (
                <li key={title} className="flex gap-3">
                  <span className="font-display flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-signal text-base font-extrabold text-ink-950">{i + 1}</span>
                  <div>
                    <div className="font-display text-[15px] font-bold uppercase">{title}</div>
                    <p className="text-[13px] leading-snug text-muted">{text}</p>
                  </div>
                </li>
              ))}
            </ol>
          </details>
        )}
        <button type="button" onClick={onClose} className="mt-3 mb-1 h-12 w-full rounded-xl border border-line text-[15px] font-semibold text-muted active:bg-ink-800" data-testid="how-to-close">
          {intro ? 'I’ll give the orders myself' : 'Close'}
        </button>
      </div>
    </div>
  );
}

/** The fights this turn's orders make, best first (`fightsFor`). */
export function useFights(): Fight[] {
  const view = useGame((s) => s.view);
  const draft = useGame((s) => s.draft);
  return useMemo(() => (view && draft ? fightsFor(view, draft) : []), [view, draft]);
}

/**
 * ENTER BATTLE: whenever an attack this turn meets enemies, one unmissable button straight into
 * the arena for the best of them, with the place and the odds, and a count when there are more.
 * Nothing renders when no fight is possible.
 */
export function EnterBattle({ className = '' }: { className?: string }) {
  const fights = useFights();
  const resolving = useGame((s) => s.resolving);
  const over = useGame((s) => !!s.view?.victory);
  const battle = useGame((s) => s.battle);
  const attack = useGame((s) => s.attack);
  const best = fights[0];
  if (!best || resolving || over || battle) return null;
  const more = fights.length - 1;
  const odds = best.odds;
  return (
    <button
      type="button"
      onClick={() => attack(best.target, best.orders)}
      className={`enter-battle font-display relative flex min-h-14 w-full items-center gap-3 overflow-hidden rounded-xl bg-signal px-3 py-2 text-left text-ink-950 shadow-lg active:brightness-90 ${className}`}
      data-testid="enter-battle"
      data-count={fights.length}
      data-target={best.target}
    >
      <Icon name="attack" className="h-7 w-7 shrink-0" />
      <span className="min-w-0 flex-1 leading-none">
        <span className="block text-[22px] font-black tracking-wide uppercase">Enter battle</span>
        <span className="mt-1 block truncate text-[13px] font-bold tracking-wide uppercase opacity-80" data-testid="enter-battle-target">
          {best.place}
          {odds ? ` · ${ODDS_TEXT[odds]}` : ''}
        </span>
      </span>
      {odds && <span className="shrink-0 rounded-md bg-ink-950 px-2 py-1 text-[13px] font-extrabold text-signal">{ODDS_TAG[odds]}</span>}
      {more > 0 && (
        <span className="absolute top-1 right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-ink-950 px-1.5 font-mono text-[11px] text-signal" data-testid="enter-battle-count" aria-label={`${fights.length} battles available`}>
          {fights.length}
        </span>
      )}
    </button>
  );
}

/**
 * One tap ends the turn when the staff's plan is up and nothing waits: no unit without orders, no
 * order the engine would refuse, no guided turn teaching the review. Otherwise End Turn opens the
 * review as before.
 */
export function useOneTap(): boolean {
  const staffPlan = useGame((s) => s.staffPlan);
  const operation = useGame((s) => s.operation);
  const planned = useGame((s) => s.planned.length);
  const rejected = useGame((s) => s.rejected.length);
  const idle = useGame((s) => (s.view && s.draft ? idleFormations(s.view, s.draft.formations).length : 1));
  const coaching = useCoach((s) => s.active);
  return (staffPlan || !!operation) && planned > 0 && idle === 0 && rejected === 0 && !coaching;
}

/** End the turn: at once when the plan is up (`useOneTap`), else through the review. */
export function endTurn(oneTap: boolean): void {
  const g = useGame.getState();
  if (oneTap) void g.submit();
  else g.openReview();
}

/** The debrief's first line: what the turn did for the plan. */
export function planLine(view: NationView, report: TurnReport, operation: ActiveOperation | null): { text: string; tone: 'good' | 'bad' | 'info' } | null {
  const before = usePlans.getState().before;
  const was = before && before.turn === report.turn ? before : null;
  if (was?.operation && (!operation || operation.id !== was.operation.id)) {
    const site = view.sites[was.operation.id.slice(5)];
    if (site?.owner === view.self.id) return { text: `${was.operation.codename} complete: ${site.name} is yours.`, tone: 'good' };
    return { text: `${was.operation.codename} called off: ${was.operation.name.replace('Take ', '')} is out of reach.`, tone: 'bad' };
  }
  if (operation) {
    const op = operationById(view, operation.id, operation.kind);
    if (!op) return null;
    const done = op.phases.filter((p) => p.state === 'done').length;
    const now = op.phases.find((p) => p.state === 'now');
    const turns = `~${op.turns} turn${op.turns === 1 ? '' : 's'} to ${op.name.replace('Take ', '')}`;
    const next = now ? `next: ${now.title.toLowerCase()} (${done}/${op.phases.length})` : `next: the assault`;
    if (was?.operation?.id === operation.id && done > was.done) {
      const step = was.step ?? 'a phase';
      return { text: `${operation.codename}: ${step.toLowerCase()} done, ${next}, ${turns}.`, tone: 'good' };
    }
    if (was?.operation?.id === operation.id) return { text: `${operation.codename}: still ${now ? now.title.toLowerCase() : 'closing in'} (${done}/${op.phases.length}), ${turns}.`, tone: 'info' };
    return { text: `${operation.codename} · ${next}, ${turns}.`, tone: 'info' };
  }
  if (was?.hold) {
    const site = view.sites[was.hold.site];
    if (site && site.owner !== view.self.id) return { text: `${was.hold.name} fell: the line did not hold.`, tone: 'bad' };
    return { text: `${was.hold.name} held.`, tone: 'good' };
  }
  return null;
}

/**
 * The command card's plan area with no operation running: the best two plans, each one tap, and
 * the way to every operation. A held city says so. With an operation up, OperationRow takes the
 * place and the plans wait behind a chip.
 */
export function CommandPlans() {
  const plans = usePlanList(2);
  const setOps = useGame((s) => s.setOpsOpen);
  const setOpen = usePlans((s) => s.setOpen);
  if (plans.length === 0) return null;
  return (
    <div className="rounded-xl border border-signal/60 bg-signal/5 px-3 pt-1.5 pb-0.5" data-testid="command-plans">
      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={() => setOpen(true)} className="font-display flex h-8 items-center gap-1.5 text-[12px] font-extrabold tracking-[0.08em] text-signal uppercase" data-testid="plans-open">
          <Icon name="objective" className="h-4 w-4" />
          Pick a plan
        </button>
        <button type="button" onClick={() => setOps(true)} className="flex h-8 items-center gap-1 text-[12px] text-muted" data-testid="operations-open">
          All operations
          <Icon name="next" className="h-3 w-3" />
        </button>
      </div>
      <ol className="divide-y divide-line/60">
        {plans.map((p) => (
          <PlanRow key={p.id} plan={p} compact />
        ))}
      </ol>
    </div>
  );
}

/** The held city, under the operation row: the standing plan and its next step. */
export function HoldRow() {
  const hold = usePlans((s) => s.hold);
  const view = useGame((s) => s.view);
  if (!hold || !view) return null;
  const n = Object.values(view.formations).filter((f) => f.key === view.sites[hold.site]?.key).length;
  return (
    <div className="mt-1.5 flex items-center gap-2 text-[13px]" data-testid="hold-plan">
      <Icon name="defense" className="h-4 w-4 shrink-0 text-friend" />
      <span className="min-w-0 flex-1 truncate">
        <b className="font-semibold">Hold {hold.name}</b>
        <span className="text-muted"> · next: stay dug in{n ? ` (${n} there)` : ''} while the enemy is close</span>
      </span>
      <button type="button" onClick={() => usePlans.setState({ hold: null })} className="h-8 shrink-0 px-2 text-[12px] text-faint" data-testid="hold-cancel">
        Stop
      </button>
    </div>
  );
}

/**
 * The desktop's plan card, over the turn controls: with no operation running, the best three plans
 * (open from the first turn); with one, its next step in plain words and the other plans a click
 * away.
 */
export function DeskPlans() {
  const view = useGame((s) => s.view);
  const operation = useGame((s) => s.operation);
  const resolving = useGame((s) => s.resolving);
  const plans = usePlanList(3);
  const open = usePlans((s) => s.open);
  const setOpen = usePlans((s) => s.setOpen);
  const step = useMemo(() => (view && operation ? operationById(view, operation.id, operation.kind) : null), [view, operation]);
  if (!view || view.victory || resolving) return null;
  const now = step?.phases.find((p) => p.state === 'now');
  const list = !operation || open;
  return (
    <div className="pointer-events-auto w-72 shrink-0 border border-signal/50 bg-ink-950/95 px-3 py-2 shadow-xl" data-testid="desk-plans">
      {operation && step && (
        <div className="text-[12px] leading-snug" data-testid="plan-next">
          <div className="font-mono text-[10px] tracking-wide text-signal uppercase">{operation.codename} · next step</div>
          <div className="text-text">{now ? `${now.title}: ${now.detail}.` : `Assault ${step.name.replace('Take ', '')}.`}</div>
        </div>
      )}
      <HoldRow />
      {plans.length > 0 && (
        <>
          <div className="mt-1 flex items-center justify-between">
            <button type="button" onClick={() => setOpen(!open)} className="font-display text-[11px] font-bold tracking-[0.08em] text-signal uppercase" data-testid="plans-open" aria-expanded={list}>
              {operation ? `Other plans (${plans.length}) ${open ? '▴' : '▾'}` : 'Pick a plan'}
            </button>
          </div>
          {list && (
            <ol className="divide-y divide-line/60" data-testid="plans">
              {plans.map((p) => (
                <PlanRow key={p.id} plan={p} compact />
              ))}
            </ol>
          )}
        </>
      )}
    </div>
  );
}

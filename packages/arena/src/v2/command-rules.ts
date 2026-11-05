import { deploying, place, whyNotPlace } from './deploy';
import { groupAct, whyNotGroup } from './groups';
import { callReserve, noteAction, whyNotReserve } from './reserves';
import { updateIntel } from './sight';
import type { Action, Battle, Side } from './types';

// Where the command actions (section 16) meet the engine: `whyNot` and `act` hand them here. Each
// is checked like any other order and rolls nothing itself; a group order plays ordinary actions.

export type CommandAction = Extract<Action, { type: 'place' | 'deployed' | 'group' | 'ungroup' | 'formation' | 'order' | 'reserve' }>;

const KINDS: ReadonlySet<string> = new Set(['place', 'deployed', 'group', 'ungroup', 'formation', 'order', 'reserve']);
/** What the deployment phase allows. */
const IN_DEPLOYMENT: ReadonlySet<string> = new Set(['place', 'deployed', 'group', 'ungroup', 'formation']);

export const isCommandAction = (a: Action): a is CommandAction => KINDS.has(a.type);

/**
 * The refusal for a command action (null: allowed), or, for any other action, 'Deploy first' while
 * blue's deployment phase is open and undefined otherwise (the engine's own rules decide).
 */
export function commandWhyNot(b: Battle, a: Action, side: Side): string | null | undefined {
  if (deploying(b) && side === 'blue' && !IN_DEPLOYMENT.has(a.type)) return 'Deploy first';
  if (!isCommandAction(a)) return undefined;
  switch (a.type) {
    case 'place':
      return whyNotPlace(b, a, side);
    case 'deployed':
      return deploying(b) && side === 'blue' ? null : 'Deployment is over';
    case 'reserve':
      return whyNotReserve(b, a, side);
    default:
      return whyNotGroup(b, a, side);
  }
}

/** Carry out a command action that `commandWhyNot` allowed. */
export function commandAct(b: Battle, a: CommandAction, side: Side, act: (b: Battle, a: Action, side: Side) => boolean): void {
  switch (a.type) {
    case 'place':
      place(b, a);
      return;
    case 'deployed':
      b.deployment!.open = false;
      updateIntel(b);
      return;
    case 'reserve':
      callReserve(b, a, side);
      return;
    default:
      if (a.type === 'order') noteAction(b, side, a);
      groupAct(b, a, side, act);
  }
}

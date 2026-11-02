import type { FormationId, FormationOrder, NationView } from '@brink/contracts';
import { UNITS } from '@brink/game-data';
import { findPath } from '@brink/map';
import { enterCost } from '@brink/simulation';
import { idleFormations } from './insight';
import { nextObjective } from './objective';
import { landOrders, loadOrders } from './planning';

// The war map's advisor: one plain sentence on what to do next, and the unit to do it with. It reads
// the same picture the player sees and is never an order; Show me selects the unit and centres it.

export interface Advice {
  text: string;
  /** The unit Show me selects. */
  focus?: FormationId;
  /** What the Show me button says. */
  cta?: string;
}

export function advise(view: NationView, drafted: Record<FormationId, FormationOrder>): Advice {
  const goal = nextObjective(view);
  const goalName = goal?.site.name ?? 'your objective';
  const own = Object.values(view.formations).sort((a, b) => (a.id < b.id ? -1 : 1));
  const transports = own.filter((f) => UNITS[f.unitClass].carries === 'ground');
  const carriers = own.filter((f) => UNITS[f.unitClass].carries === 'air');
  const free = (id: FormationId) => !drafted[id];

  // Troops at sea come first: they are what wins an island war.
  for (const t of transports) {
    const aboard = own.filter((p) => p.aboard === t.id);
    if (aboard.length === 0 || !aboard.every((p) => free(p.id)) || !free(t.id)) continue;
    if (Object.keys(landOrders(view, t, goal?.site.key ?? null)).length > 0)
      return { text: `${t.name} is off a coast with ${aboard.length} unit${aboard.length === 1 ? '' : 's'} aboard. Land them.`, focus: t.id, cta: 'Land them' };
    return { text: `${aboard.length} unit${aboard.length === 1 ? '' : 's'} aboard ${t.name}. Sail toward ${goalName}, then land.`, focus: t.id, cta: 'Show me' };
  }
  // An empty transport in or off a port with troops to carry, when the goal is across the sea.
  const overseas = goal ? !findPath(goal.by.key, goal.site.key, (_a, b) => enterCost(view.tiles[b], 'infantry')) : false;
  for (const t of transports) {
    if (!overseas || !free(t.id) || own.some((p) => p.aboard === t.id)) continue;
    const n = Object.keys(loadOrders(view, t, drafted)).length;
    if (n > 0) return { text: `${goalName} is across the sea. Load ${n} unit${n === 1 ? '' : 's'} onto ${t.name}.`, focus: t.id, cta: 'Load it' };
  }
  for (const c of carriers) {
    if (!free(c.id) || own.some((p) => p.aboard === c.id)) continue;
    const n = Object.keys(loadOrders(view, c, drafted)).length;
    if (n > 0) return { text: `Your helicopters and drones can fly from ${c.name}. Load ${n} onto it.`, focus: c.id, cta: 'Load it' };
  }
  const idle = idleFormations(view, drafted);
  if (idle.length > 0)
    return {
      text: `${idle.length} unit${idle.length === 1 ? ' is' : 's are'} waiting for orders. Next walks you through them; Plan gives everyone orders.`,
      focus: idle[0]!.id,
      cta: 'Show me',
    };
  return { text: `Everyone has orders. End the turn.` };
}

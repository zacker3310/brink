import type { HexKey, NationView } from '@brink/contracts';
import { neighborKeys } from '@brink/map';
import { enterCost, sortedKeys } from '@brink/simulation';

/** One flood fill per view: the planner asks for it several times a turn. Views are never mutated. */
const cache = new WeakMap<NationView['tiles'], Map<HexKey, number>>();

/** Land connectivity: which landmass each known hex belongs to (ground units walk within one). */
export function landmasses(view: NationView): Map<HexKey, number> {
  const hit = cache.get(view.tiles);
  if (hit) return hit;
  const out = new Map<HexKey, number>();
  cache.set(view.tiles, out);
  let id = 0;
  for (const start of sortedKeys(view.tiles)) {
    if (out.has(start) || enterCost(view.tiles[start], 'infantry') === null) continue;
    const queue = [start];
    out.set(start, id);
    while (queue.length) {
      const k = queue.pop()!;
      for (const n of neighborKeys(k)) {
        if (!out.has(n) && enterCost(view.tiles[n], 'infantry') !== null) {
          out.set(n, id);
          queue.push(n);
        }
      }
    }
    id++;
  }
  return out;
}


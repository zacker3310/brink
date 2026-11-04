import type { HexKey, NationView } from '@brink/contracts';
import { neighborKeys } from '@brink/map';
import { enterCost, sortedKeys } from '@brink/simulation';

/** Land connectivity: which landmass each known hex belongs to (ground units walk within one). */
export function landmasses(view: NationView): Map<HexKey, number> {
  const out = new Map<HexKey, number>();
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


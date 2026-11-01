import type { HexKey } from '@brink/contracts';
import { neighborKeys } from '@brink/map';

/**
 * The largest connected piece of a set of hexes: where a nation's name goes on the map. A nation
 * spread over a continent and islands (the United States with Alaska, Hawaii and Guam) is labelled
 * on its mainland, not at the average of its pieces, which can fall in the sea. Ties go to the
 * piece holding the smallest key, so the label never jumps between equal pieces.
 */
export function mainland(keys: readonly HexKey[]): HexKey[] {
  const left = new Set(keys);
  let best: HexKey[] = [];
  for (const start of [...keys].sort()) {
    if (!left.has(start)) continue;
    const piece: HexKey[] = [];
    const queue = [start];
    left.delete(start);
    while (queue.length) {
      const k = queue.pop()!;
      piece.push(k);
      for (const n of neighborKeys(k)) {
        if (left.has(n)) {
          left.delete(n);
          queue.push(n);
        }
      }
    }
    if (piece.length > best.length) best = piece;
  }
  return best;
}

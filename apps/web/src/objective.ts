import type { Formation, NationView, SiteView } from '@brink/contracts';
import { UNITS } from '@brink/game-data';
import { keyDistance } from '@brink/map';

// The one thing worth doing next: the most valuable place you do not hold, weighed by how close
// your nearest ground unit is. The map rings it and the phone HUD names it, so there is always an
// answer to "what now?".

export interface Objective {
  site: SiteView;
  /** Your closest ground unit to it. */
  by: Formation;
  distance: number;
}

export function nextObjective(view: NationView): Objective | null {
  const ground = Object.values(view.formations).filter((f) => UNITS[f.unitClass].ground);
  if (ground.length === 0) return null;
  let best: (Objective & { score: number }) | null = null;
  for (const site of Object.values(view.sites).sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (site.kind === 'depot' || site.owner === view.self.id) continue;
    if (site.owner && view.relations[site.owner] !== 'war') continue;
    if (view.tiles[site.key]?.visibility === 'unknown') continue;
    let by = ground[0]!;
    let distance = Infinity;
    for (const f of ground) {
      const d = keyDistance(f.key, site.key);
      if (d < distance) {
        distance = d;
        by = f;
      }
    }
    const score = site.victoryPoints / (distance + 1);
    if (!best || score > best.score) best = { site, by, distance, score };
  }
  return best && { site: best.site, by: best.by, distance: best.distance };
}

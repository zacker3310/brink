import { describe, expect, it } from 'vitest';
import type { GameEvent, WorldState } from '@brink/contracts';
import { DEFAULT_THEATRE, FIRST_CONTACT, theatreOf } from '@brink/scenarios';
import { blackFilesInvariants, invariants } from './invariants';
import { budget, endings, matchCount, play, seeds } from './play';

// The Black Files soak (MASTER-PLAN Phase 8 exit criteria): AI-against-AI campaigns of First Contact
// on Normal, every turn checked against every theatre's invariants and the Black Files' own, with no
// order of any AI's refused, the Visitors among them; and the Visitors winning sometimes, so the
// threat is real. A few campaigns of the theatre the toggle seeds go with them.
// `SOAK_FIRST_CONTACT_MATCHES` sets the First Contact count, else `SOAK_MATCHES` (100 by default; a
// fifth of it, at least two, for the toggle).

const MATCHES = matchCount('SOAK_FIRST_CONTACT_MATCHES', Infinity, 100);
const check = (w: WorldState) => [...invariants(w), ...blackFilesInvariants(w)];

/** What the Black Files did in a soak: wakings, artefacts dug, studies, Accord signatures, splits, hexes turned. */
function counter() {
  const n = { woke: 0, artefacts: 0, studied: 0, accords: 0, splits: 0, converted: 0 };
  const onTurn = (events: readonly GameEvent[]) => {
    for (const e of events) {
      if (e.kind !== 'black_files') continue;
      if (e.what === 'awakening') n.woke += 1;
      if (e.what === 'artefact') n.artefacts += 1;
      if (e.what === 'studied') n.studied += 1;
      if (e.what === 'accord') n.accords += 1;
      if (e.what === 'split') n.splits += 1;
      if (e.what === 'converted') n.converted += 1;
    }
  };
  return { n, onTurn };
}

describe(`Black Files soak (${MATCHES} First Contact campaigns on Normal)`, () => {
  it('First Contact: no invalid state, no refused order, and the Visitors win sometimes', { timeout: budget(MATCHES, 120) }, () => {
    const bf = counter();
    const t = play(FIRST_CONTACT.id, seeds(MATCHES), { difficulty: 'normal', check, onTurn: bf.onTurn });
    const visitors = t.endings.visitors ?? 0;
    const { n } = bf;
    console.log(
      ...endings('first contact ', t), 'visitors win', `${Math.round((visitors * 100) / MATCHES)}%`, 'woke', n.woke, 'artefacts', n.artefacts, 'studied', n.studied,
      'accord signatures', n.accords, 'swarm splits', n.splits, 'hexes converted', n.converted,
    );
    expect(t.rejected).toBe(0);
    // They wake in every campaign (by turn 9 at the latest), dig, study and sign.
    expect(n.woke).toBe(MATCHES);
    expect(n.artefacts).toBeGreaterThan(MATCHES);
    expect(n.accords).toBeGreaterThan(MATCHES);
    // The threat is real but beatable (MASTER-PLAN: about 15-25% on Normal). The bounds hold on a
    // small run too: a win at least once in twenty, never a majority.
    expect(visitors).toBeGreaterThan(0);
    expect(visitors * 2).toBeLessThan(MATCHES);
  });

  it('a campaign with the Black Files toggle on: no invalid state, no refused order', { timeout: budget(Math.max(2, Math.floor(MATCHES / 5)), 120) }, () => {
    // The toggle seeds the theatre whose map has the sites: the default one, the Pacific.
    expect(theatreOf(DEFAULT_THEATRE.id)?.blackFiles).toBe(true);
    const bf = counter();
    const t = play(DEFAULT_THEATRE.id, seeds(Math.max(2, Math.floor(MATCHES / 5))), { difficulty: 'normal', blackFiles: true, check, onTurn: bf.onTurn });
    const { n } = bf;
    console.log(...endings('pacific black files ', t), 'woke', n.woke, 'artefacts', n.artefacts, 'studied', n.studied, 'accord signatures', n.accords);
    expect(t.rejected).toBe(0);
    expect(n.woke).toBeGreaterThan(0);
  });
});

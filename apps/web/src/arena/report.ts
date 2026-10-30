import { typeOf, type Battle, type Effect } from '@brink/arena';
import { levelWord } from './film';

// The round report your turn opens with: each unit something happened to since your last turn, in the
// film's words. Every loss and change of state of yours; of theirs, what you saw. Read from the event
// log only, so a skipped film loses nothing.

export interface NewsRow {
  id: string;
  side: 'blue' | 'red';
  /** Your unit's name, or their type as you know it. */
  name: string;
  /** What happened to it: "Knocked Out", "Gun Out", "2 Down", "Pinned". */
  words: string[];
  /** It is gone. */
  lost: boolean;
}

export interface RoundNews {
  round: number;
  /** One line: "2 knocked out · 1 lost". */
  summary: string;
  /** Yours first, losses first. */
  rows: NewsRow[];
  /** The events it covers, from and to (exclusive) in the battle's log, for a battle log to open there. */
  from: number;
  to: number;
}

const GONE: Record<string, string> = { destroyed: 'Destroyed', knocked_out: 'Knocked Out', shot_down: 'Shot Down', landed: 'Forced Down', wiped: 'Wiped Out' };
const HURT: Partial<Record<Effect, string>> = { firepower: 'Gun Out', mobility: 'Immobilised', tracks: 'Tracks Hit', optics: 'Optics Out', crew: 'Crew Hit' };

export function roundNews(b: Battle, from: number): RoundNews {
  const to = b.events.length;
  type Row = NewsRow & { hurt: string[]; killed: number; wounded: number; level: string | null; gone: string | null; first: number };
  const rows = new Map<string, Row>();
  b.events.slice(from, to).forEach((e, i) => {
    if (!('unit' in e) || (e.type !== 'destroyed' && e.type !== 'impact' && e.type !== 'casualties' && e.type !== 'suppressed')) return;
    const u = b.units.find((x) => x.id === e.unit);
    if (!u || (u.side === 'red' && !e.seen)) return;
    let r = rows.get(u.id);
    if (!r) {
      r = { id: u.id, side: u.side, name: u.side === 'blue' ? u.name : typeOf(u.type).short, words: [], lost: false, hurt: [], killed: 0, wounded: 0, level: null, gone: null, first: i };
      rows.set(u.id, r);
    }
    if (e.type === 'destroyed') {
      // A drone that flew its strike is spent, not lost.
      if (e.how !== 'expended') r.gone = GONE[e.how] ?? 'Destroyed';
    } else if (e.type === 'impact') {
      const w = e.pen || e.effect === 'tracks' || e.effect === 'optics' ? HURT[e.effect] : undefined;
      if (w && !r.hurt.includes(w)) r.hurt.push(w);
    } else if (e.type === 'casualties') {
      r.killed += e.killed;
      r.wounded += e.wounded;
    } else r.level = e.level === 'steady' ? null : levelWord(e.level);
  });
  const out: NewsRow[] = [];
  for (const r of rows.values()) {
    const words = [r.gone ?? '', ...r.hurt, r.killed ? `${r.killed} Down` : '', r.wounded ? `${r.wounded} Wounded` : '', r.gone ? '' : (r.level ?? '')].filter(Boolean);
    if (words.length) out.push({ id: r.id, side: r.side, name: r.name, words, lost: !!r.gone });
  }
  const order = (r: NewsRow) => (r.side === 'blue' ? 0 : 2) + (r.lost ? 0 : 1);
  out.sort((p, q) => order(p) - order(q) || rows.get(p.id)!.first - rows.get(q.id)!.first);
  const killed = out.filter((r) => r.side === 'red' && r.lost).length;
  const lost = out.filter((r) => r.side === 'blue' && r.lost).length;
  const summary = killed || lost ? [killed ? `${killed} knocked out` : '', lost ? `${lost} lost` : ''].filter(Boolean).join(' · ') : 'No losses either side';
  return { round: b.round, summary, rows: out, from, to };
}

import type { Formation, GameEvent, HexKey, Ledger, NationView, Stockpile, TreatyKind, TurnReport, VictoryReason } from '@brink/contracts';
import { RESOURCES } from '@brink/contracts';
import { HOURS_PER_TURN, type EventEffect } from '@brink/game-data';
import { keyDistance } from '@brink/map';

// Read-only derivations for the game screen. Nothing here touches authoritative state.

/** In-world clock for the start of a turn: day and hour, six hours a turn. */
export function turnClock(turn: number): { day: number; hour: string } {
  const h = (Math.max(1, turn) - 1) * HOURS_PER_TURN;
  return { day: Math.floor(h / 24) + 1, hour: `${String(h % 24).padStart(2, '0')}:00` };
}

function place(view: NationView, key: HexKey): { name: string; exact: boolean } | null {
  const here = view.tiles[key]?.siteId;
  if (here && view.sites[here]) return { name: view.sites[here]!.name, exact: true };
  let best: { name: string; d: number } | null = null;
  for (const s of Object.values(view.sites)) {
    const d = keyDistance(key, s.key);
    if (d <= 3 && (!best || d < best.d || (d === best.d && s.name < best.name))) best = { name: s.name, d };
  }
  return best ? { name: best.name, exact: false } : null;
}

/** A hex as a player would name it: the site on it, near a site, or its coordinates. */
export function hexLabel(view: NationView, key: HexKey): string {
  const p = place(view, key);
  return p ? (p.exact ? p.name : `near ${p.name}`) : `hex ${key}`;
}

/** Location phrase for a sentence: "at Vessa", "near Vessa", "at hex 3,4". */
export function atPlace(view: NationView, key: HexKey): string {
  const p = place(view, key);
  return p ? `${p.exact ? 'at' : 'near'} ${p.name}` : `at hex ${key}`;
}

/** Destination phrase: "to Vessa", "to the Vessa area", "to hex 3,4". */
export function toPlace(view: NationView, key: HexKey): string {
  const p = place(view, key);
  return p ? (p.exact ? `to ${p.name}` : `to the ${p.name} area`) : `to hex ${key}`;
}

export function selfLedger(view: NationView, report: TurnReport | null): Ledger | null {
  const e = report?.events.find((x) => x.kind === 'economy' && x.nation === view.self.id);
  return e?.kind === 'economy' ? e.ledger : null;
}

/** Net stockpile change in a settled turn. */
export function netChange(l: Ledger): Stockpile {
  const out = { credits: 0, energy: 0, materials: 0, food: 0 } as Stockpile;
  for (const r of RESOURCES) out[r] = l.income[r] - l.upkeep[r] - l.production[r] - l.logistics[r] - l.spending[r];
  return out;
}

/** Own formations with no order in the draft, in a stable order. */
export function idleFormations(view: NationView, planned: Record<string, unknown>): Formation[] {
  return Object.values(view.formations)
    .filter((f) => !planned[f.id])
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

/** "+120 energy · −4 stability" for a world event option. */
export function describeEffect(e: EventEffect): string {
  const sign = (v: number) => (v > 0 ? `+${v}` : `−${-v}`);
  const parts: string[] = [];
  for (const r of RESOURCES) if (e.stockpile?.[r]) parts.push(`${sign(e.stockpile[r]!)} ${r}`);
  if (e.stability) parts.push(`${sign(e.stability)} stability`);
  if (e.morale) parts.push(`${sign(e.morale)} morale, all units`);
  if (e.research) parts.push(`${sign(e.research)} research`);
  return parts.length ? parts.join(' · ') : 'No effect';
}

/** What the arena had to do with an engagement, as a trailing sentence for the debrief and report. */
export function arenaNote(arena: true | 'voided' | undefined, attacking: boolean): string {
  if (arena === true) return attacking ? ' You fought it by hand.' : ' They fought it out in the field.';
  if (arena === 'voided' && attacking) return ' Your battle did not count: the enemy at the hex changed before the turn ended, so the odds decided.';
  return '';
}

/** Whether this nation won: the winner, or any member of a winning coalition. */
export function wonCampaign(view: Pick<NationView, 'victory' | 'self'>): boolean {
  const v = view.victory;
  return !!v && (v.winner === view.self.id || (v.coalition?.includes(view.self.id) ?? false));
}

/** How the campaign was decided, in a phrase: "wins by ...". */
export const VICTORY_HOW: Record<VictoryReason, string> = {
  victory_points: 'by holding the victory-point threshold (domination)',
  coalition: 'with its coalition, holding the map between them',
  supremacy: 'by supremacy: ahead in land, army and output together',
  last_standing: 'as the last nation standing',
  turn_limit: 'on strategic score at the turn limit',
};

const TREATY_NAME: Record<TreatyKind, string> = { nonaggression: 'non-aggression pact', trade: 'trade agreement', embargo: 'embargo' };

/** A treaty event as one sentence, from `me`'s side where it involves `me`. */
export function treatyText(view: Pick<NationView, 'nations' | 'self'>, e: Extract<GameEvent, { kind: 'treaty' | 'treaty_ended' }>): string {
  const me = view.self.id;
  const name = (id: string) => (id === me ? 'We' : (view.nations[id]?.name ?? id));
  const other = e.a === me ? e.b : e.b === me ? e.a : null;
  const pair = `${name(e.a)} and ${name(e.b)}`;
  if (e.kind === 'treaty') {
    if (e.treaty === 'embargo') {
      const by = e.by ?? e.a;
      const on = by === e.a ? e.b : e.a;
      return `${name(by)} embargoed ${on === me ? 'us' : (view.nations[on]?.name ?? on)}: no trade through turn ${e.until}.`;
    }
    if (other) return `We signed a ${TREATY_NAME[e.treaty]} with ${view.nations[other]?.name ?? other}, in force through turn ${e.until}.`;
    return `${pair} signed a ${TREATY_NAME[e.treaty]}, in force through turn ${e.until}.`;
  }
  const why = { expired: 'ran out', war: 'ended with the war', embargo: 'ended under an embargo' }[e.reason];
  const between = other ? `us and ${view.nations[other]?.name ?? other}` : pair;
  return `The ${TREATY_NAME[e.treaty]} between ${between} ${why}.`;
}

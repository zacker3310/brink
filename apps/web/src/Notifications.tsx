import type { HexKey, NationView, TurnReport } from '@brink/contracts';
import { EVENTS, FACILITIES, TECHS, UNITS } from '@brink/game-data';
import { arenaNote, atPlace, describeEffect, hexLabel, treatyText } from './insight';
import { useGame } from './store';

// Civ-style turn notifications: a column of icons on the right edge of the map. Hover to read,
// click to jump there, right-click to dismiss. The full turn summary stays one click away.

type Tone = 'good' | 'bad' | 'info';

interface Note {
  id: string;
  icon: string;
  tone: Tone;
  title: string;
  text: string;
  at?: HexKey;
}

export const ICON: Record<string, string> = {
  battle: 'M5 19L19 5 M14 5h5v5 M19 19L5 5 M10 5H5v5',
  strike: 'M12 2v6 M12 16v6 M2 12h6 M16 12h6 M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  flag: 'M5 21V4 M5 4h11l-2 4 2 4H5',
  skull: 'M12 3a7 7 0 0 0-4 12.7V19h8v-3.3A7 7 0 0 0 12 3z M9 11h.01 M15 11h.01 M10 19v2 M14 19v2',
  gear: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M19 5l-2 2 M7 17l-2 2',
  flask: 'M9 3h6 M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3',
  scroll: 'M6 4h11v14a2 2 0 0 1-2 2H6 M6 4a2 2 0 0 0 0 4h3 M9 9h6 M9 13h6',
  warn: 'M12 3l10 18H2z M12 10v5 M12 18h.01',
};

export const TONE: Record<Tone, string> = {
  good: 'border-good bg-good/15 text-good',
  bad: 'border-hostile bg-hostile/15 text-hostile',
  info: 'border-friend bg-friend/15 text-friend',
};

const PROPOSAL_NAME: Record<string, string> = { peace: 'peace', alliance: 'an alliance', nonaggression: 'a non-aggression pact', trade: 'trade' };

export function notesFor(view: NationView, report: TurnReport): Note[] {
  const me = view.self.id;
  const nation = (id: string | null) => (id ? (view.nations[id]?.name ?? id) : 'nobody');
  const out: Note[] = [];
  report.events.forEach((e, i) => {
    const id = `${report.turn}-${i}`;
    switch (e.kind) {
      case 'engagement': {
        const mine = e.participants.filter((p) => p.owner === me);
        if (!mine.length) break;
        const attacking = mine.some((p) => p.role === 'attacker');
        const good = attacking ? e.outcome === 'attacker_victory' : e.outcome === 'defender_held';
        const lost = mine.reduce((a, p) => a + p.strengthLoss, 0);
        const dealt = e.participants.filter((p) => p.owner !== me).reduce((a, p) => a + p.strengthLoss, 0);
        out.push({
          id,
          icon: 'battle',
          tone: e.outcome === 'inconclusive' ? 'info' : good ? 'good' : 'bad',
          title: `${e.arena === true && attacking ? 'Battle' : attacking ? 'Assault' : 'Attacked'} ${atPlace(view, e.location)}`,
          text: `${{ attacker_victory: 'The attackers broke through', defender_held: 'The defenders held', inconclusive: 'Neither side gave way' }[e.outcome]}. We lost ${lost}, they lost ${dealt}.${arenaNote(e.arena, attacking)}`,
          at: e.location,
        });
        break;
      }
      case 'strike': {
        const hitUs = e.victims.some((v) => v.owner === me);
        if (e.owner !== me && !hitUs) break;
        const loss = e.victims.reduce((a, v) => a + v.strengthLoss, 0);
        out.push({
          id,
          icon: 'strike',
          tone: e.owner === me ? 'good' : 'bad',
          title: e.owner === me ? `Our ${UNITS[e.unitClass].name.toLowerCase()} struck ${hexLabel(view, e.target)}` : `${nation(e.owner)} struck ${hexLabel(view, e.target)}`,
          text: e.victims.length ? `${loss} strength lost by the targets.` : 'No confirmed hits.',
          at: e.target,
        });
        break;
      }
      case 'site_captured':
        if (e.to !== me && e.from !== me) {
          out.push({ id, icon: 'flag', tone: 'info', title: `${view.sites[e.site]?.name} falls`, text: `${nation(e.to)} took it from ${nation(e.from)}.`, at: e.key });
        } else {
          out.push({
            id,
            icon: 'flag',
            tone: e.to === me ? 'good' : 'bad',
            title: e.to === me ? `${view.sites[e.site]?.name} captured!` : `${view.sites[e.site]?.name} lost!`,
            text: e.to === me ? `Taken from ${nation(e.from)}.` : `Taken by ${nation(e.to)}.`,
            at: e.key,
          });
        }
        break;
      case 'destroyed':
        out.push({
          id,
          icon: 'skull',
          tone: e.owner === me ? 'bad' : 'good',
          title: e.owner === me ? `${view.formations[e.formation]?.name ?? 'A formation'} destroyed` : `Enemy ${UNITS[e.unitClass].name.toLowerCase()} destroyed`,
          text: `${atPlace(view, e.at)}.`,
          at: e.at,
        });
        break;
      case 'production':
        if (e.nation === me) out.push({ id, icon: 'gear', tone: 'good', title: `${UNITS[e.unitClass].name} ready`, text: `${view.formations[e.formation]?.name ?? 'A new formation'} mustered at ${view.sites[e.site]?.name}.`, at: e.key });
        break;
      case 'recruitment_queued':
        if (e.nation === me) {
          const site = view.sites[e.site];
          out.push({ id, icon: 'gear', tone: 'info', title: `${UNITS[e.unitClass].name} in production`, text: `Work has begun at ${site?.name ?? e.site}.`, at: site?.key });
        }
        break;
      case 'production_cancelled':
        if (e.nation === me) out.push({ id, icon: 'gear', tone: 'bad', title: 'Production cancelled', text: `${view.sites[e.site]?.name}: ${e.reason}.` });
        break;
      case 'world_event':
        if (e.nation === me && e.choice === null) out.push({ id, icon: 'scroll', tone: 'info', title: `Decision: ${EVENTS[e.event].title}`, text: 'Answer it before you end the turn, or the first option stands.' });
        else if (e.nation === me && e.choice !== null) out.push({ id, icon: 'scroll', tone: 'info', title: EVENTS[e.event].title, text: `${EVENTS[e.event].options[e.choice].label}: ${describeEffect(EVENTS[e.event].options[e.choice].effect)}.` });
        break;
      case 'research':
        if (e.nation === me) out.push({ id, icon: 'flask', tone: 'good', title: 'Research complete', text: `${TECHS[e.tech]?.name}. Pick the next project.` });
        break;
      case 'diplomacy':
        if ((e.a === me || e.b === me) && e.broke && e.proposedBy !== me) {
          out.push({ id, icon: 'skull', tone: 'bad', title: `Betrayed by ${nation(e.proposedBy)}`, text: `They tore up our ${e.broke} and declared war. Their stability pays for it.` });
        } else if ((e.a === me || e.b === me) && e.broke) {
          out.push({ id, icon: 'scroll', tone: 'bad', title: `We broke the ${e.broke}`, text: `War with ${nation(e.a === me ? e.b : e.a)}. Stability −${e.broke === 'alliance' ? 20 : 10}.` });
        } else if (e.a === me || e.b === me) {
          const other = e.a === me ? e.b : e.a;
          out.push({ id, icon: 'scroll', tone: e.relation === 'war' ? 'bad' : 'good', title: `${e.relation === 'war' ? 'War' : e.relation === 'peace' ? 'Peace' : 'Alliance'} with ${nation(other)}`, text: `We are now at ${e.relation}.` });
        }
        break;
      case 'proposal':
        if (e.to === me) out.push({ id, icon: 'scroll', tone: 'info', title: `${nation(e.from)} offers ${PROPOSAL_NAME[e.proposal]}`, text: 'Answer in Diplomacy: offer it back to accept.' });
        break;
      case 'treaty':
      case 'treaty_ended':
        if (e.a === me || e.b === me) {
          const bad = (e.kind === 'treaty' && e.treaty === 'embargo') || (e.kind === 'treaty_ended' && e.treaty !== 'embargo');
          const title = e.kind === 'treaty_ended' ? 'Treaty ended' : e.treaty === 'embargo' ? 'Embargo' : e.treaty === 'trade' ? 'Trade agreement signed' : 'Non-aggression pact signed';
          out.push({ id, icon: 'scroll', tone: bad ? 'bad' : 'good', title, text: treatyText(view, e) });
        }
        break;
      case 'facility_built':
        if (e.nation === me) {
          const site = view.sites[e.site];
          out.push({ id, icon: 'gear', tone: 'good', title: `${FACILITIES[e.facility].name} built`, text: `${site?.name ?? e.site}: ${FACILITIES[e.facility].summary}`, at: site?.key });
        }
        break;
      case 'construction_cancelled':
        if (e.nation === me) out.push({ id, icon: 'gear', tone: 'bad', title: 'Construction lost', text: `${FACILITIES[e.facility].name} at ${view.sites[e.site]?.name}: ${e.reason}.` });
        break;
      case 'elimination':
        out.push({ id, icon: 'skull', tone: e.nation === me ? 'bad' : 'info', title: `${nation(e.nation)} eliminated`, text: 'A power has fallen.' });
        break;
      case 'economy':
        if (e.nation === me && e.ledger.shortages.length) out.push({ id, icon: 'warn', tone: 'bad', title: 'Shortages', text: `Out of ${e.ledger.shortages.join(', ')}: upkeep went unpaid.` });
        break;
      case 'order_rejected':
        if (e.nation === me) out.push({ id, icon: 'warn', tone: 'bad', title: 'Order rejected', text: e.reason });
        break;
    }
  });
  return out;
}

export function Notifications() {
  const view = useGame((s) => s.view);
  const report = useGame((s) => s.report);
  const playback = useGame((s) => s.playback);
  const dismissed = useGame((s) => s.dismissed);
  const dismiss = useGame((s) => s.dismissNote);
  const focusOn = useGame((s) => s.focusOn);
  const setShowReport = useGame((s) => s.setShowReport);
  if (!view || !report || playback) return null;
  const notes = notesFor(view, report).filter((n) => !dismissed.includes(n.id));
  if (notes.length === 0) return null;
  const shown = notes.slice(0, 9);
  return (
    <ul className="pointer-events-auto absolute top-14 right-3 z-10 flex flex-col items-end gap-1.5" data-testid="notifications" aria-label="Turn notifications">
      {shown.map((n) => (
        <li key={n.id} className="note-in group relative">
          <button
            type="button"
            onClick={() => {
              if (n.at) focusOn(n.at);
              else setShowReport(true);
              dismiss(n.id);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              dismiss(n.id);
            }}
            className={`flex h-10 w-10 items-center justify-center rounded-full border-2 shadow-lg transition-transform hover:scale-110 ${TONE[n.tone]}`}
            aria-label={`${n.title}. ${n.text}`}
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d={ICON[n.icon]} />
            </svg>
          </button>
          <div className="pointer-events-none absolute top-0 right-12 hidden w-64 border border-line bg-ink-950/95 px-3 py-2 text-left shadow-xl group-hover:block">
            <div className="text-xs font-bold">{n.title}</div>
            <div className="text-[11px] text-muted">{n.text}</div>
            <div className="mt-1 text-[9px] text-faint">{n.at ? 'Click to view · right-click to dismiss' : 'Click for the turn summary'}</div>
          </div>
        </li>
      ))}
      {notes.length > shown.length && (
        <li>
          <button type="button" onClick={() => setShowReport(true)} className="rounded-full border border-line bg-ink-950/90 px-2 py-1 text-[10px] text-muted hover:text-text">
            +{notes.length - shown.length} more
          </button>
        </li>
      )}
    </ul>
  );
}

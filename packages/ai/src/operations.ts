import type { Formation, FormationId, HexKey, NationView, SiteId, SiteView, UnitClass } from '@brink/contracts';
import { AIRBORNE, CARDS, STACK_LIMIT, UNITS } from '@brink/game-data';
import { findPath, keyDistance, neighborKeys } from '@brink/map';
import { enterCost, movementAllowance, previewAssault, sortedKeys } from '@brink/simulation';
import { airbornePlan, type AirbornePlan } from './airborne';
import { landmasses } from './land';

// Operations: the staff's answer to "what should I do, and how?". From the player's own picture
// (NationView only) it proposes a few named campaigns against a prize, each broken into phases that
// say where it stands this turn, what it will take, how long, and how the fight is likely to go.
// Launching one makes it the staff's objective (`planOrders` with `target`): the same planner the
// rival powers use marches, ships, lands and storms toward it, so every order it drafts is legal.

export type OperationKind = 'overland' | 'amphibious' | 'airborne';
export type PhaseState = 'done' | 'now' | 'next';
export type OperationOdds = 'good' | 'even' | 'bad' | 'unknown';

export interface OperationPhase {
  id: 'lift' | 'assemble' | 'embark' | 'sail' | 'shape' | 'land' | 'march' | 'assault' | 'stage' | 'drop' | 'hold';
  title: string;
  detail: string;
  state: PhaseState;
}

export interface Operation {
  /** `take:<siteId>`. */
  id: string;
  kind: OperationKind;
  /** "Operation Jade Hammer". */
  codename: string;
  /** "Take Taipei". */
  name: string;
  target: SiteId;
  at: HexKey;
  victoryPoints: number;
  /** One line: what it is and what it takes. */
  summary: string;
  /** The reasons the staff likes it (or does not). */
  why: string[];
  /** What stands in the way. */
  warnings: string[];
  /** Ground formations that will make the attack. */
  army: FormationId[];
  /** Ships, aircraft and guns that will clear the way and support the battle. */
  support: FormationId[];
  /** Estimated turns to the assault. */
  turns: number;
  odds: OperationOdds;
  /** Estimated enemy strength seen at the prize and next to it, 0..1000 per formation summed. */
  garrison: number;
  phases: OperationPhase[];
  /** A unit the operation is missing and where it can be built (an amphibious group, say). */
  needs?: { unitClass: UnitClass; siteId: SiteId; site: string };
  /** Higher is better; the list is sorted by it. */
  score: number;
}

const ADJ = ['Iron', 'Jade', 'Silent', 'Crimson', 'Northern', 'Granite', 'Black', 'Pale', 'Burning', 'Steel', 'Long', 'Hollow', 'Bright', 'Storm', 'Cold', 'Thunder'];
const NOUN = ['Hammer', 'Tide', 'Lance', 'Anvil', 'Harbor', 'Spear', 'Gate', 'Crown', 'Reach', 'Sabre', 'Talon', 'Shield', 'Bridge', 'Dawn', 'Fist', 'Wake'];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** A codename that stays the same for a target all campaign. */
export function codename(siteId: SiteId, seedText = ''): string {
  const h = hash(`${seedText}|${siteId}`);
  return `Operation ${ADJ[h % ADJ.length]} ${NOUN[(h >>> 8) % NOUN.length]}`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const fighting = (f: Formation) => UNITS[f.unitClass].ground && f.unitClass !== 'artillery' && f.unitClass !== 'recon';

/** Turns to walk from `from` to next to `to` over known ground, or null when the sea is in the way. */
function marchTurns(view: NationView, f: Formation, to: HexKey): number | null {
  if (f.key === to || neighborKeys(to).includes(f.key)) return 0;
  const p = findPath(f.key, to, (_a, b) => enterCost(view.tiles[b], f.unitClass));
  if (!p) return null;
  return Math.max(1, Math.ceil(p.cost / Math.max(1, movementAllowance(f))));
}

function seaTurns(view: NationView, ship: Formation, to: HexKey): number | null {
  const p = findPath(ship.key, to, (_a, b) => enterCost(view.tiles[b], ship.unitClass));
  if (!p) return null;
  return Math.ceil(p.cost / Math.max(1, movementAllowance(ship)));
}

function oddsOf(view: NationView, attackers: Formation[], key: HexKey): { odds: OperationOdds; share: number } {
  if (attackers.length === 0) return { odds: 'bad', share: 0 };
  const p = previewAssault(
    view,
    attackers.map((f) => f.id),
    key,
  );
  if (!p) return { odds: 'bad', share: 0 };
  if (p.defenders === 0) return { odds: p.confidence === 'blind' ? 'unknown' : 'good', share: 1000 };
  const win = p.outcomes.includes('attacker_victory');
  const held = p.outcomes.includes('defender_held');
  return { odds: win && !held ? 'good' : win || p.share[1] >= 450 ? 'even' : 'bad', share: Math.floor((p.share[0] + p.share[1]) / 2) };
}

const ODDS_SCORE: Record<OperationOdds, number> = { good: 40, even: 15, unknown: 5, bad: -30 };
export const ODDS_WORDS: Record<OperationOdds, string> = { good: 'likely win', even: 'even fight', bad: 'likely loss', unknown: 'garrison unseen' };

function prizes(view: NationView): SiteView[] {
  return sortedKeys(view.sites)
    .map((id) => view.sites[id]!)
    .filter((s) => s.kind !== 'depot' && s.owner !== view.self.id && (s.owner === null || view.relations[s.owner] === 'war'))
    .filter((s) => view.tiles[s.key]?.terrain != null);
}

/** Every operation the staff can see against one prize, judged from where the forces stand now. */
function judge(view: NationView, site: SiteView, land: Map<HexKey, number>, prefer?: OperationKind): Operation | null {
  // A prize no march and no landing reaches soon: the troops fly (the planner decides the same way).
  if (prefer === undefined || prefer === 'airborne') {
    const air = airbornePlan(view, site);
    if (air) return judgeAirborne(view, site, air);
  }
  const own = sortedKeys(view.formations).map((id) => view.formations[id]!);
  const goalLand = land.get(site.key);
  if (goalLand === undefined) return null;
  const ground = own.filter(fighting);
  if (ground.length === 0) return null;
  const ashore = ground.filter((f) => !f.aboard && land.get(f.key) === goalLand);
  const aboard = ground.filter((f) => f.aboard);
  const overseas = ground.filter((f) => !f.aboard && land.get(f.key) !== goalLand);
  const transports = own.filter((f) => UNITS[f.unitClass].carries === 'ground');
  const fleets = own.filter((f) => f.unitClass === 'fleet');
  const carriers = own.filter((f) => f.unitClass === 'carrier');
  const air = own.filter((f) => f.unitClass === 'air' || f.unitClass === 'drone');
  const guns = own.filter((f) => f.unitClass === 'artillery');
  const contacts = Object.values(view.contacts).filter((c) => view.relations[c.owner] === 'war' && !UNITS[c.unitClass].naval);
  const garrison = contacts.filter((c) => keyDistance(c.key, site.key) <= 1).reduce((a, c) => a + c.estimatedStrength, 0);
  const seenThere = contacts.some((c) => c.key === site.key);
  const enemyShips = Object.values(view.contacts).filter((c) => view.relations[c.owner] === 'war' && c.unitClass === 'fleet' && keyDistance(c.key, site.key) <= 4).length;
  // A landing stays a landing once the first troops are ashore (the beachhead is its last phase).
  const amphibious = prefer === 'amphibious' ? aboard.length + overseas.length > 0 || ashore.length > 0 : ashore.length < 2 && (aboard.length > 0 || overseas.length > 0);
  const kind: OperationKind = amphibious ? 'amphibious' : 'overland';
  const why: string[] = [];
  const warnings: string[] = [];
  const phases: OperationPhase[] = [];
  const name = site.name;
  let turns = 0;
  let needs: Operation['needs'];

  // Who makes the attack: the strongest fighting formations that can get there, up to two stacks.
  const army = (amphibious ? [...ashore, ...aboard, ...overseas] : ashore)
    .filter((f) => f.strength >= 300)
    .sort((a, b) => b.strength - a.strength || (a.id < b.id ? -1 : 1))
    .slice(0, STACK_LIMIT * 2);
  if (army.length === 0) return null;
  const stormers = [...army].sort((a, b) => keyDistance(a.key, site.key) - keyDistance(b.key, site.key) || b.strength - a.strength).slice(0, 4);
  const { odds } = oddsOf(view, stormers, site.key);

  const inRange = (f: Formation, r: number) => keyDistance(f.key, site.key) <= r;
  const support = [
    ...fleets.filter((f) => inRange(f, 6)),
    ...carriers.filter((f) => inRange(f, 6)),
    ...air.filter((f) => inRange(f, UNITS[f.unitClass].range + 3)),
    ...guns.filter((f) => inRange(f, UNITS[f.unitClass].range + 4)),
  ];
  const fireNow = [...air, ...guns].filter((f) => !f.aboard && inRange(f, UNITS[f.unitClass].range));
  const shapeText =
    support.length > 0
      ? `${plural(support.length, 'ship, wing or battery', 'ships, wings and batteries')} close enough to strike ${name} first and fly support in the battle`
      : 'Nothing in range to strike first: move air wings, drones or a fleet within reach for fire support in the battle';

  if (kind === 'amphibious') {
    const capacity = transports.reduce((a, t) => a + (UNITS[t.unitClass].capacity ?? 0), 0);
    const ports = sortedKeys(view.sites)
      .map((id) => view.sites[id]!)
      .filter((s) => s.owner === view.self.id && view.tiles[s.key]?.port)
      .sort((a, b) => keyDistance(a.key, site.key) - keyDistance(b.key, site.key) || (a.id < b.id ? -1 : 1));
    const port = ports.find((p) => overseas.some((f) => land.get(f.key) === land.get(p.key))) ?? ports[0];
    const loaded = aboard.length > 0;
    const atPort = port ? overseas.filter((f) => f.key === port.key) : [];
    const liftAtPort = port ? transports.some((t) => t.key === port.key) : false;
    // The beach: open shore on the prize's island nearest it.
    const beach = sortedKeys(view.tiles)
      .filter((k) => land.get(k) === goalLand && neighborKeys(k).some((n) => view.tiles[n]?.terrain === 'water'))
      .sort((a, b) => keyDistance(a, site.key) - keyDistance(b, site.key) || (a < b ? -1 : 1))[0];
    const offshore = beach ? neighborKeys(beach).filter((n) => view.tiles[n]?.terrain === 'water').sort()[0] : undefined;
    const offBeach = transports.some((t) => own.some((p) => p.aboard === t.id) && offshore && keyDistance(t.key, beach!) <= 1);

    if (transports.length === 0) {
      phases.push({ id: 'lift', title: 'Get a lift', detail: port ? `Build an Amphibious Group at ${port.name}: nothing crosses the sea without one` : 'You hold no port to build an Amphibious Group in', state: 'now' });
      if (port) needs = { unitClass: 'transport', siteId: port.id, site: port.name };
      warnings.push('No amphibious group: the army cannot cross the sea yet');
      turns += 3;
    }
    const marching = Math.max(0, ...overseas.map((f) => (port ? (marchTurns(view, f, port.key) ?? 0) : 0)));
    phases.push({
      id: 'assemble',
      title: 'Assemble',
      detail: port ? `March ${plural(army.length, 'unit')} to ${port.name} to meet the transports` : 'Gather the army at a port',
      state: loaded || ashore.length > 0 || atPort.length >= Math.min(army.length, capacity || 1) ? 'done' : transports.length ? 'now' : 'next',
    });
    turns += loaded ? 0 : marching;
    phases.push({
      id: 'embark',
      title: 'Embark',
      detail: `Load troops onto ${transports.length ? transports.map((t) => t.name).join(', ') : 'the amphibious group'}${capacity ? ` (room for ${capacity})` : ''}`,
      state: loaded || ashore.length > 0 ? 'done' : atPort.length > 0 && liftAtPort ? 'now' : 'next',
    });
    turns += loaded ? 0 : 1;
    const sailing = transports[0] && offshore ? (seaTurns(view, transports[0], offshore) ?? 3) : 3;
    phases.push({
      id: 'sail',
      title: 'Sail',
      detail: `Cross to the beach off ${name}${carriers.length + fleets.length ? ', escorted by the fleet' : ' (no escort: a fleet would shield the convoy)'}`,
      state: offBeach || ashore.length > 0 ? 'done' : loaded ? 'now' : 'next',
    });
    turns += offBeach || ashore.length > 0 ? 0 : sailing;
    phases.push({ id: 'shape', title: 'Soften up', detail: shapeText, state: fireNow.length > 0 && (loaded || offBeach) ? 'now' : 'next' });
    const landed = ashore.length > 0;
    phases.push({ id: 'land', title: 'Land', detail: 'Put the troops ashore on an open beach next to the transports', state: landed ? 'done' : offBeach ? 'now' : 'next' });
    turns += landed ? 0 : 1;
    const inland = landed ? Math.max(0, ...ashore.map((f) => marchTurns(view, f, site.key) ?? 0)) : 1;
    phases.push({ id: 'assault', title: 'Assault', detail: landed && inland > 0 ? `Push inland from the beachhead and storm ${name}` : `Storm ${name} with everyone ashore`, state: landed ? 'now' : 'next' });
    turns += inland + 1;
    if (capacity && capacity < army.length) warnings.push(`Transports carry ${capacity}; the rest follow on the next run`);
    if (enemyShips > 0) warnings.push(`${plural(enemyShips, 'enemy fleet')} near ${name}: escort the convoy or it is stopped at sea`);
    if (fleets.length + carriers.length === 0) warnings.push('No warships: no naval gunfire or carrier jets in the battle');
    why.push(`${site.victoryPoints} VP across the sea; the staff will run the whole crossing for you`);
    // A card in hand that lifts the beach penalty: say when to play it.
    const beachCard = (view.self.doctrine?.hand ?? []).map((id) => CARDS[id]).find((c) => c?.effects.some((e) => e.kind === 'amphibious'));
    if (beachCard && !landed) why.push(`Play ${beachCard.name} on the landing turn: no beach penalty for the troops going ashore`);
  } else {
    const t = Math.max(0, ...stormers.map((f) => marchTurns(view, f, site.key) ?? 0));
    const adjacent = t === 0;
    phases.push({ id: 'march', title: 'March', detail: `Move ${plural(army.length, 'unit')} up to ${name}`, state: adjacent ? 'done' : 'now' });
    turns += t;
    phases.push({ id: 'shape', title: 'Soften up', detail: shapeText, state: fireNow.length > 0 ? 'now' : 'next' });
    phases.push({ id: 'assault', title: 'Assault', detail: `Storm ${name} together, at least ${Math.min(2, army.length)} at once`, state: adjacent ? 'now' : 'next' });
    turns += 1;
    why.push(`${site.victoryPoints} VP, reachable on foot`);
  }

  if (garrison === 0) why.push(seenThere ? `${name} looks lightly held` : `No garrison seen at ${name}: send recon first, the odds are a guess`);
  else why.push(`Garrison about ${Math.round(garrison / 100)} strength in and around it; you bring ${Math.round(army.reduce((a, f) => a + f.strength, 0) / 100)}`);
  if (odds === 'bad') warnings.push('Too strong to storm as it stands: soften it up with air and guns, or bring more troops');
  if (site.kind === 'capital') why.push('A capital: taking it shakes the whole country');

  const lead = phases.find((p) => p.state === 'now') ?? phases.find((p) => p.state === 'next');
  const score = site.victoryPoints * 10 - turns * 8 + ODDS_SCORE[odds] - garrison / 100 + (kind === 'overland' ? 20 : 0) + (site.kind === 'capital' ? 10 : 0);
  return {
    id: `take:${site.id}`,
    kind,
    codename: codename(site.id, view.self.id),
    name: `Take ${name}`,
    target: site.id,
    at: site.key,
    victoryPoints: site.victoryPoints,
    summary: `${kind === 'amphibious' ? 'Amphibious landing' : 'Overland assault'}, about ${plural(Math.max(1, turns), 'turn')}, ${ODDS_WORDS[odds]}. Next: ${lead?.title.toLowerCase() ?? 'assault'}.`,
    why,
    warnings,
    army: army.map((f) => f.id),
    support: support.map((f) => f.id),
    turns: Math.max(1, turns),
    odds,
    garrison,
    phases,
    ...(needs ? { needs } : {}),
    score,
  };
}

/** The airborne operation: stage, drop, hold, assault (`airborne.ts` carries it out). */
function judgeAirborne(view: NationView, site: SiteView, air: AirbornePlan): Operation {
  const name = site.name;
  const deck = air.route === 'carrier';
  const origin = deck ? AIRBORNE.origins.carrier : air.field?.facilities.includes('airbase') ? AIRBORNE.origins.airbase : AIRBORNE.origins.capital;
  const perTurn = origin.capacity;
  const staged = deck ? !!air.carrier && air.carrier.key === air.stage && air.transports.some((t) => t.key === air.stage) : air.troops.some((f) => f.key === air.field?.key);
  const waiting = air.troops.filter((f) => !air.down.includes(f));
  const down = air.down.length;
  const phases: OperationPhase[] = [];
  let turns = 0;
  if (deck) {
    const ships = [air.carrier!, ...air.transports];
    const sail = Math.max(0, ...ships.map((s) => (s.key === air.stage ? 0 : (seaTurns(view, s, air.stage!) ?? 3))));
    turns += sail;
    phases.push({
      id: 'stage',
      title: 'Stage',
      detail: air.transports.length
        ? `Sail ${air.carrier!.name} with ${air.transports.map((t) => t.name).join(' and ')} to the sea within ${origin.range} hexes of ${name}`
        : `Bring troops aboard an amphibious group to ${air.carrier!.name} within ${origin.range} hexes of ${name}`,
      state: staged || (down > 0 && waiting.length === 0) ? 'done' : 'now',
    });
  } else {
    const gathering = Math.max(0, ...air.troops.map((f) => (f.key === air.field!.key ? 0 : (marchTurns(view, f, air.field!.key) ?? 1))));
    turns += gathering;
    phases.push({ id: 'stage', title: 'Gather', detail: `Gather light troops at ${air.field!.name}, ${origin.range} hexes of reach`, state: staged || (down > 0 && waiting.length === 0) ? 'done' : 'now' });
  }
  const flights = Math.max(1, Math.ceil(waiting.length / Math.max(1, perTurn)));
  turns += waiting.length ? flights : 0;
  phases.push({
    id: 'drop',
    title: 'Drop',
    detail: `Fly ${plural(Math.max(waiting.length, 1), 'unit')} onto the ground beside ${name}, ${perTurn} a turn${air.risk > 0 ? `; about ${air.risk}% of the lift may be shot down` : ''}`,
    state: waiting.length === 0 && down > 0 ? 'done' : staged ? 'now' : 'next',
  });
  phases.push({
    id: 'hold',
    title: 'Hold',
    detail: `Hold the drop zone until enough are down: out of supply until it takes ${name}`,
    state: down >= 3 || (down > 0 && waiting.length === 0) ? 'done' : down > 0 ? 'now' : 'next',
  });
  phases.push({ id: 'assault', title: 'Assault', detail: `Storm ${name} from the drop zone`, state: down >= 2 && (down >= 3 || waiting.length === 0) ? 'now' : 'next' });
  turns += 1;
  // The odds: the troops as they will come down beside it, scattered.
  const zone = air.zones[0]!;
  const landed: NationView = {
    ...view,
    formations: Object.fromEntries(
      sortedKeys(view.formations).map((id) => {
        const f = view.formations[id]!;
        if (!air.troops.includes(f)) return [id, f];
        const { aboard: _gone, ...rest } = f;
        void _gone;
        return [id, { ...rest, key: zone, organization: Math.max(0, f.organization - AIRBORNE.dropOrganization), readiness: Math.max(0, f.readiness - AIRBORNE.dropReadiness) }];
      }),
    ),
  };
  const army = [...air.down, ...air.troops.filter((f) => !air.down.includes(f))].slice(0, STACK_LIMIT * 2);
  const contacts = Object.values(view.contacts).filter((c) => view.relations[c.owner] === 'war' && !UNITS[c.unitClass].naval);
  const seen = contacts.filter((c) => keyDistance(c.key, site.key) <= 1).reduce((a, c) => a + c.estimatedStrength, 0);
  // A great power's city out of sight is held, seen or not: light troops dropped on it meet its garrison.
  const prior = view.tiles[site.key]?.visibility !== 'visible' && site.owner && !view.nations[site.owner]?.minor ? (site.kind === 'capital' ? 2000 : site.kind === 'city' ? 1000 : 0) : 0;
  const garrison = Math.max(seen, prior);
  const judged = oddsOf(landed, army, site.key).odds;
  const odds: OperationOdds = garrison >= 1000 && judged !== 'good' ? 'bad' : judged;
  const why = [`${site.victoryPoints} VP beyond any march or landing: the troops fly in`];
  if (deck) why.push(`From the deck: the carrier's helicopters and tiltrotors fly ${perTurn} a turn from an amphibious group lying with it`);
  else why.push(`From ${air.field!.name}: ${perTurn} a turn`);
  if (garrison === 0) why.push(`No garrison seen at ${name}: the first troops down will see it`);
  else why.push(`Garrison about ${Math.round(garrison / 100)} strength in and around it; you bring ${Math.round(army.reduce((a, f) => a + f.strength, 0) / 100)}`);
  if (site.kind === 'capital') why.push('A capital: taking it shakes the whole country, and its airport flies the next lift');
  const warnings: string[] = ['Troops come down scattered and out of supply until they take it or link up'];
  if (air.risk >= 20) warnings.push(`Enemy aircraft, ships or missile batteries cover the way in: about ${air.risk}% of the lift may be shot down`);
  if (air.troops.length === 0 && down === 0) warnings.push('No light troops ready to fly');
  if (odds === 'bad') warnings.push('Too strong to storm with what can be dropped: bring more troops in before the assault');
  const lead = phases.find((p) => p.state === 'now') ?? phases.find((p) => p.state === 'next');
  // Light troops against a garrison: what guards it weighs four times what it does for an army.
  const score = site.victoryPoints * 10 - turns * 8 + ODDS_SCORE[odds] - garrison / 25 + (site.kind === 'capital' ? 10 : 0);
  return {
    id: `take:${site.id}`,
    kind: 'airborne',
    codename: codename(site.id, view.self.id),
    name: `Take ${name}`,
    target: site.id,
    at: site.key,
    victoryPoints: site.victoryPoints,
    summary: `Airborne assault, about ${plural(Math.max(1, turns), 'turn')}, ${ODDS_WORDS[odds]}. Next: ${lead?.title.toLowerCase() ?? 'assault'}.`,
    why,
    warnings,
    army: army.map((f) => f.id),
    support: deck ? [air.carrier!.id, ...air.transports.map((t) => t.id)] : [],
    turns: Math.max(1, turns),
    odds,
    garrison,
    phases,
    score,
  };
}

/**
 * The staff's best few operations, best first: always the best overland and best amphibious one
 * when both exist, then the rest by score.
 */
export function proposeOperations(view: NationView, max = 3): Operation[] {
  if (view.victory) return [];
  const land = landmasses(view);
  const all = prizes(view)
    .map((s) => judge(view, s, land))
    .filter((o): o is Operation => o !== null)
    .sort((a, b) => b.score - a.score || (a.target < b.target ? -1 : 1));
  const picked: Operation[] = [];
  for (const kind of ['overland', 'amphibious', 'airborne'] as const) {
    const best = all.find((o) => o.kind === kind);
    if (best) picked.push(best);
  }
  for (const o of all) if (picked.length < max && !picked.includes(o)) picked.push(o);
  return picked.sort((a, b) => b.score - a.score || (a.target < b.target ? -1 : 1)).slice(0, max);
}

/** An operation by id, judged afresh against this turn's picture; null once the prize is taken or gone. */
export function operationById(view: NationView, id: string, kind?: OperationKind): Operation | null {
  if (!id.startsWith('take:')) return null;
  const site = view.sites[id.slice(5)];
  if (!site || site.owner === view.self.id) return null;
  if (site.owner !== null && view.relations[site.owner] !== 'war') return null;
  return judge(view, site, landmasses(view), kind);
}

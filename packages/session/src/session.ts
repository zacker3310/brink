import type { AiMemory, GameEvent, NationId, NationOrders, NationView, SaveFile, TurnReport, WorldState } from '@brink/contracts';
import { SAVE_FORMAT, SAVE_VERSION } from '@brink/contracts';
import { emptyMemory, planOrders, updateMemory } from '@brink/ai';
import { RULESET_VERSION } from '@brink/game-data';
import { createScenario } from '@brink/scenarios';
import { buildView, clone, hashState, lockOrders, resolveTurn, sortedKeys } from '@brink/simulation';

export interface AdvanceResult {
  /** The player's report, or every nation's when there is no player. */
  reports: Record<NationId, TurnReport>;
  events: GameEvent[];
  hash: string;
}

/**
 * One match: the authoritative world, which nations humans play (the first is the local player;
 * none for AI-only), and what each AI remembers. The UI holds a session inside a worker and only
 * ever receives views; in multiplayer the host's worker holds it and sends each seat its own.
 */
export class GameSession {
  private constructor(
    private world: WorldState,
    private seats: NationId[],
    private memory: Record<NationId, AiMemory>,
    private histories: Record<NationId, TurnReport[]>,
    private lastReports: Record<NationId, TurnReport>,
  ) {}

  /** `playerNation` is the local seat; `others` are further human seats (multiplayer, hotseat). */
  static create(scenarioId: string, seed: number, playerNation: NationId | null, others: readonly NationId[] = []): GameSession {
    const world = createScenario(scenarioId, seed);
    const humans = playerNation === null ? [] : [playerNation, ...others.filter((n) => n !== playerNation)];
    for (const n of humans) if (!world.nations[n]) throw new Error(`no such nation: ${n}`);
    if (new Set(humans).size !== humans.length) throw new Error('a nation can only have one human');
    const memory: Record<NationId, AiMemory> = {};
    for (const n of sortedKeys(world.nations)) if (!humans.includes(n)) memory[n] = emptyMemory();
    return new GameSession(world, humans, memory, Object.fromEntries(humans.map((n) => [n, []])), {});
  }

  static fromSave(save: SaveFile): GameSession {
    const humans = save.humans ?? [save.playerNation];
    const histories: Record<NationId, TurnReport[]> = { ...clone(save.histories ?? {}), [save.playerNation]: clone(save.reports) };
    const lastReports: Record<NationId, TurnReport> = {};
    for (const n of humans) {
      histories[n] ??= [];
      const last = histories[n]!.at(-1);
      if (last) lastReports[n] = last;
    }
    return new GameSession(clone(save.world), humans, clone(save.aiMemory), histories, lastReports);
  }

  /** Human seats, the local one first. */
  get humans(): readonly NationId[] {
    return this.seats;
  }

  /** A human seat's player has gone: the AI plays it until `reclaimSeat`. Its history stays. */
  releaseSeat(nation: NationId): void {
    if (nation === this.playerNation) throw new Error('the local seat cannot be handed to the AI');
    if (!this.seats.includes(nation)) return;
    this.seats = this.seats.filter((n) => n !== nation);
    this.memory[nation] = emptyMemory();
  }

  /** A player returns to a seat the AI was holding. */
  reclaimSeat(nation: NationId): void {
    if (this.seats.includes(nation) || !this.world.nations[nation]) return;
    this.seats = [...this.seats, nation];
    delete this.memory[nation];
    this.histories[nation] ??= [];
  }

  /** The local seat, or null for an AI-only session. */
  get playerNation(): NationId | null {
    return this.seats[0] ?? null;
  }

  get turn(): number {
    return this.world.turn;
  }

  get over(): boolean {
    return this.world.victory !== null;
  }

  get hash(): string {
    return hashState(this.world);
  }

  /** Read-only copy of the authoritative world, for tests and the soak harness only. */
  snapshot(): WorldState {
    return clone(this.world);
  }

  view(nation: NationId | null = this.playerNation): NationView {
    if (nation === null) throw new Error('an AI-only session has no player view');
    return buildView(this.world, nation);
  }

  reports(nation: NationId | null = this.playerNation): TurnReport[] {
    return nation ? clone(this.histories[nation] ?? []) : [];
  }

  /** Validate without resolving: what the engine would reject in these orders. */
  check(orders: NationOrders): GameEvent[] {
    return lockOrders(this.world, [orders]).rejected.filter((e) => e.kind === 'order_rejected' && e.nation === orders.nation);
  }

  aiOrders(): NationOrders[] {
    const out: NationOrders[] = [];
    for (const n of sortedKeys(this.memory)) {
      if (this.world.nations[n]!.eliminated) continue;
      out.push(planOrders(buildView(this.world, n), this.memory[n]!, this.world.seed));
    }
    return out;
  }

  /**
   * Lock the humans' orders with every AI's, resolve the turn, and move on. A human seat with no
   * submission holds. Orders for a nation that is not a human seat are ignored.
   */
  advance(humanOrders: NationOrders | readonly NationOrders[] | null = null): AdvanceResult {
    if (this.over) throw new Error('the match is over');
    const submissions = this.aiOrders();
    const given = humanOrders === null ? [] : Array.isArray(humanOrders) ? humanOrders : [humanOrders as NationOrders];
    for (const o of given) if (this.humans.includes(o.nation)) submissions.push(o);
    const result = resolveTurn(this.world, submissions);
    this.world = result.world;
    for (const n of sortedKeys(this.memory)) {
      if (this.world.nations[n]!.eliminated) continue;
      this.memory[n] = updateMemory(this.memory[n]!, result.observations[n]!, result.reports[n]!.events);
    }
    this.lastReports = result.reports;
    for (const n of this.humans) this.histories[n]!.push(result.reports[n]!);
    const reports = this.humans.length ? Object.fromEntries(this.humans.map((n) => [n, result.reports[n]!])) : result.reports;
    return { reports, events: result.events, hash: result.hash };
  }

  lastReport(nation: NationId | null = this.playerNation): TurnReport | null {
    return nation ? (this.lastReports[nation] ?? null) : null;
  }

  toSave(label: string, savedAt: string): SaveFile {
    if (!this.playerNation) throw new Error('an AI-only session cannot be saved');
    return {
      format: SAVE_FORMAT,
      saveVersion: SAVE_VERSION,
      rulesetVersion: RULESET_VERSION,
      scenarioId: this.world.scenarioId,
      turn: this.world.turn,
      playerNation: this.playerNation,
      seed: this.world.seed,
      savedAt,
      label,
      world: clone(this.world),
      reports: clone(this.histories[this.playerNation]!),
      aiMemory: clone(this.memory),
      hash: hashState(this.world),
      ...(this.humans.length > 1
        ? { humans: [...this.humans], histories: Object.fromEntries(this.humans.slice(1).map((n) => [n, clone(this.histories[n]!)])) }
        : {}),
    };
  }
}

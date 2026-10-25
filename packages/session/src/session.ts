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
 * One match: the authoritative world, which nation the human plays (null for AI-only), and
 * what each AI remembers. The UI holds a session inside a worker and only ever receives views.
 */
export class GameSession {
  private constructor(
    private world: WorldState,
    readonly playerNation: NationId | null,
    private memory: Record<NationId, AiMemory>,
    private history: TurnReport[],
    private lastReports: Record<NationId, TurnReport>,
  ) {}

  static create(scenarioId: string, seed: number, playerNation: NationId | null): GameSession {
    const world = createScenario(scenarioId, seed);
    if (playerNation !== null && !world.nations[playerNation]) throw new Error(`no such nation: ${playerNation}`);
    const memory: Record<NationId, AiMemory> = {};
    for (const n of sortedKeys(world.nations)) if (n !== playerNation) memory[n] = emptyMemory();
    return new GameSession(world, playerNation, memory, [], {});
  }

  static fromSave(save: SaveFile): GameSession {
    const last = save.reports.at(-1);
    return new GameSession(clone(save.world), save.playerNation, clone(save.aiMemory), clone(save.reports), last ? { [save.playerNation]: last } : {});
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

  reports(): TurnReport[] {
    return clone(this.history);
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

  /** Lock the player's orders with every AI's, resolve the turn, and move on. */
  advance(playerOrders: NationOrders | null = null): AdvanceResult {
    if (this.over) throw new Error('the match is over');
    const submissions = this.aiOrders();
    if (playerOrders) submissions.push(playerOrders);
    const result = resolveTurn(this.world, submissions);
    this.world = result.world;
    for (const n of sortedKeys(this.memory)) {
      if (this.world.nations[n]!.eliminated) continue;
      this.memory[n] = updateMemory(this.memory[n]!, result.observations[n]!, result.reports[n]!.events);
    }
    this.lastReports = result.reports;
    if (this.playerNation) this.history.push(result.reports[this.playerNation]!);
    const reports = this.playerNation ? { [this.playerNation]: result.reports[this.playerNation]! } : result.reports;
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
      reports: clone(this.history),
      aiMemory: clone(this.memory),
      hash: hashState(this.world),
    };
  }
}

# Overhaul plan

Written 2026-10-28 after a full audit of the repository at `c83111b`. The brief asks for a mobile-first
grand strategy game with simultaneous turns, Risk's territory, Civilization's decisions and a modern
geopolitical setting. Brink is already most of the way there. This plan sorts what to keep from what
to build and orders the work by impact.

## 1. Current architecture (audited)

| Layer | Where | State |
|---|---|---|
| Contracts | `packages/contracts` | Plain-JSON `WorldState`, `NationOrders`, `NationView`, `GameEvent`, `TurnReport`, `SaveFile`. No classes; hashable. |
| Rules data | `packages/game-data` | Unit classes, terrain, governments, techs, world events, `RULES` constants, `RULESET_VERSION`. |
| Map | `packages/map` | Axial hex math, adjacency, A* pathfinding. 18 x 13 hexes (234). |
| Simulation | `packages/simulation` | Pure `resolveTurn(world, orders[])` in 12 phases. Seeded hashing (`roll(seed, ...ids)`), sorted iteration, integer state. Fog-filtered `buildView`. |
| Scenarios | `packages/scenarios` | The Meridian map generator: four powers, 3 theatres. |
| AI | `packages/ai` | `planOrders(view, memory, seed)`: sees only the `NationView`. Threats, target choice, recruitment by observed enemy mix, odds-checked assaults, diplomacy. |
| Session | `packages/session` | `GameSession`: seats, AI turns, history, saves (`parseSave`, hash-checked). |
| Arena | `packages/arena` | Real-time hand-fought battles; results ride the orders. |
| Web | `apps/web` | React 19, zustand, PixiJS 8 map, three.js arena, Tailwind v4, Vite. Engine in a Web Worker. Phone layout (`PhoneGame.tsx`) and desktop (`Game.tsx`). |
| API | `apps/api` | Optional Fastify headless simulation. |
| Tests | per package + `tests/` | ~110 unit tests, 100-match AI soak, 4 Playwright e2e (desktop, phone, tutorial, skirmish). |

The turn pipeline (`packages/simulation/src/resolve.ts`):
validate and lock, diplomacy, production, logistics, reconnaissance, strikes, movement (discrete-event,
simultaneous), engagements, territory, economy, victory, reports. Each phase computes from one snapshot,
then commits.

**Gates at audit time:** `pnpm check` green, soak green (0 rejected AI orders), 4/4 e2e green.

## 2. Gap analysis against the brief

Already met: deterministic seeded engine with stable tie-breaks; simultaneous movement with contested
destinations and edge crossings; fog and last-known contacts; supply from capitals and depots with
interdiction; the six-resource economy (credits, energy, materials, food, plus industry and research
throughput); research with prerequisites; governments as asymmetric doctrines; AI that sees only its
view; event-driven replay; save/load with hash checks; autosave; phone portrait layout with pinch,
pan, tap targeting, safe areas; guided first match.

### The five highest-impact problems

1. **Saves break on every release.** `parseSave` rejects any save from another `RULESET_VERSION` or
   `SAVE_VERSION`. The live site ships often, so every balance change wipes players' campaigns. There is
   no migration path at all.
2. **Diplomacy is decorative.** War, peace and alliance only. No durations, no binding pacts, no trade,
   and alliances count for nothing toward victory. The brief requires treaties with explicit rules and
   durations that tie into victory.
3. **Campaigns drag.** In the 100-match soak 48% end at the turn limit and the median ending is the
   final turn. There is one decisive path (40% of victory points); no Supremacy, no Coalition, no Epic
   length.
4. **No order review before commit.** End Turn resolves at once. Players never see idle units, rejected
   orders, what they are spending against what they hold, or warnings before the world moves.
5. **The economy has no building decisions.** Income comes from fixed site yields; the only levers are
   three budget sliders and recruitment. No farms, factories, power, labs or fortifications, so economic
   strategy is shallow and shortages cannot be fixed by investment.

### Deferred (documented, not faked)

- **Naval warfare and sea regions.** The map has water only at its edges; warships and submarines need
  sea zones, ports and coastal adjacency. That is a map-model change, planned as its own milestone.
- **Air defence and the fighter/strike split.** Needs interception in the strike phase. Next milestone
  after naval.
- **Province polygons instead of hexes.** Hexes fit this scale (234 regions, phone screen) and the whole
  stack (pathfinding, planner, renderer, AI) is built on them. No migration justified now.
- **Server-authoritative multiplayer.** The boundary exists: `resolveTurn` is pure, orders are validated
  and locked, views are filtered, `apps/api` can host `GameSession`. Rooms were removed; a backend comes
  after solo play is robust.
- **Configurable nation count and map size.** The Meridian is hand-placed for four powers. A procedural
  generator is a later milestone.

## 3. Target architecture

No framework migration. The same layers, with these additions:

- `Treaty` records on `WorldState` (kind, parties, start, expiry), resolved in the diplomacy phase,
  checked in validation, shown in views.
- `Facility` per site and a construction queue per nation, resolved in the production phase, feeding
  `grossYields` and entrenchment.
- `VictoryState` gains `supremacy` and `coalition` reasons and an optional coalition member list.
- `SaveFile` migrations: a chain of pure functions from any supported older save to the current one.
  The hash is checked against the save as written, then the save is migrated.
- A client-side order review built from the draft, the last ledger and the engine's `check` call.

## 4. Implementation phases (this pass)

| # | Change | Acceptance criteria |
|---|---|---|
| A | Save migrations | A save from ruleset 1.4.0 / save version 1 loads in the new build; a tampered save is still refused; tests cover both. |
| B | Treaties | Non-aggression pact (binding, 6 turns, blocks war declarations between the parties) and trade agreement (8 turns, income to both, ends at war), agreed by mutual proposal at resolution. Validation rejects war on a pact partner. AI proposes and accepts. Tests: formation, expiry, binding, trade income, war cancels trade. |
| C | Victory paths and lengths | Supremacy (average share of VP, army strength and income at or above a threshold, with stability) and Coalition (an all-allied bloc holding a VP share). Quick 20, Standard 30, Epic 45 turns. Tests for each path; the turn limit still ends every game. |
| D | Facilities | Six facility types with costs, build time from industry, effects and slots by site kind. Captured with the site. AI builds to fix shortages. City panel builds them. Tests: cost reservation, construction, yields, fortress entrenchment, capture. |
| E | Order review | End Turn opens a review (phone and desktop): orders by type, idle units, rejected orders, spending against stock, forecast shortages, research, diplomacy. Commit resolves. e2e updated. |
| F | Gates and docs | `pnpm check`, soak with the new ending mix, all e2e, `GAME_DESIGN.md`, `IMPLEMENTATION_LOG.md`. |

Every phase keeps the build green and the game playable. Rules changes bump `RULESET_VERSION`; old saves
migrate.

## 5. Later milestones

1. Naval: sea zones, ports, surface ships, submarines, convoys.
2. Air war: fighters, strike aircraft, air defence, interception.
3. Procedural maps: nation count 3 to 6, map sizes.
4. AI depth by difficulty: planning horizon and coordination rather than bonuses.
5. Asynchronous multiplayer on `apps/api` with identity and deadlines.

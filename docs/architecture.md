# Brink architecture

Repo and game title: Brink. Milestone 1: a single-player, four-nation, simultaneous-turn
strategy game that runs entirely in the browser.

## Shape

```
packages/contracts   plain JSON types: WorldState, orders, events, NationView, SaveFile
packages/map         axial hex math, pixel layout, A*, reachable sets (render-independent)
packages/game-data   versioned balance data: terrain, unit classes, techs, governments, RULES
packages/simulation  pure deterministic engine: resolveTurn, validation, fog, previews
packages/scenarios   The Meridian Crisis (234 hexes, four nations)
packages/ai          utility AI: NationView in, NationOrders out
packages/session     GameSession (match loop) and versioned save files
apps/web             React + PixiJS + Zustand + Tailwind client; engine runs in a Web Worker
apps/api             Fastify: health, scenario list, headless AI-only simulation runs
tests/soak           100 seeded AI-vs-AI matches with invariant checks every turn
tests/e2e            Playwright journey: start, order, end turn, report, save, resume
```

Dependency direction is one way: contracts <- map <- game-data <- simulation <- scenarios <- ai <- session
<- apps. The simulation imports no React, Pixi, DOM, network or database code.

## The turn

`resolveTurn(world, submissions) -> { world', events, observations, reports, hash }` is a pure function.
It clones its input, never reads the clock, and throws if the ruleset version differs.

| # | Phase | What happens |
|---|---|---|
| 1 | validate | `lockOrders` checks every submission against the start-of-turn world. Illegal parts become `order_rejected` events; every formation without a legal order holds. Duplicate or stale submissions are dropped whole. |
| 2 | diplomacy | War declarations apply at once (tearing up a peace or alliance costs the declarer stability in the economy phase: perfidy); units of the new enemies sharing a hex separate (the side not on its own ground falls back). Peace or alliance applies when both sides have proposed it (this turn or within 2 turns). |
| 3 | production | Recruit costs, reserved at validation, are **consumed here** as items enter the queue. Last settlement's industrial capacity is spent down the queue; finished formations appear at their site. |
| 4 | logistics | Dijkstra from cities and depots through own or allied ground; enemy hexes block and adjacency costs extra. Capacity is shared by priority tier, proportionally within a tier. Fuel and ammunition refills **consume** energy and materials now. |
| 5 | reconnaissance | Vision per nation, with recon orders active. Decides whether strikes and assaults are spotted. |
| 6 | strikes | Artillery and air strikes computed from one snapshot, then committed together. |
| 7 | movement | Discrete-event clock (below). |
| 8 | engagements | Assaults grouped by (attacking nation, target hex) and head-on meetings, all computed from the post-movement snapshot, then committed. |
| 9 | territory | Beaten defenders retreat (joint choice), winners advance, then occupation and front consolidation transfer hexes. |
| 10 | economy | Income, then upkeep, then discretionary budget spending. Unpaid upkeep is a shortage with a stated penalty; stockpiles never go negative. Recovery, entrenchment, reinforcement. Then world events: a pending event resolves with the submitted `eventChoice` (option 0 if none), and a nation that answered nothing may draw a new one (`roll(seed, turn, 'event', nation)`, 20%). Effects pay what they can; nothing goes below zero. |
| 11 | victory | Eliminations (no capital or city), then victory points (40%), last standing, or turn limit. |
| 12 | reports | Final vision, intel update (observed hexes, last-known contacts), a `NationView` and a filtered report per nation, and the state hash. |

## Simultaneity and determinism

- **Movement clock.** Each step's arrival time is `cumulative cost x 1000 / allowance`. Steps arriving at
  the same instant are judged together against one snapshot: head-on swaps become meeting engagements,
  two enemies entering one hex both halt (`contested`), entering an occupied enemy hex halts. Faster
  formations arrive sooner, which is the only "priority" there is.
- **No ordering wins.** Every map is iterated by sorted key. Where a tie-break by id is unavoidable
  (stacking, supply rounding) it is between formations of the same side, never between nations. A test
  resolves the same turn with submissions and object keys reversed and checks the hash.
- **Randomness by address.** `roll(seed, turn, phase, ids...)` hashes what the value is for. No stream,
  so the number of draws and their order cannot matter.
- **Integer math.** Every authoritative quantity is an integer; percentages go through one `pct()`.
- **Hash.** FNV-1a over canonical JSON (sorted keys), two lanes, 16 hex characters.

## Fog of war

`NationView` is the only thing the UI and the AI ever receive. Hexes are visible, observed (terrain and
last-known owner, dimmed) or unknown (no terrain at all). Enemy formations appear as contacts with a
rounded strength estimate; ones in forest, urban or mountains are detected only by reconnaissance or
from inside the hex. Last-known positions persist, marked unconfirmed, until the hex is seen empty.
Reports are filtered the same way: an unseen strike victim is not named to the striker. The victory-point
scoreboard is public by design.

Saves contain the full world (they must, to resume). Per-nation replays would need per-nation views;
the event filter in `resolve.ts` is the place to build them.

## Client

The engine runs in a module Web Worker (`engine.worker.ts`). The UI posts orders and receives a view;
the planner reuses the engine's own `enterCost`, `movementAllowance` and `reachable` so a plan made on the
map is a plan the validator accepts. Planned orders are amber, submitted orders white, last turn's fighting
red. Saves are JSON strings in three localStorage slots or a file.

## Battles

An attack order on a hex with enemies in it can be fought by hand. `@brink/arena` is a headless,
deterministic turn-based battle: a company a side on a 30 x 45 field built from the hex's terrain,
river and site, 50 unit types with armour by facing, soldiers, suppression, transport, called fire and
drones, and a combined-arms AI that sees only its own side's picture. Its state is plain JSON with
its seeded stream inside, and it appends an event log; `apps/web/src/arena` plays that log in
three.js. Design and numbers: `docs/arena-v2.md`. The result travels with the turn's orders as an `ArenaBattle` (who fought, strength kept per
unit in permille, won or not). At resolution it replaces the dice for that hex only if every hostile
there at the time was among those fought; otherwise the engagement is fought on the odds and reported
as `arena: 'voided'`. The engine stays pure: it validates and applies a claimed result, it never runs
the arena. Detail: `docs/arena.md`.

Multiplayer (PeerJS rooms, hotseat) was removed in favour of hand-fought battles. `GameSession` still
takes several human seats, and loading an old multi-human save hands the other seats to the AI.

### The battle's three layers

The simulation owns the truth, the visibility layer owns what is disclosed, the renderer owns how it
looks, and none does another's job.

| Layer | Where | Invariant | Tested in |
|---|---|---|---|
| Simulation | `packages/arena/src/v2` (`act`, `endTurn`, `autoTurn`, `retreat`; `submit` and `replay` in `replay.ts`) | A battle is a pure function of its setup, its seed, the rules version (`Battle.version` and the code) and the player's command log. It never reads the clock, `Math.random` or the renderer; its dice come only from `Battle.stream` through `draw()`, and the AI chooses with hash noise, so the log holds only the player's commands. A refused command changes nothing; an accepted one is logged once. | `replay.test.ts` (replay to the same hash at every turn across company shapes, terrain, sites, biomes, times, weather and difficulty; the same battle twice; a JSON save carried on; the clock and `Math.random` trapped), `invariants.test.ts` (all or nothing, duplicates, Undo against the stream and the sight picture), the matrix |
| Visibility | `observe(b, side)` in `observe.ts`, the one sanitizer; `observeBlue` in `insight.ts` is `observe(b, 'blue')` with the kills blue saw as its only events; `advise` plans on its own copy of the same picture | Everything shown to a side is computed from what it may know: its own units, enemies in sight (where they are and what their badges show: suppression as its state, a full load assumed whatever they have left, no passengers), its own last known positions, its own mines and support, the map and smoke, and the wrecks it can know of (its own, kills it saw, any next to a unit it has or sees). Not the enemy's skill, tallies, mines or picture. `observe` returns that as a `Battle` with a constant stream and no film; every reader the player uses (sight, reach, shot cards, called fire, advice, the strength bar, Undo, the Danger Area, overwatch, air-defence and likely-target overlays) answers the same on it as on the truth, or is computed only from it. | `fog.test.ts` (eleven kinds of hidden change at many points; the observation is enough; the wreck rule), `insight.test.ts` (every overlay unchanged under hidden mutations, the enemy's skill among them), the matrix (fog sampled twice a battle) |
| Presentation | `apps/web/src/arena` (the film plays `Battle.events`) | The film reads events and never resolves combat: an order is settled when `act` returns, so skipping the film, or playing none (every test runs headless), changes nothing. It shows what the events say blue saw (`seen`). | the engine tests and the matrix, all headless, to the same hashes |

`hashBattle(b)` is a stable 16-character hash of everything a battle holds but its command log (two
FNV-1a lanes over canonical JSON, the war engine's scheme); a battle and its JSON round trip hash the
same. `replay(setup, commands)` rebuilds a battle from the setup it was created from (the battle does
not keep it) and throws at a command the rebuilt battle refuses. Battles saved before the log have no
`commands` and play on as before.

`pnpm test:matrix` (`ARENA_MATRIX` battles, 24 by default) plays seeded battles to their end across
every dimension and checks crashes, broken states and steps, forbidden commands accepted, refused AI
actions, battles that do not end, replay and resume divergence and sampled fog leaks; failing cases go
to `tests/soak/arena-failing-seeds.json` and run first next time. Its table separates genuine failures
from reported defects it meets and from unusual but valid outcomes (a retreat, a battle held to the
round limit, no contact all battle).

Found by these tests and fixed (each test now passes as it was written): the AI's sight-grid cache
keyed on smoke and the count of buildings and trees, so a battle could plan on stale grids after a
wall fell (it now keys on a hash of every cell and storey); `act` accepted an order of no known kind,
a NaN facing and fire aimed between cells (the engine now checks an order's shape, `wellFormed` in
`orders.ts`); `whyNot` told a hidden unit's id from one nobody has, and an engineer's breach and mine
orders found hidden mines and units (refusals now say only what blue knows; a breach on a cell
holding a hidden mine lifts it, a mine laid on a hidden unit finds it); Undo greyed out when a
hidden enemy saw the step; a `fire` event was `seen` when blue saw only its target, so the film
showed a hidden shooter (events now carry `shooterSeen`, and the film brings an unseen shooter's
round in from off-screen); and blue's picture carried the enemy's skill. A stated rule rather than a
fix: a seen tank's active protection shows as loaded, so the shot card never tells whether it is spent.

Known and not fixed: facings and aim are stored as doubles from `Math.atan2`, and armour facing, range
and the capture zone use `Math.atan2`, `Math.sin`, `Math.cos` and `Math.hypot`, which the language does
not require to give the same last bit on every JavaScript engine. A command log is proven to replay to
the same hash on one engine (Node's V8, in the tests); on another (Safari's JavaScriptCore) a facing
could differ in its last bit, and a shot on an exact armour-facing or range boundary could then go the
other way. Not measured. The fix: facings as integers (sixteenths of a turn) in the state, and integer
distance checks (squared cells).

Known and not fixed: the move outline is reckoned on the battle itself (`reachable(b, ...)` with the
enemies blue knows of), so a wreck blue cannot know of (a kill out of sight, far from its units)
shows as a cell a vehicle cannot enter. Reckoning it on the observation would show the cell as open
and the move would then be refused by the rules; the clean fix is a rule (a move stops short at an
obstacle it meets), not a filter.

## Rejected alternatives

- A tick per movement point: forces every unit onto one speed grid. The event clock handles mixed speeds.
- A sequential seeded PRNG: results would depend on draw order. (The arena accepts that: one battle, one
  stream, actions in a fixed order, the stream's state saved with the battle.)
- Server-authoritative single-player: adds a required service for no gain. The API exists for headless
  simulation.

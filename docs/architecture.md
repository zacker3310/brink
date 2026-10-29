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

## Rejected alternatives

- A tick per movement point: forces every unit onto one speed grid. The event clock handles mixed speeds.
- A sequential seeded PRNG: results would depend on draw order. (The arena accepts that: one battle, one
  stream, actions in a fixed order, the stream's state saved with the battle.)
- Server-authoritative single-player: adds a required service for no gain. The API exists for headless
  simulation.

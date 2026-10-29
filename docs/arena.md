# Arena: Hand-Fought Battles

The war map stays turn-based, and so do its battles. When you order an attack on a hex with enemies
in it, you can fight that battle yourself: your formations become a company of 10 to 16 real units
against theirs, on a 30 x 45 field built from the hex, in XCOM-style side turns. The design, the rules
with their numbers and sources, the roster, the AI, the art and performance budgets and the migration
are in `docs/arena-v2.md`. This file is the guide to playing it and to the code.

## Flow

1. Tap a target twice (phone) or order an attack (desktop) on a hex with seen enemies: the brief opens,
   with the ground, the light and weather, the difficulty (a skirmish lets you choose; a war battle
   follows the campaign), your company, and what scouts report of the enemy.
2. **Fight It**, **Quick Resolve** (the odds), or **Back to Map** (no order).
3. The verdict shows stars, losses, rounds, hits and what each formation kept. The attack orders go
   on the draft with an `ArenaBattle` record.
4. At end of turn the war engine applies the record if the hex still holds exactly what you fought.
   Otherwise the dice decide and the debrief says so. A unit whose order you change drops its battle.

## Controls

- Tap a unit (or its badge, or its tile in the company strip; Tab on a computer) to select it; the
  camera glides to it.
- Inside its outline: where it can move this turn. Tap a cell to see the move (the route, cover or
  open, what it could hit from there, who could hit it there), then **Move** or tap it again.
  **Dash** shows how far it can go if it does nothing else. **Advice** says what a good commander
  would do with it and draws the route; **Do It** plays it. **Undo** (beside End Turn) takes back a
  step that showed nothing new. You can order the next unit while the last one is still moving.
- Enemies it can shoot are ringed with the chance to hit. Tap one for the shot card: chance to hit,
  chance to penetrate the armour it faces and to kill, or the expected casualties, every modifier,
  and the weapons it could use. **Fire**, or tap the enemy again.
- The unit card shows its three most useful actions; **More** has the rest: Overwatch, Hunker, Smoke, Turn (vehicles), Dismount (carriers), Board
  (infantry next to a carrier), Split and Join (squads), Treat (medics), Repair (recovery vehicles),
  Breach and Mine (engineers), Call Fire and Smoke Rounds (mortars and guns: tap any cell).
- The support strip: HIMARS or Tornado-G rocket missions, and the abilities your research unlocked.
- **End Turn** (Shift+Enter); with units still ready it asks whether the crews should act for them
  first. The menu has *Let My Crews Play This Turn*, *Skip the Animation*,
  Quality (Low, Balanced, High), Action Cams, Radio Calls and *Retreat*.
- Drag to pan, pinch to zoom, twist two fingers to turn the view and slide them to tilt; with a mouse,
  right-drag orbits and the wheel zooms; Q and E turn. The buttons on the right zoom in and out, bring
  the camera back to your unit, and show the whole field. Red arrows at the edge point to enemies
  off screen: tap one to look. **Thermal** appears at night and in fog.
- **Best Shot** on the unit card opens the shot card on its best target. During the enemy turn,
  **Skip** jumps to the end of it.

## Code

| Where | What |
|---|---|
| `packages/arena/src/v2/types.ts` | The contract: field, unit types, units, battle state, actions, the event log |
| `packages/arena/src/v2/map.ts`, `conditions.ts` | The battlefield from the hex (elevation, biomes, roads, rivers, villages, cities, sites) and the light and weather |
| `packages/arena/src/v2/roster.ts`, `rules.ts`, `forces.ts` | 50 unit types with public specifications; ranks and research abilities; formations into companies |
| `packages/arena/src/v2/sight.ts` | Lines of sight over the heightfield, hull-down, sight by light and weather, each side's picture |
| `packages/arena/src/v2/combat.ts` | Hit chance and its reasons, armour facing and penetration, component outcomes, casualties, suppression, blasts, demolition |
| `packages/arena/src/v2/engine.ts` | Battle setup, movement (overwatch, mines, hidden contacts), every action, turns, victory, results |
| `packages/arena/src/v2/ai.ts` | The combined-arms AI, from its own side's view only; the defender's deployment |
| `apps/web/src/arena/stage.ts` | The scene: world, units, soldiers, effects and sound driven by the event log; orbit and action cams |
| `apps/web/src/arena/hud.ts`, `units.ts` | Badges, words over targets, edge arrows and place labels over the field |
| `apps/web/src/arena/world/` | Ground, buildings, trees, water, skies, weather, destruction, the thermal look |
| `apps/web/src/arena/models3d/` | Every vehicle, helicopter, drone and soldier built in code; the Apache GLB wrapped |
| `apps/web/src/arena/fx/` | Lit smoke volumes, fire, tracers, missiles, explosions, debris, rotor wash |
| `apps/web/src/arena/audio/` | Calibre-true reports, engines, rotors, distance and echo, radio calls |
| `apps/web/src/arena/ArenaScreen.tsx` | Brief, battle screen, cards, menu, verdict |
| `apps/web/src/arena/battle.ts`, `skirmish.ts`, `career.ts`, `quality.ts` | War map to battle, the twelve skirmishes, your record, render quality and settings |

The engine is a pure function of the setup and the actions: plain-JSON state with its seeded stream
inside, an append-only event log the renderer plays back, no DOM. The war engine never runs a battle;
it validates and applies a claimed result.

## Testing

- `packages/arena/src/v2/*.test.ts`: maps over every terrain, biome, river and site; roster numbers
  against the spec; sight, hull-down, smoke, facing and penetration, components, casualties and
  suppression, transport, called fire, drones, mines, demolition, turns, abilities, determinism and the
  JSON round trip; the AI never cheats on sight or dice, pulls back, hunts helicopters, lays smoke and
  flanks; whole battles across arsenals and biomes.
- `tests/soak/arena.soak.test.ts` (`ARENA_SOAK=120`): AI against AI, invariants after every battle,
  balance and tactics tables in the log.
- e2e: `skirmish.spec.ts` (desktop), `arena-touch.spec.ts` (touch at 375 x 667, 393 x 852 and
  440 x 956: difficulty, advice, Do It, a move and its undo, a shot; 44 pt targets and 4.5:1
  contrast on every battle screen), `arena-navigate.spec.ts` (the same sizes: zoom buttons, pinch,
  drag, back to the unit, whole field, the arrow toward the enemy, measured on screen),
  `arena-perf.spec.ts` (frame time on an emulated iPhone 13), `phone.spec.ts` (a battle from the
  war map).

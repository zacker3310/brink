# Arena: hand-fought battles

The war map stays turn-based, and so do its battles. When you order an attack on a hex with enemies
in it, you can fight that battle yourself as a turn-based tactical fight on a grid, in the spirit of
XCOM: each of your units moves, then acts, with the hit chance and its reasons shown before you
commit; then the enemy takes its turn. Real 3D models (a T-72, an AH-64, a strike drone, Mixamo
riflemen, Hesco walls, shipping containers), lit by a real sky.

## Flow

1. Tap a target twice (phone) or order an attack (desktop) on a hex with seen enemies: the brief opens.
2. **Fight it**, **Quick resolve (odds)** (the old dice), or **Back to map** (no order).
3. The verdict shows stars, rounds and accuracy. The attack orders go on the draft with an
   `ArenaBattle` record.
4. At end of turn the engine applies the record if the hex still holds exactly what you fought:
   every hostile there was in the battle. Otherwise the dice decide and the debrief says so
   (`arena: 'voided'`). A unit whose order you change afterwards drops its battle.

## Controls

- Tap a unit (or its tile in the bottom bar; Tab on a computer) to select it. Your turn starts with a
  ready unit selected.
- Lit cells: where it can move this turn. Tap one to move (on a computer, hovering draws the route).
- Enemies it can shoot get a red ring and a hit chance. Tap one for the shot card (chance, damage
  range, and every modifier), then **Fire** (or tap the enemy again).
- Howitzers: tap any cell in range for the strike card; the red square is the blast.
- **Overwatch**: shoot the first enemy that moves into sight before your next turn (a snap shot, -12).
  **Dig in**: harder to hit until your next turn.
- Abilities (from research) sit above the unit bar. Air strike asks for a cell.
- **End turn** (Shift+Enter). The menu has *Let my crews play this turn*, *Skip the animation* and
  *Retreat*.
- Drag to pan, pinch or scroll to zoom. The camera follows the action.

## Packages

| Where | What |
|---|---|
| `packages/arena/src/rules.ts` | Field size (15 x 23 cells), round limit (12), capture rounds (2), unit classes, weapons, damage factors, cover, ranks, abilities |
| `packages/arena/src/level.ts` | `buildLevel`: map from terrain, river and site; spawns; guaranteed passage |
| `packages/arena/src/tactics.ts` | `createArena`, `reachable`, `fireInfo`, `strikeChance`, `act`, `endTurn`, the AI (`playSide`), `autoBattle`, `arenaResult` |
| `packages/simulation/src/engagements.ts` | `arenaHolds`, `fightInArena`: apply a battle result to an assault |
| `packages/simulation/src/validate.ts` | `checkBattle`: attackers hold attack orders on the target, `kept` in 0..1000, one battle per hex |
| `apps/web/src/arena/assets.ts` | Loads the GLB models (meshopt, WebP textures) and the HDRI once; builds each unit's model |
| `apps/web/src/arena/terrain.ts` | The battlefield: generated ground, grass, scrub, trees, boulders, buildings, Hesco, containers, water, bridges |
| `apps/web/src/arena/scene.ts` | `BattleView`: camera (pan, zoom, follow), light, overlays, and the event log played back as animation and effects |
| `apps/web/src/arena/models.ts` | Primitive models, used only when the real ones cannot load |
| `apps/web/src/arena/ArenaScreen.tsx` | Brief, field (selection, shot card, abilities, end turn, menu), verdict |
| `apps/web/src/arena/battle.ts` | `battleFor` (war map to arena setup), `enemySkill`, `battleRecord` |
| `apps/web/src/arena/skirmish.ts` | The eight practice battles |
| `apps/web/src/arena/career.ts` | Record on this device: battles, wins, stars, best per skirmish, wars won |

The engine in `tactics.ts` is a pure function of the setup and the actions taken (one seeded random
stream), has no DOM dependency, and logs everything it does as events. The web app plays that log
back; the war engine never runs a battle, it validates and applies a claimed result.

## Rules

**A round** is your turn, then theirs. Each unit may move once, then take one action: fire, dig in or
overwatch. Moving after acting is not allowed. Movement points per turn: a straight step costs 1, a
diagonal 1.5; vehicles cannot cut corners round walls; enemies block their own layer (aircraft fly
over ground units).

**Win conditions.** Capitals, cities and objectives: end 2 rounds in a row with a unit in the amber
circle and no defender in it, or destroy everything. Elsewhere: destroy them. Losing every unit, or
reaching the end of round 12, loses.

**Hit chance** = weapon aim + rank - range (3 a cell beyond half range) - cover - trees in the way
- dug in + flanked + anti-air + recon sweep + guided + enemy skill - snap shot, clamped to 5..95.
The number shown is the number rolled against. A hit does 85% to 115% of the shown damage.

| Cover (next to the target, toward the shooter) | Points |
|---|---|
| Wall, building, rock, Hesco | -40 (full) |
| Sandbags, container | -22 (half) |
| Trees (or standing in them) | -22 |
| Dug in | -10 |
| No cover from this side, but cover next to it | +10 (flanked) |

Walls between the two, next to neither, block the shot. A wall next to the shooter is leaned round.
Aircraft see over walls and halve cover against them; cover never protects aircraft.

**Classes.**

| Class | HP | Move | Weapon | Range | Aim | Damage |
|---|---|---|---|---|---|---|
| Tank | 140 | 5 | Main gun | 9 | 78 | 52 |
| IFV | 90 | 6 | Autocannon | 7 | 82 | 34 |
| Rifle squad | 45 | 4 | Rockets | 5 | 70 | 44 |
| Scout car | 55 | 8 | Machine gun | 7 | 80 | 22 |
| Howitzer | 55 | 3 | Shells a cell, splash 1 | 3..16 | 70 | 48 |
| Attack helicopter | 75 | 8 | Rockets | 7 | 74 | 40 |
| Strike drone | 20 | 9 | Dive, once | 4 | 88 | 70 |

Damage factors: rockets +15% on armour, machine guns 30% on armour, autocannon +50% on aircraft and
+30% on infantry, the main gun 85% on infantry. Defenders start dug in.

**Ranks** from war-map experience: Recruit 0, Veteran 15, Elite 35, Ace 60. Each step adds HP and
aim (+5, +9, +13).

**Abilities** come from research, once a battle each: Field repair (logistics doctrine, +40% HP),
Recon sweep (signals intelligence, +15 aim this round and next), Mines (industrial automation, three
cells ahead of the unit; an enemy vehicle that drives in stops and takes 35), Air strike (combined
arms, a 3 x 3 blast anywhere), Guided missiles (precision munitions, +30 on the next three direct
shots), Composite armour (passive, +25% HP on tanks and IFVs).

**The AI** scores every cell each unit can reach: the best shot from there (expected damage, plus a
bonus for a kill), minus the damage the player could do to it there (weighted by skill), plus the
objective (defenders hold the circle, attackers close in). Guns fire first. Low skill adds noise to
its choices and takes long shots; high skill sets overwatch when it has nothing good.

**Enemy skill** = base by difficulty (easy .18, normal .38, hard .58) + .3 x war progress + .04 per
extra defender, capped at .95. It moves the enemy's aim by (skill - .5) x 30 points (Easy: about -10)
and sets how well it reads the field. Defenders turn Veteran after 60% of the war.

**Stars**: one for winning, one for losing no unit, one for winning within 6 rounds or taking under
20% damage.

**Strength.** Each unit's arena HP is its class HP scaled by war-map strength and rank. `kept` is HP
left over HP started, in permille; a unit destroyed in the arena is destroyed on the map.

**Balance**, measured on autopilot (the AI playing your side, no abilities, 20 seeds each): First
blood 100%, Street fight 100%, The crossing 60%, The woods 75%, Take the city 60%, High ground 50%,
Swarm 100%, Last stand 75%.

## Rendering

- Models: `public/art/models/*.glb`, re-encoded with gltf-transform (meshopt geometry, WebP textures
  at 512 to 1024 px), about 3 MB in all, fetched on the first battle and then cached by the service
  worker. The IFV and the howitzer are the T-72 chassis with turrets built in code; the scout car is
  built in code.
- Light: the Poly Haven "Rooitou Park" sky (`public/art/env/park.exr`, 512 px, via `@pmndrs/assets`)
  for image-based light and reflections; a low warm sun with 2048 px soft shadows; ACES tone mapping.
- Ground: generated per battle from the seed and terrain (multi-octave noise for cover, earth and
  stones, then full-resolution grain), with mud banks, tyre tracks, craters and city pavements, and a
  bump map from the same noise. About 60 ms.
- The board: instanced grass tufts, scrub, broadleaf and conifer trees, boulders, Hesco baskets and
  painted containers; buildings with facades, parapets and roof plant; water with moving ripples.
- Effects: muzzle flashes with a flash light, tracers, rockets with smoke trails, lobbed shells, bombs,
  explosions (Kenney frames), sparks, debris, scorch marks, burning wrecks with smoke columns, damage
  numbers, dust behind tracks, falling aircraft, camera shake.
- The battle screen (three.js and its loaders) is its own chunk, loaded when a battle opens.

## Progression

- Skirmish (title menu): eight battles opened by total stars (0 to 18), best stars kept per battle.
- Theatres: the Meridian (always), the Highland Front (one war won), the Varn Delta (two wars won).
  Same powers and cities; different ground and rivers (`THEATRES` in `packages/scenarios`).

## Testing

- `packages/arena/src/arena.test.ts`: level passability, spawns, movement points and walls, the shown
  chance is the rolled chance, cover and flanking, blocking walls, artillery splash, drones, overwatch
  interrupts, mines, capture, the round limit, retreat, abilities, determinism of the event log, and
  whole battles on autopilot (strong beats weak, a sharp enemy wins more).
- `packages/simulation/src/arena.test.ts`: results replace dice, void when the hex changed, validation.
- e2e: `skirmish.spec.ts` selects, moves, ends a turn and wins; `phone.spec.ts` opens a battle from the
  war map on an emulated iPhone.

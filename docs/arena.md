# Arena: hand-fought battles

The war map stays turn-based. When you order an attack on a hex with enemies in it, you can fight that
battle yourself: a top-down 3D firefight of two to three minutes in the spirit of Tank Hero (2010).
Drag anywhere to drive, tap to fire; on a computer WASD or the arrows drive and the mouse aims.

## Flow

1. Tap a target twice (phone) or order an attack (desktop) on a hex with seen enemies: the brief opens.
2. **Fight it**, **Quick resolve (odds)** (the old dice), or **Back to map** (no order).
3. The verdict shows stars and stats. The attack orders go on the draft with an `ArenaBattle` record.
4. At end of turn the engine applies the record if the hex still holds exactly what you fought:
   every hostile there was in the battle. Otherwise the dice decide and the debrief says so
   (`arena: 'voided'`). A unit whose order you change afterwards drops its battle.

## Packages

| Where | What |
|---|---|
| `packages/arena/src/rules.ts` | Arena size (15 x 23 cells), time limit (150 s), unit classes, weapons, damage factors, ranks, abilities |
| `packages/arena/src/level.ts` | `buildLevel`: map from terrain, river and site; spawns; guaranteed passage |
| `packages/arena/src/sim.ts` | `createArena`, `stepArena` (fixed 1/60 s substeps), AI, `arenaResult` |
| `packages/simulation/src/engagements.ts` | `arenaHolds`, `fightInArena`: apply a battle result to an assault |
| `packages/simulation/src/validate.ts` | `checkBattle`: attackers hold attack orders on the target, `kept` in 0..1000, one battle per hex |
| `apps/web/src/arena/scene.ts` | three.js renderer: camera fit, procedural ground and props, units, shots, FX |
| `apps/web/src/arena/models.ts` | Procedural vehicle and infantry meshes in the nation's field colour |
| `apps/web/src/arena/ArenaScreen.tsx` | Brief, field (input, HUD, pause, autopilot, retreat), verdict |
| `apps/web/src/arena/battle.ts` | `battleFor` (war map to arena setup), `enemySkill`, `battleRecord` |
| `apps/web/src/arena/skirmish.ts` | The eight practice battles |
| `apps/web/src/arena/career.ts` | Record on this device: battles, wins, stars, best per skirmish, wars won |

The sim is deterministic in its seed and inputs and has no DOM dependency; the engine never runs it.
It validates and applies a claimed result.

## Rules

**Win conditions by terrain.** Capitals, cities and objectives are capture battles: hold the amber
circle for 6 s with no enemy ground unit in it, or destroy everything. Elsewhere: destroy them. Losing
every unit or running out the clock loses.

**Classes.**

| Class | HP | Weapon | Notes |
|---|---|---|---|
| Armor | 140 | Shell, 46 dmg | Bounces once off walls; can hit your own side |
| Mechanized | 100 | 3-round cannon burst | Fast and tough |
| Infantry | 42 | Rocket, 40 dmg | Walks through trees, hard to hit in them |
| Recon | 60 | Machine gun | Fastest; shreds infantry and drones |
| Artillery | 60 | Lobbed shell, splash | Arcs over walls, lands after a delay |
| Air | 80 | Rocket pairs | Flies over everything |
| Drone | 18 | Dive, splash | One shot |

**Ranks** from war-map experience: Recruit 0, Veteran 15, Elite 35, Ace 60. Each step adds HP and
cuts reload. Attackers who fight it by hand gain 4 experience, double what the dice give.

**Abilities** come from research: Field repair (logistics doctrine), Recon sweep (signals
intelligence), Mines (industrial automation), Air strike (combined arms, targeted), Guided missiles
(precision munitions), Composite armour (passive). The Research panel shows each one.

**Enemy skill** = base by difficulty (easy .18, normal .38, hard .58) + .3 x war progress + .04 per
extra defender, capped at .95. Skill sets aim error, lead and reaction time. Defenders turn Veteran
after 60% of the war.

**Stars**: one for winning, one for losing no unit, one for finishing inside par (60 s, 75 s for
capture) or keeping 85% average strength.

**Strength.** Each unit's arena HP is its class HP scaled by war-map strength and rank. `kept` is HP
left over HP started, in permille; a unit destroyed in the arena is destroyed on the map.

## Progression

- Skirmish (title menu): eight battles opened by total stars (0 to 18), best stars kept per battle.
- Theatres: the Meridian (always), the Highland Front (one war won), the Varn Delta (two wars won).
  Same powers and cities; different ground and rivers (`THEATRES` in `packages/scenarios`).

## Testing

- `packages/arena/src/arena.test.ts`: level passability on every terrain, determinism, bounce
  self-hits, capture, retreat, stars, abilities.
- `packages/simulation/src/arena.test.ts`: results replace dice, void when the hex changed, validation.
- e2e: `phone.spec.ts` fights a battle from the war map by touch; `skirmish.spec.ts` drives with WASD,
  fires with the mouse and banks stars. `window.__arena` exposes the live arena, a projection and
  instant win/lose.

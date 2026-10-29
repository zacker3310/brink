# Arena v2: Combined Arms

The tactical battle, rebuilt around the owner's 20 decisions: a company a side on a 30 x 45 field
with elevation, armour facing and components, squads of individual soldiers under suppression,
transport, drones, artillery, air defence, recovery and medics; a grounded documentary look across
five biomes, four times of day and five weathers; calibre-true audio with echo and radio calls; and
an enemy that fights combined arms without seeing or rolling anything it should not.

This file is the contract. Code that disagrees with it is wrong, or this file gets updated in the
same commit.

## 1. Audit of v1

What exists (read in full before writing this):

| Area | v1 | Verdict |
|---|---|---|
| Field | 15 x 23 cells, flat; cells OPEN, WALL, TREE, WATER, BRIDGE, CRATE; wall styles building, rock, hesco, sandbag (`level.ts`) | Replace: 30 x 45 with elevation, buildings that crumble, roads, rubble, craters |
| Units | One unit per war-map formation, 7 classes (tank, IFV, rifle squad, scout car, howitzer, attack helicopter, strike drone), HP pools (`rules.ts`) | Replace: a company a side (10 to 16), 44 real designations, no HP pools for vehicles |
| Turns | XCOM side turns: move, then act (fire, dig in, overwatch); 12 rounds; capture by holding the zone 2 rounds | Keep the shape; 16 rounds; add dash, facing, transport, support actions |
| Hit chance | aim + rank - range - cover - trees - dug in + flanked + abilities + enemy skill - snap, clamped 5..95; the shown number is the rolled number | Keep the principle and the card; add elevation, hull-down, suppression, night, and a second number: penetration |
| Damage | HP minus 85..115% of a damage value, class factors | Replace: penetration vs facing armour, component outcomes; soldier casualties |
| Cover | full -40, half -22, trees -22, dug -10, flanked +10 | Keep the numbers; add buildings, rubble, craters, wrecks |
| AI | Per unit: score every reachable cell by best shot minus threat plus objective; guns first; skill adds noise and shifts enemy aim by (skill - .5) x 30; reads every unit on the field | Replace: company tactics on its own side's view only; skill becomes visible crew rank plus decision quality |
| Determinism | `mulberry32` seeded stream, but held as a closure in the state; event log; no DOM | Refactor first: stream state is a number in plain-JSON state, so a battle serialises, resumes and replays |
| Renderer | three.js `BattleView` plays the event log: T-72 GLB (also as chassis for IFV and SPG), AH-64D GLB, quadcopter GLB, Mixamo riflemen, Hesco, containers, tower; Poly Haven HDRI; 2048 shadows; Kenney explosion and smoke frames; burning wrecks; camera pan, pinch, follow | Keep the playback architecture and loader; replace the unit models, terrain and lighting rig; add weather, night, thermal, LOD, quality |
| Licences | T-72 is "free for personal and commercial use" (itch.io) and Mixamo is Adobe's terms: neither is CC0 or CC-BY | Retire both from the battle (decision 15); they remain only in the war-map sprite renders (flagged in PROGRESS) |
| Audio | WebAudio synth: shot, boom, tick, music loop (`sfx.ts`) | Replace battle audio: calibre reports, engines, rotors, distance echo, radio calls |
| UI | Brief (Fight, Quick resolve, Back), field HUD (round, enemy left, menu), unit bar, shot card, abilities strip, verdict with stars | Keep the flow and test ids; redesign for a company (grouped unit list, contextual actions) |
| Tests | 19 arena tests: levels, moving, shooting, turns, battles, determinism; 4 simulation tests for arena results; e2e skirmish and phone battle | Keep the intent of each; rewrite for v2; add soak and iPhone-size touch tests |
| Campaign link | `battleFor` (war map to setup), `ArenaBattle { target, attackers, defenders, kept, won }` applied by the war engine when the hex still holds what was fought; ranks from formation experience; abilities from research | Keep the contract byte for byte; expand formations into companies and fold results back per formation |
| Progression | Career in `localStorage['brink.career.v1']`: battles, wins, stars, best per skirmish id, wars won; 8 skirmishes by star thresholds 0..18 | Keep the key, shape, ids and thresholds; redesign the 8 battles' content, add new ones |

## 2. Scale

- **Grid**: 30 x 45 cells (1,350, 3.9x v1's 345). The attacker enters at the bottom (rows 40..44),
  the defender holds the top.
- **Ground scale**: one cell is 150 m of tactical distance, so the field is 4.5 x 6.75 km: a
  company attack frontage with room to flank. Ranges and sight are in cells at this scale.
- **Figure scale**: models are drawn at 1 cell = 10 m so an 8 m tank reads on a phone. This is the
  miniatures convention (figures larger than the ground scale); the rules never use model size.
- **Time**: a round is about two minutes. Movement is compressed for infantry (they bound in rushes)
  so a battle plays; the ratio between vehicles stays real.
- **Elevation**: levels 0..4. A level is about 4 m of relief at figure scale (0.4 world units).
- **Round limit**: 16 (decision 19). A player turn with 12 to 16 units takes about a minute; a big
  battle lands in 15 to 25 minutes. Quick resolve stays.

## 3. Rules

### 3.1 Turn

XCOM turns (decision 3): the attacker's whole side, then the defender's; a round is both. Each
unit, each turn:

1. **Move** up to its movement points (straight step 2 half-points, diagonal 3; roads 1.5 for
   wheeled; climbing 1 level +1; rubble x2 for tracked and foot; walls +2 for foot and tracked,
   which flatten them). Or **dash**: up to twice as far, then no action. Or **face**: turn in place.
2. **Act** once: fire, overwatch, hunker, smoke, dismount, embark, split, merge, treat, repair,
   breach, lay mine, call fire, launch drone.

A unit may act without moving. It may not move after acting, except a carrier that dismounts
first. Vehicles end a move facing the most dangerous known enemy in sight (their crews would);
otherwise the way they drove. `face` points them anywhere.

**Overwatch**: fire at the first enemy that moves into sight and range before your next turn, at a
snap -12. AD units on overwatch watch the sky only, with no snap penalty (radar cued).

**Win**: destroy them, or (capitals, cities, objectives) end 2 rounds in a row with a unit in the
amber circle (radius 3.5) and no defender in it. The defender withdraws (attacker wins) when its
force falls under 35% of its starting value (combat ineffective); the attacker's company breaks (a
loss) under 25%. Losing every unit, retreating, or reaching the end of round 16 loses. Stars: win; lose under 10% of your force value; win by round 9 or take under 20%.

### 3.2 Sight and fog

Each side sees only what its units see (decision 20: no cheating). A unit spots an enemy when a
line of sight exists and the distance is within its sight for the conditions.

| Conditions | Eyes | Thermal | NVG (infantry) |
|---|---|---|---|
| Day, clear | 30 | 30 | 30 |
| Dawn, dusk | 18 | 30 | 22 |
| Night | 6 | 22 | 10 |
| Fog | 7 | 10 | 8 |
| Rain | x0.7 | x0.85 | x0.7 |
| Snow | x0.8 | x0.9 | x0.8 |

- **Concealed** (infantry in trees, a building, rubble or a crater, or hunkered, that did not fire
  last turn): spotted only within a third of sight (at least 3).
- **Firing reveals** the shooter to the side it fired at until the end of that side's next turn.
- **Recon drones** look down from 6 levels: trees and buildings never hide what they see within 14.
- Last known positions stay on the map as ghosts with their age.

### 3.3 Line of sight and elevation

A line runs from the viewer's eye to the target's centre over the heightfield, sampled every 0.2
cells. It is blocked where ground plus feature height at a sample rises above the line.

| Feature | Height (levels) | Notes |
|---|---|---|
| Open, road, water, bridge | 0 | |
| Wall (hedge, stone, sandbag, Hesco) | 0.25 | Never blocks a line; is cover |
| Rubble, crater, wreck | 0.3 | Cover |
| Rock | 0.8 | Hard cover; blocks vehicles |
| Trees | 1.5 | One tree cell on the line: -10 (concealment); two or more: blocked |
| Building | 1 to 4 storeys | Blocks; garrisoned infantry fire from its roof line |
| Smoke | 3.5 | Blocks every line through it |

| Eye and body (levels above ground) | Eye | Centre | Top |
|---|---|---|---|
| MBT, IFV, SPG, AD | 0.7 | 0.3 | 0.75 |
| Wheeled, light | 0.6 | 0.25 | 0.6 |
| Infantry | 0.45 (0.15 hunkered) | 0.25 | 0.45 |
| Helicopter | 2.5 | 2.5 | 2.7 |
| Recon drone | 6 | 6 | 6 |

**Hull-down**: the line to the hull centre is blocked by ground within 2 cells of the target but the
line to the turret top is clear. Hull-down vehicles are -20 to hit and every hit lands on the turret
front. **Height advantage**: a shooter 1+ level above its target gets +10 and the target's cover
counts one step lower (full to half, half to none).

### 3.4 Hit chance

Shown before you fire and rolled against exactly (v1's promise).

`hit = aim + rank - range - cover - concealment - posture + flanked + height - suppression - crew - moved - night - snap + abilities`, clamped 5..95.

| Term | Points |
|---|---|
| Range | beyond half range: per cell, cannon -1.5, autocannon -2.5, MG/rifle -5, unguided rocket -10, guided 0 |
| Cover (adjacent, toward the shooter) | full -40 (building, rock, wreck, Hesco), half -22 (wall, rubble, crater, sandbag), trees -22 |
| Garrisoned building | -40 |
| Through one tree cell | -10 |
| Hunkered | -15 (and casualties x0.7) |
| Hull-down | -20 |
| Small target (drone, AH-6) | -20 / -10 |
| Flanked (target in cover, none from this side) | +10 |
| Height advantage | +10 |
| Shooter suppressed / pinned | -15 / -30 (broken cannot fire) |
| Crew casualties | -15 each |
| Moved this turn | stabilised vehicles -5, others -10; mortars and ATGM teams cannot fire after moving |
| Night or fog without thermal | -20 |
| Rank | Veteran +5, Elite +9, Ace +13 |
| Overwatch snap | -12 |
| Flares vs MANPADS | -15 |
| Recon sweep, guided | +15, +30 |

### 3.5 Vehicle damage (decision 9)

Armour is millimetres of rolled homogeneous armour equivalent, kinetic (KE) and chemical (CE),
for five facings: turret front, hull front, side, rear, top. **Facing** is the angle between the
hull's heading and the line to the shooter: front within 45 degrees, rear beyond 135, side between.
A frontal hit lands on the turret 40%, the hull 60% (hull-down: turret always). Top-attack weapons
(Javelin, TOW-2B, Hellfire, FPV, loitering munitions, artillery on a direct hit) strike the top.

**Penetration** compares the weapon's penetration P (KE or CE, by round) against armour A, with a
+/-15% spread: `P(pen) = clamp((1.15 - A/P) / 0.30, 0, 1)`. The card shows it.

**Active protection** (Trophy on Challenger 3): 75% to intercept an ATGM, rocket or drone, 3
charges. A Kornet-D two-missile salvo on one beam leaves APS one interceptor short.

**On penetration**, by location:

| | Catastrophic | Firepower kill | Mobility kill | Crew casualty | No further effect |
|---|---|---|---|---|---|
| Turret, carousel autoloader (T-72B3, T-90M, Sprut) | 30 | 35 | 0 | 25 | 10 |
| Turret, basket autoloader (T-80BVM) | 30 | 35 | 0 | 25 | 10 |
| Turret, bustle with blow-out panels (Abrams, Leopard) | 8 | 40 | 0 | 37 | 15 |
| Turret, hull stowage (Challenger 3, IFVs) | 15 | 40 | 0 | 30 | 15 |
| Hull, carousel / basket | 35 | 0 | 35 | 20 | 10 |
| Hull, other MBT | 15 | 0 | 45 | 25 | 15 |
| Light vehicle (front KE under 100), any hit | 45 | 15 | 25 | 15 | 0 |

Overmatch (P at least 1.4 x A) moves 20 points from crew and no-effect to catastrophic; top attack
moves 15. **Catastrophic**: destroyed, a burning wreck for 3 rounds, passengers hurt. **Firepower
kill**: the main weapon is out (secondary MG still fires). **Mobility kill**: cannot move or pivot
the hull. **Crew casualty**: -15 aim; a crew down to one bails out (knocked out). A recovery
vehicle fixes a mobility or firepower kill. **No penetration**: +15 suppression on the crew;
side or rear KE hits 12% tracks (mobility kill), any 8% optics (-10 aim).

Helicopters use the same model (armour 25 to 30 all round): mobility kill is a forced landing
(out of the fight, passengers dismount), catastrophic is shot down. Drones: any hit destroys.

### 3.6 Infantry (decision 10)

A squad is its soldiers: each has a role (leader, rifleman, automatic rifleman, grenadier, AT,
gunner, marksman, medic, sapper) and a state (fit, wounded, dead). Firepower is computed from fit
soldiers. A hit on a squad rolls each fit soldier: `p = clamp(lethality x cover / fit, 0.05, 0.9)`;
a casualty is wounded 55%, killed 45%. Cover multipliers: open 1, trees 0.7, half 0.6, full 0.4,
building 0.35, hunkered x0.7. Medics return wounded to the fight. Squads **split** into two
fireteams and **merge** back.

**Suppression** 0..100 on every unit. Every shot adds its weapon's suppression to the target (half
on a miss, and to every unit in a blast). 25 suppressed (-15 aim), 50 pinned (-30 aim, half move,
no dash), 80 broken (cannot fire; on its turn it falls back to cover away from known enemies).
Recovery at the start of its side's turn: -20, -10 more in cover, -10 more with its leader fit,
-5 per adjacent friend (max -10). Vehicles take a third and recover -30.

### 3.7 Terrain, destruction, smoke (decisions 11 and 16)

- **Buildings** have 40 HP a storey. HE, demolition and bombs knock HP off; at 0 the building is
  rubble (half cover, passable to foot and tracks) and everyone inside takes a blast.
- **Trees** fall to HE blasts (2 hits). **Walls** fall to HE and to tracks driving through.
- **Craters** from artillery, bombs and big HE persist: half cover for infantry.
- **Wrecks** persist: full cover for infantry, impassable to vehicles, burning (a smoke column over
  the cell) for 3 rounds.
- **Smoke** (artillery and mortar smoke rounds 3 x 3, vehicle grenades a 3-cell screen ahead,
  engineer pots 2 cells) blocks sight for a turn: from when it lands until the start of the firing
  side's next turn, so it covers your move and the enemy's reply, then thins away.

### 3.8 Transport (decision 12)

- Seats in soldiers: Bradley 6, BMP-3 7, CV90 8, Stryker 9, Mi-24 8, UH-60 11, Mi-8 16 (game cap).
- **Embark**: an infantry unit moves into a friendly carrier within its move; that ends its turn.
  Helicopters must sit on open ground; loading or unloading lands them and ends their action.
- **Dismount**: the carrier puts its passengers on free cells around it (rear first). Dismounting
  is the passengers' move; they can still fire. A ground carrier can dismount, then move or fire.
- Passengers cannot be targeted, do not spot, do not hold the zone.
- **Carrier destroyed**: catastrophic or shot down, each passenger soldier is killed 50%, wounded
  30%; knocked out, they bail out with 15% wounded and 60 suppression around the wreck.

### 3.9 Support

- **Called fire** (mortars, howitzers, off-map rockets): any cell in range. On-target chance
  depends on who sees the cell: blind (last known only) 35, observed 65 (mortar 70), spotter (AH-6,
  recon drone, scout) 80, laser (recon drone over the cell) 90. A miss lands 1 cell off (2 blind).
  Rounds: HE or smoke. Mortars cannot fire after moving.
- **Off-map**: HIMARS (GMLRS unitary, precise, 2 missions) for the West, Tornado-G (122 mm salvo,
  5 x 5 saturation, 1 mission) for the East, called by any unit.
- **Drones**: FPV and loitering munitions fly from their team to any enemy their side can see
  within range, striking top or rear; enemy air-defence guns within 4 cells (Gepard, Tunguska 60%,
  autocannon IFVs 25%) can shoot them down on the way. **Recon drones** are units: fast, fragile,
  far-seeing, and they laser cells for the guns.
- **Medics** treat an adjacent squad: two wounded back to fit. **Recovery vehicles** repair an
  adjacent vehicle's mobility or firepower kill.
- **Engineers**: breach an adjacent building, wall or rock (to rubble or open) or clear a mine; lay
  an AT mine on an adjacent cell (3); smoke pots (2). AT mines are hidden; a vehicle that enters
  takes a mobility kill (light vehicles 40% catastrophic).

### 3.10 Abilities from research (unchanged ids and techs)

| Id | Tech | v2 effect |
|---|---|---|
| repair | logistics_doctrine | Field repair: one vehicle's damage or two of a squad's wounded, anywhere |
| sweep | signals_intelligence | SIGINT sweep: every enemy revealed through your next turn |
| mines | industrial_automation | Scatterable mines: five AT mines around a cell within 20 |
| airstrike | combined_arms | Air strike: a 3 x 3 bomb blast anywhere (top attack, demolishes) |
| missiles | precision_munitions | Precision rounds: your next three shots are 30 points surer |
| armor | composite_armor | Passive: your MBTs and IFVs get +100 KE and +150 CE on their fronts |

## 4. Roster (decisions 4 to 8)

Factions: **West** and **East**. Arsenals by war-map government: Commonwealth (Aster) US kit,
Federation (Selmar) European kit, Directorate (Korva) modern Russian, Union (Drevan) older Russian.
Every roster item appears in at least one arsenal.

Real specifications are public figures (manufacturer and service fact sheets, see Sources). Armour
values are open-source estimates rounded for the game: real figures are classified. Game ranges are
real effective ranges divided by 150 m, capped at the field.

### 4.1 Main battle tanks

| Type | Crew | Weight | Road speed | Engine | Main gun, round | Pen KE | Aim | Move | Turret front KE/CE | Hull front | Side | Rear | Top | Stowage |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| M1A2 SEPv3 Abrams | 4 | 66.8 t | 67 km/h | AGT1500 turbine 1,500 hp | 120 mm M256, M829A4 APFSDS; M1147 AMP | 750 | 90 | 8 | 950/1300 | 600/900 | 80/400 | 40/80 | 40/60 | bustle |
| Leopard 2A7 | 4 | 64.5 t | 68 km/h | MTU MB 873 1,500 hp | 120 mm L55, DM53 APFSDS; DM11 HE | 780 | 90 | 8 | 920/1250 | 620/950 | 100/450 | 40/80 | 40/60 | bustle |
| Challenger 3 | 4 | 66 t | 60 km/h | CV12 1,200 hp | 120 mm L55A1 smoothbore APFSDS; HE | 780 | 90 | 7 | 960/1350 | 650/1000 | 90/450 | 40/80 | 40/60 | hull; Trophy APS |
| T-72B3 (2016) | 3 | 46 t | 60 km/h | V-92S2F 1,130 hp | 125 mm 2A46M-5, 3BM59 Svinets-1; 3OF26 | 620 | 82 | 7 | 700/1100 | 650/1000 | 80/350 | 40/60 | 30/50 | carousel |
| T-90M Proryv | 3 | 48 t | 60 km/h | V-92S2F 1,130 hp | 125 mm 2A46M-4, 3BM60 Svinets-2; 3OF26 | 680 | 86 | 7 | 900/1300 | 750/1150 | 100/400 | 50/120 | 40/120 | carousel |
| T-80BVM | 3 | 46 t | 70 km/h | GTD-1250 turbine 1,250 hp | 125 mm 2A46M-4, 3BM60; 3OF26 | 680 | 84 | 8 | 800/1200 | 700/1100 | 90/380 | 40/60 | 35/60 | basket |

Main gun range 24 (120 mm) and 22 (125 mm). HE: pen 50 CE, lethality 2.5, blast 0, suppression
40, demolition 25.

### 4.2 Infantry fighting vehicles and carriers

| Type | Crew + seats | Weight | Speed | Weapons (game range) | Front KE/CE | Side | Rear | Top | Move |
|---|---|---|---|---|---|---|---|---|---|
| M2A3 Bradley | 3 + 6 | 31 t | 56 km/h | 25 mm M242 (14, pen 60); TOW-2B top attack (25, CE 900, 4 missiles) | 45/250 | 30/200 | 20/40 | 15/20 | 8 |
| BMP-3 | 3 + 7 | 18.7 t | 70 km/h, swims | 100 mm 2A70 HE (20, lethality 2.5); 9M117M1 Arkan (36, CE 750, 3); 30 mm 2A72 (14, pen 45) | 35/40 | 20/25 | 15/15 | 10/10 | 9 |
| CV90 Mk IV (CV9035) | 3 + 8 | 35 t | 70 km/h | 35 mm Bushmaster III (18, pen 120) | 80/300 | 45/200 | 25/40 | 20/25 | 9 |
| M1126 Stryker ICV | 2 + 9 | 18 t | 97 km/h, wheeled | .50 cal M2 RWS (12) | 30/250 slat | 25/250 | 20/150 | 10/10 | 10 |

### 4.3 Light tanks and tank hunters

| Type | Crew | Weight | Speed | Weapons | Front KE/CE | Side | Move |
|---|---|---|---|---|---|---|---|
| M10 Booker | 4 | 38 t | 64 km/h | 105 mm M35, M900 APFSDS (17, pen 450); M393 HEP | 200/400 | 50/150 | 8 |
| 2S25M Sprut-SDM1 | 3 | 18 t | 70 km/h, swims | 125 mm 2A75 (20, pen 600); 9M119M1 Invar-M (30, CE 900, 2) | 25/30 | 15/15 | 9 |
| M1134 Stryker ATGM | 4 | 18 t | 97 km/h | TOW-2B top attack (25, CE 900, 6) | 30/250 | 25/250 | 10 |
| 9P163-3 Kornet-D (Tigr-M) | 2 | 13 t | 125 km/h | Kornet-EM 9M133FM-3 (40, CE 1,300, 8, two-missile salvo) | 10/10 | 10/10 | 11 |

### 4.4 Helicopters

| Type | Crew + seats | Speed | Weapons (game range, ammo) | Armour | Move |
|---|---|---|---|---|---|
| AH-64E Apache Guardian | 2 | 293 km/h | 30 mm M230 (11, pen 25 CE, lethality 1.2); AGM-114R Hellfire (40, CE 900, top, 8); Hydra 70 (20, lethality 2, 2 salvos); Longbow radar | 25/25 | 20 |
| Ka-52 Alligator | 2 | 300 km/h | 30 mm 2A42 (14, pen 45); 9K121 Vikhr (40, CE 1,000, 6); S-8 (20, 2 salvos) | 25/25 | 20 |
| Mi-35M (Mi-24 family) | 2 + 8 | 300 km/h | GSh-23V twin 23 mm (10, pen 30); 9M120 Ataka (40, CE 800, 4); S-8 (20, 2 salvos) | 30/30 | 18 |
| AH-6M Little Bird | 2 | 280 km/h | 2 x M134 7.62 (7, lethality 2, suppression 30); Hydra 70 (20, 2 salvos); laser designator (spotter) | 5/5 | 22 |
| UH-60M Black Hawk | 4 + 11 | 280 km/h | 2 x M240H door guns (7) | 10/10 | 20 |
| Mi-8AMTSh | 3 + 16 | 250 km/h | PKT door guns (7); S-8 (20, 2 salvos) | 10/10 | 18 |

All helicopters carry flares (-15 to MANPADS shots).

### 4.5 Infantry

| Unit | Men | Weapons (game range) | Sight at night | Move |
|---|---|---|---|---|
| Rifle squad, West | 9: leader, 2 team leaders, 2 automatic riflemen (M249), 2 grenadiers (M320), 2 riflemen (M4A1, AT4) | squad fire (5), M320 (3, blast), AT4 (2, CE 500, 2 shots) | NVG | 3 |
| Rifle squad, East | 8: leader, gunner (PKM), RPG-7V2 + assistant, grenadier (GP-34), 2 riflemen (AK-12), marksman | squad fire (6), GP-34 (3), RPG-7V2 PG-7VR (3, CE 650, 3) | NVG | 3 |
| Fireteam | half a squad after a split | as the squad, scaled | NVG | 3 |
| Javelin team (FGM-148F) | 2 | Javelin (26, CE 800, top attack, fire and forget, 4) | thermal (CLU) | 3 |
| Kornet team (9K135) | 2 | Kornet-E (36, CE 1,200, laser beam riding, 4) | thermal | 2 |
| RPG team (RPG-7V2) | 2 | PG-7VR (3, CE 650) and TBG-7V thermobaric (3, lethality 3), 6 | NVG | 3 |
| Carl Gustaf team (M4) | 2 | 84 mm FFV751 HEAT (6, CE 500), HE 441D (8, lethality 1.5), 6 | NVG | 3 |
| Stinger team (FIM-92J) | 2 | Stinger (32, air only, 3) | thermal | 3 |
| Igla team (9K338 Igla-S) | 2 | Igla-S (40, air only, 3) | NVG | 3 |
| Sniper team, West | 2 (sniper, spotter) | MK22 .338 Norma (10, one casualty a hit, suppression 25); spotter | thermal | 3 |
| Sniper team, East | 2 | SV-98M 7.62 (7) | thermal | 3 |
| Mortar team, West | 3 | M252A1 81 mm (37, HE lethality 2, blast 1; smoke 3) | NVG | 2 |
| Mortar team, East | 3 | 2B14 Podnos 82 mm (26) | NVG | 2 |
| Engineer squad | 6 | small arms (4), breach, AT mines (3), smoke pots (2) | NVG | 3 |
| Medic team | 2 | pistols and rifles (3), treat | NVG | 3 |
| FPV team | 2 | FPV drones with PG-7VL warhead (20, CE 500, top or rear, 4) | thermal | 3 |
| Switchblade team | 2 | Switchblade 600 (40, CE 800, top, 2) | thermal | 3 |
| Lancet team | 2 | ZALA Lancet-3 (40, CE 600, top, 2) | thermal | 3 |

### 4.6 Support vehicles and drones

| Type | Crew | Weight | Speed | Weapons | Armour front/side | Move |
|---|---|---|---|---|---|---|
| Flakpanzer Gepard 1A2 | 3 | 47.5 t | 65 km/h | 2 x 35 mm KDA: air (26, aim 80), ground (20, pen 90); search radar | 40/25 | 8 |
| 2K22M1 Tunguska-M1 | 4 | 34 t | 65 km/h | 2 x 30 mm 2A38M: air (26), ground (15, pen 45); 9M311-M1 (40, air only, 4) | 20/20 | 8 |
| M109A7 Paladin | 4 | 39 t | 61 km/h | 155 mm M284: HE (field, min 6, lethality 3, blast 1, suppression 50, demolition 50, 8); M825 smoke (3) | 30/20 | 7 |
| 2S19M2 Msta-S | 5 | 42 t | 60 km/h | 152 mm 2A64M: HE (field, min 6, 8); smoke (3) | 30/20 | 7 |
| M142 HIMARS (off map) | 3 | 16 t | 85 km/h | GMLRS unitary: aim 95 on an observed cell, blast 1, top 300, demolition 80, 2 missions | - | - |
| 9A53-G Tornado-G (off map) | 3 | 24 t | 90 km/h | 122 mm salvo: blast 2, lethality 2.5, suppression 60, 1 mission | - | - |
| M88A2 Hercules | 3 | 63.5 t | 48 km/h | .50 cal M2 (12); repair | 100/50 | 6 |
| BREM-1M | 3 | 41 t | 60 km/h | 12.7 mm NSVT (12); repair | 100/50 | 7 |
| RQ-11B Raven | - | 2 kg | 95 km/h | none; looks down within 14, lasers for the guns | any hit | 18 |
| Orlan-10 | - | 18 kg | 150 km/h | none; looks down within 14, lasers for the guns | any hit | 18 |

### 4.7 Unit values

For results (each formation's `kept`) and balance: Abrams, Leopard 2A7, Challenger 3 11; T-90M 10;
T-80BVM 9; T-72B3 8; Booker 7; Sprut 6; IFVs 6 to 7; Stryker 5; ATGM carriers 5; SPGs 6; AD
vehicles 6; recovery 4; attack helicopters 10; Mi-35 9; AH-6 5; transports 5; rifle squad 4;
fireteam 2; ATGM teams 3; RPG and Carl Gustaf 2.5; MANPADS 2.5; sniper 2; mortar 2.5;
engineers 3; medics 1.5; FPV team 2.5; loitering team 3; recon drone 1.5.

A unit's condition: vehicle intact 1, each crew casualty -0.15, mobility or firepower kill 0.6,
both 0.35, knocked out 0 (0.2 if its side won: recovered), catastrophic 0; squads (fit + half the
wounded) / men at start; aircraft 1, forced landing 0.3, shot down 0.

## 5. Forces (decision 2)

Each war-map formation in the battle becomes a detachment; together they make a company of
10 to 16 units a side: `count = clamp(round(4 + 3.5 x total strength / 1000 + 1.5 x formations), 10, 16)`,
shared out by strength. Each class has a template, cycled in order:

| Class | West (US: Aster) | West (Europe: Selmar) | East (Korva) | East (Drevan) |
|---|---|---|---|---|
| Armour | 4 x M1A2 SEPv3, M88A2 | 4 x Leopard 2A7 or Challenger 3, M88A2 | 4 x T-90M or T-80BVM, BREM-1M | 4 x T-72B3 or T-80BVM, BREM-1M |
| Mechanised | 3 x Bradley or Stryker, each with a squad | 3 x CV90 with squads | 3 x BMP-3 with squads | 3 x BMP-3 with squads |
| Infantry | 3 squads, Javelin, sniper, mortar, Carl Gustaf | 3 squads, Carl Gustaf, Javelin, sniper, mortar | 3 squads, Kornet, RPG, sniper, mortar | 3 squads, RPG, Kornet, mortar, sniper |
| Recon | M10 Booker, M1134 ATGM, Raven, sniper | CV90, Raven, M1134 ATGM, sniper | Sprut-SDM1, Kornet-D, Orlan-10, sniper | Kornet-D, Orlan-10, Sprut-SDM1, sniper |
| Artillery | 2 x Paladin, mortar; HIMARS | 2 x Paladin, mortar; HIMARS | 2 x 2S19M2, mortar; Tornado-G | 2 x 2S19M2, mortar; Tornado-G |
| Air | 2 x AH-64E, AH-6M, UH-60M with a squad | AH-64E, AH-6M, UH-60M with a squad | 2 x Ka-52, Mi-8 with a squad | Mi-35M with a squad, Mi-35M, Mi-8 with a squad |
| Drones | Raven, 2 FPV teams, Switchblade team | Raven, 2 FPV teams, Switchblade team | Orlan-10, 2 FPV teams, Lancet team | Orlan-10, 2 FPV teams, Lancet team |

Company attachments fill what is left, in order: medic team; air defence when the other side has
aircraft (Gepard or Stinger team for the West, Tunguska or Igla team for the East); engineers for
cities, objectives and rivers; recovery vehicle with 3 or more heavy vehicles; sniper team.

Formation strength under 1000 thins its squads (men scale with strength, at least 2) and its
detachment's share. Ranks come from each formation's experience (Recruit 0, Veteran 15, Elite 35,
Ace 60). The defender's crews take their rank from the enemy skill: under .35 Recruit, under .6
Veteran, under .8 Elite, else Ace.

## 6. AI (decision 20)

The AI plays from its side's view: units it can see now, ghosts of those it saw, the map, smoke and
its own units. It never reads hidden units, the stream state, or a roll before it is made.
Tests prove both: the plan is identical when an unseen enemy unit moves, and identical for any
stream state. Its tie-break noise comes from a hash of (seed, round, unit), never the dice.

Each turn:

1. **Assess**: a threat map (expected damage a typical unit of ours would take in each cell from
   every known enemy weapon with line of sight and range), the objective, and our units' states.
2. **Pull back** damaged units: a vehicle with a damaged component or lost crew, a squad under half
   strength, anything broken or pinned in a threatened cell moves to the safest reachable cell
   (least threat, in cover, toward friends) and hunkers or gets treated.
3. **Recon**: drones, scout helicopters and scouts move to spot (high ground, flanks) outside
   known threat.
4. **Indirect fire**: suppress the enemy units that most threaten our plan with HE; or lay smoke
   where a planned crossing is exposed.
5. **Smoke before open ground**: a maneuver unit whose route crosses 3 or more cells seen by known
   enemies first lays smoke (its own grenades, a mortar or gun smoke round, engineer pots) on the
   line between the threat and the route, and moves only if exposure falls by half.
6. **Suppress, then flank**: fire-support units (tanks, IFVs, MGs, ATGM teams) shoot first,
   valuing suppression on the units the maneuver group means to flank; maneuver units then score
   cells by side or rear facing on suppressed or engaged targets, cover, and threat.
7. **Hunt helicopters**: AD units put aircraft first, move to cover the last known helicopter
   positions and the friends they threaten, and set air overwatch when nothing is in sight.
8. **Support**: medics go to wounded squads, recovery vehicles to immobilised vehicles, engineers
   breach the obstacle on the route or (defending) mine the approach.
9. Leftover units take the best shot, set overwatch on likely approaches, or hunker.

Skill (0..1) sets the enemy crews' rank (shown on their cards) and decision quality: noise in its
scores falls with skill, and the tactics in steps 5 to 7 are used with probability rising with
skill (a raw enemy rushes and takes long shots). The defender deploys before the battle: hull-down
and building positions covering the approaches, AT teams on the flanks, AD central, guns at the back.

## 7. Art plan (decisions 13 to 16)

Look: a grounded documentary palette. Muted, real colours (CARC tan 686A and NATO three-colour on
the West, Russian 4BO green and summer camouflage on the East), dust on lower hulls, edge wear,
haze and a slightly desaturated grade, like drone footage and Arma.

**Models**: no CC0 or CC-BY model exists for most of these designations that this build can fetch
(the sandbox reaches GitHub and npm only; Sketchfab, Poly Haven and Quaternius are blocked), so
every vehicle, helicopter and soldier is built in code from its real dimensions and silhouette
(never a placeholder box): lofted and extruded hulls, wedge or cast turrets, road wheels and track
links by the real count, ERA tiles, slat cages, RWS, sights, smoke dischargers, rotor heads,
stub wings, tandem cockpits; soldiers as articulated figures (helmet, plate carrier, pack, rifle,
limbs) animated in code (walk, run, kneel, prone, fire, fall), drawn instanced per body part.
The CC-BY 4.0 AH-64D model (rotors separated) stays as the Apache. Paint, camouflage, wear and
mud are textures generated in code.

| Asset | Source | Licence | Size |
|---|---|---|---|
| Every vehicle, helicopter, drone and soldier | Built in code (`apps/web/src/arena/models3d/`) | Project | no art files; code in the battle chunk |
| AH-64 Apache | Muhamad Mirza Arrafi, rotors separated | CC BY 4.0 | 562 KB |
| Hesco barrier | polbrainstorm | CC BY 4.0 | 105 KB |
| Skies: day, dawn, dusk, night | Poly Haven HDRIs via `@pmndrs/assets` | CC0 | 643 KB |
| Radio calls (26) | Generated with Kokoro TTS (Apache-2.0 model), radio-filtered offline (`tools/art/radio.py`) | Generated | 172 KB |
| Ground, trees, buildings, water, snow, smoke and fire | Generated in code per biome | Project | 0 |
| Weapon reports, engines, rotors | Synthesised in WebAudio by calibre | Project | 0 |

Battle art is 1.5 MB of the 25 MB budget, fetched on the first battle and cached by the service
worker; nothing is fetched from a third party at runtime. Retired from the battle and no longer
served: the T-72 GLB, the drone GLB, the Mixamo soldiers, containers and the watch tower (git
history keeps them; the war map's top-down sprites made from them stay, see `CREDITS.md`).

**World**: biomes temperate, steppe, desert, winter, dense urban (from the theatre, the hex's
terrain and site, and the seed); times dawn, day, dusk, night (thermal white-hot view at night);
weather clear, overcast, rain, fog, snow. Buildings crumble into rubble; craters and wrecks stay.
Effects: lit smoke volumes from instanced soft particles, tracers that glow at night, burning
wrecks with flame and smoke columns, rotor wash (dust, snow or spray rings under low helicopters),
muzzle flash, dust behind tracks, debris.

**Camera** (decision 14): a tactical orbit view (drag to pan, pinch to zoom, two-finger twist or
right-drag to orbit and tilt) and short action cams on big hits (catastrophic kills, helicopters
shot down, ATGM impacts), about 1.5 s, which the player can turn off.

**Audio** (decision 18): reports synthesised per calibre (5.56, 7.62, 12.7, 25 to 35 mm, 100 to
125 mm, 152 and 155 mm, 122 mm rockets, ATGM and MANPADS launch, FPV whine), diesel and turbine
engines, rotor slap, distance falloff with a filtered echo, and short radio calls from your side:
"Contact front", "Target destroyed", "Taking fire", "Man down", "Smoke out", "Splash", "Vehicle
hit", "Air threat".

## 8. Performance budget (decision 17)

iPhone 13 and newer at 60 fps on Balanced. Desktop gets High.

| | Low | Balanced (phones) | High (desktop) |
|---|---|---|---|
| Pixel ratio cap | 1 | 1.6 | 2 |
| Shadow map | off | 1024 | 2048 |
| Grass and scrub instances | 600 | 1,500 | 4,000 |
| Smoke and fire sprites | 120 | 300 | 700 |
| Flash lights | 0 | 1 | 4 |
| Vehicle detail | far LOD everywhere | full within 14 cells | full within 30 |
| Soldiers | instanced parts, no shadow | instanced parts | instanced parts with shadow |
| Draw calls target | 80 | 150 | 300 |
| Triangles target | 120k | 300k | 900k |

Quality is chosen automatically (phones Balanced, desktops High), can be changed in the battle
menu, and is remembered (`localStorage['brink.arena.settings.v1']`). Measured on an emulated
iPhone (Playwright, 390 x 844 at DPR 3, CPU throttled 4x): JavaScript frame time p50 and p95 and
renderer draw calls and triangles; GPU time cannot be measured in this headless build (software
WebGL) and is reported as unmeasured.

Measured (2026-10-29, `ARENA_PERF=1 pnpm test:e2e arena-perf`, sampled while the
camera pans after a 2 s settle; First Blood is the smallest battle, 10 a side):

| | Low | Balanced | High | Last Stand, Balanced |
|---|---|---|---|---|
| Our frame time p50 | 9.1 ms | 12.1 ms | 13.5 ms | 18.3 ms |
| Our frame time p95 | 17.4 ms | 30.4 ms | 61.4 ms | 54.2 ms |
| Draw calls | 46 | 54 | 54 | 86 |
| Triangles | 118k | 202k | 297k | 268k |
| Battle opens in | 7.5 s | 11.2 s | 15.8 s | 15.6 s |

Last Stand is the largest battle (16 a side, winter fog). Unthrottled it runs p50 4.7 ms and p95
13.1 ms; a CPU profile puts almost all of that in native WebGL calls in the software rasteriser,
not in the game's JavaScript, so the throttled figures overstate a phone with a real GPU.

Every shader compiles before the battle shows (`BattleStage.warm`); that halved the p95. GPU time
on a real iPhone is still unmeasured.

## 9. Migration (nothing is wiped)

- **War-map contract**: `ArenaBattle { target, attackers, defenders, kept, won }` is unchanged.
  `kept` is now each formation's unit values at the end over the start. The war engine still
  validates kept in 0..1000 and applies it only when the hex holds what was fought.
- **Saves**: `WorldState`, `NationOrders`, `SaveFile`, `SAVE_VERSION` and `RULESET_VERSION` are
  unchanged; the arena's numbers live in `packages/arena`, not `game-data`, and the war engine
  never runs a battle. Every existing save loads and plays.
- **Career**: `localStorage['brink.career.v1']` keeps its shape. The eight skirmish ids and their
  star thresholds are kept, so best stars stay attached and nothing unlocked becomes locked; their
  battles are redesigned for v2. New skirmishes are added with new ids.
- **Ranks and abilities**: `RANKS`, `rankOf` and the ability ids and techs are unchanged.
- **New keys**: `brink.arena.settings.v1` (quality, action cams, radio). Defaults apply when absent.
- **Exports used outside the battle** (`RANKS`, `rankOf`, `CAPTURE_ROUNDS`, `ROUND_LIMIT`,
  `abilitiesFor`, `ArenaResult`, `ArenaSetup`, `SiteKind`, `UnitSpec`) keep their names.

## 10. Testing

- Engine (`packages/arena`): plain-JSON state round trip mid-battle; determinism of whole battles;
  line of sight over ridges and buildings; hull-down; smoke blocks then clears; facing and
  penetration odds; component outcomes; casualties and suppression thresholds; split and merge;
  embark, dismount, carrier destroyed; medic and recovery; called fire observed vs blind; drones
  intercepted; mines; destruction to rubble; capture and round limit; fog (hidden units are not in
  the view); AI no-cheat on sight and dice; AI uses smoke, flanks, pulls back, hunts helicopters.
- Soak (`tests/soak/arena.soak.test.ts`): AI vs AI over hundreds of battles across arsenals, biomes,
  times and weather: no crash, no rejected AI action, no broken invariant, every battle ends;
  balance table written to the log.
- e2e: skirmish journey on desktop; touch-driven battle at 375 x 667, 393 x 852 and 440 x 956 with
  44 px targets and 4.5:1 text contrast checked on every battle screen; battle from the war map on
  an emulated iPhone; frame-time probe.

## Sources

Specifications: General Dynamics Land Systems (M1A2 SEPv3, M1126 Stryker, M10 Booker), Krauss-Maffei
Wegmann (Leopard 2A7, Gepard), Rheinmetall BAE Systems Land (Challenger 3), Uralvagonzavod and Omsk
Transmash via Rosoboronexport catalogues (T-72B3, T-90M, T-80BVM, BMP-3, BREM-1M, 2S19M2, 2S25M,
Tornado-G), BAE Systems (M2A3 Bradley, CV90, M109A7, M88A2), Lockheed Martin (M142 HIMARS, GMLRS,
Hellfire), Raytheon and Lockheed Martin Javelin JV (FGM-148), RTX (FIM-92 Stinger, TOW-2B), KBP Tula
(Kornet, 9M117, Tunguska, Igla-S), Saab (Carl-Gustaf M4), AeroVironment (Switchblade 600, RQ-11B),
ZALA (Lancet), Boeing (AH-64E, AH-6), Kamov and Mil (Ka-52, Mi-35M, Mi-8AMTSh), Sikorsky (UH-60M),
and US Army fact files. Armour: open-source estimates (public analyses of RHA equivalence), rounded;
the real values are classified, so these are game values with a public basis, not facts.

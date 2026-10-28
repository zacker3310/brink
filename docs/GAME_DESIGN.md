# Brink: game design

The rules as implemented, ruleset `1.5.0`. Numbers come from `packages/game-data`; when this
document and the code disagree, the code is right and this file is stale.

## Premise

Four fictional powers fight over the Meridian basin. You lead one; three AIs lead the others. Every
turn all four write their orders in secret, then one deterministic engine resolves them all at once.
One turn is six hours. You see only what your units and cities can see.

## The turn

1. **Plan.** Give each formation an order (move, attack, dig in, hold, scout, withdraw). Recruit at
   cities, start a building, set the budget, pick research, make diplomatic moves, answer a world event.
2. **Review.** End Turn opens the order review: orders by type, units without orders, what you spend
   against what you hold, resources that will run out within two turns at last turn's rate, units
   under half supply, and anything the engine will refuse (its own check, run on your draft).
3. **Commit.** Your orders lock. The AIs lock theirs against the same world.
4. **Resolve.** The engine runs twelve phases in a fixed order (below).
5. **Replay and debrief.** Events play back on the old board, then the debrief and full report.

### Resolution order

| # | Phase | What happens |
|---|---|---|
| 1 | Validate | Every submission is checked against the start-of-turn world. Illegal orders are dropped with a stated reason; a formation without a legal order holds. Recruits and buildings reserve from one shared budget, in site order, so nothing is overspent. |
| 2 | Diplomacy | Treaties past their last turn lapse. Declarations of war, then embargoes, take effect at once. Mutual offers take effect. New enemies sharing a hex separate. |
| 3 | Production | Work at sites that changed hands is cancelled without refund. New recruits and buildings are paid and queued. Industry goes to construction first, then units. |
| 4 | Logistics | Supply flows from capitals, cities and depots. |
| 5 | Reconnaissance | Vision is computed. |
| 6 | Strikes | Artillery, helicopter and drone strikes, all from one snapshot, committed together. |
| 7 | Movement | All ground movement on one clock (below). |
| 8 | Engagements | Assaults and head-on meetings from the post-movement snapshot, committed together. Hand-fought battles apply here. |
| 9 | Territory | Beaten defenders retreat, winners advance, hexes and sites change hands. |
| 10 | Economy | Income, upkeep, budget, research, stability, entrenchment, reinforcement. |
| 11 | Victory | Eliminations, then the victory paths in fixed order. |
| 12 | Reports | Each nation gets the events it is entitled to see. |

### Simultaneity rules

- **Movement** runs on one clock. Each step arrives at its cumulative cost over the formation's
  allowance, so fast units arrive sooner. Steps arriving at the same instant are judged together
  against the same snapshot: head-on, swap and contested-hex conflicts are symmetric, and no nation or
  id moves first.
- **Two nations attacking one hex**: a defender attacked from two sides fights both at full strength;
  each assault is computed from the same snapshot.
- **Opposing armies crossing paths** meet: a meeting engagement where they collide.
- **A site captured with work pending**: its production and construction are cancelled, no refund.
  Standing facilities pass to the new owner intact.
- **An alliance changing during a turn**: diplomacy is phase 2, so everything after it (movement,
  combat, supply) uses the new relations. War breaks out before anyone moves.
- **Tie-breaking**: everything iterates in sorted id order; randomness is a hash of the seed and the
  ids involved (`roll(seed, ...ids)`), never a sequential stream, so results never depend on order.

## Economy

Four stockpiled resources and two throughputs:

| | Source | Sink |
|---|---|---|
| Credits | Sites, territory (1 per 4 hexes), trade | Recruits, buildings, unit and building upkeep, research/infrastructure/welfare budget |
| Energy | Sites, power plants | Upkeep of motorized units and factories, fuel, 1 per 5 industry |
| Materials | Sites, mines, trade | Recruits, buildings, ammunition, reinforcement |
| Food | Sites, farms | Population (1 per 200k), infantry upkeep |
| Industry | Sites, factories | Builds units and facilities (per turn, not stored) |
| Research | Sites, labs, research budget | Technologies |

Shortages are never negative stock: unpaid upkeep is a shortage with a penalty (food: morale and
stability; credits: readiness and stability; energy: half industry). Stability below 40 cuts income
by a fifth.

### Facilities

One of each per site; capitals hold 4, cities 3, depots and objectives 2. Paid in full when ordered;
built with industry ahead of units; captured with the site.

| Facility | Cost | Industry | Effect | Upkeep | Needs |
|---|---|---|---|---|---|
| Farm complex | 70 cr, 30 mat | 30 | +12 food | none | none |
| Mine | 90 cr, 20 mat | 40 | +12 materials | 1 en | none |
| Power plant | 100 cr, 60 mat | 45 | +14 energy | 2 cr | none |
| Factory | 120 cr, 80 mat | 60 | +12 industry | 2 en | Industrial Automation |
| Research lab | 140 cr, 40 mat | 50 | +8 research | 3 cr, 1 en | Signals Intelligence |
| Fortress | 100 cr, 100 mat | 60 | Own ground units here never drop below 60 entrenchment, even after a strike | 2 cr, 2 mat | Logistics Doctrine |

## Military

Seven classes (`UNITS` in game-data): infantry, mechanized infantry, armor, artillery, recon,
attack helicopters, drones. Each has soft and hard attack, defense, hardness, range, vision, movement,
fuel and ammunition use, cost, industry, upkeep and supply demand.

**Assaults** compare attacker power (soft or hard attack against the defenders' hardness, condition,
combined arms, terrain penalties for armor, river crossings) with defender power (defense, terrain
cover, which infantry uses best and armor least, entrenchment, dig-in orders, home ground). The
attacker's share of the total decides the outcome: 600 permille or more breaks through, 450 or less
is repulsed, between is inconclusive. Losses scale with the opposing power and a seeded swing of at
most 15% either way, so preparation decides and dice only shade it. Defenders whose organization
falls to 15 break and retreat; a formation at 50 strength or less is destroyed.

**Strikes** (artillery, helicopters, drones) hit a hex in range, halved when unspotted, reduced by
terrain and entrenchment, and strip 25 entrenchment. Ground units fire back at aircraft.

**Hand-fought battles**: an attack on a hex with seen enemies can be fought in the arena; the result
replaces the dice if the hex still holds what was fought. See `docs/arena.md`.

## Supply

Supply flows automatically from capitals (60), cities (30) and depots (25) along owned or friendly
ground. Route cost beyond the supply range (16, plus tech and doctrine) loses 5% delivery per point;
passing next to an enemy costs 3 more. Supply sets readiness each turn (80% or more: +10; under 25%:
-10); low readiness slows and weakens units, and only units at 80% supply on home ground reinforce.
The supply priority per unit decides who is served first when there is not enough.

## Research

Six technologies in three short chains, each unlocking a capability as well as a bonus:

| Technology | Effect | Unlocks |
|---|---|---|
| Logistics Doctrine | +25% supply, +2 range | Fortress; Field repair in battle |
| Signals Intelligence | +1 vision | Research lab; Recon sweep in battle |
| Industrial Automation | +20% industry | Factory; Mines in battle |
| Combined Arms (after Logistics) | +5% per extra class in an assault | Air strike in battle |
| Precision Munitions (after Signals) | +20% strikes | Guided missiles in battle |
| Composite Armor (after Automation) | +20% armor defense | Composite armour in battle |

## Nations

Four governments with asymmetric doctrines (`GOVERNMENTS`): the Mercantile Commonwealth (credits,
stability, research; weaker attack), the Industrial Directorate (industry, attack; brittle
stability), the Technocratic Federation (research, supply range, food; fewer materials), the Agrarian
Union (food, materials, cheaper recruits, home defense; slower research).

## Diplomacy

Relations are war, peace or alliance. Offers are binding only when both sides make them: an offer
waits two turns for an answer, and a matching offer, this turn or within the wait, takes effect at
resolution. Declarations of war and embargoes take effect at once.

| Action | Needs | Effect |
|---|---|---|
| Declare war | Not at war; no pact in force | War at once. Ends trade. Costs the declarer 10 stability (20 against an ally). |
| Offer peace | War | Peace when both offer. |
| Offer alliance | Peace | Alliance when both offer. Allies share vision and fight side by side. |
| Offer non-aggression pact | Peace | For 6 turns neither side may declare war on the other: the validator refuses it. |
| Offer trade | Not at war, no embargo | For 8 turns both gain 14 credits and 6 materials a turn. Renew by offering again in its last turn. Ends at war. |
| Embargo | No embargo of yours in force | Ends trade at once; no trade between the two for 5 turns. |

Treaties are public: every power sees every agreement. Nations at peace may share ground; when war
breaks out over a shared hex, the side not on its own ground falls back.

## Victory

Checked every turn in this order; the first that applies ends the campaign.

1. **Last standing**: the only nation left with a capital or city.
2. **Domination**: one nation holds 40% of all victory points.
3. **Coalition** (from turn 8): a bloc of two or more nations, each pair allied, holds 20% plus 20%
   per member of all victory points: 60% for two, 80% for three. It scales so allies cannot win by
   signing (three of four powers start with about two thirds of the map). The member with the most
   VP leads it; every member wins.
4. **Supremacy** (from turn 8): one nation's average share of victory points, army strength and
   output (resources plus industry) reaches 38%, about 1.5 times a fair share across all three at
   once, with stability of at least 45.
5. **Score**: at the turn limit, the highest standing (the same average) wins; victory points break
   ties.

The standing is public, shown in the World card. Every campaign ends at its turn limit at the latest.

## Campaigns

| Length | Turns | Target |
|---|---|---|
| Quick | 20 | 20 to 40 minutes |
| Standard | 30 | |
| Epic | 45 | |

Difficulty: Easy (one front; the AI never declares war on you and accepts your peace; half again your
starting stockpile), Normal (everyone at war from turn 1), Hard (the AI starts with the bonus).
Theatres: the Meridian, the Highland Front (one war won), the Varn Delta (two wars won). The seed
fixes the map texture and every roll.

## AI

Each AI nation sees only its own view. Per turn it assesses threats to its sites, picks a target
objective, withdraws spent units, defends pressed sites, takes odds-checked assaults (it attacks only
at 500 permille or better), advances on the objective, rebases aircraft, recruits against the enemy
mix it has observed, builds one facility at a time (fixing its scarcest resource first, then a
factory or lab, a fortress at a pressed capital) paced to two plus one per four turns, researches
the cheapest open project, offers trade to anyone it is not fighting and a pact to stronger
neighbours it does not plan to attack, settles stalled wars and turns on the weakest power. It never
submits an order the validator refuses: across the 100-match soak it has zero rejections.

## Determinism and saves

Same world, orders and seed: same result and hash, whatever order the submissions arrive in. Saves
hold the whole world, the AI memory and the player's reports, hashed. A save from an older ruleset or
save version is migrated forward on load (the hash is checked on the save as written); a newer one is
refused with a reason; a tampered one is refused.

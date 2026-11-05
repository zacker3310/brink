# Brink: game design

The rules as implemented, ruleset `2.9.0`. Numbers come from `packages/game-data`; when this
document and the code disagree, the code is right and this file is stale.

## Premise

The United States, Russia, China and Japan fight across the Pacific (docs/pacific.md). You lead one;
three AIs lead the others, and seven minor states (Canada, Mexico, North and South Korea, Taiwan, Kazakhstan, Mongolia) hold
their own ground with militias. Every turn all of them write their orders in secret, then one
deterministic engine resolves them all at once.
One turn is six hours. You see only what your units and cities can see.

## The turn

1. **Plan.** Give each formation an order (move, attack, dig in, hold, scout, withdraw, airlift). Recruit at
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
| 2 | Diplomacy | Treaties past their last turn lapse. Declarations of war, then embargoes, take effect at once. A demand left unpaid lapses (defied). Mutual offers take effect: relations, treaties, exchanges and tribute. New enemies sharing a hex separate. |
| 3 | Production | Work at sites that changed hands is cancelled without refund. New recruits and buildings are paid and queued. Industry goes to construction first, then units. |
| 4 | Logistics | Supply flows from capitals, cities and depots. |
| 5 | Reconnaissance | Vision is computed. |
| 6 | Strikes | Artillery, helicopter and drone strikes, all from one snapshot, committed together. |
| 7a | Airborne | Airlifts and drops, from one snapshot, before anything walks (below). |
| 7 | Movement | All ground movement on one clock (below). |
| 8 | Engagements | Assaults and head-on meetings from the post-movement snapshot, committed together. Hand-fought battles apply here. |
| 9 | Territory | Beaten defenders retreat, winners advance, hexes and sites change hands. |
| 10 | Economy | Income, upkeep, budget, research, stability, entrenchment, reinforcement. |
| 11 | Victory | Eliminations, generals, a joint operation whose prize a partner took ends, leaders remember the turn, then the victory paths in fixed order. |
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

One of each per site; capitals hold 4, cities 3, depots and objectives 2, and a city gains one more
slot at development levels 3 and 5. Paid in full when ordered (Urban Planning takes 15% off); built
with industry ahead of units, in queue order; captured with the site.

| Facility | Cost | Industry | Effect | Upkeep | Needs |
|---|---|---|---|---|---|
| Farm complex | 70 cr, 30 mat | 30 | +12 food | none | none |
| Mine | 90 cr, 20 mat | 40 | +12 materials | 1 en | none |
| Power plant | 100 cr, 60 mat | 45 | +14 energy | 2 cr | none |
| Factory | 120 cr, 80 mat | 60 | +12 industry | 2 en | Industrial Automation |
| Research lab | 140 cr, 40 mat | 50 | +8 research | 3 cr, 1 en | Signals Intelligence |
| Fortress | 100 cr, 100 mat | 60 | Own ground units here never drop below 60 entrenchment, even after a strike | 2 cr, 2 mat | Logistics Doctrine |
| Naval yard | 110 cr, 70 mat | 50 | +6 industry, +20 supply capacity; ports only | 2 cr, 1 en | Naval Engineering |
| Airbase | 120 cr, 10 en, 60 mat | 55 | A strike sortie in your hand-fought battles within 4 hexes; +10 supply capacity | 3 cr, 2 en | Air Mobility |
| Missile battery | 130 cr, 90 mat | 60 | Your defenders in the hex +15%; a cruise missile in your battles within 3 hexes | 3 cr, 1 mat | Cruise Missiles |

### City development

Capitals and cities grow (`CITY_GROWTH` in `game-data/src/cities.ts`, the development phase right
after the economy): 2 development a turn, +1 per facility standing there, +1 for a capital, +50%
with Urban Planning; none while the owner's stability is under 40 or its food ran short that turn.
Levels at 0, 24, 60, 120 and 200 development; every level above the first adds 2 credits, 2
industry and 2 research to the city's yields, and levels 3 and 5 open a facility slot. A city that
changes hands keeps half its development. Its owner is told when it reaches a new level; rivals see
a city's development only while they can see the city.

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

## Airborne (ruleset 2.9.0)

Light formations fly (`AIRBORNE` in `game-data/src/airborne.ts`; rules in `simulation/src/airborne.ts`).
An airlift order names a land hex; the formation flies from where it stands:

| Origin | Range | Lifts a turn | Who |
|---|---|---|---|
| An own site with an Airbase | 12 hexes | 2 | infantry, recon; mechanized only onto an airfield |
| An own capital-class site (a nation's capital, or one taken: a captured Ulaanbaatar is a base) | 10 | 1 | the same |
| A carrier's deck: troops aboard an amphibious group lying in the same hex as an own carrier group (its helicopters and tiltrotors) | 7 | 2 per carrier | infantry, recon |

- **Air-land**: onto an own or allied site (or a passage partner's), in good order.
- **Drop**: onto any other land hex in range (enemy, minor, unowned). The drop comes down scattered
  (-25 organization, -20 readiness), stays where it lands that turn, takes the ground it lands on, and
  may attack next turn. Supply never flies: off its own lines it is out of supply (and loses 10 strength
  a turn) until it takes a site or links up.
- **Air assault**: a drop onto a hex a hostile holds comes down beside it (the quietest open hex next to
  it) and storms it at once, at -40% attack (`assaultPenalty`), alongside anyone else attacking it.
- **Cost**: 20 credits a formation, reserved at validation after recruits, buildings and deals (a lift
  that does not fit is refused and holds), plus 4 energy of fuel burned from what there is.
- **Interception**: each lift is a roll, `roll(seed, turn, 'airlift', id)`, against a chance summed over
  every hostile threat that reaches the flight's corridor or the landing hex: aircraft 12% (within their
  strike range), drones 6%, fleets 8% and carriers 4% (within 2), missile batteries 15% (within 3); at most
  45%. A hit costs 250 strength and 15 organization; the survivors still land. The event names who shot.
- **Turned back** (nothing paid back): two powers not allied coming down in one hex (both), a full
  landing zone, neutral troops or a neutral power's land (without passage), the carrier sunk before
  take-off, or nowhere to come down beside a held hex.
- Aircraft rebase onto a site the moment it is yours: drop on a city, take it, and the helicopters and
  drones land there next turn.

## Supply

Supply flows automatically from capitals (60), cities (30) and depots (25) along owned or friendly
ground. Route cost beyond the supply range (16, plus tech and doctrine) loses 5% delivery per point;
passing next to an enemy costs 3 more. Supply sets readiness each turn (80% or more: +10; under 25%:
-10); low readiness slows and weakens units, and only units at 80% supply on home ground reinforce.
The supply priority per unit decides who is served first when there is not enough.

## Research

Twenty-four technologies in five branches (`game-data/src/research.ts`), each with its
prerequisites (every one of them first). Research points come from sites, labs, city levels and the
research budget; one project at a time, up to 300 points banked while none is chosen. Effects reach
the whole game: modifiers (combat, supply, movement, income, research, city growth, facility costs),
doctrine (hand size, Command Points), facilities unlocked, and off-map support over every
hand-fought battle. The six of ruleset 2.0 keep their ids and battle abilities.

| Branch | Technologies (cost, prerequisites) | Gives |
|---|---|---|
| Logistics & Economy | Logistics Doctrine (120); Industrial Automation (160); Urban Planning (200, Automation); Rail Network (220, Logistics); War Economy (300, Urban Planning + Rail) | Supply; industry and the Factory; growth +50%, buildings -15%; supply and materials; industry and income |
| Armour | Combined Arms (180, Logistics); Composite Armor (200, Automation); Mobile Warfare (240, Combined Arms); Active Protection (260, Composite); Next-Generation Armour (340, Mobile + Active) | Mixed assaults; armour defense; +1 armour movement; more armour defense; +20% armour attack |
| Air & Missiles | Air Mobility (140); Precision Munitions (200, Signals); Loitering Munitions (200, Air Mobility); Cruise Missiles (260, Precision); Stealth Airframes (360, Cruise + Loitering) | Strikes, the Airbase and a sortie per battle; +20% strikes; a kamikaze swarm per battle; the Missile battery and a cruise missile per battle; strikes and another sortie |
| Naval | Naval Engineering (140); Littoral Warfare (200, Engineering); Carrier Aviation (260, Engineering + Air Mobility); Blue-Water Navy (340, Littoral + Carrier) | +1 ship movement and the Naval yard; ship attack, naval gunfire on the coast; ship defense, a coastal sortie; all three |
| Cyber & Intel | Signals Intelligence (140); Staff College (150); Electronic Warfare (220, Signals); Command Networks (260, Staff College + Signals); Quantum Computing (320, EW + Networks) | Vision and the Research lab; a fourth card in hand; attack and home defense; +1 Command Point a turn; +25% research |

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
| Offer a ceasefire | War | Peace when both offer, and for 3 turns neither may declare war. |
| Offer an exchange | Not at war, no embargo | Resources change hands once (up to 400 of each), when the other side offers the mirror. What you give is reserved like a recruit's cost. |
| Demand tribute | Peace | An ultimatum: paid when they offer the payment back. Unpaid after two turns, it lapses: they defied you. |
| Alliance against X | Not at war with each other; no pact or ceasefire with X | Allies, and whichever of you is not yet at war with X goes to war (perfidy applies). |
| Joint operation | Not at war with each other; you at war with the prize's holder | For 5 turns both march on one city; ends when either takes it. |
| Right of passage | Peace (allies have it already); may name whom it is for | For 8 turns, both ways: march through and share the other's hexes, supply across its land, rebase aircraft to its sites and air-land troops there. Takes no ground. Ends at war. Leaders refuse it toward their allies and powers they like, and never to the power they march on; a hawk wants a warm mood, a dove less, an unnamed request more. |

### Leaders

Every power is run by an invented leader (`game-data/src/leaders.ts`; no real head of state by name
or likeness): a temperament (hawk, dove, opportunist), an agenda (Balance of Power, Open Seas, A Word
Kept, Iron Respect, Lost Provinces) and lines for every occasion. Leaders remember what was done to
them (betrayals, wars declared, cities taken, peace, deals, tribute, defiance, joint victories), each
memory fading over its own span; hawks hold grudges at 150%, doves at 70%. Their mood toward each
rival, from -100 to 100, is the sum of those memories and how things stand now (war, alliance,
treaties, a common enemy, fear of a runaway leader, the agenda), and it is shown itemised, Civ-style.

A leader answers an offer at once on the diplomacy screen with the same judgement they make when the
turn resolves (`packages/ai/src/diplomacy-ai.ts`): mood, temperament, how their war goes and the terms.
They also seek deals of their own: a dove far behind asks for a ceasefire, a hawk far ahead sends a
weaker power an ultimatum and goes to war when defied, friends propose joint operations, the short of
a resource offer a swap. A dove will not declare war on a power it feels warmly about, and nobody
trades with a power they detest.

Treaties are public: every power sees every agreement. Nations at peace may share ground; when war
breaks out over a shared hex, the side not on its own ground falls back.

## Victory

Checked every turn in this order; the first that applies ends the campaign.

1. **Last standing**: the only nation left with a capital or city.
2. **Domination**: one nation holds 32% of all victory points (about twice a power's opening share).
3. **Coalition** (from turn 8): a bloc of two or more nations, each pair allied, holds 20% plus 20%
   per member of all victory points: 60% for two, 80% for three. It scales so allies cannot win by
   signing (three of four powers start with about two thirds of the map). The member with the most
   VP leads it; every member wins.
4. **Supremacy** (from turn 8): one nation's average share of victory points, army strength and
   output (resources plus industry) reaches 29% (31% before ruleset 2.6.0), about 1.2 times a fair share across all three at
   once, with stability of at least 35.
5. **Score**: at the turn limit, the highest standing (the same average) wins; victory points break
   ties.

The standing is public, shown in the World card. Every campaign ends at its turn limit at the latest.

## Campaigns

| Length | Turns | Target |
|---|---|---|
| Quick | 20 | 20 to 40 minutes |
| Standard | 30 | |
| Epic | 45 | |
| Total War | 250 | a war you come back to for weeks |

A Total War is won by conquest, not by leading at turn 50 (`victoryBars`): 60% of all victory
points outright, or 55% standing held from turn 50; coalition, last standing and the score at the
limit are as ever.

A save keeps the last 60 turn reports (`HISTORY_KEPT`), so a Total War still fits a phone's storage;
the world itself stays the same size however long the war runs.

Conquest: a nation holding no capital or city is out, and what is left of the country (its ground
and its bases) falls to the power holding most of its cities, its old capital breaking a tie. Take
every city and the whole country is yours.

Difficulty: Easy (your natural ally fights beside you, Japan with the United States and Russia with
China, sharing sight and supply; one front, the nearest power of the other side; the AI never
declares war on you and accepts your peace; half again your starting stockpile; an opening crisis
keeps the ally unless it sets the two at war), Normal (everyone at war from turn 1), Hard (each AI power starts with a fifth more stockpile, `HARD_AI_STOCKPILE`). The
AI plays at full strength on every level; Easy and Normal give the human seats a command edge
(`DIFFICULTY_EDGE`): Easy +70% income, +60% industry, +50% attack, +50% home defence, units 30%
cheaper; Normal (ruleset 2.6.0) +15% income and industry, +10% attack, +15% home defence, units 10% cheaper.
Measured on the retired Meridian theatre (ruleset 1.6.0) with the AI's own planner in the human seat
(32 campaigns each, 30 turns): Easy wins 88% (66% playing only defensively), Normal 56% (13%), Hard
25%. On the Pacific (12 campaigns each, 30 turns, Japan played by the staff, with the opening
crisis a new campaign deals): Easy wins 11 of 12, Normal 4 of 12. Ruleset 2.5.0, on the Pacific
(`pnpm test:difficulty`: the planner in each of the four seats in turn, 30 turns, no crisis): Easy
88% (32 campaigns), Normal 59% (32), Hard 31% (48); ruleset 2.6.0: Easy 84%, Normal 59%, Hard 25% (32 each). In tactical battles the enemy
also reads less well on Easy (lower skill).
Theatre: the Pacific, the only one since ruleset 2.0.0 (the Meridian, Highland Front and Varn Delta
were retired; their saves are refused with a message). The seed fixes the ground texture and every
roll; coasts, borders and sites never change.

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

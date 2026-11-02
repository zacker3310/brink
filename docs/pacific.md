# The Pacific (design)

Brink's only theatre becomes the Pacific: four real powers (the United States, Russia, China, Japan)
around a compressed ocean, seven independent states between them, island chains to fight over, and
from Phase 3 a navy. It replaces the Meridian Crisis and its two variants. Shipped in phases; each
phase passes `pnpm check`, the soak and e2e on its own and goes to `main`.

## Map

42 x 20 hexes (840), authored as a character grid in `packages/scenarios/src/pacific.ts`, so the
geography is drawn, not generated. The seed varies only ground texture (forest, hills, mountains)
inside each country, never coastlines or borders. North is up. The map runs from Moscow and St
Petersburg in the west to Washington and New York on the Atlantic in the east: all of Russia and all
of the United States, with the ocean squeezed hard (Tokyo to San Francisco is seven hexes, Hawaii
halfway), so a fleet crosses in a turn and the war is fought on land as much as at sea.

| Region | Where | Starts with |
|---|---|---|
| Russia | European Russia, the Urals, Siberia, Chukotka, Kamchatka, Sakhalin, the Kurils | Russia |
| China | the south of the mainland, Xinjiang to the coast | China |
| Japan | Hokkaido, Honshu, Kyushu (widened past real scale so a power fits) | Japan |
| United States | coast to coast, Alaska, the Aleutians, Hawaii and Guam | United States |
| Canada, Mexico, North Korea, South Korea, Taiwan, Kazakhstan, Mongolia | their real places | themselves (minor states) |

The Bering crossing is land: an army walks from Chukotka into Alaska (and the other way). The Aleutians are two islands strung
west from Alaska toward Kamchatka. Hawaii is two hexes in mid-ocean, Guam one in the south-west.
Kazakhstan and Mongolia sit between Russia and China: the land war's buffer. Korea's long border is
with China (Manchuria); Russia touches it only at Vladivostok's corner. Every power has prizes next
door: Canada and Mexico for the United States, the Koreas and Mongolia for China and Russia,
Kazakhstan for Russia, South Korea across the strait for Japan.

### Parity

Every power starts level, whatever its size (`parity` in `pacific.ts`): the same victory points, the
same raw output (its cities' own yields, before its government's bent, so the Commonwealth's richer
treasury still pays for its modest army), and an army of the same weight. Victory points and yields
are scaled across each power's own sites, so where its strength lies is unchanged; lighter armies are
topped up with garrisons in their cities. The United States is still the biggest country on the map
and Japan the smallest; the scoreboard starts even. Each power's opening army stands on its front:
the US west coast, Russia's Far East, China's north (Harbin), Japan at home.

### Sites

Capitals are the real ones: Washington, Moscow, Beijing, Tokyo. The opening army stands on the
Pacific front (the first cities listed: San Francisco and Los Angeles, Vladivostok and Khabarovsk);
the capital keeps its guard. The United States has six cities and four bases, Russia five cities and
three depots, China four and two, Japan three and one. Each minor: a capital and one to three cities. Island
territories get a city (Honolulu) or a depot (Guam, Adak) so they supply themselves; supply never
crosses water. Victory points weight the prizes: Taipei, Seoul, Mexico City, Ottawa and Pyongyang
are worth more than their size because they are what the war is about.

## Powers

| Power | Government | Why |
|---|---|---|
| United States | Commonwealth (rich, out-researches, modest army) | Buys the war |
| Russia | Directorate (hits first and hard, brittle home front) | Strikes before it cracks |
| China | Union (cheap mass armies, home defence, slow research) | Mass and depth |
| Japan | Federation (reach, vision, better kit sooner) | Small and sharp |

The battle engine maps governments to arsenals (`ARSENAL_OF`): US kit, Russian kit, and for now
China uses the Russian-pattern arsenal and Japan the European one until they get their own.

## Minor states

A minor is a `Nation` with `minor: true`. It holds its cities and a light militia (infantry, one
recon), starts at war with every power, never moves out of its own ground, never proposes or accepts
treaties, and is run by a garrison planner (`planMinor` in `@brink/ai`: hold or defend, strike
anything adjacent). It is eliminated like anyone when its cities fall.

Minors are not players: last standing, coalitions, supremacy and the score count only the four
powers; their victory points are on the board, so taking them is how you win. The UI lists them as
neutral, never as a rival.

## Opening Crises (Phase 2)

A crisis is a story plus a deterministic edit of the turn-1 world (relations, ownership, forces
placed, damage, stability). It is chosen at setup (dealt at random by default, or picked) and stored
in the world (`world.crisis`), so saves and replays carry it. Each has a difficulty and a
recommended power. Later beats fire through the world-events system.

Built (`packages/scenarios/src/crises.ts`, thirteen): Cold Peace, Korean Collapse, Straits of Fire,
Pearl Harbor 2.0, Red Dawn Arctic Edition, The Test, Operation Sombra, Maple Leaf Down, The Kuril
Gambit, Dragon and Bear Divorce, Panama Shut, Ring of Fire, The Pacific Pact. The Pacific Pact is the
bloc war: the United States, Japan, Canada and Mexico allied against Russia and China (allied too).
Allies share supply, ground and sight, a coalition victory is open to each bloc, and a power's
objectives drop its allies' capitals. Each is a pure edit (relations, seized
hexes and sites, landed forces, battered garrisons, stability and stockpile) applied after the
difficulty, so its wars are the story; every power's atlas is refreshed after it. Tests: every crisis
leaves a legal world, and the AI plays five turns of each without a refused order.

Held back until the engine can carry them: Hawaiian Spring (a minor state created mid-campaign) and
Guam Strike (the player picks the enemy on turn 1). Crises that need ships (Pearl Harbor, Operation
Sombra, Panama Shut) get fleets in Phase 3; until then they open with landed troops and damage.

## Navy (Phases 3 to 5, built)

Ruleset 2.1.0. Three classes (`packages/game-data` UNITS): **Fleet** (range 2: strikes ships and the
coast, its fire counts as support for an assault on that hex), **Amphibious Group** (carries two
ground formations), **Carrier Group** (carries two air wings, which strike from its deck).

- **Ports and the sea.** Every coastal site is a port (`Tile.port`). Ships move on water and through
  ports (`enterCost` for naval classes), on the same simultaneous clock as armies; armies never enter
  the sea except aboard. Two stacking layers: a hex holds three ships and three of everything else.
  Ships are built only in ports.
- **Aboard.** `Formation.aboard` names the ship. Boarding (`{ type: 'embark', carrier }`) happens
  before anything moves, in the ship's hex or from a port to a ship lying just off it. Passengers ride
  with the ship, do not count for stacking, are fed by it, and go down with it.
- **Landings.** A passenger ordered onto land leaves from where its ship lay; an assault from the ship
  on a hex next to it fights at a 30% penalty (`AMPHIBIOUS_ASSAULT_PENALTY`), and a winner advances
  ashore. Guns cannot fire from the hold.
- **Carriers.** Aircraft rebase to an own carrier (it may sail the same turn: they follow it) and
  strike from wherever it lies.
- **Sea lanes.** Supply leaves from a friendly port, crosses any sea no enemy holds (cheap per hex),
  and comes ashore anywhere: islands, ships at sea, passengers and beachheads. An enemy fleet on the
  lane cuts it.
- **Combat at sea.** Fleets and aircraft strike ships; ships shoot back at aircraft. Beaten ships in a
  captured port put out to the nearest open sea, with their passengers, or are lost. Ships never join a
  hand-fought land battle.
- **The AI** (`planSea`): armies whose goal is on another landmass march to a port with a transport
  and board; loaded transports sail for the beach nearest the goal and land, storming it when the odds
  are good; empty ones go back for more; fleets escort toward the goal's coast; carriers take aircraft
  on deck. It builds ships in ports, more lift when its war is overseas. Balance of power: from turn 8
  a power six points of standing ahead of every other becomes everyone's target.

Fourth pass (the Bering crossing, conquest of whole countries, 24 AI-only matches): United States 8,
Russia 7, Japan 6, China 3.

Third pass (42 x 20 map, parity, 24 AI-only matches): Japan 10, Russia 7, China 4, United States 3.
Every power wins. The AI: a navy whose army marches on foot takes its own target across the sea with
the troops already aboard; ships keep a hex clear of enemy ships (unless the way round costs more than
two hexes of progress), never route through someone else's port, and try another beach rather than
wait off a defended shore; a target the army can walk to scores higher than one it must sail to; an
enemy city in the way is stormed by everyone at its gates, two or more at once (a garrison in a city
is out of sight, and a move into it only bumps into it). Before parity the United States won 12 of 12
on its head start; Japan won none.

First pass (30 x 18 map, 12 AI-only matches, 30 turns): every power boards and lands; Japan lands up to nine times a
match and takes Busan, Seoul, Wuhan. Winners: United States 9, Russia 3. China and Japan do not yet
win AI-only matches: the next balance pass.

## Playing it on a phone

- **Staff plan, the default.** Every turn opens with the staff's plan drafted for every unit and city
  (the AI's own planner, on the player's view). Change any order, then Execute; Clear hands every unit
  back, Plan drafts it again. Off in the menu (`staffPlan` in prefs). The battle does the same: a
  staff plan for every unit not yet commanded, and Execute plays it and ends the turn.
- **Ready from turn 1.** Every transport sails with two marine regiments aboard; every carrier with its
  own helicopter wing and drone company on deck. Japan sails two carrier groups.
- **Load the fleet.** One button boards everyone in port who fits onto the ships alongside, fighting
  troops first; the staff's orders give way, the player's own do not.
- **Two layers to a hex.** A tap takes the land units if there are any, else the ships; passengers are
  cargo, listed on their ship's card (tap one to land it alone). A carrier is selected with its air wing,
  which strikes from the deck.
- **The ship card does the work.** Load fills it from the port it lies in or off; Land troops puts
  everyone ashore on the open beach nearest the goal, offered only where the shore leads to it.
- **The advisor** (`apps/web/src/advisor.ts`) says what to do next in a sentence above the dock, with
  Show me: troops at sea first, then ships to load, then units waiting.

## Phases

| # | Ships | Notes |
|---|---|---|
| 1 | The Pacific map, the four powers, the five minors, Meridian removed | Ruleset bump. Old saves of the Meridian are refused with a clear message. Tests, soak and e2e move to the new nations. |
| 2 | Opening Crises | World edits plus stories; briefing screen deals them. |
| 3 | Navy core: fleets, transports, ports, sea movement, landings | Built. Pearl Harbor, Operation Sombra and Panama Shut now open with fleets. |
| 4 | Sea combat and carriers | Built. |
| 5 | The AI at sea | Built; soak at 0 rejected orders. Next: balance (China, Japan). |

## Touch points (from the inventory)

- Every `Record<UnitClass, …>`: game-data `UNITS`, pictograms, art manifest, `CLASS_ORDER`,
  `GHOST_CLASSES`, AI `enemySightings` and `wantedClass`, arena `TEMPLATES`, `unitClassName`.
- Nations and theatres: `meridian.ts`, `scenarios/index.ts`, `engine.worker.ts` default, Setup,
  Title, TitleScene, Archive, Manual, Menu tutorial nation, `arena/conditions.ts` biomes, save loader,
  API scenario list.
- Tests: `meridian.test.ts` (becomes `pacific.test.ts`), session, AI, API, soak, arena verify util,
  e2e journey, tutorial, phone.

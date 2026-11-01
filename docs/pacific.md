# The Pacific (design)

Brink's only theatre becomes the Pacific: four real powers (the United States, Russia, China, Japan)
around a compressed ocean, five independent states between them, island chains to fight over, and
from Phase 3 a navy. It replaces the Meridian Crisis and its two variants. Shipped in phases; each
phase passes `pnpm check`, the soak and e2e on its own and goes to `main`.

## Map

30 x 18 hexes (540), authored as a character grid in `packages/scenarios/src/pacific.ts`, so the
geography is drawn, not generated. The seed varies only ground texture (forest, hills, mountains)
inside each country, never coastlines or borders. North is up; Asia is west, the Americas east, the
ocean compressed in the middle (about a third of the real width).

| Region | Where | Starts with |
|---|---|---|
| Russia | Siberia across the north-west, Chukotka, Kamchatka, Sakhalin, the Kurils | Russia |
| China | the west and south-west mainland | China |
| Japan | Hokkaido, Honshu, Kyushu (widened past real scale so a power fits) | Japan |
| United States | Alaska, the west coast states, and the Aleutians, Hawaii and Guam | United States |
| Canada, Mexico, North Korea, South Korea, Taiwan | their real places | themselves (minor states) |

The Bering Strait is one sea hex between Chukotka and Alaska. The Aleutians are three islands strung
west from Alaska toward Kamchatka. Hawaii is two hexes in mid-ocean, Guam one in the south-west.

### Sites

Each power: a capital, three cities, a depot. Each minor: a capital and one or two cities. Island
territories get a city (Honolulu) or a depot (Guam, Adak) so they supply themselves; supply never
crosses water. Victory points weight the prizes: Taipei, Seoul, Mexico City, Vancouver and Honolulu
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

Built (`packages/scenarios/src/crises.ts`, twelve): Cold Peace, Korean Collapse, Straits of Fire,
Pearl Harbor 2.0, Red Dawn Arctic Edition, The Test, Operation Sombra, Maple Leaf Down, The Kuril
Gambit, Dragon and Bear Divorce, Panama Shut, Ring of Fire. Each is a pure edit (relations, seized
hexes and sites, landed forces, battered garrisons, stability and stockpile) applied after the
difficulty, so its wars are the story; every power's atlas is refreshed after it. Tests: every crisis
leaves a legal world, and the AI plays five turns of each without a refused order.

Held back until the engine can carry them: Hawaiian Spring (a minor state created mid-campaign) and
Guam Strike (the player picks the enemy on turn 1). Crises that need ships (Pearl Harbor, Operation
Sombra, Panama Shut) get fleets in Phase 3; until then they open with landed troops and damage.

## Navy (Phases 3 to 5)

Sea hexes become a second layer, the way air already is one.

- **Classes:** Fleet (surface group: fights ships, bombards the coast), Transport (carries up to two
  land formations), Carrier (a moving airfield: helicopters and drones may base on it).
- **Movement:** naval units move only on water and coastal city hexes (ports), through the same
  clocked movement as land, with their own costs. Land units cannot enter water except aboard a
  transport.
- **Landings:** a transport adjacent to land may unload into an empty or enemy hex; an unload into
  enemy ground is an assault at a heavy penalty (amphibious), which the arena can fight by hand.
- **Supply at sea:** ships draw supply at a friendly port within range; land units aboard are fed
  by the transport.
- **Sea combat:** fleets engage enemy ships in their hex or adjacent; carriers project air strikes.
- **AI:** builds ships at ports, escorts transports, lands on undefended coasts, never orders a move
  the validator refuses (soak: 0 rejected orders).

The soak's "no formation on water" invariant becomes "no land formation on water unless aboard".

## Phases

| # | Ships | Notes |
|---|---|---|
| 1 | The Pacific map, the four powers, the five minors, Meridian removed | Ruleset bump. Old saves of the Meridian are refused with a clear message. Tests, soak and e2e move to the new nations. |
| 2 | Opening Crises | World edits plus stories; briefing screen deals them. |
| 3 | Navy core: fleets, transports, ports, sea movement, landings | Crises that need ships use them from here. |
| 4 | Sea combat and carriers | |
| 5 | The AI at sea | Soak at 0 rejected orders. |

## Touch points (from the inventory)

- Every `Record<UnitClass, …>`: game-data `UNITS`, pictograms, art manifest, `CLASS_ORDER`,
  `GHOST_CLASSES`, AI `enemySightings` and `wantedClass`, arena `TEMPLATES`, `unitClassName`.
- Nations and theatres: `meridian.ts`, `scenarios/index.ts`, `engine.worker.ts` default, Setup,
  Title, TitleScene, Archive, Manual, Menu tutorial nation, `arena/conditions.ts` biomes, save loader,
  API scenario list.
- Tests: `meridian.test.ts` (becomes `pacific.test.ts`), session, AI, API, soak, arena verify util,
  e2e journey, tutorial, phone.

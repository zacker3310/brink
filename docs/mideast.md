# The Middle East and Africa (design)

The second theatre (MASTER-PLAN Phase 6: "Middle East: the Gulf, Hormuz and oil shocks" and
"Africa: the Horn, the Sahel, and Suez from the south", built as one theatre). Six regional powers
from the Mediterranean's south shore to the Cape, nineteen minor states between them, and four of
the world's chokepoints. Every leader and general is invented; real countries are treated
even-handedly, and no power is cast as the villain: each is a playable side with a doctrine of its
own, and every pair of powers starts at war, as in the Pacific.

## Map

44 x 44 hexes (1,936), `packages/scenarios/src/maps/mideast.map.json`, written from a character
grid by `gridToMap` (`packages/mapgen/src/mideast.ts`; `pnpm --filter @brink/mapgen map:mideast`
rewrites the file, and a test checks the committed file matches byte for byte). The first draft was
baked from Natural Earth's 1:50m admin-0 countries (public domain) over lon -18..63, lat -35..42,
equirectangular; it was then finished by hand. About 1.8 degrees to the hex: the Levant, Suez, the
Gulf and Bab-el-Mandeb are drawn wider than life so a country fits and each strait is one hex.

North is up. The top rows are the south of Iberia, Italy and Greece (unaligned), Anatolia, the
Caucasus and the Caspian; the bottom row is the Cape.

| Character | Meaning |
|---|---|
| `~` | sea |
| `+` | unaligned land: states not in the war at this scale (Tunisia, Mauritania, West Africa west of Nigeria, Cameroon and the Congo basin's north, South Sudan, Uganda, Tanzania, Zambia, Zimbabwe, Botswana, Madagascar, the Gulf states, Lebanon, Cyprus) and disputed ground (Western Sahara). Nobody's: an army that walks in takes it, out of supply until it is held. No unaligned hex has four neighbours of one nation, so the front's consolidation never hands one over unfought (tested). |
| `T I S E N Z` | the powers: Turkey, Iran, Saudi Arabia, Egypt, Nigeria, South Africa |
| lowercase | the minor states (below) |

### Straits and seas

Nine sea zones: the North Atlantic, the Mediterranean, the Caspian, the Red Sea, the Persian Gulf,
the Arabian Sea and the Gulf of Aden, the Gulf of Guinea, the South Atlantic and the Indian Ocean.

| Strait | Hex | Joins | Between |
|---|---|---|---|
| Gibraltar | [6, 3], sea | Atlantic, Mediterranean | Spain (unaligned) and Morocco |
| Suez Canal | [27, 6], **land**: Port Said | Mediterranean, Red Sea | Egypt and Sinai |
| Bab-el-Mandeb | [32, 16], sea | Red Sea, Arabian Sea | Yemen and the Horn (Djibouti, unaligned) |
| Hormuz | [40, 9], sea | Persian Gulf, Arabian Sea | Iran (Bandar Abbas) and Oman (Musandam) |

The Suez Canal is a port, not a channel: Port Said stands on the isthmus and touches both seas, and
ships pass through a port (`enterCost`), so the canal is open to whoever holds Port Said and its
allies and closed to everyone else, while armies cross Sinai on dry land. The geography test checks
that the Mediterranean and the Red Sea meet by water nowhere, and that each sea strait is the only
water between the zones it joins.

### Ground

Deserts and the Sahel are open plains, fixed, so the seed never plants a forest in the Sahara or the
Empty Quarter: the Sahara and Sahel (11 to 31.6 N), Arabia, the Syrian desert and Mesopotamia, Iran's
Dasht-e Kavir and Lut, the Kalahari and Namib, the Somali lowlands. The ranges are fixed too: the
High Atlas (mountains) and the Tell (hills), the Taurus (hills) and eastern Anatolia (mountains),
the Elburz and the Zagros, Yemen's highlands, the Hejaz and Asir and the Hajar (hills), the
Ethiopian Highlands (mountains, hills to the south), the Kenyan highlands, the Drakensberg, the
Ahaggar and the Tibesti (hills), Mount Lebanon. The Congo basin and the Guinea coast are forest. The
rest (the Maghreb's coast, Anatolia's plateau, the savannas, the Highveld) the seed rolls, as the
Pacific's is, with each nation's `terrainBias`. The biome layer is a hint for the arena and the
renderer: desert, steppe, highland, tropical, subtropical.

### Resources

Oil: Ghawar, Burgan (Kuwait), Rumaila and Kirkuk (Iraq), Khuzestan, the North Field (Qatar), Abu
Dhabi, the Sirte Basin, Hassi Messaoud, the Niger Delta, Cabinda. Minerals (`rare-earths`): Katanga
cobalt, the Copperbelt, Bushveld platinum, Erongo uranium. Food: the Nile Delta, the Gezira, the
Free State. Like every map's resources, they are in the file and checked; the simulation does not
read them yet (the trade-and-chokepoints lane, `docs/mapgen.md`).

## Powers

| Power | Government | Capital | Cities (front first) | Depots | Navy (port) |
|---|---|---|---|---|---|
| Turkey | Federation | Ankara | Adana, Gaziantep, Istanbul, Izmir | Erzurum | fleet, transport, light carrier (Izmir) |
| Iran | Union | Tehran | Ahvaz, Tabriz, Bandar Abbas, Isfahan, Mashhad | Shiraz, Chabahar | two fleets, transport (Bandar Abbas) |
| Saudi Arabia | Commonwealth | Riyadh | Dammam, Najran, Jeddah, Tabuk | Hail | fleet, transport (Jeddah) |
| Egypt | Directorate | Cairo | Port Said, Aswan, Alexandria | Marsa Matruh | fleet, transport, light carrier (Alexandria) |
| Nigeria | Union | Abuja | Kano, Lagos, Port Harcourt | Maiduguri | fleet, transport (Lagos) |
| South Africa | Commonwealth | Pretoria | Polokwane, Durban, Cape Town, Gqeberha, Bloemfontein | Upington | fleet, transport (Durban) |

Parity (`build.ts`) levels victory points, output and army weight across the six, as in the Pacific.
Each power has a country file in `packages/game-data/src/nations/<id>.ts` (blurb, three fictional
generals with a bio, six signature cards and a seventeen-card deck), registered in `NATION_ROSTERS`,
`NATION_DOCTRINES`, `NATION_BLURB`, and an invented leader in `LEADERS` / `NATION_LEADERS`:

| Power | Leader | Temperament, agenda | Signature cards |
|---|---|---|---|
| Turkey | President Ayla Demirkol | opportunist, balance | Akıncı Strike, Bora Missile, Anadolu Group, KORAL Jamming, Anatolian Redoubt, Armoured Column |
| Iran | President Kaveh Rostami | hawk, honour | Fateh Salvo, Shahed Wave, Fast Attack Craft, Zagros Line, National Mobilisation, Ghadir Radar Net |
| Saudi Arabia | Prime Minister Saad Al-Qahtani | opportunist, commerce | F-15SA Sorties, Patriot Shield, Oil Revenue, Strategic Missile Force, Border Berm, Sentry Patrol |
| Egypt | President Nadia El-Masry | hawk, strength | Massed Guns, Rafale Wing, Mistral Group, Bridging Engineers, Western Desert Line, Canal Revenue |
| Nigeria | President Adaeze Okafor | dove, homeland | Mass Levy, Standby Brigade, Delta Crude, Alpha Jet Squadron, Riverine Operations, Sahel Patrols |
| South Africa | President Mandisa Mokoena | dove, honour | G6 Battery, Platinum Reserves, Recce Raid, Mechanised Column, Mokopa Strike, National Unity |

Turkey's file is in the same shape as the Pacific's countries (`ROSTER`, `NATION_DOCTRINE`, `BLURB`),
so a second theatre that also fields Turkey can share it.

## Minor states

Morocco, Algeria, Libya, Mali, Chad, Sudan, Ethiopia, Somalia, Kenya, DR Congo, Angola, Namibia,
Mozambique, Iraq, Syria, Israel, Jordan, Yemen, Oman: each a capital (its seat of government) and up
to three cities, militia only (Algeria, DR Congo, Ethiopia, Iraq and Sudan raise more), at war with
every power and at peace with each other, as in the Pacific. Their capitals are the powers'
objectives. Somalia includes Somaliland, as internationally recognised; Western Sahara is
unaligned; Malawi, too narrow at this scale, lies inside Mozambique's hexes.

## The war

- **Turn limit:** 30 by default (`MIDEAST_MAX_TURNS`); the setup screen's lengths apply as everywhere.
- **Victory bars:** the game's (`victoryBars`): domination at 32% of all victory points, supremacy at
  29% standing from turn 8. Six powers make both harder to reach than with four; the soak reports how
  often a match is decided before the limit.
- **Opening Crises:** none. The fourteen crises are written for the Pacific's places and powers, so
  the theatre (`crises: false` on its `THEATRES` entry) opens with the classic war, and the setup
  screen hides the crisis deck; `GameSession.create` refuses a crisis there.
- **Easy:** the human's nearest rival is the one enemy; there is no natural ally (the Pacific's
  `ALLY` table names none here), so the other four stay at peace.

## Setup screen

`THEATRES` now has two entries, so the theatre picker shows. A theatre entry may carry its own
`nations` and `minors` (`theatreNations`, `theatreMinors`; the Pacific's when absent), which the
roster, the dossier's fronts and the keyboard shortcuts read. A nation picked in one theatre falls
back to the next theatre's first power. `shortName` and `powerSpec` look across every theatre.

## Tests

- `packages/scenarios/src/mideast.test.ts`: registration; capitals and their order on the globe;
  Africa joined to Asia at Sinai, Madagascar an island; the straits as chokepoints and Suez as a
  port; resources ashore and where they belong; the desert open and the Congo forest; every power's
  sites, army and navy; minors and the stability of unaligned land; parity; seeds change only ground.
- `packages/mapgen/src/mideast.test.ts`: the committed file is what the grid writes.
- `packages/game-data/src/nations/mideast.test.ts`: the six country files and leaders.
- `tests/soak/mideast.soak.test.ts`: AI-only matches (`MIDEAST_SOAK`, else `SOAK_MATCHES`, else 24),
  0 rejected orders and the soak's invariants between every turn (`tests/soak/invariants.ts`, shared
  with the Pacific's soak).
- `tests/e2e/mideast.spec.ts`: a phone picks the theatre, plays Egypt and ends two turns.

## Measured

In a 4-core container shared with other work (not a phone), seed 1: the turn-1 world builds in about
0.3 s; `GameSession.advance` (25 nations' AI and the resolve) takes 1 to 3 s a turn, against about
0.6 s for the six-power testbed. Most of it is `grossYields` called inside `supremacyStanding` for
every nation's view, and `sortedKeys` over the 1,936 tiles: the per-nation, per-tile loops the
master plan's scale lane lists. A save at turn 7 is about 1.5 MB (every nation keeps an atlas of
every hex).

## Still open

- The engine's turn time on a map of this size with 25 nations (above).
- Theatre crises of its own (a Hormuz closure, a canal seized, a Sahel coup) and natural allies for Easy.
- Leader portraits and the briefing's commander card are still by government, written for the Pacific.

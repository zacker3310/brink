# The Middle East and Africa (design)

The second theatre (MASTER-PLAN Phase 6: "Middle East: the Gulf, Hormuz and oil shocks" and
"Africa: the Horn, the Sahel, and Suez from the south", built as one theatre). Six regional powers
from the Mediterranean's south shore to the Cape, twenty-four minor states between them, and four of
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
Egypt and Saudi Arabia share no border: the Gulf of Aqaba (sea) and Jordan's Aqaba lie between Sinai
and Tabuk, as on the ground.

North is up. The top rows are the south of Iberia, Italy and Greece (unaligned), Anatolia, the
Caucasus and the Caspian; the bottom row is the Cape.

| Character | Meaning |
|---|---|
| `~` | sea |
| `+` | unaligned land: states not in the war at this scale (Tunisia, Mauritania, Senegal to Benin but Ghana, the Central African Republic, the Congo, Gabon, South Sudan, Uganda, Eritrea, Djibouti, Zambia, Botswana, Madagascar, the Gulf states, Lebanon, Cyprus, southern Europe, the Caucasus) and disputed ground (Western Sahara). Nobody's: an army that walks in takes it, out of supply until it is held. No unaligned hex has four neighbours of one nation, so the front's consolidation never hands one over unfought (tested). |
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
| Turkey | Directorate | Ankara | Adana, Gaziantep, Istanbul, Izmir | Erzurum | fleet, transport, light carrier (Izmir) |
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
| Turkey | President Tarık Ekinci | opportunist, strength | Bayraktar Hunt, Tayfun Missile, Anadolu Landing, The Straits Closed, KORAL Jamming, Mehmetçik |
| Iran | President Kaveh Rostami | hawk, honour | Fateh Salvo, Shahed Wave, Fast Attack Craft, Zagros Line, National Mobilisation, Ghadir Radar Net |
| Saudi Arabia | Prime Minister Saad Al-Qahtani | opportunist, commerce | F-15SA Sorties, Patriot Shield, Oil Revenue, Strategic Missile Force, Border Berm, Sentry Patrol |
| Egypt | President Nadia El-Masry | hawk, strength | Massed Guns, Rafale Wing, Mistral Group, Bridging Engineers, Western Desert Line, Canal Revenue |
| Nigeria | President Adaeze Okafor | dove, homeland | Mass Levy, Standby Brigade, Delta Crude, Alpha Jet Squadron, Riverine Operations, Sahel Patrols |
| South Africa | President Mandisa Mokoena | dove, honour | G6 Battery, Platinum Reserves, Recce Raid, Mechanised Column, Mokopa Strike, National Unity |

Turkey's file (`nations/turkey.ts`) is the one Europe fields too: one deck, one set of generals, one
leader and one government (the Industrial Directorate) in both theatres. The two lanes had each written
their own (a Federation here, a Directorate in Europe); the merge kept Europe's file, with KORAL
Jamming from this theatre's deck in place of the Bosphorus Bastion, because the Directorate is the
better fit: an arms and drone industry of its own, a doctrine of cross-border offensives, and a home
front worn by inflation and a divided vote.

## Minor states

Morocco, Algeria, Libya, Mali, Niger, Chad, Ghana, Cameroon, Sudan, Ethiopia, Somalia, Kenya,
Tanzania, DR Congo, Angola, Namibia, Zimbabwe, Mozambique, Iraq, Syria, Israel, Jordan, Yemen, Oman:
each a capital (its seat of government) and up to three cities, militia only, at war with every
power and at peace with each other, as in the Pacific. Every minor raises a regiment more in each
city (Algeria, DR Congo, Ethiopia, Iraq and Sudan two). Their capitals are the powers' objectives.

Prizes are weighted by what the war is about (`PRIZES` in `packages/mapgen/src/mideast.ts`): the
oil states and the Levant between the four northern powers (Iraq 10 and 6, Syria, Israel, Jordan,
Yemen, Oman, Libya, Sudan 8 or 9 and 5) are worth more than a minor's usual 6 and 4, and the states
of the south and west less (4 and 2). Without it, the two southern powers had a dozen prizes to
themselves while the four in the north fought over the rest, and won 19 of 20 AI-only matches. Somalia includes Somaliland, as internationally recognised; Western Sahara is
unaligned; Malawi, too narrow at this scale, lies inside Mozambique's hexes.

## The war

- **Turn limit:** 30 by default (`MIDEAST_MAX_TURNS`); the setup screen's lengths apply as everywhere.
- **Victory bars:** `victoryBars(maxTurns, powers, theatre)`, the one rule every theatre is won by
  (this theatre's design, adopted for all in ruleset 2.13.0). The game's bars were measured on four
  level powers; a map with more sets `WorldState.barPowers` at build, and the bars come down: domination
  in proportion (21% of the points for six), supremacy to a fair share plus the four-power margin (21%
  standing for six), from turn 8. At the four-power bars no match of 20 was decided before the limit
  (no leader passed 18% standing); at the rule's, 70%. Maps of four powers, the Pacific (its crises
  too), are unchanged. Europe, the Indo-Pacific South and the Americas have their own bars
  (`THEATRE_BARS`); this theatre has none.
- **Opening Crises:** none. The fourteen crises are written for the Pacific's places and powers, so
  the theatre (`crises: false` on its `THEATRES` entry) opens with the classic war, and the setup
  screen hides the crisis deck; `GameSession.create` refuses a crisis there.
- **Easy:** the human's nearest rival is the one enemy; there is no natural ally (the Pacific's
  `ALLY` table names none here), so the other four stay at peace.

## Setup screen

The theatre is an entry in the one table of theatres (`packages/scenarios/src/theatres.ts`): its
powers and minors (`theatrePowers`, `theatreMinors`), which the roster, the dossier's fronts and the
keyboard shortcuts read, no crises (`classicOnly`), and Easy's pairs (Egypt and Saudi Arabia, Nigeria
and South Africa, Turkey and Iran). A nation picked in one theatre falls back to the next theatre's
first power. `shortName` and `findNation` look across every theatre.

## Tests

- `packages/scenarios/src/mideast.test.ts`: registration; capitals and their order on the globe;
  Africa joined to Asia at Sinai, Madagascar an island; the straits as chokepoints and Suez as a
  port; resources ashore and where they belong; the desert open and the Congo forest; every power's
  sites, army and navy; minors and the stability of unaligned land; parity; seeds change only ground.
- `packages/mapgen/src/mideast.test.ts`: the committed file is what the grid writes.
- `packages/game-data/src/nations/mideast.test.ts`: the six country files and leaders.
- `tests/soak/mideast.soak.test.ts`: AI-only matches (`SOAK_MIDEAST_MATCHES`, else `SOAK_MATCHES` up
  to 20), 0 rejected orders and the soak's invariants between every turn (`tests/soak/invariants.ts`,
  every soak's).
- `tests/e2e/mideast.spec.ts`: a phone picks the theatre, plays Egypt and ends two turns.

## Balance (20 AI-only matches, `SOAK_MIDEAST_MATCHES=20`)

| Pass | Decided before the limit | Winners | Rejected AI orders |
|---|---|---|---|
| Four-power bars, nineteen minors | 0 of 20 | Nigeria 11, South Africa 8, Iran 1 (all at the limit) | 0 |
| Scaled bars (21 / 19), twenty-four minors | 20 of 20, median turn 14 | Nigeria 12, South Africa 8 | 0 |
| Supremacy at a fair share plus 4 (21), a regiment more in every minor city, no Egypt-Saudi border | 17 of 20, median turn 25 | South Africa 13, Nigeria 6, Iran 1 | 0 |
| Prizes weighted to the north (the lane's) | 14 of 20, median turn 29 | South Africa 11, Nigeria 6, Saudi Arabia, Turkey, Iran 1 each | 0 |
| Ruleset 2.13.0: merged, Turkey the shared Directorate file | 14 of 20, median turn 29 | South Africa 11, Nigeria 3 (on score: South Africa 4, Turkey 1, Nigeria 1) | 0 |

The southern powers still win most AI-only matches: they meet no rival power, the minor states and
unaligned land around them are theirs to take, and the four northern powers wear each other down.
Every northern power but Egypt has now won; the next pass is the AI's (the balance of power, which
cannot reach a leader across the continent) rather than the map's.

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

# The Indo-Pacific South (design)

Phase 6 (`docs/MASTER-PLAN.md`): South Asia, Southeast Asia and Oceania as one theatre. Theatre id
`indopac`, `packages/scenarios/src/indopac.ts`, map `packages/scenarios/src/maps/indopac.map.json`.

## Map

52 x 36 hexes (1872), from Karachi in the west to Wellington in the east and from Beijing (pulled
south onto the top row) to the Southern Ocean. Hand-traced lon/lat outlines (61E to 179.5E, 37.5N to
47S, about 2.3 degrees a hex) were rasterised to hexes and then hand-finished: islands widened past
real scale so each holds open ground beside its cities, and every narrows kept as one sea hex. No
external data. The seed varies only the ground inside each country.

- **Fixed ground.** The Himalaya, the Karakoram, the Hindu Kush and the rim of the Tibetan plateau are
  mountains whatever the seed. The jungles of Borneo, New Guinea, Sumatra and the Indochinese hills
  are forest. Australia's interior leans to plains (terrain bias -30), the islands to rough ground.
- **Straits.** Malacca (between Sumatra and the peninsula, out past Singapore), Sunda, Lombok,
  Makassar, the Taiwan Strait and the Luzon Strait (the Taiwan approaches), Palk, Torres, Bass and
  Cook. Fourteen named sea zones.
- **The South China Sea.** Woody Island (Paracels) and Fiery Cross Reef (Spratlys) are Chinese
  outposts, Truong Sa a Vietnamese one: one-hex islands, each a port.
- **Islands.** Australia touches no other land: it is reached only by sea. Sri Lanka, Taiwan, the
  Philippines (Luzon and the Visayas, Mindanao, Palawan), Sumatra, Java, Borneo, Sulawesi, the Lesser
  Sundas, Timor, New Guinea, Tasmania, New Zealand's two islands, the Andamans and Christmas Island
  are separate landmasses. Borneo is shared by Indonesia and Malaysia, New Guinea by Indonesia and
  Papua New Guinea; Singapore joins the peninsula.

## Powers

| Power | Government | Navy (at sea off) | Plays |
|---|---|---|---|
| India | Federation | Mumbai: fleet, two transports, carrier | Two land fronts (Pakistan, China over the Himalaya) and the Bay of Bengal |
| Pakistan | Directorate | Karachi: fleet, two transports | The short war: missiles, armour, the Karakoram as a fortress |
| China | Union (its Pacific file) | Guangzhou: fleet, two transports, carrier | Mass from the north into Indochina, the reefs and Taiwan |
| Indonesia | Union | Surabaya: two fleets, three transports | Holds the straits; land fronts on Borneo and New Guinea |
| Australia | Commonwealth | Darwin: carrier, fleet, three transports | Every war starts with a landing |

Leaders and generals are invented (`packages/game-data/src/nations/<id>.ts`). Easy's natural allies:
India and Australia, Pakistan and China.

Minor states (15): Afghanistan, Nepal, Bangladesh, Sri Lanka, Myanmar, Thailand, Laos, Cambodia,
Vietnam, Malaysia, Singapore, the Philippines, Papua New Guinea, New Zealand, Taiwan. Vietnam,
Thailand, the Philippines and Malaysia raise a second infantry militia per city.

## What changed outside the theatre

- `createScenario` dispatches by theatre; `nationsOf`, `minorsOf` and `findNation` give the setup
  screen and the menus each theatre's nations.
- The Pacific's crises are written for the Pacific's map: `crisesFor(theatre)` deals them only
  there, and `GameSession.create` refuses one for another theatre. The setup screen opens a theatre
  without crises on the classic war.
- The AI (no power named): a convoy lying off a shore where the only land in reach is a held city
  sails for the sea off the nearest open beach instead of waiting there. Jakarta, seen from the
  Sunda Strait, was such a shore, and Australia's transports waited off it for twenty turns.
- The Pacific's turn-1 worlds are unchanged (the pinned hashes hold).

## Measured

See the soak (`tests/soak/indopac.soak.test.ts`) and PROGRESS.md for the decisive rate. With five
powers the victory bars (`VICTORY`, fixed for four) are further off: a power starts near 18%
standing against the 29% supremacy bar, where a Pacific power starts near 23%.

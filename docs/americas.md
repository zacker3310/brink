# The Americas (design)

Phase 6 (`docs/MASTER-PLAN.md`): a north–south theatre and the Panama Canal. Six powers from the
Arctic to Cape Horn, fourteen minor states between them, two continents joined by one isthmus, and
two oceans joined by one canal.

## Map

32 x 41 hexes (1312), drawn as a character grid in `packages/mapgen/src/americas.ts` and converted
with `gridToMap` into `packages/scenarios/src/maps/americas.map.json`
(`pnpm --filter @brink/mapgen map:americas`; a test checks the committed file matches the grid byte
for byte). The projection is a longitude–latitude box, about 4.5 degrees of longitude a column and
3.3 of latitude a row, from 72 N to 60 S. South America sits a column east of true, and Central
America and the Antilles are stretched a little, so the isthmus is a corridor of hexes and the
straits are open water.

| Feature | Where | How it plays |
|---|---|---|
| The Panama Canal | Panama City, `[19, 19]`, a port on a one-hex isthmus | The only port touching both the Caribbean and the Pacific. A ship passes through a port; an enemy garrison in it stops the ship. Whoever holds Panama City holds the canal. |
| Florida Strait | `[19, 14]`, `[20, 14]`, between Miami and Havana | Open sea, land on both sides. |
| Yucatan Channel | `[17, 15]`, `[18, 16]` | The Gulf of Mexico's door to the Caribbean. |
| Strait of Magellan | row 38, between Patagonia and Tierra del Fuego | The way round in the south. |
| Drake Passage | row 40 | The open sea below Cape Horn. |
| The Rockies, the Alaska Range, the Andes | fixed mountains | The builder lowers only those beside a site to hills (no city is walled in). |
| The Amazon, the Darien, the boreal forest | fixed forest | |
| The Great Plains, the prairies, the Pampas, Patagonia | fixed plains | |
| Greenland, the Falklands | unowned land | Nobody's ground: out of supply for anyone who lands. |

The oceans meet only round the Horn and through the canal. With the canal shut, the voyage from
Cartagena to the Pacific shore of Panama is more than six times as long and runs south of the River
Plate (`americas.test.ts`). No other port bridges the oceans: Central America's capitals stand on the
Pacific side and its Caribbean coast has no site, Mexico City is inland, and Medellin is in the
mountains. The canal is a strait record of kind `canal` on Panama City's hex, joining
`caribbean` and `east-pacific`, for the trade-and-chokepoints lane when the engine reads straits.

## Powers

| Power | Government | Front (opening army) | Navy |
|---|---|---|---|
| United States | Commonwealth | New York and Seattle, facing Canada | Miami: fleet, transport, carrier |
| Canada | Commonwealth | Toronto and Vancouver, facing the United States | Halifax: fleet, transport |
| Mexico | Union | Monterrey and Tijuana, facing the United States | Veracruz: fleet, transport |
| Brazil | Union | Porto Alegre (Argentina) and Manaus (Colombia) | Rio de Janeiro: fleet, transport, carrier |
| Argentina | Federation | Corrientes (Brazil) and Mendoza (Chile) | Buenos Aires: fleet, transport |
| Colombia | Directorate | Cartagena (Panama) and Cucuta (Venezuela) | Cartagena: fleet, transport |

Every power starts level (`parity`): the same victory points and output, armies within a tenth.
Canada is the biggest country and Colombia the smallest power. Easy's natural allies: the United
States and Canada, Mexico and Colombia, Brazil and Argentina (`AMERICAS_ALLIES`, read by the session
through the theatre).

The five new powers have country files in `packages/game-data/src/nations/` (`canada.ts`,
`mexico.ts`, `colombia.ts`, `brazil.ts`, `argentina.ts`): government, three generals, a blurb, six
signature cards and a seventeen-card deck, and an invented leader. The United States reuses its
own file.

**One nation, two roles.** Canada and Mexico are minor states in the Pacific and powers here. The
role is a fact of the map (`role` in the map file), so nothing in code knows it. Their governments
and colours are the same in both maps. Minor states field no generals, no doctrine and no diplomacy,
so their country files change nothing in the Pacific until a crisis makes them powers (The Second
Civil War), when they fight with their own generals, decks and leaders.

## Minor states

Guatemala, Nicaragua, Panama, Cuba, Haiti, the Dominican Republic, Venezuela, Guyana, Ecuador, Peru,
Bolivia, Chile, Paraguay and Uruguay. Panama City, Havana and Santiago are worth 8 victory points,
the other capitals 6. Venezuela raises an extra infantry and a mechanized regiment a city; Ecuador and
Peru two infantry regiments; Panama, Guyana, Bolivia and Chile one; Cuba a mechanized one (two is the
most: a city's hex holds three formations). Colombia's ring defends a regiment deeper since ruleset
2.13.0: at the theatre's bars Colombia won 12 of 20 AI-only wars without it, 10 with it.

## Opening Crises

The fourteen crises are written for the Pacific's map and nations. The theatre is `classicOnly`:
the setup screen shows the classic opening and no deck, and `GameSession.create` refuses a crisis
for it.

## Measured

`tests/soak/americas.soak.test.ts` (`SOAK_MATCHES`, 24 by default) plays AI-only matches to the
end and prints the endings, the decisive rate and what the canal saw. A turn costs about twice the
Pacific's (six powers, twenty nations, 1312 hexes). Results are in `PROGRESS.md`.

## Open

- **Straits in the engine.** The canal works through the port rule. A blockade of the Florida
  Strait or the Strait of Magellan as a strait (rather than ships in the way) waits for the
  trade-and-chokepoints lane.
- **Balance.** Colombia, ringed by minor states (Panama, Venezuela, Guyana, Ecuador, Peru), still
  takes them faster than anyone takes anything; the United States, at war with Canada and Mexico at
  once, loses its east coast by turn ten in most. The theatre is won by its own bars (`THEATRE_BARS`:
  28% domination, 23% supremacy), not the six-power rule's 21% and 21%: at those Colombia took 21% of
  the points by turn 11 in 18 wars of 20. The United States, Brazil and Argentina win none of 20.
- **Crises for the Americas.** None yet.
- **Scale.** The per-hex loops (`grossYields` counting hexes, supply, vision) dominate a turn on this
  map; the master plan's incremental work would halve it.

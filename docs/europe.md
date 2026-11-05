# Europe (design)

Phase 5 of `docs/MASTER-PLAN.md`, first wave: the second theatre a player can pick. Six powers from
the Atlantic to the Urals, forty states between them, and the straits that decide who sails where.

## Map

56 x 32 hexes (1792), `packages/scenarios/src/maps/europe.map.json`. The owner layer is the
character grid in `packages/mapgen/src/europe.ts`, baked once from Natural Earth's 1:50m admin-0
countries (public domain) over 25W to 60E and 29.5N to 74N (equirectangular, a hex is land where
four of its seven samples are) and finished by hand:

- **Svalbard** placed on the top row (it lies north of the box), Norway's Finnmark joined to the rest.
- **Straits opened as sea hexes:** the English Channel, the Danish Straits (the only way from the
  North Sea into the Baltic), Gibraltar (the only way from the Atlantic into the Mediterranean), the
  Bosphorus and the Dardanelles with the Sea of Marmara between, and the GIUK gap marked between
  Iceland and Scotland. The Gulf of Finland separates Helsinki from Tallinn; the White Sea opens on
  the Barents Sea; the Kerch Strait is marked.
- **The Suwałki corridor** is a land bridge: Kaliningrad, Russia's exclave, borders only Poland and
  Lithuania, and the Polish and Lithuanian hexes between it and Belarus are the corridor.
- **Islands:** Britain, Ireland, Iceland, Corsica (French), Sardinia and Sicily (Italian), Crete,
  Cyprus. Crimea is drawn as Ukraine's.
- Istanbul stands on the European shore: Turkey's Thrace is cut from Anatolia by the straits, so the
  walk from Istanbul to Ankara goes round the Black Sea (a hex grid cannot carry a sea passage and a
  land bridge through the same place; the straits won).

Twelve sea zones (North Atlantic, Norwegian, Barents and White Seas, North Sea, Baltic, Western and
Central Mediterranean, Aegean, Marmara, Eastern Mediterranean, Black Sea, Caspian) are spread from
seeds, with the strait hexes fixed so each zone ends at its strait. Biomes run from ice and tundra
through the taiga and the plain to the steppe, the Mediterranean, the desert and the highlands.
Regenerate the file with `pnpm --filter @brink/mapgen map:europe`; `mapgen/src/europe.test.ts`
checks the committed file matches byte for byte.

## Powers

| Power | Government | Capital | Navy (`europe.ts`) |
|---|---|---|---|
| United Kingdom | Commonwealth | London | Portsmouth: carrier, fleet, two transports |
| France | Federation | Paris | Toulon: carrier, fleet, transport; Brest: fleet, transport |
| Germany | Commonwealth | Berlin | Kiel: fleet, transport |
| Poland | Federation | Warsaw | Gdańsk: fleet, transport |
| Russia | Directorate | Moscow | Kaliningrad, Murmansk (with the carrier), Novorossiysk |
| Turkey | Directorate | Ankara | Istanbul: fleet, transport; Izmir: carrier, fleet, transport |

`ScenarioSetup.navies` takes a list of squadrons for a power with more than one sea; a single entry
builds exactly as before (the Pacific's turn-1 hashes are unchanged). Parity levels every power's
victory points, output and army weight; Germany, Poland and the United Kingdom have more cities than
their size suggests so their garrisons have room. The United States is left out: it has no ground on
this map, and the engine's power needs a capital, two cities and a depot of its own.

Each new power has a country file in `packages/game-data/src/nations/` (`uk`, `france`, `germany`,
`poland`, `turkey`): three invented generals, six signature cards in a sixteen-card deck (Storm Shadow
and the carrier group, SCALP and the Rafale, Taurus, the Leopard 2A7 and the PzH 2000, the K2, the
East Shield and the Chunmoo, the Bayraktar and the Tayfun), a blurb and an invented leader. Russia's
file is the Pacific's; Turkey's is the Middle East and Africa's too (one file, one government: the
Directorate on both maps; KORAL Jamming came from that theatre's deck in place of the Bosphorus
Bastion).

## Minor states

Forty: Iceland, Ireland, Norway, Sweden, Finland, Denmark, Benelux, Portugal, Spain, Italy,
Switzerland, Austria (with Slovenia's hexes in the Balkans), Czechia, Slovakia, Hungary, the Western
Balkans (Belgrade), Romania, Moldova, Bulgaria, Greece, Cyprus, Ukraine, Belarus, Estonia, Latvia,
Lithuania, Georgia, Armenia, Azerbaijan, Kazakhstan (its western steppe; the capital site is Aktobe,
as Astana is off the map), Iran, Iraq, Syria (with Lebanon), Israel, Jordan, Egypt, Libya, Tunisia,
Algeria, Morocco. Small states have fewer victory points; Kyiv, Brussels, Madrid and Rome more.

## Victory

Every theatre is won by one rule, `victoryBars(maxTurns, powers, theatre)` in game-data: the Pacific's
32% and 29% at four powers, scaled down with the count fixed at build (`barPowers`; 21% and 21% for
six). Europe is one of three theatres the rule does not fit, so it keeps its own bars in
`THEATRE_BARS`: a European power opens with 6.6% of the victory points (a Pacific one with 15%, one in
the Middle East with 7.6%), forty minor states hold 60% of them, and in 20 AI-only matches played to
the limit no power's standing passed 20, so at the rule's bars none was decided. Europe asks for 15%
for domination and 18% standing for supremacy, about the same multiple of a power's opening as the
Pacific's: 75% of the 20 matches decided. Total War asks for a conquest everywhere. 30 turns.

## Generalised for any theatre

- `theatres.ts` (scenarios): each theatre's powers, minors and crises; `findNation` and `shortName`
  over every theatre. The setup screen lists the theatre's own nations; a theatre without crises
  opens the classic way and hides the crisis deck.
- Easy's natural ally (`session.ts`): a preference list, the first that is a power in the theatre.
- `buildView` takes the turn's supremacy standing, computed once per world rather than once per
  nation (with 46 nations it was a sixth of a turn).

## Measured

20 AI-only matches (`tests/soak/europe.soak.test.ts`, `SOAK_EUROPE_MATCHES`): 0 refused orders, 85% decisive (supremacy 10, domination 7, turn limit 3), median turn 21. Winners: Poland 13, Germany 5, the United Kingdom 2. Before the balance pass (Union Poland, Szczecin beside Berlin): Poland 15 of 20.

## Still open

- Europe's own crises (*Suwałki Gap*, *Baltic Gambit*, *Black Sea Fleet*, *Bosphorus Crisis*).
- Winter and mud, rail gauge, Article 5, nuclear umbrella pressure; arena biomes and rosters.
- A turn costs three to four times a Pacific turn (46 nations): fewer, merged minors, or the
  incremental per-nation work in fog and supply.

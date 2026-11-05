import { describe, expect, it } from 'vitest';
import { UNIT_CLASSES, type HexKey } from '@brink/contracts';
import { UNITS } from '@brink/game-data';
import { cellKey, findPath, keyDistance, neighborKeys } from '@brink/map';
import { enterCost, hashState, seedCommanders, sortedKeys } from '@brink/simulation';
import { crisesFor } from './crises';
import { createIndoPacScenario, INDOPAC_ID, INDOPAC_MAP, INDOPAC_MINORS, INDOPAC_NATIONS } from './indopac';
import { createScenario, findNation, minorsOf, nationsOf, SCENARIOS } from './index';
import { THEATRES } from './pacific';

// Worlds built and hashed take seconds each on a loaded machine: those tests get a time budget.
describe('The Indo-Pacific South', () => {
  const w = createIndoPacScenario(1);
  const site = (name: string) => {
    const s = Object.values(w.sites).find((x) => x.name === name);
    if (!s) throw new Error(`no site ${name}`);
    return s;
  };
  const walk = (k: HexKey) => enterCost(w.tiles[k], 'infantry');
  // Open water only: a ship may also pass through a port, but not through a rival's.
  const sail = (k: HexKey) => (w.tiles[k]?.terrain === 'water' ? enterCost(w.tiles[k], 'transport') : null);
  const walks = (a: string, b: string) => findPath(site(a).key, site(b).key, (_f, to) => walk(to)) !== null;
  /** Two nations whose land touches: some hex of one is next to a hex of the other, both ashore. */
  const border = (a: string, b: string) =>
    Object.values(w.tiles).some((t) => t.owner === a && t.terrain !== 'water' && neighborKeys(t.key).some((k) => w.tiles[k]?.owner === b && w.tiles[k]!.terrain !== 'water'));
  const at = (col: number, row: number) => w.tiles[cellKey([col, row])]!;

  it('is listed: a theatre on the setup screen, a scenario, and createScenario builds it with generals', { timeout: 60_000 }, () => {
    expect(THEATRES.map((t) => t.id)).toContain(INDOPAC_ID);
    expect(SCENARIOS.find((s) => s.id === INDOPAC_ID)?.nations).toBe(5);
    expect(nationsOf(INDOPAC_ID)).toBe(INDOPAC_NATIONS);
    expect(minorsOf(INDOPAC_ID)).toBe(INDOPAC_MINORS);
    expect(hashState(createScenario(INDOPAC_ID, 1))).toBe(hashState(seedCommanders(JSON.parse(JSON.stringify(w)) as typeof w)));
    // Its powers are found by id from anywhere (labels, saves), China as the Pacific describes it.
    expect(findNation('australia')?.name).toBe('Australia');
    expect(findNation('china')?.name).toBe('China');
    // The Pacific's crises are written for the Pacific's map: this theatre opens with the classic war.
    expect(crisesFor(INDOPAC_ID)).toEqual([]);
  });

  it('is five powers and fifteen minor states on a 52 x 36 map with every terrain', () => {
    expect(INDOPAC_NATIONS.map((n) => n.id)).toEqual(['india', 'pakistan', 'china', 'indonesia', 'australia']);
    expect(INDOPAC_MINORS).toHaveLength(15);
    expect(Object.keys(w.tiles)).toHaveLength(52 * 36);
    const terrains = new Set(Object.values(w.tiles).map((t) => t.terrain));
    for (const t of ['plains', 'forest', 'hills', 'mountains', 'urban', 'water'] as const) expect(terrains.has(t), t).toBe(true);
    for (const n of INDOPAC_NATIONS) {
      const own = Object.values(w.sites).filter((s) => s.owner === n.id);
      expect(own.filter((s) => s.kind === 'capital'), n.id).toHaveLength(1);
      expect(own.filter((s) => s.kind === 'city').length, n.id).toBeGreaterThanOrEqual(3);
      const classes = new Set(Object.values(w.formations).filter((f) => f.owner === n.id).map((f) => f.unitClass));
      for (const c of UNIT_CLASSES.filter((x) => !UNITS[x].naval)) expect(classes.has(c), `${n.id} ${c}`).toBe(true);
      expect(classes.has('fleet') && classes.has('transport'), `${n.id} navy`).toBe(true);
      expect(w.nations[n.id]!.objectives).toHaveLength(15);
    }
    for (const m of INDOPAC_MINORS) {
      expect(w.nations[m.id]!.minor, m.id).toBe(true);
      for (const n of INDOPAC_NATIONS) expect(w.relations[[n.id, m.id].sort().join('|')]).toBe('war');
    }
  });

  it('puts the real capitals and cities in their own countries', () => {
    const owner = (name: string) => site(name).owner;
    expect(['New Delhi', 'Mumbai', 'Kolkata', 'Chennai'].map(owner)).toEqual(['india', 'india', 'india', 'india']);
    expect(['Islamabad', 'Lahore', 'Karachi'].map(owner)).toEqual(['pakistan', 'pakistan', 'pakistan']);
    expect(['Beijing', 'Guangzhou', 'Shanghai', 'Kunming'].map(owner)).toEqual(['china', 'china', 'china', 'china']);
    expect(['Jakarta', 'Surabaya', 'Medan', 'Jayapura'].map(owner)).toEqual(['indonesia', 'indonesia', 'indonesia', 'indonesia']);
    expect(['Canberra', 'Sydney', 'Perth', 'Darwin'].map(owner)).toEqual(['australia', 'australia', 'australia', 'australia']);
    expect(['Manila', 'Hanoi', 'Bangkok', 'Singapore', 'Kuala Lumpur', 'Wellington', 'Port Moresby', 'Taipei', 'Dhaka', 'Colombo'].map(owner)).toEqual([
      'philippines',
      'vietnam',
      'thailand',
      'singapore',
      'malaysia',
      'newzealand',
      'png',
      'taiwan',
      'bangladesh',
      'srilanka',
    ]);
    // The South China Sea's reefs are small sites: one-hex islands, held as outposts.
    for (const reef of ['Woody Island', 'Fiery Cross Reef', 'Truong Sa']) {
      const s = site(reef);
      expect(w.tiles[s.key]!.port, reef).toBe(true);
      expect(neighborKeys(s.key).every((k) => !w.tiles[k] || w.tiles[k]!.terrain === 'water'), reef).toBe(true);
    }
  });

  it('draws the land borders where they are: India and Pakistan, India and China over the Himalaya', () => {
    expect(border('india', 'pakistan')).toBe(true);
    expect(walks('New Delhi', 'Islamabad')).toBe(true);
    expect(border('india', 'china')).toBe(true);
    expect(border('india', 'bangladesh') && border('india', 'nepal') && border('china', 'nepal')).toBe(true);
    expect(border('china', 'vietnam') && border('china', 'myanmar') && border('china', 'laos')).toBe(true);
    expect(border('pakistan', 'afghanistan')).toBe(true);
    // Borneo is shared by Indonesia and Malaysia, New Guinea by Indonesia and Papua New Guinea.
    expect(border('indonesia', 'malaysia') && border('indonesia', 'png')).toBe(true);
    expect(walks('Pontianak', 'Kuching') && walks('Jayapura', 'Port Moresby')).toBe(true);
    // Singapore joins the peninsula by the causeway; the peninsula joins Thailand.
    expect(walks('Singapore', 'Kuala Lumpur') && walks('Kuala Lumpur', 'Bangkok')).toBe(true);
    // The Himalaya: mountains along the roof of the world, whatever the seed.
    const himalaya = Object.values(w.tiles).filter((t) => t.terrain === 'mountains');
    expect(himalaya.length).toBeGreaterThanOrEqual(20);
    expect(himalaya.filter((t) => t.owner === 'india').length).toBeGreaterThanOrEqual(2);
    expect(himalaya.filter((t) => t.owner === 'china').length).toBeGreaterThanOrEqual(10);
    expect(createIndoPacScenario(77).tiles[cellKey([10, 1])]!.terrain).toBe('mountains');
  });

  it('keeps the islands islands: Australia is reachable only by sea', () => {
    expect(Object.values(w.tiles).some((t) => t.owner === 'australia' && neighborKeys(t.key).some((k) => w.tiles[k] && w.tiles[k]!.terrain !== 'water' && w.tiles[k]!.owner !== 'australia'))).toBe(false);
    for (const far of ['Port Moresby', 'Jakarta', 'New Delhi', 'Beijing', 'Wellington']) expect(walks('Darwin', far), far).toBe(false);
    expect(walks('Darwin', 'Sydney') && walks('Perth', 'Brisbane')).toBe(true);
    // Hobart is across Bass Strait; Sri Lanka across the Palk Strait; Taiwan and Luzon across their straits.
    expect(walks('Hobart', 'Melbourne')).toBe(false);
    expect(walks('Colombo', 'Chennai')).toBe(false);
    expect(walks('Taipei', 'Xiamen') || walks('Taipei', 'Manila')).toBe(false);
    // Sumatra, Java, Borneo and Sulawesi are separate islands; Sumatra does not touch the peninsula.
    expect(walks('Medan', 'Kuala Lumpur') || walks('Medan', 'Jakarta') || walks('Jakarta', 'Pontianak') || walks('Makassar', 'Pontianak')).toBe(false);
    // The two islands of New Zealand, apart.
    expect(walks('Wellington', 'Christchurch')).toBe(false);
    expect(walks('Wellington', 'Auckland')).toBe(true);
  });

  it('makes the narrows sea: Malacca, Sunda, Lombok, Torres and the Taiwan approaches', () => {
    const straits = new Map((INDOPAC_MAP.straits ?? []).map((s) => [s.id, s]));
    for (const id of ['malacca', 'sunda', 'lombok', 'taiwan-strait', 'luzon-strait', 'torres', 'bass', 'cook']) {
      const s = straits.get(id);
      expect(s, id).toBeDefined();
      for (const [c, r] of s!.hexes) expect(at(c, r).terrain, `${id} [${c}, ${r}]`).toBe('water');
    }
    // Malacca is the way from the Bay of Bengal to the South China Sea: a ship sails through it.
    const malacca = straits.get('malacca')!.hexes.map((h) => cellKey(h));
    const andaman = cellKey([15, 12]);
    const scs = cellKey([20, 13]);
    const route = findPath(andaman, scs, (_f, to) => sail(to));
    expect(route).not.toBeNull();
    expect(route!.path.some((k) => malacca.includes(k))).toBe(true);
    // Sunda and Lombok each join the Java Sea to the Indian Ocean.
    for (const id of ['sunda', 'lombok']) expect(straits.get(id)!.joins).toEqual(['java-sea', 'indian-ocean']);
  });

  it('can be fought at sea: every power sails from a port, and a transport reaches every rival capital', () => {
    const navy = (n: string) => Object.values(w.formations).filter((f) => f.owner === n && UNITS[f.unitClass].naval);
    for (const n of INDOPAC_NATIONS) {
      const ships = navy(n.id);
      expect(ships.filter((f) => f.unitClass === 'transport').length, n.id).toBeGreaterThanOrEqual(2);
      for (const f of ships) expect(w.tiles[f.key]!.terrain).toBe('water');
      // Transports sail with their marines aboard.
      for (const t of ships.filter((f) => f.unitClass === 'transport')) expect(Object.values(w.formations).filter((f) => f.aboard === t.id)).toHaveLength(2);
    }
    // From Darwin's waters a convoy reaches the sea off every capital it could want, without
    // crossing land: the whole map is one ocean.
    const from = navy('australia').find((f) => f.unitClass === 'transport')!.key;
    for (const target of ['Jakarta', 'Port Moresby', 'Wellington', 'Manila', 'Colombo', 'Karachi', 'Taipei', 'Singapore']) {
      const off = neighborKeys(site(target).key).find((k) => w.tiles[k]?.terrain === 'water')!;
      expect(findPath(from, off, (_f, to) => sail(to)), target).not.toBeNull();
    }
    // Every coastal site is a port (the builder's rule), so ships are built across the archipelago.
    for (const name of ['Darwin', 'Jakarta', 'Surabaya', 'Mumbai', 'Karachi', 'Guangzhou', 'Manila']) expect(w.tiles[site(name).key]!.port, name).toBe(true);
    expect(w.tiles[site('New Delhi').key]!.port).toBeFalsy();
  });

  it('gives every island prize open ground beside a city to land on', () => {
    for (const m of ['philippines', 'taiwan', 'srilanka', 'newzealand', 'malaysia', 'singapore', 'png']) {
      const cap = Object.values(w.sites).find((s) => s.owner === m && s.kind === 'capital')!;
      const open = neighborKeys(cap.key).filter((k) => w.tiles[k] && w.tiles[k]!.terrain !== 'water' && !w.tiles[k]!.siteId);
      expect(open.length, m).toBeGreaterThanOrEqual(1);
    }
  });

  it('starts every power level: the same victory points and army weight', () => {
    const powers = INDOPAC_NATIONS.map((n) => n.id);
    const vp = (p: string) => Object.values(w.sites).filter((s) => s.owner === p).reduce((a, s) => a + s.victoryPoints, 0);
    const army = (p: string) => Object.values(w.formations).filter((f) => f.owner === p).reduce((a, f) => a + f.strength, 0);
    const spread = (f: (p: string) => number) => {
      const v = powers.map(f);
      return (Math.max(...v) - Math.min(...v)) / Math.max(...v);
    };
    expect(spread(vp)).toBeLessThanOrEqual(0.05);
    expect(spread(army)).toBeLessThanOrEqual(0.15);
  });

  it('changes only the ground with the seed, never the coasts, borders or sites', { timeout: 60_000 }, () => {
    const b = createIndoPacScenario(99);
    const shape = (x: typeof w) => sortedKeys(x.tiles).map((k) => `${k}:${x.tiles[k]!.owner}:${x.tiles[k]!.terrain === 'water'}`);
    expect(shape(w)).toEqual(shape(b));
    expect(sortedKeys(w.tiles).some((k) => w.tiles[k]!.terrain !== b.tiles[k]!.terrain)).toBe(true);
    expect(hashState(createIndoPacScenario(5))).toBe(hashState(createIndoPacScenario(5)));
    // The opening armies stand at home, two or more hexes from any rival power's capital.
    for (const n of INDOPAC_NATIONS) {
      const cap = Object.values(w.sites).find((s) => s.owner === n.id && s.kind === 'capital')!;
      for (const f of Object.values(w.formations)) if (f.owner !== n.id && !w.nations[f.owner]!.minor) expect(keyDistance(f.key, cap.key), `${f.id} near ${cap.name}`).toBeGreaterThanOrEqual(2);
    }
  });
});

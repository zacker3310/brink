// Test hook installed by apps/web/src/MapView.tsx.
interface Window {
  __brink?: {
    hexToClient(key: string): { x: number; y: number };
    reachable(): string[];
    enemies(): string[];
    formations(): { id: string; cls: string; key: string }[];
    /** The player's view (only the fields the specs read). */
    view(): {
      scenarioId: string;
      nations: Record<string, { id: string; minor?: boolean }>;
      relations: Record<string, string>;
      sites: Record<string, { name: string; owner: string | null; anomaly?: string }>;
    };
    scale(): number;
    siteToClient(siteId: string): { x: number; y: number };
    targets(): string[];
    /** Hexes the armed doctrine card is shown to be aimable at. */
    cardTargets(): string[];
    /** The running operation's current place on the map (port, beach), if it is not the prize. */
    opSpot(): { key: string; label: string } | null;
    /** Hexes the formation waiting for its landing hex can fly to, with the risk shown. */
    liftTargets(): { key: string; chance: number; mode: string }[];
    /** Bring a hex to the middle of the screen; select an own formation. */
    focus(key: string): void;
    select(id: string): void;
    holdReplay(ms: number | null): void;
  };
  // Installed by apps/web/src/arena/ArenaScreen.tsx while a battle is on.
  __arena?: {
    arena(): {
      units: { id: string; type: string; side: 'blue' | 'red'; x: number; y: number; alive: boolean; moved: boolean; acted: boolean; overwatch: boolean; carrier: string | null }[];
      round: number;
      turn: 'blue' | 'red';
      map: { w: number; h: number; redSpawn: { x: number; y: number }[] };
      difficulty: 'easy' | 'normal' | 'hard';
      ended: 'won' | 'lost' | null;
      intel: { blue: Record<string, { now: boolean }> };
      stats: { blue: { shots: number; hits: number; kills: number; lost: number } };
      turnIndex: number;
      /** The seeded stream's state. */
      stream: number;
      /** Off-map support and the missions it has left. */
      support: { id: string; side: 'blue' | 'red'; missions: number }[];
    } | null;
    /** A cell's centre on screen. */
    toScreen(x: number, y: number): { x: number; y: number };
    /** Nothing animating, the camera settled, and it is the player's turn. */
    ready(): boolean;
    win(): void;
    lose(): void;
    /** Frame timing: ms of the game's own work per frame, and what the GPU was asked to draw.
     *  `reset` starts a fresh sample after this read. */
    perf(reset?: boolean): {
      p50: number;
      p95: number;
      frames: number;
      calls: number;
      triangles: number;
      quality: 'low' | 'balanced' | 'high';
      /** The render scheduler's state, frames drawn (in all and by state) and not drawn. */
      state: 'lost' | 'suspended' | 'playback' | 'camera' | 'interaction' | 'ambient' | 'idle';
      draws: number;
      kept: number;
      drawsBy: Record<string, number>;
      ratio: number;
      /** What three.js has uploaded: counts, not memory. */
      geometries: number;
      textures: number;
      lost: boolean;
    } | null;
    /** What the field overlay shows now: the selected unit, its move and dash cells, its targets, and what it shows of the enemy. */
    overlay(): {
      selected: string | null;
      reach: number;
      dash: number;
      targets: number;
      /** Cells shaded by the Danger Area (or one enemy's reach), overwatch footprints, air-defence rings seen and suspected, likely lines, the facing glyph, ghosts drawn, expected-area cells not yet scouted. */
      insight: { threat: number; threatOf: number; watch: number; air: number; suspected: number; likely: number; glyph: string | null; ghosts: number; expected: number };
    } | null;
    /** The film: steps waiting or playing, beats playing, an action cam, its clock, steps that failed. */
    film(): { steps: number; beats: number; cam: boolean; clock: number; settled: boolean; faults: number; shake: number; camera: number[]; played: number; planned: number; flights: number } | null;
    /** Hold the film still once this many more seconds of it have played (null lets it go on). */
    pauseFilm(seconds: number | null): void;
    /** The field's palette, who wears an outline, and how many hull meshes are drawn. */
    look(): { palette: 'standard' | 'colourblind'; selected: string | null; target: string | null; hulls: number } | null;
    /** The cells (y * w + x) the selected unit can be tapped to move to now. */
    reach(): number[];
    /** The unit a press at this point would take. */
    unitAt(x: number, y: number): string | null;
    /** Call an off-map mission for either side now; `want` searches the stream for a roll that brings it down, lands it, or lands it on a vehicle and knocks it out. */
    support(side: 'blue' | 'red', id: 'himars' | 'tornado' | 'naval_gun' | 'cruise_missile' | 'strike_jet' | 'kamikaze', x: number, y: number, want?: 'intercept' | 'land' | 'kill'): boolean;
  };
}

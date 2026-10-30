// Test hook installed by apps/web/src/MapView.tsx.
interface Window {
  __brink?: {
    hexToClient(key: string): { x: number; y: number };
    reachable(): string[];
    enemies(): string[];
    formations(): { id: string; cls: string; key: string }[];
    targets(): string[];
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
    } | null;
    /** A cell's centre on screen. */
    toScreen(x: number, y: number): { x: number; y: number };
    /** Nothing animating, the camera settled, and it is the player's turn. */
    ready(): boolean;
    win(): void;
    lose(): void;
    /** Frame timing: ms of the game's own work per frame, and what the GPU was asked to draw.
     *  `reset` starts a fresh sample after this read. */
    perf(reset?: boolean): { p50: number; p95: number; frames: number; calls: number; triangles: number; quality: 'low' | 'balanced' | 'high' } | null;
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
    film(): { steps: number; beats: number; cam: boolean; clock: number; settled: boolean; faults: number; shake: number; camera: number[]; played: number; planned: number } | null;
  };
}

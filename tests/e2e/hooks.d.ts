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
      units: { id: string; side: 'blue' | 'red'; x: number; y: number; alive: boolean }[];
      shots: unknown[];
      stats: { shots: number };
    } | null;
    toScreen(x: number, y: number): { x: number; y: number };
    win(): void;
    lose(): void;
  };
}

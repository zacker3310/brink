// Test hook installed by apps/web/src/MapView.tsx.
interface Window {
  __brink?: { hexToClient(key: string): { x: number; y: number }; reachable(): string[]; enemies(): string[] };
}

import { defineConfig } from 'vitest/config';

export default defineConfig({
  // The difficulty measurement (soak/difficulty.measure.test.ts): human win rates per level, to the console.
  test: { include: ['soak/**/*.measure.test.ts'], testTimeout: 3_600_000, silent: false },
});

import { defineConfig } from 'vitest/config';

export default defineConfig({
  // The arena stress matrix (soak/arena.matrix.test.ts): its table goes to the console, pass or fail.
  test: { include: ['soak/**/*.matrix.test.ts'], testTimeout: 3_600_000, silent: false },
});

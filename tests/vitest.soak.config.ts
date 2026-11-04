import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  // The soaks report their balance tables on the console: keep it even when they pass. The arena
  // matrix has its own run (vitest.matrix.config.ts, `pnpm test:matrix`), and so does the difficulty
  // measurement (vitest.difficulty.config.ts, `pnpm test:difficulty`).
  test: { include: ['soak/**/*.test.ts'], exclude: [...configDefaults.exclude, 'soak/**/*.matrix.test.ts', 'soak/**/*.measure.test.ts'], testTimeout: 1_800_000, silent: false },
});

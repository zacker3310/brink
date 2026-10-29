import { defineConfig } from 'vitest/config';

export default defineConfig({
  // The soaks report their balance tables on the console: keep it even when they pass.
  test: { include: ['soak/**/*.test.ts'], testTimeout: 600_000, silent: false },
});

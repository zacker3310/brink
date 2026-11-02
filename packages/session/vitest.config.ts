import { defineConfig } from 'vitest/config';

// Session tests play whole AI turns on the full Pacific map: a CI runner can take several seconds
// for a few of them, so the default 5 s per test is too tight.
export default defineConfig({ test: { testTimeout: 30_000 } });

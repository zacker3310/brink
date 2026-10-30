import { defineConfig } from 'vitest/config';

// Unit tests for the web app's pure modules (the camera's numbers, the gesture state machine): no
// browser and no WebGL; three.js projects points without a renderer.
export default defineConfig({ test: { environment: 'node', include: ['src/**/*.test.ts'] } });

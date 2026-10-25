import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the build runs from any path, including a GitHub Pages subpath.
  base: './',
  plugins: [react(), tailwindcss()],
  worker: { format: 'es' },
  // PixiJS alone is ~450 kB minified; one chunk is fine for a desktop game.
  build: { chunkSizeWarningLimit: 900 },
  server: { port: 5173 },
});

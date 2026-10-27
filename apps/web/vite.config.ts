import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the build runs from any path, including a GitHub Pages subpath.
  base: './',
  plugins: [react(), tailwindcss()],
  worker: { format: 'es' },
  build: {
    chunkSizeWarningLimit: 900,
    // Vendor code changes rarely: split it out so it caches across deploys and loads in parallel.
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'pixi', test: /node_modules[\\/].*pixi/ },
            { name: 'react', test: /node_modules[\\/].*(react|scheduler|zustand)/ },
          ],
        },
      },
    },
  },
  server: { port: 5173 },
});

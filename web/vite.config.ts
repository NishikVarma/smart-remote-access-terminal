import { defineConfig } from 'vite';

// Development only: Vite serves the page and forwards API and engine traffic to the smart server.
// In normal use the smart server serves the built page itself (npm run build:web, npm run serve).
export default defineConfig({
  root: import.meta.dirname,
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8788',
      '/engine': { target: 'http://127.0.0.1:8788', ws: true },
    },
  },
});

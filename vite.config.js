import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  // Served from https://muskeg.github.io/simple3d/ via GitHub Pages.
  base: '/simple3d/',
  plugins: [react(), tailwindcss()],
  // The build worker imports shared ES modules (Manifold, Three.js), which needs ES-format workers.
  worker: { format: 'es' },
  server: { watch: { usePolling: true, interval: 300 } },
});

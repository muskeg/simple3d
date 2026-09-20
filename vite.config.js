import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  // Served from https://muskeg.github.io/simple3d/ via GitHub Pages.
  base: '/simple3d/',
  plugins: [react(), tailwindcss()],
  server: { watch: { usePolling: true, interval: 300 } },
});

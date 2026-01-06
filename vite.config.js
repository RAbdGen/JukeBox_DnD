import { defineConfig } from 'vite';

// https://vite.dev/config/
export default defineConfig({
  root: 'frontend',
  base: './', // Use relative paths for Electron production build
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  server: {
    port: 3000,
  },
});

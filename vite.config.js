import { defineConfig } from 'vite';

// https://vite.dev/config/
export default defineConfig({
  root: 'frontend',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  server: {
    port: 3000,
  },
});

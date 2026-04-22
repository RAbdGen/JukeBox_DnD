import { defineConfig } from 'vite';

export default defineConfig({
  root: 'frontend',
  base: './',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'es2020',
    minify: 'esbuild',
    sourcemap: false,
    rollupOptions: {
      output: {
        // Un seul chunk pour une app de cette taille — évite les requêtes multiples
        manualChunks: undefined,
      },
    },
  },
  server: {
    port: 3000,
  },
});

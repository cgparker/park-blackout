import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// The 3D build: the playable slice (levels 1 and 2) and the stills page.
// Its models and textures live in public3d/, so the 2D build stays small.
// npm run dev:3d serves it; npm run build:3d writes dist-slice/.
export default defineConfig({
  base: './',
  publicDir: 'public3d',
  build: {
    target: 'es2022',
    outDir: 'dist-slice',
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      input: {
        slice: resolve(import.meta.dirname, 'slice.html'),
        still: resolve(import.meta.dirname, 'still.html'),
      },
    },
  },
  server: { host: true },
});

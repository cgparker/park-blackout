import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// The 3D build: the playable slice (levels 1 and 2) and the stills page.
// Its models and textures live in public3d/, so the 2D build stays small.
// npm run dev:3d serves it; npm run build:3d writes dist-slice/.
// With --mode artifact (npm run build:3d-artifact) the page reads its models as base64 text,
// because a Claude artifact only serves text, image, and media files.
export default defineConfig(({ mode }) => ({
  base: './',
  publicDir: 'public3d',
  define: {
    __MODELS_AS_TEXT__: JSON.stringify(mode === 'artifact'),
  },
  build: {
    target: 'es2022',
    outDir: mode === 'artifact' ? 'dist-slice-artifact' : 'dist-slice',
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      input: {
        slice: resolve(import.meta.dirname, 'slice.html'),
        still: resolve(import.meta.dirname, 'still.html'),
      },
    },
  },
  server: { host: true },
}));

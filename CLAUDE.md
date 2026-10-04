# Park Blackout

Phone-first RTS prototype in Phaser 4 + TypeScript + Vite. Read SPEC.md for the design and DECISIONS.md for calls already made.

## Rules for changes

- Every tuning number goes in `src/config.ts`. No numbers hard-coded elsewhere. The 3D renderer's model sizes and shader constants stay with its drawing code in `src/render3d`, as the 2D renderer's shapes do; its camera and input numbers are in `VIEW3D`.
- Game rules live in `src/core` and must not import Phaser or three.js. The scenes and controllers (`src/scenes`, `src/slice3d`), renderers (`src/render`, `src/render3d`), and HUD (`src/ui`) only read the world and send it orders.
- When the spec is silent, pick the simplest thing that fits its intent and add a line to DECISIONS.md.
- Placeholder shapes only, no image or audio assets, until the spec says otherwise. The 3D build is the one exception (SPEC section 10): CC0 models and generated textures in `public3d/`, each listed in `public3d/LICENSES.md`. Add nothing without a clear CC0 or made-here source, and copy nothing from films, games, or known characters.
- UI text and docs: plain, short sentences. No em dashes.

## Before committing

- `npm run typecheck` and `npm test` must pass.
- For anything that touches input, the HUD, or rendering: `npm run build`, `npx vite preview --port 4173`, then `npm run smoke` (needs `npx playwright install chromium` once).
- For economy or combat changes: `npm run balance`, and update SPEC.md section 13 if the numbers move.
- For the 3D build: `npm run build:3d`, serve it (`npx vite --config vite.slice.config.ts --port 5180`), then `npm run smoke3d`.

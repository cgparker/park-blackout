# Park Blackout

Phone-first RTS prototype in TypeScript and Vite. The game players play is the 3D build (`slice.html`, three.js). The 2D build (`index.html`, Phaser 4) is a staging ground for working out mechanics: it shares the rules and the HUD, and it isn't for players. Read SPEC.md for the design and DECISIONS.md for calls already made.

## Rules for changes

- Every tuning number goes in `src/config.ts`. No numbers hard-coded elsewhere. The 3D renderer's model sizes and shader constants stay with its drawing code in `src/render3d`, as the 2D renderer's shapes do; its camera and input numbers are in `VIEW3D`. Sound works the same way: the mix and how sounds follow the camera are in `AUDIO` and `SOUNDS`, and the numbers that shape a made sound stay with its code in `src/audio`.
- Game rules live in `src/core` and must not import Phaser or three.js. The scenes and controllers (`src/scenes`, `src/slice3d`), renderers (`src/render`, `src/render3d`), sound (`src/audio`), and HUD (`src/ui`) only read the world and send it orders.
- When the spec is silent, pick the simplest thing that fits its intent and add a line to DECISIONS.md.
- The 2D build uses placeholder shapes only, and has no sound. The 3D game uses CC0 models, generated textures, and CC0 or made-here sounds in `public3d/` (SPEC section 10), each listed in `public3d/LICENSES.md`. Add nothing without a clear CC0 or made-here source, and copy nothing from films, games, or known characters.
- UI text and docs: plain, short sentences. No em dashes.

## Before committing

- `npm run typecheck` and `npm test` must pass.
- For the 3D game: `npm run build:3d`, serve it (`npx vite --config vite.slice.config.ts --port 5180`), then `npm run smoke3d`.
- For anything that touches input, the HUD, or the 2D build: `npm run build`, `npx vite preview --port 4173`, then `npm run smoke` (needs `npx playwright install chromium` once).
- For economy or combat changes: `npm run balance`, and update SPEC.md section 13 if the numbers move.
- For sounds: `python3 scripts/audio3d.py --src <packs>` rebuilds `public3d/audio/` and `src/audio/files.ts`. Update `public3d/LICENSES.md` with any new source.

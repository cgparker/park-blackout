# Park Blackout

Phone-first RTS prototype in Phaser 4 + TypeScript + Vite. Read SPEC.md for the design and DECISIONS.md for calls already made.

## Rules for changes

- Every tuning number goes in `src/config.ts`. No numbers hard-coded elsewhere.
- Game rules live in `src/core` and must not import Phaser. The scene (`src/scenes`), renderer (`src/render`), and HUD (`src/ui`) only read the world and send it orders.
- When the spec is silent, pick the simplest thing that fits its intent and add a line to DECISIONS.md.
- Placeholder shapes only, no image or audio assets, until the spec says otherwise.
- UI text and docs: plain, short sentences. No em dashes.

## Before committing

- `npm run typecheck` and `npm test` must pass.
- For anything that touches input, the HUD, or rendering: `npm run build`, `npx vite preview --port 4173`, then `npm run smoke` (needs `npx playwright install chromium` once).
- For economy or combat changes: `npm run balance`, and update SPEC.md section 13 if the numbers move.

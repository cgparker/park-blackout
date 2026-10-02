# Park Blackout

A single-player RTS prototype for phones. Build a dinosaur park, earn money from exhibits, and train a containment team before a rival company cuts the fence power. Then contain the cascade. The full design is in [SPEC.md](SPEC.md).

## Status

All six milestones in SPEC.md are built: map and building, visitors and income, the containment team, the blackout cascade, combat and scoring, and tuning tools. A second round made the blackout matter more: visitors who don't notice the blackout until danger is close, shorter visits so spacing costs money, a T. rex that locks onto one troop and charges, Tranq Towers, and a 5:00 build phase. Calls made where the spec was silent are in [DECISIONS.md](DECISIONS.md).

## Run it

```bash
npm install
npm run dev
```

Vite prints a Network URL (something like `http://192.168.1.20:5173`). Open it on your phone on the same Wi-Fi and turn the phone sideways. On iPhone, Share > Add to Home Screen gives you a full-screen version without Safari's bars.

## Controls

| Phone | Desktop | Does |
|---|---|---|
| Tap an exhibit in the bottom bar, then the map | Same, with clicks | Place an exhibit, then tap **Build** |
| Tap **Tower** in the bottom bar, then the map | Same, with clicks | Place a Tranq Tower, then tap **Build** |
| Tap an exhibit on the map | Click it | Visits, revenue, fence, and **Reinforce** |
| Tap HQ, or **Train** in the bottom bar | Same | Train troops |
| Tap a troop | Click it | Select it |
| Hold, then drag | Left-drag | Select a group |
| Tap the ground with troops selected | Right-click | Move there |
| Tap a dinosaur with troops selected | Right-click it | Attack it |
| Drag | Middle-drag, or WASD / arrow keys | Pan |
| Pinch | Scroll wheel | Zoom |
| **Select all**, **Clear** | Same, or Esc to clear | Selection |
| **Got it** or **Hide tips** on a tip | Same, or Esc to close it | Tips pause the game; turn them off here or on the briefing |

## Tuning

- Every number is in `src/config.ts`.
- `npm run balance` plays five build strategies, two dense parks against seven defenses, and ten fights headlessly and prints the results. SPEC.md section 13 has the latest numbers. Add `SEEDS=16` for steadier numbers, or `UNCAPPED=1` to lift the casualty limit and see every game's deaths.
- Debug tools: tick **Debug tools** on the briefing screen, or add `?debug=1`. You get game speed (1x, 2x, 4x), **Blackout now**, **+$10,000**, fence HP numbers, the tile grid, and FPS.
- Short games: tick **Quick test** on the briefing screen for a 2:00 build phase, or add `?blackout=120` for any length in seconds.
- `?seed=7` makes a game repeatable.
- Inside a Claude artifact, query strings don't reach the page. Use the briefing checkboxes, or a hash such as `#debug.blackout-120.seed-7`.

## Checks

- `npm test` runs 63 unit tests: map, pathing, placement, visitors and what makes them run, training, orders, towers, the blackout cascade, the T. rex lock-on and charge, combat, power return, when each tip fires, and a full scripted game.
- `npm run stress` plays 40 randomized games (towers included) and fails if anyone walks through a rock, pen, or tower, a tower moves, a number goes bad, or a game never ends.
- `npm run smoke` plays the game in a browser at phone and desktop sizes with real taps, drags, and pinches (61 checks). Build and serve first: `npm run build && npx vite preview --port 4173`. It needs a Playwright browser once: `npx playwright install chromium`.
- `node scripts/look.mjs` saves screenshots of the main game states, including a T. rex wind-up and charge, to `test-results/look`.
- `npm run typecheck` checks types.

## Where things live

| Path | What |
|---|---|
| `src/config.ts` | Every tuning number, plus the map layout as a text grid |
| `src/core/world.ts` | The game state, phases, and rules that tie the systems together |
| `src/core/visitors.ts`, `units.ts`, `dinos.ts`, `combat.ts` | The systems. No Phaser in `src/core`, so it all runs in tests |
| `src/core/nav.ts` | A* paths, distance maps, and line-of-sight |
| `src/render/worldView.ts` | Draws the world |
| `src/scenes/GameScene.ts` | Camera, touch and mouse input, wiring to the HUD |
| `src/ui/hud.ts` | The HTML layer: bars, panels, briefing, end screen, debug |

## Deploy

GitHub Actions (`.github/workflows/build.yml`) tests and builds every push to `main`. To publish to GitHub Pages:

1. Settings > Pages > Build and deployment > Source: **GitHub Actions**.
2. Settings > Secrets and variables > Actions > Variables: add `PAGES_ENABLED` with the value `true`.
3. Push, or run the workflow from the Actions tab.

GitHub Pages on a private repo needs GitHub Pro or a team plan, and the site itself is public on the internet even though the repo is private (only GitHub Enterprise Cloud can publish privately).

## Builds

- `npm run build` makes a static site in `dist/`.
- `npm run build:single` makes one self-contained HTML file in `dist-single/`.
- `npm run build:artifact` turns that file into a Claude artifact page in `dist-artifact/` (no document wrapper tags; the artifact host adds them).

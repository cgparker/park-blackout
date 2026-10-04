# Park Blackout

A single-player RTS prototype for phones in three levels. Round up loose Triceratops, clear a raptor nest, then build a dinosaur park, earn money from exhibits, and train a containment team before a rival company cuts the fence power. The full design is in [SPEC.md](SPEC.md).

## Status

All six milestones in SPEC.md are built: map and building, visitors and income, the containment team, the blackout cascade, combat and scoring, and tuning tools. A second round made the blackout matter more: visitors who don't notice the blackout until danger is close, shorter visits so spacing costs money, a T. rex that locks onto one troop and charges, Tranq Towers, and a 5:00 build phase. Then the park stopped warning its guests: they keep touring and paying in the dark until the first animal gets out, and only then does the park evacuate. A design audit added a pause menu (Restart, End game), breakout times and team strength in the panels, an end-screen timeline with one "next time" suggestion, and edge arrows during the blackout. Stars are one per goal: get every dinosaur back, earn the revenue target, keep every guest alive. Two levels now come before that game, each in a park that's already built: level 1, Roundup, teaches training and moving troops by darting 6 loose Triceratops before the park opens; level 2, Raptor Nest, teaches fighting against 6 raptors guarding a nest. The blackout is level 3. Calls made where the spec was silent are in [DECISIONS.md](DECISIONS.md).

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
| The pause button, top right | Same, or Esc with nothing selected, or P | Pause menu: Resume, Restart, End game |
| An arrow at the edge of the map | Click it | Look at the off-screen animal or broken fence |
| A level on the briefing | Click it | Pick level 1, 2, or 3 |
| **Next level** after a win | Click it | The next level's briefing |

## Tuning

- Every number is in `src/config.ts`.
- `npm run balance` plays five build strategies, two dense parks against nine defenses, ten fights, level 1 with one to four squads, and level 2 against eight troop mixes, headlessly, and prints the results. SPEC.md section 13 has the latest numbers. Add `SEEDS=16` for steadier numbers, or `UNCAPPED=1` to lift the casualty limit and see every game's deaths.
- Debug tools: tick **Debug tools** on the briefing screen, or add `?debug=1`. You get game speed (1x, 2x, 4x), **Blackout now**, **+$10,000**, fence HP numbers, the tile grid, and FPS.
- Short games: tick **Quick test** on the briefing screen for a 2:00 build phase, or add `?blackout=120` for any length in seconds.
- `?seed=7` makes a game repeatable, and `?level=2` opens the briefing on that level.
- Inside a Claude artifact, query strings don't reach the page. Use the briefing checkboxes, or a hash such as `#debug.blackout-120.seed-7.level-3`.

## Checks

- `npm test` runs 113 unit tests: map, pathing, placement, visitors and what makes them run, touring and paying in the dark, the evacuation, training, orders, towers, the blackout cascade, the T. rex lock-on and charge, combat, power return, breakout times against the simulation, the blackout log, the end-screen timeline and its advice, the star goals, when each tip fires, a full scripted game, and for levels 1 and 2 the built parks, animals carried home, the nest raptors, how a level is won or lost, and their goals, timeline, tips, and briefings.
- `npm run stress` plays 40 randomized blackout games (towers included) and 40 of levels 1 and 2, and fails if anyone walks through a rock, pen, or tower, a tower moves, a guest keeps touring after the evacuation, the revenue doesn't add up, the log is out of order, a number goes bad, or a game never ends.
- `npm run smoke` plays the game in a browser at phone and desktop sizes with real taps, drags, and pinches, including the level picker and both new levels (123 checks). Build and serve first: `npm run build && npx vite preview --port 4173`. It needs a Playwright browser once: `npx playwright install chromium`.
- `node scripts/look.mjs` saves screenshots of the main game states, including a T. rex wind-up and charge, to `test-results/look`.
- `npm run typecheck` checks types.

## Where things live

| Path | What |
|---|---|
| `src/config.ts` | Every tuning number, plus the map layout as a text grid |
| `src/core/world.ts` | The game state, phases, and rules that tie the systems together |
| `src/core/levels.ts` | Builds the park levels 1 and 2 start with and lets their animals out |
| `src/core/visitors.ts`, `units.ts`, `dinos.ts`, `combat.ts` | The systems. No Phaser in `src/core`, so it all runs in tests |
| `src/core/nav.ts` | A* paths, distance maps, and line-of-sight |
| `src/core/estimates.ts` | Breakout times and team sedation speed, worked out from the rules |
| `src/core/log.ts` | What the world records for the end screen, during the blackout or a level 1 or 2 game |
| `src/render/worldView.ts` | Draws the world |
| `src/scenes/GameScene.ts` | Camera, touch and mouse input, wiring to the HUD |
| `src/ui/hud.ts` | The HTML layer: bars, panels, briefing, pause menu, edge arrows, end screen, debug |
| `src/ui/tips.ts`, `src/ui/timeline.ts`, `src/ui/goals.ts`, `src/ui/levels.ts` | When tips fire, the end-screen timeline and next-time line, the star goals, and each level's briefing (no DOM, so they're tested) |

## Deploy

GitHub Actions (`.github/workflows/build.yml`) tests and builds every push to `main`. To publish to GitHub Pages:

1. Settings > Pages > Build and deployment > Source: **GitHub Actions**.
2. Settings > Secrets and variables > Actions > Variables: add `PAGES_ENABLED` with the value `true`.
3. Push, or run the workflow from the Actions tab.

GitHub Pages on a private repo needs GitHub Pro or a team plan, and the site itself is public on the internet even though the repo is private (only GitHub Enterprise Cloud can publish privately).

## 3D build

All three levels in real 3D, to test the look and the frame rate on phones (SPEC section 10). Same rules, HUD, and controls as the 2D game.

- `npm run dev:3d`, then open `/slice.html` on the Network URL Vite prints. `#level-3` opens on the blackout level.
- The bar at the top right shows frames per second, switches **Night** lighting on and off, and switches between **High** and **Low quality** (the game keeps going; the view rebuilds in a second or two). Add `#debug` to also see draw calls and triangles.
- `npm run build:3d` writes `dist-slice/`. `npm run smoke3d` checks it in a phone-sized browser (serve it first, on port 5180): level 2's training and orders, then level 3's building, the blackout, and the power coming back.
- `npm run stills3d -- "mode=night" night.png 1280 720 1` saves review images from `still.html`: `mode` is `day` or `night` (a level 3 moment), `level1`, `level2`, `fences`, or `troops`. Add `shots=x,z,distance,elevation;...` for close-ups.
- `npm run build:3d-artifact` makes the Claude artifact version in `dist-slice-artifact/`: the page without its document wrapper, plus `artifact-files.json`, the list of files to publish beside it. Artifacts serve no binary files, so each model goes as a GLB in base64 text.
- `npm run assets3d` rebuilds `public3d/` from the source packs (not in the repo); `npm run assets3d -- people` rebuilds only the people (or `dinos`, `nature`). Sources and licenses: `public3d/LICENSES.md`.

| Path | What |
|---|---|
| `src/render3d/` | The 3D view: terrain, decor, fences, buildings, actors, effects, materials |
| `src/slice3d/` | The 3D game's controller: camera, touch input, building, HUD wiring |
| `src/still3d/` | The stills page |
| `public3d/` | Models and textures for the 3D builds |

## Builds

- `npm run build` makes a static site in `dist/`.
- `npm run build:single` makes one self-contained HTML file in `dist-single/`.
- `npm run build:artifact` turns that file into a Claude artifact page in `dist-artifact/` (no document wrapper tags; the artifact host adds them).

# Park Blackout

A single-player RTS prototype for phones. Build a dinosaur park, earn money from exhibits, and train a containment team before a rival company cuts the fence power. The full design is in [SPEC.md](SPEC.md).

## Status

**Milestone 1 of 6 is done:** map, camera, exhibit placement with auto-paths, and money. Visitors, income, and the countdown come in Milestone 2.

## Run it

```bash
npm install
npm run dev
```

Vite prints a Network URL (something like `http://192.168.1.20:5173`). Open it on your phone on the same Wi-Fi and turn the phone sideways. On iPhone, Share > Add to Home Screen gives you a full-screen version without Safari's bars.

## Controls

| Phone | Desktop | Does |
|---|---|---|
| Tap an exhibit in the bottom bar | Click it | Start placing it |
| Tap the map | Click the map | Move the ghost there |
| Tap **Build** | Click **Build** | Confirm |
| Drag | Drag, or WASD / arrow keys | Pan |
| Pinch | Scroll wheel | Zoom |
| Tap **Cancel** or the same exhibit again | Esc | Stop placing |

## Checks

- `npm test` runs unit tests for the map, auto-pathing, placement rules, and building.
- `npm run smoke` runs a browser test at phone and desktop sizes (taps, drags, pinches, building). Build and serve first: `npm run build && npx vite preview --port 4173`. It needs a Playwright browser once: `npx playwright install chromium`.
- Add `?debug=1` to the URL to expose `window.__pb` (scene, state, grid) in the browser console.

## Where things live

| Path | What |
|---|---|
| `src/config.ts` | Every tuning number, plus the map layout as a text grid |
| `src/core/` | Game rules with no Phaser in them (grid, pathing, placement, state). Unit tested |
| `src/scenes/GameScene.ts` | Drawing, camera, touch input |
| `src/ui/hud.ts` | The HTML layer: money, build bar, placement panel, toasts |
| `DECISIONS.md` | Calls made where the spec was silent |

## Builds

- `npm run build` makes a static site in `dist/` (for GitHub Pages in Milestone 6).
- `npm run build:single` makes one self-contained HTML file in `dist-single/`.
- `npm run build:artifact` turns that file into a Claude artifact page in `dist-artifact/` (no document wrapper tags; the artifact host adds them).

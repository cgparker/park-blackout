# Park Blackout: Prototype Spec

Working title. A single-player RTS for phones. Build a dinosaur park, earn money from exhibits, and train a containment team before a rival company cuts power to the electric fences. Then contain the cascade.

## Instructions for Claude Code

- Build in the milestone order in section 12. Stop after each milestone so I can test it on my phone before you continue.
- Every number in this spec goes in one file, `src/config.ts`. No tuning values hard-coded anywhere else.
- Placeholder shapes only (section 10). No image or audio assets.
- If something is ambiguous, pick the simplest option that matches the intent and log it in `DECISIONS.md`. Don't add features that aren't in this spec.

## 1. What this prototype tests

1. Does the build phase feel tense, knowing the blackout is coming?
2. Does the cascade feel dramatic and fair ("I should have spaced those pens out") rather than random?
3. Do I want to replay it with a different build order?

**Out of scope:** real art, sound, saving, menus beyond Retry, multiple levels, lethal weapons, fence repair, and Mantah troops.

## 2. Platform and tech

- Phaser (latest stable) with TypeScript and Vite.
- Runs in mobile Safari, landscape only. Show a "rotate your phone" overlay in portrait.
- Logical resolution 1280x720, scaled to fit the screen.
- Lock down browser touch behavior on the game: no page pinch-zoom, no double-tap zoom, no scrolling or pull-to-refresh, no text selection or long-press callouts.
- Mouse support too, for testing on a desktop browser.
- Development: run with `vite --host` so I can open it on my phone over Wi-Fi. Deploy: static build to GitHub Pages.
- Pathfinding: grid A* (a small custom one or EasyStar.js).
- Performance target: 60 fps on a recent iPhone with 80 visitors, 20 troops, and 20 dinosaurs.

## 3. Game flow

1. **Briefing screen:** "Mantah Corp will cut power to the electric fences in 10:00 to steal dinosaur embryos. Build your park, earn money, and train your containment team before the lights go out." Tap to start.
2. **Act 1, Build (10:00):** Place exhibits, earn money from visitors, train troops, and reinforce fences. A large countdown is always visible. A warning banner appears at 1:00 left.
3. **Act 2, Blackout:** Fences lose power, the gates close, visitors flee, and dinosaurs break out in a cascade. Power returns 5:00 later.
4. **End screen:** Stars and a breakdown of what happened.

## 4. Map

- Grid of 40x24 tiles at 40 px per tile (world size 1600x960). The camera pans and zooms; minimum zoom shows the whole map, maximum zoom is 2x.
- One gate on the left edge, middle row, is both entrance and exit. A 3-tile path stub leads in from it.
- Containment HQ (3x3) is pre-placed near the entrance, just off the path.
- 3 or 4 obstacle clusters (rocks, a pond) block building and movement so layout takes some thought.
- Tile types: grass (buildable, walkable), path (walkable), exhibit (blocked), obstacle (blocked), HQ (blocked).

## 5. Economy

### Money

- Starting money: $15,000.
- Income comes only from visitors paying at exhibits. Park entry is free.
- Revenue target for 2 stars: $4,000 per minute of build phase ($40,000 at 10:00). Revenue means total earned in Act 1, not money left in the bank.
- No income in Act 2. Banked money can still train troops.

### Exhibits

| | Pasture | Raptor Pen | T. rex Paddock |
|---|---|---|---|
| Cost | $3,000 | $6,000 | $12,000 |
| Price per visit | $10 | $25 | $60 |
| Appeal | 1 | 2 | 4 |
| Footprint (fence included) | 5x5 | 4x4 | 6x6 |
| Fence segments | 16 | 12 | 20 |
| Animals | 2 Triceratops | 3 raptors | 1 T. rex |
| Max per level | No limit | 3 | 1 |
| Reinforce cost ($150 per segment) | $2,400 | $1,800 | $3,000 |

- The outer ring of tiles is the fence, one segment per tile. Animals live on the interior tiles.
- Fence HP: 200 per segment (chain-link). Reinforced: 600 per segment (concrete). Reinforcing is a one-time purchase per exhibit, Act 1 only.
- While powered, fences can't be damaged and animals don't test them.

### Placement

- Tap an exhibit button, then tap the map. A ghost shows the footprint (green if valid, red if not), the auto-path, and the total cost. Confirm and Cancel buttons appear beside it.
- Auto-path: A* from the nearest existing path tile to the exhibit's viewing spot (the free tile next to the fence that's closest to the path network). Path costs $50 per tile and is included in the ghost's total.
- Placement is invalid if the footprint overlaps anything, touches the map edge, or no path route exists.
- Exhibits can touch each other. Each one owns its own fence segments.

### Visitors

- Spawn rate per second: 0.10 + 0.12 x total park appeal. Maximum 80 visitors in the park at once.
- Each visitor has a 60-second time budget. Walking and viewing both use it up.
- Choosing the next exhibit: highest score among exhibits they haven't visited, where score = appeal / (1 + path distance in tiles / 8), plus a little randomness.
- At an exhibit: stand at the viewing spot for 4 seconds, then pay its price (show a floating "+$25").
- When the budget runs out or every exhibit is visited, walk back to the gate and leave.
- Walk speed 50 px/s, on paths only. Flee speed 100 px/s.

This is what makes spacing cost money: a visitor walking between exhibits isn't paying anyone.

## 6. Containment team

### HQ

- Tap HQ to open the training panel. Queue up to 5 units. New units appear next to HQ.

### Units

| | Tranq Squad | Heavy Team |
|---|---|---|
| Cost | $1,500 | $4,000 |
| Train time | 8 s | 15 s |
| HP | 100 | 250 |
| Speed | 100 px/s | 70 px/s |
| Range | 160 px (4 tiles) | 200 px (5 tiles) |
| Darts | 10 sedation, 1 per second | 50 sedation, 1 per 2 seconds |

- Units walk on grass and paths. No healing in the prototype. A unit at 0 HP is lost.
- Idle units automatically fire at the nearest dinosaur in range.
- A **move** order moves without firing (for retreating and kiting). An **attack** order (tap a dinosaur) chases that target and fires at it.

## 7. Controls

### Touch

| Gesture | Action |
|---|---|
| Tap a unit | Select it |
| Long-press (300 ms), then drag | Selection box |
| One-finger drag | Pan the camera |
| Pinch | Zoom |
| Tap ground with units selected | Move there |
| Tap a dinosaur with units selected | Attack it |
| Tap an exhibit with nothing selected | Exhibit panel: visits, revenue, fence HP, Reinforce button |
| Tap HQ | Training panel |

HUD buttons: **Select All Troops** and **Clear Selection**.

### Mouse

Left-click to select, left-drag for a selection box, right-click to move or attack, WASD or arrow keys to pan, scroll wheel to zoom.

### HUD

- **Top bar:** money, revenue vs. target, the countdown (large, centered), and casualties (x/10). In Act 2 the countdown switches to time until power returns, and it adds loose and secured dinosaur counts.
- **Bottom bar:** exhibit buttons (grayed out when unaffordable or at the limit) and selected-unit info.

## 8. The blackout

### At 0:00

- Banner: "Mantah Corp has cut the power." The screen dims, and fences turn from cyan to gray.
- Gates close. No new visitors arrive.
- Every visitor flees to the gate at flee speed. A visitor who reaches the gate is safe.

### Breakouts

Not every dinosaur escapes. Each type follows its own rule, and the cascade comes from the player's layout.

- **T. rex:** After 10 s, attacks the segment of its fence closest to the nearest visitor or other exhibit. Chain-link breaks in 3 hits; concrete in 8.
- **Raptors:** After 20 s, every raptor in a pen attacks that pen's weakest segment together.
- **Triceratops:** Never attack their own fence. They only get out if something else breaks it, or if they stampede through a damaged segment.

When a segment reaches 0 HP, it becomes a gap. Animals can leave through gaps.

### Dinosaur stats

| | Triceratops | Raptor | T. rex |
|---|---|---|---|
| Sedation | 120 | 60 | 500 |
| Speed | 120 px/s (stampeding) | 160 px/s | 90 px/s |
| Damage to troops | None | 10 per second | 50 per bite, 1 bite per 1.5 s |
| Fence damage | 40 per collision while stampeding | 20 per second | 80 per hit, 1 hit per 1.5 s |

### Loose dinosaur behavior

- **T. rex** target priority: (1) a unit that hit it in the last 5 s, within 6 tiles; (2) the nearest visitor within 10 tiles; (3) the nearest exhibit with animals still inside, which it walks to and breaks into; (4) the nearest visitor anywhere.
- **Raptors:** Hunt the nearest visitor or unit within 8 tiles. Otherwise head for the nearest visitor anywhere, and if there are none, the nearest unit.
- **Triceratops:** If a dinosaur or unit is within 4 tiles, stampede directly away for 5 s, trampling anything in the way. Otherwise, graze in place. A stampede that hits a fence deals 40 damage to that segment and stops. Triceratops still inside their pen can stampede too, so a T. rex outside their fence can scare them into breaking it from the inside.
- A visitor touched by a raptor or T. rex for 0.5 s, or hit by a stampeding Triceratops, is a casualty.
- Dinosaurs ignore HQ and paths. They only damage fences, troops, and visitors.

### Sedation and securing

- Darts reduce sedation. It doesn't regenerate. At 0, the dinosaur is secured: it fades out over 2 s and counts toward Secured.

### Power returns

- 5:00 after the blackout, power returns. Any animal inside its exhibit's footprint is contained, and that exhibit's gaps are sealed.
- Loose dinosaurs still have to be secured.

## 9. Winning and losing

- **Lose:** 10 casualties at any point ("The park has been shut down"), or any dinosaur still loose 3:00 after power returns ("The park is overrun").
- **Win:** Power has returned and no dinosaurs are loose.

### Stars

- ⭐ Win.
- ⭐⭐ Win and hit the revenue target.
- ⭐⭐⭐ Win, hit the revenue target, and have zero casualties.

### End screen

- Stars and result.
- Revenue by exhibit (visits and dollars).
- Spending: exhibits, paths, reinforcement, troops.
- Casualties by cause (raptor, T. rex, stampede).
- Troops lost, and dinosaurs secured vs. contained.
- Retry button.

## 10. Placeholder visuals

- Grass dark green, paths tan, obstacles gray.
- Fences: cyan when powered, gray when unpowered, thicker and white when reinforced. They darken as HP drops; a gap is a missing segment.
- Visitors: small white dots. A casualty leaves a small red mark.
- Tranq Squad: small blue circle. Heavy Team: larger blue square. Selected units get a yellow ring.
- Triceratops: green oval. Raptor: small orange triangle pointing where it's moving. T. rex: large red circle with a notch showing its facing.
- A sedation bar appears over a dinosaur once it's hit, and an HP bar over a unit once it's damaged.

## 11. Debug tools

Enabled with `?debug=1` in the URL:

- Game speed: 1x, 2x, 4x.
- **Blackout Now** button.
- **+$10,000** button.
- Show fence HP numbers, the tile grid, and FPS.

URL override: `?blackout=180` sets the build phase to 3:00 for quick playtests. The revenue target scales with it.

## 12. Milestones

Each milestone ends with something playable on my phone.

1. **Map and building:** grid, camera, exhibit placement with ghost preview and auto-paths, money.
2. **Visitors and economy:** spawning, path walking, pay-per-exhibit, time budget, HUD with countdown and revenue.
3. **Containment team:** HQ training, selection, move and attack orders, touch controls.
4. **Blackout and cascade:** fences lose power, breakout rules, fence HP, fleeing visitors, loose dinosaur behavior.
5. **Combat and scoring:** darts, dinosaur attacks, casualties, securing, win and lose, stars, end screen.
6. **Tuning tools:** debug options, URL overrides, deploy to GitHub Pages.

## 13. Balance (measured)

`npm run balance` plays these headlessly with the real rules: 3 seeds per build strategy, 5 per fight. Each exhibit goes in the open spot closest to the gate that keeps the stated gap, and building stops at 7:00. These are starting points for playtests, not truth. (The first draft of this table came from a rougher estimate; the numbers below replace it.)

Build phase (10:00, ★★ target $40,000):

| Strategy | Revenue | ★★? | Left for troops |
|---|---|---|---|
| Dense: 2 raptor pens, T. rex, 2 pastures | ~$54,000 | Yes | ~$38,000 |
| Dense: 3 raptor pens, 3 pastures | ~$47,000 | Yes | ~$34,000 |
| Medium spacing (3 tiles apart), same as the first row | ~$48,000 | Yes | ~$32,000 |
| Spread out (7 tiles apart), same as the first row | ~$43,000 | Yes, barely | ~$30,000 |
| Herbivores only | ~$29,000 | No | ~$12,000 |

Fights on open grass (troops in a block, dinosaurs released 6 tiles away):

| Fight | Result |
|---|---|
| Raptor pack vs 2 Tranq Squads | Raptors win |
| Raptor pack vs 3 Tranq Squads | Troops win, lose about 1 |
| Raptor pack vs 2 Heavy Teams | Troops win, no losses |
| T. rex vs 4 Tranq Squads | T. rex wins |
| T. rex vs 2 Heavy Teams + 2 Tranq Squads | Troops win, no losses |
| T. rex vs 3 Heavy Teams | Troops win, no losses |

Blackout with a full dense park and no troops (5 seeds): about 78 visitors are in the park when the power goes out, the first fence breaks at about 14 s, and every visitor reaches the gate first. Zero casualties in all five.

What to watch in playtests:

- Visitors outrun the breakouts. Fleeing at 100 px/s, everyone is out before the T. rex breaks its fence, so casualties are rare, the 10-casualty loss almost never happens, and the third star comes free. If playtests agree, the levers are: visitors don't notice the blackout until a fence breaks or a dinosaur gets close, shorter breakout delays, or a slower flee speed.
- Spacing costs less than the first estimate: even the spread-out park clears $40,000. If playtests agree, shorten the visitor time budget (`VISITORS.timeBudgetSeconds`) or raise the revenue target.
- The dense T. rex build earns the most. It should also be the scariest blackout; if it isn't, the T. rex is too weak.
- The T. rex goes down to 2 Heavy + 2 Tranq with no losses, easier than intended. It turns on whoever darted it last, which spreads its bites around. If it feels weak, make it stick with one target or raise its sedation.
- Heavy Teams handle raptors with no losses. Tranq Squads are the cheap option that costs a unit.
- Building extra cheap pastures can lower revenue, because visitors spend their time budget on $10 exhibits. That's intended, and the end screen shows revenue per exhibit.

## 14. Later, not now

- Mantah mercenaries raiding a genetics lab as a second objective.
- Nest missions: escaped dinosaurs build a nest that spawns more.
- Freestanding walls, fence repair, more units (jeep, helicopter), and a lethal option with a cost.
- More levels with different maps, exhibit limits, and timers.
- Real art (for example, PixelLab sprites) and sound.
- Rename Mantah Corp before sharing publicly. It's the villain company from Camp Cretaceous.

# Decisions

Calls made where SPEC.md was silent, or where following it literally would have made things worse. Each tuning number mentioned here lives in `src/config.ts`.

## Milestone 6: tuning tools and deploy

1. **Quick test and Debug tools are also checkboxes on the briefing screen.** Inside a Claude artifact the query string never reaches the page, so `?debug=1` and `?blackout=180` can't work there. The checkboxes cover phone playtests; the URL options still work locally and on GitHub Pages. Hash tokens work in both: `#debug.blackout-180.seed-7`.
2. **`?seed=N`** makes a game repeatable (visitor choices, animal wandering).
3. **The debug panel starts folded on phones** so it doesn't cover the map. Tap "Debug" to open it.
4. **GitHub Actions tests and builds every push.** It deploys to GitHub Pages only when the repo variable `PAGES_ENABLED` is `true`, so nothing fails before Pages is turned on.
5. **`npm run balance`** prints build-phase revenue for five strategies and the outcome of six fights, using the real rules headlessly. SPEC.md section 13 now shows these measured numbers instead of the first rough estimate.

## Milestones 2 to 5: visitors, troops, blackout, combat, scoring

### Simulation

1. **All game rules live in `src/core` with no Phaser in them**, so they run in unit tests and headless simulations. The scene only draws and handles input.
2. **Fixed 60 Hz simulation step.** Each frame runs as many steps as real time passed, so game speed doesn't depend on frame rate.
3. **Fast-forward when nothing can happen.** During the blackout, once nothing is loose and every predator is secured, time runs 8x until power returns (`BLACKOUT.allClearSpeed`). The spec says you win only after power returns, which otherwise means minutes of waiting.

### Visitors and money

4. **Visitors arrive only once an exhibit exists.** The spawn formula gives 0.10 per second with zero appeal; those visitors would walk in and straight back out.
5. **Visitors follow the paths with a distance map** to each viewing spot and to the gate, and walk in loose lanes so crowds don't single-file.
6. **A visitor always finishes a view and pays.** The time budget is checked between exhibits and on the walk, not mid-view.
7. **No income after the blackout.** Anyone viewing when the power goes out runs without paying.

### Troops

8. **Troops are paid for when queued.** Tapping a queued troop cancels it for a full refund, since a mistap costs up to $4,000.
9. **Group moves spread troops in a grid** (28 px apart), and overlapping troops push apart.
10. **Troops never enter exhibits, even through gaps.** Darts reach over fences, so they don't need to.
11. **Idle troops shoot predators before Triceratops** when both are in range. The spec says nearest dinosaur; shooting a harmless Triceratops while a raptor bites you felt broken.
12. **Troops shoot penned dinosaurs during the blackout** (they're about to escape), but never while the power is on.
13. **Desktop: middle-drag pans**, because left-drag is the selection box.

### Blackout and cascade

14. **Raptor fence damage (20 per second) is dealt as 10 every half second**, so each hit shows up.
15. **Breakouts only target side segments whose outside tile is open.** Corners are skipped, and a side pressed against another pen's fence isn't picked.
16. **Raptor ties on "weakest segment" go to the side nearest a visitor.**
17. **The T. rex sticks with a fence it has started on**, unless a troop darted it or a visitor came within 10 tiles.
18. **The T. rex skips pens that already have a gap** when looking for one to break into; those animals can already get out.
19. **"A dino within 4 tiles" scares Triceratops only if it's a predator.** Otherwise every herd would stampede from its own pen-mates the moment the power went out.
20. **Triceratops only stampede during the blackout, or when loose.** With the power on they graze.
21. **A Triceratops rests 1.5 s after a stampede** before it can start another (`DINO_AI.triRecoverSeconds`). Without it, a scared animal against a fence rams it every frame.
22. **Predators pause after a kill** (raptor 1 s, T. rex 1.5 s). It gives troops a window and reads better than a raptor scything through a crowd. Not in the spec.
23. **A predator with nothing left to chase wanders nearby.** If it never left its own pen, it's contained when power returns.
24. **At power return, a loose animal caught inside another pen is moved just outside it**, so it can't be sealed in where nobody can reach it.
25. **No exhibits after the blackout.** There's no income and new animals would only add danger, so the build bar hides.

### Screen

26. **Warnings fire only when the build phase is longer than 1:00.**
27. **Retry goes back to the briefing** so Quick test and Debug tools can change. Both choices are remembered.
28. **Selection rings are yellow; the target of selected troops gets a red ring;** loose predators get a faint red ring.
29. **Build bar uses short names** ("T. rex") to fit a phone; panels use full names.

## Milestone 1

1. **Phaser 4.2.1.** The latest stable release when this was built. The spec says "latest stable."
2. **Full-screen canvas instead of a letterboxed 1280x720.** Phone screens are wider than 16:9, so a fixed 16:9 game wastes the sides. The canvas fills the screen and renders at the device's pixel density so lines stay sharp.
3. **The HUD is HTML on top of the canvas,** not drawn in Phaser. Text stays crisp, buttons are real buttons, and touch targets are easy to size.
4. **The camera only draws between the top bar and the build bar,** so nothing on the map hides under the HUD. "Zoomed all the way out shows the whole map" is measured against that area.
5. **The map layout is a text grid in `config.ts`** (`.` grass, `R` rock, `W` pond) so maps are easy to edit by hand.
6. **The pond is blue, not gray.** It still blocks building and movement like the rocks.
7. **The ghost snaps inside the map** instead of showing a "too close to the edge" error. The one-tile edge rule is still enforced.
8. **The ghost starts at the nearest open spot** to the middle of the view when you pick an exhibit, so it doesn't open in a red, blocked state.
9. **Viewing spot choice:** the free tile beside the fence that's closest to the path network by walking distance. Ties go to the top side, then bottom, left, right.
10. **Placement is re-checked when you tap Build,** so a stale preview can't build something invalid.
11. **Animals wander inside their pens** so you can tell exhibits apart at a glance.
12. **When a two-finger pinch ends with one finger still down,** that finger keeps panning instead of stopping.
13. **You can pan one tile past the map edge** so exhibits near the edge aren't stuck under the screen edge.

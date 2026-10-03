# Decisions

Calls made where SPEC.md was silent, or where following it literally would have made things worse. Each tuning number mentioned here lives in `src/config.ts`.

## Stars: one per goal

Chosen by Chris: one star for getting every dinosaur back without losing 8 guests, one for the revenue target, one for no guests lost.

45. **The stars no longer stack.** Before, ★★ needed the win and the revenue target, and ★★★ needed both plus nobody killed, so a win with nobody hurt but revenue short got one star. Now it gets two: the revenue and safety stars don't depend on each other. Earlier decisions that say ★★ mean the revenue target, and ★★★ still means all three. `npm run balance` came out identical, because every measured blackout park clears the target.
46. **A loss earns no stars,** even for goals it met. A shut-down or overrun park showing stars would read as a reward. The end screen still marks those goals met and says why their stars stay dark. This part wasn't specified.
47. **The goals are spelled out in three places:** the briefing (the full rules), the pause menu (how each one is going), and the end screen (met or missed, star lit or not). The top bar's revenue caption reads "★ at $20,000".

## Audit follow-up: pause menu, planning numbers, timeline, edge arrows

Chosen by Chris: the four small items from the design audit, before the next playtest.

36. **A pause menu with Resume, Restart, and End game,** from a button at the right end of the top bar (Esc with nothing selected, or P, on a keyboard). It stops the clock like a tip does. Restart goes back to the briefing, like Retry. **End game** ends the game now as a loss ("Game ended early", no stars) and shows the end screen right away, so a lost cause costs one tap instead of up to 8 minutes.
37. **Fast-forward runs at 30x, up from 8x** (`BLACKOUT.allClearSpeed`; this replaces the 8x in Milestones 2 to 5 decision 3). Once every predator is secured, the rest of the blackout passes in about 9 seconds instead of about 35. The power timers stay at 5:00 and 3:00, where the audit suggested 2:00 and 1:30. End game covers long lost games without moving any balance numbers, and `npm run balance` came out identical.
38. **Breakout times come from the rules, not a table** (`src/core/estimates.ts`): the delay, a walk across half the pen at full speed, then the hits the whole pack needs to break one segment. A test checks them against the simulation, within a second for the T. rex and the raptors on chain-link and on concrete. They assume nothing breaks in first, so the screen says "about".
39. **Where the planning numbers show:** the placement panel and the exhibit panel ("Breaks out: 21 s after blackout", before the blackout only), and the Reinforce note says how long concrete holds them. HQ shows each troop's sedation per second and how long the whole team, queue included, takes to sedate a T. rex and a pack of three raptors. The train time left the troop buttons to make room.
40. **The end screen tells what happened.** The world logs the blackout as it goes: the power cut, the first animal out of each exhibit with how many guests were still inside (and which escape started the evacuation), deaths with their cause and the nearest exhibit (and whether a raptor pen close by was unguarded), troop and tower losses (and whether the T. rex caught a troop alone), the park emptying, every predator secured, the power coming back, and what was still loose at the end. Deaths or losses from one cause within 5 s share a line. A long game keeps the first 12 lines, a count of the rest, and the last line.
41. **One "Next time" line,** picked from what went worst, in this order: raptors first out into a full park (no T. rex, or concrete held the T. rex in), deaths by an unguarded raptor pen, raptors out while guests were still inside, a troop the T. rex caught alone, an overrun, then revenue short of ★★. Each is a lesson measured in SPEC section 13 or taught by a tip. A clean game gets no line.
42. **The camera frames the park when the power goes out:** every exhibit plus a tile of margin, never closer than the default zoom, eased over half a second. Any pan or zoom by the player cancels the move.
43. **Edge arrows** point at off-screen loose animals and at fences broken in the last 4 seconds. Animals of one kind within 4 tiles share an arrow with a count. The T. rex comes first, then raptors, breaks, and Triceratops; an arrow that would land on a more urgent one is left out. Arrows step below the banner instead of covering it. Tapping one eases the camera there.
44. **Each key press acts once.** Phaser handles a key as it arrives and again on the next frame, and when several keys arrive within one slow frame it can hand an earlier one over a second time. In the smoke test, Esc opened and closed the menu twice from one press. The scene now ignores an event it has already handled.

## Evacuation: guests stay until the first animal gets out

Chosen by Chris: the park doesn't want to alarm anyone, so it only tells guests to leave once the first animal breaks out. Until then they keep visiting exhibits and paying. This replaces Milestones 2 to 5 decision 7 and Round 2 decisions 1 (the part about paying) and 3. Numbers below are from `SEEDS=16 npm run balance` and the same scripted defenders with the casualty limit lifted.

27. **Visit time stands still while the power is out.** With it running, guests left on their own within about 35 s, and that is what emptied the park before the raptors got out. They still go home once they have seen every exhibit, and the clock runs again when the power returns.
28. **"Breaks out" means the first dinosaur of any kind is loose,** out of its fence. A fence breaking or an animal hitting its fence doesn't start the evacuation. Guests near a break still run, as before.
29. **Evacuating guests walk at 70 px/s** (`VISITORS.evacuateSpeed`), between a stroll (50) and a run (100), because the park is still trying not to alarm them. Anyone who sees danger runs.
30. **Fence hits still don't scare anyone** (Round 2 decision 1 stands). Tried: guests within 6 tiles running when an animal hits its fence. With no defense at all, deaths in the three-raptor park fell from 23 to 32 per game to 3 to 9, which undid the point of the change.
31. **Money earned in the dark is real money.** It counts toward the ★★ target and can be spent on troops: about $1,400 to $2,200 per game in the measured parks.
32. **Raptors break out at 18 s, down from 20.** In a park with a T. rex, its escape at about 14 s starts the evacuation, and the time until the raptors get out is the guests' head start. At 20 s the park was nearly empty by then: in the dense T. rex park every troop defense without concrete lost no visitors in 16 games, and concrete on every pen lost at most 1. At 18 s, concrete on every pen costs at least one visitor in 10 of 16 games (up to 6), concrete on the T. rex alone (with a tower at each raptor pen) costs 3 to 7 in every game, and concrete on the raptor pens alone costs none. At 16 s even the whole bank in troops lost 1 to 4 visitors in almost every game, which would make ★★★ rarer rather than punish a mistake (the same reason as decision 20).
33. **The 1:00 warning tip explains the rule** ("Nobody will tell the guests"), but only when the park has a raptor pen or a T. rex, since Triceratops never break out on their own. It comes before the unguarded-pen tip.
34. **The revenue slot keeps counting in the dark** and switches to "Visitors in park" when the evacuation starts. The banner names the first animal out ("The T. rex is out. The park is evacuating."), so that escape gets no toast of its own. The end screen adds "Earned in the dark" and "First animal out".
35. **What the measurements show.** The first animal out is the alarm. A park without a T. rex has none, so the raptors get out into a full park: there the best scripted defense (concrete plus split troops) survives 11 of 16, about the same as before (13 of 16). The T. rex park's fight got harder: with the guests gone early, 5 massed troops lose all 16 games (they won 15 of 16 before), and it now takes 6 or 7. In those games 3.6 pasture fence segments broke per game, up from 0.4.

## Round 2: making the blackout matter

Chosen by Chris: visitors stay oblivious until danger, shorter visits, a T. rex that locks on and charges, Tranq Towers, and a 5:00 build phase. The calls below fill in the details.

### Visitors

1. **What counts as danger:** a fence breaking within 8 tiles, a loose dinosaur within 5 tiles, or someone killed within 6 tiles (`VISITORS.panic*RadiusTiles`). Until then visitors keep strolling and viewing, but nobody pays after the lights go out.
2. **Anyone who walks out after the blackout counts as safe,** running or strolling. The end screen shows how many were in the park at the blackout and how many got out.
3. **During the blackout the revenue slot in the top bar shows visitors still in the park.** Revenue can't change after the blackout, and the end screen still shows it.
4. **Visits last 35 s, down from 60.** Measured: dense and 3-tile parks barely change; a park spread 7 tiles apart drops from about $27,000 at 40 s to about $15,000 at 35 s, under the $20,000 target.

### T. rex

5. **Lock-on:** it locks onto whoever darted it in the last 5 s within 8 tiles, or onto the nearest troop or tower once there's nothing else to chase. It keeps that target until it dies or gets more than 12 tiles away, ignores darts from others meanwhile, and bites the locked target first when several are in reach.
6. **Charge:** only while locked on, 1.5 to 5 tiles away, with a clear run. A 0.6 s wind-up is the warning (an orange arc fills around it, a line points at the target, "Charge!" floats up). Then it runs straight at double speed for up to 1.2 s, bites the first troop or tower it touches, tramples visitors in its path like a Triceratops stampede, and stops at anything solid. 4 s between charges.
7. **Sedation 800,** the top of the 500 to 800 range. With the lock and charge, 2 Heavy + 2 Tranq win on open grass but lose 2 troops, which was the goal.

### Towers

8. **Towers are placed from the bottom bar** like exhibits (ghost, range circle, Build and Cancel), not from the HQ panel. Placing is the same action, and it's one tap instead of two.
9. **200 HP, 20 sedation every 1.5 s, range 5 tiles.** At 300 HP one tower beat a whole raptor pack alone; at 200 it loses to the pack and two towers win. It cost $3,000 at first; see 19 for the current price.
10. **A tower fills its tile.** Troops and animals path around it, Triceratops stampedes stop at it, and it can't be selected, boxed, or ordered. It doesn't count as a troop anywhere (Select all, troop counts, troops trained or lost).
11. **Towers don't scare Triceratops.** Otherwise a tower beside a pasture would set off a stampede every few seconds for the whole blackout.
12. **A tower right outside a fence still counts as a way out.** Animals break that segment and then knock the tower down, so towers can't wall a pen in. A destroyed tower leaves grass.
13. **Animals reach a tower from the next tile.** Its body radius is half a tile, and a chasing animal only needs a clear line to the spot where it stops, not to the tower's center.

### Darts

14. **Nothing behind its own fence can be darted, by troops or towers** (`COMBAT.dartPennedAnimals`, off). This replaces Milestones 2 to 5 decision 12. Measured with the old rule: one Tranq Squad parked beside a raptor pen secured all three raptors, and in 2 of 3 runs none ever got out. One tower did it in all 3 runs. No escapes means no cascade and nothing to fight. With the new rule the same lone Tranq Squad dies and all three raptors get out.

### Build phase and economy

15. **5:00 build phase, 2:00 quick test.** The revenue target stays $4,000 per minute of build phase, so ★★ is $20,000.
16. **Starting money $25,000, up from $15,000.** At $15,000 and 5:00, no scripted build could afford the T. rex before 3:30, and none reached $20,000. At $25,000 you can open with a T. rex, or two raptor pens and a pasture.

### Screen

17. **On screens narrower than 960 px the build bar drops its icons, the HQ button's label, and the "· 3 left" counts,** so four build buttons fit beside HQ and the selection buttons on a phone (checked at 667, 844, and 932 px wide with iPhone safe areas). The raptor button reads "Raptors", and a maxed-out exhibit reads "None left".

## Tips

Chosen by Chris: teach the two defense lessons in the game, and make the tips skippable.

22. **Tips appear at the moment they apply, not as briefing text.** Five moments: the first raptor pen built, the T. rex paddock built, the 1:00 warning if a raptor pen is unguarded, raptors killing visitors beside an unguarded pen, and the T. rex killing a troop that was on its own. Each shows once per session, so Retry doesn't repeat them.
23. **An open tip pauses the game,** so reading never costs clock time. Orders can still be given while it's paused.
24. **The camera moves the tip's subject into the part of the map the card doesn't cover,** so "this pen" is on screen next to the text.
25. **Three ways to skip:** **Got it** closes one tip, **Hide tips** turns them all off, and the briefing's **Show tips** checkbox turns them back on. The on or off choice is kept in the browser's storage, guarded so the game still works where storage is blocked (then it lasts until the page closes). Quick test and Debug tools still last only for the session.
26. **"Guarded" means a troop within 6 tiles of the pen's center** (`TIPS.guardRadiusTiles`). Towers don't count, because the defense that measured best is troops at each pen. A troop the T. rex kills counts as alone when at most one other troop is within 4 tiles. Troop losses now record which animal did it, so the tip can tell a T. rex kill from a raptor kill.

## Round 2 follow-up: casualty limit and defense prices

Chosen by Chris: make the casualty loss easier to hit, and make defense cost enough that the bank forces a tradeoff. The levers were picked by measurement (`npm run balance`, 16 seeds per defense, two dense parks, two defender styles).

18. **Casualty limit 8, down from 10.** In the three-raptor park, concrete fences plus troops split across the pens survive 13 of 16 games; massing every troop in one spot survives 2 of 16. At 6, even that best defense survived only about half, which would make raptor-heavy parks a trap. A defended T. rex park never lost more than 6 visitors, so the limit only bites where raptors are many.
19. **Troops and towers cost 50% more:** Tranq Squad $2,250, Heavy Team $6,000, Tranq Tower $4,500. Tranq and Heavy keep the same sedation per dollar relative to each other. The cheapest defense that holds the dense T. rex park went from under half its bank to about 61% (5 troops win 15 of 16; 4 lose every time), and the raptor park's working defense takes about 94% of its bank. At 25% more, the T. rex park still needed only about half.
20. **Not chosen:** raptors breaking out at 10 s instead of 20 s. In the T. rex park it raised deaths at every troop count measured (with 10 massed troops, from about 1.3 per game to 2.8), so it would mostly make ★★★ rarer rather than punish careless play. A lower starting money would have reopened the ★★ tuning, since the opening build decides revenue.
21. **The balance script plays two defender styles.** Massed keeps troops together; split posts them at each predator pen. They expose the two lessons: too few troops spread across the pens lose to the T. rex (concrete plus split troops: overrun 9 of 16), and massed troops lose visitors to raptors. `UNCAPPED=1` lifts the casualty limit and prints every game's deaths; `SEEDS=16` steadies the numbers.

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

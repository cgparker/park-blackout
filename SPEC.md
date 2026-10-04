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

**Out of scope:** real art, sound, saving, menus beyond the briefing, the pause menu, and Retry, levels beyond the three in section 3, lethal weapons, fence repair, and Mantah troops.

## 2. Platform and tech

- Phaser (latest stable) with TypeScript and Vite.
- Runs in mobile Safari, landscape only. Show a "rotate your phone" overlay in portrait.
- Logical resolution 1280x720, scaled to fit the screen.
- Lock down browser touch behavior on the game: no page pinch-zoom, no double-tap zoom, no scrolling or pull-to-refresh, no text selection or long-press callouts.
- Mouse support too, for testing on a desktop browser.
- Development: run with `vite --host` so I can open it on my phone over Wi-Fi. Deploy: static build to GitHub Pages.
- Pathfinding: grid A* (a small custom one or EasyStar.js).
- Performance target: 60 fps on a recent iPhone with 80 visitors, 20 troops, and 20 dinosaurs.

## 3. Game flow and levels

There are three levels. Each one teaches one part of the game, and all three are open from the briefing.

| Level | Name | Teaches | The park |
|---|---|---|---|
| 1 | Roundup | Training troops and moving them | Already built, not open yet |
| 2 | Raptor Nest | Fighting | Already built, not open yet |
| 3 | Blackout | Building | You build it |

- The briefing has a level picker. It opens on level 1. Picking a level sets up that level's park behind the briefing. `?level=2` in the address (or `#level-2` in the artifact) opens on that level.
- After a win in level 1 or 2, the end screen offers **Next level** beside **Retry**.

### Level 3: Blackout

1. **Briefing screen:** "Mantah Corp will cut power to the electric fences in 5:00 to steal dinosaur embryos. Build your park, earn money, and train your containment team before the lights go out." Tap to start.
2. **Act 1, Build (5:00):** Place exhibits and towers, earn money from visitors, train troops, and reinforce fences. A large countdown is always visible. A warning banner appears at 1:00 left.
3. **Act 2, Blackout:** Fences lose power and the gates close. Nobody tells the visitors: they keep touring and paying until the first animal gets out, and then the park evacuates. Dinosaurs break out in a cascade. Power returns 5:00 later.
4. **End screen:** Stars and a breakdown of what happened.

### Levels 1 and 2: the park is already built

- The park has a few exhibits and their paths. It hasn't opened, so there are no visitors. The power is on, so fences hold, and animals in their pens stay there.
- Some fences are down: one whole side, corners left standing. Their animals start loose.
- A countdown runs until the park opens. Anything still loose then loses the level.
- Nothing can be built or reinforced. HQ trains only the level's troops, from the level's starting money. There's no income.
- A darted animal fades out as in level 3, then wakes up back in its own pen: the crew carries it home. An animal that walks back into its own pen through the gap stays there too. Both count as back.
- **Win:** every animal is back before the park opens.
- **Lose:** the park opens with an animal loose, or there are no troops left, none in training, and not enough money to train one. Ending the game from the pause menu is a loss too.
- **Stars:** one per goal, and the first star is needed for the other two, as in level 3. Win; spend no more than the level's cap on troops; and the level's third goal.

| | Level 1: Roundup | Level 2: Raptor Nest |
|---|---|---|
| The park | 4 pastures. 3 are open. | 2 pastures and 2 raptor pens. Both pens are open. |
| Loose at the start | 6 Triceratops, scattered near their pastures | 6 raptors, guarding a nest at the east end |
| Clock | 2:30 | 4:00 |
| Starting money | $9,000 | $21,000 |
| HQ trains | Tranq Squads | Tranq Squads and Heavy Teams |
| ★ Spend no more than | $4,500 | $13,500 |
| ★ Third goal | Finish with 1:00 or more left | Lose no troops |

**Level 1.** Triceratops run from troops that come within 4 tiles, and a Tranq Squad's range is 4 tiles, so they run as soon as a squad can dart them (section 8). A Triceratops that runs into rocks, water, a building, a fence, or the edge of the map turns and runs along it. It only stops when it's cornered. Cornering them is the skill.

**Level 2: the nest.** Raptors at a nest wander within 2 tiles of it. They go after the nearest troop within 8 tiles of themselves, as long as that troop is within 10 tiles of the nest. Past that they give up and run back. So they never come for HQ, and a group that pulls back can regroup. Because they wander close together, a troop that comes near brings most of them at once.

## 4. Map

- Grid of 40x24 tiles at 40 px per tile (world size 1600x960). The camera pans and zooms; minimum zoom shows the whole map, maximum zoom is 2x.
- One gate on the left edge, middle row, is both entrance and exit. A 3-tile path stub leads in from it.
- Containment HQ (3x3) is pre-placed near the entrance, just off the path.
- 3 or 4 obstacle clusters (rocks, a pond) block building and movement so layout takes some thought.
- Tile types: grass (buildable, walkable), path (walkable), exhibit (blocked), obstacle (blocked), HQ (blocked).

## 5. Economy

### Money

- Starting money: $25,000. Enough to open with a T. rex, or two raptor pens and a pasture, because the build phase is short.
- Income comes only from visitors paying at exhibits. Park entry is free.
- Revenue target for the revenue star: $4,000 per minute of build phase ($20,000 at 5:00). Revenue means total earned from visitors, including what they pay in the dark before the evacuation, not money left in the bank.
- Visitors keep paying in Act 2 until the park evacuates (section 8). Banked money can still train troops.

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
- Each visitor has a 35-second time budget. Walking and viewing both use it up. It's short on purpose: a visitor who spends it walking between far-apart exhibits pays for fewer of them. It stops running while the power is out (section 8).
- Choosing the next exhibit: highest score among exhibits they haven't visited, where score = appeal / (1 + path distance in tiles / 8), plus a little randomness.
- At an exhibit: stand at the viewing spot for 4 seconds, then pay its price (show a floating "+$25").
- When the budget runs out or every exhibit is visited, walk back to the gate and leave.
- Walk speed 50 px/s, on paths only. Evacuation speed 70 px/s. Flee speed 100 px/s.

This is what makes spacing cost money: a visitor walking between exhibits isn't paying anyone.

## 6. Containment team

### HQ

- Tap HQ to open the training panel. Queue up to 5 units. New units appear next to HQ.

### Units

| | Tranq Squad | Heavy Team | Tranq Tower |
|---|---|---|---|
| Cost | $2,250 | $6,000 | $4,500 |
| Train time | 8 s | 15 s | Built at once, before the blackout only |
| HP | 100 | 250 | 200 |
| Speed | 100 px/s | 70 px/s | Never moves |
| Range | 160 px (4 tiles) | 200 px (5 tiles) | 200 px (5 tiles) |
| Darts | 10 sedation, 1 per second | 50 sedation, 1 per 2 seconds | 20 sedation, 1 per 1.5 seconds |

- Units walk on grass and paths. No healing in the prototype. A unit at 0 HP is lost.
- Idle units automatically fire at the nearest loose dinosaur in range.
- Darts only reach dinosaurs that are out of their own pen. An animal still behind its fence can't be darted, so nothing can be put to sleep before it breaks out.
- A **move** order moves without firing (for retreating and kiting). An **attack** order (tap a dinosaur) chases that target and fires at it.

### Towers

- Build a Tranq Tower from the bottom bar, like an exhibit: tap **Tower**, tap a grass tile, then **Build**. The ghost shows its range.
- A tower fills its tile. Troops and animals go around it. It can't be selected or given orders, and it doesn't scare Triceratops.
- Animals attack towers like troops. The T. rex can lock onto one. A destroyed tower leaves grass behind.
- A tower right outside a pen doesn't seal it: animals break that segment and then knock the tower down.

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
| Tap **Tower** in the bottom bar, then the map | Place a Tranq Tower |
| Tap the pause button (right end of the top bar) | Pause menu: **Resume**, **Restart**, **End game** |
| Tap an arrow at the edge of the map | Look at the off-screen animal or broken fence it points to |

HUD buttons: **Select All Troops** and **Clear Selection**.

### Mouse

Left-click to select, left-drag for a selection box, right-click to move or attack, WASD or arrow keys to pan, scroll wheel to zoom. Esc clears the selection, and with nothing selected it opens the pause menu. P pauses too.

### HUD

- **Top bar:** money, revenue vs. target, the countdown (large, centered), casualties (x/8), and the pause button. In Act 2 the countdown switches to time until power returns, and the bar adds loose and secured dinosaur counts. Revenue keeps counting in the dark. Once the park evacuates, that slot shows how many visitors are still in the park.
- **Top bar in levels 1 and 2:** money, spent vs. the star's cap (red past it), the countdown until the park opens, loose and back counts, and in level 2 troops lost. The bottom bar has no build buttons.
- **Bottom bar:** exhibit and tower buttons (grayed out when unaffordable or at the limit) and selected-unit info.
- **Pause menu:** stops the clock and shows how each star goal is going. **Restart** goes back to the briefing. **End game** ends the game now as a loss and shows the end screen.
- **Planning numbers:** before the blackout, the placement and exhibit panels say when that exhibit's animals break out ("21 s after blackout"), and the Reinforce note says how long concrete holds them. HQ shows each troop's sedation per second and how long the whole team, queue included, takes to sedate a T. rex and a pack of three raptors. In levels 1 and 2 it says how long the team takes to sedate one of the loose animals.
- **When the power goes out** the camera moves to show every exhibit. At the start of levels 1 and 2 it shows HQ and every loose animal.
- **Edge arrows:** in Act 2, and all through levels 1 and 2, arrows at the edge of the map point at loose animals and fresh fence breaks that are off screen, with a count when several animals are together. Tap one to look there.

### Tips

Short tips teach the two defense lessons from section 13: guard each raptor pen, and keep troops together against the T. rex. One more explains the evacuation.

- A tip appears when it's useful, once per session: when you build your first raptor pen, when you build the T. rex paddock, at the 1:00 warning (first how the evacuation works, if the park has an animal that breaks out on its own, then whether a raptor pen has no troops nearby), when raptors kill visitors beside an unguarded pen, and when the T. rex kills a troop that was on its own.
- Level 1 has its own: at the start (how to train a squad), when the first squad is ready (how to send it after a Triceratops), and the first time a troop makes a Triceratops run (come at it from the open side). Level 2: at the start (raptors guard the nest; go in as one group, and pull back if it goes badly), and when raptors kill a troop (a group darts them down first; Heavy Teams last 25 bites).
- The game pauses while a tip is open, and the camera moves to what the tip is about. Orders still work while paused.
- **Got it** closes the tip. **Hide tips** turns tips off. The briefing has a **Show tips** checkbox, and the choice is remembered on that device.

## 8. The blackout

### At 0:00

- Banner: "Mantah Corp has cut the power." The screen dims, and fences turn from cyan to gray.
- Gates close. No new visitors arrive.
- Nobody tells the visitors. They keep touring and paying, and their visit time stands still. They still go home once they have seen every exhibit.
- **Evacuation:** when the first animal gets out, the park sends everyone to the gate. Banner: "Raptors are out. The park is evacuating." (or "The T. rex is out."). Visitors stop touring, nobody pays after that, and they walk out at 70 px/s.
- Anyone who sees danger runs for the gate at flee speed, before or after the evacuation: a fence breaking within 8 tiles, a loose dinosaur within 5 tiles, or someone killed within 6 tiles. Anyone who walks out, running or not, is safe.
- So whatever gets out first meets a full park. With a T. rex in the park, its escape usually starts the evacuation, and the time until the raptors get out is the visitors' head start.

### Breakouts

Not every dinosaur escapes. Each type follows its own rule, and the cascade comes from the player's layout.

- **T. rex:** After 10 s, attacks the segment of its fence closest to the nearest visitor or other exhibit. Chain-link breaks in 3 hits; concrete in 8.
- **Raptors:** After 18 s, every raptor in a pen attacks that pen's weakest segment together.
- **Triceratops:** Never attack their own fence. They only get out if something else breaks it, or if they stampede through a damaged segment.

When a segment reaches 0 HP, it becomes a gap. Animals can leave through gaps.

### Dinosaur stats

| | Triceratops | Raptor | T. rex |
|---|---|---|---|
| Sedation | 120 | 60 | 800 |
| Speed | 120 px/s (stampeding) | 160 px/s | 90 px/s (180 charging) |
| Damage to troops | None | 10 per second | 50 per bite, 1 bite per 1.5 s |
| Fence damage | 40 per collision while stampeding | 20 per second | 80 per hit, 1 hit per 1.5 s |

### Loose dinosaur behavior

- **T. rex** target priority: (1) the troop or tower it is locked onto, until that one dies or gets more than 12 tiles away; (2) whoever darted it in the last 5 s, within 8 tiles, and it locks on; (3) the nearest visitor within 10 tiles; (4) the nearest exhibit with animals still inside, which it walks to and breaks into; (5) the nearest visitor anywhere, then the nearest troop or tower, and it locks on.
- **T. rex charge:** when it is locked on, 1.5 to 5 tiles away, with a clear run, it stops and winds up for 0.6 s (an orange arc fills around it and a line points at its target). Then it runs straight at double speed for up to 1.2 s. It bites the first troop or tower it hits, tramples visitors in its way, and stops at anything solid. It can charge again 4 s later. Troops that move during the wind-up can get out of the way.
- **Raptors:** Hunt the nearest visitor or unit within 8 tiles. Otherwise head for the nearest visitor anywhere, and if there are none, the nearest unit.
- **Triceratops:** If a dinosaur or unit is within 4 tiles, stampede directly away for 5 s, trampling anything in the way. Otherwise, graze in place. A stampede that hits a fence deals 40 damage to that segment and stops. Triceratops still inside their pen can stampede too, so a T. rex outside their fence can scare them into breaking it from the inside.
- **Going around things:** a stampede that meets rock, water, HQ, a tower, the edge of the map, or a fence while the power is on turns along it, in 30 degree steps toward the side with more room. It never turns more than 90 degrees from straight away, so in a corner, or against a second wall, it stops.
- A visitor touched by a raptor or T. rex for 0.5 s, or hit by a stampeding Triceratops, is a casualty.
- Dinosaurs ignore HQ and paths. They only damage fences, troops, and visitors.

### Sedation and securing

- Darts reduce sedation. It doesn't regenerate. At 0, the dinosaur is secured: it fades out over 2 s and counts toward Secured.
- Only dinosaurs out of their own pen can be darted (section 6).

### Power returns

- 5:00 after the blackout, power returns. Any animal inside its exhibit's footprint is contained, and that exhibit's gaps are sealed.
- Loose dinosaurs still have to be secured.

## 9. Winning and losing

This section is level 3. Levels 1 and 2 are in section 3.

- **Lose:** 8 casualties at any point ("The park has been shut down"), or any dinosaur still loose 3:00 after power returns ("The park is overrun"). Ending the game from the pause menu also counts as a loss ("Game ended early").
- **Win:** Power has returned and no dinosaurs are loose.

### Stars

One star for each goal. You need the first star to earn the other two, so a loss earns no stars.

- ⭐ **Get every dinosaur back:** win. No dinosaur loose 3:00 after the power returns, and fewer than 8 guests killed.
- ⭐ **Earn the revenue target:** $4,000 per minute of build phase ($20,000 at 5:00), counting what guests pay in the dark.
- ⭐ **Keep every guest alive.**

The briefing lists the three goals, the pause menu shows how each one is going, and the end screen marks each one met or missed, with its star lit only when earned.

### End screen

- Stars and result, then the three goals, each marked met or missed with its star lit when earned. A loss that met a goal says why its star stays dark.
- **Next time:** one thing to do differently, picked from what went worst (raptors first out into a full park, deaths by an unguarded raptor pen, raptors out while guests were still inside, a troop the T. rex caught alone, an overrun, or revenue short of its star). None after a clean game.
- **What happened:** a short timeline of the blackout. The power cut, the first animal out of each exhibit with the guests still inside, the evacuation, deaths with their cause and place, troops and towers lost, the park emptying, the power coming back, and anything still loose at the end.
- Revenue by exhibit (visits and dollars).
- Spending: exhibits, paths, reinforcement, troops, towers.
- Visitors in the park at the blackout, money earned in the dark, the first animal out, and how many visitors got out.
- Casualties by cause (raptor, T. rex, stampede).
- Troops and towers lost, and dinosaurs secured vs. contained.
- Retry button, and after a win in level 1 or 2, **Next level**.

In levels 1 and 2 the end screen has the same stars, goals, Next time line, and timeline (what was loose, each animal back with how many were left, troops lost, and the end). Its numbers are troop spending against the cap, animals darted, any that walked back on their own, any still loose, troops trained and lost, and the time left.

## 10. Placeholder visuals

- Grass dark green, paths tan, obstacles gray.
- Fences: cyan when powered, gray when unpowered, thicker and white when reinforced. They darken as HP drops; a gap is a missing segment.
- Visitors: small white dots. A casualty leaves a small red mark.
- Tranq Squad: small blue circle. Heavy Team: larger blue square. Selected units get a yellow ring.
- Tranq Tower: navy square on its tile with a blue turret that turns to aim.
- Triceratops: green oval. Raptor: small orange triangle pointing where it's moving. T. rex: large red circle with a notch showing its facing.
- A sedation bar appears over a dinosaur once it's hit, and an HP bar over a unit once it's damaged.
- The T. rex's locked-on target gets an orange ring. Before a charge, an orange arc fills around the T. rex and "Charge!" floats up; while charging it has an orange ring and streak.
- Level 2's nest: a brown disc ringed with twigs, with three pale eggs.

### 3D slice (levels 1 and 2)

A test build, `slice.html`, draws levels 1 and 2 in real 3D with three.js, to try the look and the frame rate on phones. The rules, HUD, and controls are the same game; only the drawing changes. Level 3 stays 2D for now.

- Camera: looks down at 56 degrees from the south. Drag pans, pinch or the wheel zooms, and it never shows past the ground around the park.
- The park: textured ground, paths, a pond, trees and plants (thick at the edges, thin in the middle), viewing decks, lamps, and the gate. Tree tops fade where they would hide a troop or an animal.
- Pens: pastures are meadow, raptor pens are dirt, and the T. rex paddock is jungle.
- Fences: standard is galvanised chain-link with live wires; reinforced is a concrete wall with steel bars and, for raptors and the T. rex, razor wire. Each segment looks intact, dented, badly damaged, or wrecked by its HP, and a wrecked one leaves debris.
- HQ: a two-storey security block with a glass control room and radar, a SECURITY sign, a shield on the roof, a flag, floodlights, and a patrol car.
- Tranq Tower: a steel watchtower with an armoured deck above head height and a twin-barrel dart turret.
- Tranq Squad: regular troops in fatigues and blue berets with dart carbines. Heavy Team: mostly white power armour with blue accents and a heavy dart cannon.
- Dinosaurs: animated models with patterned skin. At night their eyes catch the light faintly.
- Night: a test switch turns on the blackout lighting (moonlight, flashlights, floodlights, searchlights) without changing the rules.
- Assets: Quaternius models (CC0) and textures generated for the project. `public3d/LICENSES.md` lists them.

## 11. Debug tools

Enabled with `?debug=1` in the URL:

- Game speed: 1x, 2x, 4x.
- **Blackout Now** button.
- **+$10,000** button.
- Show fence HP numbers, the tile grid, and FPS.

URL overrides: `?blackout=120` sets the build phase to 2:00 for quick playtests, and the revenue target scales with it. `?level=2` opens the briefing on that level.

## 12. Milestones

Each milestone ends with something playable on my phone.

1. **Map and building:** grid, camera, exhibit placement with ghost preview and auto-paths, money.
2. **Visitors and economy:** spawning, path walking, pay-per-exhibit, time budget, HUD with countdown and revenue.
3. **Containment team:** HQ training, selection, move and attack orders, touch controls.
4. **Blackout and cascade:** fences lose power, breakout rules, fence HP, fleeing visitors, loose dinosaur behavior.
5. **Combat and scoring:** darts, dinosaur attacks, casualties, securing, win and lose, stars, end screen.
6. **Tuning tools:** debug options, URL overrides, deploy to GitHub Pages.

After the six milestones, a second round made the blackout matter more: visitors who don't notice the blackout, a T. rex that locks on and charges, Tranq Towers, and a 5:00 build phase. Later rounds added the evacuation, the pause menu and end-screen story, one star per goal, and levels 1 and 2 in front of the blackout. DECISIONS.md lists the calls made along the way.

## 13. Balance (measured)

`npm run balance` plays these headlessly with the real rules. Each exhibit goes in the open spot closest to the gate that keeps the stated gap, and building stops at 70% of the build phase (3:30). These are starting points for playtests, not truth.

Build phase (5:00, revenue star at $20,000, 3 seeds each):

| Strategy | Revenue | Revenue star? | Left for defense |
|---|---|---|---|
| Dense: 2 raptor pens, T. rex, 2 pastures | ~$36,500 | Yes | ~$30,500 |
| Dense: 3 raptor pens, 3 pastures | ~$27,800 | Yes | ~$24,200 |
| Medium spacing (3 tiles apart), same as the first row | ~$32,000 | Yes | ~$26,000 |
| Spread out (7 tiles apart), same as the first row | ~$15,300 | No | ~$11,800 |
| Herbivores only | ~$12,600 | No | ~$5,000 |

The visit length decides how much spacing costs. At 40 s the spread park still earned about $27,000; at 35 s it drops to about $15,000 while dense and medium parks barely change. The starting money went from $15,000 to $25,000 with the shorter build phase: at $15,000 no scripted build could afford the T. rex before 3:30, and none reached $20,000.

Whole blackouts (16 seeds each, `SEEDS=16 npm run balance`). The bank is spent at 3:30 and troops alternate Heavy and Tranq. Two defender styles: **massed** keeps every troop together and sends them all at the nearest loose predator; **split** posts troops at the predator pens' viewing spots, raptor pens first, and each one fights whatever comes near it. About 52 visitors are in the park when the power goes out. Nobody leaves until the first animal gets out, and the guests pay the park about $1,400 to $2,200 in the dark.

Dense T. rex park (about $30,500 to spend). The T. rex gets out first, at about 14 s, and that starts the evacuation. The raptors follow at about 21 s, or about 28 s behind concrete.

| Defense | Spent | Result |
|---|---|---|
| Nothing | $0 | Overrun 16 of 16 |
| 5 troops, massed | $18,750 (58%) | Overrun 16 of 16 |
| 6 troops, massed | $21,000 (65%) | Won 15 of 16 |
| 7 troops, massed | $23,250 (72%) | Won 16 of 16 |
| Whole bank, massed (10 troops) | $30,000 | Won 16 of 16 |
| Whole bank, split (10 troops) | $30,000 | Won 16 of 16 |
| Concrete on every pen, rest split (8 troops) | $28,350 | Won 4, overrun 12 |
| Concrete on the raptor pens only, rest split (10 troops) | $29,850 | Won 16 of 16, all ★★★ |
| 2 towers, rest massed (7 troops) | $28,500 | Won 16 of 16 |

Visitor deaths: none in 16 games with concrete on the raptor pens only, and at most 3 (usually none) with any other troop defense. With concrete on every pen, 10 of 16 games lose at least one visitor, up to 6: the T. rex gets out at about 22 s instead of 14, so the raptors meet a fuller park.

Dense three-raptor park (about $24,200 to spend). With no T. rex, the raptors are the first out, at about 21 s (about 28 s behind concrete), into a full park.

| Defense | Spent | Result |
|---|---|---|
| Nothing | $0 | Shut down 16 of 16 |
| 5 troops, massed | $18,750 (73%) | Shut down 14, won 2 |
| 6 troops, massed | $21,000 (82%) | Shut down 14, won 2 |
| Whole bank, massed (7 troops) | $23,250 | Shut down 16 of 16 |
| Whole bank, split (7 troops) | $23,250 | Shut down 14, won 2 |
| Concrete, rest split (6 troops) | $22,650 | Won 11, shut down 5 |
| 2 towers, rest massed (5 troops) | $24,000 | Shut down 15, won 1 |

About 6 visitors die with concrete and split troops, and 8 or more with everything else.

Fights on open grass (troops and towers in a block, dinosaurs released 6 tiles away, 5 seeds each):

| Fight | Result |
|---|---|
| Raptor pack vs 2 Tranq Squads | Raptors win |
| Raptor pack vs 3 Tranq Squads | Troops win, lose 1 |
| Raptor pack vs 2 Heavy Teams | Troops win, no losses |
| Raptor pack vs 1 Tranq Tower | Raptors win |
| Raptor pack vs 2 Tranq Towers | Towers win, no losses |
| T. rex vs 2 Heavy + 2 Tranq | Troops win, lose 2 |
| T. rex vs 3 Heavy Teams | Troops win, lose 1 |
| T. rex vs 4 Heavy Teams | Troops win, no losses |
| T. rex vs 2 Towers + 2 Heavy Teams | Troops win, lose 1 |

Levels 1 and 2 (16 seeds each). The scripted players give orders twice a second, which is much faster than anyone taps, so these are best cases.

Level 1, 2:30 on the clock and $9,000. Stars at $4,500 or less and 1:00 or more left. **Split:** each squad goes after the nearest Triceratops no other squad is on. **Massed:** every squad goes after the same one.

| Squads | Cost | Split: time left | Massed: time left | Stars |
|---|---|---|---|---|
| 1 | $2,250 | 0:04 to 1:06 | 0:01 to 0:47 | Split loses 3 of 16 to the clock; massed wins all 16. Mostly ★★ |
| 2 | $4,500 | 0:49 to 1:26 | 0:41 to 1:17 | ★★★ in 12 of 16 split, 7 of 16 massed, ★★ in the rest |
| 3 | $6,750 | 1:18 to 1:35 | 0:55 to 1:25 | ★★ (over the cap), ★ in 3 massed games |
| 4 | $9,000 | 1:22 to 1:38 | 1:04 to 1:29 | ★★ (over the cap) |

Since stampedes turn along whatever they meet, a Triceratops only stops in a corner, and chasing it takes longer. A third squad saves about 15 to 30 seconds and a fourth little more, because HQ trains one at a time and the later ones arrive late. A Heavy Team would catch a Triceratops in about 11 s without making it run once, since it darts from outside the 4 tiles that set one off. That's why level 1 has none.

Level 2, 4:00 on the clock and $21,000. Stars at $13,500 or less and no troops lost. **Massed:** every troop waits outside the nest's reach until all are trained, then they go in together. **Trickle:** each troop goes in as soon as it's ready.

| Troops | Cost | Massed | Trickle |
|---|---|---|---|
| 4 Tranq Squads | $9,000 | Won 4 of 16, lost 3.6 | Lost all 16 |
| 5 Tranq Squads | $11,250 | Won 16 of 16, lost 2.0 | Lost all 16 |
| 6 Tranq Squads | $13,500 | Won 16 of 16, lost 0.9 | Lost all 16 |
| 2 Heavy Teams | $12,000 | Won 16 of 16, lost 0.4 (no losses in 9) | Lost all 16 |
| 3 Heavy Teams | $18,000 | Won 16 of 16, no losses | Won 16 of 16, lost 2.0 |
| 1 Heavy + 3 Tranq | $12,750 | Won 16 of 16, lost 1.4 | Lost all 16 |
| 1 Heavy + 4 Tranq | $15,000 | Won 16 of 16, lost 0.6 | Won 2 of 16 |
| 2 Heavy + 2 Tranq | $16,500 | Won 16 of 16, lost 0.6 | Won 15 of 16, lost 1.9 |

`npm run stress` plays 40 random blackout games: 2 wins, 13 overruns, 25 shutdowns. Careless play loses. It also plays 20 random games of each new level: level 1 is won twice in 20 (random orders rarely corner anything in time), and level 2 is won 14 times in 20, because random buying spends the whole $21,000 and random attack orders send most troops at the nest together.

What to watch in playtests:

- Each park punishes a different mistake. The T. rex park loses to too few troops, or troops spread thin: the T. rex picks off small groups, so concrete on every pen plus split troops gets overrun 12 of 16. The raptor park loses to visitor deaths unless its fences are reinforced and troops guard each pen.
- The first animal out is the alarm. In a park with a T. rex, its escape usually starts the evacuation, so concrete on its fence keeps guests in the park longer, and concrete on the raptor pens alone gives them the longest head start. A park without a T. rex has no early alarm. If raptor-only parks feel like a trap, the levers are the raptor breakout delay, the evacuation speed (`VISITORS.evacuateSpeed`), and the casualty limit.
- In these runs the raptor park has one defense that mostly works (concrete plus split troops, 11 of 16). A player can do better than the scripted defender (towers on the paths, troops bought earlier), but if it plays like a puzzle with one answer, the levers are the casualty limit (`SCORING.casualtyLimit`) and the raptor breakout delay.
- The casualty limit is 8. A defended T. rex park never lost more than 6 visitors, so the limit bites where raptors are many. At 6, concrete plus split troops would survive only 8 of 16 raptor park runs. `UNCAPPED=1 npm run balance` prints every game's deaths, to judge another limit.
- The cheapest defense that holds the T. rex park is 6 or 7 massed troops, 65 to 72% of what that park leaves. Before the evacuation rule it was 5 troops (58%): they won 15 of 16 then and lose all 16 now. In those games 3.6 pasture fence segments broke per game, up from 0.4. With the guests gone early, the T. rex more often finds nobody nearby and heads for the nearest exhibit with animals inside (section 8), so more animals get loose. Extra troops, towers, or concrete for ★★★ take most of the rest.
- The T. rex is slower than a running visitor (90 vs 100 px/s), so it mostly kills troops, towers, and anyone who walks toward it. Its charges and lock-on make it the fight that costs troops.
- The jump from 5 to 7 troops is the difference between losing and winning the dense park. The dense park leaves about $30,000, so a careful player can afford plenty. If that feels too safe, raise exhibit prices or the T. rex's sedation, or lower the starting money.
- Towers are bait and backup, not a defense on their own. A tower beside a pen draws the first attack and buys troops a few seconds.
- One tower can just beat a raptor pack when it sits beside their pen on the far side from where they break out: they run around the pen under fire, and the tower finished with 30 of 200 HP. On open grass one tower loses. Watch for players parking one tower per pen.
- Building extra cheap pastures can lower revenue, because visitors spend their short visits on $10 exhibits. That's intended, and the end screen shows revenue per exhibit.
- Level 1's clock is the lever for how hard it feels. At 2:30 one squad sometimes runs out of time even in the scripted runs, and two usually earn three stars. A person tapping orders is much slower, so two or three squads should be the norm. If it's too hard, try 3:00; if it's too easy, 2:00. The time star needs 1:00 left either way.
- Level 2 is easy to win once troops go in together, and the stars carry the challenge. If it feels too easy, lower the starting money: at $15,000, five Tranq Squads or two Heavy Teams still fit, with less room to recover from a bad first fight.

## 14. Later, not now

- Mantah mercenaries raiding a genetics lab as a second objective.
- A nest that hatches more raptors the longer it's left (level 2's nest holds six that never grow).
- Freestanding walls, fence repair, more units (jeep, helicopter), and a lethal option with a cost.
- More levels with different maps, exhibit limits, and timers. Saving which levels are done, and their stars.
- Real art (for example, PixelLab sprites) and sound.
- Rename Mantah Corp before sharing publicly. It's the villain company from Camp Cretaceous.

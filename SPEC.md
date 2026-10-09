# Park Blackout: Prototype Spec

Working title. A single-player RTS for phones. Build a dinosaur park, earn money from exhibits, and train a containment team before a rival company cuts power to the electric fences. Then contain the cascade.

## Instructions for Claude Code

- Build in the milestone order in section 12. Stop after each milestone so I can test it on my phone before you continue.
- Every number in this spec goes in one file, `src/config.ts`. No tuning values hard-coded anywhere else.
- The game players play is the 3D build (section 10). It uses CC0 models, generated textures, and CC0 or made-here sound, each listed in `public3d/LICENSES.md`. The 2D build is a staging ground for mechanics, with placeholder shapes only and no sound.
- If something is ambiguous, pick the simplest option that matches the intent and log it in `DECISIONS.md`. Don't add features that aren't in this spec.

## 1. What this prototype tests

1. Does the build phase feel tense, knowing the blackout is coming?
2. Does the cascade feel dramatic and fair ("I should have spaced those pens out") rather than random?
3. Do I want to replay it with a different build order?

**Out of scope:** real art, saving, menus beyond the briefing, the pause menu, and Retry, levels beyond the five in section 3, lethal weapons, fence repair, and Mantah troops.

## 2. Platform and tech

- TypeScript and Vite. The game players play draws the park in 3D with three.js (section 10). A 2D build in Phaser (latest stable) shares its rules and HUD, as a staging ground for working out mechanics.
- Runs in mobile Safari, landscape only. Show a "rotate your phone" overlay in portrait.
- Logical resolution 1280x720, scaled to fit the screen.
- Lock down browser touch behavior on the game: no page pinch-zoom, no double-tap zoom, no scrolling or pull-to-refresh, no text selection or long-press callouts.
- Mouse support too, for testing on a desktop browser.
- Development: run with `vite --host` so I can open it on my phone over Wi-Fi. Deploy: the 3D build, as a static site on GitHub Pages.
- Pathfinding: grid A* (a small custom one or EasyStar.js).
- Performance target: 60 fps on a recent iPhone with 80 visitors, 20 troops, and 20 dinosaurs, measured with the frame-rate cap off. Phones play capped at 30 fps (section 10), and the headroom keeps 30 steady in the busiest moments.

## 3. Game flow and levels

There are five levels. Each one teaches one part of the game, and all five are open from the briefing.

| Level | Name | Teaches | The park |
|---|---|---|---|
| 1 | Roundup | Training troops and moving them | Already built, not open yet |
| 2 | Raptor Nest | Fighting | Already built, not open yet |
| 3 | Blackout | Building | You build it |
| 4 | Grid Down | Stealth: an Engineer gets the power back on without being seen | Built, right after the blackout, still dark |
| 5 | Showdown | Making do: a fixed team and a 4x4 | Already built, not open yet |

- The briefing has a level picker. It opens on level 1. Picking a level sets up that level's park behind the briefing. `?level=2` in the address (or `#level-2` in the artifact) opens on that level.
- After a win in levels 1 to 4, the end screen offers **Next level** beside **Retry**.

### Level 3: Blackout

1. **Briefing screen:** "Mantah Corp will cut power to the electric fences in 5:00 to steal dinosaur embryos. Build your park, earn money, and train your containment team before the lights go out." Tap to start.
2. **Act 1, Build (5:00):** Place exhibits and towers, earn money from visitors, train troops, and reinforce fences. A large countdown is always visible. A warning banner appears at 1:00 left.
3. **Act 2, Blackout:** Fences lose power and the gates close. Nobody tells the visitors: they keep touring and paying until the first animal gets out, and then the park evacuates. Dinosaurs break out in a cascade. Power returns 5:00 later.
4. **End screen:** Stars and a breakdown of what happened.

### Levels 1, 2, 4, and 5: the park is already built

- The park has a few exhibits and their paths. It isn't open, so there are no visitors.
- Some fences are down: one whole side, corners left standing. Their animals start loose.
- A countdown runs: until the park opens, or until dawn in level 4. Anything still loose then loses the level (in level 4, the power still out).
- Nothing can be built or reinforced. HQ trains only the level's troops, from the level's starting money. There's no income. Levels 4 and 5 train nothing: their teams are fixed.
- **Stars:** one per goal, and the first star is needed for the other two, as in level 3. The first goal is the win. The other two depend on the level.
- Ending the game from the pause menu is a loss, as in level 3.

| | Level 1: Roundup | Level 2: Raptor Nest | Level 4: Grid Down | Level 5: Showdown |
|---|---|---|---|---|
| The park | 4 pastures. 3 are open. | 2 pastures and 2 raptor pens. Both pens are open. | 2 raptor pens, the T. rex paddock, 2 pastures, and 3 broken substations. Most pens have no power. | The same park. Some pens have power, and the east raptor pen is a cage. |
| Loose at the start | 6 Triceratops, scattered near their pastures | 6 raptors, guarding a nest at the east end | 3 raptors on patrol | The T. rex, breaking into the cage that holds 3 raptors |
| Clock | 2:30 | 4:00 | 3:30 until dawn | 3:00 |
| Starting money | $9,000 | $21,000 | None | None |
| Troops | HQ trains Tranq Squads | HQ trains Tranq Squads and Heavy Teams | 1 Engineer, 1 Tranq Squad, and a Patrol 4x4. HQ trains nothing. | 2 Heavy Teams, 2 Tranq Squads, and a Patrol 4x4. HQ trains nothing. |
| ★ Second goal | Spend $4,500 or less | Spend $13,500 or less | Lose no troops | Lose no troops |
| ★ Third goal | Finish with 1:00 or more left | Lose no troops | Never spotted: no raptor notices the Engineer | No animal killed |

### Levels 1 and 2

- The power is on, so fences hold, and animals in their pens stay there.
- A darted animal fades out as in level 3, then wakes up back in its own pen: the crew carries it home. An animal that walks back into its own pen through the gap stays there too. Both count as back.
- **Win:** every animal is back before the park opens.
- **Lose:** the park opens with an animal loose, or there are no troops left, none in training, and not enough money to train one.

**Level 1.** Triceratops run from troops that come within 4 tiles, and a Tranq Squad's range is 4 tiles, so they run as soon as a squad can dart them (section 8). A Triceratops that runs into rocks, water, a building, a fence, or the edge of the map turns and runs along it. It only stops when it's cornered. Cornering them is the skill.

**Level 2: the nest.** Raptors at a nest wander within 2 tiles of it, and see and hunt like every raptor (section 8): each watches a cone in front of it, takes a moment to make out a troop, and calls the rest when it does, and together they circle the troop before they strike. One darted from where no cone reaches comes alone, unless another raptor sees it hit. On the hunt they follow their prey until they lose sight of it for 4 s, then go back to the nest. So they never come for HQ, a group that gets out of sight can regroup, and the nest can be cleared by going in together or by picking raptors off from behind.

### Level 4: Grid Down

Right after the blackout. It's night, the guests are gone, and the power is still out: Mantah Corp wrecked the park's three substations on the way out. Three raptors from the east pen are on patrol. The team is one Engineer, one Tranq Squad, and the Patrol 4x4, and HQ trains nothing.

- **Substations.** Each one powers the pens around it, and a cable on the ground runs from it to each of them. The Engineer fixes a substation by standing beside it (section 6): 20 s of work. Work done stays done if the Engineer walks away.
- **A fixed substation powers its pens,** as when the power comes back in level 3: animals inside are contained, and the gaps seal. Animals already out stay loose.
- **Pens without power:** their animals go for the fence at a set time, which the pen's panel shows ("Breaks out in 0:48").
- **Raptors on patrol** (section 8): each walks its own route, starting somewhere along it and going either way round, and stops at each turn to look around. The routes are loose, so they can't be learned by heart: a raptor looks around for longer or shorter, sometimes stops partway along, wanders a few tiles off to sniff, or turns back. Each sees a cone ahead of it, drawn on the ground, and rock, pens, HQ, and substations block its view.
- **Noticing:** a raptor takes 0.8 s to make out a troop in its cone. It stops, and its cone turns orange while a ring fills around it. If the troop is still in sight when the ring is full, the raptor comes for it and calls the others. A troop that walks right into a raptor is noticed at once.
- **Darts:** a raptor that sees who darts it calls the others. One darted from out of its cone comes for the shooter alone.
- **The 4x4 is loud** (section 6): while it drives, calm raptors within 6 tiles hear it, through anything, and come to look where they heard it. Parked, it's quiet. It gets the Engineer across the park fast, or draws raptors off, but a raptor that comes to look can find the Engineer, and one that sees the 4x4 hunts it and calls the others.
- **Win:** every substation fixed before dawn. Loose raptors can stay loose.
- **Lose:** dawn comes first, or the Engineer is lost. Losing the Tranq Squad doesn't end the level.
- **Stars:** win; lose no troops; never spotted (no raptor ever notices the Engineer, even for a moment).

| Pen | At the start | Powered by |
|---|---|---|
| West raptor pen | 3 raptors inside. They go for the fence at 1:00. | West substation, beside HQ |
| Northwest pasture | 2 Triceratops inside | West substation |
| T. rex paddock | The T. rex inside, its south fence dented to 80 HP. It goes for the fence at 1:50. | North substation |
| East raptor pen | Open. Its 3 raptors are on patrol. | South substation |
| South pasture | 2 Triceratops inside, with power of its own | |

| Raptor | Route |
|---|---|
| South | Round and round the south substation, a tile out from where the Engineer stands, stopping at each corner |
| North | A loop: up the east path, past the west side of the north substation a tile out, along the top, a look at its east side, and down the east edge |
| Middle | A loop between the T. rex paddock and the south pasture, across the ways east from the west substation |

The west substation is safe, beside HQ. The middle raptor crosses the ways east, so getting to the other two takes timing. The north one has no quiet side: the north raptor watches each side in turn, and the east edge, so the Engineer works in the gaps and keeps the block between them when the raptor comes round. The south one has no quiet side either: the raptor circles it, so the Engineer keeps the block between them and moves around it as the raptor does. With loose routes, the gaps come at different times every night. The Tranq Squad can draw the raptors away and be lost, or dart one from behind, out of its cone, and fight it alone. The 4x4 can carry the Engineer most of the way, or the squad can drive it round to lure the raptors off.

### Level 5: Showdown

The park is closed for repairs after the blackout, and some fences still have no power. The crew caged the three raptors from the night in the east pen, which has no power yet, and the T. rex is out and going for them.

- **A fixed team:** 2 Heavy Teams, 2 Tranq Squads, and a Patrol 4x4 start beside HQ (section 6). HQ trains nothing, and there is no money.
- **The cage:** the east raptor pen's fence has 1,500 HP a segment and is drawn as concrete. Left alone, the T. rex breaks in at about 0:30, and nothing counts down to it: the time is for getting to know the 4x4 and getting into place. While it's at the cage it has eyes only for the raptors inside. It pays troops no mind, idle troops hold fire at it, and a dart makes its next hit smash straight through, so darting it only starts the fight sooner.
- **The fight** (section 8): once the T. rex is in, the raptors come out and fight it. Animals hurt each other, and an animal at 0 health is killed. Left alone, the T. rex kills the first raptor about 9 s after it gets in, and another every 12 s after.
- **The fight spreads.** While it fights, the T. rex keeps pushing slowly toward the nearest pen without power that still has animals inside, and breaks in. Raptors there come out and join the fight, and Triceratops stampede out.
- **Whoever you dart turns on you.** A darted raptor leaves the fight and goes after the troop that darted it until it loses sight of it, then goes back. A darted T. rex locks on as usual (section 8): it roars at the troop for 2 s, then goes after it, and the raptors follow it, still biting. While two or more raptors are on it, though, the T. rex is too busy to lock on.
- Pens with power hold, as in levels 1 and 2. Animals in pens without power never go for their fences on their own.
- A darted animal is secured and taken away, as in level 3.
- **Win:** nothing loose: every fighter, and anything the fight let out, is darted.
- **Lose:** 3 animals killed; or no troop left that can dart; or the park opens with an animal loose.
- **Stars:** win; lose no troops; no animal killed.

| Pen | At the start |
|---|---|
| West raptor pen | 3 raptors inside, no power |
| Northwest pasture | 2 Triceratops inside, powered |
| T. rex paddock | Open and empty: the T. rex is out, at the cage |
| East raptor pen | The cage: 3 raptors inside, no power, 1,500 HP a segment |
| South pasture | 2 Triceratops inside, powered |

The cage is about 27 tiles from HQ. On foot, a Heavy Team takes about 13 s to get in range of the T. rex there; the 4x4 takes about 4 s. Left alone, the T. rex gets in at about 0:30 and kills raptors at about 0:39, 0:51, and 1:03, which loses the level just as the fight reaches the west raptor pen.

## 4. Map

- Grid of 40x24 tiles at 40 px per tile (world size 1600x960). The camera pans and zooms; minimum zoom shows the whole map, maximum zoom is 2x.
- One gate on the left edge, middle row, is both entrance and exit. A 3-tile path stub leads in from it.
- Containment HQ (3x3) is pre-placed near the entrance, just off the path.
- 3 or 4 obstacle clusters (rocks, a pond) block building and movement so layout takes some thought.
- Tile types: grass (buildable, walkable), path (walkable), exhibit (blocked), obstacle (blocked), HQ (blocked). Level 4 adds substations: 2x2 tiles, blocked.

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

| | Tranq Squad | Heavy Team | Tranq Tower | Engineer | Patrol 4x4 |
|---|---|---|---|---|---|
| Cost | $2,250 | $6,000 | $4,500 | $3,000 | Levels 4 and 5 only, not for sale |
| Train time | 8 s | 15 s | Built at once, before the blackout only | 8 s | |
| HP | 100 | 250 | 200 | 60 | 400 |
| Speed | 100 px/s | 70 px/s | Never moves | 100 px/s | 210 px/s |
| Range | 160 px (4 tiles) | 200 px (5 tiles) | 200 px (5 tiles) | Can't dart | Can't dart |
| Darts | 10 sedation, 1 per second | 50 sedation, 1 per 2 seconds | 20 sedation, 1 per 1.5 seconds | | |

- Units walk on grass and paths. No healing in the prototype. A unit at 0 HP is lost.
- Idle units automatically fire at the nearest loose dinosaur in range.
- Darts only reach dinosaurs that are out of their own pen. An animal still behind its fence can't be darted, so nothing can be put to sleep before it breaks out.
- A **move** order moves without firing (for retreating and kiting). An **attack** order (tap a dinosaur) chases that target and fires at it.

### Engineers (level 4)

- An Engineer fixes a broken substation while it stands still on one of the tiles around it. Engineers there together add their work (level 4 has only one).
- Select the Engineer and tap a substation, or a tile beside it: the Engineer walks to the work tile nearest the tap and starts, so the player picks the side. Troops selected with it ignore that tap. With only troops selected, a tap on a substation sends them to it.
- Engineers can't dart, and they ignore attack orders. Animals go after them like any troop, and they scare Triceratops like any troop.
- In level 4, idle troops hold fire at a raptor that isn't after anyone, so a troop waiting in cover doesn't give itself away. In level 5 they hold fire at the T. rex while it breaks into the cage, so getting into place doesn't start the fight. An attack order still darts either.

### Patrol 4x4 (levels 4 and 5)

An open-top patrol vehicle in the team's colors. It moves troops faster, and it's loud.

- **Get in:** select troops and tap the 4x4. They walk to it and climb in, up to 2. Heavy Teams get the seats first, then whoever is nearest; the rest walk over and stop beside it.
- **Drive:** select the 4x4 and tap the map. It drives there and everyone climbs out beside it. Tap an animal instead, and it drives to within 3.5 tiles of it, and the troops jump out and attack it.
- Troops inside can't dart, and animals can't reach them. Animals attack the 4x4 itself like a troop. At 0 HP it's wrecked, and the troops inside climb out unhurt.
- A T. rex locked onto a troop that climbs in goes after the 4x4 instead, so a troop it has picked can be driven out of reach.
- The 4x4 scares Triceratops like a troop. Losing it doesn't count as losing a troop.
- **Loud:** while it drives, calm raptors within 6 tiles hear it, through anything, and come to look where they heard it (section 8). A ring on the ground around it shows how far. Parked, it's quiet. In level 4 it's a quick ride or a lure; in level 5's fight the raptors are too busy to listen.

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
| Tap a substation, or a tile beside it, with the Engineer selected | Fix it from the work tile nearest the tap (other troops selected ignore the tap) |
| Tap a substation with nothing selected | Substation panel: which pens it powers, and how far the fix has got |
| Tap the Patrol 4x4 with troops selected | Climb in |
| Tap the map or an animal with the 4x4 selected | Drive there and climb out, or drop the troops to attack it |
| Tap the pause button (right end of the top bar) | Pause menu: **Resume**, **Restart**, **End game** |
| Tap an arrow at the edge of the map | Look at the off-screen animal or broken fence it points to |

HUD buttons: **Select All Troops** and **Clear Selection**, and with anything selected, **Stop**, which halts the selected troops where they stand. Select all picks Engineers and the 4x4 too. Level 4 adds **Engineer**, which selects the Engineer and moves the camera to it.

### Mouse

Left-click to select, left-drag for a selection box, right-click to move or attack, WASD or arrow keys to pan, scroll wheel to zoom. H stops the selected troops. Esc clears the selection, and with nothing selected it opens the pause menu. P pauses too.

### HUD

- **Top bar:** money, revenue vs. target, the countdown (large, centered), casualties (x/8), and the pause button. In Act 2 the countdown switches to time until power returns, and the bar adds loose and secured dinosaur counts. Revenue keeps counting in the dark. Once the park evacuates, that slot shows how many visitors are still in the park.
- **Top bar in levels 1 and 2:** money, spent vs. the star's cap (red past it), the countdown until the park opens, loose and back counts, and in level 2 troops lost. The bottom bar has no build buttons.
- **Top bar in level 4:** whether a raptor has noticed the Engineer ("Unseen" in green, "Spotted" in red, for the third star), the countdown until dawn, the loose count, and how many substations are fixed ("Power 1 of 3"). No money. The bottom bar has no HQ button.
- **View cones:** in every level, each calm loose raptor shows what it sees as a pale cone on the ground, cut short by rock, pens, HQ, towers, and substations. While it makes someone out, its cone turns orange, a ring fills around it, and "?" rises over it if it's a troop. A raptor on the hunt shows a red line to its prey, troop or guest, and a ring around it instead: thin while a pack circles, thick once it rushes. "!" rises over a raptor when it comes for a troop. A toast says so once per troop ("Raptors are circling the Heavy Team." for a pack, "Raptors are after the Heavy Team." when several come straight, "A raptor is after the Heavy Team." for one), or for the Engineer a banner. A raptor in level 5's fight shows neither: it isn't looking.
- **Top bar in level 5:** animals killed (x/3), the countdown until the park opens, loose and secured counts, and troops lost. No money. The bottom bar has no HQ button.
- **Health bars:** in level 5, a red bar under an animal's sedation bar shows its health once it's hurt.
- **Bottom bar:** exhibit and tower buttons (grayed out when unaffordable or at the limit) and selected-unit info.
- **Pause menu:** stops the clock and shows how each star goal is going. **Restart** goes back to the briefing. **End game** ends the game now as a loss and shows the end screen.
- **Planning numbers:** before the blackout, the placement and exhibit panels say when that exhibit's animals break out, as a range since the time drifts each game ("13 to 29 s after blackout"), and the Reinforce note says how long concrete holds them. HQ shows each troop's sedation per second and how long the whole team, queue included, takes to sedate a T. rex and a pack of three raptors. In levels 1 and 2 it says how long the team takes to sedate one of the loose animals.
- **When the power goes out** the camera moves to show every exhibit. At the start of levels 1, 2, and 5 it shows HQ and every loose animal. At the start of level 4 it shows HQ and the substations. With tips on, it goes back to that view once the opening tips are read.
- **Edge arrows:** in Act 2, and all through levels 1, 2, 4, and 5, arrows at the edge of the map point at loose animals and fresh fence breaks that are off screen, with a count when several animals are together. Tap one to look there.

### Tips

Short tips teach the two defense lessons from section 13: guard each raptor pen, and keep troops together against the T. rex. One more explains the evacuation.

- A tip appears when it's useful, once per session: when you build your first raptor pen (raptors head for the guests, and one that makes out a troop calls the rest, and they circle it out of dart range before they rush), when you build the T. rex paddock (it locks onto one troop and charges it without a sound), at the 1:00 warning (first how the evacuation works, if the park has an animal that breaks out on its own, then whether a raptor pen has no troops nearby), when raptors kill visitors beside an unguarded pen, and when the T. rex kills a troop that was on its own.
- Level 1 has its own: at the start (how to train a squad), when the first squad is ready (how to send it after a Triceratops), and the first time a troop makes a Triceratops run (come at it from the open side). Level 2: at the start (each raptor sees what's in its cone; one that makes out a troop calls the rest, and they circle it before they strike; one darted from where no cone reaches comes alone), the first time a raptor notices a troop (get out of sight before the ring fills), the first time a raptor comes for a troop (the nest is closing in, spreading round it out of dart range before they rush, or several are coming straight, so fight as one group or get out of sight; or it's coming alone, so dart it down before the rest see), and when raptors kill a troop (a group darts them down first; Heavy Teams last 25 bites).
- Level 4: at the start (three raptors walk the park, each on its own beat but not to a timetable; stay out of the cones; rock, pens, and substations block them; a raptor takes a moment to make out a troop, and its cone turns orange while it does; once it's sure, it comes and calls the others), right after it (tap the Engineer, then the side of the west substation to work from; its raptors go for their fence at 1:00), the first time anyone climbs into the 4x4, or a raptor hears it (how to drive it; while it drives, raptors within 6 tiles hear it and come to look; parked, it's quiet), when a substation is fixed (its pens are sealed; which pen on a timer is next), the first time a raptor notices a troop (get out of sight before the ring fills; for the Engineer, being noticed at all costs its star), the first time a raptor comes for a troop (whether it called the others, and for the squad whether they circle it before they rush; the Engineer can't outrun them, and a raptor goes for whoever darts it; or, for the squad, a pack is too much but buys the Engineer time, and one alone can be darted down), and when the Tranq Squad is lost (the raptors go back to their routes).
- Level 5: at the start (the T. rex is breaking into the raptor cage and pays troops no mind until it's in; get the team into place; troops hold fire until you tap it, and a dart makes it smash through), right after it (how to load and drive the 4x4), when the cage gives way (the animals are wounding each other; a raptor you dart turns on you, and so does the T. rex once fewer than two raptors are on it), the first time the T. rex roars at a troop (load that troop into the 4x4 and keep driving around nearby while the others dart it), when the fight breaks into another pen (put it down before it reaches the next one), the first time a raptor hears the 4x4, and when the first animal is killed.
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
- **Drift:** each game, the raptors (every pen together) and the T. rex each start up to 8 s earlier or later than these delays. So the T. rex isn't always out first, and the time between the two changes from game to game. The panels give the range.

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
- **T. rex roar (level 5):** in the fight, when it locks onto a troop or tower, it stops and faces it for 2 s, and "Roar!" rises over it. Then it goes after it, charges included. Raptors in reach still get bitten while it roars. A troop that climbs into the 4x4 passes its lock to the 4x4 without a new roar. On the hunt, in levels 3 and 4, it doesn't roar: it locks on and comes at once, and the orange ring and the charge's wind-up are the only warning.
- **T. rex charge:** when it is locked on, 1.5 to 5 tiles away, with a clear run, it stops and winds up for 0.6 s (an orange arc fills around it and a line points at its target). Then it runs straight at double speed for up to 1.2 s. It bites the first troop or tower it hits, tramples visitors in its way, and stops at anything solid. It can charge again 4 s later. Troops that move during the wind-up can get out of the way.
- **Raptors:** see the raptors' own section below. They only go after someone they make out in their cone, someone who walks into them, or whoever darts them or a raptor they can see, and together they circle a troop before they strike.
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
- In level 4, power comes back one substation at a time, with the same rule for the pens each one powers.

### Fights (level 5)

The T. rex and raptors fight each other. In the other levels they ignore each other.

- Every animal has health: a raptor 100, the T. rex 1,200. Health and sedation are separate. Darts don't hurt, and wounds don't put an animal to sleep.
- **Raptors** that are calm and within 8 tiles of a loose T. rex go for it. They spread around it and keep circling, and each bites it for 5 health once a second. In the fight a raptor pays troops no mind and isn't looking, so it shows no cone. A dart sends it after the shooter, alone, by the usual hunt rules (below), and it goes back to the fight once it calms down.
- **The T. rex** bites the most wounded raptor in reach for 25 health every 3 s, so a raptor lasts 4 bites. That's on top of its bites on troops, which work as before.
- **At the cage:** before it gets in, the T. rex has eyes only for the raptors inside. It doesn't lock onto troops, and a dart makes its next hit on the fence smash straight through. The dart that does it is spent: the T. rex doesn't lock onto its shooter.
- **While raptors are on it,** the T. rex walks toward the nearest pen without power that still has animals inside at 20 px/s instead of 90, and breaks in as in the blackout. With no such pen it stands its ground. A T. rex locked onto a troop goes after the troop at full speed instead, and the fight goes with it.
- **The shield:** while two or more raptors are on it, the T. rex is too busy for troops. A dart doesn't lock it on, and a lock it already has waits until fewer than two are on it.
- **An animal at 0 health is killed.** It falls and stays down a few seconds. It counts toward the level's limit of 3.

### Raptors (every level)

A loose raptor only knows what it sees and feels, and the rules are the same in every level. Prey is anyone it can go after: a troop, the Engineer, a tower, the 4x4, or a guest.

- **Sight:** a cone 90 degrees wide and 5 tiles long, ahead of it. Rock, pens, HQ, towers, and substations block it; water and paths don't. Someone who walks into it, within 0.6 tiles, is noticed at once, whichever way it looks.
- **Noticing:** a troop, tower, Engineer, or the 4x4 in its cone takes 0.8 s to make out. The raptor stops, its cone turns orange, and a ring fills around it. If they're still in sight when the ring is full, the raptor spots them. If they get out of sight first, the ring drains at the same rate, and the raptor moves on once it's empty. A guest, panicking in the dark, gives itself away at once. In level 4, being noticed at all costs the Engineer's star.
- **Spotted:** a raptor that spots a troop, tower, Engineer, or the 4x4 hunts it and calls every calm raptor, wherever it is. One that spots a guest goes for it alone. It keeps track of its prey up to 10 tiles away in clear sight. Out of sight, it runs to where it last saw it, and calms down after 4 s without seeing it again.
- **The pack:** two or more raptors after a troop or tower that can dart circle it before they strike. Each takes a place on a ring round it and any troops within 3 tiles of it, a tile past the farthest dart: the one nearest waits in front, and the rest go round, out of dart range. Water, a whole pen, or the park's edge can cut the ring; then they spread along the open side. They rush together once all are in place, after 6 s, or the moment one of them is darted. In the strike, each keeps to its prey and bites it first, and when it falls they go straight on to the nearest troop left there. A lone raptor, or one after prey that can't dart (a guest, the Engineer, the 4x4), comes straight on.
- **Darts:** a calm raptor that sees who darts it spots the shooter and calls the others. One darted from out of its cone, or one in level 5's fight, goes after the shooter alone, at a run, and so does any calm raptor that sees it hit. One already after a troop keeps to it when the dart comes from the troops beside it; a dart from anyone else pulls it onto the shooter.
- **Calm:** with nobody in sight, it walks its patrol route (level 4) or stays by its nest (level 2). Otherwise it heads for the crowd: the nearest guest while there are guests in the park, and once they're gone, the nearest troop. It knows where people are, but it only goes after someone it makes out. With nobody left at all, it wanders where it is.
- **Hearing:** a calm raptor hears the 4x4 while it drives within 6 tiles, through anything. It drops what it was doing and trots (90 px/s) to where it heard it, following the sound while it lasts. There a raptor on patrol looks around for 1 to 2.5 s, then goes back to its route; any other goes straight back to what it was doing. It makes out anyone it sees on the way, the 4x4 included. A parked 4x4 is quiet.
- **Patrol (level 4):** each starts at a random point on its route, going either way round, and walks it at 45 px/s. The route is loose. At each turn it looks around for 1.5 to 4 s, 70 degrees either way, and 1 time in 5 it turns back the way it came. On each leg, 3 times in 10 it stops partway to look around for 1 to 2.5 s, and 1 time in 4 it wanders 2 to 4 tiles off to one side to sniff and look around there.
- A Tranq Squad darts one raptor down in 6 s and loses about half its HP doing it. Two at once kill it. So a squad can take a raptor it darts from behind, but not two.

## 9. Winning and losing

This section is level 3. Levels 1, 2, 4, and 5 are in section 3.

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
- Retry button, and after a win in levels 1 to 4, **Next level**.

In levels 1 and 2 the end screen has the same stars, goals, Next time line, and timeline (what was loose, each animal back with how many were left, troops lost, and the end). Its numbers are troop spending against the cap, animals darted, any that walked back on their own, any still loose, troops trained and lost, and the time left.

Level 4's timeline adds each substation fixed, with the pens it sealed, each pen whose animals got out, and the first time a raptor saw each troop. Its numbers are substations fixed, animals contained and darted, whether a raptor saw the Engineer, troops lost, and the time left. Level 5's timeline adds the T. rex breaking into the cage, each animal killed, and each pen the fight broke into. Its numbers are animals darted and killed, troops lost, the 4x4, and the time left.

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
- Level 4's substations: a dark steel block with a yellow lightning bolt, a red light while broken, and a progress ring while Engineers work. Fixed, it glows cyan. A thin cable runs along the ground to each pen it powers, gray when off and cyan when on. Pens without power keep gray fences while the others turn cyan.
- Raptors, in every level: a pale yellow cone on the ground for what each calm one sees. It turns orange, with a ring filling around the raptor, while the raptor makes someone out, and "?" rises over it for a troop. Once it's after someone, "!" rises over it for a troop, and a red line and ring replace the cone. The line is thin while a pack circles and thick once it rushes.
- Engineer: a small blue circle with a yellow ring. Patrol 4x4: a navy rounded rectangle with a white roll bar, pointing where it's going, with a blue dot for each troop inside. While it drives, a pale amber ring shows how far raptors hear it, with a pulse running out to it.
- Level 5: a red health bar under an animal's sedation bar once it's hurt. A killed animal turns dark, gets a red cross, and fades. "Roar!" rises over the T. rex when it locks onto a troop.

### 3D build (all five levels)

The game players play, `slice.html`, draws every level in real 3D with three.js. Its rules, HUD, and controls are shared with the 2D build, which stays as a staging ground for mechanics; the 3D build adds the look and the sound.

- Camera: looks down at 56 degrees from the south. Drag pans, pinch or the wheel zooms, and it never shows past the ground around the park.
- The park: textured ground, paths, a pond, trees and plants (thick at the edges, thin in the middle), viewing decks, lamps, and the gate. Tree tops fade where they would hide a troop, an animal, or a building preview.
- Pens: pastures are meadow, raptor pens are dirt, and the T. rex paddock is jungle.
- Fences: standard is galvanised chain-link with live wires; reinforced is a concrete wall with steel bars and, for raptors and the T. rex, razor wire. Each segment looks intact, dented, badly damaged, or wrecked by its HP, and a wrecked one leaves debris.
- HQ: a two-storey security block with a glass control room and radar, a SECURITY sign, a shield on the roof, a flag, floodlights, and a patrol car.
- Tranq Tower: a steel watchtower with an armoured deck above head height and a twin-barrel dart turret.
- Tranq Squad: regular troops in fatigues and blue berets with dart carbines. Heavy Team: mostly white power armour with blue accents and a heavy dart cannon.
- Dinosaurs: animated models with patterned skin. At night their eyes catch the light faintly.
- Building (level 3): picking an exhibit or a tower shows a preview on the ground, green where it fits and red where it doesn't, with the new path tiles and the viewing spot, or the tower's range. Tap the map to move it. Dust rises where something is built or reinforced.
- Guests (level 3): six models in their own colours of skin, hair, and clothes. They walk the paths, wave, hold up glowing phones in the dark, and run when they see danger. A guest who is killed falls and stays down a few seconds.
- The blackout: level 3 starts by day. When the power is cut, the park goes dark: moonlight, troop flashlights, HQ floodlights, and tower searchlights. When the power comes back, so does the day. Light means nothing to the raptors; the beams show troops out searching.
- Words float up as in the 2D game: money paid (payments that land together show as one sum), Breach!, Secured, Charge!, and Roar!, and "?" and "!" over a raptor that notices or comes for a troop. The T. rex's intent shows on the ground as in the 2D game: an orange ring under its target, a filling arc and a line during the wind-up, and a ring and streak while it charges.
- Level 4 plays at night. Substations are fenced transformer yards with a warning sign and a beacon, red while broken and cyan once fixed; sparks fly while the Engineer works, and a fixed one's pens get their fence glow and lamps back. The Engineer is a park worker in a yellow hard hat and an orange high-visibility vest, with a toolbox instead of a gun. Troops carry no flashlights here: they're sneaking. In every level, each calm raptor casts a pale cone of what it sees on the ground, cut short by cover and fading toward its far edge, which a thin outline marks, and a yellow ring at its feet marks it at the tip of its cone. While it makes someone out, its cone turns orange and an orange ring fills around it. Once a raptor is after someone, a red line runs from it to its prey, thin while a pack circles and thick once it rushes, and a red ring sits under the prey instead.
- Levels 4 and 5: the Patrol 4x4 is an open-top 4x4 with a roll bar, a light bar, and a spare wheel, in navy and white with the team's shield on the doors. It's built from shapes, with no maker's grille or badges. Troops inside ride in the seats. While it drives, a pale amber ring on the ground shows how far raptors hear it, with a pulse running out to it. In level 5, the cage is a concrete pen. Hurt animals flinch, and a killed one falls and stays down a few seconds.
- Night: a test switch turns the blackout lighting on and off by hand, without changing the rules.
- Quality: High and Low, switched from the bar at the top right, which also shows the frame rate and the game's own work per frame in ms. Low is for phones and is where a phone starts: one pixel per CSS pixel, no bloom or colour grade, no shadows from trees (the shade under them is baked into the ground), and fewer trees and grass tufts. Behind the briefing, the end screen, and the pause menu the park isn't drawn again.
- Frame rate: a phone caps it at 30 fps, for a steady picture and less battery. The same bar turns the cap off and on, and the choice is remembered on that device.
- Assets: Quaternius models (CC0), textures generated for the project, and sounds from CC0 packs or made for the project. `public3d/LICENSES.md` lists them.

### Sound (3D build)

- Sound starts at the first tap, as browsers require. A **Sound** box on the briefing and in the pause menu turns it all off and on, and the choice is remembered on that device. It goes quiet while the page is hidden. The iPhone's silent switch mutes it too.
- The pause menu also has **Music** and **Effects** sliders, on one row with the Sound box. Effects is every sound but the music: the background and the HUD too. They're remembered on that device, and grey out while sound is off. Letting go of Effects plays a chime at the new level, since nothing else sounds while the game is paused.
- Music, by level: level 1 a bright tune; level 2 a creeping one; level 3 the bright tune while you build, a chase from the moment the power is cut until nothing is loose; level 4 a sneaking loop; level 5 the creeping one while the T. rex works on the cage, and the chase once the cage breaks or a raptor is out. It drops back while a tip is open, but not in the pause menu, where the Music slider needs the real level. At the end of a level it stops, and a short win or lose jingle plays.
- Under it, birdsong by day and crickets at night, following the view, so the blackout brings the crickets.
- Sounds come from where things happen. On screen they play in full; off screen they fade with distance and sit left or right. Warnings never fade out completely: a raptor noticing a troop, a fence giving way, the T. rex's roar, a substation fixed, an animal secured.
- What makes a sound: building, reinforcing, a tower going up, guests paying, darts (a light and a heavy shot), fences being hit (chain-link rattles, concrete thuds) and giving way, the 1:00 warning, the power cut, the evacuation siren, the power coming back, a troop ready, a troop lost, raptors calling when they get out or spot a troop, hissing when they hear the 4x4, and biting, a Triceratops bellowing when it runs, guests crying out, an animal going down, and the Secured chime. On the HUD: a soft click for every button, a select and an order sound for taps on the map, and an error sound when something can't be done.
- The T. rex is heard only in level 5: a roar when it locks onto a troop, a growl when it mauls a raptor, and a cry when it dies. On the hunt in levels 3 and 4 it makes no sound, as the rules say (section 8), though its bites are heard.
- The Engineer's tools while it works (level 4), and the 4x4's engine while it drives (levels 4 and 5), faster as it speeds up. Parked, it's quiet.

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

After the six milestones, a second round made the blackout matter more: visitors who don't notice the blackout, a T. rex that locks on and charges, Tranq Towers, and a 5:00 build phase. Later rounds added the evacuation, the pause menu and end-screen story, one star per goal, levels 1 and 2 in front of the blackout, the 3D build, and levels 4 and 5 after it. DECISIONS.md lists the calls made along the way.

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

Dense T. rex park (about $30,500 to spend). The T. rex usually gets out first, at about 14 s (6 to 22 s with the drift), and that starts the evacuation. The raptors follow at about 21 s (13 to 29 s), or about 28 s behind concrete (20 to 36 s). In some games the raptors get out first, into a full park.

| Defense | Spent | Result |
|---|---|---|
| Nothing | $0 | Overrun 13, shut down 3 |
| 5 troops, massed | $18,750 (58%) | Won 11 (6 with ★★★), overrun 4, shut down 1 |
| 6 troops, massed | $21,000 (65%) | Won 15 (10 with ★★★), shut down 1 |
| 7 troops, massed | $23,250 (72%) | Won 15 (12 with ★★★), shut down 1 |
| Whole bank, massed (10 troops) | $30,000 | Won 16 (8 with ★★★) |
| Whole bank, split (10 troops) | $30,000 | Won 16 (8 with ★★★) |
| Concrete on every pen, rest split (8 troops) | $28,350 | Won 12 (7 with ★★★), overrun 4, losing 5.6 troops |
| Concrete on the raptor pens only, rest split (10 troops) | $29,850 | Won 16 (13 with ★★★) |
| 2 towers, rest massed (7 troops) | $28,500 | Won 14 (7 with ★★★), overrun 1, shut down 1 |

Visitor deaths: none or a few in most games with a troop defense, but up to 9 when the raptors get out before the T. rex.

Dense three-raptor park (about $24,200 to spend). With no T. rex, the raptors are the first out, at about 21 s (13 to 29 s; about 28 s behind concrete), into a full park.

| Defense | Spent | Result |
|---|---|---|
| Nothing | $0 | Shut down 16 of 16 |
| 5 troops, massed | $18,750 (73%) | Shut down 14, won 2 |
| 6 troops, massed | $21,000 (82%) | Shut down 13, won 3 |
| Whole bank, massed (7 troops) | $23,250 | Shut down 14, won 2 |
| Whole bank, split (7 troops) | $23,250 | Won 12, shut down 3, overrun 1 |
| Concrete, rest split (6 troops) | $22,650 | Won 11, shut down 4, overrun 1 |
| 2 towers, rest massed (5 troops) | $24,000 | Won 10, shut down 6 |

About 5 visitors die with split troops, concrete or not, and 7 or 8 with everything else.

Raptors took on level 4's senses (DECISIONS 141 to 152), which made both parks easier, and then learned to hunt as a pack (153 to 163). A raptor makes out a guest at once and goes for it alone, and calls the pack only for a troop, so raptors spread through the crowd: massed troops lose the raptor park to guest deaths almost every time again, while split troops still hold it in 12 to 15 games of 16. The pack didn't move the T. rex park, since a Heavy Team puts a raptor down in two darts and a group with Heavy Teams breaks a pack. Taking the roar out of level 3 (decision 164) made thin defenses pay, and the breakout drift (decision 165) means no plan is safe every time. The best plan, concrete on the raptor pens with troops posted at each pen, earns three stars in 13 of 16 games (40 of 48 in a longer run), down from every game: in the rest the raptors get out close behind the T. rex, or ahead of it, while guests are still in the park. Before the senses changed, 5 massed troops were overrun in all 16 T. rex park games, concrete on every pen with split troops in 12, and split troops lost the raptor park 14 times in 16.

Fights on open grass (troops and towers in a block, dinosaurs released 6 tiles away, 5 seeds each). The raptors head for the block, one makes it out and calls the rest, and they circle it out of dart range before they strike together. The block's back is near the park's edge, so they spread along the open side.

| Fight | Result |
|---|---|
| Raptor pack vs 2 Tranq Squads | Raptors win all 5 |
| Raptor pack vs 3 Tranq Squads | Troops win, lose 1 |
| Raptor pack vs 2 Heavy Teams | Troops win, no losses |
| Raptor pack vs 1 Tranq Tower | Tower wins, taking about 12 s |
| Raptor pack vs 2 Tranq Towers | Towers win, taking about 6 s |
| T. rex vs 2 Heavy + 2 Tranq | Troops win, lose 2 |
| T. rex vs 3 Heavy Teams | Troops win, lose 1 |
| T. rex vs 3 Heavy + 2 Tranq | Troops win, lose 1 |
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

Level 2, 4:00 on the clock and $21,000. Stars at $13,500 or less and no troops lost. **Massed:** every troop waits out of the nest's sight until all are trained, then they go in together. **Wait:** the same group stands at the nest's edge, about 5 tiles out, and darts whatever comes in range, stepping a tile closer after 20 s of nothing. **Trickle:** each troop goes in as soon as it's ready.

| Troops | Cost | Massed | Wait | Trickle |
|---|---|---|---|---|
| 4 Tranq Squads | $9,000 | Won 13 of 16, lost 1.8 | Won 4 of 16, lost 3.0 | Lost all 16 |
| 5 Tranq Squads | $11,250 | Won 16 of 16, lost 1.1 | Won 16 of 16, lost 1.7 | Lost all 16 |
| 6 Tranq Squads | $13,500 | Won 16 of 16, lost 0.6 | Won 16 of 16, lost 0.8 | Won 3 of 16 |
| 2 Heavy Teams | $12,000 | Won 16 of 16, lost 0.4 | Won 14 of 16, lost 0.9 | Won 6 of 16 |
| 3 Heavy Teams | $18,000 | Won 16 of 16, no losses | Won 16 of 16, no losses | Won 16 of 16, lost 1.5 |
| 1 Heavy + 3 Tranq | $12,750 | Won 16 of 16, lost 0.5 | Won 16 of 16, lost 0.8 | Won 12 of 16 |
| 1 Heavy + 4 Tranq | $15,000 | Won 16 of 16, lost 0.1 | Won 16 of 16, lost 0.8 | Won 15 of 16, lost 2.6 |
| 2 Heavy + 2 Tranq | $16,500 | Won 16 of 16, lost 0.1 | Won 16 of 16, no losses | Won 16 of 16, lost 1.1 |

The nest raptors hunt as a pack now, so the smallest groups pay. A pack that circles 4 Tranq Squads and strikes together costs them 2 troops on average going in, and 3 waiting at the edge, where they run out of time in 12 of 16 games. Five Tranq Squads, or any mix with a Heavy Team, win every time going in together. Trickling in still loses.

Level 4, 3:30 until dawn, one Engineer, one Tranq Squad, and the 4x4. The west raptors go for their fence at 1:00 and the T. rex at 1:50. Stars for no troops lost and never spotted (no raptor ever notices the Engineer). Each raptor starts at a random point on its route, so every seed opens differently, and walks it loosely. The scripted Engineer fixes the west substation, then the north one, then the south one. Sneaking, it moves only through tiles no raptor sees now or in the next 2 s (its best guess off their routes: where each is going now, then the next stop the way it's going, with an average look, and a tile of margin), waits in cover when there's no safe way on, steps back into cover when a cone comes its way, and works from whichever side of the block is out of sight. Its decisions come every 0.5 to 2 s, like a person's reaction time. Unless the row says so, the 4x4 stays parked.

| Plan | Result | Fixed at | Engineer noticed | Troops lost (of 2) | Stars |
|---|---|---|---|---|---|
| Sneak, decisions every 0.5 s | Won 15 of 16, 1:17 to 2:04 left | 0:21, 1:01, 1:42 | In 3 | 0.1 | ★★★ in 13, ★★ in 2 |
| Sneak, every 1 s | Won 16 of 16, 1:16 to 2:01 left | 0:21, 1:06, 1:48 | In 4 | 0 | ★★★ in 12, ★★ in 4 |
| Sneak, every 1.5 s, less careful | Won 13 of 16, 0:34 to 1:48 left | 0:21, 1:17, 2:05 | In 4 | 0.2 | ★★★ in 11, ★★ in 2 |
| Sneak, every 2 s | Won 8 of 16, 0:01 to 1:11 left | 0:22, 1:27, 2:51 | In 11 | 0.4 | ★★★ in 2, ★★ in 6 |
| Sneak, every 1 s, reading only the cones as they are | Won 12 of 16, 1:35 to 2:04 left | 0:21, 1:02, 1:38 | In 11 | 0.3 | ★★★ in 5, ★★ in 7 |
| Sneak, Tranq Squad draws the raptors off at the south substation | Won 9 of 16, 1:35 to 2:02 left | 0:21, 1:01, 1:39 | In 11 | 1.3 | ★★★ in 1, ★★ in 4, ★ in 4 |
| Sneak, Tranq Squad sent straight at the south raptor | Won 13 of 16, 1:37 to 2:06 left | 0:21, 1:01, 1:35 | In 6 | 0.7 | ★★★ in 6, ★★ in 5, ★ in 2 |
| Sneak, Tranq Squad darts the south raptor from behind | Won 15 of 16, 0:56 to 2:06 left | 0:21, 1:01, 1:47 | In 3 | 0.6 | ★★★ in 6, ★★ in 7, ★ in 2 |
| Straight to each substation | Won 0 of 16 | 0:21, then the Engineer is lost in all 16 | Always | 1.0 | |
| Sneak, the Engineer rides the 4x4 toward the north one | Won 16 of 16, 1:16 to 2:03 left | 0:21, 0:58, 1:43 | In 3 | 0 | ★★★ in 13, ★★ in 3 |
| Sneak, the squad drives the 4x4 round the south one as a lure | Won 16 of 16, 1:06 to 1:57 left | 0:21, 1:01, 1:57 | In 2 | 0.8 | ★★★ in 3, ★★ in 11, ★ in 2 |

Before the third raptor and the loose routes, the plans that read only the cones, or decided every 1.5 s, won 15 or 16 games of 16, and every squad plan won 13 to 16. Now the careful sneaks hold up (over 48 games, every 0.5 s wins 47 and earns three stars in 39), and the rest pay: reading only the cones wins 33 of 48 and earns three stars in 13, and a raptor notices the Engineer in 35. A squad drawing the raptors off has a pack of three to draw now, and wins about half the time. The 4x4 ride saves only a few seconds, since it has to stop well short of the north raptor's hearing. Driven round as a lure, the engine pulls the raptors off the Engineer, who gets in unseen in 14 of 16 games, but the raptors that come to look see the 4x4, hunt it, wreck it, and usually get the squad.

Level 5, 3:00 on the clock, 2 Heavy Teams, 2 Tranq Squads, and the 4x4. Stars for no troops lost and no animal killed. Troops dart raptors first unless the row says otherwise. In the first rows the team goes as soon as the level starts, and its first dart makes the T. rex smash into the cage. In the Wait rows nobody darts until the T. rex gets in on its own, at about 0:30; the team waits 6 tiles west of the cage, or 3 tiles off the T. rex, in range. Every win ends with 2:10 to 2:39 left.

| Plan | Result | Animals killed | Troops lost (of 4) | Pen broken | Stars |
|---|---|---|---|---|---|
| Heavy Teams in the 4x4 to the cage | Won 16 of 16 | 0 | 1.2 | Never | ★★ in 15, ★★★ in 1 |
| Same, and the 4x4 decoys the T. rex | Won 16 of 16 | 0 | 0.2 | Never | ★★★ in 13, ★★ in 3 |
| Same, and the 4x4 drives the T. rex's target off | Won 16 of 16 | 0 | 0 | Never | ★★★ |
| 4x4, T. rex first | Won 16 of 16 | 1.0 | 0 | Never | ★★ |
| 4x4, the most hurt raptor, then the T. rex | Won 16 of 16 | 0 | 1.4 | Never | ★★ |
| Same, and the 4x4 decoys the T. rex | Won 16 of 16 | 0 | 0.1 | Never | ★★★ in 15, ★★ in 1 |
| Everyone walks | Won 16 of 16 | 0 | 1.9 | Never | ★★ in 15, ★★★ in 1 |
| Everyone walks, T. rex first | Won 16 of 16 | 1.0 | 0.1 | Never | ★★ in 15, ★ in 1 |
| 4x4, orders start after 10 s | Won 16 of 16 | 0 | 1.6 | Never | ★★ |
| Everyone walks, orders start after 20 s | Won 16 of 16 | 0 | 2.3 | Never | ★★ |
| 4x4, orders every 3 s | Won 16 of 16 | 0 | 0.9 | Never | ★★★ in 7, ★★ in 9 |
| Wait 6 tiles back, 4x4 | Won 16 of 16 | 0 | 1.6 | Never | ★★ |
| Same, and the 4x4 decoys the T. rex | Won 16 of 16 | 0 | 0.8 | Never | ★★★ in 7, ★★ in 9 |
| Wait 6 tiles back, 4x4, T. rex first | Won 16 of 16 | 1.0 | 1.1 | Never | ★ |
| Wait 6 tiles back, everyone walks | Won 16 of 16 | 0 | 1.6 | Never | ★★ |
| Wait in range, 4x4 | Won 16 of 16 | 0 | 2.4 | Never | ★★ |
| Wait in range, 4x4, T. rex first | Won 16 of 16 | 0.9 | 1.1 | Never | ★ in 14, ★★ in 2 |
| Wait in range, everyone walks, T. rex first | Won 16 of 16 | 0.9 | 1.0 | Never | ★ in 15, ★★ in 1 |

Left alone, the T. rex gets in at about 0:30 and kills a raptor at about 0:39, 0:51, and 1:03, so doing nothing loses at about 1:03. Whichever side the troops dart first, the other costs a star: darting the raptors first frees the T. rex, which takes a troop (it roars first, and a troop driven off in the 4x4 is safe), and darting the T. rex first, while the raptors shield it, costs a raptor, since the T. rex kills one about 9 s into the fight. Only the 4x4 decoy, or driving the T. rex's target off, saves both. Waiting is safe but not free: a team close by when the raptors burst out is bitten by the ones it darts. The late starts that used to cost a star or the level are fine now, since the cage holds until about 0:30. The fight starts about 33 s from the west raptor pen at its slow push, so no plan lets it get there.

Two things were tried and dropped. Letting darts pull the T. rex off the cage, as they do anywhere else, made the level a fight with the T. rex alone: every plan won in about 19 s, with three stars in 24 of 24 games for the 4x4 plans, and the raptors never left the cage. And with the T. rex's bite on raptors at 20, a team in range when the fight started could dart the T. rex first and save every raptor (three stars in 24 of 24), so the 4x4 had nothing left to teach; at 25, a raptor lasts 4 bites instead of 5, and that plan costs one again.

`npm run stress` plays 40 random blackout games: 2 wins, 12 overruns, 26 shutdowns. Careless play loses. It also plays 20 random games of each other level: level 1 is won twice in 20 (random orders rarely corner anything in time), and level 2 is won 19 times in 20, because random buying spends the whole $21,000 and random attack orders send most troops at the nest together. Level 4 is never won at random: the Engineer is lost in all 20. Level 5 is won 3 times in 20, all with two stars; 15 let 3 animals die and 2 lose every troop.

What to watch in playtests:

- Each park punishes a different mistake. The raptor park loses to guest deaths unless troops guard each pen: massed troops are shut down in 13 or 14 games of 16, and split troops win 11 or 12. The T. rex park punishes thin defenses (5 massed troops lose 5 games in 16), and with the drift, any plan can lose a guest or two when the raptors get out early.
- The roar is set per level (`MissionConfig.roars`), and only level 5 has it. There it is the cue for the 4x4 decoy: without it, the decoy earned three stars in 8 of 16 games, not 16. Level 4's scripted plans came out the same with or without it over 48 games each, since its T. rex only gets out when the north substation is late. If the T. rex park feels too hard, a roar in level 3 is the lever: with 2 s, every troop defense held it.
- The first animal out is the alarm. In a park with a T. rex, its escape usually starts the evacuation, so concrete on its fence keeps guests in the park longer, and concrete on the raptor pens alone gives them the longest head start. A park without a T. rex has no early alarm. If raptor-only parks feel like a trap, the levers are the raptor breakout delay, the evacuation speed (`VISITORS.evacuateSpeed`), and the casualty limit.
- In these runs the raptor park's defenses that work are the ones that guard each pen (split troops, with or without concrete, and towers with massed troops). A player can do better than the scripted defender (towers on the paths, troops bought earlier).
- The casualty limit is 8. A defended T. rex park usually loses a few visitors at most, but up to 9 when the raptors get out before the T. rex, so the limit can bite there too. `UNCAPPED=1 npm run balance` prints every game's deaths, to judge another limit.
- The defenses that won every T. rex park game spend most of the bank: every troop massed or split, or concrete on the raptor pens with troops at each pen. Six massed troops (65% of the bank) lose 1 game in 16, and 5 massed troops lose 5.
- The T. rex is slower than a running visitor (90 vs 100 px/s), so it mostly kills troops, towers, and anyone who walks toward it. Its charges and lock-on make it the fight that costs troops.
- The dense park leaves about $30,000, so a careful player can afford plenty. If that feels too safe, raise exhibit prices, or lower the starting money.
- Towers are bait and backup, not a defense on their own. A tower beside a pen draws the first attack and buys troops a few seconds.
- A tower outranges a Tranq Squad and has more HP, and on open grass one tower beat a pack in all 5 games, even when the pack circled it and struck together. Watch for players parking one tower per pen.
- Building extra cheap pastures can lower revenue, because visitors spend their short visits on $10 exhibits. That's intended, and the end screen shows revenue per exhibit.
- Level 1's clock is the lever for how hard it feels. At 2:30 one squad sometimes runs out of time even in the scripted runs, and two usually earn three stars. A person tapping orders is much slower, so two or three squads should be the norm. If it's too hard, try 3:00; if it's too easy, 2:00. The time star needs 1:00 left either way.
- Level 2 is easy to win once troops go in together, and the stars carry the challenge. Its raptors see in cones and hunt as a pack, so a player who reads the cones can pick some off from behind, and a small group that gets circled pays for it. The scripted wait at the edge now does worse than going in together with the smallest group, and a careful person should do better. If it feels too easy, lower the starting money: at $15,000, five Tranq Squads or two Heavy Teams still fit, with less room to recover from a bad first fight.
- Level 4 is a stealth level, and the scripts show its shape: patience wins, and walking straight in loses. With three raptors on loose routes, the gaps can't be learned by heart, so the third star needs a careful eye on the cones and on where each raptor is heading. The squad has two uses: a decoy that often costs a star, or an ambush from behind that takes one raptor out of the level. The 4x4 adds two more: a quick ride, if it stops well short of the raptors' hearing, or a lure that gets the Engineer in unseen and usually costs the squad. A careful script finishes with 1:15 to 2:00 to spare, so dawn is a backstop; the real clock is the T. rex at 1:50. If people get caught too often, the levers are the loose routes (`STEALTH.turnBackChance`, `pauseChance`, `sniffChance`), the middle raptor's loop, the noticing beat (`STEALTH.noticeSeconds`), the cone (`sightTiles`, `coneDeg`), the stops (`lookSeconds`, `lookDeg`), and the patrol speed. If the 4x4 is too safe a ride, raise `JEEP.noiseTiles`.
- Level 5's win is easy and its stars carry the challenge: the order of darting costs a troop or an animal, and the 4x4 saves both. The cage gives about 30 s to load the 4x4 and get into place, with no countdown, and a dart starts the fight sooner. If the opening drags, lower the cage's HP (`cageHp` in the level's park; 1,500 is about 30 s). If animals die too fast, lower the T. rex's bite on them (`FIGHT.trexBite`) or raise the raptors' health (`DINOS.raptor.health`). If the T. rex first is too safe, lower `FIGHT.shieldRaptors` or raise the raptors' bite on it; if the decoy is too hard to pull off, `FIGHT.lockRoarSeconds` is the time a player gets to react.

## 14. Later, not now

- Mantah mercenaries raiding a genetics lab as a second objective.
- A nest that hatches more raptors the longer it's left (level 2's nest holds six that never grow).
- Freestanding walls, fence repair, more units (a helicopter), and a lethal option with a cost.
- More levels with different maps, exhibit limits, and timers. Saving which levels are done, and their stars.
- Real art (for example, PixelLab sprites) and sound.
- Rename Mantah Corp before sharing publicly. It's the villain company from Camp Cretaceous.

# Decisions

Calls made where SPEC.md was silent, or where following it literally would have made things worse. Each tuning number mentioned here lives in `src/config.ts`.

## Breakouts drift

Chris asked for level 3's breakout times to drift each game, so the three-star plan in the T. rex park (concrete on the raptor pens, troops at each pen) isn't a sure thing.

165. **Each game, the raptors and the T. rex each go for their fences up to 8 s early or late (`BLACKOUT.breakoutDriftSeconds`).** Every raptor pen shares one draw, and the T. rex gets its own. The panels show the range ("13 to 29 s after blackout"). Over 48 games each:
    - With 5 s, the three-star plan still earned three stars in 47 of 48. With 8 s, 40 of 48. In the rest the raptors got out close behind the T. rex, or ahead of it, while guests were still in the park, and one game was shut down.
    - A separate draw for each pen staggered the raptor pens, so a massed group could take them one at a time: 5 massed troops won the raptor park in 33 of 48 games instead of 6. One draw for every raptor pen keeps the raptor park as hard as before.
    - Most other T. rex park plans earn three stars less often too, mostly from guest deaths in the games where the raptors get out early (every troop massed: 24 of 48, from 42). Concrete on every pen with split troops is the exception: it wins 31 of 48 instead of 13.

## The roar where it helps

Chris: "The T. rex doesn't need to always roar. If game play is better without a roar on a certain level, encourage no roar in that case. From a player perspective, it is still a consistent character."

164. **The T. rex roars only in level 5 (`MissionConfig.roars`).** In the fight it roars at the troop it locks onto; on the hunt, in levels 3 and 4, it comes without a sound, and the orange ring and the charge's wind-up are the only warning. Level 5 needs the roar: it is the cue for the 4x4 decoy, and without it the decoy earned three stars in 8 of 16 games instead of 16. Level 3 plays better without it, because spreading troops thin is punished again: concrete on every pen with split troops is now overrun in 12 of 16 T. rex park games (never with the roar), and 5 massed troops in 3 (once), while 6 or more troops together still hold. Level 4's T. rex only gets out when the north substation is late, and every scripted plan came out the same with or without the roar over 48 games each. Without it, 1:50 is a real deadline, and a silent hunter suits the night. Levels 1 and 2 have no loose T. rex.

## Raptors hunt as a pack

Chris asked for level 3 to be harder again, with raptors that call each other and then try to encircle the troops. On flashlights: "The level 4 troops are smart and keep their flashlights off because they are intentionally sneaking. The level 3 troops are trying to find the dinosaurs and get the guests out safely, not sneaking."

153. **Raptors circle a troop before they strike, in every level (`PACK`).** When two or more raptors are after a troop or tower that can dart, each takes a place on a ring round it and any troops within 3 tiles of it, a tile past the farthest dart. The one nearest waits in front and the rest go round, in the order they stand, so nobody crosses. They rush together once all are in place, after 6 s, or the moment one of them is darted. A lone raptor, or one after prey that can't dart (a guest, the Engineer, the 4x4), comes straight on.
154. **They go round the ring, not across it.** Each aims 30 degrees ahead along the ring's tangent (`PACK.aheadDeg`), so it holds the ring's distance and backs out to it if it starts inside. Aiming at a point on the ring itself, 45 degrees ahead, pulled them in to about 70% of the ring, inside dart range, so a dart set off the rush before the pack was round.
155. **Water, a whole pen, or the park's edge cuts the ring; a rock doesn't.** A spot counts as open if a raptor can stand on the ring there, a tile or two outside it, or half a tile inside (still out of range). When the ring is cut, the pack spreads along the open side and goes round the open way. Before, a squad with its back to the park's edge left one raptor stuck at the cut until the 6 s ran out.
156. **In the strike, a raptor keeps to its prey.** A dart from the troops beside its prey (within 3 tiles of it) no longer pulls it onto the shooter, and it bites its prey first whenever it can reach it. When the prey falls, it goes straight for the nearest troop left there, still rushing, instead of calming down and circling again. A dart from farther away still pulls it off, so the squad can still draw raptors off the Engineer in level 4. Without this, darts split the pack's bites across the group, and a pack lost to 2 Tranq Squads every time; now it beats them every time and takes one of 3.
157. **Only a troop brings the pack.** A raptor that makes out a guest goes for it alone; one that makes out a troop, tower, Engineer, or the 4x4 calls the rest. A guest is no threat to call about, and raptors spread through the crowd instead of bunching on one guest.
158. **Guests are made out at once.** A guest panicking in the dark gives itself away, as anyone who walks into a raptor does. The 0.8 s to make someone out is for troops, towers, the Engineer, and the 4x4.
159. **With the guests gone, a calm raptor heads for the troops.** It knows where they are, as it knew where the crowd was, and still only goes after one it makes out. Before, it wandered where it was, and troops had to go and find it.
160. **A raptor that sees a packmate darted comes for the shooter, at a run.** One darted from where no cone reaches still comes alone, unless another raptor sees it hit.
161. **The toast, tip, and line say what the pack is doing.** The toast says "Raptors are circling the Tranq Squad." while they circle, "Raptors are after the Tranq Squad." when several come straight, and "A raptor is after the Tranq Squad." for one. The red line to the prey is thin while a pack circles and thick once it rushes, in 2D and 3D. The level 2, 3, and 4 tips say a pack circles a troop before it strikes.
162. **Troop flashlights are back at night in every level but level 4.** Light still means nothing to raptors; the beams show troops out searching. Level 4's troops are sneaking, so theirs stay off.
163. **Level 3: the raptor park is harder again, the T. rex park isn't.** Massed troops lose the raptor park to guest deaths in 14 to 16 games of 16 (8 to 13 before the pack), and split troops win 12 to 15 (14 or 15 before). The T. rex park is still won by any troop defense. A Heavy Team puts a raptor down in two darts, so a group with Heavy Teams breaks any pack, and the roar gives troops time against the T. rex. SPEC section 13 has the numbers, and what a shorter roar would do. Left for Chris to choose. Decision 164 then took the roar out of level 3, which made the T. rex park punish thin defenses again.

## One set of rules for every level

Chris: raptors, and every element of the game, should have the same properties in every level, and the hearing and sight cones the same everywhere. He then chose: a calm raptor heads for the crowd while there are guests; the T. rex roars in every level, but the fight stays level 5's setup; troops holding fire and pen timers can still differ by level; and level 2 becomes a small stealth fight.

141. **Every loose raptor sees in a cone and feels touch, in every level.** The cone (90 degrees, 5 tiles), touching distance (0.6 tiles), the 0.8 s to make someone out, the call to every calm raptor, the dart reaction, and the hunt (10 tiles in clear sight, 4 s to give up) are the same in levels 2 to 5. The old rules for levels 2, 3, and 5 (hunt anyone within 8 tiles, else the nearest guest or troop anywhere) are gone, and so are their numbers.
142. **Guests are prey like troops.** A raptor makes out a guest in its cone the same way and calls the others to it. Towers and the 4x4 count too, since animals already attacked them like troops. Since decisions 157 and 158, a guest is made out at once and brings no pack.
143. **A calm raptor walks its route (level 4), stays by its nest (level 2), runs for the nearest guest while there are guests in the park (level 3), and otherwise wanders where it is.** Heading for the crowd keeps level 3's danger: a raptor knows where the guests are, but it only goes after one it makes out. With no guests left it wanders, so troops have to go and find it. Since decision 159, it heads for the troops instead.
144. **The nest has no leash.** Nest raptors hunt by the same rules as any raptor and go back to the nest once they calm down. The tip that said they won't chase far now says a raptor that loses you for a few seconds goes back.
145. **Level 5's fight is still level 5's setup.** A calm raptor within 8 tiles of the loose T. rex goes for it, and in the fight it pays troops no mind and shows no cone. A dart sends it after the shooter, alone, by the usual hunt rules until it loses them; the 5 s grudge is gone. Then it goes back to the fight.
146. **The T. rex roars in every level** when it locks onto a troop or tower: 2 s standing still and facing it. A new lock starts with the roar, and any wind-up for a charge comes after it. Before, a lock could start the roar and the wind-up in the same moment, so "Charge!" showed while it roared. Since decision 164, it roars only in level 5.
147. **Cones show for every calm loose raptor in every level, in 2D and 3D.** A raptor on the hunt shows a red line to its prey, troop or guest. One in level 5's fight shows neither.
148. **No troop flashlights at night, in any level.** Light means nothing to raptors anywhere now, so level 3's night lost them as level 4's did (decision 129). HQ floodlights and tower searchlights stay. One less shadow-casting light also helps phones. Reversed for every level but level 4 by decision 162.
149. **Sightings show the same everywhere; only levels 2 and 4 tell them in the end-screen story.** "?" and "!" rise over raptors, and a toast says "A raptor is after the Heavy Team." once per troop, in every level. Since decision 161, it also says when raptors are circling. Being seen is only the point where the level is about staying unseen.
150. **Level 2 is a small stealth fight.** The briefing and the start tip teach the cones, the moment a raptor takes, the call, and that a raptor darted from where no cone reaches comes alone. New tips say when a raptor notices a troop, and whether the rest are coming. A new balance plan waits at the nest's edge and darts whatever comes in range; it does about as well as going in together.
151. **What stays per level:** troops hold fire at calm raptors only in level 4, and pens break out on each level's own timers. Chris: "This can be different."
152. **Level 3 got easier, and is left that way for Chris to judge.** Raptors no longer run at troops they can't see, and a raptor darted from out of its cone comes alone, so massed troops pick them off one at a time. The roar gives spread-out troops time against the T. rex. SPEC section 13 has the numbers and the levers. Decision 163 has where level 3 stands after the pack hunt.

## Levels 4 and 5 after the design review

Chris had both levels reviewed and picked 15 fixes. He set the limits: in level 4 the obvious order failing is a feature, since players should have to think, and the game never tells the player ahead of time whether something is safe.

123. **A raptor hears a troop only at touching distance (0.6 tiles, was 1.2).** The old ring was drawn nowhere, so a troop sneaking behind a raptor was caught by a rule the screen never showed. A troop that close has walked into the raptor in plain view.
124. **A raptor takes 0.8 s to make out a troop in its cone.** It stops, its cone turns orange, and a ring fills at its feet. A troop out of sight before the ring is full is lost, and the ring drains at the same rate before the raptor walks on. A sighting used to be instant, so a troop that stepped a pixel into a cone was caught with no chance to react. The beat saves the level, not the star: the Engineer's star goes the moment a raptor notices it, so "never spotted" now means never noticed.
125. **A raptor darted by a troop it can't see comes alone.** One that sees who darted it calls the other, as before, and so does one that makes out a troop. Darted from outside its cone, it hunts the shooter alone, and a raptor already on the hunt calls nobody. A Tranq Squad beats one raptor, so an ambush from behind works, while darting one from inside its cone still brings both. Before, the squad's only use was to die as a decoy. A cone covers a quarter of the directions, so even a squad sent straight at a raptor usually reaches dart range unseen: in the scripted runs, 13 times in 16.
126. **Each raptor starts somewhere along its route, either way round,** picked by the seed. With fixed starts the opening played the same every time, so the way through could be learned instead of read off the cones.
127. **The north raptor walks a loop round the north substation:** up the east path, past its west side a tile out from where the Engineer stands, along the top, a look at its east side, and down the east edge. The old route left the east corridor and a lap round the map's edge unwatched, so the safe way never changed. Now every side is watched some of the time, with gaps of about 37 to 47 s. A loop over the work tiles themselves walked the raptor into the Engineer, so it keeps a tile out.
128. **Stop, an Engineer button, and side taps.** **Stop** halts the selected troops where they stand (H on a keyboard). It isn't called Hold, because the briefing already uses hold for press and drag. **Engineer** selects the Engineer and moves the camera to it, since a small figure in the dark is hard to tap. With the Engineer selected, a tap on a substation or a tile beside it sends the Engineer to the work tile nearest the tap, so the player picks the side; the game doesn't pick a safe one. Troops selected with the Engineer ignore that tap, so select all, then a substation, no longer walks the squad into the open.
129. **No troop flashlights in level 4 in 3D (every level from decision 148 to 162), and a ring at each raptor's feet.** Light means nothing to the raptors, so the beams hinted at a rule that isn't there and washed out the cones. A yellow ring marks the raptor at the tip of its cone, and an orange ring fills around it while it makes something out.
130. **Two raptors on the T. rex shield it from darts (`FIGHT.shieldRaptors`).** While two or more are on it, a dart doesn't lock it onto the shooter, and a lock it already has waits. With fewer, darts lock it on as before. Before, any dart on the T. rex pulled it off the raptors and onto a troop, so raptors first was the only sound order. Level 5 only.
131. **Heavy Teams get the 4x4's seats first.** With more troops sent than seats, the slowest get in, nearest first, and the rest walk over and stop beside it. The 4x4 is there to move Heavy Teams, and select all, then the 4x4, used to seat whoever got there first.
132. **The T. rex roars before it goes after a troop (`FIGHT.lockRoarSeconds`, 2 s).** When it locks on, it stops and faces the troop, and "Roar!" rises over it. The lock and the first charge used to come almost together, with no time to save the troop. Level 5 only, so the blackout's balance doesn't move. Every level since decision 146, and level 5 only again since decision 164.
133. **Level 5's south pasture has power, and the fight pushes at 20 px/s (was 12).** The fight heads west for the raptor pen the briefing names, instead of stopping at the south pasture on the way. At 12 px/s it reached the raptor pen too late to matter. Left alone, it breaks in at about 0:24 now, so a slow start lets three more raptors into the fight.
134. **Raptors have 100 health (was 150).** With the shield, darting the T. rex first cost nothing and won three stars every time. Now the T. rex kills a raptor every 15 s, so raptors die while the troops work on it, and darting the raptors first frees the T. rex for the troops. Each order costs a star unless the 4x4 decoys the T. rex. Health only matters in fights, so only level 5 changes.
135. **The decoy tip comes with the first roar.** It points at the troop the T. rex roared at: load it into the 4x4 and keep driving around nearby, and the T. rex chases the 4x4 while the others dart it. It used to come with the first charge, when the troop was already being hit.
136. **The camera goes back to the opening view once the opening tips are read,** in every mission level. Each tip moves the camera to what it's about, so the level used to start on the last tip's subject (in level 5, the 4x4) instead of the fight.
137. **Level 5's briefing picks up from level 4:** the two raptors from the night came back with a third, and the T. rex broke out through a fence still being fixed. It also says the fight is heading for the west raptor pen.
138. **Advice works its numbers out from the config.** The end screen said the T. rex kills a raptor "about every 30 s"; it now works the time out from raptor health and the T. rex's bite, which gives 15 s.
139. **The banner, toast, and tip say a raptor is after a troop, not that it saw one.** With the noticing beat, seeing comes first and gets its own tip; the hunt is what the player must answer. The tip also says whether the raptor called the other, since one darted from behind comes alone.
140. **The scripted sneak reacts each time it decides,** reading each raptor's next 2 s off its route by path, corners included. A planner that fixed a whole way through did worse: by the time it walked the plan, the raptors were somewhere else. New balance rows ambush the south raptor from behind, send the squad straight at it, and read only the cones as they are now. Level 5 adds the shield order (the most hurt raptor, then the T. rex) and the decoy loop.

## 3D levels 4 and 5

The 3D build offers every level, so levels 4 and 5 came to it with the same rules, HUD, and controls.

118. **The Engineer is the Worker from the CC0 people pack.** Its hard hat and vest are recoloured safety yellow and orange, and the game adds reflective bands and a red toolbox in the left hand. Only the men's Worker ships: level 4 has one Engineer, the two Workers look alike from the game's camera, and every level would load the second one for nothing (about 0.5 MB).
119. **Troops ride seated in the 4x4.** Each rider plays its own idle clip with its legs bent at the hip and knee, in the passenger seat and then the back. The driver is a Tranq Squad model that belongs to the vehicle, with no ring, bar, or shadow of its own. The 4x4's selection ring goes round the whole vehicle, at the same line weight as a troop's.
120. **Level 4 is night in 3D, and the lights come back by zone.** A fixed substation lights its pens' fences and the path lamps within 4 tiles of those pens. The rest of the park's lamps wait for the last one.
121. **The view cones are faint and fade toward their edge.** The 3D view blends colour in linear light, where the 2D game's 16% fill over dark grass came out as a solid amber sheet. At night the fill is 7% at the raptor and 30% of that at the far edge, with a thin outline where sight ends. A raptor after someone shows a red line to its prey and a red ring under it, as in 2D.
122. **Hurt animals flinch, and a killed one falls and stays down a few seconds**, like a troop, then fades away. A red health bar shows once an animal is hurt.

## Level 4: stealth

Chosen by Chris after the first build of levels 4 and 5: level 4 starts with raptors already out, the team is one Engineer and one light troop, and getting all the power back takes stealth and maybe self-sacrifice. He then picked sight cones on patrol routes, a win for the power alone, stars for no losses and never being spotted, and the pen timers kept with more time.

107. **A fixed team of one Engineer and one Tranq Squad, and no money.** HQ trains nothing, as in level 5. Losing the Engineer loses the level; losing the squad doesn't. This replaces the training and the spending star of decisions 90 and 98.
108. **Two raptors on patrol, not three on guard.** The east pen holds two, and each walks its own route: one circles the south substation a tile out from where the Engineer stands, and one walks the east path up and around the north substation. They replace the guards of decision 91.
109. **Raptors see in cones, and cover blocks them.** 90 degrees wide and 5 tiles long. Rock, pens, HQ, towers, and substations block sight; water and paths don't, so the pond is no hiding place. A troop within 1.2 tiles is heard whichever way the raptor looks (0.6 tiles since decision 123). The cones are drawn on the ground, so the rule can be read off the screen. Every level since decision 141.
110. **A raptor that spots a troop calls the other, wherever it is.** A lone Tranq Squad beats one raptor, and with packs that only answered nearby calls, picking them off one at a time made sneaking pointless. Now every fight is two against one, so using the squad means losing it: that's the self-sacrifice, and it costs the no-losses star. Decision 125 lets a raptor darted from behind come alone.
111. **A dart shows a raptor where the shooter is, once,** and a raptor that loses sight of its prey runs to where it last saw it. At first it held a grudge for 5 s and chased its prey's real position, which tracked a troop through walls.
112. **Idle troops hold fire at raptors that aren't after anyone.** Otherwise a squad waiting in cover darts a passing raptor on its own and gives itself away. An attack order still darts.
113. **Level 4 is won by the power alone.** Every substation fixed before dawn wins, whatever is still loose. With one Tranq Squad, darting everything was never the point.
114. **The stars are no troops lost and never spotted.** Never spotted counts any raptor noticing the Engineer, including one that bites it while chasing someone else.
115. **The timers moved later: the west raptors at 1:00 (was 0:40) and the T. rex at 1:50 (was 1:05).** Sneaking takes longer than walking. A careful script fixes the north substation at about 0:55, and one that decides only every 1.5 s at about 1:20. One that decides every 2 s is too slow, and the T. rex gets out first.
116. **The south pasture has power of its own.** The south raptor's route passes beside it. Without power, the passing raptor set its Triceratops running 15 to 25 times in two minutes, and they broke through the fence before 2:00: noise that had nothing to do with the level.
117. **The scripted sneak lives in `tests/stealth-player.ts`.** It moves only through tiles no raptor sees now or will in the next 2 s, read off their routes. The balance runs use it, and so does a test, so a route change that leaves no way through fails `npm test`.

## Levels 4 and 5

Chosen by Chris: level 4 is getting the power back on, with a new Engineer unit, right after level 3 (no guests, power still out, dinosaurs still loose). Level 5 is breaking up a fight between the T. rex and raptors that escaped: animals can be killed and the fight spreads, the team is fixed (no towers, no training), and a 4x4 moves Heavy Teams faster.

87. **Level 4's park is the blackout's dense T. rex park**, the one the balance runs use most: two raptor pens, the T. rex paddock, and two pastures. Level 5 uses the same park, so the two levels read as the same night and the next day.
88. **Each pen has its own power now.** Levels 1 and 2 have it everywhere; level 3 loses it everywhere and gets it back everywhere; level 4 gets it back one substation at a time; level 5 sets it per pen. A fixed substation does to its pens exactly what the end of the blackout does to all of them: animals inside are contained and the gaps seal.
89. **Level 4's pens break out at set times, not 10 and 18 s after the start.** With the blackout's times, the west raptors would be out before an Engineer could reach anything, so there would be no race. The pen's panel shows the time, so the race is visible.
90. **Engineers can't dart and ignore attack orders.** Select all, then tap an animal, sends the troops and leaves Engineers where they are, instead of walking them into the fight. Two Engineers at one substation add their work, and work done stays done, so losing one costs time, not progress.
91. **The south raptors guard the south substation** with level 2's nest rules (8 tiles to notice, 10 from the spot). Without a leash, loose raptors with no guests to chase run straight to HQ and kill each new troop as it walks out. A guarded spot puts the danger where the player has to go. Replaced by raptors on patrol (decision 108).
92. **A darted animal is taken away in levels 4 and 5,** as in level 3. Carrying it home (levels 1 and 2) would put it back behind a fence with no power.
93. **Level 5 sets power per pen.** A pen with power holds, as in levels 1 and 2, and the fight only goes for the dark ones. The dark pens are the ones at risk, and the player can see which they are.
94. **Fights happen in level 5 only.** In level 3 a loose T. rex and loose raptors still ignore each other, so its balance doesn't change.
95. **"Patrol 4x4", not "Jeep".** Jeep is a brand name, so the vehicle has a plain name and a look of its own: no seven-slot grille, no badges, and the team's navy and white.
96. **The 4x4 unloads wherever it stops,** and tapping an animal with it selected drops the troops 3.5 tiles away with an attack order. That covers getting out without a new button.
97. **Level 5's stars swap money for troops:** the win, no troops lost, and no animal killed. There's no money to spend in a level with a fixed team.
98. **Level 4's timers make one Engineer a close race** (replaced by decisions 107 and 115). The west raptors go for their fence at 0:40, and the T. rex at 1:05, behind a fence dented to 80 HP. Three raptors guard the south substation, dawn is 3:30 away, and the level starts with $20,000. In the scripted runs one Engineer and one Heavy Team win all 16 games with three stars, while sending Heavy Teams first, or the Engineer south first, loses all 16 (SPEC section 13).
99. **Level 5's team is 2 Heavy Teams and 2 Tranq Squads, with 3:00 on the clock.** Raptors have 150 health and the T. rex 1,200, so left alone the T. rex kills the first raptor at about 0:21 (100 health and about 0:12 since decision 134). Every main plan wins, so the stars carry the challenge: speed saves the animals, and the 4x4 saves the troops.
100. **Raptors circle the T. rex instead of stacking on one spot.** Each takes its own place around it, spread evenly, and the places turn slowly (`FIGHT.circleSpeed`). Stacked on one spot, a pack read as one animal.
101. **A tip says how to save the troop the T. rex picks.** The first time it locks on in level 5, a tip points at the orange ring: load that troop into the 4x4 and drive off. In the scripted runs that one move cut troop losses from about 2.4 of 4 to 0.2.
102. **The park lights follow the substations.** In level 4 the park stays dark until the last substation is fixed, while each pen's fence comes back with its own substation. Level 5 is by day.
103. **Troops in the 4x4 move with it in the same step,** wherever they come in the unit list, so a rider never trails its 4x4. The stress runs found the lag.
104. **A wandering animal drops a wander point it can no longer reach in a straight line.** A point picked before a chase could be behind a rock from where the animal ended up, and the T. rex walked into the rock. The stress runs found it.
105. **The level picker shows five levels in one row,** each with its number, name, and what it teaches stacked, so it doesn't wrap on a phone.
106. **Level 5 has no HQ button, and a tap on HQ is a tap on the map.** HQ trains nothing there, so a tap on it moves the selected troops instead of opening an empty panel.

## 3D level 3

Chosen by Chris: the blackout level in 3D too, after levels 1 and 2 played well there.

78. **The same game, drawn in 3D.** Building, the blackout, guests, and the end screen use the 2D game's rules, HUD, panels, and tips. The 3D build now offers all three levels.
79. **Building works as in 2D, with a preview on the ground.** Pick an exhibit or a tower and a preview appears near the middle of the view, green where it fits and red where it doesn't, showing the new path tiles and the viewing spot, or the tower's range. A tap on the map moves it; Build in the panel builds it. Tree tops thin out over the preview so it can be seen.
80. **The lights go out with the power.** Level 3 starts by day. When the power is cut, the park switches to the night lighting; when the power comes back, so does the day. The Night button still switches by hand, for testing.
81. **Building redraws only what changed.** The ground is redone just around the new pen, path, or tower, trees and plants are re-planned so they make room for it, and the shade under trees is redone a few tiles around it. HQ, the pond, and the nest are built once per park. Measured here, a build went from about 1.1 s of work to about 0.15 s; a phone is slower.
82. **Shaders are prepared while the loading screen is up.** Every animal, troop, guest, tower, fence look, and kind of tree and plant is drawn once by day and once by night before play. Without it, the first pen or the moment the power goes out froze while the GPU compiled. Loading takes longer: in the software renderer used for tests, about 18 s instead of 5.
83. **Guests are cheap to draw.** Six guest models instead of nine, each about a third of the triangles, with each guest's parts merged into one mesh in its own colours, so a guest is one draw call. The clips are shared within each pack. Guests cast no shadow of their own (a soft blob stands in, all of them in one draw call), and guests and animals off the screen aren't drawn or animated. In a busy test park with about 67 guests, a frame went from about 1,750 draw calls and 1.4 million triangles to about 400 and 0.7 million.
84. **Dropped clips are really dropped.** The model build left the data of unused animation clips in the files. Without it, troop models are about a third smaller, and the artifact is about 9.3 MB with the guests, down from 9.5 MB without them.
85. **Payments that land together show as one.** Guests often pay at the same deck at once, so a "+$" that would land on a fresh one adds to it instead of stacking.
86. **A killed guest falls and stays down a few seconds**, like a troop, then sinks away. Dust rises where something is built or reinforced.

## Stampedes go around things

Chosen by Chris, after playing the 3D slice: Triceratops got stuck in the terrain too easily, which made them easy to catch.

76. **A stampede turns along what it meets instead of stopping.** Rock, water, HQ, a tower, the edge of the map, and a fence while the power is on all count. It tries turns of 30, then 60, then 90 degrees, toward the side with more room, and never turns more than 90 degrees from straight away over the whole run. So a corner, or a second wall, still stops it, and cornering is still the skill. In the blackout a fence still takes the hit and stops it, as before. In level 1, 80% of stampedes used to end at once against something; now about 20% do, nearly all in corners (`DINO_AI.triSlideStepDeg`, `triSlideMaxDeg`).
77. **Level 1 got harder, and the clock stays at 2:30.** With one squad the scripted player now loses 3 of 16 games split (0:04 to 1:06 left) and wins with 0:01 to 0:47 left massed. Two squads earn three stars in 12 of 16 games split and 7 of 16 massed, down from all 16. These replace the numbers in decision 56. Walking home through the gap stays rare, about 0.3 to 0.4 per game. Level 2 and the blackout balance runs came out the same.

## 3D slice

Chosen by Chris: move toward real 3D, starting with a playable slice of levels 1 and 2 to test the look and frame rate on a phone. His notes on the first stills: a jungle T. rex paddock, faint eyes at night (in the eye, not in front of it), a Heavy Team that reads as power armour next to regular troops (then mostly white with blue accents, no shoulder pads), an HQ that doesn't look like a hospital, a detailed tower, fences that look stronger when reinforced and wrecked when destroyed, and a subtle selection ring.

64. **A separate build, not a replacement.** `slice.html` (`npm run dev:3d`, `npm run build:3d`) reuses the core, the HUD, and the controls, and draws with three.js. The 2D game is untouched, so both can be compared.
65. **CC0 models only**, all by Quaternius, plus textures generated here and gear built in code. The patrol car is built from shapes too, because the downloaded car had no license file with it. `public3d/LICENSES.md` has the sources.
66. **Gear is built per bone and skinned.** Caps, armour, and guns are made from smooth shells that follow each bone in the model's rest pose, then merged into one skinned mesh per kind of surface. A whole troop is three or four draw calls.
67. **Trees grow on open ground inside the park too**, thinning toward the middle, as in the stills Chris approved. Where a tree top would hide a troop or an animal, it fades to a fine dither. Troops get a soft contact shadow so they read as on the ground.
68. **The tower deck is 1.25 tiles up,** above a troop's head. At the old height a troop behind the tower seemed to float beside the gun.
69. **Eyes sit on the side of the head**, found from the head's own shape (a set share back from the snout and up from the jaw), because the models have no eyeballs.
70. **Only what the camera can see is drawn.** Trees, bushes, and grass outside the view (plus a margin on the sun's side for shadows) are skipped, and the shadow map is fitted to the view.
71. **High and Low quality.** High: up to 2x pixel density, antialiasing, bloom, sharper shadows, more grass, and a few shadow-casting night lights. Low: about 1.25x, no antialiasing or bloom, shadows from trees only, less grass, and no shadows from night lights. Switching rebuilds the view on a new canvas and keeps the game going, since the renderer's settings are fixed when it starts. The choice is remembered on the device when storage allows. After 6 seconds under 24 fps on High, a toast suggests Low, once.
72. **The Night switch is a test tool.** It changes the lighting only; levels 1 and 2 still play by day rules.
73. **No meshopt compression.** The models use packed vertices (KHR_mesh_quantization), which needs no decoder, because the artifact page may refuse the WebAssembly that meshopt decoding needs. The files are about twice as big.
74. **Panels stay on screen** when what they point at is off it (HQ scrolled away, say). This also applies to the 2D game.
75. **In the artifact, models travel as base64 text.** The artifact host serves text, images, and media, but no binary model files. The artifact build (`--mode artifact`) reads each model as a GLB in base64 (`.glb.txt`) and decodes it in the page; textures stay ordinary images. It adds about a third to the download, about 9.5 MB in all.

## Levels 1 and 2

Chosen by Chris: two levels before the blackout. Level 1 introduces training troops and moving them, by rounding up loose herbivores on a short clock. Level 2 introduces fighting, by clearing a nest of about six escaped raptors. Both start in a park that is already built. The blackout becomes level 3, which introduces building.

50. **Built, but not open yet.** No visitors in levels 1 and 2, so they are about troops alone and nothing in them can kill a guest. The clock runs until the park opens.
51. **The loose animals are the park's own.** In level 1, three of four pastures have one whole side down, corners standing, and their 6 Triceratops start near them. The fourth is whole, so the player sees what a full pasture looks like. In level 2, both raptor pens stand open and empty.
52. **Collecting means darting,** the game's one way to catch an animal. A darted animal fades as in level 3, then wakes up in its own pen, so the pens fill up as you go. One that walks back in through the gap counts too, since a powered fence keeps it in. Walking back is rare: about 0.3 per game with one squad, none with more.
53. **Each level adds tools.** Level 1 trains Tranq Squads only. A Heavy Team darts from 5 tiles, past the 4 tiles that make a Triceratops run. Measured over 8 games, one caught a Triceratops in about 11 s without making it run once, where a Tranq Squad took about 19 s and set off 92 runs. With Heavy Teams the chase, and the level, would go away. Level 2 adds Heavy Teams. Level 3 adds building.
54. **Level 2's raptors guard a nest.** With no visitors, today's raptors hunt the nearest troop anywhere, so each troop would be chased down as it left HQ. A nest raptor only goes for a troop within 8 tiles of itself (the usual hunt radius) and within 10 tiles of the nest, and runs home when nothing is in reach. There's no pack alarm. They wander within 2 tiles of the nest, so a troop that comes close is seen by most of them anyway. Since decision 141 they see and hunt like every raptor, with no leash (decision 144).
55. **Stars follow the same pattern as level 3: the win, money, and a clean run.** Level 1: all six back before the park opens, $4,500 or less on troops (two squads), and 1:00 or more left. Level 2: the nest clear before the park opens, $13,500 or less, and no troops lost. The money goal is about spending, since nothing earns money before the park opens. Time left counts the way the clock shows it, rounded up, and only on a win.
56. **The numbers come from scripted players** (`npm run balance`, 16 seeds; SPEC section 13). Level 1 at 2:30 and $9,000: one squad clears it with 0:35 to 1:02 left, and two squads earn three stars in every seed. The script gives orders twice a second, much faster than anyone taps, so expect people to need two or three squads. Level 2 at 4:00 and $21,000: Tranq Squads sent in as soon as they're trained all die, five together win but lose about two, and two Heavy Teams together win every time, without a loss in 9 of 16, for $12,000. The clock rarely matters there; the fight does.
57. **A level also ends when no troops are left,** none are training, and there isn't money for one. A lost fight shouldn't leave the player watching the clock run out.
58. **A level picker on the briefing, every level open, starting on level 1.** Picking one sets up its park behind the briefing. A win in level 1 or 2 offers Next level. Nothing is saved between visits, as before. `?level=N` opens on a level.
59. **The top bar follows the level.** Revenue becomes spending against the star's cap, red past it. Casualties become troops lost in level 2 and are hidden in level 1. The dinosaur count reads "loose · back". With nothing to build, HQ's button shows its label on phones.
60. **The camera shows HQ and every loose animal** when level 1 or 2 starts, like the blackout framing. A tip's camera move wins over it.
61. **Tips for the new levels** follow the old rules: once per session, and the game pauses. Level 1: how to train a squad, how to send it, and why Triceratops run. Level 2: the nest, and what raptors do to troops. Level 3's tips don't fire in levels 1 and 2.
62. **The timeline counts animals back.** Darts within 2 seconds of each other share a line, and the last line says how the level ended. Next time advice comes from the balance runs: train more squads, or corner them, in level 1; go in as one group, bring more, or lead with Heavy Teams in level 2.
63. Also fixed: the training panel could show queued troops left over from an earlier game, or from before the queue emptied while the panel was closed.

## Stars: one per goal

Chosen by Chris: one star for getting every dinosaur back without losing 8 guests, one for the revenue target, one for no guests lost.

45. **The stars no longer stack.** Before, ★★ needed the win and the revenue target, and ★★★ needed both plus nobody killed, so a win with nobody hurt but revenue short got one star. Now it gets two: the revenue and safety stars don't depend on each other. Earlier decisions that say ★★ mean the revenue target, and ★★★ still means all three. `npm run balance` came out identical, because every measured blackout park clears the target.
46. **A loss earns no stars,** even for goals it met. A shut-down or overrun park showing stars would read as a reward. The end screen still marks those goals met and says why their stars stay dark. This part wasn't specified.
47. **The goals are spelled out in three places:** the briefing (the full rules), the pause menu (how each one is going), and the end screen (met or missed, star lit or not). The top bar's revenue caption reads "★ at $20,000".

## Not chosen: the T. rex breaking pens open

48. **The audit's fix for the fixed breakout schedule, tested and dropped.** Measured with 16 seeds per defense and the scripted defenders. With raptors chewing slowly (0.6 per hit, about 1:15 to get out through chain-link) and the T. rex chasing only guests within 3 tiles, the dense T. rex park got much easier. 5 massed troops won all 16 games with three stars (they lose all 16 today), and every troop defense without concrete on every pen did the same. Spacing stopped mattering too: no deaths at 0, 3, or 7 tiles apart. The evacuation starts when the T. rex gets out at about 0:14, the raptors don't get out until the park is empty, and troops darting the T. rex keep it busy, so it rarely reaches a pen. With only the T. rex change and today's raptors, the raptors still got out on their own at about 0:21, before the T. rex reached them, so spacing still changed nothing, and 7 massed troops lost 7 of 16 games to overrun (none today).
49. **Spacing already matters some under today's rules.** With $60,000 to start, so every layout buys the same 7 or 8 troops: pens 3 tiles apart lost no guests in 32 games, packed pens lost at least one in 16 of 32, and pens 7 tiles apart lost the most and missed the revenue star. Why 3 tiles is safest hasn't been worked out.

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
10. **A tower fills its tile.** Troops and animals path around it, Triceratops stampedes turn along it (decision 76), and it can't be selected, boxed, or ordered. It doesn't count as a troop anywhere (Select all, troop counts, troops trained or lost).
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

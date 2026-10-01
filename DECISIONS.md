# Decisions

Calls made where SPEC.md was silent or where following it literally would have made things worse. Newest milestone first.

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
11. **Animals wander inside their pens.** Visual only for now, so you can tell exhibits apart at a glance.
12. **When a two-finger pinch ends with one finger still down,** that finger keeps panning instead of stopping.
13. **You can pan one tile past the map edge** so exhibits near the edge aren't stuck under the screen edge.

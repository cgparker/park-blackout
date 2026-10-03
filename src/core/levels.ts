import { HUNT, HUNTS, NEST, type HuntConfig, type HuntLevelId, type LevelId, type Side } from '../config';
import type { Dino } from './dinos';
import type { Exhibit } from './exhibit';
import { planPlacement } from './placement';
import type { World } from './world';

/** Levels 1 and 2 start in a built park with animals out. Level 3 is the blackout. */
export const isHuntLevel = (level: LevelId): level is HuntLevelId => level !== 3;

export function huntConfig(level: LevelId): HuntConfig | null {
  return isHuntLevel(level) ? HUNTS[level] : null;
}

/** Knocks down one side of a fence, corners left standing. */
export function openSide(ex: Exhibit, side: Side): void {
  const normal = { top: [0, -1], right: [1, 0], bottom: [0, 1], left: [-1, 0] }[side];
  for (const s of ex.segments) {
    if (!s.corner && s.nx === normal[0] && s.ny === normal[1]) s.hp = 0;
  }
  ex.version++;
}

/**
 * Builds the level's park for free, knocks down the open fences, and lets their animals out:
 * to the listed spots, or around the nest for raptors when the level has one.
 */
export function setupHunt(w: World, cfg: HuntConfig): void {
  const T = w.T;
  const nestRaptors: Dino[] = [];
  for (const p of cfg.park) {
    const plan = planPlacement(w.grid, p.kind, p.x, p.y, Infinity, w.countOf(p.kind));
    if (!plan.valid) throw new Error(`The level's ${p.kind} at ${p.x},${p.y} can't be built: ${plan.reason}`);
    const ex = w.addExhibit(plan);
    if (!p.open) continue;
    openSide(ex, p.open);
    w.dinos
      .filter((d) => d.home === ex.id)
      .forEach((d, i) => {
        if (w.nest && d.kind === 'raptor') {
          nestRaptors.push(d);
          return;
        }
        const spot = p.out?.[i];
        if (!spot) throw new Error(`The level's ${p.kind} at ${p.x},${p.y} has no spot for animal ${i + 1}.`);
        letOut(w, d, (spot[0] + 0.5) * T, (spot[1] + 0.5) * T, null);
      });
  }
  // Raptors spread out evenly around their nest.
  const nest = w.nest;
  nestRaptors.forEach((d, i) => {
    if (!nest) return;
    const a = (i / nestRaptors.length) * Math.PI * 2;
    const r = NEST.roamTiles * 0.6 * T;
    letOut(w, d, nest.x + Math.cos(a) * r, nest.y + Math.sin(a) * r, nest);
  });
}

function letOut(w: World, d: Dino, x: number, y: number, nest: Dino['nest']): void {
  const j = HUNT.jitterTiles * w.T;
  d.state = 'loose';
  d.x = x + (w.rng() * 2 - 1) * j;
  d.y = y + (w.rng() * 2 - 1) * j;
  d.nest = nest;
  d.target = null;
  d.path = [];
  d.pathIndex = 0;
  d.wander = null;
  d.think = 0;
  d.wait = w.rng() * 1.5;
}

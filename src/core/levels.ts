import { FENCE, GRID, MISSION, MISSIONS, NEST, type LevelId, type MissionConfig, type MissionLevelId, type Side } from '../config';
import type { Dino } from './dinos';
import type { Exhibit } from './exhibit';
import { Tile, type Point } from './grid';
import { planPlacement } from './placement';
import type { Substation } from './power';
import { createUnit } from './units';
import type { World } from './world';

/** Every level but the blackout (3) starts in a park that is already built. */
export const isMissionLevel = (level: LevelId): level is MissionLevelId => level !== 3;

export function missionConfig(level: LevelId): MissionConfig | null {
  return isMissionLevel(level) ? MISSIONS[level] : null;
}

const NORMALS: Record<Side, readonly [number, number]> = { top: [0, -1], right: [1, 0], bottom: [0, 1], left: [-1, 0] };

/** Side segments (not corners) of one side of a fence. */
function sideSegments(ex: Exhibit, side: Side) {
  const [nx, ny] = NORMALS[side];
  return ex.segments.filter((s) => !s.corner && s.nx === nx && s.ny === ny);
}

/** Knocks down one side of a fence, corners left standing. */
export function openSide(ex: Exhibit, side: Side): void {
  for (const s of sideSegments(ex, side)) s.hp = 0;
  ex.version++;
}

/** Dents one side of a fence down to `hp`. */
function dentSide(ex: Exhibit, side: Side, hp: number): void {
  for (const s of sideSegments(ex, side)) s.hp = Math.min(s.hp, hp);
  ex.version++;
}

/**
 * Builds the level's park for free, knocks down the open fences, and lets their animals out: to the listed spots,
 * around the nest for raptors when the level has one, or onto their patrol routes. Then the level's substations
 * and its team, if it has them.
 */
export function setupMission(w: World, cfg: MissionConfig): void {
  const T = w.T;
  const nestRaptors: Dino[] = [];
  const pens: Exhibit[] = [];
  for (const p of cfg.park) {
    const plan = planPlacement(w.grid, p.kind, p.x, p.y, Infinity, w.countOf(p.kind));
    if (!plan.valid) throw new Error(`The level's ${p.kind} at ${p.x},${p.y} can't be built: ${plan.reason}`);
    const ex = w.addExhibit(plan);
    pens.push(ex);
    let animals = w.dinos.filter((d) => d.home === ex.id);
    if (p.animals !== undefined && p.animals < animals.length) {
      // The rest were taken away before the level starts.
      const gone = new Set(animals.slice(p.animals));
      w.dinos = w.dinos.filter((d) => !gone.has(d));
      animals = animals.slice(0, p.animals);
    }
    if (p.dent) dentSide(ex, p.dent.side, p.dent.hp);
    if (p.cageHp !== undefined) {
      for (const s of ex.segments) s.hp = s.maxHp = p.cageHp;
      ex.reinforced = p.cageHp >= FENCE.concreteHp;
      ex.cage = true;
      ex.version++;
    }
    if (p.breakoutAt !== undefined) ex.breakoutAt = p.breakoutAt;
    ex.powered = p.powered ?? true;
    if (!p.open) continue;
    openSide(ex, p.open);
    animals.forEach((d, i) => {
      if (w.nest && d.kind === 'raptor') {
        nestRaptors.push(d);
        return;
      }
      const route = p.patrols?.[i];
      if (route?.length) {
        startPatrol(w, d, route);
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
    if (nest) spreadAround(w, d, nest, i, nestRaptors.length);
  });

  cfg.substations?.forEach((s, i) => w.substations.push(placeSubstation(w, i, s.name, s.tile, s.pens.map((k) => pens[k]))));
  for (const m of cfg.team ?? []) {
    const u = createUnit(w, m.kind, { x: (m.at[0] + 0.5) * T, y: (m.at[1] + 0.5) * T });
    u.facing = 0;
    w.teamSize += m.kind === 'jeep' ? 0 : 1;
  }
  // The park's own lights: off in level 4 until every substation is fixed. A pen without power is that pen's business.
  w.powerOn = w.substations.every((s) => s.fixed);
}

function spreadAround(w: World, d: Dino, at: Point, i: number, n: number): void {
  const a = (i / n) * Math.PI * 2;
  const r = NEST.roamTiles * 0.6 * w.T;
  letOut(w, d, at.x + Math.cos(a) * r, at.y + Math.sin(a) * r, at);
}

/** Puts a broken substation on the map. Its pens lose their power until it's fixed. */
function placeSubstation(w: World, i: number, name: string, tile: readonly [number, number], pens: Exhibit[]): Substation {
  const [x, y] = tile;
  const n = GRID.sizeTiles;
  for (let ty = y; ty < y + n; ty++) {
    for (let tx = x; tx < x + n; tx++) {
      if (!w.grid.inBounds(tx, ty) || w.grid.get(tx, ty) !== Tile.Grass) throw new Error(`The ${name} substation at ${x},${y} needs open grass.`);
      w.grid.set(tx, ty, Tile.Substation);
    }
  }
  for (const ex of pens) {
    ex.powered = false;
    ex.version++;
  }
  return { id: i + 1, name, x, y, pens: pens.map((e) => e.id), work: 0, workers: 0, fixed: false };
}

/**
 * Puts a raptor on its patrol route somewhere different each game: either way round, anywhere along it, so the
 * patrols have to be read, not remembered.
 */
function startPatrol(w: World, d: Dino, route: readonly (readonly [number, number])[]): void {
  const T = w.T;
  const stops = route.map(([x, y]) => ({ x: (x + 0.5) * T, y: (y + 0.5) * T }));
  if (w.rng() < 0.5) stops.reverse();
  d.patrol = stops;
  d.patrolDir = 1;
  if (stops.length < 2) {
    letOut(w, d, stops[0].x, stops[0].y, null);
    d.patrolIndex = 0;
    return;
  }
  // A point along a random leg, then on toward that leg's end. Legs are walked by path, so a straight line can
  // cross cover: slide back toward the leg's start until the point is on open ground.
  const from = Math.floor(w.rng() * stops.length);
  const to = (from + 1) % stops.length;
  const a = stops[from];
  const b = stops[to];
  const open = (p: { x: number; y: number }) => w.dinoWalk(Math.floor(p.x / T), Math.floor(p.y / T));
  let k = w.rng();
  let p = { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
  for (let i = 0; i < 8 && !open(p); i++) {
    k *= 0.5;
    p = { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
  }
  if (!open(p)) p = { x: a.x, y: a.y };
  letOut(w, d, p.x, p.y, null);
  if (!open(d)) {
    d.x = p.x;
    d.y = p.y;
  }
  d.patrolIndex = to;
  d.facing = Math.atan2(b.y - d.y, b.x - d.x);
}

function letOut(w: World, d: Dino, x: number, y: number, nest: Dino['nest']): void {
  const j = MISSION.jitterTiles * w.T;
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

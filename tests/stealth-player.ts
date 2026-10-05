// A scripted player for level 4, shared by the balance runs and the tests. It watches the raptors the way a careful
// person would: it moves the Engineer only through tiles no raptor sees now or in the next couple of seconds, waits
// in cover when there is no safe way on, and works from whichever side of a substation is out of sight.
import { MAP, STEALTH } from '../src/config';
import type { Dino } from '../src/core/dinos';
import { inReach, workTiles } from '../src/core/power';
import { lineOfSight } from '../src/core/stealth';
import { orderAttack, orderMove, orderRepair, type Unit } from '../src/core/units';
import { World } from '../src/core/world';

const T = MAP.tileSize;
const DEG = Math.PI / 180;
const angle = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

interface Pose {
  x: number;
  y: number;
  facing: number;
  /** At a stop, looking around: it may face anywhere in its sweep. */
  sweep: boolean;
}

/** Where a raptor on patrol is now and will be over the next few seconds, read off its route. */
function poses(d: Dino, ahead: readonly number[]): Pose[] {
  const out: Pose[] = [{ x: d.x, y: d.y, facing: d.look > 0 ? d.lookBase : d.facing, sweep: d.look > 0 }];
  const route = d.patrol;
  if (!route?.length) return out;
  for (const t of ahead) {
    let x = d.x;
    let y = d.y;
    let facing = d.facing;
    let left = t;
    let i = d.patrolIndex;
    let look = d.look;
    let sweep = false;
    for (let guard = 0; guard < 6 && left > 0; guard++) {
      if (look > 0) {
        const used = Math.min(look, left);
        look -= used;
        left -= used;
        sweep = true;
        if (look <= 0) {
          i = (i + 1) % route.length;
          sweep = left <= 0.3;
        }
        continue;
      }
      const stop = route[i];
      const dist = Math.hypot(stop.x - x, stop.y - y);
      const step = STEALTH.patrolSpeed * left;
      if (dist > 1e-6) facing = Math.atan2(stop.y - y, stop.x - x);
      if (step < dist) {
        x += ((stop.x - x) / dist) * step;
        y += ((stop.y - y) / dist) * step;
        left = 0;
        sweep = false;
      } else {
        x = stop.x;
        y = stop.y;
        left -= dist / STEALTH.patrolSpeed;
        look = STEALTH.lookSeconds;
        sweep = true;
      }
    }
    out.push({ x, y, facing, sweep });
  }
  return out;
}

/** Open tiles a raptor sees now or soon, with a margin (tiles) on its range and hearing, and 15 degrees a tile on its cone. */
export function exposedMap(w: World, margin: number, ahead: readonly number[] = [1, 2]): Uint8Array {
  const { cols, rows } = w.grid;
  const out = new Uint8Array(cols * rows);
  for (const d of w.dinos) {
    if (d.state !== 'loose' || d.kind === 'triceratops') continue;
    // Anything hunting, and the T. rex, is trouble anywhere near it.
    const hunting = d.kind === 'trex' || d.target?.type === 'unit';
    const list = hunting ? [] : poses(d, ahead);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (!w.unitWalk(x, y)) continue;
        const px = (x + 0.5) * T;
        const py = (y + 0.5) * T;
        if (hunting) {
          if (Math.hypot(px - d.x, py - d.y) < 8 * T) out[y * cols + x] = 1;
          continue;
        }
        for (const p of list) {
          const dist = Math.hypot(px - p.x, py - p.y);
          if (dist <= (STEALTH.hearTiles + margin) * T) {
            out[y * cols + x] = 1;
            break;
          }
          if (dist > (STEALTH.sightTiles + margin) * T) continue;
          const half = (STEALTH.coneDeg / 2 + margin * 15 + (p.sweep ? STEALTH.lookDeg : 0)) * DEG;
          if (angle(Math.atan2(py - p.y, px - p.x), p.facing) > half) continue;
          if (lineOfSight(w, p.x, p.y, px, py)) {
            out[y * cols + x] = 1;
            break;
          }
        }
      }
    }
  }
  return out;
}

/** Breadth-first search over tiles `pass` allows, from (sx, sy) to the nearest tile `goal` accepts. */
function search(w: World, sx: number, sy: number, pass: (x: number, y: number) => boolean, goal: (x: number, y: number) => boolean): { x: number; y: number }[] | null {
  const { cols, rows } = w.grid;
  const prev = new Int32Array(cols * rows).fill(-2);
  const queue = [sy * cols + sx];
  prev[queue[0]] = -1;
  for (let h = 0; h < queue.length; h++) {
    const i = queue[h];
    const x = i % cols;
    const y = (i - x) / cols;
    if (goal(x, y)) {
      const path: { x: number; y: number }[] = [];
      for (let k = i; k >= 0; k = prev[k]) path.push({ x: k % cols, y: Math.floor(k / cols) });
      return path.reverse();
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const ni = ny * cols + nx;
      if (prev[ni] !== -2 || !pass(nx, ny)) continue;
      if (dx && dy && (!pass(x + dx, y) || !pass(x, y + dy))) continue;
      prev[ni] = i;
      queue.push(ni);
    }
  }
  return null;
}

const goTo = (w: World, u: Unit, t: { x: number; y: number }) => orderMove(w, [u.id], (t.x + 0.5) * T, (t.y + 0.5) * T);

/**
 * One decision for the Engineer: work if it's beside the next broken substation and out of sight; otherwise walk a
 * tile or two along a path no raptor watches, to a work tile no raptor watches; otherwise hold still in cover, or
 * step back into it.
 */
export function sneakStep(w: World, e: Unit, margin: number): void {
  const goal = w.substations.find((s) => !s.fixed);
  if (!goal || e.dead) return;
  const bad = exposedMap(w, margin);
  const cols = w.grid.cols;
  const safe = (x: number, y: number) => w.unitWalk(x, y) && !bad[y * cols + x];
  const ex = Math.floor(e.x / T);
  const ey = Math.floor(e.y / T);
  const ring = new Set(workTiles(goal, w.unitWalk).map((t) => t.y * cols + t.x));
  const here = safe(ex, ey);
  const hold = () => {
    if (e.pathIndex < e.path.length) goTo(w, e, { x: ex, y: ey });
  };
  if (here && ring.has(ey * cols + ex) && inReach(goal, e.x, e.y, T)) {
    hold();
    return;
  }
  const path = search(w, ex, ey, (x, y) => safe(x, y) || (x === ex && y === ey), (x, y) => ring.has(y * cols + x) && safe(x, y));
  if (path && path.length > 1) {
    goTo(w, e, path[Math.min(2, path.length - 1)]);
    return;
  }
  if (here) {
    hold();
    return;
  }
  const out = search(w, ex, ey, (x, y) => w.unitWalk(x, y), safe);
  if (out && out.length > 1) goTo(w, e, out[Math.min(2, out.length - 1)]);
}

export interface GridPlan {
  /** 'sneak' moves the Engineer as above. 'rush' sends it straight to each substation in turn. */
  engineer: 'sneak' | 'rush';
  /** Seconds between decisions, like a person's reaction time. */
  every?: number;
  /** Extra tiles of caution around what the raptors see. */
  margin?: number;
  /**
   * 'home': the Tranq Squad stays at HQ. 'decoy': once the north substation is fixed, it walks into the south
   * raptor's view, and while the raptors chase it the Engineer goes straight to the south substation.
   * 'dart': once the north one is fixed, it attacks the south raptor, and the Engineer does the same.
   */
  squad?: 'home' | 'decoy' | 'dart';
}

export interface GridRun {
  world: World;
  /** Seconds into the level each substation was fixed. */
  fixed: number[];
  /** When a raptor first saw the Engineer, or -1. */
  seenAt: number;
}

/** Plays level 4 to the end with a plan. */
export function playGrid(seed: number, plan: GridPlan): GridRun {
  const w = new World({ seed, level: 4 });
  w.start();
  const e = w.units.find((u) => u.kind === 'engineer')!;
  const squad = w.units.find((u) => u.kind === 'tranq')!;
  const southRaptor = w.dinos.find((d) => d.state === 'loose' && d.patrol)!;
  const fixed: number[] = [];
  let seenAt = -1;
  let next = 0;
  let sent = false;
  while (w.phase !== 'ended') {
    w.update(1 / 60);
    for (const ev of w.events) {
      if (ev.type === 'substationFixed') fixed.push(w.phaseTime);
      if (ev.type === 'spotted' && ev.kind === 'engineer' && seenAt < 0) seenAt = w.phaseTime;
    }
    w.events = [];
    if (w.time < next || e.dead) continue;
    next = w.time + (plan.every ?? 0.5);
    const goal = w.substations.find((s) => !s.fixed);
    const south = goal === w.substations[2];
    if (!squad.dead && south && !sent && plan.squad && plan.squad !== 'home') {
      if (plan.squad === 'decoy') orderMove(w, [squad.id], 27.5 * T, 16.5 * T);
      else orderAttack(w, [squad.id], southRaptor.id);
      sent = true;
    }
    // While the raptors are after the squad, the Engineer can go straight in.
    const busy = sent && !squad.dead && w.dinos.some((d) => d.state === 'loose' && d.target?.type === 'unit' && d.target.id === squad.id);
    if (plan.engineer === 'rush' || busy) {
      if (goal && (e.order !== 'repair' || e.targetId !== goal.id)) orderRepair(w, [e.id], goal.id);
    } else sneakStep(w, e, plan.margin ?? 1);
  }
  return { world: w, fixed, seenAt };
}

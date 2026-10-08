// A scripted player for level 4, shared by the balance runs and the tests. It watches the raptors the way a careful
// person would: it moves the Engineer only through tiles no raptor sees now or in the next couple of seconds, waits
// in cover when there is no safe way on, and works from whichever side of a substation is out of sight.
import { MAP, STEALTH, UNITS } from '../src/config';
import type { Dino } from '../src/core/dinos';
import type { Point } from '../src/core/grid';
import { findPath, lineClear, toWaypoints } from '../src/core/nav';
import { inReach, workTiles } from '../src/core/power';
import { inView, lineOfSight } from '../src/core/stealth';
import { orderAttack, orderBoard, orderMove, orderRepair, type Unit } from '../src/core/units';
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

/**
 * The way a raptor walks from one point to another: straight when it can see the way, otherwise the shortest path
 * pulled tight, the way `followPath` straightens it.
 */
function legPath(w: World, from: Point, to: Point): Point[] {
  const walk = w.dinoWalk;
  if (lineClear(walk, T, from.x, from.y, to.x, to.y, 0)) return [to];
  const tiles = findPath(w.grid.cols, w.grid.rows, walk, Math.floor(from.x / T), Math.floor(from.y / T), Math.floor(to.x / T), Math.floor(to.y / T));
  const pts = [...toWaypoints(tiles, T), to];
  const out: Point[] = [];
  let at = from;
  let i = 0;
  while (i < pts.length) {
    let j = pts.length - 1;
    while (j > i && !lineClear(walk, T, at.x, at.y, pts[j].x, pts[j].y, 0)) j--;
    out.push(pts[j]);
    at = pts[j];
    i = j + 1;
  }
  return out;
}

const mid = ([lo, hi]: readonly [number, number]) => (lo + hi) / 2;

/**
 * Where a raptor on patrol is now and will be at each time ahead (ascending), walking its route the way it does. Its
 * routes are loose, so this is a guess past what it's doing now: it reckons on the next stop the way it's going, with
 * an average look at each, as a person who has watched it a while would.
 */
function poses(w: World, d: Dino, ahead: readonly number[]): Pose[] {
  const out: Pose[] = [{ x: d.x, y: d.y, facing: d.look > 0 ? d.lookBase : d.facing, sweep: d.look > 0 }];
  const route = d.patrol;
  if (!route?.length || d.target) return out;
  let x = d.x;
  let y = d.y;
  let facing = d.facing;
  let look = d.look;
  // A raptor making something out stands still until it settles.
  let hold = d.notice;
  let i = d.patrolIndex;
  // Partway along a leg, or off sniffing, it goes there first.
  let detour = d.wander;
  const goal = () => detour ?? route[i];
  let pts = look > 0 ? [] : d.pathIndex < d.path.length ? [...d.path.slice(d.pathIndex), goal()] : legPath(w, d, goal());
  let t = 0;
  for (const target of ahead) {
    let left = target - t;
    let sweep = look > 0;
    for (let guard = 0; guard < 64 && left > 1e-9; guard++) {
      if (hold > 0) {
        const used = Math.min(hold, left);
        hold -= used;
        left -= used;
        continue;
      }
      if (look > 0) {
        const used = Math.min(look, left);
        look -= used;
        left -= used;
        sweep = true;
        if (look <= 0) {
          if (detour) detour = null;
          else i = (i + d.patrolDir + route.length) % route.length;
          pts = legPath(w, { x, y }, route[i]);
          sweep = left <= 0.3;
        }
        continue;
      }
      const p = pts[0];
      if (!p) {
        look = mid(detour ? STEALTH.pauseSeconds : STEALTH.lookSeconds);
        continue;
      }
      const dist = Math.hypot(p.x - x, p.y - y);
      const step = STEALTH.patrolSpeed * left;
      if (dist > 1e-6) facing = Math.atan2(p.y - y, p.x - x);
      if (step < dist) {
        x += ((p.x - x) / dist) * step;
        y += ((p.y - y) / dist) * step;
        left = 0;
        sweep = false;
      } else {
        x = p.x;
        y = p.y;
        left -= dist / STEALTH.patrolSpeed;
        pts.shift();
        if (!pts.length) {
          look = mid(detour ? STEALTH.pauseSeconds : STEALTH.lookSeconds);
          sweep = true;
        }
      }
    }
    t = target;
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
    const list = hunting ? [] : poses(w, d, ahead);
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
 * One decision for the Engineer: work if it's beside the next broken substation and out of sight now and for the next
 * 2 s; otherwise walk a tile or two along a path no raptor watches, to a work tile no raptor watches; otherwise hold
 * still in cover, or step back into it. With `foresight` off it judges by what the cones show now, like a person who
 * hasn't learned the routes.
 */
export function sneakStep(w: World, e: Unit, margin: number, foresight = true): void {
  const goal = w.substations.find((s) => !s.fixed);
  if (!goal || e.dead) return;
  const bad = exposedMap(w, margin, foresight ? [1, 2] : []);
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
  /** Whether the sneak knows where each raptor will be in the next 2 s (true), or only sees the cones now. */
  foresight?: boolean;
  /**
   * 'home': the Tranq Squad stays at HQ. 'decoy': once the north substation is fixed, it walks into the south
   * raptor's view, and while the raptors chase it the Engineer goes straight to the south substation.
   * 'dart': once the north one is fixed, it's sent straight at the south raptor with no care for its cone, and the
   * Engineer goes in while the raptors are busy. Most ways in reach dart range from outside the cone.
   * 'ambush': once the north one is fixed, it creeps up behind the south raptor, out of its cone, and darts it from
   * there, so it comes alone; the Engineer goes in while it's busy.
   */
  squad?: 'home' | 'decoy' | 'dart' | 'ambush';
  /**
   * The Patrol 4x4. Unused, it stays parked and quiet. 'ride': once the west substation is fixed, the Engineer rides it
   * to a drop point well short of the north substation, then sneaks on from there. 'lure': once the north one is fixed,
   * the Tranq Squad drives it back and forth east of the south substation, engine running, to draw the raptors that
   * hear it, while the Engineer sneaks in from the west; then it drives home.
   */
  jeep?: 'ride' | 'lure';
}

/** Where the 4x4 drops the Engineer for the north substation, and the two ends of its lure run by the south one. */
const RIDE_DROP = { x: 20.5 * T, y: 1.5 * T };
const LURE = [
  { x: 33.5 * T, y: 21.5 * T },
  { x: 37.5 * T, y: 19.5 * T },
];

export interface GridRun {
  world: World;
  /** Seconds into the level each substation was fixed. */
  fixed: number[];
  /** When a raptor first noticed the Engineer (which costs the star), or -1. */
  seenAt: number;
}

/**
 * One step of the squad's ambush: get three tiles behind the raptor, where its cone doesn't reach even when it looks
 * around, and dart it once it's in range there. Returns true once the dart is ordered (or the raptor is gone).
 */
function ambush(w: World, squad: Unit, d: Dino): boolean {
  if (d.state !== 'loose') return true;
  const dist = Math.hypot(squad.x - d.x, squad.y - d.y);
  const unseen = !inView(w, d, squad.x, squad.y) && d.notice <= 0 && !d.target;
  if (unseen && dist <= UNITS.tranq.range - 12 && dist > (STEALTH.hearTiles + 0.5) * T && lineOfSight(w, squad.x, squad.y, d.x, d.y)) {
    orderAttack(w, [squad.id], d.id);
    return true;
  }
  const facing = d.look > 0 ? d.lookBase : d.facing;
  for (const back of [3, 2.5, 3.5]) {
    const x = d.x - Math.cos(facing) * back * T;
    const y = d.y - Math.sin(facing) * back * T;
    if (w.unitWalk(Math.floor(x / T), Math.floor(y / T))) {
      orderMove(w, [squad.id], x, y);
      break;
    }
  }
  return false;
}

/** Plays level 4 to the end with a plan. */
export function playGrid(seed: number, plan: GridPlan): GridRun {
  const w = new World({ seed, level: 4 });
  w.start();
  const e = w.units.find((u) => u.kind === 'engineer')!;
  const squad = w.units.find((u) => u.kind === 'tranq')!;
  const jeep = w.units.find((u) => u.kind === 'jeep')!;
  const southRaptor = w.dinos.find((d) => d.state === 'loose' && d.patrol)!;
  const fixed: number[] = [];
  let seenAt = -1;
  let next = 0;
  let sent = false;
  let home = false;
  // 'ride': 0 waiting, 1 climbing in, 2 driving, 3 dropped. 'lure': 0 waiting, 1 climbing in, 2 running, 3 going home.
  let ride = 0;
  let leg = 0;
  while (w.phase !== 'ended') {
    w.update(1 / 60);
    for (const ev of w.events) {
      if (ev.type === 'substationFixed') fixed.push(w.phaseTime);
      if ((ev.type === 'noticed' || ev.type === 'spotted') && ev.kind === 'engineer' && seenAt < 0) seenAt = w.phaseTime;
    }
    w.events = [];
    if (w.time < next || e.dead) continue;
    next = w.time + (plan.every ?? 0.5);
    const goal = w.substations.find((s) => !s.fixed);
    const south = goal === w.substations[2];
    if (!squad.dead && south && !sent && plan.squad === 'ambush') sent = ambush(w, squad, southRaptor);
    // Once the ambushed raptor is down, the squad goes back to HQ before the other one finds it.
    else if (!squad.dead && sent && plan.squad === 'ambush' && southRaptor.state !== 'loose' && squad.order !== 'move' && !home) {
      orderMove(w, [squad.id], 5.5 * T, 17.5 * T);
      home = true;
    }
    else if (!squad.dead && south && !sent && plan.squad && plan.squad !== 'home') {
      if (plan.squad === 'decoy') orderMove(w, [squad.id], 27.5 * T, 16.5 * T);
      else orderAttack(w, [squad.id], southRaptor.id);
      sent = true;
    }
    if (plan.jeep === 'ride' && !jeep.dead && goal === w.substations[1]) {
      if (ride === 0) {
        orderBoard(w, [e.id], jeep.id);
        ride = 1;
      } else if (ride === 1 && e.aboard) {
        orderMove(w, [jeep.id], RIDE_DROP.x, RIDE_DROP.y);
        ride = 2;
      } else if (ride === 2 && !e.aboard) ride = 3;
      if (ride < 3) continue;
    }
    if (plan.jeep === 'lure' && !jeep.dead && !squad.dead) {
      if (south && ride === 0) {
        orderBoard(w, [squad.id], jeep.id);
        ride = 1;
      } else if (ride === 1 && squad.aboard) ride = 2;
      if (ride === 2 && jeep.order === 'idle') {
        if (!south) {
          orderMove(w, [jeep.id], 6.5 * T, 17.5 * T);
          ride = 3;
        } else {
          const p = LURE[leg++ % LURE.length];
          orderMove(w, [jeep.id], p.x, p.y);
        }
      }
    }
    // While the raptors are after the squad, the Engineer can go straight in.
    const busy = sent && !squad.dead && w.dinos.some((d) => d.state === 'loose' && d.target?.type === 'unit' && d.target.id === squad.id);
    if (plan.engineer === 'rush' || busy) {
      if (goal && (e.order !== 'repair' || e.targetId !== goal.id)) orderRepair(w, [e.id], goal.id);
    } else sneakStep(w, e, plan.margin ?? 1, plan.foresight ?? true);
  }
  return { world: w, fixed, seenAt };
}

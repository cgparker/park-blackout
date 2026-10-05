import { COMBAT, GRID, JEEP, SQUAD, UNITS, type UnitKind } from '../config';
import { sedate } from './combat';
import type { Dino } from './dinos';
import type { Point } from './grid';
import { board, passengers, seatsFree, unload } from './jeep';
import { findPath, followPath, nearestOpenTile, toWaypoints, type PathFollower } from './nav';
import { inReach, substationCenter, workTiles, type Substation } from './power';
import type { World } from './world';

/** People on foot: Tranq Squads, Heavy Teams, and Engineers. Not towers, and not the 4x4. */
export const isTroop = (u: Unit): boolean => u.kind !== 'tower' && u.kind !== 'jeep';

/** On the map and alive: not lost, and not riding in the 4x4. */
export const onMap = (u: Unit): boolean => !u.dead && !u.aboard;

/** What the player can select and order: troops and the 4x4, on the map. Towers never take orders. */
export const canCommand = (u: Unit): boolean => u.kind !== 'tower' && onMap(u);

/** Units that fire darts. Engineers and the 4x4 don't. */
export const canDart = (kind: UnitKind): boolean => UNITS[kind].dartSedation > 0;

export type UnitOrder = 'idle' | 'move' | 'attack' | 'repair' | 'board';

export interface Unit extends PathFollower {
  id: number;
  kind: UnitKind;
  hp: number;
  maxHp: number;
  order: UnitOrder;
  /** Dinosaur id for attack orders, substation id for repair orders, the 4x4's id for board orders. */
  targetId: number;
  /** Where a move order (or a repair order) is headed. */
  dest: Point | null;
  repath: number;
  cooldown: number;
  hurtAt: number;
  dead: boolean;
  /** The 4x4 this troop is riding in, 0 when on foot. */
  aboard: number;
}

export interface QueueItem {
  id: number;
  kind: UnitKind;
  /** Seconds of training left. */
  left: number;
}

export function canTrainNow(w: World): boolean {
  return w.phase === 'build' || w.phase === 'blackout' || w.phase === 'restored' || w.phase === 'mission';
}

/** Pays up front and adds a unit to the HQ queue. Each level says which troops HQ can train. */
export function enqueueUnit(w: World, kind: UnitKind): boolean {
  const cost = UNITS[kind].cost;
  if (!canTrainNow(w) || !w.trainable.includes(kind) || w.queue.length >= SQUAD.queueMax || w.money < cost) return false;
  w.money -= cost;
  w.spending.troops += cost;
  w.queue.push({ id: w.newId(), kind, left: UNITS[kind].trainSeconds });
  return true;
}

/** Removes a queued unit and refunds it in full. */
export function cancelQueued(w: World, queueId: number): boolean {
  const i = w.queue.findIndex((q) => q.id === queueId);
  if (i < 0) return false;
  const cost = UNITS[w.queue[i].kind].cost;
  w.money += cost;
  w.spending.troops -= cost;
  w.queue.splice(i, 1);
  return true;
}

export function updateTraining(w: World, dt: number): void {
  if (!canTrainNow(w)) return;
  const head = w.queue[0];
  if (!head) return;
  head.left -= dt;
  if (head.left > 0) return;
  w.queue.shift();
  spawnUnit(w, head.kind);
}

/** A troop walks out of HQ (or appears at `at`, for tests). */
export function spawnUnit(w: World, kind: UnitKind, at?: Point): Unit {
  const u = createUnit(w, kind, at ?? spawnPoint(w));
  w.troopsTrained++;
  w.events.push({ type: 'trained', unitId: u.id, kind });
  return u;
}

/** Adds a unit to the world. Towers come through here too, from World.buildTower, and level 5's team. */
export function createUnit(w: World, kind: UnitKind, p: Point): Unit {
  const cfg = UNITS[kind];
  const u: Unit = {
    id: w.newId(),
    kind,
    x: p.x,
    y: p.y,
    facing: 0,
    path: [],
    pathIndex: 0,
    hp: cfg.hp,
    maxHp: cfg.hp,
    order: 'idle',
    targetId: 0,
    dest: null,
    repath: 0,
    cooldown: 0,
    hurtAt: -Infinity,
    dead: false,
    aboard: 0,
  };
  w.units.push(u);
  return u;
}

/** The open tile around HQ with the fewest troops on it. */
function spawnPoint(w: World): Point {
  const T = w.T;
  const { x, y, w: hw, h: hh } = w.map.hq;
  const ring: Point[] = [];
  for (let ty = y; ty < y + hh; ty++) ring.push({ x: x + hw, y: ty });
  for (let tx = x + hw - 1; tx >= x; tx--) ring.push({ x: tx, y: y + hh });
  for (let tx = x; tx < x + hw; tx++) ring.push({ x: tx, y: y - 1 });
  for (let ty = y; ty < y + hh; ty++) ring.push({ x: x - 1, y: ty });

  let best: Point | null = null;
  let bestCount = Infinity;
  for (const t of ring) {
    if (!w.unitWalk(t.x, t.y)) continue;
    const cx = (t.x + 0.5) * T;
    const cy = (t.y + 0.5) * T;
    let count = 0;
    for (const u of w.units) if (onMap(u) && isTroop(u) && Math.hypot(u.x - cx, u.y - cy) < T * 0.7) count++;
    if (count < bestCount) {
      bestCount = count;
      best = { x: cx, y: cy };
    }
  }
  if (!best) {
    const t = nearestOpenTile(w.grid.cols, w.grid.rows, w.unitWalk, x + hw, y) ?? { x: x + hw, y };
    best = { x: (t.x + 0.5) * T, y: (t.y + 0.5) * T };
  }
  return { x: best.x + (w.rng() - 0.5) * 8, y: best.y + (w.rng() - 0.5) * 8 };
}

/** Darts only fly once animals are out: in the blackout and after, and in mission levels. Animals behind their own fence are out of reach. */
export function isTargetable(w: World, d: Dino): boolean {
  if (w.phase !== 'blackout' && w.phase !== 'restored' && w.phase !== 'mission') return false;
  return d.state === 'loose' || (COMBAT.dartPennedAnimals && d.state === 'penned');
}

/** Sends troops (and the 4x4) to a spot, spread out in a loose grid so they don't stack. */
export function orderMove(w: World, ids: Iterable<number>, x: number, y: number): void {
  const units = liveUnits(w, ids);
  if (!units.length) return;
  const free = [...units];
  for (const slot of formationSlots(w, x, y, units.length)) {
    let bi = 0;
    let bd = Infinity;
    free.forEach((u, i) => {
      const d = (u.x - slot.x) ** 2 + (u.y - slot.y) ** 2;
      if (d < bd) {
        bd = d;
        bi = i;
      }
    });
    const u = free.splice(bi, 1)[0];
    u.order = 'move';
    u.targetId = 0;
    u.dest = slot;
    planRoute(w, u, slot.x, slot.y);
  }
}

/**
 * A new exhibit just went down. Troops standing on it step off to the nearest open tile,
 * and anyone walking gets a fresh route so nobody walks through the new pen.
 */
export function unitsAfterBuild(w: World): void {
  const T = w.T;
  for (const u of w.units) {
    if (!canCommand(u)) continue;
    const tx = Math.floor(u.x / T);
    const ty = Math.floor(u.y / T);
    if (!w.unitWalk(tx, ty)) {
      const t = nearestOpenTile(w.grid.cols, w.grid.rows, w.unitWalk, tx, ty);
      if (t) {
        u.x = (t.x + 0.5) * T;
        u.y = (t.y + 0.5) * T;
      }
    }
    if (u.order === 'move' && u.dest) {
      const d = u.dest;
      if (!w.unitWalk(Math.floor(d.x / T), Math.floor(d.y / T))) {
        const t = nearestOpenTile(w.grid.cols, w.grid.rows, w.unitWalk, Math.floor(d.x / T), Math.floor(d.y / T));
        if (t) u.dest = { x: (t.x + 0.5) * T, y: (t.y + 0.5) * T };
      }
      planRoute(w, u, u.dest.x, u.dest.y);
    } else if (u.order === 'attack') {
      u.repath = 0;
    } else {
      u.path = [];
      u.pathIndex = 0;
    }
  }
}

/**
 * Troops chase the dinosaur and dart it until it is secured. Engineers can't dart, so they stay where they are.
 * The 4x4 drives at it and drops its troops within JEEP.dropTiles.
 */
export function orderAttack(w: World, ids: Iterable<number>, dinoId: number): void {
  for (const u of liveUnits(w, ids)) {
    if (!canDart(u.kind) && u.kind !== 'jeep') continue;
    u.order = 'attack';
    u.targetId = dinoId;
    u.dest = null;
    u.repath = 0;
    u.path = [];
    u.pathIndex = 0;
  }
}

/**
 * Level 4: Engineers walk to the open tiles around a substation, one each, and fix it.
 * Anyone else in the group goes along and stands guard around it.
 */
export function orderRepair(w: World, ids: Iterable<number>, substationId: number): void {
  const s = w.substationById(substationId);
  if (!s) return;
  const units = liveUnits(w, ids);
  const engineers = units.filter((u) => u.kind === 'engineer');
  const others = units.filter((u) => u.kind !== 'engineer');
  const c = substationCenter(s, w.T);
  if (others.length) orderMove(w, others.map((u) => u.id), c.x, c.y);
  if (s.fixed) {
    if (engineers.length) orderMove(w, engineers.map((u) => u.id), c.x, c.y);
    return;
  }
  const spots = workTiles(s, w.unitWalk).map((t) => ({ x: (t.x + 0.5) * w.T, y: (t.y + 0.5) * w.T }));
  // Spots another Engineer is already headed for are taken.
  const taken = new Set(
    w.units.filter((u) => u.kind === 'engineer' && u.order === 'repair' && u.targetId === s.id && !engineers.includes(u) && u.dest).map((u) => `${u.dest!.x},${u.dest!.y}`),
  );
  const free = spots.filter((p) => !taken.has(`${p.x},${p.y}`));
  for (const u of engineers) {
    const pool = free.length ? free : spots;
    let bi = 0;
    let bd = Infinity;
    pool.forEach((p, i) => {
      const d = Math.hypot(p.x - u.x, p.y - u.y);
      if (d < bd) {
        bd = d;
        bi = i;
      }
    });
    const spot = pool[bi] ?? c;
    if (free.length) free.splice(bi, 1);
    u.order = 'repair';
    u.targetId = s.id;
    u.dest = spot;
    planRoute(w, u, spot.x, spot.y);
  }
}

/** Level 5: troops walk to the 4x4 and climb in, as long as there are seats. */
export function orderBoard(w: World, ids: Iterable<number>, jeepId: number): void {
  const jeep = w.unitById(jeepId);
  if (!jeep || jeep.dead || jeep.kind !== 'jeep') return;
  for (const u of liveUnits(w, ids)) {
    if (!isTroop(u)) continue;
    u.order = 'board';
    u.targetId = jeep.id;
    u.dest = null;
    u.repath = 0;
    u.path = [];
    u.pathIndex = 0;
  }
}

export function updateUnits(w: World, dt: number): void {
  for (const u of w.units) {
    if (u.dead) continue;
    if (u.aboard) {
      ride(w, u);
      continue;
    }
    const cfg = UNITS[u.kind];
    u.cooldown = Math.max(0, u.cooldown - dt);
    u.repath -= dt;

    if (u.kind === 'jeep') {
      drive(w, u, dt);
      continue;
    }

    if (u.order === 'attack') {
      const d = w.dinoById(u.targetId);
      if (!d || !isTargetable(w, d)) {
        u.order = 'idle';
        u.path = [];
        u.pathIndex = 0;
      } else {
        const dist = Math.hypot(d.x - u.x, d.y - u.y);
        if (dist > cfg.range * SQUAD.approachFraction) {
          if (u.repath <= 0) {
            planRoute(w, u, d.x, d.y);
            u.repath = SQUAD.repathSeconds;
          }
          if (followPath(u, cfg.speed, dt, w.unitWalk, w.T, cfg.radius) === 'blocked') u.repath = 0;
        } else {
          u.path = [];
          u.pathIndex = 0;
        }
        if (dist <= cfg.range) {
          u.facing = Math.atan2(d.y - u.y, d.x - u.x);
          if (u.cooldown <= 0) fire(w, u, d);
        }
      }
    } else if (u.order === 'move' || u.order === 'repair') {
      const s = u.order === 'repair' ? w.substationById(u.targetId) : undefined;
      if (u.order === 'repair' && (!s || s.fixed)) {
        u.order = 'idle';
        u.dest = null;
      } else if (u.pathIndex < u.path.length) {
        const result = followPath(u, cfg.speed, dt, w.unitWalk, w.T, cfg.radius);
        if (result === 'arrived' && u.order === 'move') {
          u.order = 'idle';
          u.dest = null;
        } else if (result === 'blocked' && u.dest) {
          planRoute(w, u, u.dest.x, u.dest.y);
        }
      } else if (u.order === 'move') {
        u.order = 'idle';
        u.dest = null;
      }
    } else if (u.order === 'board') {
      walkToJeep(w, u, dt);
      if (u.aboard) continue;
    }

    if (u.order === 'idle' && canDart(u.kind)) {
      const d = autoTarget(w, u);
      if (d) {
        u.facing = Math.atan2(d.y - u.y, d.x - u.x);
        if (u.cooldown <= 0) fire(w, u, d);
      }
    }
  }
  if (w.substations.length) repairs(w, dt);
  separate(w);
  // Riders go where the 4x4 went this step, whichever of them came first in the list.
  for (const u of w.units) if (u.aboard && !u.dead) ride(w, u);
}

/** A troop in the 4x4 rides along. If the 4x4 is gone, it's already been put out on foot. */
function ride(w: World, u: Unit): void {
  const jeep = w.unitById(u.aboard);
  if (!jeep || jeep.dead) {
    u.aboard = 0;
    return;
  }
  u.x = jeep.x;
  u.y = jeep.y;
  u.facing = jeep.facing;
}

/** A troop told to get in walks to the 4x4 and climbs in when it's close, or gives up when it's full. */
function walkToJeep(w: World, u: Unit, dt: number): void {
  const jeep = w.unitById(u.targetId);
  if (!jeep || jeep.dead || jeep.kind !== 'jeep' || seatsFree(w, jeep) <= 0) {
    u.order = 'idle';
    u.targetId = 0;
    u.path = [];
    u.pathIndex = 0;
    return;
  }
  const reach = UNITS.jeep.radius + UNITS[u.kind].radius + JEEP.boardReachPx;
  if (Math.hypot(jeep.x - u.x, jeep.y - u.y) <= reach) {
    board(w, u, jeep);
    return;
  }
  if (u.repath <= 0) {
    planRoute(w, u, jeep.x, jeep.y);
    u.repath = SQUAD.repathSeconds;
  }
  if (followPath(u, UNITS[u.kind].speed, dt, w.unitWalk, w.T, UNITS[u.kind].radius) === 'blocked') u.repath = 0;
}

/**
 * The 4x4 drives where it's told and everyone climbs out when it stops. Sent at an animal, it stops within
 * JEEP.dropTiles of it, and its troops jump out and attack.
 */
function drive(w: World, j: Unit, dt: number): void {
  const cfg = UNITS.jeep;
  if (j.order === 'move') {
    const result = followPath(j, cfg.speed, dt, w.unitWalk, w.T, cfg.radius);
    if (result === 'arrived') {
      j.order = 'idle';
      j.dest = null;
      unload(w, j);
    } else if (result === 'blocked' && j.dest) {
      planRoute(w, j, j.dest.x, j.dest.y);
    }
  } else if (j.order === 'attack') {
    const d = w.dinoById(j.targetId);
    if (!d || !isTargetable(w, d)) {
      j.order = 'idle';
      j.path = [];
      j.pathIndex = 0;
      return;
    }
    if (Math.hypot(d.x - j.x, d.y - j.y) > JEEP.dropTiles * w.T) {
      if (j.repath <= 0) {
        planRoute(w, j, d.x, d.y);
        j.repath = SQUAD.repathSeconds;
      }
      if (followPath(j, cfg.speed, dt, w.unitWalk, w.T, cfg.radius) === 'blocked') j.repath = 0;
      return;
    }
    j.order = 'idle';
    j.path = [];
    j.pathIndex = 0;
    j.facing = Math.atan2(d.y - j.y, d.x - j.x);
    const riders = unload(w, j);
    if (riders.length) orderAttack(w, riders.map((u) => u.id), d.id);
  }
}

/** Level 4: the broken substation an Engineer is working on right now: standing still beside it, or null. */
export function workSite(w: World, u: Unit): Substation | null {
  if (!onMap(u) || u.kind !== 'engineer') return null;
  if (u.order !== 'idle' && u.order !== 'repair') return null;
  if (u.pathIndex < u.path.length) return null;
  return workingOn(w, u);
}

/** Level 4: every Engineer standing still beside a broken substation adds its work. */
function repairs(w: World, dt: number): void {
  for (const s of w.substations) s.workers = 0;
  for (const u of w.units) {
    const s = workSite(w, u);
    if (!s) continue;
    s.workers++;
    s.work += dt;
  }
  for (const s of w.substations) {
    if (s.fixed || s.work < GRID.repairSeconds) continue;
    w.fixSubstation(s);
    for (const u of w.units) {
      if (u.order === 'repair' && u.targetId === s.id) {
        u.order = 'idle';
        u.dest = null;
      }
    }
  }
}

/** The broken substation an Engineer is beside: the one it was sent to, or else the nearest in reach. */
function workingOn(w: World, u: Unit): Substation | null {
  if (u.order === 'repair') {
    const s = w.substationById(u.targetId);
    if (s && !s.fixed && inReach(s, u.x, u.y, w.T)) return s;
  }
  let best: Substation | null = null;
  let bestD = Infinity;
  for (const s of w.substations) {
    if (s.fixed || !inReach(s, u.x, u.y, w.T)) continue;
    const c = substationCenter(s, w.T);
    const d = Math.hypot(c.x - u.x, c.y - u.y);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

function fire(w: World, u: Unit, d: Dino): void {
  const cfg = UNITS[u.kind];
  u.cooldown = cfg.fireIntervalSeconds;
  w.events.push({ type: 'dart', x0: u.x, y0: u.y, x1: d.x, y1: d.y, heavy: u.kind !== 'tranq' });
  sedate(w, d, cfg.dartSedation, u.id);
}

/**
 * Idle troops shoot the nearest dinosaur in range, predators before Triceratops. In level 4 they hold fire at a
 * raptor that isn't after anyone, so a troop waiting in cover doesn't give itself away.
 */
function autoTarget(w: World, u: Unit): Dino | null {
  const range = UNITS[u.kind].range;
  let best: Dino | null = null;
  let bestScore = Infinity;
  for (const d of w.dinos) {
    if (!isTargetable(w, d)) continue;
    if (w.mission?.stealth && d.kind === 'raptor' && d.target?.type !== 'unit') continue;
    const dist = Math.hypot(d.x - u.x, d.y - u.y);
    if (dist > range) continue;
    const score = dist + (d.kind === 'triceratops' ? 100000 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

/** Live units among the ids that can take orders: troops and the 4x4 on the map. Towers can't. */
function liveUnits(w: World, ids: Iterable<number>): Unit[] {
  const out: Unit[] = [];
  for (const id of ids) {
    const u = w.unitById(id);
    if (u && canCommand(u)) out.push(u);
  }
  return out;
}

function formationSlots(w: World, x: number, y: number, n: number): Point[] {
  const T = w.T;
  const sp = SQUAD.formationSpacing;
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const out: Point[] = [];
  for (let i = 0; i < n; i++) {
    let px = x + ((i % cols) - (cols - 1) / 2) * sp;
    let py = y + (Math.floor(i / cols) - (rows - 1) / 2) * sp;
    const tx = Math.floor(px / T);
    const ty = Math.floor(py / T);
    if (!w.unitWalk(tx, ty)) {
      const t = nearestOpenTile(w.grid.cols, w.grid.rows, w.unitWalk, tx, ty);
      if (t) {
        px = (t.x + 0.5) * T;
        py = (t.y + 0.5) * T;
      }
    }
    out.push({ x: px, y: py });
  }
  return out;
}

function planRoute(w: World, u: Unit, x: number, y: number): void {
  const T = w.T;
  const sx = Math.floor(u.x / T);
  const sy = Math.floor(u.y / T);
  const gx = Math.floor(x / T);
  const gy = Math.floor(y / T);
  const tiles = findPath(w.grid.cols, w.grid.rows, w.unitWalk, sx, sy, gx, gy);
  const points = toWaypoints(tiles, T);
  const end = tiles.length ? tiles[tiles.length - 1] : { x: sx, y: sy };
  if (end.x === gx && end.y === gy && w.unitWalk(gx, gy)) {
    if (points.length) points[points.length - 1] = { x, y };
    else points.push({ x, y });
  }
  u.path = points;
  u.pathIndex = 0;
}

/** Pushes overlapping troops (and the 4x4) apart. Towers stay put, and troops can't stand on their tiles anyway. */
function separate(w: World): void {
  const live = w.units.filter(canCommand);
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i];
      const b = live[j];
      const min = UNITS[a.kind].radius + UNITS[b.kind].radius;
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let d = Math.hypot(dx, dy);
      if (d >= min) continue;
      if (d < 0.01) {
        dx = a.id < b.id ? 1 : -1;
        dy = 0.5;
        d = Math.hypot(dx, dy);
      }
      const push = (min - d) / 2;
      shift(w, a, (-dx / d) * push, (-dy / d) * push);
      shift(w, b, (dx / d) * push, (dy / d) * push);
    }
  }
}

function shift(w: World, u: Unit, dx: number, dy: number): void {
  const nx = u.x + dx;
  const ny = u.y + dy;
  if (w.unitWalk(Math.floor(nx / w.T), Math.floor(ny / w.T))) {
    u.x = nx;
    u.y = ny;
  }
}

/** Troops in the 4x4, for the screen. */
export { passengers };

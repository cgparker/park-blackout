import { SQUAD, UNITS, type UnitKind } from '../config';
import { sedate } from './combat';
import type { Dino } from './dinos';
import type { Point } from './grid';
import { findPath, followPath, nearestOpenTile, toWaypoints, type PathFollower } from './nav';
import type { World } from './world';

export type UnitOrder = 'idle' | 'move' | 'attack';

export interface Unit extends PathFollower {
  id: number;
  kind: UnitKind;
  hp: number;
  maxHp: number;
  order: UnitOrder;
  /** Dinosaur id for attack orders. */
  targetId: number;
  repath: number;
  cooldown: number;
  hurtAt: number;
  dead: boolean;
}

export interface QueueItem {
  id: number;
  kind: UnitKind;
  /** Seconds of training left. */
  left: number;
}

export function canTrainNow(w: World): boolean {
  return w.phase === 'build' || w.phase === 'blackout' || w.phase === 'restored';
}

/** Pays up front and adds a unit to the HQ queue. */
export function enqueueUnit(w: World, kind: UnitKind): boolean {
  const cost = UNITS[kind].cost;
  if (!canTrainNow(w) || w.queue.length >= SQUAD.queueMax || w.money < cost) return false;
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

export function spawnUnit(w: World, kind: UnitKind, at?: Point): Unit {
  const cfg = UNITS[kind];
  const p = at ?? spawnPoint(w);
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
    repath: 0,
    cooldown: 0,
    hurtAt: -Infinity,
    dead: false,
  };
  w.units.push(u);
  w.troopsTrained++;
  w.events.push({ type: 'trained', unitId: u.id, kind });
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
    for (const u of w.units) if (!u.dead && Math.hypot(u.x - cx, u.y - cy) < T * 0.7) count++;
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

export function isTargetable(w: World, d: Dino): boolean {
  return (w.phase === 'blackout' || w.phase === 'restored') && (d.state === 'penned' || d.state === 'loose');
}

/** Sends troops to a spot, spread out in a loose grid so they don't stack. */
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
    planRoute(w, u, slot.x, slot.y);
  }
}

/** Troops chase the dinosaur and dart it until it is secured. */
export function orderAttack(w: World, ids: Iterable<number>, dinoId: number): void {
  for (const u of liveUnits(w, ids)) {
    u.order = 'attack';
    u.targetId = dinoId;
    u.repath = 0;
    u.path = [];
    u.pathIndex = 0;
  }
}

export function updateUnits(w: World, dt: number): void {
  for (const u of w.units) {
    if (u.dead) continue;
    const cfg = UNITS[u.kind];
    u.cooldown = Math.max(0, u.cooldown - dt);
    u.repath -= dt;

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
          followPath(u, cfg.speed, dt, w.unitWalk, w.T, cfg.radius);
        } else {
          u.path = [];
          u.pathIndex = 0;
        }
        if (dist <= cfg.range) {
          u.facing = Math.atan2(d.y - u.y, d.x - u.x);
          if (u.cooldown <= 0) fire(w, u, d);
        }
      }
    } else if (u.order === 'move') {
      if (followPath(u, cfg.speed, dt, w.unitWalk, w.T, cfg.radius)) u.order = 'idle';
    }

    if (u.order === 'idle') {
      const d = autoTarget(w, u);
      if (d) {
        u.facing = Math.atan2(d.y - u.y, d.x - u.x);
        if (u.cooldown <= 0) fire(w, u, d);
      }
    }
  }
  separate(w);
}

function fire(w: World, u: Unit, d: Dino): void {
  const cfg = UNITS[u.kind];
  u.cooldown = cfg.fireIntervalSeconds;
  w.events.push({ type: 'dart', x0: u.x, y0: u.y, x1: d.x, y1: d.y, heavy: u.kind === 'heavy' });
  sedate(w, d, cfg.dartSedation, u.id);
}

/** Idle troops shoot the nearest dinosaur in range, predators before Triceratops. */
function autoTarget(w: World, u: Unit): Dino | null {
  const range = UNITS[u.kind].range;
  let best: Dino | null = null;
  let bestScore = Infinity;
  for (const d of w.dinos) {
    if (!isTargetable(w, d)) continue;
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

function liveUnits(w: World, ids: Iterable<number>): Unit[] {
  const out: Unit[] = [];
  for (const id of ids) {
    const u = w.unitById(id);
    if (u && !u.dead) out.push(u);
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

/** Pushes overlapping troops apart. */
function separate(w: World): void {
  const live = w.units.filter((u) => !u.dead);
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

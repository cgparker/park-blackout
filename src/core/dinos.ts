import { DINO_AI, DINOS, EXHIBITS, UNITS, VISITORS, type AnimalKind } from '../config';
import { damageUnit } from './combat';
import { fenceRect, footprintCenter, inFootprint, type Exhibit, type FenceSegment } from './exhibit';
import { Tile, type Point } from './grid';
import { findPath, followPath, lineClear, nearestOpenTile, stepToward, toWaypoints, type PathFollower } from './nav';
import { isTroop, type Unit } from './units';
import { panicNear, type Visitor } from './visitors';
import type { CasualtyCause, World } from './world';

/**
 * penned: inside its own pen (it may be attacking the fence).
 * loose: out of its pen and acting on its own.
 * secured: tranquilized; fades out.
 * contained: back behind a powered fence after power returned.
 */
export type DinoState = 'penned' | 'loose' | 'secured' | 'contained';

export type DinoTarget =
  | { type: 'segment'; exhibitId: number; index: number; x: number; y: number }
  | { type: 'visitor'; id: number }
  | { type: 'unit'; id: number };

export interface Dino extends PathFollower {
  id: number;
  kind: AnimalKind;
  /** Exhibit it lives in. */
  home: number;
  state: DinoState;
  sedation: number;
  target: DinoTarget | null;
  /** Seconds until a loose dinosaur rethinks its target. */
  think: number;
  repath: number;
  wander: Point | null;
  wait: number;
  /** Seconds until the next bite or fence hit. */
  cooldown: number;
  /** Seconds of rest after a kill. */
  pause: number;
  lastHitBy: number;
  lastHitTime: number;
  /** Seconds left in a Triceratops stampede, and its direction. */
  stampede: number;
  sdx: number;
  sdy: number;
  recover: number;
  /** Seconds left in the secured fade-out. */
  fade: number;
  removed: boolean;
  /** Position in its pack, used to spread raptors along a fence. */
  slot: number;
  /** T. rex only: the troop or tower it has locked onto, 0 for none. */
  lockId: number;
  /** T. rex only: seconds left in the wind-up before a charge, and in the charge itself. */
  windup: number;
  charge: number;
  /** T. rex only: seconds until it can charge again. */
  chargeCooldown: number;
  /** T. rex only: direction of the current charge. */
  cdx: number;
  cdy: number;
}

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const isPredator = (d: Dino) => d.kind !== 'triceratops';
const isActive = (d: Dino) => d.state === 'penned' || d.state === 'loose';
const rand = (w: World, lo: number, hi: number) => lo + w.rng() * (hi - lo);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// ------------------------------------------------------------------ setup

export function spawnAnimals(w: World, ex: Exhibit): void {
  const cfg = EXHIBITS[ex.kind];
  const b = penBounds(w, ex, cfg.animal);
  for (let i = 0; i < cfg.animalCount; i++) {
    w.dinos.push({
      id: w.newId(),
      kind: cfg.animal,
      home: ex.id,
      state: 'penned',
      x: rand(w, b.x0, b.x1),
      y: rand(w, b.y0, b.y1),
      facing: rand(w, -Math.PI, Math.PI),
      path: [],
      pathIndex: 0,
      sedation: DINOS[cfg.animal].sedation,
      target: null,
      think: 0,
      repath: 0,
      wander: null,
      wait: rand(w, 0, 1.5),
      cooldown: 0,
      pause: 0,
      lastHitBy: 0,
      lastHitTime: -Infinity,
      stampede: 0,
      sdx: 0,
      sdy: 0,
      recover: 0,
      fade: 0,
      removed: false,
      slot: i,
      lockId: 0,
      windup: 0,
      charge: 0,
      chargeCooldown: 0,
      cdx: 0,
      cdy: 0,
    });
  }
}

/** Drops whatever the animal was doing: target, route, lock, and any charge. */
export function calm(d: Dino): void {
  d.target = null;
  d.path = [];
  d.pathIndex = 0;
  d.wander = null;
  d.stampede = 0;
  d.lockId = 0;
  d.windup = 0;
  d.charge = 0;
}

/** Where an animal can wander inside its pen (inside the fence line, minus its body). */
export function penBounds(w: World, ex: Exhibit, kind: AnimalKind): { x0: number; y0: number; x1: number; y1: number } {
  const r = fenceRect(ex.footprint, w.T);
  const pad = DINOS[kind].radius + 4;
  return { x0: r.left + pad, y0: r.top + pad, x1: r.right - pad, y1: r.bottom - pad };
}

/** Power came back while the animal was inside its own footprint. */
export function containDino(w: World, d: Dino, home: Exhibit): void {
  d.state = 'contained';
  calm(d);
  d.wait = 0.5;
  const b = penBounds(w, home, d.kind);
  d.x = clamp(d.x, b.x0, b.x1);
  d.y = clamp(d.y, b.y0, b.y1);
}

/** A loose animal caught inside someone else's pen when the fences reseal is moved just outside it. */
export function evictFromPens(w: World, d: Dino): void {
  calm(d);
  const tx = Math.floor(d.x / w.T);
  const ty = Math.floor(d.y / w.T);
  if (!w.grid.inBounds(tx, ty) || w.grid.get(tx, ty) !== Tile.Exhibit) return;
  const open = (x: number, y: number) => {
    if (!w.grid.inBounds(x, y)) return false;
    const t = w.grid.get(x, y);
    return t === Tile.Grass || t === Tile.Path || t === Tile.Gate;
  };
  const p = nearestOpenTile(w.grid.cols, w.grid.rows, open, tx, ty);
  if (p) {
    d.x = (p.x + 0.5) * w.T;
    d.y = (p.y + 0.5) * w.T;
  }
}

// ------------------------------------------------------------------ fences

/**
 * A segment can be broken from inside when something walkable lies beyond it.
 * A tower counts as walkable here: animals break the fence and then knock the tower down.
 */
function opensOutward(w: World, s: FenceSegment): boolean {
  if (s.corner) return false;
  const x = s.x + s.nx;
  const y = s.y + s.ny;
  return w.dinoWalk(x, y) || (w.grid.inBounds(x, y) && w.grid.get(x, y) === Tile.Tower);
}

/** True when a pen has a gap that leads somewhere. */
export function hasExit(w: World, ex: Exhibit): boolean {
  return ex.segments.some((s) => s.hp <= 0 && opensOutward(w, s));
}

export function damageSegment(w: World, ex: Exhibit, index: number, amount: number): void {
  const s = ex.segments[index];
  if (w.powerOn || s.hp <= 0) return;
  s.hp = Math.max(0, s.hp - amount);
  ex.version++;
  const x = (s.x + 0.5) * w.T;
  const y = (s.y + 0.5) * w.T;
  w.events.push({ type: 'fenceHit', exhibitId: ex.id, x, y });
  if (s.hp === 0) {
    w.events.push({ type: 'breach', exhibitId: ex.id, kind: ex.kind, x, y });
    panicNear(w, x, y, VISITORS.panicBreachRadiusTiles * w.T);
  }
}

/** Where an animal stands to hit a segment, on the inside or the outside of the fence line. */
function fenceSpot(w: World, s: FenceSegment, d: Dino, outside: boolean): Point {
  const cx = (s.x + 0.5) * w.T;
  const cy = (s.y + 0.5) * w.T;
  const off = (DINOS[d.kind].radius + 4) * (outside ? 1 : -1);
  const spread = d.kind === 'raptor' ? (d.slot - 1) * 10 : 0;
  return { x: cx + s.nx * off - s.ny * spread, y: cy + s.ny * off + s.nx * spread };
}

/**
 * If a straight move crosses a standing fence line, returns that segment.
 * Used for stampedes and for the last step up to a fence.
 */
export function crossesIntactFence(w: World, x0: number, y0: number, x1: number, y1: number): { exhibit: Exhibit; index: number } | null {
  for (const ex of w.exhibits) {
    const r = fenceRect(ex.footprint, w.T);
    const inside = (x: number, y: number) => x > r.left && x < r.right && y > r.top && y < r.bottom;
    const a = inside(x0, y0);
    if (a === inside(x1, y1)) continue;
    let lo = 0;
    let hi = 1;
    for (let k = 0; k < 14; k++) {
      const m = (lo + hi) / 2;
      if (inside(x0 + (x1 - x0) * m, y0 + (y1 - y0) * m) === a) lo = m;
      else hi = m;
    }
    const px = x0 + (x1 - x0) * hi;
    const py = y0 + (y1 - y0) * hi;
    let index = -1;
    let best = Infinity;
    ex.segments.forEach((s, i) => {
      const d = Math.hypot((s.x + 0.5) * w.T - px, (s.y + 0.5) * w.T - py);
      if (d < best) {
        best = d;
        index = i;
      }
    });
    if (index >= 0 && ex.segments[index].hp > 0) return { exhibit: ex, index };
  }
  return null;
}

// ------------------------------------------------------------------ update

export function updateDinos(w: World, dt: number): void {
  for (const d of w.dinos) {
    if (d.removed) continue;
    if (d.state === 'secured') {
      d.fade -= dt;
      if (d.fade <= 0) d.removed = true;
      continue;
    }
    d.cooldown = Math.max(0, d.cooldown - dt);
    d.pause = Math.max(0, d.pause - dt);
    d.recover = Math.max(0, d.recover - dt);
    d.chargeCooldown = Math.max(0, d.chargeCooldown - dt);

    if (d.state === 'contained' || (w.powerOn && d.state === 'penned')) wanderInPen(w, d, dt);
    else if (d.kind === 'triceratops') updateTriceratops(w, d, dt);
    else if (d.state === 'penned') updatePennedPredator(w, d, dt);
    else updateLoosePredator(w, d, dt);
  }
  checkVisitorContact(w, dt);
}

function wanderInPen(w: World, d: Dino, dt: number): void {
  const ex = w.exhibitById(d.home);
  if (!ex) return;
  if (d.wait > 0) {
    d.wait -= dt;
    return;
  }
  if (!d.wander) {
    const b = penBounds(w, ex, d.kind);
    d.wander = { x: rand(w, b.x0, b.x1), y: rand(w, b.y0, b.y1) };
  }
  if (stepToward(d, d.wander.x, d.wander.y, DINOS[d.kind].wanderSpeed * dt)) {
    d.wander = null;
    const [lo, hi] = DINOS[d.kind].wanderPauseSeconds;
    d.wait = rand(w, lo, hi);
  }
}

function wanderLoose(w: World, d: Dino, dt: number): void {
  if (d.wait > 0) {
    d.wait -= dt;
    return;
  }
  if (!d.wander) {
    const a = rand(w, 0, Math.PI * 2);
    const r = rand(w, 0.3, 1.2) * w.T;
    const x = d.x + Math.cos(a) * r;
    const y = d.y + Math.sin(a) * r;
    if (!lineClear(w.dinoWalk, w.T, d.x, d.y, x, y, 0)) {
      d.wait = 0.5;
      return;
    }
    d.wander = { x, y };
  }
  if (stepToward(d, d.wander.x, d.wander.y, DINOS[d.kind].wanderSpeed * dt)) {
    d.wander = null;
    const [lo, hi] = DINOS[d.kind].wanderPauseSeconds;
    d.wait = rand(w, lo, hi);
  }
}

function goLoose(w: World, d: Dino): void {
  if (d.state === 'loose') return;
  d.state = 'loose';
  d.target = null;
  d.think = 0;
  d.repath = 0;
  d.path = [];
  d.pathIndex = 0;
  d.wander = null;
  d.lockId = 0;
  w.events.push({ type: 'escaped', dinoId: d.id, kind: d.kind });
}

// ------------------------------------------------------------------ predators in their pens

function updatePennedPredator(w: World, d: Dino, dt: number): void {
  const cfg = DINOS[d.kind];
  const ex = w.exhibitById(d.home);
  if (!ex) return;
  if (w.phaseTime < (cfg.breakoutDelaySeconds ?? Infinity)) {
    wanderInPen(w, d, dt);
    return;
  }
  if (hasExit(w, ex)) {
    goLoose(w, d);
    updateLoosePredator(w, d, dt);
    return;
  }

  let index: number | null;
  if (d.kind === 'raptor') {
    // The pack works together on the weakest segment.
    if (!canBreak(w, ex, ex.packTarget)) ex.packTarget = chooseBreakout(w, ex, true);
    index = ex.packTarget;
  } else {
    const t = d.target;
    index = t?.type === 'segment' && t.exhibitId === ex.id && canBreak(w, ex, t.index) ? t.index : chooseBreakout(w, ex, false);
  }
  if (index === null) {
    wanderInPen(w, d, dt);
    return;
  }

  const s = ex.segments[index];
  const spot = fenceSpot(w, s, d, false);
  d.target = { type: 'segment', exhibitId: ex.id, index, x: spot.x, y: spot.y };
  if (stepToward(d, spot.x, spot.y, cfg.speed * dt)) {
    d.facing = Math.atan2(s.ny, s.nx);
    if (d.cooldown <= 0) {
      d.cooldown = cfg.fenceHitIntervalSeconds;
      damageSegment(w, ex, index, cfg.fenceDamage);
    }
  }
}

function canBreak(w: World, ex: Exhibit, index: number | null): boolean {
  if (index === null) return false;
  const s = ex.segments[index];
  return !!s && s.hp > 0 && opensOutward(w, s);
}

/**
 * Raptors pick the weakest segment (ties go to the side nearest a visitor).
 * The T. rex picks the segment nearest the closest visitor or other exhibit.
 */
function chooseBreakout(w: World, ex: Exhibit, weakestFirst: boolean): number | null {
  const focus = focusPoint(w, ex, !weakestFirst);
  let best: number | null = null;
  let bestHp = Infinity;
  let bestDist = Infinity;
  for (let i = 0; i < ex.segments.length; i++) {
    const s = ex.segments[i];
    if (s.hp <= 0 || !opensOutward(w, s)) continue;
    const hp = weakestFirst ? s.hp : 0;
    const d = Math.hypot((s.x + 0.5) * w.T - focus.x, (s.y + 0.5) * w.T - focus.y);
    if (hp < bestHp || (hp === bestHp && d < bestDist)) {
      best = i;
      bestHp = hp;
      bestDist = d;
    }
  }
  return best;
}

/** The nearest visitor (or, if asked, other exhibit) to a pen. Falls back to the gate. */
function focusPoint(w: World, ex: Exhibit, includeExhibits: boolean): Point {
  const c = footprintCenter(ex.footprint, w.T);
  let best: Point | null = null;
  let bestD = Infinity;
  for (const v of w.visitors) {
    if (v.done) continue;
    const d = dist(v, c);
    if (d < bestD) {
      bestD = d;
      best = v;
    }
  }
  if (includeExhibits) {
    for (const o of w.exhibits) {
      if (o.id === ex.id) continue;
      const oc = footprintCenter(o.footprint, w.T);
      const d = dist(oc, c);
      if (d < bestD) {
        bestD = d;
        best = oc;
      }
    }
  }
  return best ? { x: best.x, y: best.y } : { x: (w.map.gate.x + 0.5) * w.T, y: (w.map.gate.y + 0.5) * w.T };
}

// ------------------------------------------------------------------ loose predators

function updateLoosePredator(w: World, d: Dino, dt: number): void {
  const cfg = DINOS[d.kind];
  if (d.pause > 0) return;
  if (d.charge > 0) {
    chargeStep(w, d, dt);
    return;
  }
  if (d.windup > 0) {
    windupStep(w, d, dt);
    return;
  }

  d.think -= dt;
  if (d.think <= 0 || (d.target && !targetAlive(w, d.target))) {
    d.target = d.kind === 'trex' ? chooseTrexTarget(w, d) : chooseRaptorTarget(w, d);
    d.think = DINO_AI.thinkSeconds;
  }

  const t = d.target;
  if (!t) {
    wanderLoose(w, d, dt);
  } else if (t.type === 'segment') {
    const ex = w.exhibitById(t.exhibitId);
    if (ex && approachFence(w, d, t.x, t.y, cfg.speed, dt)) {
      const s = ex.segments[t.index];
      d.facing = Math.atan2(-s.ny, -s.nx);
      if (d.cooldown <= 0) {
        d.cooldown = cfg.fenceHitIntervalSeconds;
        damageSegment(w, ex, t.index, cfg.fenceDamage);
      }
      if (s.hp <= 0) {
        d.target = null;
        d.think = 0;
      }
    }
  } else if (t.type === 'visitor') {
    const v = w.visitorById(t.id);
    if (v) chase(w, d, v.x, v.y, 0, cfg.speed, dt);
  } else {
    const u = w.unitById(t.id);
    if (u && d.kind === 'trex' && startWindup(w, d, u)) return;
    if (u) chase(w, d, u.x, u.y, cfg.radius + UNITS[u.kind].radius, cfg.speed, dt);
  }
  biteTroops(w, d);
}

// ------------------------------------------------------------------ T. rex charge

/**
 * A locked-on T. rex at middle distance with a clear run stops, turns toward its target,
 * and winds up. That pause is the warning: troops that move now can get out of the way.
 */
function startWindup(w: World, d: Dino, u: Unit): boolean {
  if (d.lockId !== u.id || d.chargeCooldown > 0) return false;
  const T = w.T;
  const dd = dist(u, d);
  if (dd < DINO_AI.trexChargeMinTiles * T || dd > DINO_AI.trexChargeMaxTiles * T) return false;
  const stop = stopPoint(d, u.x, u.y, DINOS.trex.radius + UNITS[u.kind].radius);
  if (!lineClear(w.dinoWalk, T, d.x, d.y, stop.x, stop.y, 0)) return false;
  d.windup = DINO_AI.trexChargeWindupSeconds;
  d.path = [];
  d.pathIndex = 0;
  d.facing = Math.atan2(u.y - d.y, u.x - d.x);
  w.events.push({ type: 'charge', dinoId: d.id, x: d.x, y: d.y });
  return true;
}

function windupStep(w: World, d: Dino, dt: number): void {
  const u = w.unitById(d.lockId);
  if (!u || u.dead) {
    d.windup = 0;
    d.think = 0;
    return;
  }
  d.facing = Math.atan2(u.y - d.y, u.x - d.x);
  d.windup -= dt;
  if (d.windup > 0) return;
  d.windup = 0;
  d.charge = DINO_AI.trexChargeSeconds;
  d.cdx = Math.cos(d.facing);
  d.cdy = Math.sin(d.facing);
}

/** Runs straight at double speed. Stops at the first troop it hits (and bites it), or at anything solid. */
function chargeStep(w: World, d: Dino, dt: number): void {
  const cfg = DINOS.trex;
  const step = cfg.speed * DINO_AI.trexChargeSpeedMultiplier * dt;
  const nx = d.x + d.cdx * step;
  const ny = d.y + d.cdy * step;

  let hit: Unit | null = null;
  let bestD = Infinity;
  for (const u of w.units) {
    if (u.dead) continue;
    const dd = Math.hypot(u.x - nx, u.y - ny);
    if (dd <= cfg.radius + UNITS[u.kind].radius + DINO_AI.biteReachPx && dd < bestD) {
      bestD = dd;
      hit = u;
    }
  }
  if (hit) {
    d.facing = Math.atan2(hit.y - d.y, hit.x - d.x);
    d.cooldown = cfg.biteIntervalSeconds;
    w.events.push({ type: 'bite', x: hit.x, y: hit.y });
    damageUnit(w, hit, cfg.troopDamage);
    endCharge(d);
    return;
  }

  const T = w.T;
  const tx = Math.floor(nx / T);
  const ty = Math.floor(ny / T);
  const newTile = tx !== Math.floor(d.x / T) || ty !== Math.floor(d.y / T);
  if ((newTile && !w.dinoWalk(tx, ty)) || crossesIntactFence(w, d.x, d.y, nx, ny)) {
    endCharge(d);
    return;
  }
  d.x = nx;
  d.y = ny;
  // Anyone in the way is trampled, like a Triceratops stampede.
  for (const v of w.visitors) {
    if (!v.done && dist(v, d) <= cfg.radius + VISITORS.radius) killVisitor(w, v, 'trex');
  }
  d.charge -= dt;
  if (d.charge <= 0) endCharge(d);
}

function endCharge(d: Dino): void {
  d.windup = 0;
  d.charge = 0;
  d.chargeCooldown = DINO_AI.trexChargeCooldownSeconds;
  d.path = [];
  d.pathIndex = 0;
  d.repath = 0;
  d.think = 0;
}

/** The point `stopAt` short of (x, y) on the straight line from the animal. */
function stopPoint(d: Point, x: number, y: number, stopAt: number): Point {
  const dd = Math.hypot(x - d.x, y - d.y);
  if (dd <= stopAt || dd < 1e-6) return { x: d.x, y: d.y };
  const ratio = (dd - stopAt) / dd;
  return { x: d.x + (x - d.x) * ratio, y: d.y + (y - d.y) * ratio };
}

function targetAlive(w: World, t: DinoTarget): boolean {
  if (t.type === 'visitor') {
    const v = w.visitorById(t.id);
    return !!v && !v.done;
  }
  if (t.type === 'unit') {
    const u = w.unitById(t.id);
    return !!u && !u.dead;
  }
  const ex = w.exhibitById(t.exhibitId);
  return !!ex && ex.segments[t.index].hp > 0;
}

/**
 * 1. The troop or tower it is locked onto, until that dies or gets 12 tiles away.
 * 2. Whoever darted it in the last 5 s, within 8 tiles. It locks on.
 * 3. The nearest visitor within 10 tiles.
 * 4. Break into the nearest exhibit with animals still inside.
 * 5. The nearest visitor anywhere, then the nearest troop or tower anywhere (and lock on).
 */
function chooseTrexTarget(w: World, d: Dino): DinoTarget | null {
  const T = w.T;
  if (d.lockId) {
    const u = w.unitById(d.lockId);
    if (u && !u.dead && dist(u, d) <= DINO_AI.trexLockBreakTiles * T) return { type: 'unit', id: u.id };
    d.lockId = 0;
  }
  if (w.time - d.lastHitTime <= DINO_AI.trexLockSeconds) {
    const u = w.unitById(d.lastHitBy);
    if (u && !u.dead && dist(u, d) <= DINO_AI.trexLockRadiusTiles * T) return lockOn(d, u);
  }
  const near = nearestVisitor(w, d, DINO_AI.trexVisitorRadiusTiles * T);
  if (near) return { type: 'visitor', id: near.id };
  // Stick with a fence it has already started on.
  const cur = d.target;
  if (cur?.type === 'segment' && targetAlive(w, cur)) return cur;
  const breakIn = chooseBreakIn(w, d);
  if (breakIn) return breakIn;
  const anyVisitor = nearestVisitor(w, d, Infinity);
  if (anyVisitor) return { type: 'visitor', id: anyVisitor.id };
  const anyUnit = nearestUnit(w, d, Infinity);
  return anyUnit ? lockOn(d, anyUnit) : null;
}

function lockOn(d: Dino, u: Unit): DinoTarget {
  d.lockId = u.id;
  return { type: 'unit', id: u.id };
}

function chooseBreakIn(w: World, d: Dino): DinoTarget | null {
  let target: Exhibit | null = null;
  let bestD = Infinity;
  for (const ex of w.exhibits) {
    if (ex.id === d.home || hasExit(w, ex)) continue;
    if (!w.dinos.some((o) => o.home === ex.id && o.state === 'penned')) continue;
    const dd = dist(footprintCenter(ex.footprint, w.T), d);
    if (dd < bestD) {
      bestD = dd;
      target = ex;
    }
  }
  if (!target) return null;
  let index = -1;
  let best = Infinity;
  for (let i = 0; i < target.segments.length; i++) {
    const s = target.segments[i];
    if (s.hp <= 0 || !opensOutward(w, s)) continue;
    const dd = Math.hypot((s.x + 0.5) * w.T - d.x, (s.y + 0.5) * w.T - d.y);
    if (dd < best) {
      best = dd;
      index = i;
    }
  }
  if (index < 0) return null;
  const spot = fenceSpot(w, target.segments[index], d, true);
  return { type: 'segment', exhibitId: target.id, index, x: spot.x, y: spot.y };
}

/** The nearest visitor or troop within 8 tiles, else the nearest visitor anywhere, else the nearest troop. */
function chooseRaptorTarget(w: World, d: Dino): DinoTarget | null {
  const R = DINO_AI.raptorHuntRadiusTiles * w.T;
  const v = nearestVisitor(w, d, R);
  const u = nearestUnit(w, d, R);
  if (v && (!u || dist(v, d) <= dist(u, d))) return { type: 'visitor', id: v.id };
  if (u) return { type: 'unit', id: u.id };
  const anyVisitor = nearestVisitor(w, d, Infinity);
  if (anyVisitor) return { type: 'visitor', id: anyVisitor.id };
  const anyUnit = nearestUnit(w, d, Infinity);
  return anyUnit ? { type: 'unit', id: anyUnit.id } : null;
}

function nearestVisitor(w: World, p: Point, radius: number): Visitor | null {
  let best: Visitor | null = null;
  let bestD = radius;
  for (const v of w.visitors) {
    if (v.done) continue;
    const d = dist(v, p);
    if (d <= bestD) {
      bestD = d;
      best = v;
    }
  }
  return best;
}

function nearestUnit(w: World, p: Point, radius: number): Unit | null {
  let best: Unit | null = null;
  let bestD = radius;
  for (const u of w.units) {
    if (u.dead) continue;
    const d = dist(u, p);
    if (d <= bestD) {
      bestD = d;
      best = u;
    }
  }
  return best;
}

/** Walks up to a fence spot. The last stretch is a straight step, since the spot sits beside a solid fence. */
function approachFence(w: World, d: Dino, x: number, y: number, speed: number, dt: number): boolean {
  const dd = Math.hypot(x - d.x, y - d.y);
  if (dd <= 2) return true;
  if (dd < 1.6 * w.T && !crossesIntactFence(w, d.x, d.y, x, y)) {
    d.path = [];
    d.pathIndex = 0;
    return stepToward(d, x, y, speed * dt);
  }
  navigate(w, d, x, y, speed, dt);
  return false;
}

/**
 * Runs at a moving target, stopping `stopAt` short of its center. The straight run only needs a clear
 * line to that stopping point, so a tower (which fills its tile) can still be reached and bitten.
 */
function chase(w: World, d: Dino, x: number, y: number, stopAt: number, speed: number, dt: number): void {
  const dd = Math.hypot(x - d.x, y - d.y);
  if (dd <= stopAt) return;
  const stop = stopPoint(d, x, y, stopAt);
  if (dd < 4 * w.T && lineClear(w.dinoWalk, w.T, d.x, d.y, stop.x, stop.y, 0)) {
    d.path = [];
    d.pathIndex = 0;
    stepToward(d, stop.x, stop.y, speed * dt);
    return;
  }
  navigate(w, d, x, y, speed, dt);
}

function navigate(w: World, d: Dino, x: number, y: number, speed: number, dt: number): void {
  d.repath -= dt;
  if (d.repath <= 0) {
    const T = w.T;
    const tiles = findPath(w.grid.cols, w.grid.rows, w.dinoWalk, Math.floor(d.x / T), Math.floor(d.y / T), Math.floor(x / T), Math.floor(y / T));
    d.path = toWaypoints(tiles, T);
    d.pathIndex = 0;
    d.repath = DINO_AI.repathSeconds;
  }
  if (followPath(d, speed, dt, w.dinoWalk, w.T, 0) === 'blocked') d.repath = 0;
}

/** Bites the troop or tower in reach: the locked-on one if it's there, otherwise the nearest. */
function biteTroops(w: World, d: Dino): void {
  const cfg = DINOS[d.kind];
  if (cfg.troopDamage <= 0 || d.cooldown > 0 || d.pause > 0) return;
  let victim: Unit | null = null;
  let bestD = Infinity;
  for (const u of w.units) {
    if (u.dead) continue;
    const reach = cfg.radius + UNITS[u.kind].radius + DINO_AI.biteReachPx;
    const dd = dist(u, d);
    if (dd > reach) continue;
    if (u.id === d.lockId) {
      victim = u;
      break;
    }
    if (dd < bestD) {
      bestD = dd;
      victim = u;
    }
  }
  if (!victim) return;
  d.cooldown = cfg.biteIntervalSeconds;
  d.facing = Math.atan2(victim.y - d.y, victim.x - d.x);
  w.events.push({ type: 'bite', x: victim.x, y: victim.y });
  damageUnit(w, victim, cfg.troopDamage);
}

// ------------------------------------------------------------------ Triceratops

function updateTriceratops(w: World, d: Dino, dt: number): void {
  if (d.stampede > 0) {
    stampedeStep(w, d, dt);
    return;
  }
  if (d.recover <= 0) {
    const threat = nearestThreat(w, d, DINO_AI.triThreatRadiusTiles * w.T);
    if (threat) {
      let dx = d.x - threat.x;
      let dy = d.y - threat.y;
      const len = Math.hypot(dx, dy);
      if (len < 1e-3) {
        dx = Math.cos(d.facing);
        dy = Math.sin(d.facing);
      } else {
        dx /= len;
        dy /= len;
      }
      d.sdx = dx;
      d.sdy = dy;
      d.facing = Math.atan2(dy, dx);
      d.stampede = DINO_AI.triStampedeSeconds;
      d.wander = null;
      return;
    }
  }
  if (d.state === 'penned') wanderInPen(w, d, dt);
  else wanderLoose(w, d, dt);
}

/** Predators (penned or loose) and troops scare Triceratops. Other Triceratops and towers don't. */
function nearestThreat(w: World, d: Dino, radius: number): Point | null {
  let best: Point | null = null;
  let bestD = radius;
  for (const o of w.dinos) {
    if (o === d || !isPredator(o) || !isActive(o)) continue;
    const dd = dist(o, d);
    if (dd <= bestD) {
      bestD = dd;
      best = o;
    }
  }
  for (const u of w.units) {
    if (u.dead || !isTroop(u)) continue;
    const dd = dist(u, d);
    if (dd <= bestD) {
      bestD = dd;
      best = u;
    }
  }
  return best;
}

function stampedeStep(w: World, d: Dino, dt: number): void {
  const cfg = DINOS.triceratops;
  const step = cfg.speed * dt;
  const nx = d.x + d.sdx * step;
  const ny = d.y + d.sdy * step;

  const hit = crossesIntactFence(w, d.x, d.y, nx, ny);
  if (hit) {
    damageSegment(w, hit.exhibit, hit.index, cfg.fenceDamage);
    endStampede(w, d);
    return;
  }
  const lx = Math.floor((nx + d.sdx * cfg.radius) / w.T);
  const ly = Math.floor((ny + d.sdy * cfg.radius) / w.T);
  const t = w.grid.inBounds(lx, ly) ? w.grid.get(lx, ly) : Tile.Rock;
  if (t === Tile.Rock || t === Tile.Water || t === Tile.HQ || t === Tile.Tower) {
    endStampede(w, d);
    return;
  }

  d.x = nx;
  d.y = ny;
  for (const v of w.visitors) {
    if (!v.done && dist(v, d) <= cfg.radius + VISITORS.radius) killVisitor(w, v, 'stampede');
  }
  d.stampede -= dt;
  if (d.stampede <= 0) endStampede(w, d);
}

function endStampede(w: World, d: Dino): void {
  d.stampede = 0;
  d.recover = DINO_AI.triRecoverSeconds;
  d.wander = null;
  d.wait = 0.3;
  const home = w.exhibitById(d.home);
  const inside = !!home && inFootprint(home.footprint, Math.floor(d.x / w.T), Math.floor(d.y / w.T));
  if (inside) d.state = 'penned';
  else goLoose(w, d);
}

// ------------------------------------------------------------------ visitors

/** A visitor touched by a loose predator for half a second is killed. */
function checkVisitorContact(w: World, dt: number): void {
  const predators = w.dinos.filter((d) => d.state === 'loose' && isPredator(d) && d.pause <= 0);
  for (const v of w.visitors) {
    if (v.done) continue;
    let by: Dino | null = null;
    for (const p of predators) {
      if (dist(p, v) <= DINOS[p.kind].radius + VISITORS.radius + 2) {
        by = p;
        break;
      }
    }
    if (!by) {
      v.contact = 0;
      continue;
    }
    v.contact += dt;
    if (v.contact >= DINO_AI.visitorContactSeconds) {
      killVisitor(w, v, by.kind === 'trex' ? 'trex' : 'raptor');
      if (by.windup > 0 || by.charge > 0) endCharge(by);
      by.pause = DINOS[by.kind].killPauseSeconds;
      by.target = null;
      by.think = 0;
    }
  }
}

/** A visitor dies. Everyone who saw it runs. */
export function killVisitor(w: World, v: Visitor, cause: CasualtyCause): void {
  v.done = true;
  w.casualties[cause]++;
  w.events.push({ type: 'casualty', x: v.x, y: v.y, cause });
  panicNear(w, v.x, v.y, VISITORS.panicCasualtyRadiusTiles * w.T);
}

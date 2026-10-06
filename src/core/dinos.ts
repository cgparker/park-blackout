import { DINO_AI, DINOS, EXHIBITS, FIGHT, NEST, PACK, STEALTH, UNITS, VISITORS, type AnimalKind } from '../config';
import { damageUnit } from './combat';
import { fenceRect, footprintCenter, inFootprint, type Exhibit, type FenceSegment } from './exhibit';
import { Tile, type Point } from './grid';
import { findPath, followPath, lineClear, nearestOpenTile, stepToward, toWaypoints, type PathFollower } from './nav';
import { inView, noticed, preyOf, tracking, type PreyRef } from './stealth';
import { canDart, onMap, type Unit } from './units';
import { panicNear, type Visitor } from './visitors';
import type { CasualtyCause, World } from './world';

/**
 * penned: inside its own pen (it may be attacking the fence).
 * loose: out of its pen and acting on its own.
 * secured: tranquilized; fades out.
 * contained: back behind a powered fence after power returned.
 * dead: killed in level 5's fight; stays down a moment, then is gone.
 */
export type DinoState = 'penned' | 'loose' | 'secured' | 'contained' | 'dead';

export type DinoTarget =
  | { type: 'segment'; exhibitId: number; index: number; x: number; y: number }
  | { type: 'visitor'; id: number }
  | { type: 'unit'; id: number }
  /** Level 5: another animal it is fighting. */
  | { type: 'dino'; id: number };

export interface Dino extends PathFollower {
  id: number;
  kind: AnimalKind;
  /** Exhibit it lives in. */
  home: number;
  state: DinoState;
  sedation: number;
  /** Level 5's fights wear this down. At 0 the animal is killed. */
  health: number;
  /** World time it was last hurt in a fight, for the screen. */
  hurtAt: number;
  target: DinoTarget | null;
  /** Seconds until a loose dinosaur rethinks its target. */
  think: number;
  repath: number;
  wander: Point | null;
  wait: number;
  /** Seconds until the next bite or fence hit. */
  cooldown: number;
  /** T. rex in level 5: seconds until it can bite a raptor again. */
  fightCooldown: number;
  /** Seconds of rest after a kill. */
  pause: number;
  lastHitBy: number;
  lastHitTime: number;
  /** Seconds left in a Triceratops stampede, and its direction. */
  stampede: number;
  sdx: number;
  sdy: number;
  /** Radians the stampede has turned to get around things since it started (positive is clockwise on screen). */
  sturn: number;
  recover: number;
  /** Seconds left in the secured fade-out, or lying dead. */
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
  /** T. rex only: seconds left in the roar it gives when it locks onto a troop. It stands and faces it. */
  roar: number;
  /** T. rex only: direction of the current charge. */
  cdx: number;
  cdy: number;
  /** Level 2: the nest its raptors stay by while they're calm. */
  nest: Point | null;
  /** Level 4: its patrol route (world pixels), the stop it's walking to, and how long it has left looking around there. */
  patrol: Point[] | null;
  patrolIndex: number;
  look: number;
  /** The way it faced when it reached the stop. It looks around either side of it. */
  lookBase: number;
  /** Raptors: seconds on the hunt without seeing their prey, and where they last saw it. */
  lost: number;
  seen: Point | null;
  /** Raptors: when it last reacted to being darted, so each dart sets it off once. */
  heardHit: number;
  /**
   * Raptors: seconds spent making out someone in its cone. It stands still meanwhile, and hunts at
   * STEALTH.noticeSeconds. With nobody in sight it counts back down to 0 before it moves on.
   */
  notice: number;
  /** Raptors hunting a troop as a pack: seconds spent circling it, and whether they have started their rush. */
  circle: number;
  rush: boolean;
  /** Its place on the ring round its prey (radians, NaN for none), and how big the pack was when places were given out. */
  ring: number;
  ringN: number;
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
      health: DINOS[cfg.animal].health,
      hurtAt: -Infinity,
      target: null,
      think: 0,
      repath: 0,
      wander: null,
      wait: rand(w, 0, 1.5),
      cooldown: 0,
      fightCooldown: 0,
      pause: 0,
      lastHitBy: 0,
      lastHitTime: -Infinity,
      stampede: 0,
      sdx: 0,
      sdy: 0,
      sturn: 0,
      recover: 0,
      fade: 0,
      removed: false,
      slot: i,
      lockId: 0,
      windup: 0,
      charge: 0,
      chargeCooldown: 0,
      roar: 0,
      cdx: 0,
      cdy: 0,
      nest: null,
      patrol: null,
      patrolIndex: 0,
      look: 0,
      lookBase: 0,
      lost: 0,
      seen: null,
      heardHit: -Infinity,
      notice: 0,
      circle: 0,
      rush: false,
      ring: NaN,
      ringN: 0,
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
  d.roar = 0;
  d.notice = 0;
  d.lost = 0;
  d.seen = null;
  d.circle = 0;
  d.rush = false;
  d.ring = NaN;
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

/** Whether the animal's own pen has power. */
function homePowered(w: World, d: Dino): boolean {
  return w.exhibitById(d.home)?.powered ?? w.powerOn;
}

/** True when the animal's center is inside its own pen's fence line. */
function insideOwnFence(w: World, d: Dino): boolean {
  const home = w.exhibitById(d.home);
  if (!home) return false;
  const r = fenceRect(home.footprint, w.T);
  return d.x > r.left && d.x < r.right && d.y > r.top && d.y < r.bottom;
}

/** Puts an animal somewhere inside its own pen, calm. */
function settleInPen(w: World, d: Dino, home: Exhibit, anywhere: boolean): void {
  d.state = 'penned';
  calm(d);
  d.nest = null;
  d.wait = 0.5;
  const b = penBounds(w, home, d.kind);
  d.x = anywhere ? rand(w, b.x0, b.x1) : clamp(d.x, b.x0, b.x1);
  d.y = anywhere ? rand(w, b.y0, b.y1) : clamp(d.y, b.y0, b.y1);
}

/** Mission levels: a loose animal walked (or ran) back into its own pen, and the fence has power, so it stays. */
function cameHome(w: World, d: Dino): void {
  const home = w.exhibitById(d.home);
  if (!home) return;
  settleInPen(w, d, home, false);
  w.noteBack(d, 'walked');
}

/** Levels 1 and 2: a darted animal, done fading, wakes up back in its pen. Returns false if it has no pen. */
function carryHome(w: World, d: Dino): boolean {
  const home = w.exhibitById(d.home);
  if (!home) return false;
  settleInPen(w, d, home, true);
  d.sedation = DINOS[d.kind].sedation;
  d.fade = 0;
  return true;
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
  if (ex.powered || s.hp <= 0) return;
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
      // In levels 1 and 2 the fences are on, so the crew carries a darted animal back to its pen.
      if (d.fade <= 0 && !(w.mission?.carryHome && carryHome(w, d))) d.removed = true;
      continue;
    }
    if (d.state === 'dead') {
      d.fade -= dt;
      if (d.fade <= 0) d.removed = true;
      continue;
    }
    d.cooldown = Math.max(0, d.cooldown - dt);
    d.fightCooldown = Math.max(0, d.fightCooldown - dt);
    d.pause = Math.max(0, d.pause - dt);
    d.recover = Math.max(0, d.recover - dt);
    d.chargeCooldown = Math.max(0, d.chargeCooldown - dt);

    if (w.mission && d.state === 'loose' && insideOwnFence(w, d) && homePowered(w, d)) cameHome(w, d);
    if (d.state === 'contained' || (d.state === 'penned' && homePowered(w, d))) wanderInPen(w, d, dt);
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

/** A wander point picked before a chase may be behind a rock from where the animal is now. Drop it then. */
function dropBlockedWander(w: World, d: Dino): void {
  if (d.wander && !lineClear(w.dinoWalk, w.T, d.x, d.y, d.wander.x, d.wander.y, 0)) d.wander = null;
}

function wanderLoose(w: World, d: Dino, dt: number): void {
  if (d.wait > 0) {
    d.wait -= dt;
    return;
  }
  dropBlockedWander(w, d);
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
  w.noteEscape(d);
  w.events.push({ type: 'escaped', dinoId: d.id, kind: d.kind });
}

// ------------------------------------------------------------------ predators in their pens

/**
 * Seconds into the level when animals in this pen go for the fence. Level 4 sets it per pen; otherwise it's the
 * animal's own delay, moved by the pen's drift for this game.
 */
function breakoutTime(ex: Exhibit, kind: AnimalKind): number {
  if (ex.breakoutAt !== undefined) return ex.breakoutAt ?? Infinity;
  const delay = DINOS[kind].breakoutDelaySeconds;
  return delay === null ? Infinity : delay + ex.drift;
}

function updatePennedPredator(w: World, d: Dino, dt: number): void {
  const cfg = DINOS[d.kind];
  const ex = w.exhibitById(d.home);
  if (!ex) return;
  // In a mission level, a gap someone else made lets them out at once, whatever their own schedule.
  if (w.mission && hasExit(w, ex)) {
    goLoose(w, d);
    updateLoosePredator(w, d, dt);
    return;
  }
  if (w.phaseTime < breakoutTime(ex, d.kind)) {
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
  if (d.roar > 0) {
    roarStep(w, d, dt);
    return;
  }
  if (d.charge > 0) {
    chargeStep(w, d, dt);
    fightBites(w, d);
    return;
  }
  if (d.windup > 0) {
    windupStep(w, d, dt);
    fightBites(w, d);
    return;
  }
  if (d.kind === 'raptor') {
    stalk(w, d, dt);
    return;
  }

  // The T. rex.
  d.think -= dt;
  if (d.think <= 0 || (d.target && !targetAlive(w, d.target))) {
    d.target = chooseTrexTarget(w, d);
    d.think = DINO_AI.thinkSeconds;
    // A new lock starts with a roar; it moves and charges after.
    if (d.roar > 0) return;
  }

  const t = d.target;
  // Level 5: with raptors on it, the T. rex only pushes slowly toward the pen it's after.
  const speed = t?.type === 'segment' && raptorsOn(w, d) > 0 ? FIGHT.pushSpeed : cfg.speed;
  if (!t) {
    wanderLoose(w, d, dt);
  } else if (t.type === 'segment') {
    const ex = w.exhibitById(t.exhibitId);
    if (ex && approachFence(w, d, t.x, t.y, speed, dt)) {
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
  } else if (t.type === 'unit') {
    const u = w.unitById(t.id);
    if (u && startWindup(w, d, u)) return;
    if (u) chase(w, d, u.x, u.y, cfg.radius + UNITS[u.kind].radius, cfg.speed, dt);
  }
  biteTroops(w, d);
  fightBites(w, d);
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
  const u = lockedUnit(w, d);
  if (!u) {
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
    if (!onMap(u)) continue;
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
    damageUnit(w, hit, cfg.troopDamage, 'trex');
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

/**
 * The troop or tower the T. rex is locked onto, if it's still there. A troop that climbed into the 4x4 hands
 * the lock to the 4x4, so the T. rex goes after the vehicle instead.
 */
function lockedUnit(w: World, d: Dino): Unit | null {
  if (!d.lockId) return null;
  let u = w.unitById(d.lockId);
  if (u?.aboard) {
    u = w.unitById(u.aboard);
    d.lockId = u && !u.dead ? u.id : 0;
  }
  return u && !u.dead && !u.aboard ? u : null;
}

function targetAlive(w: World, t: DinoTarget): boolean {
  if (t.type === 'visitor') {
    const v = w.visitorById(t.id);
    return !!v && !v.done;
  }
  if (t.type === 'unit') {
    const u = w.unitById(t.id);
    return !!u && onMap(u);
  }
  if (t.type === 'dino') {
    const o = w.dinoById(t.id);
    return !!o && o.state === 'loose';
  }
  const ex = w.exhibitById(t.exhibitId);
  return !!ex && ex.segments[t.index].hp > 0;
}

/**
 * 1. The troop or tower it is locked onto, until that dies or gets 12 tiles away.
 * 2. Whoever darted it in the last 5 s, within 8 tiles. It locks on.
 * 3. The nearest visitor within 10 tiles.
 * 4. Break into the nearest exhibit with animals still inside (and no power).
 * 5. The nearest visitor anywhere, then the nearest troop or tower anywhere (and lock on).
 * In level 5, while FIGHT.shieldRaptors or more raptors are on it, it is too busy with them for 1 and 2.
 */
function chooseTrexTarget(w: World, d: Dino): DinoTarget | null {
  const T = w.T;
  const shielded = raptorsOn(w, d) >= FIGHT.shieldRaptors;
  if (d.lockId) {
    const u = lockedUnit(w, d);
    if (u && dist(u, d) <= DINO_AI.trexLockBreakTiles * T) {
      if (!shielded) return { type: 'unit', id: u.id };
    } else d.lockId = 0;
  }
  if (!shielded && w.time - d.lastHitTime <= DINO_AI.trexLockSeconds) {
    const u = w.unitById(d.lastHitBy);
    if (u && onMap(u) && dist(u, d) <= DINO_AI.trexLockRadiusTiles * T) return lockOn(w, d, u);
  }
  const near = nearestVisitor(w, d, DINO_AI.trexVisitorRadiusTiles * T);
  if (near) return { type: 'visitor', id: near.id };
  // Stick with a fence it has already started on.
  const cur = d.target;
  if (cur?.type === 'segment' && targetAlive(w, cur)) return cur;
  const breakIn = chooseBreakIn(w, d);
  if (breakIn) return breakIn;
  // Level 5: with no pen left to break into, it stands and fights whatever raptors are on it.
  if (w.mission?.fights && raptorsOn(w, d) > 0) return null;
  const anyVisitor = nearestVisitor(w, d, Infinity);
  if (anyVisitor) return { type: 'visitor', id: anyVisitor.id };
  const anyUnit = nearestUnit(w, d, Infinity);
  return anyUnit ? lockOn(w, d, anyUnit) : null;
}

/**
 * It locks onto a troop or tower. In the levels where it roars (MissionConfig.roars), it roars first: it stops and
 * faces it for FIGHT.lockRoarSeconds before it moves or charges, so there is time to get that troop away. Elsewhere it
 * comes at once, and the charge's wind-up is the only warning.
 */
function lockOn(w: World, d: Dino, u: Unit): DinoTarget {
  if (d.lockId !== u.id && w.mission?.roars) {
    d.roar = FIGHT.lockRoarSeconds;
    d.facing = Math.atan2(u.y - d.y, u.x - d.x);
    d.path = [];
    d.pathIndex = 0;
    w.events.push({ type: 'roar', dinoId: d.id, unitId: u.id, x: d.x, y: d.y });
  }
  d.lockId = u.id;
  return { type: 'unit', id: u.id };
}

/** Roaring: it faces its troop and stays where it is. Raptors in reach still get bitten. */
function roarStep(w: World, d: Dino, dt: number): void {
  d.roar = Math.max(0, d.roar - dt);
  const u = lockedUnit(w, d);
  if (u) d.facing = Math.atan2(u.y - d.y, u.x - d.x);
  else d.roar = 0;
  fightBites(w, d);
}

/** The nearest pen with animals still inside, no gap, and no power, and the outside spot by its nearest segment. */
function chooseBreakIn(w: World, d: Dino): DinoTarget | null {
  let target: Exhibit | null = null;
  let bestD = Infinity;
  for (const ex of w.exhibits) {
    if (ex.id === d.home || ex.powered || hasExit(w, ex)) continue;
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

// ------------------------------------------------------------------ raptors

/**
 * Every loose raptor, in every level, only knows what it sees and touches. Calm, it walks its route, stays by its nest,
 * or heads for the crowd. Someone in its cone makes it stop and stare: a troop still in sight after
 * STEALTH.noticeSeconds is hunted, and the pack is called; a guest, panicking in the dark, gives itself away at once.
 * Anyone who walks into it is noticed at once. A dart sets it on the shooter: with the call if it was calm and saw the
 * shot, alone if not, and any raptor that sees it hit comes too. A pack circles a troop before it strikes
 * (circleRound), and in the strike each keeps to its prey and goes straight on to the next troop when it falls. Prey
 * it loses sight of for a few seconds it gives up on. In level 5's fight, a calm raptor near the
 * T. rex fights it instead, and only a dart pulls it away.
 */
function stalk(w: World, d: Dino, dt: number): void {
  const cfg = DINOS.raptor;
  if (d.lastHitTime > d.heardHit) {
    d.heardHit = d.lastHitTime;
    const u = w.unitById(d.lastHitBy);
    // Calm, it calls the others only if it saw who shot. After a troop, it keeps to its prey when the shot comes from
    // the troops with it. Otherwise it turns on the shooter alone, at once. Either way, a pack that was circling its
    // prey rushes it now that one of them is hit.
    if (u && onMap(u)) {
      const shooter: PreyRef = { type: 'unit', id: u.id };
      const prey = d.target?.type === 'unit' ? w.unitById(d.target.id) : undefined;
      if (!d.target && inView(w, d, u.x, u.y)) spot(w, d, shooter);
      else if (prey && onMap(prey) && canDart(prey.kind) && dist(u, prey) <= PACK.groupTiles * w.T) rushAll(huntersOf(w, prey.id));
      else {
        if (prey) rushAll(huntersOf(w, prey.id));
        hunt(w, d, shooter);
        d.rush = true;
      }
      // Any raptor that sees it hit, and isn't already after a troop or in a fight, comes for the shooter too.
      for (const o of w.dinos) {
        if (o === d || o.kind !== 'raptor' || o.state !== 'loose' || o.target?.type === 'dino' || o.target?.type === 'unit') continue;
        if (inView(w, o, d.x, d.y)) {
          hunt(w, o, shooter);
          o.rush = true;
        }
      }
    }
  }
  if (d.target && !targetAlive(w, d.target)) {
    // In the middle of a strike, it goes straight on to the nearest one left where its prey fell. Otherwise it calms down.
    const striking = d.rush && d.target.type === 'unit';
    const fell = d.seen ?? { x: d.x, y: d.y };
    loseTrack(d);
    const next = striking ? nearestUnit(w, fell, PACK.groupTiles * w.T) : null;
    if (next) {
      hunt(w, d, { type: 'unit', id: next.id });
      d.rush = true;
    }
  }
  if (d.target?.type === 'dino' || (!d.target && joinFight(w, d))) {
    fight(w, d, dt);
    return;
  }
  let prey = preyOf(w, d.target);
  if (!prey) {
    const seen = noticed(w, d);
    // A guest in the dark is screaming and running: it gives itself away at once, as anyone who walks into a raptor does.
    if (seen?.touch || seen?.prey.type === 'visitor') {
      spot(w, d, seen.prey);
      prey = preyOf(w, d.target);
    } else if (seen) {
      if (d.notice <= 0 && seen.unit) w.noteNoticed(d, seen.unit);
      d.notice += dt;
      if (d.notice >= STEALTH.noticeSeconds) {
        spot(w, d, seen.prey);
        prey = preyOf(w, d.target);
      }
    } else if (d.notice > 0) {
      d.notice = Math.max(0, d.notice - dt);
    }
  }
  if (prey) {
    if (tracking(w, d, prey)) {
      d.lost = 0;
      d.seen = { x: prey.x, y: prey.y };
    } else d.lost += dt;
    // Out of sight, it runs to where it last saw its prey, and gives up if it doesn't see it again.
    const to = d.lost > 0 && d.seen ? d.seen : prey;
    if (d.lost >= STEALTH.giveUpSeconds) loseTrack(d);
    else if (to !== prey || !circleRound(w, d, dt)) chase(w, d, to.x, to.y, to === prey ? cfg.radius + prey.r : 0, cfg.speed, dt);
  } else if (d.notice <= 0) {
    roam(w, d, dt);
  }
  biteTroops(w, d);
}

/** A raptor makes someone out, or sees a troop shoot. It hunts them, and for a troop, every calm raptor within earshot comes too. */
function spot(w: World, d: Dino, t: PreyRef): void {
  hunt(w, d, t);
  // A guest is easy prey, so it calls nobody; a troop is a threat, and the pack comes.
  if (t.type === 'visitor') return;
  for (const o of w.dinos) {
    if (o === d || o.kind !== 'raptor' || o.state !== 'loose' || o.target) continue;
    if (dist(o, d) <= STEALTH.alertTiles * w.T) hunt(w, o, t);
  }
}

function hunt(w: World, d: Dino, t: PreyRef): void {
  const p = preyOf(w, t);
  d.lost = 0;
  d.notice = 0;
  d.seen = p ? { x: p.x, y: p.y } : null;
  if (d.target?.type === t.type && d.target.id === t.id) return;
  d.target = { ...t };
  d.circle = 0;
  d.rush = false;
  d.ring = NaN;
  d.look = 0;
  d.wander = null;
  d.path = [];
  d.pathIndex = 0;
  d.repath = 0;
  const u = t.type === 'unit' ? w.unitById(t.id) : null;
  if (u) w.noteSpotted(d, u);
}

function loseTrack(d: Dino): void {
  d.target = null;
  d.lost = 0;
  d.notice = 0;
  d.seen = null;
  d.circle = 0;
  d.rush = false;
  d.ring = NaN;
  d.wander = null;
  d.path = [];
  d.pathIndex = 0;
  d.repath = 0;
}

/** The loose raptors hunting a unit, in a steady order. */
export function huntersOf(w: World, unitId: number): Dino[] {
  return w.dinos.filter((o) => o.kind === 'raptor' && o.state === 'loose' && o.target?.type === 'unit' && o.target.id === unitId);
}

/** Whether the raptors after this unit are circling it: two or more, after prey that can dart, and none has rushed yet. */
export function packCircling(w: World, unitId: number): boolean {
  const u = w.unitById(unitId);
  const pack = huntersOf(w, unitId);
  return !!u && canDart(u.kind) && pack.length > 1 && !pack.some((d) => d.rush);
}

function rushAll(pack: readonly Dino[]): void {
  for (const o of pack) o.rush = true;
}

const angleDiff = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

/**
 * The ring a pack waits on round its prey: centered on the prey's group (it and every troop or tower that can dart
 * within PACK.groupTiles of it), and out of reach of all of them, PACK.marginTiles past the farthest dart. So a
 * group that walks out at a raptor moves the ring away with it.
 */
export function packRing(w: World, prey: Unit): { c: Point; R: number } {
  const group = w.units.filter((o) => onMap(o) && canDart(o.kind) && dist(o, prey) <= PACK.groupTiles * w.T);
  if (!group.includes(prey)) group.push(prey);
  const c = { x: group.reduce((a, o) => a + o.x, 0) / group.length, y: group.reduce((a, o) => a + o.y, 0) / group.length };
  const R = Math.max(...group.map((o) => dist(o, c) + UNITS[o.kind].range)) + PACK.marginTiles * w.T;
  return { c, R };
}

/**
 * Where each raptor of a pack waits: on the ring, the one nearest the middle in front and the rest spread evenly
 * round, in the order they already stand so nobody crosses. When water, a whole pen, or the park's edge cuts the
 * ring, they spread along the open part instead, the way a pack hems in troops with their backs to a pond. Each keeps
 * its direction from the middle until the pack grows or shrinks, so the ring follows moving troops without
 * shuffling. Matches `pack`, and each place is moved onto open ground.
 */
export function ringPlaces(w: World, ring: { c: Point; R: number }, pack: readonly Dino[]): Point[] {
  const { c, R } = ring;
  if (pack.some((o) => Number.isNaN(o.ring) || o.ringN !== pack.length)) {
    const lead = pack.reduce((a, o) => (dist(o, c) < dist(a, c) ? o : a));
    const base = Math.atan2(lead.y - c.y, lead.x - c.x);
    const arc = openArc(w, c, R, base);
    const angleOf = (o: Dino) => Math.atan2(o.y - c.y, o.x - c.x);
    if (!arc) {
      const turn = (o: Dino) => {
        const a = angleDiff(angleOf(o), base);
        return a < 0 ? a + Math.PI * 2 : a;
      };
      const order = pack.slice().sort((a, b) => (a === lead ? -1 : b === lead ? 1 : turn(a) - turn(b) || a.id - b.id));
      order.forEach((o, i) => (o.ring = base + (i * Math.PI * 2) / pack.length));
    } else {
      // Along the open part, from one end to the other. One standing where the ring is cut counts from the nearer end.
      const [from, to] = arc;
      const along = (o: Dino) => {
        let a = from + ((((angleOf(o) - from) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2));
        if (a > to && a - to > from + Math.PI * 2 - a) a -= Math.PI * 2;
        return a;
      };
      const order = pack.slice().sort((a, b) => along(a) - along(b) || a.id - b.id);
      order.forEach((o, i) => (o.ring = from + ((to - from) * (i + 0.5)) / pack.length));
    }
    for (const o of pack) o.ringN = pack.length;
  }
  return pack.map((o) => ringSpot(w, c, o.ring, R));
}

/** Whether a raptor can stand at this point. */
function standable(w: World, x: number, y: number): boolean {
  const tx = Math.floor(x / w.T);
  const ty = Math.floor(y / w.T);
  return w.grid.inBounds(tx, ty) && w.dinoWalk(tx, ty);
}

/**
 * A point a raptor can stand on at this angle from the middle of the ring: on the ring, up to PACK.slackTiles outside
 * it, or half the margin inside (still out of dart range). So a rock or a pen corner doesn't cut the ring; water, a
 * whole pen, or the park's edge does.
 */
function ringPoint(w: World, c: Point, a: number, R: number): Point | null {
  const radii = [R];
  for (let k = 1; k <= PACK.slackTiles; k++) radii.push(R + k * w.T);
  radii.push(R - (PACK.marginTiles / 2) * w.T);
  for (const r of radii) {
    const x = c.x + Math.cos(a) * r;
    const y = c.y + Math.sin(a) * r;
    if (standable(w, x, y)) return { x, y };
  }
  return null;
}

/** Whether a raptor can stand at this angle from the middle of the ring (see ringPoint). */
function ringOpen(w: World, c: Point, a: number, R: number): boolean {
  return ringPoint(w, c, a, R) !== null;
}

/**
 * The open stretch of the ring through angle `a` (or the open stretch nearest it), as [from, to] with from < to,
 * when water, a whole pen, HQ, or the park's edge cuts the ring (see ringPoint). Null when the whole ring is open, or
 * none of it. Checked every 10 degrees.
 */
function openArc(w: World, c: Point, R: number, a: number): [number, number] | null {
  const n = 36;
  const step = (Math.PI * 2) / n;
  const open = Array.from({ length: n }, (_, k) => ringOpen(w, c, a + k * step, R));
  if (open.every(Boolean) || !open.some(Boolean)) return null;
  const at = (k: number) => open[((k % n) + n) % n];
  let k0 = 0;
  for (let k = 0; k <= n / 2 && !at(k0); k++) k0 = at(k) ? k : at(-k) ? -k : k0;
  let lo = k0;
  let hi = k0;
  while (at(lo - 1)) lo--;
  while (at(hi + 1)) hi++;
  return [a + lo * step, a + hi * step];
}

/** Whether the ring is open all the way from angle `a` round by `off` (radians, either way), checked every 15 degrees. */
function arcClear(w: World, c: Point, R: number, a: number, off: number): boolean {
  const n = Math.ceil(Math.abs(off) / (Math.PI / 12));
  for (let k = 1; k <= n; k++) if (!ringOpen(w, c, a + (off * k) / n, R)) return false;
  return true;
}

/**
 * A spot on the ring at this angle a raptor can stand on (see ringPoint). Past the edge of the map, or in water or a
 * pen, it tries the angles either side, 15 degrees at a time, before it settles for the nearest open tile.
 */
function ringSpot(w: World, c: Point, a: number, R: number): Point {
  for (let k = 0; k <= 8; k++) {
    for (const s of k ? [1, -1] : [1]) {
      const p = ringPoint(w, c, a + s * k * (Math.PI / 12), R);
      if (p) return p;
    }
  }
  return openNear(w, c.x + Math.cos(a) * R, c.y + Math.sin(a) * R);
}

/** The center of the nearest tile a raptor can stand on. */
function openNear(w: World, x: number, y: number): Point {
  const T = w.T;
  const t = nearestOpenTile(w.grid.cols, w.grid.rows, w.dinoWalk, Math.floor(x / T), Math.floor(y / T));
  if (!t) return { x, y };
  return t.x === Math.floor(x / T) && t.y === Math.floor(y / T) ? { x, y } : { x: (t.x + 0.5) * T, y: (t.y + 0.5) * T };
}

/**
 * Raptors hunting a troop that can dart circle it before they strike. Each takes its own place on a ring around it,
 * out of dart range: the one nearest the prey waits in front while the rest go round. Once every raptor is in place,
 * or after PACK.circleSeconds, or as soon as one of them is darted, they all rush it together. A lone raptor, or prey
 * that can't dart (the Engineer, the 4x4), gets a straight charge. Returns true while it circles.
 */
function circleRound(w: World, d: Dino, dt: number): boolean {
  if (d.rush || d.target?.type !== 'unit') return false;
  const u = w.unitById(d.target.id);
  const pack = huntersOf(w, d.target.id);
  if (!u || !canDart(u.kind) || pack.length < 2 || pack.some((o) => o.rush)) {
    d.rush = true;
    return false;
  }
  d.circle += dt;
  const ring = packRing(w, u);
  const places = ringPlaces(w, ring, pack);
  const near = PACK.placeTiles * w.T;
  if (pack.every((o, i) => dist(o, places[i]) <= near) || pack.some((o) => o.circle >= PACK.circleSeconds)) {
    rushAll(pack);
    return false;
  }
  // Round the ring toward its place, the short way unless something cuts the ring there. It aims a little way ahead
  // along the ring's tangent, so it goes round at the ring's distance (backing out to it first if it is inside)
  // instead of cutting across or spiralling in.
  const { c, R } = ring;
  const goal = places[pack.indexOf(d)];
  const a = Math.atan2(d.y - c.y, d.x - c.x);
  let off = angleDiff(Math.atan2(goal.y - c.y, goal.x - c.x), a);
  if (!arcClear(w, c, R, a, off)) {
    const other = off > 0 ? off - Math.PI * 2 : off + Math.PI * 2;
    if (arcClear(w, c, R, a, other)) off = other;
  }
  const ahead = (PACK.aheadDeg * Math.PI) / 180;
  const step = Math.max(-ahead, Math.min(ahead, off));
  const tangent = { x: c.x + Math.cos(a + step) * (R / Math.cos(step)), y: c.y + Math.sin(a + step) * (R / Math.cos(step)) };
  const to = Math.abs(off) <= ahead ? goal : standable(w, tangent.x, tangent.y) ? tangent : (ringPoint(w, c, a + step, R) ?? goal);
  if (dist(d, goal) <= near) {
    // In place: it waits, watching its prey.
    d.path = [];
    d.pathIndex = 0;
    d.facing = Math.atan2(u.y - d.y, u.x - d.x);
  } else chase(w, d, to.x, to.y, 0, DINOS.raptor.speed, dt);
  return true;
}

/**
 * A calm raptor with nobody in sight walks its route (level 4) or stays by its nest (level 2). Otherwise it heads for
 * the crowd: the nearest guest while there are guests in the park, and once they're gone, the nearest troop. It knows
 * where people are, but it only goes after someone it makes out.
 */
function roam(w: World, d: Dino, dt: number): void {
  if (d.patrol?.length) walkRoute(w, d, d.patrol, dt);
  else if (d.nest) roamNest(w, d, d.nest, dt);
  else {
    const crowd = nearestVisitor(w, d, Infinity) ?? nearestUnit(w, d, Infinity);
    if (crowd) chase(w, d, crowd.x, crowd.y, 0, DINOS.raptor.speed, dt);
    else wanderLoose(w, d, dt);
  }
}

/** With nobody to chase, a nest raptor runs back to its nest, then wanders close to it. */
function roamNest(w: World, d: Dino, nest: Point, dt: number): void {
  const roam = NEST.roamTiles * w.T;
  if (dist(d, nest) > roam + w.T) {
    d.wander = null;
    navigate(w, d, nest.x, nest.y, DINOS[d.kind].speed, dt);
    return;
  }
  if (d.wait > 0) {
    d.wait -= dt;
    return;
  }
  dropBlockedWander(w, d);
  if (!d.wander) {
    const a = rand(w, 0, Math.PI * 2);
    const r = rand(w, 0, roam);
    const x = nest.x + Math.cos(a) * r;
    const y = nest.y + Math.sin(a) * r;
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

/** A calm raptor walks its route and stops at each stop to look around. */
function walkRoute(w: World, d: Dino, route: readonly Point[], dt: number): void {
  if (d.look > 0) {
    d.look = Math.max(0, d.look - dt);
    const k = 1 - d.look / STEALTH.lookSeconds;
    d.facing = d.lookBase + Math.sin(k * Math.PI * 2) * ((STEALTH.lookDeg * Math.PI) / 180);
    if (d.look <= 0) d.patrolIndex = (d.patrolIndex + 1) % route.length;
    return;
  }
  const stop = route[d.patrolIndex];
  if (Math.hypot(stop.x - d.x, stop.y - d.y) <= 2) {
    d.look = STEALTH.lookSeconds;
    d.lookBase = d.facing;
    d.path = [];
    d.pathIndex = 0;
    return;
  }
  chase(w, d, stop.x, stop.y, 0, STEALTH.patrolSpeed, dt);
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
    if (!onMap(u)) continue;
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
    if (!onMap(u)) continue;
    const reach = cfg.radius + UNITS[u.kind].radius + DINO_AI.biteReachPx;
    const dd = dist(u, d);
    if (dd > reach) continue;
    // The T. rex bites the troop it's locked onto, and a raptor its prey, whenever they're in reach.
    if (u.id === d.lockId || (d.target?.type === 'unit' && d.target.id === u.id)) {
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
  // A raptor that bites a troop it wasn't after has seen it now.
  if (d.kind === 'raptor' && !(d.target?.type === 'unit' && d.target.id === victim.id)) w.noteSpotted(d, victim);
  damageUnit(w, victim, cfg.troopDamage, d.kind);
}

// ------------------------------------------------------------------ level 5: fights

/** Close enough to bite another animal: both bodies plus the bite's reach. */
function inBiteReach(a: Dino, b: Dino): boolean {
  return dist(a, b) <= DINOS[a.kind].radius + DINOS[b.kind].radius + DINO_AI.biteReachPx;
}

/** Where a raptor fighting another animal stands: just outside both bodies, at its own angle, turning slowly. */
function fightSpot(w: World, d: Dino, o: Dino): Point {
  // The golden angle keeps any number of raptors spread around the circle.
  const a = d.id * 2.39996 + w.time * FIGHT.circleSpeed;
  const r = DINOS[d.kind].radius + DINOS[o.kind].radius + 2;
  return { x: o.x + Math.cos(a) * r, y: o.y + Math.sin(a) * r };
}

/** The nearest loose T. rex within a radius, for a raptor to fight. */
function nearestRival(w: World, d: Dino, radius: number): Dino | null {
  let best: Dino | null = null;
  let bestD = radius;
  for (const o of w.dinos) {
    if (o.kind !== 'trex' || o.state !== 'loose') continue;
    const dd = dist(o, d);
    if (dd <= bestD) {
      bestD = dd;
      best = o;
    }
  }
  return best;
}

/** Level 5: a calm raptor near a loose T. rex goes for it. */
function joinFight(w: World, d: Dino): boolean {
  if (!w.mission?.fights) return false;
  const rex = nearestRival(w, d, FIGHT.joinTiles * w.T);
  if (!rex) return false;
  loseTrack(d);
  d.target = { type: 'dino', id: rex.id };
  return true;
}

/**
 * Level 5: a raptor in the fight takes its own side of the T. rex and keeps circling, so the pack spreads around it,
 * and bites it. Busy, it pays troops no mind. It lets go if the T. rex gets away.
 */
function fight(w: World, d: Dino, dt: number): void {
  const o = d.target?.type === 'dino' ? w.dinoById(d.target.id) : undefined;
  if (!o || o.state !== 'loose' || dist(o, d) > FIGHT.joinTiles * w.T) {
    loseTrack(d);
    return;
  }
  const cfg = DINOS.raptor;
  const at = fightSpot(w, d, o);
  if (w.dinoWalk(Math.floor(at.x / w.T), Math.floor(at.y / w.T))) chase(w, d, at.x, at.y, 0, cfg.speed, dt);
  else chase(w, d, o.x, o.y, cfg.radius + DINOS[o.kind].radius, cfg.speed, dt);
  biteRival(w, d, o.id);
}

/** Level 5: how many loose raptors are on the T. rex, close enough to count as fighting it. */
export function raptorsOn(w: World, d: Dino): number {
  if (!w.mission?.fights) return 0;
  const reach = DINOS.trex.radius + DINOS.raptor.radius + FIGHT.engageTiles * w.T;
  return w.dinos.filter((o) => o.kind === 'raptor' && o.state === 'loose' && o.target?.type === 'dino' && o.target.id === d.id && dist(o, d) <= reach).length;
}

/** A raptor fighting the T. rex bites it when it's in reach and its bite is ready. */
function biteRival(w: World, d: Dino, rivalId: number): void {
  if (d.cooldown > 0 || d.pause > 0) return;
  const o = w.dinoById(rivalId);
  if (!o || o.state !== 'loose' || !inBiteReach(d, o)) return;
  d.cooldown = DINOS[d.kind].biteIntervalSeconds;
  d.facing = Math.atan2(o.y - d.y, o.x - d.x);
  w.events.push({ type: 'maul', dinoId: d.id, victimId: o.id, x: o.x, y: o.y });
  hurtAnimal(w, o, FIGHT.raptorBite, d);
}

/** Level 5: the T. rex bites the most wounded raptor in reach, on its own timer, whatever else it's doing. */
function fightBites(w: World, d: Dino): void {
  if (d.kind !== 'trex' || !w.mission?.fights || d.fightCooldown > 0 || d.pause > 0) return;
  let victim: Dino | null = null;
  for (const o of w.dinos) {
    if (o.kind !== 'raptor' || o.state !== 'loose' || !inBiteReach(d, o)) continue;
    if (!victim || o.health < victim.health) victim = o;
  }
  if (!victim) return;
  d.fightCooldown = FIGHT.trexBiteSeconds;
  d.facing = Math.atan2(victim.y - d.y, victim.x - d.x);
  w.events.push({ type: 'maul', dinoId: d.id, victimId: victim.id, x: victim.x, y: victim.y });
  hurtAnimal(w, victim, FIGHT.trexBite, d);
}

/** An animal is hurt in a fight. At 0 health it's killed. */
export function hurtAnimal(w: World, d: Dino, amount: number, by: Dino | null): void {
  if (d.state === 'dead' || d.state === 'secured') return;
  d.health = Math.max(0, d.health - amount);
  d.hurtAt = w.time;
  if (d.health > 0) return;
  d.state = 'dead';
  d.fade = FIGHT.deadSeconds;
  calm(d);
  d.cooldown = 0;
  w.noteKilled(d, by?.kind ?? null);
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
      d.sturn = 0;
      d.facing = Math.atan2(dy, dx);
      d.stampede = DINO_AI.triStampedeSeconds;
      d.wander = null;
      w.events.push({ type: 'stampede', dinoId: d.id, x: d.x, y: d.y, byTroop: w.units.some((u) => u === threat) });
      return;
    }
  }
  if (d.state === 'penned') wanderInPen(w, d, dt);
  else wanderLoose(w, d, dt);
}

/** Predators (penned or loose), troops, and the 4x4 scare Triceratops. Other Triceratops and towers don't. */
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
    if (!onMap(u) || u.kind === 'tower') continue;
    const dd = dist(u, d);
    if (dd <= bestD) {
      bestD = dd;
      best = u;
    }
  }
  return best;
}

/**
 * Whether a stampede going this way runs into something it can't break within `ahead` px: rock, water,
 * a building, the park's edge, or a fence with power.
 */
function stampedeBlocked(w: World, d: Dino, dx: number, dy: number, ahead: number): boolean {
  const r = DINOS.triceratops.radius;
  const px = d.x + dx * (ahead + r);
  const py = d.y + dy * (ahead + r);
  const lx = Math.floor(px / w.T);
  const ly = Math.floor(py / w.T);
  const t = w.grid.inBounds(lx, ly) ? w.grid.get(lx, ly) : Tile.Rock;
  if (t === Tile.Rock || t === Tile.Water || t === Tile.HQ || t === Tile.Tower || t === Tile.Substation) return true;
  const hit = crossesIntactFence(w, d.x, d.y, px, py);
  return !!hit && hit.exhibit.powered;
}

/**
 * Turns a blocked stampede along whatever is in the way: the smallest clear turn, toward the side with more
 * room. The whole stampede never turns more than the limit from straight away, so a Triceratops that meets
 * a second wall in a corner stops there. Returns false when it is cornered.
 */
function slideStampede(w: World, d: Dino, step: number): boolean {
  const max = (DINO_AI.triSlideMaxDeg * Math.PI) / 180 + 1e-6;
  const room = (o: { dx: number; dy: number }) => {
    let n = 0;
    for (let k = 1; k <= 4 && !stampedeBlocked(w, d, o.dx, o.dy, step + (k * w.T) / 4); k++) n++;
    return n;
  };
  for (let deg = DINO_AI.triSlideStepDeg; deg <= 180; deg += DINO_AI.triSlideStepDeg) {
    const a = (deg * Math.PI) / 180;
    const options = [a, -a]
      .filter((t) => Math.abs(d.sturn + t) <= max)
      .map((t) => ({ t, dx: d.sdx * Math.cos(t) - d.sdy * Math.sin(t), dy: d.sdx * Math.sin(t) + d.sdy * Math.cos(t) }))
      .filter((o) => !stampedeBlocked(w, d, o.dx, o.dy, step));
    if (!options.length) continue;
    const best = options.length === 2 && room(options[1]) > room(options[0]) ? options[1] : options[0];
    d.sdx = best.dx;
    d.sdy = best.dy;
    d.sturn += best.t;
    d.facing = Math.atan2(best.dy, best.dx);
    return true;
  }
  return false;
}

function stampedeStep(w: World, d: Dino, dt: number): void {
  const cfg = DINOS.triceratops;
  const step = cfg.speed * dt;
  // Rock, water, a building, the park's edge, or a fence with power: turn along it, and stop only
  // when cornered. A fence without power still takes the hit and stops it (below).
  if (stampedeBlocked(w, d, d.sdx, d.sdy, step) && !slideStampede(w, d, step)) {
    endStampede(w, d);
    return;
  }
  const nx = d.x + d.sdx * step;
  const ny = d.y + d.sdy * step;

  const hit = crossesIntactFence(w, d.x, d.y, nx, ny);
  if (hit) {
    damageSegment(w, hit.exhibit, hit.index, cfg.fenceDamage);
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
  if (inside && w.mission && d.state === 'loose' && home.powered) cameHome(w, d);
  else if (inside) d.state = 'penned';
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
      if (by.kind === 'raptor') loseTrack(by);
      else by.target = null;
      by.think = 0;
    }
  }
}

/** A visitor dies. Everyone who saw it runs. */
export function killVisitor(w: World, v: Visitor, cause: CasualtyCause): void {
  v.done = true;
  w.casualties[cause]++;
  w.noteDeath(cause, v.x, v.y);
  w.events.push({ type: 'casualty', x: v.x, y: v.y, cause });
  panicNear(w, v.x, v.y, VISITORS.panicCasualtyRadiusTiles * w.T);
}

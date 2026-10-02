import { EXHIBITS, VISITORS } from '../config';
import { Tile } from './grid';
import type { World } from './world';

export type VisitorMode = 'walking' | 'viewing' | 'leaving' | 'fleeing';

export interface Visitor {
  id: number;
  x: number;
  y: number;
  /** Tile the visitor last reached. */
  cx: number;
  cy: number;
  /** Tile it is walking to. Same as cx, cy while standing still. */
  tx: number;
  ty: number;
  /** Personal offset from the middle of the path, so crowds walk in loose lanes. */
  ox: number;
  oy: number;
  mode: VisitorMode;
  /** Exhibit id while walking to or viewing an exhibit, 0 otherwise. */
  target: number;
  visited: number[];
  /** Seconds left before the visitor heads home. */
  budget: number;
  /** Seconds left at the current exhibit. */
  timer: number;
  /** Seconds a predator has been touching this visitor. */
  contact: number;
  done: boolean;
}

const NEIGHBORS: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

export function updateVisitors(w: World, dt: number): void {
  if (w.phase === 'build' && w.exhibits.length > 0) {
    let appeal = 0;
    for (const e of w.exhibits) appeal += EXHIBITS[e.kind].appeal;
    w.spawnAccumulator += (VISITORS.spawnBasePerSecond + VISITORS.spawnPerAppealPerSecond * appeal) * dt;
    while (w.spawnAccumulator >= 1) {
      w.spawnAccumulator -= 1;
      if (w.visitors.length < VISITORS.maxInPark) w.visitors.push(spawnVisitor(w));
    }
  }
  panicNearLooseDinos(w);
  for (const v of w.visitors) if (!v.done) step(w, v, dt);
}

/** Visitors who see a loose dinosaur close by run for the gate. */
function panicNearLooseDinos(w: World): void {
  const r = VISITORS.panicDinoRadiusTiles * w.T;
  const loose = w.dinos.filter((d) => d.state === 'loose');
  if (!loose.length) return;
  for (const v of w.visitors) {
    if (v.done || v.mode === 'fleeing') continue;
    for (const d of loose) {
      if (Math.hypot(d.x - v.x, d.y - v.y) <= r) {
        flee(w, v);
        break;
      }
    }
  }
}

export function spawnVisitor(w: World): Visitor {
  const { gate } = w.map;
  const j = VISITORS.laneJitterPx;
  const ox = (w.rng() * 2 - 1) * j;
  const oy = (w.rng() * 2 - 1) * j;
  const v: Visitor = {
    id: w.newId(),
    x: (gate.x + 0.5) * w.T + ox,
    y: (gate.y + 0.5) * w.T + oy,
    cx: gate.x,
    cy: gate.y,
    tx: gate.x,
    ty: gate.y,
    ox,
    oy,
    mode: 'walking',
    target: 0,
    visited: [],
    budget: VISITORS.timeBudgetSeconds,
    timer: 0,
    contact: 0,
    done: false,
  };
  chooseNext(w, v);
  route(w, v);
  return v;
}

/** Everyone within a radius of something frightening runs for the gate. */
export function panicNear(w: World, x: number, y: number, radius: number): void {
  for (const v of w.visitors) {
    if (!v.done && v.mode !== 'fleeing' && Math.hypot(v.x - x, v.y - y) <= radius) flee(w, v);
  }
}

function flee(w: World, v: Visitor): void {
  const standing = v.mode === 'viewing' || (v.tx === v.cx && v.ty === v.cy);
  v.mode = 'fleeing';
  v.target = 0;
  if (standing) route(w, v);
}

function step(w: World, v: Visitor, dt: number): void {
  if (v.mode !== 'fleeing') v.budget -= dt;

  if (v.mode === 'viewing') {
    v.timer -= dt;
    if (v.timer <= 0) {
      pay(w, v);
      chooseNext(w, v);
      route(w, v);
    }
    return;
  }

  const speed = v.mode === 'fleeing' ? VISITORS.fleeSpeed : VISITORS.walkSpeed;
  const gx = (v.tx + 0.5) * w.T + v.ox;
  const gy = (v.ty + 0.5) * w.T + v.oy;
  const dx = gx - v.x;
  const dy = gy - v.y;
  const d = Math.hypot(dx, dy);
  const stepLen = speed * dt;
  if (d > stepLen) {
    v.x += (dx / d) * stepLen;
    v.y += (dy / d) * stepLen;
    return;
  }
  v.x = gx;
  v.y = gy;
  v.cx = v.tx;
  v.cy = v.ty;
  arrive(w, v);
}

function arrive(w: World, v: Visitor): void {
  if (v.mode === 'leaving' || v.mode === 'fleeing') {
    if (w.grid.get(v.cx, v.cy) === Tile.Gate) {
      v.done = true;
      // Running or strolling, anyone who walks out after the lights go out made it.
      if (w.phase !== 'build') w.visitorsSafe++;
      return;
    }
  } else if (v.mode === 'walking') {
    const ex = w.exhibitById(v.target);
    if (ex && v.cx === ex.viewingSpot.x && v.cy === ex.viewingSpot.y) {
      v.mode = 'viewing';
      v.timer = VISITORS.viewSeconds;
      return;
    }
    if (!ex || v.budget <= 0) chooseNext(w, v);
  }
  route(w, v);
}

/** Picks the most appealing unvisited exhibit, discounted by walking distance. */
function chooseNext(w: World, v: Visitor): void {
  v.target = 0;
  if (v.budget > 0) {
    const i = w.grid.index(v.cx, v.cy);
    let bestScore = -Infinity;
    for (const ex of w.exhibits) {
      if (v.visited.includes(ex.id)) continue;
      const d = w.visitorFields.get(ex.id)?.[i] ?? -1;
      if (d < 0) continue;
      const score = EXHIBITS[ex.kind].appeal / (1 + d / VISITORS.distanceFalloffTiles) + w.rng() * VISITORS.choiceNoise;
      if (score > bestScore) {
        bestScore = score;
        v.target = ex.id;
      }
    }
  }
  v.mode = v.target ? 'walking' : 'leaving';
}

/** Sets the next tile toward the visitor's goal, following the distance field downhill. */
function route(w: World, v: Visitor): void {
  const field = v.mode === 'walking' ? w.visitorFields.get(v.target) : w.gateField;
  if (!field) {
    v.done = true;
    return;
  }
  const here = field[w.grid.index(v.cx, v.cy)];
  if (here < 0) {
    // Off the network (shouldn't happen). Drop the visitor rather than strand them.
    v.done = true;
    return;
  }
  v.tx = v.cx;
  v.ty = v.cy;
  if (here === 0) return;
  // Rotate the neighbor order per visitor so crowds split across equal routes.
  for (let k = 0; k < 4; k++) {
    const [dx, dy] = NEIGHBORS[(k + v.id) % 4];
    const nx = v.cx + dx;
    const ny = v.cy + dy;
    if (!w.grid.inBounds(nx, ny)) continue;
    if (field[w.grid.index(nx, ny)] === here - 1) {
      v.tx = nx;
      v.ty = ny;
      return;
    }
  }
}

function pay(w: World, v: Visitor): void {
  const ex = w.exhibitById(v.target);
  if (!ex) return;
  v.visited.push(ex.id);
  if (w.phase !== 'build') return;
  const price = EXHIBITS[ex.kind].pricePerVisit;
  w.money += price;
  w.revenue += price;
  ex.visits++;
  ex.revenue += price;
  w.events.push({ type: 'paid', x: v.x, y: v.y, amount: price });
}

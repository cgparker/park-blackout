import type { Point } from './grid';

/** True when a tile can be stood on. Tile coordinates may be off the map. */
export type Walkable = (x: number, y: number) => boolean;

/** Anything that walks along a list of world-space waypoints. */
export interface PathFollower {
  x: number;
  y: number;
  facing: number;
  path: Point[];
  pathIndex: number;
}

const DIRS8: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

const DIRS4: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

/** Binary min-heap of node indices. Duplicates are allowed; stale entries are skipped by the caller. */
class Heap {
  private readonly nodes: number[] = [];
  private readonly keys: number[] = [];

  get size(): number {
    return this.nodes.length;
  }

  push(node: number, key: number): void {
    const { nodes, keys } = this;
    let i = nodes.length;
    nodes.push(node);
    keys.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      nodes[i] = nodes[p];
      keys[i] = keys[p];
      i = p;
    }
    nodes[i] = node;
    keys[i] = key;
  }

  pop(): number {
    const { nodes, keys } = this;
    const top = nodes[0];
    const lastNode = nodes.pop()!;
    const lastKey = keys.pop()!;
    if (nodes.length) {
      let i = 0;
      const n = nodes.length;
      for (;;) {
        const l = i * 2 + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && keys[r] < keys[l] ? r : l;
        if (keys[c] >= lastKey) break;
        nodes[i] = nodes[c];
        keys[i] = keys[c];
        i = c;
      }
      nodes[i] = lastNode;
      keys[i] = lastKey;
    }
    return top;
  }
}

let scratchSize = 0;
let gCost = new Float64Array(0);
let parent = new Int32Array(0);
let closed = new Uint8Array(0);

/**
 * A* over tiles with 8-way moves that never cut a blocked corner.
 * The start tile is always allowed, so something standing in a doorway can still leave.
 * If the goal can't be reached, returns the way to the reachable tile closest to it.
 * The result excludes the start tile.
 */
export function findPath(cols: number, rows: number, walk: Walkable, sx: number, sy: number, gx: number, gy: number): Point[] {
  if (sx < 0 || sy < 0 || sx >= cols || sy >= rows) return [];
  gx = Math.max(0, Math.min(cols - 1, gx));
  gy = Math.max(0, Math.min(rows - 1, gy));
  if (sx === gx && sy === gy) return [];

  const n = cols * rows;
  if (n > scratchSize) {
    scratchSize = n;
    gCost = new Float64Array(n);
    parent = new Int32Array(n);
    closed = new Uint8Array(n);
  }
  gCost.fill(Infinity, 0, n);
  parent.fill(-1, 0, n);
  closed.fill(0, 0, n);

  const h = (x: number, y: number) => {
    const dx = Math.abs(x - gx);
    const dy = Math.abs(y - gy);
    return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
  };

  const start = sy * cols + sx;
  const goal = gy * cols + gx;
  const heap = new Heap();
  gCost[start] = 0;
  heap.push(start, h(sx, sy));
  let best = start;
  let bestH = h(sx, sy);

  while (heap.size) {
    const cur = heap.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (cur === goal) {
      best = cur;
      break;
    }
    const cx = cur % cols;
    const cy = (cur - cx) / cols;
    const hc = h(cx, cy);
    if (hc < bestH) {
      bestH = hc;
      best = cur;
    }
    for (const [dx, dy, cost] of DIRS8) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const ni = ny * cols + nx;
      if (closed[ni] || !walk(nx, ny)) continue;
      if (dx !== 0 && dy !== 0 && (!walk(cx + dx, cy) || !walk(cx, cy + dy))) continue;
      const ng = gCost[cur] + cost;
      if (ng < gCost[ni]) {
        gCost[ni] = ng;
        parent[ni] = cur;
        heap.push(ni, ng + h(nx, ny));
      }
    }
  }

  const out: Point[] = [];
  for (let i = best; i !== start && i >= 0; i = parent[i]) {
    const x = i % cols;
    out.push({ x, y: (i - x) / cols });
  }
  return out.reverse();
}

/** Steps (4-way) from a tile to every tile reachable through open tiles. -1 means unreachable. */
export function distanceField(cols: number, rows: number, open: Walkable, sx: number, sy: number): Int16Array {
  const dist = new Int16Array(cols * rows).fill(-1);
  if (!open(sx, sy)) return dist;
  const queue = new Int32Array(cols * rows);
  let head = 0;
  let tail = 0;
  const s = sy * cols + sx;
  dist[s] = 0;
  queue[tail++] = s;
  while (head < tail) {
    const i = queue[head++];
    const x = i % cols;
    const y = (i - x) / cols;
    for (const [dx, dy] of DIRS4) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const ni = ny * cols + nx;
      if (dist[ni] !== -1 || !open(nx, ny)) continue;
      dist[ni] = dist[i] + 1;
      queue[tail++] = ni;
    }
  }
  return dist;
}

/** The open tile nearest (in 4-way steps, through anything) to a start tile. */
export function nearestOpenTile(cols: number, rows: number, open: Walkable, sx: number, sy: number): Point | null {
  sx = Math.max(0, Math.min(cols - 1, sx));
  sy = Math.max(0, Math.min(rows - 1, sy));
  if (open(sx, sy)) return { x: sx, y: sy };
  const seen = new Uint8Array(cols * rows);
  const queue: number[] = [sy * cols + sx];
  seen[queue[0]] = 1;
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head];
    const x = i % cols;
    const y = (i - x) / cols;
    for (const [dx, dy] of DIRS4) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const ni = ny * cols + nx;
      if (seen[ni]) continue;
      seen[ni] = 1;
      if (open(nx, ny)) return { x: nx, y: ny };
      queue.push(ni);
    }
  }
  return null;
}

/** Walks the tiles a straight line passes through. Passing exactly through a corner needs both side tiles open. */
function traverse(walk: Walkable, T: number, x0: number, y0: number, x1: number, y1: number): boolean {
  let tx = Math.floor(x0 / T);
  let ty = Math.floor(y0 / T);
  const ex = Math.floor(x1 / T);
  const ey = Math.floor(y1 / T);
  if (!walk(tx, ty)) return false;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const sx = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const sy = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  let tMaxX = sx > 0 ? ((tx + 1) * T - x0) / dx : sx < 0 ? (x0 - tx * T) / -dx : Infinity;
  let tMaxY = sy > 0 ? ((ty + 1) * T - y0) / dy : sy < 0 ? (y0 - ty * T) / -dy : Infinity;
  const tDeltaX = sx !== 0 ? T / Math.abs(dx) : Infinity;
  const tDeltaY = sy !== 0 ? T / Math.abs(dy) : Infinity;

  for (let guard = 0; guard < 512; guard++) {
    if (tx === ex && ty === ey) return true;
    if (Math.min(tMaxX, tMaxY) > 1) return true;
    if (Math.abs(tMaxX - tMaxY) < 1e-9) {
      if (!walk(tx + sx, ty) || !walk(tx, ty + sy)) return false;
      tx += sx;
      ty += sy;
      tMaxX += tDeltaX;
      tMaxY += tDeltaY;
    } else if (tMaxX < tMaxY) {
      tx += sx;
      tMaxX += tDeltaX;
    } else {
      ty += sy;
      tMaxY += tDeltaY;
    }
    if (!walk(tx, ty)) return false;
  }
  return true;
}

/** True when a straight walk from one point to another stays on open tiles, with some room on each side. */
export function lineClear(walk: Walkable, T: number, x0: number, y0: number, x1: number, y1: number, clearance = 0): boolean {
  if (!traverse(walk, T, x0, y0, x1, y1)) return false;
  if (clearance <= 0) return true;
  const len = Math.hypot(x1 - x0, y1 - y0);
  if (len < 1e-6) return true;
  const px = (-(y1 - y0) / len) * clearance;
  const py = ((x1 - x0) / len) * clearance;
  return traverse(walk, T, x0 + px, y0 + py, x1 + px, y1 + py) && traverse(walk, T, x0 - px, y0 - py, x1 - px, y1 - py);
}

/** Tile path (from findPath) to world-space waypoints at tile centers. */
export function toWaypoints(tiles: readonly Point[], T: number): Point[] {
  return tiles.map((t) => ({ x: (t.x + 0.5) * T, y: (t.y + 0.5) * T }));
}

/** Moves straight toward a point. Returns true on arrival. */
export function stepToward(m: PathFollower, x: number, y: number, step: number): boolean {
  const dx = x - m.x;
  const dy = y - m.y;
  const d = Math.hypot(dx, dy);
  if (d <= step) {
    m.x = x;
    m.y = y;
    return true;
  }
  m.facing = Math.atan2(dy, dx);
  m.x += (dx / d) * step;
  m.y += (dy / d) * step;
  return false;
}

export type FollowResult = 'moving' | 'arrived' | 'blocked';

/**
 * Moves along the waypoints. Before moving, skips ahead past any waypoint whose
 * successor is already in clear sight, which straightens grid paths into natural lines.
 * Returns 'blocked' instead of stepping into a closed tile (for example after being
 * jostled off the line it planned); the caller should plan a new route from where it is.
 */
export function followPath(m: PathFollower, speed: number, dt: number, walk: Walkable, T: number, clearance: number): FollowResult {
  while (m.pathIndex + 1 < m.path.length) {
    const next = m.path[m.pathIndex + 1];
    if (!lineClear(walk, T, m.x, m.y, next.x, next.y, clearance)) break;
    m.pathIndex++;
  }
  let budget = speed * dt;
  while (budget > 0 && m.pathIndex < m.path.length) {
    const wp = m.path[m.pathIndex];
    const dx = wp.x - m.x;
    const dy = wp.y - m.y;
    const d = Math.hypot(dx, dy);
    const reach = d <= budget;
    const nx = reach ? wp.x : m.x + (dx / d) * budget;
    const ny = reach ? wp.y : m.y + (dy / d) * budget;
    const tx = Math.floor(nx / T);
    const ty = Math.floor(ny / T);
    if ((tx !== Math.floor(m.x / T) || ty !== Math.floor(m.y / T)) && !walk(tx, ty)) return 'blocked';
    if (d > 1e-3) m.facing = Math.atan2(dy, dx);
    m.x = nx;
    m.y = ny;
    if (reach) {
      budget -= d;
      m.pathIndex++;
    } else {
      budget = 0;
    }
  }
  return m.pathIndex >= m.path.length ? 'arrived' : 'moving';
}

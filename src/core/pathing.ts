import { Tile, type Grid, type Point, type Rect } from './grid';

export interface RoutePlan {
  /** The tile beside the fence where visitors stand. Always part of the path network once built. */
  viewingSpot: Point;
  /** Grass tiles that become path, ordered from the existing network outward. */
  newPathTiles: Point[];
}

const DIRS: readonly Point[] = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

function inRect(r: Rect, x: number, y: number): boolean {
  return x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
}

/** Tiles touching the footprint's sides (not diagonal corners), in scan order: top, bottom, left, right. */
export function viewingSpotCandidates(grid: Grid, fp: Rect): Point[] {
  const out: Point[] = [];
  for (let x = fp.x; x < fp.x + fp.w; x++) out.push({ x, y: fp.y - 1 });
  for (let x = fp.x; x < fp.x + fp.w; x++) out.push({ x, y: fp.y + fp.h });
  for (let y = fp.y; y < fp.y + fp.h; y++) out.push({ x: fp.x - 1, y });
  for (let y = fp.y; y < fp.y + fp.h; y++) out.push({ x: fp.x + fp.w, y });
  return out.filter((p) => grid.inBounds(p.x, p.y));
}

/**
 * Finds the cheapest path from the existing path network to a viewing spot beside the footprint.
 * Breadth-first search from every network tile at once, through grass only.
 * Returns null when no viewing spot can be reached.
 */
export function planRoute(grid: Grid, fp: Rect): RoutePlan | null {
  const n = grid.cols * grid.rows;
  const dist = new Int32Array(n).fill(-1);
  const parent = new Int32Array(n).fill(-1);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;

  for (let y = 0; y < grid.rows; y++) {
    for (let x = 0; x < grid.cols; x++) {
      if (grid.isPathNetwork(x, y) && !inRect(fp, x, y)) {
        const i = grid.index(x, y);
        dist[i] = 0;
        queue[tail++] = i;
      }
    }
  }

  while (head < tail) {
    const i = queue[head++];
    const x = i % grid.cols;
    const y = (i - x) / grid.cols;
    for (const d of DIRS) {
      const nx = x + d.x;
      const ny = y + d.y;
      if (!grid.inBounds(nx, ny) || inRect(fp, nx, ny)) continue;
      const ni = grid.index(nx, ny);
      if (dist[ni] !== -1 || grid.get(nx, ny) !== Tile.Grass) continue;
      dist[ni] = dist[i] + 1;
      parent[ni] = i;
      queue[tail++] = ni;
    }
  }

  let best: Point | null = null;
  let bestDist = Infinity;
  for (const c of viewingSpotCandidates(grid, fp)) {
    const d = dist[grid.index(c.x, c.y)];
    if (d >= 0 && d < bestDist) {
      best = c;
      bestDist = d;
    }
  }
  if (!best) return null;

  const tiles: Point[] = [];
  let cur = grid.index(best.x, best.y);
  while (dist[cur] > 0) {
    const x = cur % grid.cols;
    tiles.push({ x, y: (cur - x) / grid.cols });
    cur = parent[cur];
  }
  tiles.reverse();
  return { viewingSpot: best, newPathTiles: tiles };
}

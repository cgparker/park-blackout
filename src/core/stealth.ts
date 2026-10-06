import { STEALTH } from '../config';
import { Tile, type Point, type TileType } from './grid';
import { lineClear } from './nav';
import { isTroop, onMap, type Unit } from './units';
import type { World } from './world';

/**
 * Level 4: what a raptor on patrol can see. Its view is a cone ahead of it (STEALTH), and rock, pens, HQ, towers,
 * and substations block it. Water and paths don't.
 */

/** Something with a position and a direction it faces, in world pixels and radians. */
export interface Looker extends Point {
  facing: number;
}

/** Tiles a raptor can't see through. */
export function blocksSight(t: TileType): boolean {
  return t === Tile.Rock || t === Tile.Exhibit || t === Tile.HQ || t === Tile.Tower || t === Tile.Substation;
}

/** A see-through test for lines starting at (x0, y0). The tile the looker stands on never blocks its own view. */
function clearFrom(w: World, x0: number, y0: number) {
  const sx = Math.floor(x0 / w.T);
  const sy = Math.floor(y0 / w.T);
  return (x: number, y: number) => (x === sx && y === sy) || (w.grid.inBounds(x, y) && !blocksSight(w.grid.get(x, y)));
}

/** True when nothing blocks the straight line between two points. */
export function lineOfSight(w: World, x0: number, y0: number, x1: number, y1: number): boolean {
  return lineClear(clearFrom(w, x0, y0), w.T, x0, y0, x1, y1, 0);
}

const angleDiff = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

/** Whether a looker sees a point: in range, inside its cone, and in clear sight. */
export function inView(w: World, d: Looker, x: number, y: number): boolean {
  const dx = x - d.x;
  const dy = y - d.y;
  const dist = Math.hypot(dx, dy);
  if (dist > STEALTH.sightTiles * w.T) return false;
  if (dist > 1e-6 && Math.abs(angleDiff(Math.atan2(dy, dx), d.facing)) > (STEALTH.coneDeg * Math.PI) / 360) return false;
  return lineOfSight(w, d.x, d.y, x, y);
}

/** Whether a troop has walked into a raptor: touching distance, whichever way it looks. */
export function touching(w: World, d: Point, u: Unit): boolean {
  return Math.hypot(u.x - d.x, u.y - d.y) <= STEALTH.hearTiles * w.T;
}

/** Whether a calm raptor notices a troop: one in its cone, or one touching it. */
export function notices(w: World, d: Looker, u: Unit): boolean {
  if (!onMap(u) || !isTroop(u)) return false;
  return touching(w, d, u) || inView(w, d, u.x, u.y);
}

/**
 * The troop a calm raptor notices now, the nearest if it notices several, and whether it walked into the raptor
 * (noticed at once) or is only in its cone (it takes STEALTH.noticeSeconds to make out). Null if none.
 */
export function noticed(w: World, d: Looker): { unit: Unit; touch: boolean } | null {
  let best: Unit | null = null;
  let bestD = Infinity;
  for (const u of w.units) {
    const dd = Math.hypot(u.x - d.x, u.y - d.y);
    if (dd < bestD && notices(w, d, u)) {
      best = u;
      bestD = dd;
    }
  }
  return best ? { unit: best, touch: touching(w, d, best) } : null;
}

/** Whether a raptor on the hunt still sees its prey: near enough, in any direction, and not behind cover. */
export function tracking(w: World, d: Point, u: Point): boolean {
  return Math.hypot(u.x - d.x, u.y - d.y) <= STEALTH.chaseSightTiles * w.T && lineOfSight(w, d.x, d.y, u.x, u.y);
}

/**
 * The ground a looker sees, for the screen: where it stands, then where each ray across its cone ends, cut short by
 * whatever blocks it. A fan of points in world pixels.
 */
export function viewCone(w: World, d: Looker, rays = STEALTH.coneRays): Point[] {
  const half = (STEALTH.coneDeg * Math.PI) / 360;
  const range = STEALTH.sightTiles * w.T;
  const out: Point[] = [{ x: d.x, y: d.y }];
  for (let i = 0; i <= rays; i++) {
    const a = d.facing - half + (2 * half * i) / rays;
    out.push(rayEnd(w, d.x, d.y, Math.cos(a), Math.sin(a), range));
  }
  return out;
}

/** Where a ray from (x0, y0) along the unit vector (dx, dy) stops: the first tile that blocks sight, or its full length. */
function rayEnd(w: World, x0: number, y0: number, dx: number, dy: number, range: number): Point {
  const T = w.T;
  let tx = Math.floor(x0 / T);
  let ty = Math.floor(y0 / T);
  const sx = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const sy = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  let tMaxX = sx > 0 ? ((tx + 1) * T - x0) / dx : sx < 0 ? (x0 - tx * T) / -dx : Infinity;
  let tMaxY = sy > 0 ? ((ty + 1) * T - y0) / dy : sy < 0 ? (y0 - ty * T) / -dy : Infinity;
  const tDeltaX = sx ? T / Math.abs(dx) : Infinity;
  const tDeltaY = sy ? T / Math.abs(dy) : Infinity;
  for (let guard = 0; guard < 256; guard++) {
    let t: number;
    if (tMaxX < tMaxY) {
      t = tMaxX;
      tx += sx;
      tMaxX += tDeltaX;
    } else {
      t = tMaxY;
      ty += sy;
      tMaxY += tDeltaY;
    }
    if (t >= range) break;
    if (!w.grid.inBounds(tx, ty) || blocksSight(w.grid.get(tx, ty))) return { x: x0 + dx * t, y: y0 + dy * t };
  }
  return { x: x0 + dx * range, y: y0 + dy * range };
}

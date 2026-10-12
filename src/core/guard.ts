import { MAP, TIPS } from '../config';
import { footprintCenter, type Exhibit } from './exhibit';
import { isTroop, onMap } from './units';
import type { World } from './world';

/** Questions about where troops stand, shared by the tips and the end-screen timeline. */

const T = MAP.tileSize;

/** A pen is guarded when a troop (not a tower) stands within a few tiles of its center. */
export function guarded(w: World, ex: Exhibit): boolean {
  const c = footprintCenter(ex.footprint, T);
  return w.units.some((u) => onMap(u) && isTroop(u) && Math.hypot(u.x - c.x, u.y - c.y) <= TIPS.guardRadiusTiles * T);
}

/** Living troops (not towers) within a few tiles of a point. */
export function troopsNear(w: World, x: number, y: number, radiusTiles: number): number {
  return w.units.filter((u) => onMap(u) && isTroop(u) && Math.hypot(u.x - x, u.y - y) <= radiusTiles * T).length;
}

/** The exhibit whose center is closest to a point, if one is within `withinTiles`. */
export function nearestExhibit(w: World, x: number, y: number, withinTiles: number, kind?: Exhibit['kind']): Exhibit | null {
  let best: Exhibit | null = null;
  let bestD = withinTiles * T;
  for (const ex of w.exhibits) {
    if (kind && ex.kind !== kind) continue;
    const c = footprintCenter(ex.footprint, T);
    const d = Math.hypot(c.x - x, c.y - y);
    if (d <= bestD) {
      bestD = d;
      best = ex;
    }
  }
  return best;
}

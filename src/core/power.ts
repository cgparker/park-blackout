import { GRID } from '../config';
import type { Point } from './grid';

/** Level 4: a broken substation. Engineers beside it fix it, and then the pens it powers get their power back. */
export interface Substation {
  id: number;
  name: string;
  /** Top-left tile of its block. */
  x: number;
  y: number;
  /** Ids of the exhibits it powers. */
  pens: number[];
  /** Seconds of Engineer work done so far. Stays done if the Engineers leave. */
  work: number;
  /** Engineers working on it right now, for the screen. */
  workers: number;
  fixed: boolean;
}

/** Middle of the substation's block, in world pixels. */
export function substationCenter(s: Substation, T: number): Point {
  const half = GRID.sizeTiles / 2;
  return { x: (s.x + half) * T, y: (s.y + half) * T };
}

/** True when a point is close enough to work on the substation: on the ring of tiles around it. */
export function inReach(s: Substation, x: number, y: number, T: number): boolean {
  const c = substationCenter(s, T);
  return Math.hypot(x - c.x, y - c.y) <= GRID.reachTiles * T;
}

/** True when a tile is part of the substation's block. */
export function onSubstation(s: Substation, tx: number, ty: number): boolean {
  return tx >= s.x && ty >= s.y && tx < s.x + GRID.sizeTiles && ty < s.y + GRID.sizeTiles;
}

/** The tiles around the block where an Engineer can stand to work, nearest the middle of each side first. */
export function workTiles(s: Substation, open: (x: number, y: number) => boolean): Point[] {
  const n = GRID.sizeTiles;
  const out: Point[] = [];
  for (let y = s.y - 1; y <= s.y + n; y++) {
    for (let x = s.x - 1; x <= s.x + n; x++) {
      if (onSubstation(s, x, y) || !open(x, y)) continue;
      out.push({ x, y });
    }
  }
  const cx = s.x + n / 2 - 0.5;
  const cy = s.y + n / 2 - 0.5;
  return out.sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy));
}

/** Fraction of the fix done, 0 to 1. */
export function repairProgress(s: Substation): number {
  return s.fixed ? 1 : Math.min(1, s.work / GRID.repairSeconds);
}

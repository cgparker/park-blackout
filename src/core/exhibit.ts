import { FENCE, type ExhibitKind } from '../config';
import type { Point, Rect } from './grid';

export interface FenceSegment {
  /** Border tile the segment runs through. */
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  corner: boolean;
  /** Outward direction for side segments; 0,0 for corners. */
  nx: number;
  ny: number;
}

export interface Exhibit {
  id: number;
  kind: ExhibitKind;
  footprint: Rect;
  viewingSpot: Point;
  /** One segment per border tile, clockwise from the top-left corner. */
  segments: FenceSegment[];
  reinforced: boolean;
  /** Whether its fence has power. Animals inside leave a powered fence alone, and nothing can damage it. */
  powered: boolean;
  /**
   * Seconds into the level when the animals inside go for the fence while it has no power, when the level sets it
   * (null: never on their own). Undefined means the animal's own breakout delay, as in the blackout.
   */
  breakoutAt?: number | null;
  /**
   * Level 3: seconds this pen's animals go for the fence early (negative) or late this game, drawn when the power goes
   * out. Every pen of a kind shares it.
   */
  drift: number;
  visits: number;
  revenue: number;
  /** The segment a raptor pack is breaking, so the whole pack hits the same one. */
  packTarget: number | null;
  /** Bumped whenever the fence changes, so the renderer knows to redraw it. */
  version: number;
}

/** Border tiles of a footprint, clockwise from the top-left corner. */
export function ringTiles(fp: Rect): Point[] {
  const out: Point[] = [];
  const right = fp.x + fp.w - 1;
  const bottom = fp.y + fp.h - 1;
  for (let x = fp.x; x <= right; x++) out.push({ x, y: fp.y });
  for (let y = fp.y + 1; y <= bottom; y++) out.push({ x: right, y });
  for (let x = right - 1; x >= fp.x; x--) out.push({ x, y: bottom });
  for (let y = bottom - 1; y > fp.y; y--) out.push({ x: fp.x, y });
  return out;
}

export function buildSegments(fp: Rect): FenceSegment[] {
  const right = fp.x + fp.w - 1;
  const bottom = fp.y + fp.h - 1;
  return ringTiles(fp).map((t) => {
    const left = t.x === fp.x;
    const rightSide = t.x === right;
    const top = t.y === fp.y;
    const bottomSide = t.y === bottom;
    const corner = (left || rightSide) && (top || bottomSide);
    return {
      x: t.x,
      y: t.y,
      hp: FENCE.chainLinkHp,
      maxHp: FENCE.chainLinkHp,
      corner,
      nx: corner ? 0 : left ? -1 : rightSide ? 1 : 0,
      ny: corner ? 0 : top ? -1 : bottomSide ? 1 : 0,
    };
  });
}

/** The fence runs through the centers of the border tiles. Returns that rectangle in world pixels. */
export function fenceRect(fp: Rect, T: number): { left: number; top: number; right: number; bottom: number } {
  return {
    left: (fp.x + 0.5) * T,
    top: (fp.y + 0.5) * T,
    right: (fp.x + fp.w - 0.5) * T,
    bottom: (fp.y + fp.h - 0.5) * T,
  };
}

export function footprintCenter(fp: Rect, T: number): Point {
  return { x: (fp.x + fp.w / 2) * T, y: (fp.y + fp.h / 2) * T };
}

export function inFootprint(fp: Rect, tx: number, ty: number): boolean {
  return tx >= fp.x && ty >= fp.y && tx < fp.x + fp.w && ty < fp.y + fp.h;
}

export function reinforceCost(fp: Rect): number {
  return ringTiles(fp).length * FENCE.reinforceCostPerSegment;
}

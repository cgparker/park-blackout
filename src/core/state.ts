import { FENCE, type ExhibitKind } from '../config';
import { Tile, type Grid, type Point, type Rect } from './grid';
import type { PlacementPlan } from './placement';

export interface FenceSegment {
  x: number;
  y: number;
  hp: number;
  maxHp: number;
}

export interface Exhibit {
  id: number;
  kind: ExhibitKind;
  footprint: Rect;
  viewingSpot: Point;
  /** One segment per border tile, clockwise from the top-left corner. */
  segments: FenceSegment[];
  reinforced: boolean;
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

export class GameState {
  readonly grid: Grid;
  money: number;
  readonly exhibits: Exhibit[] = [];
  private nextId = 1;

  constructor(grid: Grid, startingMoney: number) {
    this.grid = grid;
    this.money = startingMoney;
  }

  countOf(kind: ExhibitKind): number {
    return this.exhibits.filter((e) => e.kind === kind).length;
  }

  build(plan: PlacementPlan): Exhibit {
    if (!plan.valid || !plan.viewingSpot) throw new Error('Cannot build an invalid placement.');
    if (this.money < plan.totalCost) throw new Error('Not enough money.');

    this.money -= plan.totalCost;
    const id = this.nextId++;
    this.grid.forEachInRect(plan.footprint, (x, y) => {
      this.grid.set(x, y, Tile.Exhibit);
      this.grid.exhibitIds[this.grid.index(x, y)] = id;
    });
    for (const p of plan.newPathTiles) this.grid.set(p.x, p.y, Tile.Path);

    const exhibit: Exhibit = {
      id,
      kind: plan.kind,
      footprint: { ...plan.footprint },
      viewingSpot: { ...plan.viewingSpot },
      segments: ringTiles(plan.footprint).map((t) => ({
        x: t.x,
        y: t.y,
        hp: FENCE.chainLinkHp,
        maxHp: FENCE.chainLinkHp,
      })),
      reinforced: false,
    };
    this.exhibits.push(exhibit);
    return exhibit;
  }
}

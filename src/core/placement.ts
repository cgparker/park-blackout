import { ECONOMY, EXHIBITS, type ExhibitKind } from '../config';
import { Tile, type Grid, type Point, type Rect } from './grid';
import { planRoute } from './pathing';

export interface PlacementPlan {
  kind: ExhibitKind;
  footprint: Rect;
  valid: boolean;
  /** Why the placement can't be built, or null when it can. */
  reason: string | null;
  viewingSpot: Point | null;
  newPathTiles: Point[];
  exhibitCost: number;
  pathCost: number;
  totalCost: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Footprint centered on the tapped tile, nudged so it never touches the map edge.
 * (Exhibits must stay one tile away from every edge.)
 */
export function footprintAt(grid: Grid, kind: ExhibitKind, tileX: number, tileY: number): Rect {
  const size = EXHIBITS[kind].size;
  const x = clamp(tileX - Math.floor(size / 2), 1, grid.cols - 1 - size);
  const y = clamp(tileY - Math.floor(size / 2), 1, grid.rows - 1 - size);
  return { x, y, w: size, h: size };
}

export function planPlacement(
  grid: Grid,
  kind: ExhibitKind,
  tileX: number,
  tileY: number,
  money: number,
  builtCount: number,
): PlacementPlan {
  const cfg = EXHIBITS[kind];
  const footprint = footprintAt(grid, kind, tileX, tileY);
  const base: PlacementPlan = {
    kind,
    footprint,
    valid: false,
    reason: null,
    viewingSpot: null,
    newPathTiles: [],
    exhibitCost: cfg.cost,
    pathCost: 0,
    totalCost: cfg.cost,
  };

  if (cfg.maxPerLevel !== null && builtCount >= cfg.maxPerLevel) {
    return { ...base, reason: `Limit reached (${cfg.maxPerLevel} per level)` };
  }

  let blocked = false;
  grid.forEachInRect(footprint, (x, y) => {
    if (grid.get(x, y) !== Tile.Grass) blocked = true;
  });
  if (blocked) return { ...base, reason: 'Blocked' };

  const route = planRoute(grid, footprint);
  if (!route) return { ...base, reason: 'No path can reach this spot' };

  const pathCost = route.newPathTiles.length * ECONOMY.pathCostPerTile;
  const plan: PlacementPlan = {
    ...base,
    viewingSpot: route.viewingSpot,
    newPathTiles: route.newPathTiles,
    pathCost,
    totalCost: cfg.cost + pathCost,
  };
  if (money < plan.totalCost) return { ...plan, reason: 'Not enough money' };
  return { ...plan, valid: true };
}

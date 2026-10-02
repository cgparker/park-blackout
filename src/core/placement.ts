import { ECONOMY, EXHIBITS, UNITS, type ExhibitKind } from '../config';
import { Tile, type Grid, type Point, type Rect } from './grid';
import { planRoute } from './pathing';

export interface TowerPlan {
  tile: Point;
  valid: boolean;
  /** Why the tower can't be built, or null when it can. */
  reason: string | null;
  cost: number;
}

/** A tower fits on any single grass tile. */
export function planTower(grid: Grid, tileX: number, tileY: number, money: number): TowerPlan {
  const tile = { x: clamp(tileX, 0, grid.cols - 1), y: clamp(tileY, 0, grid.rows - 1) };
  const cost = UNITS.tower.cost;
  const base: TowerPlan = { tile, valid: false, reason: null, cost };
  if (grid.get(tile.x, tile.y) !== Tile.Grass) return { ...base, reason: 'Needs open grass' };
  if (money < cost) return { ...base, reason: 'Not enough money' };
  return { ...base, valid: true };
}

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

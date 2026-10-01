import { describe, expect, it } from 'vitest';
import { ECONOMY, EXHIBITS, FENCE, MAP, type MapConfig } from '../src/config';
import { createGrid, Grid, Tile, type Point, type Rect } from '../src/core/grid';
import { planRoute, viewingSpotCandidates } from '../src/core/pathing';
import { footprintAt, planPlacement } from '../src/core/placement';
import { ringTiles } from '../src/core/exhibit';
import { World } from '../src/core/world';

const RICH = 1_000_000;

/** True when every tile in `tiles` connects to the gate through path tiles. */
function connectedToGate(grid: Grid, tiles: Point[]): boolean {
  const seen = new Set<number>();
  const queue: Point[] = [{ ...MAP.gate }];
  seen.add(grid.index(MAP.gate.x, MAP.gate.y));
  while (queue.length) {
    const p = queue.shift()!;
    for (const d of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const x = p.x + d[0];
      const y = p.y + d[1];
      if (!grid.inBounds(x, y) || !grid.isPathNetwork(x, y)) continue;
      const i = grid.index(x, y);
      if (seen.has(i)) continue;
      seen.add(i);
      queue.push({ x, y });
    }
  }
  return tiles.every((t) => seen.has(grid.index(t.x, t.y)));
}

function touchesSide(fp: Rect, p: Point): boolean {
  return viewingSpotCandidates(new Grid(MAP.cols, MAP.rows), fp).some((c) => c.x === p.x && c.y === p.y);
}

describe('map layout', () => {
  it('matches the configured size', () => {
    expect(MAP.layout).toHaveLength(MAP.rows);
    for (const row of MAP.layout) expect(row).toHaveLength(MAP.cols);
  });

  it('places the gate, path stub, and HQ', () => {
    const grid = createGrid(MAP);
    expect(grid.get(MAP.gate.x, MAP.gate.y)).toBe(Tile.Gate);
    for (let i = 1; i <= MAP.stubLength; i++) expect(grid.get(MAP.gate.x + i, MAP.gate.y)).toBe(Tile.Path);
    grid.forEachInRect(MAP.hq, (x, y) => expect(grid.get(x, y)).toBe(Tile.HQ));
  });

  it('rejects a broken layout', () => {
    const bad: MapConfig = { ...MAP, layout: MAP.layout.slice(1) };
    expect(() => createGrid(bad)).toThrow();
  });
});

describe('footprint', () => {
  it('centers on the tapped tile', () => {
    const grid = createGrid(MAP);
    expect(footprintAt(grid, 'pasture', 20, 12)).toEqual({ x: 18, y: 10, w: 5, h: 5 });
    expect(footprintAt(grid, 'raptor', 20, 12)).toEqual({ x: 18, y: 10, w: 4, h: 4 });
  });

  it('never touches the map edge', () => {
    const grid = createGrid(MAP);
    for (const [tx, ty] of [
      [0, 0],
      [39, 23],
      [0, 23],
      [39, 0],
    ]) {
      const fp = footprintAt(grid, 'trex', tx, ty);
      expect(fp.x).toBeGreaterThanOrEqual(1);
      expect(fp.y).toBeGreaterThanOrEqual(1);
      expect(fp.x + fp.w).toBeLessThanOrEqual(MAP.cols - 1);
      expect(fp.y + fp.h).toBeLessThanOrEqual(MAP.rows - 1);
    }
  });
});

describe('auto-path', () => {
  it('connects a new exhibit to the gate through grass', () => {
    const grid = createGrid(MAP);
    const fp = footprintAt(grid, 'raptor', 9, 11);
    const route = planRoute(grid, fp)!;
    expect(route).not.toBeNull();
    expect(touchesSide(fp, route.viewingSpot)).toBe(true);
    for (const t of route.newPathTiles) expect(grid.get(t.x, t.y)).toBe(Tile.Grass);
    for (const t of route.newPathTiles) grid.set(t.x, t.y, Tile.Path);
    expect(connectedToGate(grid, [route.viewingSpot])).toBe(true);
  });

  it('needs no new path when the footprint already touches the network', () => {
    const grid = createGrid(MAP);
    // Pen sitting right above the stub (stub is y=12, x=1..3).
    const fp: Rect = { x: 2, y: 8, w: 4, h: 4 };
    const route = planRoute(grid, fp)!;
    expect(route.newPathTiles).toHaveLength(0);
    expect(grid.isPathNetwork(route.viewingSpot.x, route.viewingSpot.y)).toBe(true);
  });

  it('returns null when grass around the footprint is walled off', () => {
    const map: MapConfig = {
      ...MAP,
      layout: MAP.layout.map((row, y) => {
        if (y < 4 || y > 13) return row;
        // Rock ring from x=24..33, y=4..13 with grass inside.
        const chars = row.split('');
        for (let x = 24; x <= 33; x++) {
          const edge = y === 4 || y === 13 || x === 24 || x === 33;
          chars[x] = edge ? 'R' : '.';
        }
        return chars.join('');
      }),
    };
    const grid = createGrid(map);
    const fp: Rect = { x: 27, y: 7, w: 4, h: 4 };
    expect(planRoute(grid, fp)).toBeNull();
    const plan = planPlacement(grid, 'raptor', 29, 9, RICH, 0);
    expect(plan.valid).toBe(false);
    expect(plan.reason).toBe('No path can reach this spot');
  });
});

describe('placement rules', () => {
  it('prices the exhibit plus its path', () => {
    const grid = createGrid(MAP);
    const plan = planPlacement(grid, 'pasture', 10, 5, RICH, 0);
    expect(plan.valid).toBe(true);
    expect(plan.pathCost).toBe(plan.newPathTiles.length * ECONOMY.pathCostPerTile);
    expect(plan.totalCost).toBe(EXHIBITS.pasture.cost + plan.pathCost);
  });

  it('is blocked by rocks, the pond, and the HQ', () => {
    const grid = createGrid(MAP);
    expect(planPlacement(grid, 'raptor', 28, 14, RICH, 0).reason).toBe('Blocked'); // rocks
    expect(planPlacement(grid, 'raptor', 20, 5, RICH, 0).reason).toBe('Blocked'); // pond
    expect(planPlacement(grid, 'raptor', 3, 15, RICH, 0).reason).toBe('Blocked'); // HQ
  });

  it('respects the per-level limit', () => {
    const grid = createGrid(MAP);
    const plan = planPlacement(grid, 'trex', 20, 16, RICH, 1);
    expect(plan.valid).toBe(false);
    expect(plan.reason).toMatch(/Limit reached/);
  });

  it('needs enough money for exhibit plus path', () => {
    const grid = createGrid(MAP);
    const plan = planPlacement(grid, 'trex', 30, 19, EXHIBITS.trex.cost, 0);
    expect(plan.newPathTiles.length).toBeGreaterThan(0);
    expect(plan.valid).toBe(false);
    expect(plan.reason).toBe('Not enough money');
  });
});

describe('building', () => {
  it('spends money, claims tiles, lays path, and builds the fence', () => {
    const state = new World({ seed: 1 });
    const grid = state.grid;
    const plan = planPlacement(grid, 'raptor', 9, 11, state.money, 0);
    expect(plan.valid).toBe(true);

    const ex = state.build(plan);
    expect(state.money).toBe(ECONOMY.startingMoney - plan.totalCost);
    grid.forEachInRect(ex.footprint, (x, y) => {
      expect(grid.get(x, y)).toBe(Tile.Exhibit);
      expect(grid.exhibitIds[grid.index(x, y)]).toBe(ex.id);
    });
    expect(connectedToGate(grid, [ex.viewingSpot, ...plan.newPathTiles])).toBe(true);
    expect(ex.segments).toHaveLength(12);
    expect(ex.segments.every((s) => s.hp === FENCE.chainLinkHp)).toBe(true);
    expect(state.countOf('raptor')).toBe(1);
    expect(state.spending.exhibits).toBe(EXHIBITS.raptor.cost);
    expect(state.spending.paths).toBe(plan.pathCost);
    expect(state.dinos.filter((d) => d.home === ex.id)).toHaveLength(EXHIBITS.raptor.animalCount);
  });

  it('has 16, 12, and 20 fence segments for the three exhibits', () => {
    expect(ringTiles({ x: 0, y: 0, w: 5, h: 5 })).toHaveLength(16);
    expect(ringTiles({ x: 0, y: 0, w: 4, h: 4 })).toHaveLength(12);
    expect(ringTiles({ x: 0, y: 0, w: 6, h: 6 })).toHaveLength(20);
  });

  it('lets a second exhibit route along the first one’s path', () => {
    const state = new World({ seed: 1, startingMoney: RICH });
    const grid = state.grid;
    const first = state.build(planPlacement(grid, 'pasture', 14, 15, state.money, 0));
    const second = planPlacement(grid, 'raptor', 15, 20, state.money, 0);
    expect(second.valid).toBe(true);
    for (const t of second.newPathTiles) grid.set(t.x, t.y, Tile.Path);
    expect(connectedToGate(grid, [first.viewingSpot, second.viewingSpot!])).toBe(true);
  });

  it('refuses an invalid plan', () => {
    const state = new World({ seed: 1 });
    const plan = planPlacement(state.grid, 'raptor', 28, 14, state.money, 0);
    expect(() => state.build(plan)).toThrow();
  });
});

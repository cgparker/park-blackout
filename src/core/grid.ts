import type { MapConfig } from '../config';

export const Tile = {
  Grass: 0,
  Path: 1,
  Rock: 2,
  Water: 3,
  Gate: 4,
  HQ: 5,
  Exhibit: 6,
} as const;
export type TileType = (typeof Tile)[keyof typeof Tile];

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const LAYOUT_CHARS: Record<string, TileType> = {
  '.': Tile.Grass,
  R: Tile.Rock,
  W: Tile.Water,
};

export class Grid {
  readonly cols: number;
  readonly rows: number;
  readonly tiles: Uint8Array;
  /** Exhibit id per tile, 0 when no exhibit. */
  readonly exhibitIds: Int32Array;

  constructor(cols: number, rows: number) {
    this.cols = cols;
    this.rows = rows;
    this.tiles = new Uint8Array(cols * rows);
    this.exhibitIds = new Int32Array(cols * rows);
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.cols && y < this.rows;
  }

  index(x: number, y: number): number {
    return y * this.cols + x;
  }

  get(x: number, y: number): TileType {
    return this.tiles[this.index(x, y)] as TileType;
  }

  set(x: number, y: number, tile: TileType): void {
    this.tiles[this.index(x, y)] = tile;
  }

  /** Path tiles and the gate form the network visitors walk on. */
  isPathNetwork(x: number, y: number): boolean {
    const t = this.get(x, y);
    return t === Tile.Path || t === Tile.Gate;
  }

  forEachInRect(r: Rect, fn: (x: number, y: number) => void): void {
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) fn(x, y);
    }
  }
}

/** Direction from the gate into the map. */
export function gateInward(map: MapConfig): Point {
  const { gate, cols, rows } = map;
  if (gate.x === 0) return { x: 1, y: 0 };
  if (gate.x === cols - 1) return { x: -1, y: 0 };
  if (gate.y === 0) return { x: 0, y: 1 };
  if (gate.y === rows - 1) return { x: 0, y: -1 };
  throw new Error('The gate must sit on a map edge.');
}

export function createGrid(map: MapConfig): Grid {
  if (map.layout.length !== map.rows) {
    throw new Error(`Map layout has ${map.layout.length} rows, expected ${map.rows}.`);
  }
  const grid = new Grid(map.cols, map.rows);

  map.layout.forEach((row, y) => {
    if (row.length !== map.cols) {
      throw new Error(`Map layout row ${y} has ${row.length} columns, expected ${map.cols}.`);
    }
    for (let x = 0; x < row.length; x++) {
      const tile = LAYOUT_CHARS[row[x]];
      if (tile === undefined) throw new Error(`Unknown map character '${row[x]}' at ${x},${y}.`);
      grid.set(x, y, tile);
    }
  });

  const claim = (x: number, y: number, tile: TileType, what: string) => {
    if (!grid.inBounds(x, y)) throw new Error(`${what} at ${x},${y} is off the map.`);
    if (grid.get(x, y) !== Tile.Grass) throw new Error(`${what} at ${x},${y} overlaps an obstacle.`);
    grid.set(x, y, tile);
  };

  claim(map.gate.x, map.gate.y, Tile.Gate, 'Gate');
  const dir = gateInward(map);
  for (let i = 1; i <= map.stubLength; i++) {
    claim(map.gate.x + dir.x * i, map.gate.y + dir.y * i, Tile.Path, 'Path stub');
  }
  grid.forEachInRect(map.hq, (x, y) => claim(x, y, Tile.HQ, 'HQ'));

  return grid;
}

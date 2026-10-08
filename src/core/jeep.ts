import { JEEP, UNITS } from '../config';
import { nearestOpenTile } from './nav';
import type { Unit } from './units';
import type { World } from './world';

/** The Patrol 4x4: who is inside, getting in, and getting out, and whether its engine is running. Orders and driving are in units.ts. */

/** A 4x4 on the move: its engine is running, and calm raptors near it hear it (JEEP.noiseTiles). Parked, it's quiet. */
export function engineRunning(u: Unit): boolean {
  return u.kind === 'jeep' && !u.dead && (u.order === 'move' || u.order === 'attack');
}

/** Troops riding in the 4x4. */
export function passengers(w: World, jeep: Unit): Unit[] {
  return w.units.filter((u) => u.aboard === jeep.id && !u.dead);
}

export function seatsFree(w: World, jeep: Unit): number {
  return JEEP.seats - passengers(w, jeep).length;
}

/** A troop climbs in. It leaves the map until it climbs out. */
export function board(w: World, u: Unit, jeep: Unit): void {
  u.aboard = jeep.id;
  u.order = 'idle';
  u.targetId = 0;
  u.dest = null;
  u.path = [];
  u.pathIndex = 0;
  u.x = jeep.x;
  u.y = jeep.y;
  w.events.push({ type: 'boarded', unitId: u.id, jeepId: jeep.id });
}

/** Everyone climbs out beside the 4x4, one on each side, idle. Returns who got out. */
export function unload(w: World, jeep: Unit): Unit[] {
  const riders = passengers(w, jeep);
  if (!riders.length) return riders;
  const T = w.T;
  const f = jeep.facing;
  // Out of the doors: left and right of the way it faces, then a step back for any more.
  const sx = -Math.sin(f);
  const sy = Math.cos(f);
  riders.forEach((u, i) => {
    const side = i % 2 === 0 ? 1 : -1;
    const back = Math.floor(i / 2) * UNITS[u.kind].radius * 2;
    const off = UNITS.jeep.radius + UNITS[u.kind].radius + 2;
    let x = jeep.x + sx * side * off - Math.cos(f) * back;
    let y = jeep.y + sy * side * off - Math.sin(f) * back;
    if (!w.unitWalk(Math.floor(x / T), Math.floor(y / T))) {
      const t = nearestOpenTile(w.grid.cols, w.grid.rows, w.unitWalk, Math.floor(jeep.x / T), Math.floor(jeep.y / T));
      x = t ? (t.x + 0.5) * T + side * 6 : jeep.x;
      y = t ? (t.y + 0.5) * T : jeep.y;
    }
    u.aboard = 0;
    u.x = x;
    u.y = y;
    u.facing = f;
    u.order = 'idle';
    u.targetId = 0;
    u.dest = null;
    u.path = [];
    u.pathIndex = 0;
    u.repath = 0;
  });
  w.events.push({ type: 'unloaded', jeepId: jeep.id, count: riders.length });
  return riders;
}

import { DINO_AI, type AnimalKind } from '../config';
import type { Dino } from './dinos';
import { Tile } from './grid';
import type { Unit } from './units';
import type { World } from './world';

/** `by` is the kind of animal that did it, so the screen can explain the loss. */
export function damageUnit(w: World, u: Unit, amount: number, by: AnimalKind | null = null): void {
  if (u.dead) return;
  u.hp -= amount;
  u.hurtAt = w.time;
  if (u.hp > 0) return;
  u.hp = 0;
  u.dead = true;
  if (u.kind === 'tower') {
    // The tile opens up again.
    w.towersLost++;
    w.grid.set(Math.floor(u.x / w.T), Math.floor(u.y / w.T), Tile.Grass);
  } else {
    w.troopsLost++;
  }
  w.events.push({ type: 'unitLost', unitId: u.id, kind: u.kind, x: u.x, y: u.y, by });
}

/** A dart lands. At zero sedation the dinosaur is secured: it fades out and stops counting as loose. */
export function sedate(w: World, d: Dino, amount: number, unitId: number): void {
  if (d.state === 'secured' || d.state === 'contained') return;
  d.sedation -= amount;
  d.lastHitBy = unitId;
  d.lastHitTime = w.time;
  if (d.sedation > 0) return;
  d.sedation = 0;
  d.state = 'secured';
  d.fade = DINO_AI.secureFadeSeconds;
  d.stampede = 0;
  d.target = null;
  d.path = [];
  d.pathIndex = 0;
  d.lockId = 0;
  d.windup = 0;
  d.charge = 0;
  w.dinosSecured++;
  w.events.push({ type: 'secured', dinoId: d.id, kind: d.kind, x: d.x, y: d.y });
}

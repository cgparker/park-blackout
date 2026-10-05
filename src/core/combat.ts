import { DINO_AI, type AnimalKind } from '../config';
import type { Dino } from './dinos';
import { Tile } from './grid';
import { unload } from './jeep';
import type { Unit } from './units';
import type { World } from './world';

/** `by` is the kind of animal that did it, so the screen can explain the loss. Troops riding in the 4x4 can't be hurt. */
export function damageUnit(w: World, u: Unit, amount: number, by: AnimalKind | null = null): void {
  if (u.dead || u.aboard) return;
  u.hp -= amount;
  u.hurtAt = w.time;
  if (u.hp > 0) return;
  u.hp = 0;
  if (u.kind === 'jeep') {
    // Wrecked. Whoever was inside climbs out unhurt.
    unload(w, u);
    u.dead = true;
    w.jeepsLost++;
  } else {
    u.dead = true;
    if (u.kind === 'tower') {
      // The tile opens up again.
      w.towersLost++;
      w.grid.set(Math.floor(u.x / w.T), Math.floor(u.y / w.T), Tile.Grass);
    } else {
      w.troopsLost++;
      if (u.kind === 'engineer') w.engineersLost++;
    }
  }
  w.noteLoss(u.kind, u.x, u.y, by);
  w.events.push({ type: 'unitLost', unitId: u.id, kind: u.kind, x: u.x, y: u.y, by });
}

/**
 * A dart lands. At zero sedation the dinosaur is secured: it fades out and stops counting as loose.
 * In levels 1 and 2 it then wakes up back in its pen (see updateDinos).
 */
export function sedate(w: World, d: Dino, amount: number, unitId: number): void {
  if (d.state === 'secured' || d.state === 'contained' || d.state === 'dead') return;
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
  w.noteBack(d, 'darted');
  w.events.push({ type: 'secured', dinoId: d.id, kind: d.kind, x: d.x, y: d.y });
}

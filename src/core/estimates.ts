import { DINOS, EXHIBITS, FENCE, MAP, UNITS, type AnimalKind, type ExhibitKind, type UnitKind } from '../config';

/**
 * Planning numbers the screen shows, worked out from the rules so they stay true when the tuning changes.
 * A test checks them against the simulation.
 */

/**
 * Seconds after the blackout until an exhibit's animals break through one fence segment, if nothing
 * gets to that fence first. The animals wait out their delay, cross half the pen at full speed,
 * then hit the fence together until it gives way. null for animals that never break out on their own.
 */
export function breakoutSeconds(kind: ExhibitKind, reinforced: boolean): number | null {
  const ex = EXHIBITS[kind];
  const cfg = DINOS[ex.animal];
  if (cfg.breakoutDelaySeconds === null) return null;
  const hp = reinforced ? FENCE.concreteHp : FENCE.chainLinkHp;
  const rounds = Math.ceil(hp / (cfg.fenceDamage * ex.animalCount));
  const walk = (((ex.size - 2) / 2) * MAP.tileSize) / cfg.speed;
  return cfg.breakoutDelaySeconds + walk + (rounds - 1) * cfg.fenceHitIntervalSeconds;
}

/** Sedation per second from one unit's darts. */
export function sedationPerSecond(kind: UnitKind): number {
  return UNITS[kind].dartSedation / UNITS[kind].fireIntervalSeconds;
}

/** Seconds for a group darting together to put `count` animals of a kind to sleep. */
export function secondsToSedate(group: readonly UnitKind[], animal: AnimalKind, count = 1): number {
  const rate = group.reduce((sum, k) => sum + sedationPerSecond(k), 0);
  return rate > 0 ? (DINOS[animal].sedation * count) / rate : Infinity;
}

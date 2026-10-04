// Warnings on the ground around a T. rex, as in the 2D game: an orange ring under the troop or tower it
// has locked onto; before a charge, an arc that fills around it and a line to its target; during the
// charge, a ring around it and a streak behind.
import * as THREE from 'three';
import { DINO_AI } from '../config';
import { clamp, col } from './util';

export interface CueDino {
  id: number;
  kind: string;
  x: number;
  y: number;
  state: string;
  removed?: boolean;
  lockId?: number;
  windup?: number;
  charge?: number;
  cdx?: number;
  cdy?: number;
}

export interface CueUnit {
  id: number;
  kind: string;
  x: number;
  y: number;
  dead?: boolean;
}

const Y = 0.04;
const ARC_STEPS = 32;
/** Ring radii in tiles: around the T. rex, and under a locked troop or tower. */
const R = { arc: 1.0, charge: 0.95, troop: 0.42, heavy: 0.5, tower: 0.66 };

function mat(opacity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color: col('#ff7a1a'), transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, side: THREE.DoubleSide });
}

const flatRing = (r0: number, r1: number, theta = Math.PI * 2) => new THREE.RingGeometry(r0, r1, 64, 1, 0, theta).rotateX(-Math.PI / 2);

interface CueSet {
  lock: THREE.Mesh;
  arc: THREE.Mesh;
  aim: THREE.Mesh;
  ring: THREE.Mesh;
  streak: THREE.Mesh;
}

export class Cues {
  readonly group = new THREE.Group();
  private readonly sets = new Map<number, CueSet>();
  private readonly mats = { lock: mat(0.85), arc: mat(0.95), aim: mat(0.4), ring: mat(0.9), streak: mat(0.3) };
  private readonly lockGeo = { troop: flatRing(R.troop - 0.05, R.troop), heavy: flatRing(R.heavy - 0.05, R.heavy), tower: flatRing(R.tower - 0.06, R.tower) };
  /** The wind-up arc at each step of filling, made once. */
  private readonly arcs: THREE.BufferGeometry[] = [];
  private readonly ringGeo = flatRing(R.charge - 0.06, R.charge);
  private readonly bar = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

  constructor() {
    for (let i = 1; i <= ARC_STEPS; i++) {
      // Starts at the top of the screen (north) and fills clockwise, like the 2D arc.
      const g = new THREE.RingGeometry(R.arc - 0.07, R.arc, 64, 1, Math.PI / 2 - (Math.PI * 2 * i) / ARC_STEPS, (Math.PI * 2 * i) / ARC_STEPS).rotateX(-Math.PI / 2);
      this.arcs.push(g);
    }
  }

  private make(): CueSet {
    const m = (geo: THREE.BufferGeometry, mt: THREE.Material) => {
      const o = new THREE.Mesh(geo, mt);
      o.renderOrder = 6;
      o.visible = false;
      this.group.add(o);
      return o;
    };
    return {
      lock: m(this.lockGeo.troop, this.mats.lock),
      arc: m(this.arcs[0], this.mats.arc),
      aim: m(this.bar, this.mats.aim),
      ring: m(this.ringGeo, this.mats.ring),
      streak: m(this.bar, this.mats.streak),
    };
  }

  update(T: number, dinos: readonly CueDino[], units: readonly CueUnit[]): void {
    const seen = new Set<number>();
    for (const d of dinos) {
      if (d.kind !== 'trex' || d.removed || d.state !== 'loose') continue;
      seen.add(d.id);
      let s = this.sets.get(d.id);
      if (!s) this.sets.set(d.id, (s = this.make()));
      const x = d.x / T;
      const z = d.y / T;
      const lock = d.lockId ? units.find((u) => u.id === d.lockId && !u.dead) : undefined;
      s.lock.visible = !!lock;
      if (lock) {
        s.lock.geometry = lock.kind === 'tower' ? this.lockGeo.tower : lock.kind === 'heavy' ? this.lockGeo.heavy : this.lockGeo.troop;
        const lx = lock.kind === 'tower' ? Math.floor(lock.x / T) + 0.5 : lock.x / T;
        const lz = lock.kind === 'tower' ? Math.floor(lock.y / T) + 0.5 : lock.y / T;
        s.lock.position.set(lx, Y, lz);
      }
      const windup = d.windup ?? 0;
      const charge = d.charge ?? 0;
      s.arc.visible = windup > 0;
      s.aim.visible = windup > 0 && !!lock;
      if (windup > 0) {
        const p = clamp(1 - windup / DINO_AI.trexChargeWindupSeconds, 0, 1);
        s.arc.geometry = this.arcs[Math.max(0, Math.round(p * ARC_STEPS) - 1)];
        s.arc.position.set(x, Y, z);
        if (lock) this.stretch(s.aim, x, z, lock.x / T, lock.y / T, 0.07);
      }
      s.ring.visible = charge > 0;
      s.streak.visible = charge > 0;
      if (charge > 0) {
        s.ring.position.set(x, Y, z);
        const cx = d.cdx ?? 0;
        const cz = d.cdy ?? 0;
        this.stretch(s.streak, x - cx * 1.05, z - cz * 1.05, x - cx * 2.2, z - cz * 2.2, 0.32);
      }
    }
    for (const [id, s] of this.sets) {
      if (seen.has(id)) continue;
      for (const o of Object.values(s)) this.group.remove(o);
      this.sets.delete(id);
    }
  }

  /** Lays a flat bar of the given width from one ground point to another. */
  private stretch(o: THREE.Mesh, x0: number, z0: number, x1: number, z1: number, width: number): void {
    const len = Math.hypot(x1 - x0, z1 - z0);
    o.position.set((x0 + x1) / 2, Y, (z0 + z1) / 2);
    o.rotation.set(0, -Math.atan2(z1 - z0, x1 - x0), 0);
    o.scale.set(Math.max(len, 1e-3), 1, width);
  }

  clear(): void {
    for (const s of this.sets.values()) for (const o of Object.values(s)) this.group.remove(o);
    this.sets.clear();
  }
}

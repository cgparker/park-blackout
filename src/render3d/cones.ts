// Level 4: what each raptor on patrol sees, as a pale fan on the ground cut short by cover, as in the 2D game.
// A raptor on the hunt shows a red bar to its prey and a red ring under it instead.
import * as THREE from 'three';
import { STEALTH } from '../config';
import { col } from './util';

/** One raptor's view, in world pixels: its position, then the end of each ray across its cone. Or its prey, if it's hunting. */
export interface ConeView {
  id: number;
  x: number;
  y: number;
  pts: readonly { x: number; y: number }[];
  prey: { x: number; y: number } | null;
}

const Y = 0.035;
const MAX_POINTS = 64;
/**
 * The fan's strength at the raptor, by day and at night, and how much of it is left at the far edge. Blending
 * happens in linear light, where a little colour over dark grass reads as a lot, so these are low.
 */
const FAN_DAY = 0.16;
const FAN_NIGHT = 0.07;
const FAN_FAR = 0.3;

const flat = (color: string, opacity: number, vertexColors = false) =>
  new THREE.MeshBasicMaterial({ color: col(color), transparent: true, opacity, vertexColors, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, side: THREE.DoubleSide });

interface ConeSet {
  fan: THREE.Mesh;
  edge: THREE.Line;
  bar: THREE.Mesh;
  ring: THREE.Mesh;
}

export class Cones {
  readonly group = new THREE.Group();
  private readonly sets = new Map<number, ConeSet>();
  private readonly mats = {
    fan: flat('#ffd36b', FAN_DAY, true),
    edge: new THREE.LineBasicMaterial({ color: col('#ffd36b'), transparent: true, opacity: 0.55, depthWrite: false }),
    bar: flat('#ff5a4a', 0.5),
    ring: flat('#ff5a4a', 0.9),
  };
  private readonly ringGeo = new THREE.RingGeometry(0.4, 0.47, 48).rotateX(-Math.PI / 2);
  private readonly barGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

  /** Fainter at night: on dark grass the same colour stands out more. */
  setNight(night: boolean): void {
    this.mats.fan.opacity = night ? FAN_NIGHT : FAN_DAY;
    this.mats.edge.opacity = night ? 0.6 : 0.55;
  }

  private make(): ConeSet {
    const fanGeo = new THREE.BufferGeometry();
    fanGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_POINTS * 3), 3).setUsage(THREE.DynamicDrawUsage));
    // White, with the fade in alpha: strongest at the raptor and fading toward the edge of its sight.
    fanGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(MAX_POINTS * 4).fill(1), 4).setUsage(THREE.DynamicDrawUsage));
    const idx: number[] = [];
    for (let i = 1; i < MAX_POINTS - 1; i++) idx.push(0, i, i + 1);
    fanGeo.setIndex(idx);
    const fan = new THREE.Mesh(fanGeo, this.mats.fan);
    const edgeGeo = new THREE.BufferGeometry();
    edgeGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_POINTS * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const edge = new THREE.LineLoop(edgeGeo, this.mats.edge);
    const bar = new THREE.Mesh(this.barGeo, this.mats.bar);
    const ring = new THREE.Mesh(this.ringGeo, this.mats.ring);
    for (const o of [fan, edge, bar, ring]) {
      o.frustumCulled = false;
      o.renderOrder = 4;
      this.group.add(o);
    }
    return { fan, edge, bar, ring };
  }

  update(T: number, cones: readonly ConeView[]): void {
    const seen = new Set<number>();
    for (const c of cones) {
      seen.add(c.id);
      let s = this.sets.get(c.id);
      if (!s) this.sets.set(c.id, (s = this.make()));
      const hunting = !!c.prey;
      s.fan.visible = s.edge.visible = !hunting;
      s.bar.visible = s.ring.visible = hunting;
      if (c.prey) {
        const x0 = c.x / T;
        const z0 = c.y / T;
        const x1 = c.prey.x / T;
        const z1 = c.prey.y / T;
        const len = Math.hypot(x1 - x0, z1 - z0);
        s.bar.position.set((x0 + x1) / 2, Y, (z0 + z1) / 2);
        s.bar.rotation.set(0, -Math.atan2(z1 - z0, x1 - x0), 0);
        s.bar.scale.set(Math.max(len, 1e-3), 1, 0.06);
        s.ring.position.set(x1, Y, z1);
        continue;
      }
      const n = Math.min(MAX_POINTS, c.pts.length);
      const fp = s.fan.geometry.attributes.position as THREE.BufferAttribute;
      const fa = s.fan.geometry.attributes.color as THREE.BufferAttribute;
      const ep = s.edge.geometry.attributes.position as THREE.BufferAttribute;
      const range = STEALTH.sightTiles * T;
      for (let i = 0; i < n; i++) {
        const p = c.pts[i];
        fp.setXYZ(i, p.x / T, Y, p.y / T);
        fa.setW(i, 1 - (1 - FAN_FAR) * Math.min(1, Math.hypot(p.x - c.x, p.y - c.y) / range));
        ep.setXYZ(i, p.x / T, Y + 0.002, p.y / T);
      }
      fp.needsUpdate = fa.needsUpdate = ep.needsUpdate = true;
      s.fan.geometry.setDrawRange(0, Math.max(0, n - 2) * 3);
      s.edge.geometry.setDrawRange(0, n);
    }
    for (const [id, s] of this.sets) {
      if (seen.has(id)) continue;
      for (const o of [s.fan, s.edge, s.bar, s.ring]) this.group.remove(o);
      s.fan.geometry.dispose();
      s.edge.geometry.dispose();
      this.sets.delete(id);
    }
  }

  clear(): void {
    this.update(1, []);
  }
}

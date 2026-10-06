// What each calm raptor sees, in every level, as a pale fan on the ground cut short by cover, as in the 2D game, with
// a ring at its feet so the raptor at the tip of its cone can be found in the dark. While it makes someone out, the
// fan turns orange and a ring fills around it. A raptor on the hunt shows a red bar to its prey and a red ring under
// it instead: thin while its pack circles the prey, thick once they rush.
import * as THREE from 'three';
import { STEALTH } from '../config';
import { col } from './util';

/**
 * One raptor's view, in world pixels: its position, then the end of each ray across its cone. Or its prey, if it's
 * hunting. `notice`: 0 to 1, how far it is to making out someone it has in sight.
 */
export interface ConeView {
  id: number;
  x: number;
  y: number;
  pts: readonly { x: number; y: number }[];
  prey: { x: number; y: number } | null;
  /** On the hunt: false while its pack circles the prey, true once they rush (or it charges alone). */
  rush?: boolean;
  notice: number;
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
const CALM = col('#ffd36b');
const NOTICE = col('#ff8a2a');
/** The noticing ring is drawn in this many pieces, shown one by one as it fills. */
const ARC_PIECES = 16;

const flat = (color: string, opacity: number, vertexColors = false) =>
  new THREE.MeshBasicMaterial({ color: col(color), transparent: true, opacity, vertexColors, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, side: THREE.DoubleSide });

interface ConeSet {
  fan: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  edge: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  bar: THREE.Mesh;
  ring: THREE.Mesh;
  /** At the raptor's feet. */
  mark: THREE.Mesh;
  arcs: THREE.Mesh[];
}

export class Cones {
  readonly group = new THREE.Group();
  private readonly sets = new Map<number, ConeSet>();
  private night = false;
  private readonly mats = {
    bar: flat('#ff5a4a', 0.5),
    ring: flat('#ff5a4a', 0.9),
    mark: flat('#ffd36b', 0.75),
    arc: flat('#ff8a2a', 0.95),
  };
  private readonly ringGeo = new THREE.RingGeometry(0.4, 0.47, 48).rotateX(-Math.PI / 2);
  private readonly barGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  private readonly markGeo = new THREE.RingGeometry(0.3, 0.35, 40).rotateX(-Math.PI / 2);
  /** One piece of the noticing ring, a little outside the mark, starting at the top and going clockwise. */
  private readonly arcGeos = Array.from({ length: ARC_PIECES }, (_, i) =>
    new THREE.RingGeometry(0.38, 0.47, 6, 1, Math.PI / 2 - ((i + 1) * Math.PI * 2) / ARC_PIECES, (Math.PI * 2) / ARC_PIECES).rotateX(-Math.PI / 2),
  );

  /** Fainter at night: on dark grass the same colour stands out more. */
  setNight(night: boolean): void {
    this.night = night;
  }

  private make(): ConeSet {
    const fanGeo = new THREE.BufferGeometry();
    fanGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_POINTS * 3), 3).setUsage(THREE.DynamicDrawUsage));
    // White, with the fade in alpha: strongest at the raptor and fading toward the edge of its sight.
    fanGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(MAX_POINTS * 4).fill(1), 4).setUsage(THREE.DynamicDrawUsage));
    const idx: number[] = [];
    for (let i = 1; i < MAX_POINTS - 1; i++) idx.push(0, i, i + 1);
    fanGeo.setIndex(idx);
    // Each raptor's fan and outline have their own material, so one can turn orange on its own.
    const fan = new THREE.Mesh(fanGeo, flat('#ffd36b', FAN_DAY, true));
    const edgeGeo = new THREE.BufferGeometry();
    edgeGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_POINTS * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const edge = new THREE.LineLoop(edgeGeo, new THREE.LineBasicMaterial({ color: CALM.clone(), transparent: true, opacity: 0.55, depthWrite: false }));
    const bar = new THREE.Mesh(this.barGeo, this.mats.bar);
    const ring = new THREE.Mesh(this.ringGeo, this.mats.ring);
    const mark = new THREE.Mesh(this.markGeo, this.mats.mark);
    const arcs = this.arcGeos.map((g) => new THREE.Mesh(g, this.mats.arc));
    for (const o of [fan, edge, bar, ring, mark, ...arcs]) {
      o.frustumCulled = false;
      o.renderOrder = 4;
      this.group.add(o);
    }
    return { fan, edge, bar, ring, mark, arcs };
  }

  update(T: number, cones: readonly ConeView[]): void {
    const seen = new Set<number>();
    for (const c of cones) {
      seen.add(c.id);
      let s = this.sets.get(c.id);
      if (!s) this.sets.set(c.id, (s = this.make()));
      const hunting = !!c.prey;
      s.fan.visible = s.edge.visible = s.mark.visible = !hunting;
      s.bar.visible = s.ring.visible = hunting;
      const k = hunting ? 0 : Math.min(1, Math.max(0, c.notice));
      const lit = Math.ceil(k * ARC_PIECES);
      s.arcs.forEach((a, i) => {
        a.visible = i < lit;
        a.position.set(c.x / T, Y + 0.003, c.y / T);
      });
      if (c.prey) {
        const x0 = c.x / T;
        const z0 = c.y / T;
        const x1 = c.prey.x / T;
        const z1 = c.prey.y / T;
        const len = Math.hypot(x1 - x0, z1 - z0);
        s.bar.position.set((x0 + x1) / 2, Y, (z0 + z1) / 2);
        s.bar.rotation.set(0, -Math.atan2(z1 - z0, x1 - x0), 0);
        // A thin bar while the pack circles, a thick one once it rushes.
        s.bar.scale.set(Math.max(len, 1e-3), 1, c.rush === false ? 0.035 : 0.1);
        s.ring.position.set(x1, Y, z1);
        continue;
      }
      s.mark.position.set(c.x / T, Y + 0.002, c.y / T);
      // Orange while it makes something out, and stronger as it gets surer.
      s.fan.material.color.copy(k > 0 ? NOTICE : CALM);
      s.fan.material.opacity = (this.night ? FAN_NIGHT : FAN_DAY) * (1 + k * 1.5);
      s.edge.material.color.copy(k > 0 ? NOTICE : CALM);
      s.edge.material.opacity = (this.night ? 0.6 : 0.55) + 0.35 * k;
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
      for (const o of [s.fan, s.edge, s.bar, s.ring, s.mark, ...s.arcs]) this.group.remove(o);
      s.fan.geometry.dispose();
      s.fan.material.dispose();
      s.edge.geometry.dispose();
      s.edge.material.dispose();
      this.sets.delete(id);
    }
  }

  clear(): void {
    this.update(1, []);
  }
}

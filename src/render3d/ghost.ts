// The placement preview: where an exhibit or a tower would go, green when it fits and red when it
// doesn't, with the new path tiles and the viewing spot for an exhibit and the dart range for a tower.
import * as THREE from 'three';
import type { Point, Rect } from '../core/grid';
import { col, disposeTree } from './util';

export interface GhostView {
  /** Tiles the exhibit or tower covers. */
  rect: Rect;
  valid: boolean;
  /** Exhibits: the new path tiles that join it to the paths, and its viewing spot. */
  paths?: readonly Point[];
  spot?: Point | null;
  /** Towers: dart range, in tiles. */
  range?: number;
}

const Y = 0.035;
const EDGE = 0.07;

function mat(color: string, opacity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color: col(color), transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
}

const MATS = {
  ok: { fill: mat('#37d67a', 0.28), edge: mat('#37d67a', 0.95), line: mat('#37d67a', 0.7), wash: mat('#37d67a', 0.08), ring: mat('#37d67a', 0.55) },
  bad: { fill: mat('#ff4d4d', 0.28), edge: mat('#ff4d4d', 0.95), line: mat('#ff4d4d', 0.7), wash: mat('#ff4d4d', 0.08), ring: mat('#ff4d4d', 0.55) },
  path: mat('#c9a66b', 0.85),
  spot: mat('#ffffff', 0.95),
};

/** A flat rectangle on the ground, x0..x1 by z0..z1 in tiles. */
function flat(x0: number, z0: number, x1: number, z1: number, m: THREE.Material, y = Y): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(x1 - x0, z1 - z0).rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, m);
  mesh.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
  mesh.renderOrder = 6;
  return mesh;
}

/** The outline of a box of tiles as four strips. */
function outline(g: THREE.Group, x0: number, z0: number, x1: number, z1: number, w: number, m: THREE.Material): void {
  g.add(flat(x0, z0, x1, z0 + w, m), flat(x0, z1 - w, x1, z1, m), flat(x0, z0 + w, x0 + w, z1 - w, m), flat(x1 - w, z0 + w, x1, z1 - w, m));
}

export class Ghost {
  readonly group = new THREE.Group();
  private key = '';

  /** Shows a preview, or hides it with null. Rebuilds only when something changed. */
  set(g: GhostView | null): void {
    const key = g ? JSON.stringify(g) : '';
    if (key === this.key) return;
    this.key = key;
    disposeTree(this.group);
    this.group.clear();
    if (!g) return;
    const m = g.valid ? MATS.ok : MATS.bad;
    const { x, y, w, h } = g.rect;
    if (g.range !== undefined) {
      const cx = x + 0.5;
      const cz = y + 0.5;
      const wash = new THREE.Mesh(new THREE.CircleGeometry(g.range, 64).rotateX(-Math.PI / 2), m.wash);
      const ring = new THREE.Mesh(new THREE.RingGeometry(g.range - 0.05, g.range, 96).rotateX(-Math.PI / 2), m.ring);
      for (const o of [wash, ring]) {
        o.position.set(cx, Y, cz);
        o.renderOrder = 6;
        this.group.add(o);
      }
    }
    for (const p of g.paths ?? []) this.group.add(flat(p.x + 0.12, p.y + 0.12, p.x + 0.88, p.y + 0.88, MATS.path));
    this.group.add(flat(x, y, x + w, y + h, m.fill));
    outline(this.group, x, y, x + w, y + h, EDGE, m.edge);
    // The fence runs half a tile in from the footprint's edge.
    if (g.range === undefined && w > 1 && h > 1) outline(this.group, x + 0.5, y + 0.5, x + w - 0.5, y + h - 0.5, 0.045, m.line);
    if (g.spot) {
      const s = new THREE.Mesh(new THREE.CircleGeometry(0.16, 24).rotateX(-Math.PI / 2), MATS.spot);
      s.position.set(g.spot.x + 0.5, Y + 0.005, g.spot.y + 0.5);
      s.renderOrder = 7;
      this.group.add(s);
    }
  }

  /** Middle and reach of the preview, for keeping tree tops from hiding it. */
  get focus(): { x: number; z: number; r: number } | null {
    if (!this.key) return null;
    const g = JSON.parse(this.key) as GhostView;
    // A tower's range is mostly open ground; only its own tile needs to show.
    const r = g.range !== undefined ? 0.9 : Math.max(g.rect.w, g.rect.h) / 2 + 0.6;
    return { x: g.rect.x + g.rect.w / 2, z: g.rect.y + g.rect.h / 2, r };
  }
}

// Small helpers shared by the 3D view. World units are tiles: x east, z south (the game's y), y up.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export const UP = V3(0, 1, 0);
export const col = (h: string | number) => new THREE.Color(h);
/** A colour brighter than white, for things that glow through bloom. */
export const hdr = (h: string | number, k: number) => new THREE.Color(h).multiplyScalar(k);
export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Deterministic random numbers, so the same park always gets the same trees. */
export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hash of two integers to 0..1, for per-segment variation that stays put between rebuilds. */
export function hash2(x: number, y: number, s = 0): number {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise in 0..1 with features about `scale` tiles across. */
export function vnoise(x: number, z: number, scale: number, seed = 0): number {
  const fx = x / scale;
  const fz = z / scale;
  const ix = Math.floor(fx);
  const iz = Math.floor(fz);
  const tx = fx - ix;
  const tz = fz - iz;
  const sx = tx * tx * (3 - 2 * tx);
  const sz = tz * tz * (3 - 2 * tz);
  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}

/** Turns an angle toward a target angle by at most `step`, the short way round. */
export function turnToward(from: number, to: number, step: number): number {
  let d = to - from;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d) <= step ? to : from + Math.sign(d) * step;
}

/** Game facing (radians, 0 = east, clockwise on screen) to a y rotation for a model that faces +z. */
export const facingToRotY = (facing: number) => Math.PI / 2 - facing;

export function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, srgb = true): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();

/** Collects many small static parts and merges them into one mesh per material. */
export class Batch {
  private readonly parts = new Map<THREE.Material, THREE.BufferGeometry[]>();

  add(geo: THREE.BufferGeometry, mat: THREE.Material, matrix?: THREE.Matrix4): void {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!g.attributes.normal) g.computeVertexNormals();
    if (matrix) g.applyMatrix4(matrix);
    let list = this.parts.get(mat);
    if (!list) this.parts.set(mat, (list = []));
    list.push(g);
    geo.dispose();
  }

  /** A box centred at (x, y, z), turned by ry about y, then rx and rz. */
  box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, ry = 0, rx = 0, rz = 0): void {
    this.add(new THREE.BoxGeometry(w, h, d), mat, this.at(x, y, z, ry, rx, rz));
  }

  cyl(r0: number, r1: number, h: number, mat: THREE.Material, x: number, y: number, z: number, seg = 10, ry = 0, rx = 0, rz = 0): void {
    this.add(new THREE.CylinderGeometry(r0, r1, h, seg), mat, this.at(x, y, z, ry, rx, rz));
  }

  /** A round bar from a to b. */
  rod(a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material, seg = 6): void {
    const len = a.distanceTo(b);
    if (len < 1e-5) return;
    const g = new THREE.CylinderGeometry(r, r, len, seg, 1, false);
    const q = tmpQ.setFromUnitVectors(UP, b.clone().sub(a).normalize());
    this.add(g, mat, new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, V3(1, 1, 1)));
  }

  /** A square bar from a to b, for steel beams. */
  beam(a: THREE.Vector3, b: THREE.Vector3, w: number, mat: THREE.Material): void {
    const len = a.distanceTo(b);
    if (len < 1e-5) return;
    const g = new THREE.BoxGeometry(w, len, w);
    const q = tmpQ.setFromUnitVectors(UP, b.clone().sub(a).normalize());
    this.add(g, mat, new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, V3(1, 1, 1)));
  }

  tube(points: THREE.Vector3[], r: number, mat: THREE.Material, seg = 16): void {
    const curve = new THREE.CatmullRomCurve3(points);
    this.add(new THREE.TubeGeometry(curve, seg, r, 5, false), mat);
  }

  at(x: number, y: number, z: number, ry = 0, rx = 0, rz = 0, s = 1): THREE.Matrix4 {
    tmpE.set(rx, ry, rz, 'YXZ');
    return new THREE.Matrix4().compose(V3(x, y, z), tmpQ.setFromEuler(tmpE).clone(), V3(s, s, s));
  }

  get empty(): boolean {
    return this.parts.size === 0;
  }

  /** Adds the merged meshes to `parent` and empties the batch. */
  flush(parent: THREE.Object3D, { cast = true, receive = true } = {}): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    for (const [mat, list] of this.parts) {
      const merged = mergeGeometries(list, false);
      for (const g of list) g.dispose();
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = cast && !(mat as THREE.MeshBasicMaterial).isMeshBasicMaterial;
      mesh.receiveShadow = receive;
      parent.add(mesh);
      out.push(mesh);
    }
    this.parts.clear();
    return out;
  }
}

/** Frees the GPU memory held by an object tree. Shared materials and textures are left alone. */
export function disposeTree(o: THREE.Object3D): void {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (m.geometry && !m.userData.sharedGeometry) m.geometry.dispose();
  });
}

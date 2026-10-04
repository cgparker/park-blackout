// Trees, bushes, plants, rocks, and grass tufts, placed by rule so the same park always looks the same.
// Trees stay off the playfield (outside the map or in a thin band at its edge) so they never hide troops or block a build.
import * as THREE from 'three';
import { Tile } from '../core/grid';
import { boxBlur, fenceRect, MARGIN, type Splat, type TerrainSource, type TileWindow } from './terrain';
import { foliageGradient } from './materials';
import { clamp, col, mulberry32, smoothstep, UP, vnoise } from './util';

export type DecorKind =
  | 'tree' | 'pine' | 'twisted' | 'log' | 'bush' | 'bushFlower' | 'hedge' | 'fern' | 'plant' | 'plantTall' | 'flower'
  | 'grass' | 'grassTall' | 'wispy' | 'reed' | 'rock' | 'pebble' | 'clover' | 'mushroom';

export interface Placement {
  x: number;
  z: number;
  rot: number;
  s: number;
  /** Lean, for logs lying on their side. */
  tilt?: number;
}

export type DecorPlan = Record<DecorKind, Placement[]>;

const RES = 4; // distance grid cells per tile

/** Chamfer distance (in tiles) from every cell to the nearest blocked cell. */
function distanceGrid(blocked: Uint8Array, w: number, h: number): Float32Array {
  const INF = 1e9;
  const d = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) d[i] = blocked[i] ? 0 : INF;
  const a = 1;
  const b = Math.SQRT2;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let v = d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + a);
      if (y > 0) v = Math.min(v, d[i - w] + a);
      if (x > 0 && y > 0) v = Math.min(v, d[i - w - 1] + b);
      if (x < w - 1 && y > 0) v = Math.min(v, d[i - w + 1] + b);
      d[i] = v;
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      let v = d[i];
      if (x < w - 1) v = Math.min(v, d[i + 1] + a);
      if (y < h - 1) v = Math.min(v, d[i + w] + a);
      if (x < w - 1 && y < h - 1) v = Math.min(v, d[i + w + 1] + b);
      if (x > 0 && y < h - 1) v = Math.min(v, d[i + w - 1] + b);
      d[i] = v;
    }
  for (let i = 0; i < w * h; i++) d[i] /= RES;
  return d;
}

export interface DecorOptions {
  /** Grass tufts on open ground. Fewer on phones. */
  grassTufts: number;
  /** Tree and shrub tries per square tile. */
  treeDensity: number;
  seed?: number;
}

export function planDecor(src: TerrainSource, splat: Splat, opts: DecorOptions): DecorPlan {
  const rnd = mulberry32(opts.seed ?? 11);
  const rr = (a: number, b: number) => a + (b - a) * rnd();
  const X0 = -MARGIN.x;
  const Z0 = -MARGIN.z;
  const TW = src.cols + MARGIN.x * 2;
  const TH = src.rows + MARGIN.z * 2;
  const w = TW * RES;
  const h = TH * RES;
  const pathM = new Uint8Array(w * h);
  const hard = new Uint8Array(w * h);
  const waterM = new Uint8Array(w * h);
  const blockM = new Uint8Array(w * h);
  const rockM = new Uint8Array(w * h);
  const pens = new Int32Array(w * h).fill(-1);
  const g = src.gate;
  for (let cz = 0; cz < h; cz++)
    for (let cx = 0; cx < w; cx++) {
      const x = X0 + (cx + 0.5) / RES;
      const z = Z0 + (cz + 0.5) / RES;
      const tx = Math.floor(x);
      const tz = Math.floor(z);
      const i = cz * w + cx;
      const inMap = tx >= 0 && tz >= 0 && tx < src.cols && tz < src.rows;
      const t = inMap ? src.tileAt(tx, tz) : -1;
      if (t === Tile.Path || t === Tile.Gate) pathM[i] = 1;
      if (t === Tile.Water) waterM[i] = 1;
      if (t === Tile.Rock) rockM[i] = 1;
      if (t === Tile.Exhibit || t === Tile.HQ || t === Tile.Tower) blockM[i] = 1;
      if (g.x === 0 && x < 0 && x > -3.6 && z > g.y - 1.2 && z < g.y + 2.2) pathM[i] = 1;
      if (g.x === 0 && x < -3.2 && x > -7.2) hard[i] = 1;
      if (t === Tile.Path || t === Tile.Gate || t === Tile.Water || t === Tile.HQ || t === Tile.Tower || t === Tile.Exhibit || t === Tile.Rock) hard[i] = 1;
      if (pathM[i]) hard[i] = 1;
      const hq = src.hq;
      if (x > hq.x - 0.4 && x < hq.x + hq.w + 0.4 && z > hq.y - 0.4 && z < hq.y + hq.h + 0.4) hard[i] = blockM[i] = 1;
      if (src.nest && Math.hypot(x - src.nest.x, z - src.nest.y) < 2.4) hard[i] = blockM[i] = 1;
      if (g.x === 0 && x < -3.2 && x > -7.2) blockM[i] = 1;
      for (const r of src.clear ?? []) if (x > r.x && x < r.x + r.w && z > r.y && z < r.y + r.h) hard[i] = blockM[i] = 1;
      // The hedge line along the west edge, except at the gate.
      if (g.x === 0 && x > -0.75 && x < 0.15 && !(z > g.y - 1.2 && z < g.y + 2.2)) hard[i] = 1;
    }
  src.exhibits.forEach((ex, k) => {
    const f = ex.footprint;
    for (let cz = Math.max(0, (f.y - Z0) * RES); cz < Math.min(h, (f.y + f.h - Z0) * RES); cz++)
      for (let cx = Math.max(0, (f.x - X0) * RES); cx < Math.min(w, (f.x + f.w - X0) * RES); cx++) pens[cz * w + cx] = k;
  });
  const dHard = distanceGrid(hard, w, h);
  const dPath = distanceGrid(pathM, w, h);
  const dWater = distanceGrid(waterM, w, h);
  const dBlock = distanceGrid(blockM, w, h);
  const dRock = distanceGrid(rockM, w, h);
  const cell = (x: number, z: number) => clamp(Math.floor((z - Z0) * RES), 0, h - 1) * w + clamp(Math.floor((x - X0) * RES), 0, w - 1);
  const waterAt = (x: number, z: number) => {
    const px = clamp(Math.floor((x - X0) * 16), 0, splat.w - 1);
    const pz = clamp(Math.floor((z - Z0) * 16), 0, splat.h - 1);
    return splat.water[pz * splat.w + px];
  };

  const plan = Object.fromEntries(
    (['tree', 'pine', 'twisted', 'log', 'bush', 'bushFlower', 'hedge', 'fern', 'plant', 'plantTall', 'flower', 'grass', 'grassTall', 'wispy', 'reed', 'rock', 'pebble', 'clover', 'mushroom'] as DecorKind[]).map((k) => [k, [] as Placement[]]),
  ) as DecorPlan;
  // Everything placed so far, bucketed by tile so the spacing check only looks nearby.
  const buckets = new Map<number, { x: number; z: number; r: number }[]>();
  const bucket = (bx: number, bz: number) => (bz + 1024) * 4096 + (bx + 1024);
  const MAX_R = 1.2;
  const spaced = (x: number, z: number, r: number) => {
    const reach = Math.ceil(r + MAX_R);
    const bx = Math.floor(x);
    const bz = Math.floor(z);
    for (let dz = -reach; dz <= reach; dz++)
      for (let dx = -reach; dx <= reach; dx++) {
        const list = buckets.get(bucket(bx + dx, bz + dz));
        if (list) for (const p of list) if ((x - p.x) ** 2 + (z - p.z) ** 2 < (r + p.r) ** 2) return false;
      }
    return true;
  };
  const add = (k: DecorKind, x: number, z: number, s: number, r: number, rot = rr(0, Math.PI * 2), tilt?: number) => {
    plan[k].push({ x, z, rot, s, tilt });
    const key = bucket(Math.floor(x), Math.floor(z));
    let list = buckets.get(key);
    if (!list) buckets.set(key, (list = []));
    list.push({ x, z, r: Math.min(r, MAX_R) });
  };

  // Rocks on rock tiles, with pebbles around them.
  for (let z = 0; z < src.rows; z++)
    for (let x = 0; x < src.cols; x++) {
      if (src.tileAt(x, z) !== Tile.Rock) continue;
      add('rock', x + 0.5 + rr(-0.12, 0.12), z + 0.5 + rr(-0.12, 0.12), rr(0.28, 0.36), 0.5);
      for (let k = 0; k < 3; k++) {
        const a = rr(0, Math.PI * 2);
        const d = rr(0.5, 0.8);
        plan.pebble.push({ x: x + 0.5 + Math.cos(a) * d, z: z + 0.5 + Math.sin(a) * d, rot: rr(0, 6.28), s: rr(0.5, 1) });
      }
    }

  // Inside the pens.
  for (const ex of src.exhibits) {
    const f = fenceRect(ex.footprint);
    const inner = (m: number) => [rr(f.x0 + m, f.x1 - m), rr(f.z0 + m, f.z1 - m)] as const;
    if (ex.kind === 'pasture') {
      add('tree', f.x0 + 0.75, f.z0 + 0.7, rr(0.26, 0.3), 0.7);
      for (let k = 0; k < 40; k++) {
        const [x, z] = inner(0.3);
        if (!spaced(x, z, 0.3)) continue;
        const r = rnd();
        if (r < 0.15) add('bush', x, z, 0.22 * rr(0.8, 1.2), 0.3);
        else if (r < 0.4) add('flower', x, z, 0.11 * rr(0.8, 1.2), 0.2);
        else add(r < 0.75 ? 'grass' : 'wispy', x, z, 0.12 * rr(0.8, 1.2), 0.15);
      }
    } else if (ex.kind === 'raptor') {
      for (let k = 0; k < 50; k++) {
        const [x, z] = inner(0.25);
        if (!spaced(x, z, 0.28)) continue;
        const r = rnd();
        if (r < 0.4) add('fern', x, z, 0.07 * rr(0.8, 1.25), 0.3);
        else if (r < 0.6) add('plant', x, z, 0.1 * rr(0.8, 1.2), 0.25);
        else add('wispy', x, z, 0.12 * rr(0.8, 1.2), 0.15);
      }
    } else {
      // T. rex paddock: jungle. Trees and big leafy plants crowd the walls, ferns fill the floor,
      // and a trampled clearing in the middle keeps the animal in view.
      const cx = (f.x0 + f.x1) / 2;
      const cz = (f.z0 + f.z1) / 2;
      const hx = (f.x1 - f.x0) / 2;
      const hz = (f.z1 - f.z0) / 2;
      const ring = (x: number, z: number) => Math.max(Math.abs(x - cx) / hx, Math.abs(z - cz) / hz);
      const spots: [number, number][] = [[0.1, 0.1], [0.5, 0.06], [0.9, 0.12], [0.06, 0.55], [0.94, 0.5], [0.12, 0.9], [0.55, 0.94], [0.9, 0.9]];
      spots.forEach(([u, v], k) => {
        const x = f.x0 + 0.35 + u * (f.x1 - f.x0 - 0.7) + rr(-0.15, 0.15);
        const z = f.z0 + 0.35 + v * (f.z1 - f.z0 - 0.7) + rr(-0.15, 0.15);
        if (k % 3 === 1) add('tree', x, z, rr(0.27, 0.32), 0.62);
        else add('twisted', x, z, rr(0.13, 0.16), 0.6);
      });
      add('log', cx + hx * 0.35, cz + hz * 0.45, 0.11, 0.5, 0.6, Math.PI / 2);
      for (let k = 0; k < 900; k++) {
        const [x, z] = inner(0.18);
        const t = ring(x, z);
        const r = rnd();
        if (t > 0.6) {
          if (!spaced(x, z, 0.2)) continue;
          if (r < 0.28) add('plantTall', x, z, rr(0.2, 0.28), 0.26);
          else if (r < 0.55) add('fern', x, z, rr(0.15, 0.21), 0.24);
          else if (r < 0.8) add('bush', x, z, rr(0.3, 0.38), 0.3);
          else add('plant', x, z, rr(0.2, 0.26), 0.24);
        } else if (t > 0.32) {
          if (!spaced(x, z, 0.24) || rnd() < 0.3) continue;
          if (r < 0.55) add('fern', x, z, rr(0.12, 0.18), 0.22);
          else if (r < 0.75) add('plant', x, z, rr(0.15, 0.2), 0.22);
          else if (r < 0.9) add('wispy', x, z, rr(0.12, 0.16), 0.15);
          else add('clover', x, z, rr(0.1, 0.14), 0.14);
        } else {
          if (!spaced(x, z, 0.22) || rnd() < 0.55) continue;
          if (r < 0.4) add('clover', x, z, rr(0.1, 0.14), 0.14);
          else if (r < 0.75) add('wispy', x, z, rr(0.11, 0.15), 0.14);
          else add('mushroom', x, z, rr(0.1, 0.14), 0.1);
        }
      }
    }
  }

  // Hedge along the park's west boundary.
  if (g.x === 0) for (let z = -MARGIN.z + 0.5; z < src.rows + MARGIN.z; z += 0.6) {
    if (z > g.y - 1.2 && z < g.y + 2.2) continue;
    add('hedge', -0.35 + rr(-0.05, 0.05), z, rr(0.26, 0.32), 0.25);
  }

  // Trees and shrubs on open grass, like a park that has grown in: thick outside and at the edges,
  // thinner in the middle where the action is. Units under a canopy show through it (see REVEAL).
  // Every try has its own random numbers, so a change in one spot doesn't reshuffle the whole forest.
  const central = (x: number, z: number) => smoothstep(2, 7, Math.min(x, src.cols - x)) * smoothstep(1.5, 5, Math.min(z, src.rows - z));
  const treeOk = (x: number, z: number, clearPath: number, r: number) => {
    const c = cell(x, z);
    if (dPath[c] < clearPath || dWater[c] < 0.25 + r * 0.6 || dBlock[c] < 0.35 + r * 0.6 || dRock[c] < 0.15 || pens[c] >= 0) return false;
    if (g.x === 0 && x > -0.9 && x < 0.3) return false;
    return spaced(x, z, r);
  };
  const tries = Math.round(TW * TH * opts.treeDensity);
  for (let k = 0; k < tries; k++) {
    const t = mulberry32((opts.seed ?? 11) * 7919 + k * 104729);
    const x = X0 + 0.5 + t() * (TW - 1);
    const z = Z0 + 0.5 + t() * (TH - 1);
    let dens = smoothstep(0.35, 0.7, vnoise(x, z, 7, 21)) * 0.75 + 0.25;
    if (x < -0.8) dens = 0.9;
    if (t() > dens * (1 - 0.8 * central(x, z))) continue;
    if (t() < 0.62) {
      const s = 0.25 + t() * 0.08;
      const r = (0.95 * s) / 0.3;
      const pine = t() < 0.38;
      if (treeOk(x, z, 1.1, r)) add(pine ? 'pine' : 'tree', x, z, s, r, t() * Math.PI * 2);
    } else {
      const s = 0.22 + t() * 0.08;
      const flowers = t() < 0.3;
      if (vnoise(x, z, 1.3, 22) < 0.55 && x > -0.8) continue;
      if (treeOk(x, z, 0.45, 0.32)) add(flowers ? 'bushFlower' : 'bush', x, z, s, 0.32, t() * Math.PI * 2);
    }
  }
  // Planted beds along path edges.
  for (let k = 0; k < 2500; k++) {
    const x = rr(-4, src.cols);
    const z = rr(0, src.rows);
    const c = cell(x, z);
    if (dPath[c] < 0.14 || dPath[c] > 0.45 || dHard[c] < 0.08 || pens[c] >= 0 || !spaced(x, z, 0.18) || rnd() > 0.4) continue;
    const r = rnd();
    if (r < 0.3) add('fern', x, z, 0.055 * rr(0.85, 1.2), 0.18);
    else if (r < 0.55) add('flower', x, z, 0.1 * rr(0.85, 1.2), 0.18);
    else if (r < 0.75) add('plant', x, z, 0.085 * rr(0.85, 1.2), 0.18);
    else add('wispy', x, z, 0.1 * rr(0.85, 1.2), 0.15);
  }
  // Reeds at the water's edge.
  for (let k = 0; k < 2500; k++) {
    const x = rr(0, src.cols);
    const z = rr(0, src.rows);
    const wv = waterAt(x, z);
    if (wv < 0.34 || wv > 0.5 || !spaced(x, z, 0.12) || rnd() > 0.6) continue;
    add('reed', x, z, rr(0.11, 0.16), 0.12);
  }
  // Grass tufts on open ground.
  let tufts = 0;
  for (let k = 0; k < opts.grassTufts * 12 && tufts < opts.grassTufts; k++) {
    const x = rr(X0 + 1, X0 + TW - 1);
    const z = rr(Z0 + 1, Z0 + TH - 1);
    const c = cell(x, z);
    if (dHard[c] < 0.08 || pens[c] >= 0) continue;
    const kind: DecorKind = rnd() < 0.3 ? 'wispy' : rnd() < 0.15 ? 'clover' : rnd() < 0.5 ? 'grassTall' : 'grass';
    plan[kind].push({ x, z, rot: rr(0, 6.28), s: rr(0.08, 0.13) });
    tufts++;
  }
  return plan;
}

/**
 * Soft shade on the ground under trees, bushes, and rocks, baked into the splat map's spare channel.
 * With a block of tiles, only the shade over that block (and a margin) is redone.
 */
export function bakeDecorShade(splat: Splat, plan: DecorPlan, win?: TileWindow): void {
  const { w: W, h: H } = splat;
  const r = splat.region;
  const ppt = W / r.z;
  const blurR = Math.max(1, Math.round(ppt * 0.15));
  const reach = blurR * 3 + 2;
  // Pixels to write (inner) and to compute (outer, so the blur near the edge comes out right).
  const ix0 = win ? clamp(Math.floor((win.x0 - r.x) * ppt), 0, W) : 0;
  const iz0 = win ? clamp(Math.floor((win.z0 - r.y) * ppt), 0, H) : 0;
  const ix1 = win ? clamp(Math.ceil((win.x1 - r.x) * ppt), 0, W) : W;
  const iz1 = win ? clamp(Math.ceil((win.z1 - r.y) * ppt), 0, H) : H;
  const ox0 = win ? Math.max(0, ix0 - reach) : 0;
  const oz0 = win ? Math.max(0, iz0 - reach) : 0;
  const ox1 = win ? Math.min(W, ix1 + reach) : W;
  const oz1 = win ? Math.min(H, iz1 + reach) : H;
  const w = ox1 - ox0;
  const h = oz1 - oz0;
  const shade = new Float32Array(w * h);
  const radius: Partial<Record<DecorKind, number>> = { tree: 0.75 / 0.3, pine: 0.6 / 0.3, twisted: 0.5 / 0.14, bush: 0.32 / 0.26, bushFlower: 0.32 / 0.26, hedge: 0.3 / 0.26, rock: 0.55 / 0.3, log: 0.3 / 0.11, plantTall: 0.22 / 0.12 };
  for (const [kind, k] of Object.entries(radius) as [DecorKind, number][]) {
    for (const p of plan[kind]) {
      const rad = k * p.s * ppt;
      const cx = (p.x - r.x) * ppt - ox0;
      const cz = (p.z - r.y) * ppt - oz0;
      if (cx + rad < 0 || cz + rad < 0 || cx - rad > w || cz - rad > h) continue;
      for (let y = Math.max(0, Math.floor(cz - rad)); y < Math.min(h, Math.ceil(cz + rad)); y++)
        for (let x = Math.max(0, Math.floor(cx - rad)); x < Math.min(w, Math.ceil(cx + rad)); x++)
          if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cz) ** 2 < rad * rad) shade[y * w + x] = 1;
    }
  }
  const blurred = boxBlur(shade, w, h, blurR, 3);
  const data = splat.c.image.data as Uint8Array;
  for (let y = iz0; y < iz1; y++)
    for (let x = ix0; x < ix1; x++) data[(y * W + x) * 4 + 3] = clamp(Math.round(blurred[(y - oz0) * w + (x - ox0)] * 255), 0, 255);
  splat.c.needsUpdate = true;
}

// ------------------------------------------------------------------ instancing

export interface NaturePart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
}

/** Bakes a nature model's node transforms into float geometry, ready to instance. */
export function natureParts(scene: THREE.Object3D, tint: string | null): NaturePart[] {
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene);
  const parts: NaturePart[] = [];
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const g = new THREE.BufferGeometry();
    for (const [name, attr] of Object.entries(mesh.geometry.attributes)) {
      const a = attr as THREE.BufferAttribute;
      const arr = new Float32Array(a.count * a.itemSize);
      for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) arr[i * a.itemSize + c] = a.getComponent(i, c);
      g.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize));
    }
    if (mesh.geometry.index) g.setIndex(mesh.geometry.index.clone());
    g.applyMatrix4(mesh.matrixWorld);
    const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map((m0) => {
      const m = (m0 as THREE.MeshStandardMaterial).clone();
      if (m.alphaTest === 0 && m.transparent) {
        m.transparent = false;
        m.alphaTest = 0.45;
      }
      if (m.alphaTest > 0) m.side = THREE.DoubleSide;
      m.envMapIntensity = 0.5;
      const leafy = /Leaves|Leaf|Grass/.test(m.name);
      if (tint && leafy) m.color = col(tint);
      if (leafy) foliageGradient(m, box.min.y, box.max.y, /Grass/.test(m.name) ? 0.9 : 0.5, 1.08);
      else if (/Bark/.test(m.name)) m.color.multiplyScalar(0.85);
      return m;
    });
    parts.push({ geometry: g, material: mats.length === 1 ? mats[0] : mats });
  });
  return parts;
}

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpQ2 = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();
const XAXIS = new THREE.Vector3(1, 0, 0);

/** One InstancedMesh per model part. vary: per-instance colour variation, for natural-looking groups. */
export function instanceParts(parts: NaturePart[], items: Placement[], { cast = true, vary = 0.1, seed = 1 } = {}): THREE.InstancedMesh[] {
  if (!items.length) return [];
  const rnd = mulberry32(seed);
  const tints = items.map(() => new THREE.Color(1, 1, 1).offsetHSL((rnd() - 0.5) * 0.05, (rnd() - 0.6) * vary, (rnd() - 0.5) * vary * 2));
  return parts.map((p) => {
    const mesh = new THREE.InstancedMesh(p.geometry, p.material, items.length);
    items.forEach((it, i) => {
      tmpP.set(it.x, 0, it.z);
      tmpQ.setFromAxisAngle(UP, it.rot);
      if (it.tilt) tmpQ.multiply(tmpQ2.setFromAxisAngle(XAXIS, it.tilt));
      tmpS.set(it.s, it.s, it.s);
      mesh.setMatrixAt(i, tmpM.compose(tmpP, tmpQ, tmpS));
      mesh.setColorAt(i, tints[i]);
    });
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    return mesh;
  });
}

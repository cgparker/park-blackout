// Exhibit fences in two builds and four states each.
// Standard is galvanised chain-link (the game's "Chain-link"); reinforced is precast concrete with steel and razor wire
// (the game's "Concrete"). Each segment looks intact, dented, badly damaged, or wrecked, from its HP.
// A wrecked segment leaves wreckage behind: a snapped post, crumpled mesh or broken concrete, and dangling wires.
import * as THREE from 'three';
import type { ExhibitKind } from '../config';
import type { Rect } from '../core/grid';
import type { Mats } from './materials';
import { Batch, hash2, UP, V3 } from './util';

export interface FenceSegmentView {
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  corner: boolean;
  nx: number;
  ny: number;
}

export interface FenceExhibitView {
  id: number;
  kind: ExhibitKind;
  footprint: Rect;
  segments: readonly FenceSegmentView[];
  reinforced: boolean;
}

/** 0 intact, 1 dented, 2 badly damaged, 3 wrecked. */
export function segmentState(s: FenceSegmentView): 0 | 1 | 2 | 3 {
  if (s.hp <= 0) return 3;
  const f = s.hp / s.maxHp;
  return f > 0.66 ? 0 : f > 0.33 ? 1 : 2;
}

/** Changes whenever the fence should look different, so it is only rebuilt then. */
export function fenceSignature(ex: FenceExhibitView, power: boolean): string {
  return `${ex.kind}|${ex.reinforced ? 1 : 0}|${power ? 1 : 0}|${ex.segments.map(segmentState).join('')}`;
}

const HEIGHT: Record<ExhibitKind, { chain: number; concrete: number }> = {
  pasture: { chain: 0.5, concrete: 0.62 },
  raptor: { chain: 0.78, concrete: 0.94 },
  trex: { chain: 1.0, concrete: 1.16 },
};

interface Post {
  s: FenceSegmentView;
  state: 0 | 1 | 2 | 3;
  /** Outward direction. */
  out: THREE.Vector3;
  q: THREE.Quaternion;
  base: THREE.Vector3;
  /** A point on the post at height y, after any lean. */
  at(y: number): THREE.Vector3;
  rnd: (k: number) => number;
}

export interface FenceBuild {
  group: THREE.Group;
  /** Ends of live wires that snapped, for sparks. */
  sparks: THREE.Vector3[];
}

export function buildFence(ex: FenceExhibitView, power: boolean, M: Mats, scuff: THREE.Material): FenceBuild {
  const B = new Batch();
  const sparks: THREE.Vector3[] = [];
  const fp = ex.footprint;
  const x0 = fp.x + 0.5;
  const z0 = fp.y + 0.5;
  const concrete = ex.reinforced;
  const H = concrete ? HEIGHT[ex.kind].concrete : HEIGHT[ex.kind].chain;
  const wire = power ? M.wireLive : M.wireDead;
  const led = power ? M.ledLive : M.ledDead;

  const posts: Post[] = ex.segments.map((s) => {
    const state = segmentState(s);
    let ox = s.nx;
    let oz = s.ny;
    if (s.corner) {
      ox = s.x + 0.5 <= x0 ? -1 : 1;
      oz = s.y + 0.5 <= z0 ? -1 : 1;
    }
    const out = V3(ox, 0, oz).normalize();
    const rnd = (k: number) => hash2(s.x, s.y, k);
    const lean = state === 1 ? 0.08 + rnd(1) * 0.08 : state === 2 ? 0.22 + rnd(2) * 0.12 : 0;
    const axis = V3(out.z, 0, -out.x).normalize();
    const q = new THREE.Quaternion().setFromAxisAngle(axis.lengthSq() ? axis : V3(1, 0, 0), lean);
    const base = V3(s.x + 0.5, 0, s.y + 0.5);
    return { s, state, out, q, base, rnd, at: (y: number) => V3(0, y, 0).applyQuaternion(q).add(base) };
  });
  const n = posts.length;

  // ------------------------------------------------ posts
  for (const p of posts) {
    const m = new THREE.Matrix4().compose(p.base, p.q, V3(1, 1, 1));
    const up = (y: number) => new THREE.Matrix4().multiplyMatrices(m, new THREE.Matrix4().makeTranslation(0, y, 0));
    if (p.state === 3) {
      wreckPost(B, M, p, H, concrete);
      continue;
    }
    if (!concrete) {
      B.add(new THREE.CylinderGeometry(0.022, 0.025, H + 0.06, 10), M.galv, up((H + 0.06) / 2));
      B.add(new THREE.SphereGeometry(0.03, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), M.galv, up(H + 0.06));
      B.add(new THREE.CylinderGeometry(0.045, 0.05, 0.05, 10), M.concreteDark, up(0.02));
      for (const y of wireHeights(ex.kind, H, false)) B.add(new THREE.CylinderGeometry(0.011, 0.011, 0.03, 6), M.insulator, up(y));
      B.add(new THREE.SphereGeometry(0.013, 8, 6), led, up(H + 0.1));
    } else {
      const cracked = p.state > 0;
      B.add(new THREE.BoxGeometry(0.16, H, 0.16), cracked ? M.concreteCracked : M.concrete, up(H / 2));
      B.add(new THREE.BoxGeometry(0.2, 0.05, 0.2), M.concreteDark, up(H + 0.025));
      B.add(new THREE.BoxGeometry(0.166, 0.09, 0.166), M.hazard, up(0.06));
      if (p.state === 2) {
        // A bite out of one corner of the pillar, with rebar showing.
        const chunk = new THREE.BoxGeometry(0.07, 0.16, 0.07);
        B.add(chunk, M.concreteDark, new THREE.Matrix4().multiplyMatrices(up(H * 0.62), new THREE.Matrix4().makeTranslation(0.07, 0, 0.07)));
        for (const k of [0, 1]) B.rod(p.at(H * 0.55).add(V3(0.05 - k * 0.03, 0, 0.06)), p.at(H * 0.72).add(V3(0.08 - k * 0.02, 0.02, 0.09)), 0.006, M.rebar, 4);
      }
      for (const y of wireHeights(ex.kind, H, true)) B.add(new THREE.CylinderGeometry(0.012, 0.012, 0.03, 6), M.insulator, up(y).multiply(new THREE.Matrix4().makeTranslation(0, 0, 0)));
      B.add(new THREE.SphereGeometry(0.018, 8, 6), led, up(H + 0.07));
    }
  }

  // ------------------------------------------------ spans
  for (let i = 0; i < n; i++) {
    const a = posts[i];
    const b = posts[(i + 1) % n];
    const state = Math.max(a.state, b.state) as 0 | 1 | 2 | 3;
    const dir = b.base.clone().sub(a.base);
    const len = dir.length();
    dir.normalize();
    const out = a.out.clone().add(b.out).normalize();
    if (!out.lengthSq()) out.set(-dir.z, 0, dir.x);
    if (state === 3) {
      wreckSpan(B, M, a, b, H, concrete, ex.kind, wire, power, sparks, scuff);
      continue;
    }
    if (!concrete) chainSpan(B, M, a, b, len, dir, out, H, state, ex.kind, wire, power, sparks);
    else concreteSpan(B, M, a, b, len, dir, out, H, state, ex.kind, wire, power, sparks);
  }

  const group = new THREE.Group();
  B.flush(group);
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.material === scuff) {
      m.castShadow = false;
      m.renderOrder = 1;
    }
  });
  return { group, sparks };
}

function wireHeights(kind: ExhibitKind, H: number, concrete: boolean): number[] {
  if (concrete) return kind === 'pasture' ? [H - 0.08] : [H - 0.1, H - 0.02];
  const top = H * 0.82;
  return kind === 'trex' ? [top + 0.04, top + 0.1, top + 0.16] : [top + 0.05, top + 0.12];
}

// ------------------------------------------------ chain-link

function chainSpan(B: Batch, M: Mats, a: Post, b: Post, len: number, dir: THREE.Vector3, out: THREE.Vector3, H: number, state: number, kind: ExhibitKind, wire: THREE.Material, power: boolean, sparks: THREE.Vector3[]): void {
  const top = H * 0.82;
  const mid = a.base.clone().add(b.base).multiplyScalar(0.5);
  const ang = Math.atan2(dir.z, dir.x);
  const rot = new THREE.Quaternion().setFromAxisAngle(UP, -ang);
  const r = (k: number) => hash2(a.s.x * 3 + b.s.x, a.s.y * 3 + b.s.y, k);
  if (state === 0 || state === 1) {
    // Mesh panel; dented panels bulge outward in the middle.
    const g = new THREE.PlaneGeometry(len, top - 0.02, 6, 4);
    const pos = g.attributes.position;
    const uv = g.attributes.uv;
    for (let k = 0; k < pos.count; k++) {
      uv.setXY(k, uv.getX(k) * len * 10, uv.getY(k) * top * 10);
      if (state === 1) {
        const u = pos.getX(k) / len + 0.5;
        const v = pos.getY(k) / top + 0.5;
        pos.setZ(k, Math.sin(u * Math.PI) * Math.sin(v * Math.PI) * (0.08 + r(1) * 0.05));
      }
    }
    const lean = a.at(top).add(b.at(top)).multiplyScalar(0.5).sub(mid).setY(0);
    const m = new THREE.Matrix4().compose(mid.clone().add(lean.multiplyScalar(0.5)).setY(0.02 + (top - 0.02) / 2), rot, V3(1, 1, 1));
    if (out.dot(V3(0, 0, 1).applyQuaternion(rot)) < 0) m.multiply(new THREE.Matrix4().makeRotationY(Math.PI));
    B.add(g, M.chain, m);
    B.rod(a.at(top), b.at(top), 0.012, M.galv);
    B.rod(a.at(0.03), b.at(0.03), 0.006, M.galv, 4);
    for (const y of wireHeights(kind, H, false)) {
      const pa = a.at(y);
      const pb = b.at(y);
      const sag = state === 1 ? 0.06 : 0.015;
      const m2 = pa.clone().add(pb).multiplyScalar(0.5);
      m2.y -= sag;
      B.tube([pa, m2, pb], 0.006, wire, 8);
    }
    if (kind === 'raptor') {
      // Barbed outrigger leaning out over the top.
      for (const p of [a, b]) B.rod(p.at(H + 0.02), p.at(H + 0.02).add(out.clone().multiplyScalar(0.12)).add(V3(0, 0.1, 0)), 0.008, M.galv, 4);
      B.rod(a.at(H + 0.02).add(out.clone().multiplyScalar(0.12)).add(V3(0, 0.1, 0)), b.at(H + 0.02).add(out.clone().multiplyScalar(0.12)).add(V3(0, 0.1, 0)), 0.005, wire, 4);
    }
    return;
  }
  // Badly damaged: the lower mesh hangs on, the top is torn and folded over, one wire has snapped.
  const low = top * (0.45 + r(2) * 0.2);
  const g = new THREE.PlaneGeometry(len, low, 6, 3);
  const pos = g.attributes.position;
  const uv = g.attributes.uv;
  for (let k = 0; k < pos.count; k++) {
    uv.setXY(k, uv.getX(k) * len * 10, uv.getY(k) * low * 10);
    const v = pos.getY(k) / low + 0.5;
    pos.setZ(k, v * v * (0.12 + r(3) * 0.08) + Math.sin(pos.getX(k) * 9) * 0.015);
    if (v > 0.99) pos.setY(k, pos.getY(k) - Math.abs(Math.sin(pos.getX(k) * 13)) * 0.06);
  }
  const m = new THREE.Matrix4().compose(mid.clone().setY(0.02 + low / 2), rot, V3(1, 1, 1));
  if (out.dot(V3(0, 0, 1).applyQuaternion(rot)) < 0) m.multiply(new THREE.Matrix4().makeRotationY(Math.PI));
  B.add(g, M.chainTorn, m);
  // Torn flap folded outward.
  const flap = new THREE.PlaneGeometry(len * 0.6, top - low, 3, 2);
  const fm = new THREE.Matrix4().compose(mid.clone().add(out.clone().multiplyScalar(0.12)).setY(low + 0.03), new THREE.Quaternion().setFromEuler(new THREE.Euler(-1.0, -ang, 0.3, 'YXZ')), V3(1, 1, 1));
  B.add(flap, M.chainTorn, fm);
  const ys = wireHeights(kind, H, false);
  ys.forEach((y, k) => {
    const pa = a.at(y);
    const pb = b.at(y);
    if (k === 0) {
      const m2 = pa.clone().add(pb).multiplyScalar(0.5);
      m2.y -= 0.12;
      B.tube([pa, m2, pb], 0.006, wire, 8);
    } else {
      dangle(B, pa, pb, 0.45, 0.006, wire, power, sparks);
      dangle(B, pb, pa, 0.35, 0.006, wire, power, sparks);
    }
  });
}

// ------------------------------------------------ concrete

function concreteSpan(B: Batch, M: Mats, a: Post, b: Post, len: number, dir: THREE.Vector3, out: THREE.Vector3, H: number, state: number, kind: ExhibitKind, wire: THREE.Material, power: boolean, sparks: THREE.Vector3[]): void {
  const wall = H * 0.56;
  const mid = a.base.clone().add(b.base).multiplyScalar(0.5);
  const ang = Math.atan2(dir.z, dir.x);
  const span = len - 0.16;
  const mat = state > 0 ? M.concreteCracked : M.concrete;
  const r = (k: number) => hash2(a.s.x * 5 + b.s.x, a.s.y * 5 + b.s.y, k);
  if (state < 2) {
    B.box(span, wall, 0.08, mat, mid.x, wall / 2, mid.z, -ang);
    B.box(span, 0.03, 0.1, M.concreteDark, mid.x, wall + 0.015, mid.z, -ang);
  } else {
    // A hole bitten out of the top of the panel; chunks lie below it.
    const hole = 0.25 + r(1) * 0.2;
    const left = (span - hole) * 0.5;
    const along = (t: number) => mid.clone().add(dir.clone().multiplyScalar(t));
    const pl = along(-span / 2 + left / 2);
    const pr = along(span / 2 - left / 2);
    B.box(left, wall, 0.08, mat, pl.x, wall / 2, pl.z, -ang);
    B.box(left, wall * (0.7 + r(2) * 0.2), 0.08, mat, pr.x, (wall * (0.7 + r(2) * 0.2)) / 2, pr.z, -ang);
    B.box(hole, wall * 0.35, 0.08, mat, mid.x, wall * 0.175, mid.z, -ang);
    for (let k = 0; k < 4; k++) {
      const p = mid.clone().add(out.clone().multiplyScalar(0.12 + r(10 + k) * 0.18)).add(dir.clone().multiplyScalar((r(20 + k) - 0.5) * 0.4));
      const s = 0.04 + r(30 + k) * 0.05;
      B.box(s, s * 0.7, s * 1.2, M.concreteDark, p.x, s * 0.3, p.z, r(40 + k) * 6, r(50 + k), r(60 + k));
    }
    for (let k = 0; k < 3; k++) {
      const p = mid.clone().add(dir.clone().multiplyScalar((k - 1) * 0.08));
      B.rod(p.clone().setY(wall * 0.35), p.clone().add(out.clone().multiplyScalar(0.05)).setY(wall * 0.62), 0.006, M.rebar, 4);
    }
  }
  // Steel bars above the wall.
  const bars = kind === 'pasture' ? [wall + 0.08] : [wall + 0.1, wall + 0.2, wall + 0.3].filter((y) => y < H - 0.12);
  for (const y of bars) {
    if (state === 2 && y > wall + 0.15) {
      const pa = a.at(y);
      const pb = b.at(y);
      const m2 = pa.clone().add(pb).multiplyScalar(0.5).add(out.clone().multiplyScalar(0.12));
      m2.y -= 0.1;
      B.tube([pa, m2, pb], 0.013, M.steel, 8);
    } else B.rod(a.at(y), b.at(y), 0.013, M.steel, 8);
  }
  wireHeights(kind, H, true).forEach((y, k) => {
    const pa = a.at(y);
    const pb = b.at(y);
    if (state === 2 && k === 0) {
      dangle(B, pa, pb, 0.5, 0.007, wire, power, sparks);
      return;
    }
    const m2 = pa.clone().add(pb).multiplyScalar(0.5);
    m2.y -= 0.015;
    B.tube([pa, m2, pb], 0.007, wire, 8);
  });
  if (kind !== 'pasture' && state < 2) razorWire(B, M, a.at(H + 0.08), b.at(H + 0.08), 0.06);
}

/** A coil of razor wire along the top of a reinforced fence. */
function razorWire(B: Batch, M: Mats, from: THREE.Vector3, to: THREE.Vector3, r: number): void {
  const dir = to.clone().sub(from);
  const len = dir.length();
  dir.normalize();
  const side = V3(-dir.z, 0, dir.x);
  const pts: THREE.Vector3[] = [];
  const turns = Math.round(len * 9);
  for (let i = 0; i <= turns * 8; i++) {
    const t = i / (turns * 8);
    const a = t * turns * Math.PI * 2;
    pts.push(from.clone().add(dir.clone().multiplyScalar(t * len)).add(side.clone().multiplyScalar(Math.cos(a) * r)).add(V3(0, Math.sin(a) * r, 0)));
  }
  B.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), turns * 8, 0.004, 3, false), M.razor);
}

/** A snapped wire: from its post, curving down to lie on the ground. Live wires spark at the end. */
function dangle(B: Batch, from: THREE.Vector3, toward: THREE.Vector3, reach: number, r: number, mat: THREE.Material, power: boolean, sparks: THREE.Vector3[]): void {
  const d = toward.clone().sub(from).setY(0);
  const L = d.length() * reach;
  d.normalize();
  const end = from.clone().add(d.clone().multiplyScalar(L)).setY(0.01);
  const midp = from.clone().add(d.clone().multiplyScalar(L * 0.45));
  midp.y = from.y * 0.35;
  B.tube([from, midp, end], r, mat, 10);
  if (power) sparks.push(end);
}

// ------------------------------------------------ wreckage

function wreckPost(B: Batch, M: Mats, p: Post, H: number, concrete: boolean): void {
  const r = p.rnd;
  const out = p.out;
  const side = V3(-out.z, 0, out.x).multiplyScalar(r(3) - 0.5);
  const fall = out.clone().add(side).normalize();
  if (!concrete) {
    // Bent at a third of its height, the top folded over toward the outside.
    const kneeH = H * (0.22 + r(4) * 0.15);
    const knee = p.base.clone().setY(kneeH);
    B.rod(p.base, knee, 0.024, M.galv, 10);
    const tip = knee.clone().add(fall.clone().multiplyScalar(H * 0.75)).setY(0.04 + r(5) * 0.05);
    B.rod(knee, tip, 0.022, M.galv, 10);
    B.add(new THREE.CylinderGeometry(0.045, 0.05, 0.05, 10), M.concreteDark, new THREE.Matrix4().makeTranslation(p.base.x, 0.02, p.base.z));
    return;
  }
  // Snapped pillar: a jagged stump, the top lying where it fell, rebar sticking out.
  const stump = H * (0.28 + r(4) * 0.12);
  B.box(0.16, stump, 0.16, M.concreteCracked, p.base.x, stump / 2, p.base.z, r(6) * 0.3);
  B.box(0.166, 0.09, 0.166, M.hazard, p.base.x, 0.06, p.base.z, r(6) * 0.3);
  const topLen = H - stump;
  const c = p.base.clone().add(fall.clone().multiplyScalar(0.12 + topLen / 2));
  const ang = Math.atan2(fall.z, fall.x);
  B.box(0.16, 0.16, topLen, M.concreteCracked, c.x, 0.08, c.z, Math.PI / 2 - ang, 0.08, r(7) * 0.2);
  for (let k = 0; k < 4; k++) {
    const o = V3((k % 2) - 0.5, 0, Math.floor(k / 2) - 0.5).multiplyScalar(0.09);
    const a = p.base.clone().add(o).setY(stump);
    const b = a.clone().add(fall.clone().multiplyScalar(0.06 + r(8 + k) * 0.06)).add(V3(0, 0.08 + r(12 + k) * 0.08, 0));
    B.rod(a, b, 0.006, M.rebar, 4);
  }
  for (let k = 0; k < 3; k++) {
    const q = p.base.clone().add(fall.clone().multiplyScalar(0.15 + r(20 + k) * 0.3)).add(V3((r(24 + k) - 0.5) * 0.2, 0, (r(28 + k) - 0.5) * 0.2));
    const s = 0.03 + r(32 + k) * 0.04;
    B.box(s, s * 0.8, s, M.concreteDark, q.x, s * 0.4, q.z, r(36 + k) * 6, r(40 + k), r(44 + k));
  }
}

function wreckSpan(B: Batch, M: Mats, a: Post, b: Post, H: number, concrete: boolean, kind: ExhibitKind, wire: THREE.Material, power: boolean, sparks: THREE.Vector3[], scuff: THREE.Material): void {
  const mid = a.base.clone().add(b.base).multiplyScalar(0.5);
  const dir = b.base.clone().sub(a.base);
  const len = dir.length();
  dir.normalize();
  const out = a.out.clone().add(b.out).normalize();
  if (!out.lengthSq()) out.set(-dir.z, 0, dir.x);
  const r = (k: number) => hash2(a.s.x * 7 + b.s.x, a.s.y * 7 + b.s.y, k);
  const ang = Math.atan2(dir.z, dir.x);
  // Scuffed, churned ground where it came down.
  const sg = new THREE.PlaneGeometry(len * 1.3, 0.9);
  sg.rotateX(-Math.PI / 2);
  B.add(sg, scuff, new THREE.Matrix4().compose(mid.clone().add(out.clone().multiplyScalar(0.2)).setY(0.012), new THREE.Quaternion().setFromAxisAngle(UP, -ang), V3(1, 1, 1)));
  if (!concrete) {
    // Crumpled mesh flattened onto the ground, outside the pen.
    const top = H * 0.82;
    const g = new THREE.PlaneGeometry(len * 0.95, top * 0.9, 8, 5);
    const pos = g.attributes.position;
    const uv = g.attributes.uv;
    for (let k = 0; k < pos.count; k++) {
      uv.setXY(k, uv.getX(k) * len * 10, uv.getY(k) * top * 9);
      pos.setZ(k, (hash2(k, a.s.x + b.s.y, 3) - 0.5) * 0.08 + Math.sin(pos.getX(k) * 7 + r(4) * 6) * 0.03);
    }
    const m = new THREE.Matrix4().compose(
      mid.clone().add(out.clone().multiplyScalar(0.18 + r(5) * 0.12)).setY(0.05),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2 + (r(6) - 0.5) * 0.25, -ang, (r(7) - 0.5) * 0.3, 'YXZ')),
      V3(1, 1, 1),
    );
    B.add(g, M.chainTorn, m);
    for (const p of [a, b]) if (p.state < 3) for (const y of wireHeights(kind, H, false)) dangle(B, p.at(y), mid, 0.8 + r(8) * 0.4, 0.006, wire, power, sparks);
    return;
  }
  // Shattered panel: slabs and rubble thrown outward, cables down.
  const wall = H * 0.56;
  for (let k = 0; k < 6; k++) {
    const p = mid.clone().add(out.clone().multiplyScalar(0.1 + r(10 + k) * 0.35)).add(dir.clone().multiplyScalar((r(20 + k) - 0.5) * len * 0.8));
    const big = k < 2;
    const sx = big ? 0.22 + r(30 + k) * 0.15 : 0.05 + r(30 + k) * 0.07;
    const sy = big ? 0.06 : sx * 0.7;
    const sz = big ? wall * (0.4 + r(40 + k) * 0.2) : sx * 1.1;
    B.box(sx, sy, sz, big ? M.concreteCracked : M.concreteDark, p.x, sy / 2 + (big ? 0.02 : 0), p.z, -ang + (r(50 + k) - 0.5) * 1.2, big ? 0.15 : r(60 + k), (r(70 + k) - 0.5) * 0.4);
  }
  for (let k = 0; k < 5; k++) {
    const p = mid.clone().add(dir.clone().multiplyScalar((k / 4 - 0.5) * len * 0.7));
    const bend = out.clone().multiplyScalar(0.06 + r(80 + k) * 0.1);
    B.tube([p.clone().setY(0.0), p.clone().setY(0.1), p.clone().add(bend).setY(0.16 + r(90 + k) * 0.08)], 0.006, M.rebar, 6);
  }
  for (const p of [a, b]) {
    if (p.state === 3) continue;
    for (const y of [wall + 0.1, wall + 0.2]) if (y < H - 0.1) dangle(B, p.at(y), mid, 0.9, 0.013, M.steel, false, sparks);
    for (const y of wireHeights(kind, H, true)) dangle(B, p.at(y), mid, 0.7 + r(9) * 0.3, 0.007, wire, power, sparks);
  }
}

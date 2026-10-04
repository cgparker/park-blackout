// Built things: the security HQ, Tranq Towers, the park gate, viewing decks, path lamps, and the raptor nest.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Tile, type Point, type Rect, type TileType } from '../core/grid';
import { fenceRect } from './terrain';
import type { Mats } from './materials';
import { Batch, mulberry32, V3 } from './util';

const rbox = (w: number, h: number, d: number, r = 0.015) => new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2, h / 2, d / 2));

// ------------------------------------------------------------------ HQ

export interface HqBuild {
  group: THREE.Group;
  /** Floodlight heads, for night lights: position and aim point. */
  floods: { from: THREE.Vector3; to: THREE.Vector3 }[];
  radar: THREE.Object3D;
}

/**
 * Park security HQ: a two-storey command block in blue-grey concrete with a glass control cab and radar,
 * dishes, an antenna mast, a flag, crash barriers, floodlights, and a patrol car. No rooftop H (that read as a hospital).
 */
export function buildHQ(hq: Rect, M: Mats): HqBuild {
  const B = new Batch();
  const g = new THREE.Group();
  const cx = hq.x + hq.w / 2;
  const cz = hq.y + hq.h / 2;
  const W = 2.7;
  const D = 2.5;
  const H1 = 0.8;
  // Concrete plinth, a darker base course, then the block.
  B.add(rbox(W + 0.1, 0.06, D + 0.1, 0.02), M.concreteDark, B.at(cx, 0.03, cz));
  B.add(rbox(W + 0.02, 0.12, D + 0.02, 0.02), M.hqBase, B.at(cx, 0.12, cz));
  B.add(rbox(W, H1 - 0.12, D, 0.03), M.hqWall, B.at(cx, 0.18 + (H1 - 0.12) / 2, cz));
  // Two floors of dark windows, recessed between concrete fins.
  const band = (bw: number, y: number, x: number, z: number, ry: number) => B.add(new THREE.BoxGeometry(bw, 0.15, 0.02), M.windows, B.at(x, y, z, ry));
  for (const y of [0.32, 0.6]) {
    band(W * 0.86, y, cx, cz + D / 2 + 0.006, 0);
    band(W * 0.86, y, cx, cz - D / 2 - 0.006, Math.PI);
    band(D * 0.82, y, cx + W / 2 + 0.006, cz, Math.PI / 2);
    band(D * 0.82, y, cx - W / 2 - 0.006, cz, -Math.PI / 2);
  }
  for (let i = 0; i <= 6; i++) {
    const fx = cx - W * 0.43 + (i / 6) * W * 0.86;
    B.add(new THREE.BoxGeometry(0.04, 0.5, 0.05), M.hqBase, B.at(fx, 0.46, cz + D / 2 + 0.02));
    B.add(new THREE.BoxGeometry(0.04, 0.5, 0.05), M.hqBase, B.at(fx, 0.46, cz - D / 2 - 0.02));
  }
  const top = 0.06 + H1;
  // Team stripe under a heavy parapet, then the roof deck.
  B.add(new THREE.BoxGeometry(W + 0.03, 0.06, D + 0.03), M.team, B.at(cx, top - 0.07, cz));
  for (const [w, d, x, z] of [[W + 0.04, 0.09, cx, cz - D / 2 + 0.03], [W + 0.04, 0.09, cx, cz + D / 2 - 0.03], [0.09, D, cx - W / 2 + 0.03, cz], [0.09, D, cx + W / 2 - 0.03, cz]] as const) {
    B.add(rbox(w, 0.09, d, 0.012), M.hqBase, B.at(x, top + 0.025, z));
  }
  B.add(new THREE.BoxGeometry(W - 0.14, 0.015, D - 0.14), M.concreteDark, B.at(cx, top - 0.01, cz));
  // Security emblem on the roof, where the camera sees it.
  const em = new THREE.PlaneGeometry(0.95, 0.95);
  em.rotateX(-Math.PI / 2);
  B.add(em, M.emblem, B.at(cx + 0.55, top + 0.005, cz + 0.5));
  // Control cab: an eight-sided glass room on a short tower, radar on top.
  const kx = cx - 0.6;
  const kz = cz - 0.55;
  B.add(rbox(1.0, 0.36, 0.95, 0.03), M.hqWall, B.at(kx, top + 0.18, kz));
  B.add(new THREE.CylinderGeometry(0.62, 0.5, 0.26, 8), M.glass, B.at(kx, top + 0.49, kz, Math.PI / 8));
  B.add(new THREE.CylinderGeometry(0.66, 0.66, 0.05, 8), M.hqBase, B.at(kx, top + 0.645, kz, Math.PI / 8));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 4;
    B.add(new THREE.BoxGeometry(0.03, 0.27, 0.03), M.darkSteel, B.at(kx + Math.cos(a) * 0.56, top + 0.49, kz + Math.sin(a) * 0.56, -a, 0, 0));
  }
  B.add(new THREE.CylinderGeometry(0.14, 0.16, 0.12, 16), M.greyPlate, B.at(kx, top + 0.73, kz));
  B.add(new THREE.SphereGeometry(0.24, 24, 16), M.facade, B.at(kx, top + 0.92, kz));
  // Roof plant and a big dish aimed at the sky.
  for (const dz of [-0.85, -0.45]) {
    B.add(rbox(0.32, 0.16, 0.26, 0.02), M.greyPlate, B.at(cx + 0.95, top + 0.09, cz + dz));
    B.add(new THREE.CylinderGeometry(0.085, 0.085, 0.02, 16), M.darkSteel, B.at(cx + 0.95, top + 0.18, cz + dz));
  }
  B.add(rbox(0.2, 0.08, 0.2, 0.01), M.greyPlate, B.at(cx - 0.95, top + 0.04, cz + 0.85));
  B.add(new THREE.SphereGeometry(0.26, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2.6), M.steel, B.at(cx + 0.15, top + 0.3, cz + 0.98, 0.5, -2.1));
  B.cyl(0.022, 0.03, 0.26, M.darkSteel, cx + 0.15, top + 0.13, cz + 0.98, 8);
  B.add(new THREE.SphereGeometry(0.12, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2.6), M.steel, B.at(cx - 1.0, top + 0.17, cz + 0.2, -0.9, -2.3));
  B.cyl(0.012, 0.012, 0.13, M.darkSteel, cx - 1.0, top + 0.07, cz + 0.2, 6);
  // Lattice antenna mast with a red beacon.
  const mx = cx + 1.1;
  const mz = cz + 1.0;
  const mh = 1.25;
  const legs = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [a * 0.05, b * 0.05]);
  for (const [a, b] of legs) B.rod(V3(mx + a, top, mz + b), V3(mx + a * 0.4, top + mh, mz + b * 0.4), 0.008, M.steel, 4);
  for (let k = 0; k < 6; k++) {
    const y0 = top + (k / 6) * mh;
    const y1 = top + ((k + 1) / 6) * mh;
    const s0 = 1 - (0.6 * k) / 6;
    const s1 = 1 - (0.6 * (k + 1)) / 6;
    for (let i = 0; i < 4; i++) {
      const [a, b] = legs[i];
      const [c, d] = legs[(i + 1) % 4];
      B.rod(V3(mx + a * s0, y0, mz + b * s0), V3(mx + c * s1, y1, mz + d * s1), 0.004, M.steel, 3);
    }
  }
  B.add(new THREE.SphereGeometry(0.03, 10, 8), M.beacon, B.at(mx, top + mh + 0.03, mz));
  // Entrance on the north side, toward the path: a canopy over glass doors.
  B.add(rbox(0.9, 0.05, 0.38, 0.01), M.hqBase, B.at(cx - 0.4, 0.44, cz - D / 2 - 0.19));
  B.add(new THREE.BoxGeometry(0.9, 0.02, 0.02), M.team, B.at(cx - 0.4, 0.42, cz - D / 2 - 0.38));
  B.add(new THREE.BoxGeometry(0.5, 0.3, 0.02), M.glass, B.at(cx - 0.4, 0.27, cz - D / 2 - 0.01));
  for (const dx of [-0.8, 0]) B.cyl(0.016, 0.016, 0.38, M.steel, cx + dx, 0.23, cz - D / 2 - 0.34, 6);
  // Sign panel on the south face, toward the camera: a plain plate with the lettering on its face only.
  B.add(rbox(1.0, 0.18, 0.025, 0.006), M.darkSteel, B.at(cx + 0.35, 0.82, cz + D / 2 + 0.028));
  const signFace = new THREE.PlaneGeometry(0.96, 0.15);
  B.add(signFace, M.sign, B.at(cx + 0.35, 0.82, cz + D / 2 + 0.042));
  // Vehicle bay on the east side.
  B.add(new THREE.BoxGeometry(0.02, 0.34, 0.7), M.steel, B.at(cx + W / 2 + 0.012, 0.29, cz + 0.4));
  for (let i = 0; i < 7; i++) B.add(new THREE.BoxGeometry(0.024, 0.006, 0.7), M.darkSteel, B.at(cx + W / 2 + 0.016, 0.15 + i * 0.045, cz + 0.4));
  B.add(new THREE.BoxGeometry(0.03, 0.04, 0.78), M.hazard, B.at(cx + W / 2 + 0.02, 0.48, cz + 0.4));
  // Flag on a pole by the entrance: the security shield on team blue.
  const fpx = cx - 1.15;
  const fpz = cz - D / 2 - 0.45;
  B.cyl(0.012, 0.016, 1.35, M.steel, fpx, 0.675, fpz, 8);
  B.add(new THREE.SphereGeometry(0.02, 8, 6), M.steel, B.at(fpx, 1.36, fpz));
  const flag = new THREE.PlaneGeometry(0.5, 0.32, 10, 1);
  const fp = flag.attributes.position;
  for (let i = 0; i < fp.count; i++) {
    const u = (fp.getX(i) + 0.25) / 0.5;
    fp.setZ(i, Math.sin(u * 5.5) * 0.035 * u);
  }
  flag.computeVertexNormals();
  B.add(flag, M.flag, B.at(fpx + 0.26, 1.18, fpz, -0.35));
  // Crash barriers and bollards along the apron.
  for (let i = 0; i < 4; i++) B.add(rbox(0.36, 0.11, 0.09, 0.02), M.barrier, B.at(cx - 1.05 + i * 0.42, 0.055, cz + D / 2 + 0.42));
  for (let i = 0; i < 5; i++) B.cyl(0.025, 0.025, 0.14, M.hazard, cx + W / 2 + 0.2, 0.07, cz - 0.9 + i * 0.22, 8);
  // Floodlight masts at the compound corners.
  const floods: HqBuild['floods'] = [];
  const masts: [number, number, number, number][] = [
    [cx + W / 2 + 0.25, cz - D / 2 - 0.2, 4.5, -3.8],
    [cx - W / 2 - 0.25, cz - D / 2 - 0.2, -3.2, -3.4],
  ];
  for (const [x, z, ax, az] of masts) {
    const h = 1.35;
    B.add(new THREE.CylinderGeometry(0.02, 0.03, h, 8), M.darkSteel, B.at(x, h / 2, z));
    B.add(rbox(0.08, 0.04, 0.08, 0.005), M.concreteDark, B.at(x, 0.02, z));
    B.add(new THREE.BoxGeometry(0.22, 0.02, 0.03), M.darkSteel, B.at(x, h, z, Math.atan2(-az, ax)));
    const aim = V3(cx + ax, 0, cz + az);
    for (const s of [-1, 1]) {
      const head = V3(x, h + 0.04, z).add(V3(-Math.sin(Math.atan2(az, ax)), 0, Math.cos(Math.atan2(az, ax))).multiplyScalar(0.08 * s));
      B.add(rbox(0.07, 0.06, 0.05, 0.008), M.darkSteel, B.at(head.x, head.y, head.z, Math.atan2(-az, ax)));
      floods.push({ from: head, to: aim.clone().add(V3(s * 0.8, 0, 0)) });
    }
  }
  // Patrol car parked by the bay: a white four-by-four with a team stripe and a light bar. Built from
  // simple shapes, like the rest of the compound.
  const carX = cx + W / 2 + 0.55;
  const carZ = cz + 0.4;
  B.add(rbox(0.3, 0.13, 0.62, 0.035), M.carBody, B.at(carX, 0.125, carZ));
  B.add(rbox(0.27, 0.12, 0.38, 0.03), M.carBody, B.at(carX, 0.245, carZ + 0.06));
  B.add(new THREE.BoxGeometry(0.276, 0.075, 0.33), M.glass, B.at(carX, 0.25, carZ + 0.06));
  B.add(new THREE.BoxGeometry(0.255, 0.07, 0.395), M.carBody, B.at(carX, 0.25, carZ + 0.06));
  B.add(new THREE.BoxGeometry(0.304, 0.03, 0.5), M.team, B.at(carX, 0.13, carZ));
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) B.add(new THREE.CylinderGeometry(0.062, 0.062, 0.05, 14).rotateZ(Math.PI / 2), M.rubber, B.at(carX + sx * 0.15, 0.062, carZ + sz * 0.2));
    B.add(new THREE.BoxGeometry(0.06, 0.025, 0.01), M.lampGlass, B.at(carX + sx * 0.09, 0.15, carZ - 0.311));
  }
  B.add(new THREE.BoxGeometry(0.2, 0.02, 0.045), M.darkSteel, B.at(carX, 0.315, carZ + 0.02));
  B.add(new THREE.BoxGeometry(0.08, 0.024, 0.047), M.beacon, B.at(carX - 0.05, 0.33, carZ + 0.02));
  B.add(new THREE.BoxGeometry(0.08, 0.024, 0.047), M.beaconBlue, B.at(carX + 0.05, 0.33, carZ + 0.02));
  B.flush(g);
  // The radar spins in the live game.
  const radar = new THREE.Group();
  const rb = new Batch();
  rb.add(new THREE.BoxGeometry(0.5, 0.06, 0.02), M.greyPlate, rb.at(0, 0, 0.05));
  rb.add(new THREE.BoxGeometry(0.02, 0.06, 0.08), M.darkSteel, rb.at(0, 0, 0));
  rb.flush(radar);
  radar.position.set(kx, top + 1.2, kz);
  g.add(radar);
  return { group: g, floods, radar };
}

// ------------------------------------------------------------------ Tranq Tower

export interface TowerBuild {
  group: THREE.Group;
  /** Turns to face the tower's target. */
  turret: THREE.Group;
  /** Where the searchlight sits on the turret, in turret space. */
  lamp: THREE.Vector3;
  muzzle: THREE.Vector3;
}

/** A steel watchtower with an armoured platform and a twin-barrel dart cannon. */
/** Height of a Tranq Tower's deck, in tiles: well above a troop's head, so nobody seems to stand beside the gun. */
export const TOWER_DECK = 1.25;

export function buildTower(x: number, z: number, M: Mats): TowerBuild {
  const B = new Batch();
  const g = new THREE.Group();
  const h = TOWER_DECK;
  const legs: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const foot = 0.34;
  const head = 0.22;
  for (const [sx, sz] of legs) {
    B.add(rbox(0.12, 0.07, 0.12, 0.01), M.concreteDark, B.at(x + sx * foot, 0.035, z + sz * foot));
    B.beam(V3(x + sx * foot, 0.05, z + sz * foot), V3(x + sx * head, h, z + sz * head), 0.04, M.greyPlate);
    for (let k = 0; k < 4; k++) B.add(new THREE.CylinderGeometry(0.008, 0.008, 0.02, 6), M.darkSteel, B.at(x + sx * foot + (k % 2 ? 0.04 : -0.04), 0.075, z + sz * foot + (k > 1 ? 0.04 : -0.04)));
  }
  // X-bracing on every side, three levels.
  const legAt = (i: number, y: number) => {
    const [sx, sz] = legs[i];
    const s = foot + ((head - foot) * (y - 0.05)) / (h - 0.05);
    return V3(x + sx * s, y, z + sz * s);
  };
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    const lv = [0.08, 0.08 + (h - 0.12) / 3, 0.08 + ((h - 0.12) * 2) / 3, h - 0.04];
    for (let k = 0; k < 3; k++) {
      B.beam(legAt(i, lv[k]), legAt(j, lv[k + 1]), 0.016, M.steel);
      B.beam(legAt(j, lv[k]), legAt(i, lv[k + 1]), 0.016, M.steel);
      if (k > 0) B.beam(legAt(i, lv[k]), legAt(j, lv[k]), 0.02, M.greyPlate);
    }
  }
  // Grated deck with a team-blue edge.
  B.add(rbox(0.68, 0.05, 0.68, 0.01), M.grating, B.at(x, h, z));
  for (const [w, d, ox, oz] of [[0.7, 0.03, 0, -0.34], [0.7, 0.03, 0, 0.34], [0.03, 0.7, -0.34, 0], [0.03, 0.7, 0.34, 0]] as const) B.add(new THREE.BoxGeometry(w, 0.06, d), M.teamPlate, B.at(x + ox, h - 0.005, z + oz));
  // Armoured parapet on three sides, hazard-striped top; the ladder side has a rail.
  const wallH = 0.17;
  for (const [w, d, ox, oz] of [[0.66, 0.025, 0, -0.32], [0.025, 0.66, -0.32, 0], [0.025, 0.66, 0.32, 0]] as const) {
    B.add(rbox(w, wallH, d, 0.006), M.greyPlate, B.at(x + ox, h + 0.025 + wallH / 2, z + oz));
    B.add(new THREE.BoxGeometry(w + 0.005, 0.025, d + 0.005), M.hazard, B.at(x + ox, h + 0.025 + wallH, z + oz));
  }
  B.rod(V3(x - 0.32, h + 0.18, z + 0.32), V3(x - 0.08, h + 0.18, z + 0.32), 0.008, M.steel, 6);
  B.rod(V3(x + 0.08, h + 0.18, z + 0.32), V3(x + 0.32, h + 0.18, z + 0.32), 0.008, M.steel, 6);
  for (const ox of [-0.32, -0.08, 0.08, 0.32]) B.rod(V3(x + ox, h, z + 0.32), V3(x + ox, h + 0.18, z + 0.32), 0.007, M.steel, 6);
  // Sandbags along the inside of the north wall.
  for (let i = 0; i < 4; i++) B.add(rbox(0.13, 0.05, 0.07, 0.025), M.sandbag, B.at(x - 0.21 + i * 0.14, h + 0.05, z - 0.26, (i % 2) * 0.1));
  // Ladder with a safety cage on the south side.
  for (const ox of [-0.06, 0.06]) B.rod(V3(x + ox, 0, z + 0.37), V3(x + ox, h + 0.18, z + 0.33), 0.007, M.steel, 6);
  const rungs = Math.floor(h / 0.09);
  for (let i = 1; i <= rungs; i++) B.rod(V3(x - 0.06, i * 0.09, z + 0.37 - (i * 0.04) / rungs), V3(x + 0.06, i * 0.09, z + 0.37 - (i * 0.04) / rungs), 0.005, M.steel, 4);
  for (let y = 0.35; y <= h + 0.01; y += 0.15) {
    const hoop = new THREE.TorusGeometry(0.09, 0.005, 4, 16, Math.PI);
    B.add(hoop, M.steel, B.at(x, y, z + 0.37, 0, Math.PI / 2));
  }
  B.flush(g);

  // Turret: rotates as a whole. Built facing +x.
  const turret = new THREE.Group();
  turret.position.set(x, h + 0.03, z);
  const T = new Batch();
  T.add(new THREE.CylinderGeometry(0.12, 0.14, 0.06, 20), M.darkSteel, T.at(0, 0.03, 0));
  for (const s of [-1, 1]) T.add(rbox(0.12, 0.13, 0.02, 0.006), M.greyPlate, T.at(0, 0.12, s * 0.09));
  T.add(rbox(0.24, 0.11, 0.15, 0.015), M.teamPlate, T.at(0.02, 0.15, 0));
  T.add(rbox(0.04, 0.2, 0.3, 0.012), M.whitePlate, T.at(0.15, 0.17, 0, 0, 0, -0.2));
  T.add(new THREE.BoxGeometry(0.045, 0.025, 0.3), M.hazard, T.at(0.17, 0.27, 0, 0, 0, -0.2));
  for (const s of [-1, 1]) {
    const bz = s * 0.04;
    const barrel = new THREE.CylinderGeometry(0.016, 0.018, 0.46, 12);
    barrel.rotateZ(-Math.PI / 2);
    T.add(barrel, M.gun, T.at(0.37, 0.16, bz));
    for (let k = 0; k < 5; k++) {
      const ring = new THREE.CylinderGeometry(0.024, 0.024, 0.018, 12);
      ring.rotateZ(-Math.PI / 2);
      T.add(ring, M.darkSteel, T.at(0.22 + k * 0.035, 0.16, bz));
    }
    const tip = new THREE.CylinderGeometry(0.022, 0.022, 0.04, 12);
    tip.rotateZ(-Math.PI / 2);
    T.add(tip, M.orange, T.at(0.6, 0.16, bz));
  }
  // Dart drum with orange tips showing.
  const drum = new THREE.CylinderGeometry(0.065, 0.065, 0.07, 20);
  drum.rotateX(Math.PI / 2);
  T.add(drum, M.gun, T.at(-0.04, 0.16, -0.12));
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2;
    T.add(new THREE.CylinderGeometry(0.008, 0.008, 0.012, 6), M.orange, T.at(-0.04 + Math.cos(a) * 0.05, 0.16 + Math.sin(a) * 0.05, -0.16, 0, Math.PI / 2));
  }
  // Scope, searchlight, antenna.
  const scope = new THREE.CylinderGeometry(0.014, 0.014, 0.14, 10);
  scope.rotateZ(-Math.PI / 2);
  T.add(scope, M.darkSteel, T.at(0.04, 0.235, 0));
  const lampBody = new THREE.CylinderGeometry(0.042, 0.036, 0.09, 16);
  lampBody.rotateZ(-Math.PI / 2);
  T.add(lampBody, M.darkSteel, T.at(0.02, 0.2, 0.12));
  const lens = new THREE.CircleGeometry(0.036, 16);
  lens.rotateY(Math.PI / 2);
  T.add(lens, M.searchGlass, T.at(0.068, 0.2, 0.12));
  T.rod(V3(-0.08, 0.2, 0.06), V3(-0.1, 0.42, 0.06), 0.003, M.darkSteel, 3);
  T.flush(turret);
  g.add(turret);
  return { group: g, turret, lamp: V3(0.07, 0.2, 0.12), muzzle: V3(0.62, 0.16, 0) };
}

// ------------------------------------------------------------------ gate, decks, lamps, nest

export interface SiteSource {
  cols: number;
  rows: number;
  tileAt(x: number, y: number): TileType;
  gate: Point;
  exhibits: readonly { footprint: Rect; viewingSpot: Point }[];
}

export function buildSite(src: SiteSource, M: Mats): THREE.Group {
  const B = new Batch();
  const g = new THREE.Group();
  // Gate on the west edge.
  if (src.gate.x === 0) {
    const gx = 0.02;
    const gz = src.gate.y + 0.5;
    for (const dz of [-0.72, 0.72]) {
      B.add(rbox(0.28, 1.2, 0.28, 0.02), M.stone, B.at(gx, 0.6, gz + dz));
      B.add(rbox(0.34, 0.08, 0.34, 0.015), M.concreteDark, B.at(gx, 1.24, gz + dz));
    }
    B.add(rbox(0.2, 0.16, 1.9, 0.02), M.woodDark, B.at(gx, 1.12, gz));
  }
  // Viewing decks at each exhibit's viewing spot, railing on the exhibit side.
  for (const ex of src.exhibits) {
    const sx = ex.viewingSpot.x + 0.5;
    const sz = ex.viewingSpot.y + 0.5;
    const f = fenceRect(ex.footprint);
    const px = Math.max(f.x0, Math.min(f.x1, sx));
    const pz = Math.max(f.z0, Math.min(f.z1, sz));
    const ang = Math.atan2(pz - sz, px - sx);
    const m = new THREE.Matrix4().compose(V3(sx, 0, sz), new THREE.Quaternion().setFromAxisAngle(V3(0, 1, 0), -ang), V3(1, 1, 1));
    const L = (x: number, y: number, z: number) => V3(x, y, z).applyMatrix4(m);
    const local = (x: number, y: number, z: number) => new THREE.Matrix4().multiplyMatrices(m, new THREE.Matrix4().makeTranslation(x, y, z));
    B.add(new THREE.BoxGeometry(0.62, 0.05, 0.86), M.deck, local(0.12, 0.035, 0));
    for (const zz of [-0.4, 0, 0.4]) B.rod(L(0.42, 0.05, zz), L(0.42, 0.3, zz), 0.016, M.woodDark);
    B.rod(L(0.42, 0.3, -0.42), L(0.42, 0.3, 0.42), 0.016, M.woodDark);
    B.rod(L(0.42, 0.18, -0.42), L(0.42, 0.18, 0.42), 0.01, M.woodDark);
    B.rod(L(0.38, 0, 0.5), L(0.38, 0.32, 0.5), 0.012, M.woodDark);
    B.add(new THREE.BoxGeometry(0.03, 0.12, 0.18), M.team, local(0.38, 0.34, 0.5));
  }
  // Lamps on alternate path tiles, set at the edge next to grass.
  for (let z = 0; z < src.rows; z++)
    for (let x = 0; x < src.cols; x++) {
      const t = src.tileAt(x, z);
      if (t !== Tile.Path || (x * 3 + z * 5) % 7 !== 0) continue;
      const north = z > 0 ? src.tileAt(x, z - 1) : -1;
      const south = z < src.rows - 1 ? src.tileAt(x, z + 1) : -1;
      const side = north === Tile.Grass ? -1 : south === Tile.Grass ? 1 : 0;
      if (!side) continue;
      const lx = x + 0.5;
      const lz = z + 0.5 + side * 0.42;
      B.cyl(0.016, 0.022, 0.62, M.darkSteel, lx, 0.31, lz, 8);
      B.add(rbox(0.07, 0.04, 0.07, 0.01), M.darkSteel, B.at(lx, 0.64, lz));
      B.box(0.05, 0.07, 0.05, M.lampGlass, lx, 0.59, lz);
      B.cyl(0.04, 0.05, 0.03, M.concreteDark, lx, 0.015, lz, 8);
    }
  B.flush(g);
  return g;
}

/** The raptors' nest: a mound of straw, a ring of sticks, and a clutch of eggs. */
export function buildNest(x: number, z: number, M: Mats): THREE.Group {
  const B = new Batch();
  const g = new THREE.Group();
  const r = mulberry32(17);
  const mound = new THREE.SphereGeometry(0.85, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  mound.scale(1, 0.14, 1);
  B.add(mound, M.straw, B.at(x, 0, z));
  for (let i = 0; i < 140; i++) {
    const a = r() * Math.PI * 2;
    const d = 0.55 + r() * 0.45;
    const len = 0.2 + r() * 0.3;
    const p = V3(x + Math.cos(a) * d, 0.04 + r() * 0.1, z + Math.sin(a) * d);
    const tang = a + Math.PI / 2 + (r() - 0.5) * 0.9;
    const q = V3(Math.cos(tang), (r() - 0.5) * 0.5, Math.sin(tang)).normalize().multiplyScalar(len / 2);
    B.rod(p.clone().sub(q), p.clone().add(q), 0.008 + r() * 0.008, M.twig, 4);
  }
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + r() * 0.4;
    const d = i === 0 ? 0 : 0.14 + r() * 0.06;
    const egg = new THREE.SphereGeometry(0.06, 12, 10);
    egg.scale(1, 1.3, 1);
    B.add(egg, M.egg, B.at(x + Math.cos(a) * d, 0.17, z + Math.sin(a) * d, r() * 6, (r() - 0.5) * 0.9, (r() - 0.5) * 0.9));
  }
  B.flush(g);
  return g;
}

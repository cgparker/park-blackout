// Animated things: dinosaurs, troops, towers, and guests. Each follows its simulation object every frame,
// picks an animation from what it is doing, and keeps a little state (corpses, fades) the simulation drops.
import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { DINO_AI, DINOS, UNITS, type AnimalKind, type UnitKind } from '../config';
import type { DinoState } from '../core/dinos';
import type { VisitorMode } from '../core/visitors';
import { GUEST_SLOT, SCALE, type Assets, type DinoTemplate, type PersonTemplate } from './assets';
import { TEX, type Mats } from './materials';
import { buildJeep, buildTower, TOWER_DECK, type JeepBuild, type TowerBuild } from './structures';
import { clamp, col, facingToRotY, hdr, mulberry32, turnToward } from './util';

export interface DinoView {
  id: number;
  kind: AnimalKind;
  x: number;
  y: number;
  facing: number;
  state: DinoState;
  sedation: number;
  fade: number;
  cooldown: number;
  windup?: number;
  charge?: number;
  /** T. rex only: the troop or tower it is locked onto, and the direction of its charge. */
  lockId?: number;
  cdx?: number;
  cdy?: number;
  removed?: boolean;
  /** Level 5: health left from fights, when it was last hurt, and the T. rex's bite timer on raptors. */
  health?: number;
  hurtAt?: number;
  fightCooldown?: number;
  /** Stills only: play this clip instead of inferring one from movement. */
  pose?: string;
  poseAt?: number;
}

export interface UnitView {
  id: number;
  kind: UnitKind;
  x: number;
  y: number;
  facing: number;
  hp: number;
  maxHp: number;
  cooldown: number;
  hurtAt?: number;
  dead?: boolean;
  order?: 'idle' | 'move' | 'attack' | 'repair' | 'board';
  /** Level 5: the 4x4 this troop is riding in, 0 on foot. */
  aboard?: number;
  pose?: string;
  poseAt?: number;
}

export interface GuestView {
  id: number;
  x: number;
  y: number;
  facing?: number;
  mode: VisitorMode;
  done?: boolean;
  cx?: number;
  cy?: number;
  tx?: number;
  ty?: number;
  pose?: string;
  poseAt?: number;
}

type Anim = { mixer: THREE.AnimationMixer; actions: Map<string, THREE.AnimationAction>; current: string; oneShot: number };

function makeAnim(root: THREE.Object3D, clips: THREE.AnimationClip[]): Anim {
  const mixer = new THREE.AnimationMixer(root);
  const actions = new Map<string, THREE.AnimationAction>();
  for (const c of clips) actions.set(c.name, mixer.clipAction(c));
  return { mixer, actions, current: '', oneShot: 0 };
}

/** Cross-fades to a clip. once: plays one time and holds its last frame. */
function play(a: Anim, name: string, { once = false, fade = 0.18, speed = 1, at = -1 } = {}): void {
  const next = a.actions.get(name);
  if (!next) return;
  if (a.current === name && !once) {
    next.timeScale = speed;
    return;
  }
  const prev = a.actions.get(a.current);
  next.reset();
  next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
  next.clampWhenFinished = once;
  next.timeScale = speed;
  if (at >= 0) next.time = at;
  next.enabled = true;
  next.setEffectiveWeight(1);
  if (prev && prev !== next && fade > 0) {
    next.play();
    prev.crossFadeTo(next, fade, false);
  } else {
    if (prev && prev !== next) prev.stop();
    next.play();
  }
  a.current = name;
}

function clipLength(a: Anim, name: string): number {
  return a.actions.get(name)?.getClip().duration ?? 0.5;
}

// ------------------------------------------------------------------ rings and bars

const ringGeo = new THREE.RingGeometry(0.24, 0.29, 48).rotateX(-Math.PI / 2);
const selGeo = new THREE.RingGeometry(0.3, 0.37, 48).rotateX(-Math.PI / 2);
const heavyRingGeo = new THREE.RingGeometry(0.3, 0.355, 48).rotateX(-Math.PI / 2);
const heavySelGeo = new THREE.RingGeometry(0.36, 0.44, 48).rotateX(-Math.PI / 2);
// The 4x4's rings: wide enough to go round it, with the same line weight as a troop's.
const jeepRingGeo = new THREE.RingGeometry(0.66, 0.715, 64).rotateX(-Math.PI / 2);
const jeepSelGeo = new THREE.RingGeometry(0.64, 0.72, 64).rotateX(-Math.PI / 2);
const teamRingMat = new THREE.MeshBasicMaterial({ color: col('#4d8dff'), transparent: true, opacity: 0.7, depthWrite: false });
// Selected: a plain yellow ring, kept under the bloom threshold so it reads without glaring.
const selRingMat = new THREE.MeshBasicMaterial({ color: col('#f2c94a'), transparent: true, opacity: 0.85, depthWrite: false });
const blobMat = new THREE.MeshBasicMaterial({ map: TEX.blob, transparent: true, depthWrite: false, opacity: 0.55 });
const blobGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

class Bar {
  readonly group = new THREE.Group();
  private readonly fill: THREE.Sprite;
  constructor(color: string) {
    const bg = new THREE.Sprite(new THREE.SpriteMaterial({ color: col('#101418'), depthTest: false, transparent: true, opacity: 0.8 }));
    bg.scale.set(0.42, 0.055, 1);
    this.fill = new THREE.Sprite(new THREE.SpriteMaterial({ color: hdr(color, 1.2), depthTest: false }));
    this.fill.center.set(0, 0.5);
    this.fill.position.x = -0.2;
    this.fill.scale.set(0.4, 0.035, 1);
    bg.renderOrder = 20;
    this.fill.renderOrder = 21;
    this.group.add(bg, this.fill);
  }
  set(f: number): void {
    this.fill.scale.x = 0.4 * clamp(f, 0, 1);
  }
}

// ------------------------------------------------------------------ actors

interface DinoActor {
  obj: THREE.Object3D;
  anim: Anim;
  tpl: DinoTemplate;
  rotY: number;
  lastX: number;
  lastZ: number;
  speed: number;
  lastCooldown: number;
  lastFight: number;
  loose: boolean;
  faded: boolean;
  eyes: THREE.Mesh[];
  bar: Bar;
  /** Level 5: health, under the sedation bar. */
  health: Bar;
  blob: THREE.Mesh;
  /** Level 5: when it was last hurt, and seconds left in its flinch. */
  lastHurt: number;
  flinch: number;
}

interface TroopActor {
  obj: THREE.Object3D;
  anim: Anim;
  heavy: boolean;
  /** Level 4's Engineer: other clips, and a toolbox instead of a gun. */
  engineer: boolean;
  /** Height of its hips above its feet, in tiles, to sit it in the 4x4. */
  hipY: number;
  /** Its leg bones, bent to sit. */
  legs: { upper: THREE.Bone[]; lower: THREE.Bone[] };
  rotY: number;
  lastX: number;
  lastZ: number;
  speed: number;
  lastCooldown: number;
  lastHurt: number;
  ring: THREE.Mesh;
  bar: Bar;
  /** Soft contact shadow, so a troop always reads as standing on the ground. */
  blob: THREE.Mesh;
  dying: number;
}

interface TowerActor {
  build: TowerBuild;
  rotY: number;
  lastCooldown: number;
  bar: Bar;
}

/** Level 5's Patrol 4x4, and the driver who comes with it. */
interface JeepActor {
  build: JeepBuild;
  rotY: number;
  lastX: number;
  lastZ: number;
  speed: number;
  ring: THREE.Mesh;
  bar: Bar;
  blob: THREE.Mesh;
  driver: TroopActor;
}

interface GuestActor {
  obj: THREE.Object3D;
  anim: Anim;
  /** Which guest model, so a guest who leaves can come back as another guest of the same model. */
  tpl: number;
  /** This guest's own copy of the model's colours. The rest of the mesh is shared. */
  colors: THREE.BufferAttribute;
  rotY: number;
  lastX: number;
  lastZ: number;
  speed: number;
  /** Seconds since this guest was killed, or -1. */
  dying: number;
  /** Drawn this frame: near the view. */
  shown: boolean;
}

/** Most guests drawn at once, for the shared blob and phone meshes. */
const MAX_GUESTS = 200;
const tmpM = new THREE.Matrix4();

export interface ActorFrame {
  T: number;
  dinos: readonly DinoView[];
  units: readonly UnitView[];
  guests: readonly GuestView[];
  selected: ReadonlySet<number>;
  night: boolean;
  dt: number;
  /** Seconds, for one-shot timing. */
  now: number;
  /** Ground near the view, in tiles. Guests and animals outside it are neither drawn nor animated. */
  view?: { x0: number; z0: number; x1: number; z1: number };
  /** Level 4: Engineers at work, and the point (world pixels) each one faces. */
  working?: ReadonlyMap<number, { x: number; y: number }>;
}

const tmpV = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class Actors {
  readonly root = new THREE.Group();
  private readonly dinos = new Map<number, DinoActor>();
  private readonly troops = new Map<number, TroopActor>();
  private readonly towers = new Map<number, TowerActor>();
  private readonly jeeps = new Map<number, JeepActor>();
  private readonly guests = new Map<number, GuestActor>();
  private readonly corpses: TroopActor[] = [];
  private readonly fallen: GuestActor[] = [];
  /** Guests who left, kept hidden for the next guest of the same model. */
  private readonly guestPool: GuestActor[] = [];
  /** Every guest's contact shadow in one mesh, and the glow of the phones guests hold up at night. */
  private readonly guestBlobs = new THREE.InstancedMesh(blobGeo, blobMat, MAX_GUESTS);
  private readonly phones: THREE.Points;
  private readonly rnd = mulberry32(7);
  private readonly eyeMatDay = new THREE.MeshStandardMaterial({ color: col('#1a1206'), roughness: 0.15, metalness: 0.2 });
  private readonly eyeMats: Record<string, THREE.MeshBasicMaterial> = {
    trex: new THREE.MeshBasicMaterial({ color: hdr('#d9a040', 1.6) }),
    raptor: new THREE.MeshBasicMaterial({ color: hdr('#c8e070', 1.8) }),
  };
  /** Shooters this frame (unit ids), from dart events, for the shooting pose. */
  readonly firedBy = new Set<number>();

  constructor(private readonly assets: Assets, private readonly M: Mats) {
    this.guestBlobs.count = 0;
    this.guestBlobs.renderOrder = 1;
    this.guestBlobs.frustumCulled = false;
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_GUESTS * 3), 3).setUsage(THREE.DynamicDrawUsage));
    pg.setDrawRange(0, 0);
    this.phones = new THREE.Points(pg, new THREE.PointsMaterial({ map: TEX.glow, color: hdr('#e9f1ff', 6), size: 0.07, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.phones.frustumCulled = false;
    this.root.add(this.guestBlobs, this.phones);
  }

  // ---------------------------------------------- queries for effects and picking

  /** World position of a troop's gun muzzle (falls back to chest height). */
  troopMuzzle(id: number, out: THREE.Vector3): THREE.Vector3 | null {
    const a = this.troops.get(id);
    if (!a) return null;
    const f = a.obj.rotation.y;
    out.set(Math.sin(f), 0, Math.cos(f)).multiplyScalar(a.heavy ? 0.42 : 0.3).add(a.obj.position);
    out.y = a.heavy ? 0.4 : 0.32;
    return out;
  }

  troopIds(): number[] {
    return [...this.troops.keys()];
  }

  troopObject(id: number): THREE.Object3D | null {
    return this.troops.get(id)?.obj ?? null;
  }

  towerInfo(id: number): { build: TowerBuild } | null {
    const t = this.towers.get(id);
    return t ? { build: t.build } : null;
  }

  dinoObject(id: number): THREE.Object3D | null {
    return this.dinos.get(id)?.obj ?? null;
  }

  /** Drops every actor, for a new game. */
  clear(): void {
    for (const a of this.dinos.values()) this.root.remove(a.obj, a.bar.group, a.health.group, a.blob);
    for (const a of this.troops.values()) this.root.remove(a.obj, a.ring, a.bar.group, a.blob);
    for (const t of this.towers.values()) this.root.remove(t.build.group, t.bar.group);
    for (const j of this.jeeps.values()) this.root.remove(j.build.group, j.ring, j.bar.group, j.blob, j.driver.obj);
    this.jeeps.clear();
    for (const g of [...this.guests.values(), ...this.fallen, ...this.guestPool]) this.root.remove(g.obj);
    for (const c of this.corpses) this.root.remove(c.obj);
    this.fallen.length = 0;
    this.guestPool.length = 0;
    this.guestBlobs.count = 0;
    this.phones.geometry.setDrawRange(0, 0);
    this.dinos.clear();
    this.troops.clear();
    this.towers.clear();
    this.guests.clear();
    this.corpses.length = 0;
    this.firedBy.clear();
  }

  /** A guest was killed at this spot (tiles): the nearest one falls and stays down a few seconds. */
  guestDown(x: number, z: number): void {
    let best: GuestActor | null = null;
    let bd = 0.8;
    for (const g of this.guests.values()) {
      if (g.dying >= 0) continue;
      const d = Math.hypot(g.obj.position.x - x, g.obj.position.z - z);
      if (d < bd) {
        bd = d;
        best = g;
      }
    }
    if (best) best.dying = 0;
  }

  // ---------------------------------------------- creation

  private makeDino(d: DinoView): DinoActor {
    const tpl = this.assets.dinos[d.kind];
    const obj = SkeletonUtils.clone(tpl.gltf.scene);
    obj.scale.setScalar(SCALE.dino);
    const eyes: THREE.Mesh[] = [];
    if (tpl.eye) {
      let head: THREE.Object3D | null = null;
      obj.traverse((b) => {
        if ((b as THREE.Bone).isBone && b.name === 'Head') head = b;
      });
      if (head) {
        // Both eyes in one mesh: one draw call.
        const geo = mergeGeometries(tpl.eye.local.map((p) => new THREE.SphereGeometry(tpl.eye!.radius, 10, 8).translate(p.x, p.y, p.z)));
        if (geo) {
          const e = new THREE.Mesh(geo, this.eyeMatDay);
          (head as THREE.Object3D).add(e);
          eyes.push(e);
        }
      }
    }
    const anim = makeAnim(obj, tpl.gltf.animations);
    play(anim, 'Idle', { fade: 0, at: this.rnd() * 2 });
    const bar = new Bar('#b07cff');
    bar.group.visible = false;
    const health = new Bar('#ff4d4d');
    health.group.visible = false;
    const blob = new THREE.Mesh(blobGeo, blobMat);
    const r = DINOS[d.kind].radius / 40;
    blob.scale.set(r * 3.2, 1, r * 3.2);
    blob.renderOrder = 1;
    this.root.add(obj, bar.group, health.group, blob);
    return {
      obj,
      anim,
      tpl,
      rotY: facingToRotY(d.facing),
      lastX: d.x,
      lastZ: d.y,
      speed: 0,
      lastCooldown: 0,
      lastFight: 0,
      loose: false,
      faded: false,
      eyes,
      bar,
      health,
      blob,
      lastHurt: d.hurtAt ?? -Infinity,
      flinch: 0,
    };
  }

  private makeTroop(u: UnitView): TroopActor {
    const heavy = u.kind === 'heavy';
    const engineer = u.kind === 'engineer' && this.assets.engineer.length > 0;
    const pick = (list: PersonTemplate[]) => list[((u.id % list.length) + list.length) % list.length];
    const tpl: PersonTemplate = heavy ? this.assets.heavy : engineer ? pick(this.assets.engineer) : pick(this.assets.light);
    const obj = SkeletonUtils.clone(tpl.gltf.scene);
    const scale = heavy ? SCALE.heavy : engineer ? SCALE.engineer : SCALE.light;
    obj.scale.setScalar(scale);
    const anim = makeAnim(obj, tpl.gltf.animations);
    play(anim, engineer ? 'Idle' : 'Idle_Gun', { fade: 0, at: this.rnd() });
    const ring = new THREE.Mesh(heavy ? heavyRingGeo : ringGeo, teamRingMat);
    ring.renderOrder = 2;
    const bar = new Bar('#56e07a');
    bar.group.visible = false;
    const blob = new THREE.Mesh(blobGeo, blobMat);
    blob.scale.set(heavy ? 0.62 : 0.5, 1, heavy ? 0.62 : 0.5);
    blob.renderOrder = 1;
    this.root.add(obj, ring, bar.group, blob);
    const bones: Record<string, THREE.Bone> = {};
    obj.traverse((b) => {
      if ((b as THREE.Bone).isBone) bones[b.name] = b as THREE.Bone;
    });
    obj.updateMatrixWorld(true);
    const hips = bones.Hips ? new THREE.Vector3().setFromMatrixPosition(bones.Hips.matrixWorld).y : 0.5 / scale;
    return {
      obj,
      anim,
      heavy,
      engineer,
      hipY: hips,
      legs: { upper: [bones.UpperLegL, bones.UpperLegR].filter(Boolean), lower: [bones.LowerLegL, bones.LowerLegR].filter(Boolean) },
      rotY: facingToRotY(u.facing),
      lastX: u.x,
      lastZ: u.y,
      speed: 0,
      lastCooldown: u.cooldown,
      lastHurt: u.hurtAt ?? -1,
      ring,
      bar,
      blob,
      dying: -1,
    };
  }

  /** The 4x4, with a driver from the team in its seat. */
  private makeJeep(u: UnitView): JeepActor {
    const build = buildJeep(this.M);
    const ring = new THREE.Mesh(jeepRingGeo, teamRingMat);
    ring.renderOrder = 2;
    const bar = new Bar('#56e07a');
    bar.group.visible = false;
    const blob = new THREE.Mesh(blobGeo, blobMat);
    blob.scale.set(0.9, 1, 1.4);
    blob.renderOrder = 1;
    const driver = this.makeTroop({ ...u, id: u.id + 1, kind: 'tranq' });
    // The driver belongs to the 4x4: no ring, bar, or shadow of its own.
    this.root.remove(driver.ring, driver.bar.group, driver.blob);
    this.root.add(build.group, ring, bar.group, blob);
    return { build, rotY: facingToRotY(u.facing), lastX: u.x, lastZ: u.y, speed: 0, ring, bar, blob, driver };
  }

  /** Bends a troop's legs to sit, after its clip has posed it. */
  private sit(a: TroopActor): void {
    for (const b of a.legs.upper) b.rotation.x -= 1.45;
    for (const b of a.legs.lower) b.rotation.x += 1.45;
  }

  /** Puts a troop in a seat of its 4x4 (seat in the 4x4's own space), sitting and facing ahead. */
  private seat(a: TroopActor, jeep: JeepActor, seat: THREE.Vector3): void {
    const p = seat.clone().applyAxisAngle(UP, jeep.rotY).add(jeep.build.group.position);
    a.obj.position.set(p.x, p.y + 0.03 - a.hipY, p.z);
    a.rotY = jeep.rotY;
    a.obj.rotation.y = jeep.rotY;
  }

  /** A guest: a free one of the same model from the pool, or a new copy, in this guest's own colours. */
  private makeGuest(v: GuestView): GuestActor {
    const list = this.assets.guests;
    const ti = ((v.id % list.length) + list.length) % list.length;
    const r = mulberry32(v.id * 13 + 5);
    let a: GuestActor | undefined;
    const at = this.guestPool.findIndex((p) => p.tpl === ti);
    if (at >= 0) {
      a = this.guestPool.splice(at, 1)[0];
      a.obj.visible = true;
      a.obj.position.y = 0;
      a.dying = -1;
      a.speed = 0;
      a.anim.current = '';
      a.anim.mixer.stopAllAction();
    } else {
      const tpl = list[ti];
      const obj = SkeletonUtils.clone(tpl.gltf.scene);
      obj.scale.setScalar(SCALE.guest);
      // Share the merged mesh's shape and skinning; give this guest its own colours.
      let colors: THREE.BufferAttribute | null = null;
      obj.traverse((o) => {
        const m = o as THREE.SkinnedMesh;
        if (!m.isSkinnedMesh || colors) return;
        const base = m.geometry;
        const geo = new THREE.BufferGeometry();
        for (const [name, attr] of Object.entries(base.attributes)) geo.setAttribute(name, attr);
        geo.setIndex(base.index);
        geo.userData.slots = base.userData.slots;
        geo.userData.base = base.attributes.color;
        colors = new THREE.BufferAttribute(new Float32Array((base.attributes.color as THREE.BufferAttribute).array), 3);
        geo.setAttribute('color', colors);
        m.geometry = geo;
      });
      a = { obj, anim: makeAnim(obj, tpl.gltf.animations), tpl: ti, colors: colors ?? new THREE.BufferAttribute(new Float32Array(3), 3), rotY: 0, lastX: v.x, lastZ: v.y, speed: 0, dying: -1, shown: true };
      this.root.add(obj);
    }
    this.paintGuest(a, r);
    a.rotY = facingToRotY(v.facing ?? 0);
    a.lastX = v.x;
    a.lastZ = v.y;
    play(a.anim, 'Walk', { fade: 0, at: r() * 1.5 });
    return a;
  }

  /** Skin, hair, top, and bottom colours, picked from the guest's id so they stay the same. */
  private paintGuest(a: GuestActor, r: () => number): void {
    const pick = <T>(list: T[]) => list[Math.floor(r() * list.length)];
    const skin = col(pick(['#f1c9a5', '#e0ac85', '#c68863', '#9a6544', '#6d452c', '#4a2f1f']));
    const palette: Record<number, THREE.Color> = {
      [GUEST_SLOT.skin]: skin,
      [GUEST_SLOT.skinDark]: skin.clone().multiplyScalar(0.85),
      [GUEST_SLOT.hair]: col(pick(['#1c1410', '#3b2516', '#6b4424', '#a87a46', '#d6b77a', '#8d8d8d'])),
      [GUEST_SLOT.top]: col(pick(['#d94a3a', '#e88a2c', '#efd04a', '#4fae5b', '#2f8ccf', '#7a55c7', '#e86aa6', '#f2f2ee', '#22272e', '#3c6e91'])),
      [GUEST_SLOT.bottom]: col(pick(['#22272e', '#3c4a5e', '#5a4a3a', '#c8b48a', '#2f3b52', '#6b6b6b'])),
    };
    let geo: THREE.BufferGeometry | null = null;
    a.obj.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh && !geo) geo = (o as THREE.SkinnedMesh).geometry;
    });
    const g = geo as THREE.BufferGeometry | null;
    const slots = g?.userData.slots as Uint8Array | undefined;
    const base = g?.userData.base as THREE.BufferAttribute | undefined;
    if (!slots || !base) return;
    const out = a.colors.array as Float32Array;
    const src = base.array as Float32Array;
    for (let i = 0; i < slots.length; i++) {
      const c = palette[slots[i]];
      if (c) {
        out[i * 3] = c.r;
        out[i * 3 + 1] = c.g;
        out[i * 3 + 2] = c.b;
      } else {
        out[i * 3] = src[i * 3];
        out[i * 3 + 1] = src[i * 3 + 1];
        out[i * 3 + 2] = src[i * 3 + 2];
      }
    }
    a.colors.needsUpdate = true;
  }

  /** A guest leaves the scene: hidden and kept for reuse. */
  private poolGuest(a: GuestActor): void {
    a.obj.visible = false;
    a.anim.mixer.stopAllAction();
    this.guestPool.push(a);
  }

  // ---------------------------------------------- per frame

  update(f: ActorFrame): void {
    const T = f.T;
    const dt = Math.max(f.dt, 1e-4);
    // Dinosaurs.
    const seenD = new Set<number>();
    for (const d of f.dinos) {
      if (d.removed) continue;
      seenD.add(d.id);
      let a = this.dinos.get(d.id);
      if (!a) this.dinos.set(d.id, (a = this.makeDino(d)));
      const x = d.x / T;
      const z = d.y / T;
      const moved = Math.hypot(d.x - a.lastX, d.y - a.lastZ) / T;
      // A jump of more than a few tiles is a teleport (carried home), not movement.
      const v = moved > 2 ? 0 : moved / dt;
      a.speed += (v - a.speed) * clamp(dt * 10, 0, 1);
      a.lastX = d.x;
      a.lastZ = d.y;
      a.obj.position.set(x, 0, z);
      a.blob.position.set(x, 0.015, z);
      // Off the view: not drawn, and its animation waits.
      const vr = f.view;
      const shown = !vr || (x > vr.x0 - 1 && x < vr.x1 + 1 && z > vr.z0 - 1 && z < vr.z1 + 1);
      a.obj.visible = shown;
      const target = facingToRotY(d.facing);
      a.rotY = moved > 2 ? target : turnToward(a.rotY, target, ((d.charge ?? 0) > 0 ? 14 : 7) * dt);
      a.obj.rotation.y = a.rotY;
      const loose = d.state === 'loose' && f.night;
      if (loose !== a.loose) {
        a.loose = loose;
        const set = loose ? a.tpl.looseMats : a.tpl.mats;
        a.obj.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh && !a!.eyes.includes(m) && m.material && (m.material as THREE.Material).name in set) m.material = set[(m.material as THREE.Material).name];
          else if (m.isMesh && !a!.eyes.includes(m)) {
            const nm = (m.material as THREE.Material).userData.srcName as string | undefined;
            if (nm && set[nm]) m.material = set[nm];
          }
        });
      }
      for (const e of a.eyes) e.material = f.night ? this.eyeMats[d.kind] ?? this.eyeMatDay : this.eyeMatDay;
      // Animation.
      const cfg = DINOS[d.kind];
      if (d.state === 'secured') {
        if (a.anim.current !== 'Death') play(a.anim, 'Death', { once: true, fade: 0.25 });
        const k = clamp(d.fade / DINO_AI.secureFadeSeconds, 0, 1);
        this.setFade(a, k);
      } else if (d.state === 'dead') {
        // Killed in level 5's fight: it falls and stays down, then fades in its last second.
        if (a.anim.current !== 'Death') play(a.anim, 'Death', { once: true, fade: 0.15 });
        this.setFade(a, clamp(d.fade, 0, 1));
      } else if (d.pose) {
        if (a.anim.current !== d.pose) play(a.anim, d.pose, { fade: 0, at: d.poseAt ?? 0 });
      } else {
        if (a.faded) this.setFade(a, 1);
        // Bites on troops and on other animals, and the T. rex's own bite on raptors.
        const attacked = d.cooldown > a.lastCooldown + 0.05 || (d.fightCooldown ?? 0) > a.lastFight + 0.05;
        if ((d.windup ?? 0) > 0) play(a.anim, 'Attack', { speed: 0.8 });
        else if (attacked && f.now >= a.anim.oneShot) {
          play(a.anim, 'Attack', { once: true, fade: 0.08, speed: 1.3 });
          a.anim.oneShot = f.now + clipLength(a.anim, 'Attack') / 1.3;
        } else if (f.now >= a.anim.oneShot) {
          const runRef = d.kind === 'trex' ? 2.2 : d.kind === 'raptor' ? 3.6 : 2.6;
          if (a.speed > cfg.wanderSpeed / T * 1.6 || (d.charge ?? 0) > 0) play(a.anim, 'Run', { speed: clamp(a.speed / runRef, 0.7, 1.8) });
          else if (a.speed > 0.08) play(a.anim, 'Walk', { speed: clamp(a.speed / (runRef * 0.4), 0.6, 1.6) });
          else play(a.anim, 'Idle');
        }
      }
      a.lastCooldown = d.cooldown;
      a.lastFight = d.fightCooldown ?? 0;
      // Sedation bar while darts are working, and level 5's health bar under it once it's hurt.
      const top = d.kind === 'trex' ? 1.35 : d.kind === 'raptor' ? 0.62 : 0.95;
      const showBar = d.state !== 'secured' && d.state !== 'dead' && d.sedation < cfg.sedation;
      a.bar.group.visible = showBar;
      if (showBar) {
        a.bar.set(d.sedation / cfg.sedation);
        a.bar.group.position.set(x, top, z);
      }
      const hp = d.health ?? cfg.health;
      const showHealth = d.state === 'loose' && hp < cfg.health;
      a.health.group.visible = showHealth;
      if (showHealth) {
        a.health.set(hp / cfg.health);
        a.health.group.position.set(x, top - 0.07, z);
      }
      // Hurt in a fight: a short shudder.
      if ((d.hurtAt ?? -Infinity) > a.lastHurt) {
        a.lastHurt = d.hurtAt ?? -Infinity;
        if (d.state === 'loose') a.flinch = 0.3;
      }
      if (a.flinch > 0) {
        a.flinch = Math.max(0, a.flinch - dt);
        const k = a.flinch / 0.3;
        a.obj.rotation.z = Math.sin(a.flinch * 60) * 0.12 * k;
        a.obj.position.y = 0.03 * k;
      } else a.obj.rotation.z = 0;
      if (shown) a.anim.mixer.update(dt);
    }
    for (const [id, a] of this.dinos) {
      if (seenD.has(id)) continue;
      this.root.remove(a.obj, a.bar.group, a.health.group, a.blob);
      this.dinos.delete(id);
    }

    // The 4x4 first, so its riders can take their seats.
    const seenU = new Set<number>();
    for (const u of f.units) {
      if (u.kind !== 'jeep' || u.dead) continue;
      seenU.add(u.id);
      let j = this.jeeps.get(u.id);
      if (!j) this.jeeps.set(u.id, (j = this.makeJeep(u)));
      const x = u.x / T;
      const z = u.y / T;
      const moved = Math.hypot(u.x - j.lastX, u.y - j.lastZ) / T;
      j.speed += (moved / dt - j.speed) * clamp(dt * 10, 0, 1);
      j.lastX = u.x;
      j.lastZ = u.y;
      j.rotY = turnToward(j.rotY, facingToRotY(u.facing), 6 * dt);
      j.build.group.position.set(x, 0, z);
      j.build.group.rotation.y = j.rotY;
      for (const w of j.build.wheels) w.rotation.x += (moved / j.build.radius) * 1;
      const sel = f.selected.has(u.id);
      j.ring.material = sel ? selRingMat : teamRingMat;
      j.ring.geometry = sel ? jeepSelGeo : jeepRingGeo;
      j.ring.position.set(x, 0.02, z);
      j.blob.position.set(x, 0.015, z);
      j.blob.rotation.y = j.rotY;
      const hurt = u.hp < u.maxHp;
      j.bar.group.visible = hurt;
      if (hurt) {
        j.bar.set(u.hp / u.maxHp);
        j.bar.group.position.set(x, 0.95, z);
      }
      // The driver sits at the wheel.
      const dr = j.driver;
      this.seat(dr, j, j.build.driver);
      play(dr.anim, 'Idle');
      dr.anim.mixer.update(dt);
      this.sit(dr);
    }

    // Troops and towers.
    const riders = new Map<number, number[]>();
    for (const u of f.units) if (u.aboard && !u.dead) riders.set(u.aboard, [...(riders.get(u.aboard) ?? []), u.id].sort((p, q) => p - q));
    for (const u of f.units) {
      if (u.kind === 'jeep') continue;
      if (u.kind === 'tower') {
        seenU.add(u.id);
        let t = this.towers.get(u.id);
        if (!t) {
          const build = buildTower(Math.floor(u.x / T) + 0.5, Math.floor(u.y / T) + 0.5, this.M);
          this.root.add(build.group);
          const bar = new Bar('#56e07a');
          this.root.add(bar.group);
          t = { build, rotY: -u.facing, lastCooldown: u.cooldown, bar };
          this.towers.set(u.id, t);
        }
        t.rotY = turnToward(t.rotY, -u.facing, 9 * dt);
        t.build.turret.rotation.y = t.rotY;
        t.lastCooldown = u.cooldown;
        const hurt = u.hp < u.maxHp;
        t.bar.group.visible = hurt;
        if (hurt) {
          t.bar.set(u.hp / u.maxHp);
          t.bar.group.position.set(Math.floor(u.x / T) + 0.5, TOWER_DECK + 0.6, Math.floor(u.y / T) + 0.5);
        }
        continue;
      }
      if (u.dead) continue;
      seenU.add(u.id);
      let a = this.troops.get(u.id);
      if (!a) this.troops.set(u.id, (a = this.makeTroop(u)));
      const x = u.x / T;
      const z = u.y / T;
      // In the 4x4: sitting in a seat, gun ready, no ring of its own.
      const jeep = u.aboard ? this.jeeps.get(u.aboard) : undefined;
      if (jeep) {
        const seats = riders.get(u.aboard!) ?? [];
        this.seat(a, jeep, jeep.build.seats[Math.max(0, seats.indexOf(u.id)) % jeep.build.seats.length]);
        a.lastX = u.x;
        a.lastZ = u.y;
        a.speed = 0;
        a.ring.visible = a.blob.visible = a.bar.group.visible = false;
        play(a.anim, a.engineer ? 'Idle' : 'Idle_Gun');
        a.anim.mixer.update(dt);
        this.sit(a);
        continue;
      }
      a.ring.visible = a.blob.visible = true;
      const moved = Math.hypot(u.x - a.lastX, u.y - a.lastZ) / T;
      a.speed += (moved / dt - a.speed) * clamp(dt * 10, 0, 1);
      a.lastX = u.x;
      a.lastZ = u.y;
      a.obj.position.set(x, 0, z);
      // Level 4: an Engineer at work turns to the substation.
      const work = f.working?.get(u.id);
      const face = work ? Math.atan2(work.y - u.y, work.x - u.x) : u.facing;
      a.rotY = turnToward(a.rotY, facingToRotY(face), 10 * dt);
      a.obj.rotation.y = a.rotY;
      const sel = f.selected.has(u.id);
      a.ring.geometry = sel ? (a.heavy ? heavySelGeo : selGeo) : a.heavy ? heavyRingGeo : ringGeo;
      a.ring.material = sel ? selRingMat : teamRingMat;
      a.ring.position.set(x, 0.02, z);
      a.blob.position.set(x, 0.015, z);
      const fired = u.cooldown > a.lastCooldown + 0.05 || this.firedBy.has(u.id);
      const hurt = (u.hurtAt ?? -1) !== a.lastHurt && (u.hurtAt ?? -1) >= 0;
      a.lastCooldown = u.cooldown;
      a.lastHurt = u.hurtAt ?? -1;
      const moving = a.speed > 0.15;
      if (u.pose) {
        if (a.anim.current !== u.pose) play(a.anim, u.pose, { fade: 0, at: u.poseAt ?? 0 });
      } else if (hurt) {
        play(a.anim, 'HitRecieve', { once: true, fade: 0.06 });
        a.anim.oneShot = f.now + 0.5;
      } else if (a.engineer) {
        if (f.now >= a.anim.oneShot) {
          const runRef = (UNITS[u.kind].speed / T) * 0.9;
          if (moving) play(a.anim, 'Run', { speed: clamp(a.speed / runRef, 0.6, 1.5) });
          else play(a.anim, work ? 'Interact' : 'Idle');
        }
      } else if (fired) {
        play(a.anim, moving ? 'Run_Shoot' : 'Gun_Shoot', { once: !moving, fade: 0.06 });
        a.anim.oneShot = f.now + 0.45;
      } else if (f.now >= a.anim.oneShot) {
        const runRef = (UNITS[u.kind].speed / T) * 0.9;
        if (moving) play(a.anim, 'Run', { speed: clamp(a.speed / runRef, 0.6, 1.5) });
        else play(a.anim, u.order === 'attack' ? 'Idle_Gun_Pointing' : 'Idle_Gun');
      }
      const showBar = u.hp < u.maxHp;
      a.bar.group.visible = showBar;
      if (showBar) {
        a.bar.set(u.hp / u.maxHp);
        a.bar.group.position.set(x, a.heavy ? 0.95 : 0.78, z);
      }
      a.anim.mixer.update(dt);
    }
    for (const [id, a] of this.troops) {
      if (seenU.has(id)) continue;
      this.troops.delete(id);
      this.root.remove(a.ring, a.bar.group, a.blob);
      a.dying = 0;
      play(a.anim, 'Death', { once: true, fade: 0.1 });
      this.corpses.push(a);
    }
    for (const [id, t] of this.towers) {
      if (seenU.has(id)) continue;
      this.root.remove(t.build.group, t.bar.group);
      this.towers.delete(id);
    }
    for (const [id, j] of this.jeeps) {
      if (seenU.has(id)) continue;
      // Wrecked: it stays where it stopped, dark, a few seconds, then goes.
      this.root.remove(j.ring, j.bar.group, j.blob, j.driver.obj);
      j.build.group.position.y -= dt * 0.05;
      if (j.build.group.position.y < -0.2) {
        this.root.remove(j.build.group);
        this.jeeps.delete(id);
      }
    }
    for (let i = this.corpses.length - 1; i >= 0; i--) {
      const c = this.corpses[i];
      c.dying += dt;
      c.anim.mixer.update(dt);
      if (c.dying > 3) c.obj.position.y -= dt * 0.15;
      if (c.dying > 4.5) {
        this.root.remove(c.obj);
        this.corpses.splice(i, 1);
      }
    }

    // Guests. Only those near the view are drawn and animated; a park can hold dozens.
    const vr = f.view;
    const near = (x: number, z: number) => !vr || (x > vr.x0 && x < vr.x1 && z > vr.z0 && z < vr.z1);
    const seenG = new Set<number>();
    let blobs = 0;
    let lit = 0;
    const phonePos = this.phones.geometry.attributes.position as THREE.BufferAttribute;
    for (const v of f.guests) {
      if (v.done) continue;
      seenG.add(v.id);
      let a = this.guests.get(v.id);
      if (!a) this.guests.set(v.id, (a = this.makeGuest(v)));
      const x = v.x / T;
      const z = v.y / T;
      const dx = (v.x - a.lastX) / T;
      const dz = (v.y - a.lastZ) / T;
      const moved = Math.hypot(dx, dz);
      a.speed += (moved / dt - a.speed) * clamp(dt * 8, 0, 1);
      if (moved > 1e-4) a.rotY = turnToward(a.rotY, Math.atan2(dx, dz), 8 * dt);
      else if (v.facing !== undefined) a.rotY = facingToRotY(v.facing);
      a.lastX = v.x;
      a.lastZ = v.y;
      a.shown = near(x, z);
      a.obj.visible = a.shown;
      if (!a.shown) continue;
      a.obj.position.set(x, 0, z);
      a.obj.rotation.y = a.rotY;
      if (v.pose) {
        if (a.anim.current !== v.pose) play(a.anim, v.pose, { fade: 0, at: v.poseAt ?? 0 });
      } else if (a.speed > 1.4 || v.mode === 'fleeing') play(a.anim, 'Run', { speed: clamp(a.speed / 2.4, 0.7, 1.5) });
      else if (a.speed > 0.1 || v.mode === 'walking' || v.mode === 'leaving') play(a.anim, 'Walk', { speed: clamp(a.speed / 1.1, 0.6, 1.4) });
      else play(a.anim, v.id % 4 === 0 ? 'Wave' : 'Idle');
      a.anim.mixer.update(dt);
      if (blobs < MAX_GUESTS) this.guestBlobs.setMatrixAt(blobs++, tmpM.makeScale(0.36, 1, 0.36).setPosition(x, 0.014, z));
      // At night every other guest holds up a phone.
      if (f.night && v.id % 2 === 0 && lit < MAX_GUESTS) {
        tmpV.set(Math.sin(a.rotY) * 0.08 + Math.cos(a.rotY) * 0.05, 0.25, Math.cos(a.rotY) * 0.08 - Math.sin(a.rotY) * 0.05);
        phonePos.setXYZ(lit++, x + tmpV.x, tmpV.y, z + tmpV.z);
      }
    }
    this.guestBlobs.count = blobs;
    this.guestBlobs.instanceMatrix.needsUpdate = true;
    this.phones.geometry.setDrawRange(0, lit);
    phonePos.needsUpdate = true;
    for (const [id, a] of this.guests) {
      if (seenG.has(id)) continue;
      this.guests.delete(id);
      if (a.dying < 0) {
        this.poolGuest(a);
        continue;
      }
      a.obj.visible = true;
      play(a.anim, 'Death', { once: true, fade: 0.08 });
      this.fallen.push(a);
    }
    for (let i = this.fallen.length - 1; i >= 0; i--) {
      const g = this.fallen[i];
      g.dying += dt;
      g.anim.mixer.update(dt);
      if (g.dying > 3) g.obj.position.y -= dt * 0.1;
      if (g.dying > 4.5) {
        this.fallen.splice(i, 1);
        this.poolGuest(g);
      }
    }
    this.firedBy.clear();
  }

  private setFade(a: DinoActor, k: number): void {
    a.obj.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      const out = mats.map((mm) => {
        let c = mm as THREE.MeshStandardMaterial;
        if (!c.userData.fadeClone) {
          const src = c;
          c = c.clone();
          c.userData.fadeClone = true;
          c.userData.srcName = src.name;
          c.name = '';
          c.onBeforeCompile = src.onBeforeCompile;
          c.customProgramCacheKey = src.customProgramCacheKey;
        }
        c.transparent = k < 1;
        c.opacity = k;
        c.depthWrite = k >= 1;
        return c;
      });
      m.material = out.length === 1 ? out[0] : out;
    });
    a.faded = k < 1;
    a.blob.visible = k > 0.05;
    if (k >= 1) {
      // Back to the shared materials once fully visible again (carried home in levels 1 and 2).
      const set = a.loose ? a.tpl.looseMats : a.tpl.mats;
      a.obj.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || a.eyes.includes(m)) return;
        const nm = (m.material as THREE.Material).userData?.srcName as string | undefined;
        if (nm && set[nm]) m.material = set[nm];
      });
    }
  }
}

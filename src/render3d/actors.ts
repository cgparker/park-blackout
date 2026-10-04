// Animated things: dinosaurs, troops, towers, and guests. Each follows its simulation object every frame,
// picks an animation from what it is doing, and keeps a little state (corpses, fades) the simulation drops.
import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { DINO_AI, DINOS, UNITS, type AnimalKind, type UnitKind } from '../config';
import type { DinoState } from '../core/dinos';
import type { VisitorMode } from '../core/visitors';
import { SCALE, type Assets, type DinoTemplate, type PersonTemplate } from './assets';
import { TEX, type Mats } from './materials';
import { buildTower, TOWER_DECK, type TowerBuild } from './structures';
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
  removed?: boolean;
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
  order?: 'idle' | 'move' | 'attack';
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
  loose: boolean;
  faded: boolean;
  eyes: THREE.Mesh[];
  bar: Bar;
  blob: THREE.Mesh;
}

interface TroopActor {
  obj: THREE.Object3D;
  anim: Anim;
  heavy: boolean;
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

interface GuestActor {
  obj: THREE.Object3D;
  anim: Anim;
  rotY: number;
  lastX: number;
  lastZ: number;
  speed: number;
  dying: number;
  phone: THREE.Mesh | null;
}

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
}

const tmpV = new THREE.Vector3();

export class Actors {
  readonly root = new THREE.Group();
  private readonly dinos = new Map<number, DinoActor>();
  private readonly troops = new Map<number, TroopActor>();
  private readonly towers = new Map<number, TowerActor>();
  private readonly guests = new Map<number, GuestActor>();
  private readonly corpses: TroopActor[] = [];
  private readonly rnd = mulberry32(7);
  private readonly eyeMatDay = new THREE.MeshStandardMaterial({ color: col('#1a1206'), roughness: 0.15, metalness: 0.2 });
  private readonly eyeMats: Record<string, THREE.MeshBasicMaterial> = {
    trex: new THREE.MeshBasicMaterial({ color: hdr('#d9a040', 1.6) }),
    raptor: new THREE.MeshBasicMaterial({ color: hdr('#c8e070', 1.8) }),
  };
  /** Shooters this frame (unit ids), from dart events, for the shooting pose. */
  readonly firedBy = new Set<number>();

  constructor(private readonly assets: Assets, private readonly M: Mats) {}

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
    for (const a of this.dinos.values()) this.root.remove(a.obj, a.bar.group, a.blob);
    for (const a of this.troops.values()) this.root.remove(a.obj, a.ring, a.bar.group, a.blob);
    for (const t of this.towers.values()) this.root.remove(t.build.group, t.bar.group);
    for (const g of this.guests.values()) {
      this.root.remove(g.obj);
      if (g.phone) this.root.remove(g.phone);
    }
    for (const c of this.corpses) this.root.remove(c.obj);
    this.dinos.clear();
    this.troops.clear();
    this.towers.clear();
    this.guests.clear();
    this.corpses.length = 0;
    this.firedBy.clear();
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
    const blob = new THREE.Mesh(blobGeo, blobMat);
    const r = DINOS[d.kind].radius / 40;
    blob.scale.set(r * 3.2, 1, r * 3.2);
    blob.renderOrder = 1;
    this.root.add(obj, bar.group, blob);
    return { obj, anim, tpl, rotY: facingToRotY(d.facing), lastX: d.x, lastZ: d.y, speed: 0, lastCooldown: 0, loose: false, faded: false, eyes, bar, blob };
  }

  private makeTroop(u: UnitView): TroopActor {
    const heavy = u.kind === 'heavy';
    const tpl: PersonTemplate = heavy ? this.assets.heavy : this.assets.light[u.id % this.assets.light.length];
    const obj = SkeletonUtils.clone(tpl.gltf.scene);
    obj.scale.setScalar(heavy ? SCALE.heavy : SCALE.light);
    const anim = makeAnim(obj, tpl.gltf.animations);
    play(anim, 'Idle_Gun', { fade: 0, at: this.rnd() });
    const ring = new THREE.Mesh(heavy ? heavyRingGeo : ringGeo, teamRingMat);
    ring.renderOrder = 2;
    const bar = new Bar('#56e07a');
    bar.group.visible = false;
    const blob = new THREE.Mesh(blobGeo, blobMat);
    blob.scale.set(heavy ? 0.62 : 0.5, 1, heavy ? 0.62 : 0.5);
    blob.renderOrder = 1;
    this.root.add(obj, ring, bar.group, blob);
    return { obj, anim, heavy, rotY: facingToRotY(u.facing), lastX: u.x, lastZ: u.y, speed: 0, lastCooldown: u.cooldown, lastHurt: u.hurtAt ?? -1, ring, bar, blob, dying: -1 };
  }

  private makeGuest(v: GuestView): GuestActor {
    const list = this.assets.guests;
    const tpl = list[v.id % list.length];
    const obj = SkeletonUtils.clone(tpl.gltf.scene);
    obj.scale.setScalar(SCALE.guest);
    const r = mulberry32(v.id * 13 + 5);
    const pick = <T>(a: T[]) => a[Math.floor(r() * a.length)];
    const skin = pick(['#f1c9a5', '#e0ac85', '#c68863', '#9a6544', '#6d452c', '#4a2f1f']);
    const hair = pick(['#1c1410', '#3b2516', '#6b4424', '#a87a46', '#d6b77a', '#8d8d8d']);
    const c1 = pick(['#d94a3a', '#e88a2c', '#efd04a', '#4fae5b', '#2f8ccf', '#7a55c7', '#e86aa6', '#f2f2ee', '#22272e', '#3c6e91']);
    const c2 = pick(['#22272e', '#3c4a5e', '#5a4a3a', '#c8b48a', '#2f3b52', '#6b6b6b']);
    obj.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isSkinnedMesh) return;
      const list2 = (Array.isArray(m.material) ? m.material : [m.material]).map((mm) => {
        const c = (mm as THREE.MeshStandardMaterial).clone();
        c.envMapIntensity = 0.5;
        if (/^Skin/.test(c.name)) c.color.set(skin).multiplyScalar(c.name === 'Skin_Darker' ? 0.85 : 1);
        else if (/Hair|Eyebrows|Moustache/.test(c.name)) c.color.set(hair);
        else if (/Shirt|Purple|^Red$|LimeGreen|Orange|Pink|^White$|LightBlue|^Green$|LightGreen|Main/.test(c.name)) c.color.set(c1);
        else if (/Pants|LightBrown|^Brown$|Suit|DarkBrown|Red_Dark/.test(c.name)) c.color.set(c2);
        return c;
      });
      m.material = list2.length === 1 ? list2[0] : list2;
    });
    const anim = makeAnim(obj, tpl.gltf.animations);
    play(anim, 'Walk', { fade: 0, at: r() * 1.5 });
    this.root.add(obj);
    return { obj, anim, rotY: facingToRotY(v.facing ?? 0), lastX: v.x, lastZ: v.y, speed: 0, dying: -1, phone: null };
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
      } else if (d.pose) {
        if (a.anim.current !== d.pose) play(a.anim, d.pose, { fade: 0, at: d.poseAt ?? 0 });
      } else {
        if (a.faded) this.setFade(a, 1);
        const attacked = d.cooldown > a.lastCooldown + 0.05;
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
      // Sedation bar while darts are working.
      const showBar = d.state !== 'secured' && d.sedation > 0;
      a.bar.group.visible = showBar;
      if (showBar) {
        a.bar.set(d.sedation / cfg.sedation);
        a.bar.group.position.set(x, (d.kind === 'trex' ? 1.35 : d.kind === 'raptor' ? 0.62 : 0.95), z);
      }
      a.anim.mixer.update(dt);
    }
    for (const [id, a] of this.dinos) {
      if (seenD.has(id)) continue;
      this.root.remove(a.obj, a.bar.group, a.blob);
      this.dinos.delete(id);
    }

    // Troops and towers.
    const seenU = new Set<number>();
    for (const u of f.units) {
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
      const moved = Math.hypot(u.x - a.lastX, u.y - a.lastZ) / T;
      a.speed += (moved / dt - a.speed) * clamp(dt * 10, 0, 1);
      a.lastX = u.x;
      a.lastZ = u.y;
      a.obj.position.set(x, 0, z);
      a.rotY = turnToward(a.rotY, facingToRotY(u.facing), 10 * dt);
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

    // Guests.
    const seenG = new Set<number>();
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
      a.obj.position.set(x, 0, z);
      a.obj.rotation.y = a.rotY;
      if (v.pose) {
        if (a.anim.current !== v.pose) play(a.anim, v.pose, { fade: 0, at: v.poseAt ?? 0 });
      } else if (a.speed > 1.4 || v.mode === 'fleeing') play(a.anim, 'Run', { speed: clamp(a.speed / 2.4, 0.7, 1.5) });
      else if (a.speed > 0.1 || v.mode === 'walking' || v.mode === 'leaving') play(a.anim, 'Walk', { speed: clamp(a.speed / 1.1, 0.6, 1.4) });
      else play(a.anim, v.id % 4 === 0 ? 'Wave' : 'Idle');
      if (f.night && !a.phone && v.id % 2 === 0) {
        a.phone = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 4), new THREE.MeshBasicMaterial({ color: hdr('#e9f1ff', 8) }));
        this.root.add(a.phone);
      }
      if (a.phone) {
        tmpV.set(Math.sin(a.rotY) * 0.08 + Math.cos(a.rotY) * 0.05, 0.25, Math.cos(a.rotY) * 0.08 - Math.sin(a.rotY) * 0.05);
        a.phone.position.set(x + tmpV.x, tmpV.y, z + tmpV.z);
      }
      a.anim.mixer.update(dt);
    }
    for (const [id, a] of this.guests) {
      if (seenG.has(id)) continue;
      this.guests.delete(id);
      if (a.phone) this.root.remove(a.phone);
      this.root.remove(a.obj);
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

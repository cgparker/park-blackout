// Short-lived and lighting effects: dart tracers, hit puffs, order markers, sparks from live wires,
// and the night lights (troop flashlights, HQ floodlights, tower searchlights) with their visible beams.
import * as THREE from 'three';
import { beamMaterial, TEX } from './materials';
import { hdr, mulberry32, V3 } from './util';

interface Dart {
  mesh: THREE.Mesh;
  from: THREE.Vector3;
  to: THREE.Vector3;
  t: number;
  dur: number;
}

interface Puff {
  sprite: THREE.Sprite;
  t: number;
  dur: number;
  grow: number;
}

interface Marker {
  mesh: THREE.Mesh;
  t: number;
}

interface Beam {
  light: THREE.SpotLight;
  cone: THREE.Mesh;
  len: number;
}

const dartGeo = new THREE.CylinderGeometry(0.007, 0.007, 0.3, 6, 1, true).rotateX(Math.PI / 2);
const dartMat = new THREE.MeshBasicMaterial({ color: hdr('#ffb35a', 5), transparent: true, opacity: 0.95, depthWrite: false });
const heavyDartMat = new THREE.MeshBasicMaterial({ color: hdr('#7fe3ff', 5), transparent: true, opacity: 0.95, depthWrite: false });
const ringGeo = new THREE.RingGeometry(0.2, 0.26, 40).rotateX(-Math.PI / 2);

function coneGeometry(angle: number, len: number): THREE.BufferGeometry {
  const r = Math.tan(angle * 0.92) * len;
  const geo = new THREE.ConeGeometry(r, len, 32, 1, true);
  geo.translate(0, -len / 2, 0);
  geo.rotateX(-Math.PI / 2);
  return geo;
}

export class Effects {
  readonly root = new THREE.Group();
  private readonly darts: Dart[] = [];
  private readonly puffs: Puff[] = [];
  private readonly markers: Marker[] = [];
  private sparks: { sprite: THREE.Sprite; next: number }[] = [];
  private readonly rnd = mulberry32(31);
  private flashlights: Beam[] = [];
  private floods: Beam[] = [];
  private searchlights: Beam[] = [];
  private night = false;

  constructor(private readonly scene: THREE.Scene, private readonly shadows: boolean) {
    scene.add(this.root);
  }

  // ---------------------------------------------- one-offs

  dart(from: THREE.Vector3, to: THREE.Vector3, heavy: boolean): void {
    const mesh = new THREE.Mesh(dartGeo, heavy ? heavyDartMat : dartMat);
    mesh.position.copy(from);
    mesh.lookAt(to);
    mesh.scale.setScalar(heavy ? 1.6 : 1);
    this.root.add(mesh);
    this.darts.push({ mesh, from: from.clone(), to: to.clone(), t: 0, dur: Math.max(0.08, from.distanceTo(to) / 16) });
  }

  puff(x: number, z: number, y: number, color: string, size: number, dur = 0.6): void {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.glow, color: hdr(color, 1), transparent: true, depthWrite: false, opacity: 0.9 }));
    sprite.position.set(x, y, z);
    sprite.scale.setScalar(size * 0.4);
    this.root.add(sprite);
    this.puffs.push({ sprite, t: 0, dur, grow: size });
  }

  marker(x: number, z: number, attack: boolean): void {
    const mesh = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: hdr(attack ? '#ff5a4a' : '#ffd84a', 2), transparent: true, depthWrite: false }));
    mesh.position.set(x, 0.03, z);
    mesh.renderOrder = 3;
    this.root.add(mesh);
    this.markers.push({ mesh, t: 0 });
  }

  /** Flickering sparks where live wires hang broken. */
  setSparks(points: THREE.Vector3[]): void {
    for (const s of this.sparks) this.root.remove(s.sprite);
    this.sparks = points.map((p) => {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.glow, color: hdr('#bff3ff', 6), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      sprite.position.copy(p).add(V3(0, 0.02, 0));
      sprite.scale.setScalar(0.12);
      sprite.visible = false;
      this.root.add(sprite);
      return { sprite, next: this.rnd() * 2 };
    });
  }

  /** Drops darts, puffs, markers, and sparks, for a new game. */
  clear(): void {
    for (const d of this.darts) this.root.remove(d.mesh);
    for (const p of this.puffs) {
      this.root.remove(p.sprite);
      (p.sprite.material as THREE.SpriteMaterial).dispose();
    }
    for (const m of this.markers) {
      this.root.remove(m.mesh);
      (m.mesh.material as THREE.Material).dispose();
    }
    this.darts.length = 0;
    this.puffs.length = 0;
    this.markers.length = 0;
    this.setSparks([]);
  }

  // ---------------------------------------------- night lights

  /**
   * Fixed pools of lights so turning troops on and off never changes the light count
   * (which would make three.js recompile every material mid-game).
   */
  setupNightLights(nFlash: number, floods: { from: THREE.Vector3; to: THREE.Vector3 }[], nSearch: number, shadowLights = { flash: 2, flood: 1, search: 2 }): void {
    const make = (color: string, intensity: number, angle: number, len: number, beamK: number, shadow: boolean, map: number): Beam => {
      const light = new THREE.SpotLight(new THREE.Color(color), 0, len * 2.2, angle, 0.55, 1.6);
      light.userData.on = intensity;
      if (shadow && this.shadows) {
        light.castShadow = true;
        light.shadow.mapSize.set(map, map);
        light.shadow.bias = -0.0006;
        light.shadow.normalBias = 0.02;
        light.shadow.camera.near = 0.05;
        light.shadow.camera.far = len * 2.5;
      }
      const cone = new THREE.Mesh(coneGeometry(angle, len * 1.25), beamMaterial(color, beamK, len * 1.25));
      cone.renderOrder = 5;
      cone.visible = false;
      this.scene.add(light, light.target);
      this.root.add(cone);
      return { light, cone, len };
    };
    this.flashlights = Array.from({ length: nFlash }, (_, i) => make('#e4ecff', 10, 0.33, 4.4, 0.5, i < shadowLights.flash, 1024));
    // One light per mast, aimed between its two lamp heads.
    const masts: { from: THREE.Vector3; to: THREE.Vector3 }[] = [];
    for (let i = 0; i < floods.length; i += 2) {
      const a = floods[i];
      const b = floods[i + 1] ?? a;
      masts.push({ from: a.from.clone().add(b.from).multiplyScalar(0.5), to: a.to.clone().add(b.to).multiplyScalar(0.5) });
    }
    this.floods = masts.map((m, i) => {
      const beam = make('#ffd8a0', 50, 0.44, m.from.distanceTo(m.to), 0.26, i < shadowLights.flood, 2048);
      this.aim(beam, m.from, m.to);
      return beam;
    });
    this.searchlights = Array.from({ length: nSearch }, (_, i) => make('#f2f6ff', 22, 0.24, 3, 0.6, i < shadowLights.search, 1024));
    this.setNight(this.night);
  }

  setNight(night: boolean): void {
    this.night = night;
    for (const b of [...this.flashlights, ...this.floods, ...this.searchlights]) {
      b.light.intensity = night ? (b.light.userData.on as number) : 0;
      b.cone.visible = night;
      b.light.visible = night;
    }
  }

  private aim(b: Beam, from: THREE.Vector3, to: THREE.Vector3): void {
    b.light.position.copy(from);
    b.light.target.position.copy(to);
    b.light.target.updateMatrixWorld();
    b.cone.position.copy(from);
    b.cone.lookAt(to);
  }

  /** Points the flashlight pool at the troops nearest the camera; the rest go dark. */
  updateFlashlights(troops: { pos: THREE.Vector3; dir: THREE.Vector3 }[], focus: THREE.Vector3): void {
    if (!this.night) return;
    const sorted = troops.slice().sort((a, b) => a.pos.distanceToSquared(focus) - b.pos.distanceToSquared(focus));
    this.flashlights.forEach((b, i) => {
      const t = sorted[i];
      if (!t) {
        b.light.intensity = 0;
        b.cone.visible = false;
        return;
      }
      b.light.intensity = b.light.userData.on as number;
      b.cone.visible = true;
      const from = t.pos.clone().add(t.dir.clone().multiplyScalar(0.18));
      const to = t.pos.clone().setY(0).add(t.dir.clone().multiplyScalar(b.len));
      this.aim(b, from, to);
    });
  }

  updateSearchlights(towers: { from: THREE.Vector3; to: THREE.Vector3 }[]): void {
    if (!this.night) return;
    this.searchlights.forEach((b, i) => {
      const t = towers[i];
      b.light.intensity = t ? (b.light.userData.on as number) : 0;
      b.cone.visible = !!t;
      if (t) this.aim(b, t.from, t.to);
    });
  }

  // ---------------------------------------------- per frame

  update(dt: number): void {
    for (let i = this.darts.length - 1; i >= 0; i--) {
      const d = this.darts[i];
      d.t += dt;
      const k = Math.min(1, d.t / d.dur);
      d.mesh.position.lerpVectors(d.from, d.to, k);
      if (k >= 1) {
        this.root.remove(d.mesh);
        this.darts.splice(i, 1);
        this.puff(d.to.x, d.to.z, d.to.y, '#ffd9a0', 0.35, 0.25);
      }
    }
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i];
      p.t += dt;
      const k = p.t / p.dur;
      p.sprite.scale.setScalar(p.grow * (0.4 + k * 0.8));
      (p.sprite.material as THREE.SpriteMaterial).opacity = 0.9 * (1 - k);
      if (k >= 1) {
        this.root.remove(p.sprite);
        (p.sprite.material as THREE.SpriteMaterial).dispose();
        this.puffs.splice(i, 1);
      }
    }
    for (let i = this.markers.length - 1; i >= 0; i--) {
      const m = this.markers[i];
      m.t += dt;
      const k = m.t / 0.6;
      m.mesh.scale.setScalar(1 + k * 0.8);
      (m.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - k;
      if (k >= 1) {
        this.root.remove(m.mesh);
        (m.mesh.material as THREE.Material).dispose();
        this.markers.splice(i, 1);
      }
    }
    for (const s of this.sparks) {
      s.next -= dt;
      if (s.next <= 0) {
        s.sprite.visible = !s.sprite.visible;
        s.next = s.sprite.visible ? 0.03 + this.rnd() * 0.08 : 0.2 + this.rnd() * 1.4;
        s.sprite.scale.setScalar(0.08 + this.rnd() * 0.12);
      }
    }
  }
}

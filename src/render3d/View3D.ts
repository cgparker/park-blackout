// The 3D view: builds the park from the world, follows it every frame, and draws it with three.js.
// It only reads the world. Input and the HUD live in the scene controller.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { VIEW3D } from '../config';
import { buildSegments } from '../core/exhibit';
import { Tile, type Point, type Rect, type TileType } from '../core/grid';
import type { GameEvent } from '../core/world';
import { Actors, type DinoView, type GuestView, type UnitView } from './actors';
import { loadAssets, type Assets } from './assets';
import { Cues } from './cues';
import { bakeDecorShade, instanceParts, planDecor, type DecorKind } from './decor';
import { Effects } from './effects';
import { buildFence, fenceSignature, type FenceBuild, type FenceExhibitView } from './fences';
import { Ghost, type GhostView } from './ghost';
import { addReveal, applyLighting, makeMaterials, REVEAL, setRims, TEX, type Mats } from './materials';
import { buildHQ, buildNest, buildSite, TOWER_DECK, type HqBuild } from './structures';
import { buildSplat, makeGround, makeWater, type Splat, type TerrainSource, type TileWindow } from './terrain';
import { clamp, col, disposeTree, hdr, V3 } from './util';

export interface ViewWorld {
  T: number;
  cols: number;
  rows: number;
  tileAt(x: number, y: number): TileType;
  exhibits: readonly (FenceExhibitView & { viewingSpot: Point })[];
  dinos: readonly DinoView[];
  units: readonly UnitView[];
  guests: readonly GuestView[];
  hq: Rect;
  gate: Point;
  /** World pixels, or null. */
  nest: Point | null;
  powerOn: boolean;
  /** Areas to keep free of trees, in tiles. Stills use it to frame a shot. */
  clear?: readonly Rect[];
}

export type Quality = 'high' | 'low' | 'still';

export interface ViewOptions {
  base: string;
  quality: Quality;
  night: boolean;
  guests: boolean;
}

export interface ViewUi {
  selected: ReadonlySet<number>;
}

/** Height and ground radius, in tiles, of what a canopy must not hide. */
const REVEAL_SIZE: Record<string, readonly [number, number]> = { tranq: [0.55, 0.35], heavy: [0.75, 0.42], raptor: [0.62, 0.5], triceratops: [0.95, 0.8], trex: [1.35, 1.1] };
/** Trees whose canopies dither away over units. */
const CANOPY: readonly DecorKind[] = ['tree', 'pine', 'twisted'];

const GRADE = {
  uniforms: {
    tDiffuse: { value: null },
    vig: { value: 0.28 },
    sat: { value: 1.08 },
    lift: { value: new THREE.Vector3(0.004, 0.003, 0) },
    warm: { value: new THREE.Vector3(1.03, 1, 0.95) },
    aspect: { value: 1 },
    night: { value: 0 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: /* glsl */ `uniform sampler2D tDiffuse; uniform float vig, sat, aspect, night; uniform vec3 lift, warm; varying vec2 vUv;
    void main(){ vec4 c = texture2D(tDiffuse, vUv); float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = mix(vec3(l), c.rgb, sat) * warm + lift;
      float dark = 1.0 - smoothstep(0.02, 0.35, l);
      c.rgb = mix(c.rgb, mix(vec3(l), c.rgb, 0.45) * vec3(0.78, 0.92, 1.35), dark * night);
      vec2 d = (vUv - 0.5) * vec2(aspect, 1.0) * 0.62; float v = 1.0 - vig * smoothstep(0.25, 0.95, length(d));
      gl_FragColor = vec4(c.rgb * v, c.a); }`,
};

function skyEnv(renderer: THREE.WebGLRenderer, night: boolean): THREE.Texture {
  const s = new THREE.Scene();
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: col(night ? '#0a1224' : '#5d8fd6') },
      hor: { value: col(night ? '#1a2238' : '#cfe0f2') },
      gnd: { value: col(night ? '#06080b' : '#59684a') },
      sun: { value: (night ? V3(-0.1, 0.62, -0.78) : V3(-0.55, 0.62, 0.55)).normalize() },
      sunCol: { value: night ? hdr('#c9d6ff', 5) : hdr('#fff3d6', 6) },
    },
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 top, hor, gnd, sun, sunCol; varying vec3 vD;
      void main(){ float y = vD.y; vec3 c = y > 0.0 ? mix(hor, top, pow(y, 0.6)) : mix(hor, gnd, pow(-y, 0.4));
        c += sunCol * pow(max(dot(vD, sun), 0.0), 64.0); gl_FragColor = vec4(c, 1.0); }`,
  });
  s.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), m));
  const pm = new THREE.PMREMGenerator(renderer);
  const tex = pm.fromScene(s, 0, 0.1, 100).texture;
  pm.dispose();
  return tex;
}

export class View3D {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly rig = { x: 20, z: 12, dist: 26 };
  readonly M: Mats;
  assets!: Assets;
  actors!: Actors;
  effects!: Effects;
  night: boolean;
  private composer!: EffectComposer;
  private bloom: UnrealBloomPass | null = null;
  private grade!: ShaderPass;
  private sun!: THREE.DirectionalLight;
  private hemi!: THREE.HemisphereLight;
  private envDay!: THREE.Texture;
  private envNight!: THREE.Texture;
  private statics = new THREE.Group();
  /** Built once per park: the ground, the pond, HQ, and the nest. */
  private fixed = new THREE.Group();
  /** Rebuilt whenever something is built: trees and plants, decks, lamps, and the gate. */
  private dynamic = new THREE.Group();
  private staticKey = '';
  private worldKey = '';
  private splat: Splat | null = null;
  /** Tile types at the last rebuild, to find the block that changed. */
  private lastTiles: Uint8Array | null = null;
  /** Every decor instance, so only the ones near the view are drawn. */
  private decor: { mesh: THREE.InstancedMesh; xs: Float32Array; zs: Float32Array; mats: Float32Array; cols: Float32Array | null }[] = [];
  private cullKey = '';
  private hq: HqBuild | null = null;
  private fences = new Map<number, { sig: string; build: FenceBuild }>();
  private readonly ghost = new Ghost();
  private readonly cues = new Cues();
  private cssW = 1;
  private cssH = 1;
  private readonly raycaster = new THREE.Raycaster();
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private time = 0;
  /** Draw calls and triangles in the last frame, all passes. */
  readonly stats = { calls: 0, triangles: 0 };

  constructor(readonly canvas: HTMLCanvasElement, readonly opts: ViewOptions) {
    this.night = opts.night;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: opts.quality === 'still' });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.camera = new THREE.PerspectiveCamera(VIEW3D.fov, 1, 0.5, 160);
    this.M = makeMaterials();
    this.statics.add(this.fixed, this.dynamic);
    this.scene.add(this.statics, this.ghost.group, this.cues.group);
  }

  get pixelRatio(): number {
    const dpr = window.devicePixelRatio || 1;
    return this.opts.quality === 'low' ? Math.min(dpr, 1.25) : this.opts.quality === 'high' ? Math.min(dpr, 2) : dpr;
  }

  async init(w: ViewWorld, onProgress?: (done: number, total: number) => void): Promise<void> {
    this.assets = await loadAssets(this.M, { base: this.opts.base, guests: this.opts.guests, onProgress });
    this.envDay = skyEnv(this.renderer, false);
    this.envNight = skyEnv(this.renderer, true);
    // Sun by day, moon by night: one shadow-casting light, moved with the camera.
    this.sun = new THREE.DirectionalLight(col('#fff0d9'), 3.1);
    this.sun.castShadow = true;
    const sm = this.opts.quality === 'still' ? 4096 : this.opts.quality === 'high' ? 2048 : 1024;
    this.sun.shadow.mapSize.set(sm, sm);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 80;
    this.hemi = new THREE.HemisphereLight(col('#cfe2ff'), col('#4d5a33'), 0.55);
    this.scene.add(this.sun, this.sun.target, this.hemi);
    this.actors = new Actors(this.assets, this.M);
    this.scene.add(this.actors.root);
    this.effects = new Effects(this.scene, this.opts.quality !== 'low');
    this.buildStatics(w);
    // Each shadow-casting light draws the scene again, so phones get fewer of them.
    const q = this.opts.quality;
    const shadowLights = q === 'still' ? { flash: 2, flood: 1, search: 2 } : q === 'high' ? { flash: 1, flood: 1, search: 0 } : { flash: 0, flood: 0, search: 0 };
    this.effects.setupNightLights(q === 'low' ? 3 : 6, this.hq?.floods ?? [], 2, shadowLights);
    this.setupPost();
    this.setNight(this.night);
    if (this.opts.quality !== 'still') {
      try {
        await this.warmUp();
      } catch (e) {
        // Only a slower first build or blackout; never a reason not to start.
        console.warn('Shader warm-up failed', e);
      }
    }
  }

  /**
   * Compiles every material that can turn up later in a game (each animal, troop, guest, and tower, fences
   * in every state, decks, lamps, and the nest), by day and by night, while the loading screen is up. Without
   * it, the first pen built or the moment the power goes out stalls while the GPU compiles shaders.
   */
  private async warmUp(): Promise<void> {
    const T = 40;
    const cx = this.rig.x;
    const cz = this.rig.z;
    this.setRig(cx, cz, this.rig.dist);
    const at = (dx: number, dz: number) => ({ x: (cx + dx) * T, y: (cz + dz) * T });
    const actors = new Actors(this.assets, this.M);
    const group = new THREE.Group();
    group.add(actors.root);
    const dinos: DinoView[] = (['trex', 'raptor', 'triceratops'] as const).map((kind, i) => ({ id: -1 - i, kind, ...at(i - 1, 0), facing: 0, state: 'loose', sedation: 1, fade: 0, cooldown: 0 }));
    const units: UnitView[] = [
      { id: -10, kind: 'tranq', ...at(-1, 1), facing: 0, hp: 1, maxHp: 2, cooldown: 0 },
      { id: -11, kind: 'heavy', ...at(0, 1), facing: 0, hp: 1, maxHp: 2, cooldown: 0 },
      { id: -12, kind: 'tower', ...at(1, 1), facing: 0, hp: 1, maxHp: 2, cooldown: 0 },
    ];
    const guests: GuestView[] = this.assets.guests.length ? [{ id: -20, ...at(0, -1), mode: 'walking' }] : [];
    // Fences in every look: chain-link and concrete, with and without razor wire, powered or not, intact to wrecked.
    const looks = [['pasture', false], ['raptor', true], ['trex', true], ['trex', false]] as const;
    looks.forEach(([kind, reinforced], i) => {
      const footprint = { x: Math.floor(cx) - 3 + i, y: Math.floor(cz) - 2, w: 3, h: 3 };
      const segments = buildSegments(footprint).map((s, k) => ({ ...s, maxHp: 100, hp: [100, 50, 20, 0][k % 4] }));
      for (const power of [true, false]) group.add(buildFence({ id: -30 - i, kind, footprint, segments, reinforced }, power, this.M, this.scuffMat).group);
    });
    // One of every tree, plant, and rock, set up as the park's decor is: pens bring kinds the open park lacks.
    for (const [kind, variants] of Object.entries(this.assets.nature) as [DecorKind, NonNullable<Assets['nature'][DecorKind]>][]) {
      variants.forEach((parts, i) => {
        for (const m of instanceParts(parts, [{ x: cx + i * 0.3, z: cz, rot: 0, s: 0.1 }], { cast: this.casts(kind), seed: 1 })) {
          if (CANOPY.includes(kind)) for (const mat of Array.isArray(m.material) ? m.material : [m.material]) addReveal(mat);
          m.userData.sharedGeometry = true;
          group.add(m);
        }
      });
    }
    const site = buildSite({ cols: 6, rows: 6, tileAt: (_x, y) => (y === 2 ? Tile.Path : Tile.Grass), gate: { x: 1, y: 2 }, exhibits: [{ footprint: { x: 1, y: 3, w: 3, h: 3 }, viewingSpot: { x: 2, y: 2 } }] }, this.M);
    site.position.set(cx - 3, 0, cz - 3);
    group.add(site, buildNest(cx, cz, this.M));
    this.scene.add(group);
    const night = this.night;
    for (const n of [false, true]) {
      this.setNight(n);
      actors.update({ T, dinos, units, guests, selected: new Set([-10]), night: n, dt: 0.016, now: 0 });
      await this.renderer.compileAsync(this.scene, this.camera);
      // One frame as well, for the shadow and post passes.
      this.followShadow();
      this.composer.render(0.016);
    }
    this.setNight(night);
    actors.clear();
    this.scene.remove(group);
    group.remove(actors.root);
    for (const o of [...group.children]) {
      const im = o as THREE.InstancedMesh;
      if (im.isInstancedMesh) {
        im.dispose();
        group.remove(im);
      }
    }
    disposeTree(group);
  }

  private setupPost(): void {
    const pr = this.pixelRatio;
    const samples = this.opts.quality === 'low' ? 0 : 4;
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.setPixelRatio(pr);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    if (this.opts.quality === 'still') {
      const ao = new GTAOPass(this.scene, this.camera, 1, 1);
      ao.updateGtaoMaterial({ radius: 0.35, distanceExponent: 1.4, thickness: 1.0, scale: 1.0, samples: 16 });
      ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 4, rings: 2, samples: 16 });
      ao.blendIntensity = 0.8;
      this.composer.addPass(ao);
    }
    if (this.opts.quality !== 'low') {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.3, 0.55, 1.1);
      this.composer.addPass(this.bloom);
    }
    this.grade = new ShaderPass(GRADE);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
  }

  setSize(cssW: number, cssH: number): void {
    this.cssW = Math.max(1, cssW);
    this.cssH = Math.max(1, cssH);
    const pr = this.pixelRatio;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(this.cssW, this.cssH, false);
    this.composer?.setPixelRatio(pr);
    this.composer?.setSize(this.cssW, this.cssH);
    this.camera.aspect = this.cssW / this.cssH;
    this.camera.updateProjectionMatrix();
    if (this.grade) this.grade.uniforms.aspect.value = this.cssW / this.cssH;
  }

  setNight(night: boolean): void {
    this.night = night;
    setRims(night);
    applyLighting(this.M, night, true);
    this.effects.setNight(night);
    this.scene.environment = night ? this.envNight : this.envDay;
    this.scene.environmentIntensity = night ? 0.35 : 0.75;
    this.scene.background = col(night ? '#04060a' : '#56703f');
    this.sun.color = col(night ? '#8ea6ff' : '#fff0d9');
    this.sun.intensity = night ? 0.85 : 3.1;
    this.sun.shadow.radius = night ? 3 : 2;
    this.hemi.color = col(night ? '#2a3a5c' : '#cfe2ff');
    this.hemi.groundColor = col(night ? '#0b0d0a' : '#4d5a33');
    this.hemi.intensity = night ? 0.38 : 0.55;
    this.renderer.toneMappingExposure = night ? 1.32 : 1.0;
    if (this.bloom) {
      this.bloom.strength = night ? 0.85 : 0.3;
      this.bloom.threshold = night ? 0.85 : 1.1;
    }
    const u = this.grade?.uniforms;
    if (u) {
      u.vig.value = night ? 0.55 : 0.28;
      u.sat.value = night ? 1.05 : 1.08;
      u.lift.value.set(night ? 0 : 0.004, night ? 0.004 : 0.003, night ? 0.014 : 0);
      u.warm.value.set(night ? 1 : 1.03, 1, night ? 1 : 0.95);
      u.night.value = night ? 0.6 : 0;
    }
    // The fences show their power state; let them rebuild with the night look.
    for (const f of this.fences.values()) f.sig = '';
  }

  /** Lets go of the GPU: for swapping in a view at another quality. */
  dispose(): void {
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }

  /** Forgets the last game: actors, effects, and fences. The ground and decor rebuild for the next world. */
  reset(): void {
    this.actors.clear();
    this.effects.clear();
    this.ghost.set(null);
    this.cues.clear();
    for (const f of this.fences.values()) {
      this.scene.remove(f.build.group);
      disposeTree(f.build.group);
    }
    this.fences.clear();
    this.staticKey = '';
    this.worldKey = '';
  }

  // ---------------------------------------------- camera

  /** Points the camera at a ground point (tiles) from a distance. Stills may pass their own elevation. */
  setRig(x: number, z: number, dist: number, elevationDeg = VIEW3D.elevationDeg): void {
    this.rig.x = x;
    this.rig.z = z;
    this.rig.dist = dist;
    const el = THREE.MathUtils.degToRad(elevationDeg);
    this.camera.position.set(x, Math.sin(el) * dist, z + Math.cos(el) * dist);
    this.camera.lookAt(x, 0, z);
    this.camera.updateMatrixWorld();
  }

  /** Ground point (tiles) under a CSS point in the canvas, or null if the ray misses. */
  groundAt(cssX: number, cssY: number, out = new THREE.Vector3()): THREE.Vector3 | null {
    const ndc = new THREE.Vector2((cssX / this.cssW) * 2 - 1, -(cssY / this.cssH) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    return this.raycaster.ray.intersectPlane(this.groundPlane, out);
  }

  /** CSS position in the canvas of a world point (tiles), and whether it is in front of the camera. */
  project(x: number, y: number, z: number): { x: number; y: number; front: boolean } {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    return { x: ((v.x + 1) / 2) * this.cssW, y: ((1 - v.y) / 2) * this.cssH, front: v.z < 1 };
  }

  get size(): { w: number; h: number } {
    return { w: this.cssW, h: this.cssH };
  }

  // ---------------------------------------------- statics

  private terrainSource(w: ViewWorld): TerrainSource {
    return {
      cols: w.cols,
      rows: w.rows,
      tileAt: (x, y) => w.tileAt(x, y),
      exhibits: w.exhibits,
      hq: w.hq,
      gate: w.gate,
      nest: w.nest ? { x: w.nest.x / w.T, y: w.nest.y / w.T } : null,
      clear: w.clear,
    };
  }

  private keyOf(w: ViewWorld): string {
    let towers = 0;
    for (const u of w.units) if (u.kind === 'tower') towers++;
    return `${w.cols}x${w.rows}|${w.nest ? `${w.nest.x},${w.nest.y}` : '-'}|${w.exhibits.map((e) => `${e.id}:${e.kind}:${e.footprint.x},${e.footprint.y},${e.footprint.w}`).join('|')}#${towers}`;
  }

  /** What only a new park changes: its size, HQ, the gate, and the nest. */
  private worldKeyOf(w: ViewWorld): string {
    return `${w.cols}x${w.rows}|${w.hq.x},${w.hq.y}|${w.gate.x},${w.gate.y}|${w.nest ? `${w.nest.x},${w.nest.y}` : '-'}`;
  }

  /** The block of tiles that changed since the last rebuild, grown by a tile, or null. */
  private changedTiles(w: ViewWorld): TileWindow | null {
    const last = this.lastTiles;
    if (!last || last.length !== w.cols * w.rows) return { x0: 0, z0: 0, x1: w.cols, z1: w.rows };
    let x0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let z1 = -Infinity;
    for (let z = 0; z < w.rows; z++)
      for (let x = 0; x < w.cols; x++) {
        if (last[z * w.cols + x] === w.tileAt(x, z)) continue;
        x0 = Math.min(x0, x);
        z0 = Math.min(z0, z);
        x1 = Math.max(x1, x + 1);
        z1 = Math.max(z1, z + 1);
      }
    return x0 === Infinity ? null : { x0: x0 - 1, z0: z0 - 1, x1: x1 + 1, z1: z1 + 1 };
  }

  private buildStatics(w: ViewWorld): void {
    const src = this.terrainSource(w);
    const wk = this.worldKeyOf(w);
    // The block that changed, or null for the whole park.
    let changed: TileWindow | null = null;
    if (wk !== this.worldKey || !this.splat) {
      // A new park: everything, fences included.
      disposeTree(this.fixed);
      this.fixed.clear();
      if (this.splat) for (const t of [this.splat.a, this.splat.b, this.splat.c]) t.dispose();
      this.splat = buildSplat(src);
      this.fixed.add(makeGround(this.splat, this.assets.terrain), makeWater(this.splat));
      this.hq = buildHQ(w.hq, this.M);
      this.fixed.add(this.hq.group);
      if (w.nest) this.fixed.add(buildNest(w.nest.x / w.T, w.nest.y / w.T, this.M));
      for (const f of this.fences.values()) {
        this.scene.remove(f.build.group);
        disposeTree(f.build.group);
      }
      this.fences.clear();
      this.worldKey = wk;
    } else {
      // Something was built: only the ground around it is redone.
      changed = this.changedTiles(w);
      if (changed) buildSplat(src, this.splat, changed);
    }
    const tiles = new Uint8Array(w.cols * w.rows);
    for (let z = 0; z < w.rows; z++) for (let x = 0; x < w.cols; x++) tiles[z * w.cols + x] = w.tileAt(x, z);
    this.lastTiles = tiles;
    const splat = this.splat;

    // Decor and site props follow every change. Decor shares its models' geometry, so only its own
    // instance buffers are let go.
    for (const o of this.dynamic.children) {
      const im = o as THREE.InstancedMesh;
      if (im.isInstancedMesh) im.dispose();
      else disposeTree(o);
    }
    this.dynamic.clear();
    // Only the decor near the view is drawn (see cullDecor), so the whole park can have it.
    const q = this.opts.quality;
    const tufts = q === 'still' ? 6500 : q === 'high' ? 3200 : 1300;
    const plan = planDecor(src, splat, { grassTufts: tufts, treeDensity: q === 'still' ? 6.6 : q === 'high' ? 5 : 3.8 });
    // Trees near a change can shift a little as spacing works out, so the shade is redone a few tiles around it.
    bakeDecorShade(splat, plan, changed ? { x0: changed.x0 - 3, z0: changed.z0 - 3, x1: changed.x1 + 3, z1: changed.z1 + 3 } : undefined);
    this.decor = [];
    this.cullKey = '';
    let seed = 1;
    for (const [kind, items] of Object.entries(plan) as [DecorKind, typeof plan[DecorKind]][]) {
      const variants = this.assets.nature[kind];
      if (!variants || !items.length) continue;
      const groups: (typeof items)[] = variants.map(() => []);
      items.forEach((it, i) => groups[i % variants.length].push(it));
      const cast = this.casts(kind);
      variants.forEach((parts, i) => {
        for (const m of instanceParts(parts, groups[i], { cast, seed: seed++, vary: kind === 'hedge' ? 0.05 : 0.12 })) {
          if (CANOPY.includes(kind)) for (const mat of Array.isArray(m.material) ? m.material : [m.material]) addReveal(mat);
          this.dynamic.add(m);
          this.trackDecor(m);
        }
      });
    }
    this.dynamic.add(buildSite({ cols: w.cols, rows: w.rows, tileAt: src.tileAt, gate: w.gate, exhibits: w.exhibits }, this.M));
    this.staticKey = this.keyOf(w);
  }

  /** Whether a kind of decor casts shadows. Low quality keeps them for trees only: every caster is drawn again for the shadow map. */
  private casts(kind: DecorKind): boolean {
    return this.opts.quality === 'low' ? CANOPY.includes(kind) : !['grass', 'grassTall', 'wispy', 'clover', 'pebble', 'mushroom', 'flower', 'fern', 'reed'].includes(kind);
  }

  private trackDecor(m: THREE.InstancedMesh): void {
    const mats = (m.instanceMatrix.array as Float32Array).slice();
    const n = m.count;
    const xs = new Float32Array(n);
    const zs = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      xs[i] = mats[i * 16 + 12];
      zs[i] = mats[i * 16 + 14];
    }
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.instanceColor?.setUsage(THREE.DynamicDrawUsage);
    this.decor.push({ mesh: m, xs, zs, mats, cols: m.instanceColor ? (m.instanceColor.array as Float32Array).slice() : null });
  }

  /** The ground the camera sees, as a box in tiles, grown by a margin. */
  viewRect(margin: number): { x0: number; z0: number; x1: number; z1: number } {
    const r = { x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity };
    const p = new THREE.Vector3();
    for (const [sx, sy] of [[0, 0], [this.cssW, 0], [0, this.cssH], [this.cssW, this.cssH]]) {
      if (!this.groundAt(sx, sy, p)) return { x0: -1e4, z0: -1e4, x1: 1e4, z1: 1e4 };
      r.x0 = Math.min(r.x0, p.x);
      r.x1 = Math.max(r.x1, p.x);
      r.z0 = Math.min(r.z0, p.z);
      r.z1 = Math.max(r.z1, p.z);
    }
    return { x0: r.x0 - margin, z0: r.z0 - margin, x1: r.x1 + margin, z1: r.z1 + margin };
  }

  /**
   * Draws only the trees, bushes, and grass near the view (plus a margin for shadows cast into it).
   * Recomputed when the view moves into a new 4-tile cell, not every frame.
   */
  private cullDecor(): void {
    const v = this.viewRect(0);
    // Snapped to 2-tile steps. More room to the south-west: the sun is there, so things just outside
    // the view on that side still throw shadows into it, and tall trees nearer the camera lean into view.
    const q = 2;
    const r = { x0: Math.floor(v.x0 / q) * q - 3, z0: Math.floor(v.z0 / q) * q - 1, x1: Math.ceil(v.x1 / q) * q + 1, z1: Math.ceil(v.z1 / q) * q + 3 };
    const key = `${r.x0},${r.z0},${r.x1},${r.z1}`;
    if (key === this.cullKey) return;
    this.cullKey = key;
    for (const d of this.decor) {
      const a = d.mesh.instanceMatrix.array as Float32Array;
      const ca = d.mesh.instanceColor?.array as Float32Array | undefined;
      let k = 0;
      for (let i = 0; i < d.xs.length; i++) {
        const x = d.xs[i];
        const z = d.zs[i];
        if (x < r.x0 || x > r.x1 || z < r.z0 || z > r.z1) continue;
        if (k !== i || a[k * 16 + 15] === 0) a.set(d.mats.subarray(i * 16, i * 16 + 16), k * 16);
        if (ca && d.cols) ca.set(d.cols.subarray(i * 3, i * 3 + 3), k * 3);
        k++;
      }
      d.mesh.count = k;
      d.mesh.instanceMatrix.needsUpdate = true;
      if (d.mesh.instanceColor) d.mesh.instanceColor.needsUpdate = true;
    }
  }

  private scuffMat = new THREE.MeshStandardMaterial({ map: TEX.scuff, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, roughness: 1 });

  private updateFences(w: ViewWorld): void {
    let changed = false;
    const seen = new Set<number>();
    for (const ex of w.exhibits) {
      seen.add(ex.id);
      const sig = fenceSignature(ex, w.powerOn) + (this.night ? 'n' : 'd');
      const cur = this.fences.get(ex.id);
      if (cur && cur.sig === sig) continue;
      if (cur) {
        this.scene.remove(cur.build.group);
        disposeTree(cur.build.group);
      }
      const build = buildFence(ex, w.powerOn, this.M, this.scuffMat);
      this.scene.add(build.group);
      this.fences.set(ex.id, { sig, build });
      changed = true;
    }
    for (const [id, f] of this.fences) {
      if (seen.has(id)) continue;
      this.scene.remove(f.build.group);
      this.fences.delete(id);
      changed = true;
    }
    if (changed) this.effects.setSparks([...this.fences.values()].flatMap((f) => f.build.sparks));
  }

  // ---------------------------------------------- events

  handle(events: readonly GameEvent[], w: ViewWorld): void {
    const T = w.T;
    for (const e of events) {
      switch (e.type) {
        case 'dart': {
          const dir = V3(e.x1 - e.x0, 0, e.y1 - e.y0).normalize();
          const from = V3(e.x0 / T, e.heavy ? 0.42 : 0.32, e.y0 / T).add(dir.clone().multiplyScalar(e.heavy ? 0.5 : 0.32));
          const to = V3(e.x1 / T, 0.3, e.y1 / T);
          this.effects.dart(from, to, e.heavy);
          let best = -1;
          let bd = 0.6 * T;
          for (const u of w.units) {
            const d = Math.hypot(u.x - e.x0, u.y - e.y0);
            if (d < bd) {
              bd = d;
              best = u.id;
            }
          }
          if (best >= 0) this.actors.firedBy.add(best);
          break;
        }
        case 'fenceHit':
          this.effects.puff(e.x / T, e.y / T, 0.25, w.powerOn ? '#bff3ff' : '#b8ad9a', 0.5, 0.35);
          break;
        case 'built':
        case 'reinforced': {
          // Dust where the crew worked: over the new pen, or along a fence that was rebuilt.
          const ex = w.exhibits.find((x) => x.id === e.exhibitId);
          if (!ex) break;
          const f = ex.footprint;
          for (let i = 0; i < 10; i++) {
            const t = i / 10;
            const side = i % 4;
            const along = side < 2 ? f.x + 0.5 + t * (f.w - 1) : f.y + 0.5 + t * (f.h - 1);
            const x = side < 2 ? along : side === 2 ? f.x + 0.5 : f.x + f.w - 0.5;
            const z = side < 2 ? (side === 0 ? f.y + 0.5 : f.y + f.h - 0.5) : along;
            this.effects.puff(x, z, 0.3, '#cdbf9f', 1.6, 1.1);
          }
          break;
        }
        case 'towerBuilt': {
          const u = w.units.find((x) => x.id === e.unitId);
          if (u) this.effects.puff(Math.floor(u.x / T) + 0.5, Math.floor(u.y / T) + 0.5, 0.3, '#cdbf9f', 1.6, 1.1);
          break;
        }
        case 'breach':
          this.effects.puff(e.x / T, e.y / T, 0.3, '#c9bba2', 1.4, 0.9);
          break;
        case 'bite':
          this.effects.puff(e.x / T, e.y / T, 0.3, '#ff4a3a', 0.45, 0.35);
          break;
        case 'casualty':
          this.effects.puff(e.x / T, e.y / T, 0.3, '#ff4a3a', 0.45, 0.35);
          this.actors.guestDown(e.x / T, e.y / T);
          break;
        default:
          break;
      }
    }
  }

  /** The placement preview, or null to hide it. */
  setGhost(g: GhostView | null): void {
    this.ghost.set(g);
  }

  markMove(x: number, z: number): void {
    this.effects.marker(x, z, false);
  }

  markAttack(x: number, z: number): void {
    this.effects.marker(x, z, true);
  }

  // ---------------------------------------------- frame

  render(w: ViewWorld, ui: ViewUi, dt: number): void {
    this.time += dt;
    if (this.keyOf(w) !== this.staticKey) this.buildStatics(w);
    this.updateFences(w);
    this.actors.update({ T: w.T, dinos: w.dinos, units: w.units, guests: w.guests, selected: ui.selected, night: this.night, dt, now: this.time, view: this.opts.quality === 'still' ? undefined : this.viewRect(1.5) });
    this.cues.update(w.T, w.dinos, w.units);
    if (this.night) {
      const troops: { pos: THREE.Vector3; dir: THREE.Vector3 }[] = [];
      for (const u of w.units) {
        if (u.kind === 'tower' || u.dead) continue;
        const dir = V3(Math.cos(u.facing), 0, Math.sin(u.facing));
        troops.push({ pos: V3(u.x / w.T, u.kind === 'heavy' ? 0.4 : 0.32, u.y / w.T), dir });
      }
      this.effects.updateFlashlights(troops, V3(this.rig.x, 0, this.rig.z));
      const towers: { from: THREE.Vector3; to: THREE.Vector3 }[] = [];
      for (const u of w.units) {
        if (u.kind !== 'tower') continue;
        const x = Math.floor(u.x / w.T) + 0.5;
        const z = Math.floor(u.y / w.T) + 0.5;
        let target: THREE.Vector3 | null = null;
        let bd = 6;
        for (const d of w.dinos) {
          if (d.state !== 'loose') continue;
          const dd = Math.hypot(d.x / w.T - x, d.y / w.T - z);
          if (dd > 0.8 && dd < bd) {
            bd = dd;
            target = V3(d.x / w.T, 0, d.y / w.T);
          }
        }
        towers.push({ from: V3(x + 0.05, TOWER_DECK + 0.25, z - 0.05), to: target ?? V3(x + Math.cos(u.facing) * 2.5, 0, z + Math.sin(u.facing) * 2.5) });
      }
      this.effects.updateSearchlights(towers);
    }
    this.updateReveal(w, ui);
    this.effects.update(dt);
    if (this.hq) this.hq.radar.rotation.y += dt * 1.6;
    this.cullDecor();
    this.followShadow();
    // Count every pass (shadows, the scene, post) for the frame, not just the last one.
    const info = this.renderer.info;
    info.autoReset = false;
    info.reset();
    this.composer.render(dt);
    this.stats.calls = info.render.calls;
    this.stats.triangles = info.render.triangles;
  }

  /** Tells the tree shader where troops and animals are, selected and nearest first, so canopies never hide them. */
  private updateReveal(w: ViewWorld, ui: ViewUi): void {
    const cands: { x: number; z: number; h: number; r: number; pri: number; d: number }[] = [];
    const push = (kind: string, px: number, py: number, pri: number) => {
      const [h, r] = REVEAL_SIZE[kind];
      const x = px / w.T;
      const z = py / w.T;
      cands.push({ x, z, h, r, pri, d: (x - this.rig.x) ** 2 + (z - this.rig.z) ** 2 });
    };
    for (const u of w.units) if (u.kind !== 'tower' && !u.dead) push(u.kind, u.x, u.y, ui.selected.has(u.id) ? 0 : 1);
    for (const d of w.dinos) if (!d.removed && d.fade < 0.9) push(d.kind, d.x, d.y, d.state === 'loose' ? 1 : 2);
    // A placement preview comes first, so the player sees where the pen or tower would go.
    const gf = this.ghost.focus;
    if (gf) cands.push({ x: gf.x, z: gf.z, h: 0, r: gf.r, pri: -1, d: 0 });
    cands.sort((a, b) => a.pri - b.pri || a.d - b.d);
    const cot = 1 / Math.tan(THREE.MathUtils.degToRad(VIEW3D.elevationDeg));
    const pts = REVEAL.pts.value;
    const n = Math.min(pts.length, cands.length);
    for (let i = 0; i < n; i++) {
      const c = cands[i];
      const lift = (c.h * cot) / 2;
      pts[i].set(c.x, c.z - lift, c.r + 0.2, c.r + 0.2 + lift);
    }
    REVEAL.n.value = n;
  }

  /** Fits the sun's shadow map to the ground the camera sees, snapped to texels so edges don't shimmer. */
  private followShadow(): void {
    const v = this.viewRect(1.5);
    const half = clamp(Math.max(v.x1 - v.x0, v.z1 - v.z0) / 2, 4, 48);
    const c = this.sun.shadow.camera;
    // Round the size up in steps so small camera moves don't change the texel size.
    const size = Math.ceil(half / 2) * 2;
    if (c.right !== size) {
      c.left = -size;
      c.right = size;
      c.top = size;
      c.bottom = -size;
      c.updateProjectionMatrix();
    }
    const offset = this.night ? V3(-8, 16, -12) : V3(-15, 17, 10);
    const texel = (size * 2) / this.sun.shadow.mapSize.x;
    const tx = Math.round((v.x0 + v.x1) / 2 / texel) * texel;
    const tz = Math.round((v.z0 + v.z1) / 2 / texel) * texel;
    this.sun.position.set(tx, 0, tz).add(offset);
    this.sun.target.position.set(tx, 0, tz);
    this.sun.target.updateMatrixWorld();
  }

  /** Triangles and objects drawn, by kind of object, for performance work. Main pass only, before culling by three. */
  census(): [string, { meshes: number; tris: number; inst: number }][] {
    const rows: Record<string, { meshes: number; tris: number; inst: number }> = {};
    this.scene.traverseVisible((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const geo = m.geometry;
      const tri = (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
      const im = m as THREE.InstancedMesh;
      const inst = im.isInstancedMesh ? im.count : 1;
      const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.Material;
      let key = (m as THREE.SkinnedMesh).isSkinnedMesh ? `skinned:${m.name}` : im.isInstancedMesh ? `inst:${mat.name}` : '';
      if (!key) {
        let p: THREE.Object3D | null = m.parent;
        while (p && !p.name) p = p.parent;
        key = `mesh:${p?.name || mat.type}`;
      }
      const r = (rows[key] ??= { meshes: 0, tris: 0, inst: 0 });
      r.meshes++;
      r.tris += tri * inst;
      r.inst += inst;
    });
    return Object.entries(rows).sort((a, b) => b[1].tris - a[1].tris);
  }

  /** How many tiles across and deep the camera sees at a given distance. */
  extentAt(dist: number): { w: number; d: number } {
    const vfov = THREE.MathUtils.degToRad(VIEW3D.fov);
    const el = THREE.MathUtils.degToRad(VIEW3D.elevationDeg);
    const h = 2 * dist * Math.tan(vfov / 2);
    return { w: h * this.camera.aspect, d: h / Math.sin(el) };
  }

  /** Lets a controller check a tile type without importing grid helpers. */
  static isPath(t: TileType): boolean {
    return t === Tile.Path || t === Tile.Gate;
  }
}

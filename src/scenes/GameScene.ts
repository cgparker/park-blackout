import Phaser from 'phaser';
import {
  ANIMAL_IDLE,
  CAMERA,
  COLORS,
  ECONOMY,
  EXHIBITS,
  EXHIBIT_KINDS,
  INPUT,
  MAP,
  type AnimalKind,
  type ExhibitKind,
} from '../config';
import { createGrid, Tile, type Grid } from '../core/grid';
import { planPlacement, type PlacementPlan } from '../core/placement';
import { GameState, type Exhibit } from '../core/state';
import type { Hud } from '../ui/hud';

const T = MAP.tileSize;
const WORLD_W = MAP.cols * T;
const WORLD_H = MAP.rows * T;
const DEBUG = new URLSearchParams(window.location.search).has('debug');

interface TouchInfo {
  x: number;
  y: number;
  downX: number;
  downY: number;
}

type Gesture = 'idle' | 'press' | 'pan' | 'pinch';

interface Animal {
  kind: AnimalKind;
  obj: Phaser.GameObjects.Ellipse | Phaser.GameObjects.Triangle | Phaser.GameObjects.Container;
  bounds: { x0: number; y0: number; x1: number; y1: number };
  target: { x: number; y: number } | null;
  wait: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

/** Keeps the camera center inside the map (plus a margin), or centers the map when it all fits. */
function clampAxis(center: number, view: number, world: number, margin: number): number {
  if (view >= world + 2 * margin) return world / 2;
  return clamp(center, view / 2 - margin, world + margin - view / 2);
}

/** Turns `from` toward `to` by at most `maxStep` radians, the short way around. */
function turnToward(from: number, to: number, maxStep: number): number {
  const diff = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + clamp(diff, -maxStep, maxStep);
}

/** Cheap repeatable noise so rocks and water look the same every time. */
function hash(i: number): number {
  const s = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

export class GameScene extends Phaser.Scene {
  private readonly hud: Hud;
  private readonly dpr: number;
  private grid!: Grid;
  private state!: GameState;

  /** Zoom in screen terms: 1 = one world pixel per CSS pixel. */
  private zoomLevel = CAMERA.defaultZoom;
  private cx = WORLD_W / 2;
  private cy = WORLD_H / 2;

  private readonly touches = new Map<number, TouchInfo>();
  private gesture: Gesture = 'idle';
  private panStart = { cx: 0, cy: 0 };
  private pinchStart = { dist: 1, zoom: 1, anchorX: 0, anchorY: 0 };
  private keys: Record<string, Phaser.Input.Keyboard.Key> = {};

  private pathGfx!: Phaser.GameObjects.Graphics;
  private ghostGfx!: Phaser.GameObjects.Graphics;
  private readonly exhibitGfx = new Map<number, Phaser.GameObjects.Graphics>();
  private readonly animals: Animal[] = [];

  private placingKind: ExhibitKind | null = null;
  private placingTile = { x: 0, y: 0 };
  private plan: PlacementPlan | null = null;

  constructor(hud: Hud, dpr: number) {
    super({ key: 'game' });
    this.hud = hud;
    this.dpr = dpr;
  }

  create(): void {
    this.grid = createGrid(MAP);
    this.state = new GameState(this.grid, ECONOMY.startingMoney);

    this.drawGround();
    this.pathGfx = this.add.graphics().setDepth(1);
    this.drawPaths();
    this.drawHQ();
    this.ghostGfx = this.add.graphics().setDepth(10);

    this.setupCamera();
    this.setupInput();

    this.hud.onSelectExhibit = (kind) => this.togglePlacement(kind);
    this.hud.onConfirm = () => this.confirmPlacement();
    this.hud.onCancel = () => this.endPlacement();
    this.refreshHud();

    if (DEBUG) (window as unknown as { __pb: unknown }).__pb = { scene: this, state: this.state, grid: this.grid };
  }

  update(_time: number, deltaMs: number): void {
    const dt = Math.min(deltaMs, 100) / 1000;
    this.updateKeyboardPan(dt);
    this.updateAnimals(dt);
    if (this.plan) this.positionPanel();
  }

  // ---------------------------------------------------------------- drawing

  private drawGround(): void {
    const g = this.add.graphics().setDepth(0);
    g.fillStyle(COLORS.grass, 1).fillRect(0, 0, WORLD_W, WORLD_H);

    g.lineStyle(1, COLORS.gridLine, 0.12);
    for (let x = 0; x <= MAP.cols; x++) g.lineBetween(x * T, 0, x * T, WORLD_H);
    for (let y = 0; y <= MAP.rows; y++) g.lineBetween(0, y * T, WORLD_W, y * T);

    for (let y = 0; y < MAP.rows; y++) {
      for (let x = 0; x < MAP.cols; x++) {
        const t = this.grid.get(x, y);
        const n = hash(y * MAP.cols + x);
        if (t === Tile.Water) {
          g.fillStyle(COLORS.water, 1).fillRect(x * T, y * T, T, T);
          g.fillStyle(COLORS.waterLight, 0.5).fillEllipse(x * T + 10 + n * 18, y * T + 12 + n * 14, 12, 4);
        } else if (t === Tile.Rock) {
          const inset = 3 + n * 3;
          g.fillStyle(COLORS.rock, 1).fillRoundedRect(x * T + inset, y * T + inset, T - inset * 2, T - inset * 2, 9);
          g.fillStyle(COLORS.rockLight, 0.9).fillCircle(x * T + 13 + n * 6, y * T + 13, 4);
        }
      }
    }

    g.lineStyle(4, 0x0b160e, 1).strokeRect(0, 0, WORLD_W, WORLD_H);
  }

  private drawPaths(): void {
    const g = this.pathGfx;
    g.clear();
    g.fillStyle(COLORS.path, 1);
    for (let y = 0; y < MAP.rows; y++) {
      for (let x = 0; x < MAP.cols; x++) {
        if (this.grid.isPathNetwork(x, y)) g.fillRect(x * T, y * T, T, T);
      }
    }
    // Gate: two posts and a bar on the map edge.
    const gx = MAP.gate.x * T;
    const gy = MAP.gate.y * T;
    g.fillStyle(COLORS.gate, 1);
    g.fillRect(gx + 2, gy - 4, 7, T + 8);
    g.fillRect(gx + 2, gy - 8, 14, 7);
    g.fillRect(gx + 2, gy + T + 1, 14, 7);
  }

  private drawHQ(): void {
    const { x, y, w, h } = MAP.hq;
    const px = x * T + 3;
    const py = y * T + 3;
    const pw = w * T - 6;
    const ph = h * T - 6;
    const g = this.add.graphics().setDepth(4);
    g.fillStyle(COLORS.hq, 1).fillRoundedRect(px, py, pw, ph, 10);
    g.lineStyle(3, COLORS.hqTrim, 1).strokeRoundedRect(px, py, pw, ph, 10);
    g.lineStyle(2, COLORS.hqTrim, 0.45).strokeCircle(px + pw / 2, py + ph / 2, Math.min(pw, ph) * 0.36);
    const label = this.add
      .text(px + pw / 2, py + ph / 2, 'HQ', {
        fontFamily: '-apple-system, system-ui, sans-serif',
        fontSize: '26px',
        fontStyle: 'bold',
        color: '#e8f0ff',
      })
      .setOrigin(0.5)
      .setDepth(5);
    label.setResolution(this.dpr * 2);
  }

  private drawExhibit(ex: Exhibit): void {
    let g = this.exhibitGfx.get(ex.id);
    if (!g) {
      g = this.add.graphics().setDepth(2);
      this.exhibitGfx.set(ex.id, g);
    }
    g.clear();

    const { x, y, w, h } = ex.footprint;
    // Ground inside the fence line (the fence runs through the centers of the border tiles).
    g.fillStyle(COLORS.interior[ex.kind], 1).fillRect(x * T + T / 2, y * T + T / 2, (w - 1) * T, (h - 1) * T);

    const color = ex.reinforced ? COLORS.fenceReinforced : COLORS.fencePowered;
    const width = ex.reinforced ? 6 : 4;
    const segs = ex.segments;
    const n = segs.length;
    for (let i = 0; i < n; i++) {
      const s = segs[i];
      const alpha = 0.35 + 0.65 * (s.hp / s.maxHp);
      const sx = (s.x + 0.5) * T;
      const sy = (s.y + 0.5) * T;
      g.lineStyle(width, color, alpha);
      for (const nb of [segs[(i - 1 + n) % n], segs[(i + 1) % n]]) {
        const reach = T / 2 - 2; // small gap shows where one segment ends
        g.lineBetween(sx, sy, sx + Math.sign(nb.x - s.x) * reach, sy + Math.sign(nb.y - s.y) * reach);
      }
      g.fillStyle(color, alpha).fillCircle(sx, sy, width * 0.7);
    }

    // Viewing spot: where visitors will stand and pay.
    const vx = (ex.viewingSpot.x + 0.5) * T;
    const vy = (ex.viewingSpot.y + 0.5) * T;
    g.fillStyle(0x3b2f20, 0.9).fillCircle(vx, vy, 7);
    g.lineStyle(2, COLORS.viewingSpot, 0.9).strokeCircle(vx, vy, 7);
  }

  private drawGhost(): void {
    const g = this.ghostGfx;
    g.clear();
    const plan = this.plan;
    if (!plan) return;

    g.fillStyle(COLORS.path, 0.8);
    for (const p of plan.newPathTiles) g.fillRect(p.x * T + 5, p.y * T + 5, T - 10, T - 10);

    const color = plan.valid ? COLORS.ghostValid : COLORS.ghostInvalid;
    const { x, y, w, h } = plan.footprint;
    g.fillStyle(color, 0.28).fillRect(x * T, y * T, w * T, h * T);
    g.lineStyle(3, color, 0.95).strokeRect(x * T + 1.5, y * T + 1.5, w * T - 3, h * T - 3);
    g.lineStyle(2, color, 0.7).strokeRect(x * T + T / 2, y * T + T / 2, (w - 1) * T, (h - 1) * T);

    if (plan.viewingSpot) {
      g.fillStyle(COLORS.viewingSpot, 0.95).fillCircle((plan.viewingSpot.x + 0.5) * T, (plan.viewingSpot.y + 0.5) * T, 6);
    }
  }

  // ---------------------------------------------------------------- animals

  private spawnAnimals(ex: Exhibit): void {
    const cfg = EXHIBITS[ex.kind];
    const { x, y, w, h } = ex.footprint;
    const pad = cfg.animal === 'trex' ? 26 : 14;
    const bounds = {
      x0: x * T + T / 2 + pad,
      y0: y * T + T / 2 + pad,
      x1: (x + w - 1) * T + T / 2 - pad,
      y1: (y + h - 1) * T + T / 2 - pad,
    };
    for (let i = 0; i < cfg.animalCount; i++) {
      const obj = this.makeAnimal(cfg.animal, rand(bounds.x0, bounds.x1), rand(bounds.y0, bounds.y1));
      obj.rotation = rand(-Math.PI, Math.PI);
      this.animals.push({ kind: cfg.animal, obj, bounds, target: null, wait: rand(0, 1.5) });
    }
  }

  private makeAnimal(kind: AnimalKind, x: number, y: number): Animal['obj'] {
    const color = COLORS.animal[kind];
    switch (kind) {
      case 'triceratops':
        return this.add.ellipse(x, y, 32, 20, color).setStrokeStyle(2, 0x0b2a12, 0.85).setDepth(5);
      case 'raptor':
        return this.add.triangle(x, y, 0, 0, 22, 7.5, 0, 15, color).setStrokeStyle(1.5, 0x4a2500, 0.9).setDepth(5);
      case 'trex': {
        const body = this.add.circle(0, 0, 21, color).setStrokeStyle(2.5, 0x3a0a0a, 0.9);
        const notch = this.add.rectangle(18, 0, 13, 8, COLORS.trexNotch);
        return this.add.container(x, y, [body, notch]).setDepth(5);
      }
    }
  }

  private updateAnimals(dt: number): void {
    for (const a of this.animals) {
      if (a.wait > 0) {
        a.wait -= dt;
        continue;
      }
      if (!a.target) {
        a.target = { x: rand(a.bounds.x0, a.bounds.x1), y: rand(a.bounds.y0, a.bounds.y1) };
      }
      const dx = a.target.x - a.obj.x;
      const dy = a.target.y - a.obj.y;
      const d = Math.hypot(dx, dy);
      const idle = ANIMAL_IDLE[a.kind];
      if (d < 1) {
        a.target = null;
        a.wait = rand(idle.pauseSeconds[0], idle.pauseSeconds[1]);
        continue;
      }
      const step = Math.min(d, idle.speed * dt);
      a.obj.x += (dx / d) * step;
      a.obj.y += (dy / d) * step;
      a.obj.rotation = turnToward(a.obj.rotation, Math.atan2(dy, dx), 6 * dt);
    }
  }

  // ---------------------------------------------------------------- camera

  private setupCamera(): void {
    this.cameras.main.setBackgroundColor(COLORS.background);
    this.layoutViewport();
    // Start at the gate side of the map.
    this.cx = 0;
    this.cy = (MAP.gate.y + 0.5) * T;
    this.applyCamera();
    this.scale.on(Phaser.Scale.Events.RESIZE, () => {
      this.layoutViewport();
      this.applyCamera();
    });
  }

  /** The camera only draws between the top bar and the build bar. */
  private layoutViewport(): void {
    const { top, bottom } = this.hud.insets;
    const y = Math.round(top * this.dpr);
    const h = Math.max(1, Math.round(this.scale.height - (top + bottom) * this.dpr));
    this.cameras.main.setViewport(0, y, this.scale.width, h);
  }

  /** Zoomed all the way out, the whole map fits. */
  private minZoom(): number {
    const cam = this.cameras.main;
    const m = CAMERA.edgeMarginTiles * T;
    const fit = Math.min(cam.width / (WORLD_W + 2 * m), cam.height / (WORLD_H + 2 * m)) / this.dpr;
    return Math.min(fit, CAMERA.maxZoom);
  }

  private applyCamera(): void {
    const cam = this.cameras.main;
    this.zoomLevel = clamp(this.zoomLevel, this.minZoom(), CAMERA.maxZoom);
    const z = this.zoomLevel * this.dpr;
    const m = CAMERA.edgeMarginTiles * T;
    this.cx = clampAxis(this.cx, cam.width / z, WORLD_W, m);
    this.cy = clampAxis(this.cy, cam.height / z, WORLD_H, m);
    cam.setZoom(z);
    cam.centerOn(this.cx, this.cy);
  }

  /** Canvas pixels to world pixels. */
  private screenToWorld(sx: number, sy: number): { x: number; y: number } {
    const cam = this.cameras.main;
    const z = this.zoomLevel * this.dpr;
    return {
      x: this.cx + (sx - (cam.x + cam.width / 2)) / z,
      y: this.cy + (sy - (cam.y + cam.height / 2)) / z,
    };
  }

  /** World pixels to CSS pixels (for positioning HTML over the map). */
  private worldToCss(wx: number, wy: number): { x: number; y: number } {
    const cam = this.cameras.main;
    const z = this.zoomLevel * this.dpr;
    return {
      x: (cam.x + cam.width / 2 + (wx - this.cx) * z) / this.dpr,
      y: (cam.y + cam.height / 2 + (wy - this.cy) * z) / this.dpr,
    };
  }

  /** Zooms while keeping the world point under (sx, sy) in place. */
  private zoomAt(sx: number, sy: number, zoom: number): void {
    const anchor = this.screenToWorld(sx, sy);
    this.setZoomKeeping(anchor.x, anchor.y, sx, sy, zoom);
  }

  private setZoomKeeping(wx: number, wy: number, sx: number, sy: number, zoom: number): void {
    const cam = this.cameras.main;
    this.zoomLevel = clamp(zoom, this.minZoom(), CAMERA.maxZoom);
    const z = this.zoomLevel * this.dpr;
    this.cx = wx - (sx - (cam.x + cam.width / 2)) / z;
    this.cy = wy - (sy - (cam.y + cam.height / 2)) / z;
    this.applyCamera();
  }

  private updateKeyboardPan(dt: number): void {
    const k = this.keys;
    if (!k.W) return;
    const dx = (k.D.isDown || k.RIGHT.isDown ? 1 : 0) - (k.A.isDown || k.LEFT.isDown ? 1 : 0);
    const dy = (k.S.isDown || k.DOWN.isDown ? 1 : 0) - (k.W.isDown || k.UP.isDown ? 1 : 0);
    if (!dx && !dy) return;
    this.cx += (dx * CAMERA.keyPanSpeed * dt) / this.zoomLevel;
    this.cy += (dy * CAMERA.keyPanSpeed * dt) / this.zoomLevel;
    this.applyCamera();
  }

  // ---------------------------------------------------------------- input

  private setupInput(): void {
    this.input.addPointer(2);
    this.input.mouse?.disableContextMenu();
    this.input.on(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);
    this.input.on(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove, this);
    this.input.on(Phaser.Input.Events.POINTER_UP, this.onPointerUp, this);
    this.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onPointerUp, this);
    this.input.on(
      Phaser.Input.Events.POINTER_WHEEL,
      (p: Phaser.Input.Pointer, _over: unknown, _dx: number, dy: number) =>
        this.zoomAt(p.x, p.y, this.zoomLevel * Math.exp(-dy * CAMERA.wheelZoomFactor)),
    );

    const kb = this.input.keyboard;
    if (kb) {
      this.keys = kb.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT', false) as Record<string, Phaser.Input.Keyboard.Key>;
      kb.on('keydown-ESC', () => this.endPlacement());
    }
  }

  private onPointerDown(p: Phaser.Input.Pointer): void {
    if (!p.wasTouch && p.button !== 0) return; // right-click is for unit orders later
    this.touches.set(p.id, { x: p.x, y: p.y, downX: p.x, downY: p.y });
    if (this.touches.size === 1) {
      this.gesture = 'press';
      this.panStart = { cx: this.cx, cy: this.cy };
    } else if (this.touches.size === 2) {
      this.beginPinch();
    }
  }

  private onPointerMove(p: Phaser.Input.Pointer): void {
    const t = this.touches.get(p.id);
    if (!t) return;
    t.x = p.x;
    t.y = p.y;

    if (this.gesture === 'pinch') {
      this.updatePinch();
      return;
    }
    if (this.gesture === 'press' && Math.hypot(t.x - t.downX, t.y - t.downY) > INPUT.tapMoveThreshold * this.dpr) {
      this.gesture = 'pan';
    }
    if (this.gesture === 'pan') {
      const z = this.zoomLevel * this.dpr;
      this.cx = this.panStart.cx - (t.x - t.downX) / z;
      this.cy = this.panStart.cy - (t.y - t.downY) / z;
      this.applyCamera();
    }
  }

  private onPointerUp(p: Phaser.Input.Pointer): void {
    const t = this.touches.get(p.id);
    if (!t) return;
    this.touches.delete(p.id);

    if (this.gesture === 'press') this.handleTap(t.downX, t.downY);

    if (this.touches.size === 0) {
      this.gesture = 'idle';
    } else if (this.gesture === 'pinch' && this.touches.size === 1) {
      // One finger lifted: keep panning with the other one.
      const rest = [...this.touches.values()][0];
      rest.downX = rest.x;
      rest.downY = rest.y;
      this.panStart = { cx: this.cx, cy: this.cy };
      this.gesture = 'pan';
    }
  }

  private beginPinch(): void {
    const [a, b] = [...this.touches.values()];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const anchor = this.screenToWorld(mid.x, mid.y);
    this.pinchStart = {
      dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      zoom: this.zoomLevel,
      anchorX: anchor.x,
      anchorY: anchor.y,
    };
    this.gesture = 'pinch';
  }

  private updatePinch(): void {
    const [a, b] = [...this.touches.values()];
    if (!a || !b) return;
    const dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
    const zoom = (this.pinchStart.zoom * dist) / this.pinchStart.dist;
    this.setZoomKeeping(this.pinchStart.anchorX, this.pinchStart.anchorY, (a.x + b.x) / 2, (a.y + b.y) / 2, zoom);
  }

  private handleTap(sx: number, sy: number): void {
    const cam = this.cameras.main;
    if (sy < cam.y || sy > cam.y + cam.height) return;
    const w = this.screenToWorld(sx, sy);
    const tx = Math.floor(w.x / T);
    const ty = Math.floor(w.y / T);
    if (!this.grid.inBounds(tx, ty)) return;

    if (this.placingKind) {
      this.placingTile = { x: tx, y: ty };
      this.updatePlan();
    }
  }

  // ---------------------------------------------------------------- building

  private togglePlacement(kind: ExhibitKind): void {
    if (this.placingKind === kind) {
      this.endPlacement();
      return;
    }
    this.placingKind = kind;
    // The ghost starts at the nearest open spot to the middle of the view; tap the map to move it.
    this.placingTile = this.findOpenTileNear(kind, Math.floor(this.cx / T), Math.floor(this.cy / T));
    this.updatePlan();
  }

  /** Spirals out from (tx, ty) looking for a spot where the footprint fits and a path can reach it. */
  private findOpenTileNear(kind: ExhibitKind, tx: number, ty: number): { x: number; y: number } {
    const start = { x: clamp(tx, 0, MAP.cols - 1), y: clamp(ty, 0, MAP.rows - 1) };
    const fits = (x: number, y: number) => {
      const reason = planPlacement(this.grid, kind, x, y, Infinity, 0).reason;
      return reason === null;
    };
    for (let r = 0; r <= 10; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = start.x + dx;
          const y = start.y + dy;
          if (this.grid.inBounds(x, y) && fits(x, y)) return { x, y };
        }
      }
    }
    return start;
  }

  private updatePlan(): void {
    const kind = this.placingKind;
    if (!kind) return;
    this.plan = planPlacement(
      this.grid,
      kind,
      this.placingTile.x,
      this.placingTile.y,
      this.state.money,
      this.state.countOf(kind),
    );
    this.drawGhost();
    this.hud.showPlacement(this.plan);
    this.refreshHud();
    this.positionPanel();
  }

  private confirmPlacement(): void {
    if (!this.placingKind) return;
    this.updatePlan(); // re-check against the park as it is right now
    const plan = this.plan;
    if (!plan || !plan.valid) {
      this.hud.toast(plan?.reason ?? 'Can’t build there');
      return;
    }
    const ex = this.state.build(plan);
    this.drawPaths();
    this.drawExhibit(ex);
    this.spawnAnimals(ex);
    this.hud.toast(`${EXHIBITS[ex.kind].name} built`);
    this.endPlacement();
  }

  private endPlacement(): void {
    this.placingKind = null;
    this.plan = null;
    this.ghostGfx.clear();
    this.hud.hidePlacement();
    this.refreshHud();
  }

  private positionPanel(): void {
    if (!this.plan) return;
    const { x, y, w, h } = this.plan.footprint;
    const tl = this.worldToCss(x * T, y * T);
    const br = this.worldToCss((x + w) * T, (y + h) * T);
    this.hud.positionPlacement({ left: tl.x, top: tl.y, right: br.x, bottom: br.y });
  }

  private refreshHud(): void {
    const counts = Object.fromEntries(EXHIBIT_KINDS.map((k) => [k, this.state.countOf(k)])) as Record<ExhibitKind, number>;
    this.hud.setMoney(this.state.money);
    this.hud.updateBuildButtons(this.state.money, counts, this.placingKind);
    this.hud.setHint(this.placingKind ? 'Tap the map to move it. Drag to look around.' : null);
  }
}

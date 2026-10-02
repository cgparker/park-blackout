import Phaser from 'phaser';
import { COLORS, DINO_AI, DINOS, MAP, UNITS, VISITORS, type AnimalKind } from '../config';
import type { Dino } from '../core/dinos';
import type { Exhibit } from '../core/exhibit';
import { Tile, type Rect } from '../core/grid';
import { isTargetable, type Unit } from '../core/units';
import type { GameEvent, World } from '../core/world';

const T = MAP.tileSize;
const WORLD_W = MAP.cols * T;
const WORLD_H = MAP.rows * T;

type DinoObj = Phaser.GameObjects.Ellipse | Phaser.GameObjects.Triangle | Phaser.GameObjects.Container;

interface Floater {
  text: Phaser.GameObjects.Text;
  life: number;
  max: number;
}

interface Tracer {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  life: number;
  heavy: boolean;
}

interface Marker {
  x: number;
  y: number;
  life: number;
  color: number;
}

export interface ViewUi {
  selected: ReadonlySet<number>;
  /** Selection box in world coordinates while dragging. */
  box: Rect | null;
  /** Long-press progress ring (0..1) in world coordinates. */
  press: { x: number; y: number; progress: number } | null;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

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

/** Draws the world. Holds no game rules; everything comes from World. */
export class WorldView {
  private readonly scene: Phaser.Scene;
  private readonly world: World;
  private readonly dpr: number;

  private pathGfx!: Phaser.GameObjects.Graphics;
  private dim!: Phaser.GameObjects.Rectangle;
  private marks!: Phaser.GameObjects.Graphics;
  private visitorGfx!: Phaser.GameObjects.Graphics;
  private overlay!: Phaser.GameObjects.Graphics;
  private gridGfx!: Phaser.GameObjects.Graphics;

  private readonly exhibitGfx = new Map<number, { gfx: Phaser.GameObjects.Graphics; version: number; power: boolean }>();
  private readonly unitObjs = new Map<number, Phaser.GameObjects.Container>();
  /** A tower's base stays square; only its turret turns. */
  private readonly turrets = new Map<number, Phaser.GameObjects.Container>();
  private readonly dinoObjs = new Map<number, DinoObj>();
  private readonly floaters: Floater[] = [];
  private readonly floaterPool: Phaser.GameObjects.Text[] = [];
  private readonly tracers: Tracer[] = [];
  private readonly markers: Marker[] = [];
  private readonly hpTexts = new Map<number, { version: number; texts: Phaser.GameObjects.Text[] }>();
  private showHp = false;
  private powerShown = true;

  constructor(scene: Phaser.Scene, world: World, dpr: number) {
    this.scene = scene;
    this.world = world;
    this.dpr = dpr;
  }

  create(): void {
    this.drawGround();
    this.pathGfx = this.scene.add.graphics().setDepth(1);
    this.drawPaths();
    this.dim = this.scene.add
      .rectangle(-T, -T, WORLD_W + 2 * T, WORLD_H + 2 * T, COLORS.dim, 0.42)
      .setOrigin(0)
      .setDepth(1.5)
      .setVisible(false);
    this.marks = this.scene.add.graphics().setDepth(3);
    this.drawHQ();
    this.visitorGfx = this.scene.add.graphics().setDepth(5);
    this.overlay = this.scene.add.graphics().setDepth(9);
    this.gridGfx = this.scene.add.graphics().setDepth(1.2).setVisible(false);
    this.gridGfx.lineStyle(1, 0xffffff, 0.18);
    for (let x = 0; x <= MAP.cols; x++) this.gridGfx.lineBetween(x * T, 0, x * T, WORLD_H);
    for (let y = 0; y <= MAP.rows; y++) this.gridGfx.lineBetween(0, y * T, WORLD_W, y * T);
  }

  setGridVisible(on: boolean): void {
    this.gridGfx.setVisible(on);
  }

  setHpVisible(on: boolean): void {
    this.showHp = on;
    for (const entry of this.hpTexts.values()) for (const t of entry.texts) t.setVisible(on);
  }

  // ---------------------------------------------------------------- events

  handle(events: readonly GameEvent[]): void {
    for (const e of events) {
      switch (e.type) {
        case 'built':
          this.drawPaths();
          break;
        case 'paid':
          this.float(`+$${e.amount}`, e.x + (Math.random() - 0.5) * 16, e.y - 12, '#ffd166', 1.1);
          break;
        case 'dart':
          this.tracers.push({ x0: e.x0, y0: e.y0, x1: e.x1, y1: e.y1, life: 0.16, heavy: e.heavy });
          break;
        case 'breach':
          this.float('Breach!', e.x, e.y - 14, '#ff7a7a', 1.6);
          break;
        case 'secured':
          this.float('Secured', e.x, e.y - 22, '#cdb4ff', 1.6);
          break;
        case 'casualty':
          this.marks.fillStyle(COLORS.casualty, 0.9).fillCircle(e.x, e.y, 5);
          this.marks.fillStyle(0x4a0000, 0.9).fillCircle(e.x, e.y, 2);
          break;
        case 'unitLost':
          this.marks.lineStyle(3, COLORS.casualty, 0.8);
          this.marks.lineBetween(e.x - 7, e.y - 7, e.x + 7, e.y + 7);
          this.marks.lineBetween(e.x - 7, e.y + 7, e.x + 7, e.y - 7);
          break;
        case 'bite':
          this.markers.push({ x: e.x, y: e.y, life: 0.3, color: COLORS.casualty });
          break;
        case 'charge':
          this.float('Charge!', e.x, e.y - DINOS.trex.radius - 16, '#ff9a4d', 1.2);
          break;
      }
    }
  }

  markMove(x: number, y: number): void {
    this.markers.push({ x, y, life: 0.6, color: COLORS.moveMarker });
  }

  markAttack(x: number, y: number): void {
    this.markers.push({ x, y, life: 0.6, color: COLORS.attackMarker });
  }

  private float(text: string, x: number, y: number, color: string, seconds: number): void {
    let t = this.floaterPool.pop();
    if (!t) {
      t = this.scene.add
        .text(0, 0, '', { fontFamily: '-apple-system, system-ui, sans-serif', fontSize: '15px', fontStyle: 'bold', color: '#ffffff' })
        .setOrigin(0.5)
        .setDepth(11)
        .setShadow(0, 1, 'rgba(0,0,0,0.85)', 3, false, true);
      t.setResolution(this.dpr * 1.5);
    }
    t.setText(text).setColor(color).setPosition(x, y).setAlpha(1).setVisible(true);
    this.floaters.push({ text: t, life: seconds, max: seconds });
  }

  // ---------------------------------------------------------------- per frame

  render(dt: number, ui: ViewUi): void {
    const w = this.world;
    if (w.powerOn !== this.powerShown) {
      this.powerShown = w.powerOn;
      this.dim.setVisible(!w.powerOn);
      this.scene.cameras.main.setBackgroundColor(w.powerOn ? COLORS.background : COLORS.backgroundBlackout);
    }
    for (const ex of w.exhibits) this.syncExhibit(ex);
    this.drawVisitors();
    this.syncDinos(dt);
    this.syncUnits(dt, ui.selected);
    this.drawOverlay(dt, ui);
    this.updateFloaters(dt);
    if (this.showHp) for (const ex of w.exhibits) this.syncHp(ex);
  }

  private syncExhibit(ex: Exhibit): void {
    let entry = this.exhibitGfx.get(ex.id);
    if (!entry) {
      entry = { gfx: this.scene.add.graphics().setDepth(2), version: -1, power: !this.world.powerOn };
      this.exhibitGfx.set(ex.id, entry);
    }
    if (entry.version === ex.version && entry.power === this.world.powerOn) return;
    entry.version = ex.version;
    entry.power = this.world.powerOn;
    this.drawExhibit(entry.gfx, ex);
  }

  private drawExhibit(g: Phaser.GameObjects.Graphics, ex: Exhibit): void {
    g.clear();
    const powered = this.world.powerOn;
    const { x, y, w, h } = ex.footprint;
    const fill = Phaser.Display.Color.IntegerToColor(COLORS.interior[ex.kind]);
    if (!powered) fill.darken(12);
    g.fillStyle(fill.color, 1).fillRect(x * T + T / 2, y * T + T / 2, (w - 1) * T, (h - 1) * T);

    const color = ex.reinforced ? (powered ? COLORS.fenceReinforced : COLORS.fenceReinforcedUnpowered) : powered ? COLORS.fencePowered : COLORS.fenceUnpowered;
    const width = ex.reinforced ? 6 : 4;
    const segs = ex.segments;
    const n = segs.length;
    for (let i = 0; i < n; i++) {
      const s = segs[i];
      if (s.hp <= 0) continue;
      const alpha = 0.3 + 0.7 * (s.hp / s.maxHp);
      const sx = (s.x + 0.5) * T;
      const sy = (s.y + 0.5) * T;
      g.lineStyle(width, color, alpha);
      for (const nb of [segs[(i - 1 + n) % n], segs[(i + 1) % n]]) {
        const reach = T / 2 - 2;
        g.lineBetween(sx, sy, sx + Math.sign(nb.x - s.x) * reach, sy + Math.sign(nb.y - s.y) * reach);
      }
      g.fillStyle(color, alpha).fillCircle(sx, sy, width * 0.7);
    }

    const vx = (ex.viewingSpot.x + 0.5) * T;
    const vy = (ex.viewingSpot.y + 0.5) * T;
    g.fillStyle(0x3b2f20, 0.9).fillCircle(vx, vy, 7);
    g.lineStyle(2, COLORS.viewingSpot, powered ? 0.9 : 0.4).strokeCircle(vx, vy, 7);
  }

  private syncHp(ex: Exhibit): void {
    let entry = this.hpTexts.get(ex.id);
    if (!entry) {
      entry = {
        version: -1,
        texts: ex.segments.map((s) =>
          this.scene.add
            .text((s.x + 0.5) * T, (s.y + 0.5) * T, '', { fontFamily: 'ui-monospace, Menlo, monospace', fontSize: '10px', color: '#ffffff' })
            .setOrigin(0.5)
            .setDepth(10)
            .setShadow(0, 1, 'rgba(0,0,0,0.9)', 2, false, true)
            .setResolution(this.dpr),
        ),
      };
      this.hpTexts.set(ex.id, entry);
    }
    if (entry.version === ex.version) return;
    entry.version = ex.version;
    ex.segments.forEach((s, i) => entry!.texts[i].setText(String(Math.round(s.hp))).setVisible(this.showHp));
  }

  private drawVisitors(): void {
    const g = this.visitorGfx;
    g.clear();
    for (const v of this.world.visitors) {
      if (v.done) continue;
      const fleeing = v.mode === 'fleeing';
      g.fillStyle(fleeing ? COLORS.visitorFleeing : COLORS.visitor, 1).fillCircle(v.x, v.y, VISITORS.radius);
      if (v.contact > 0) g.lineStyle(2, COLORS.casualty, 1).strokeCircle(v.x, v.y, VISITORS.radius + 2);
    }
  }

  private makeDino(kind: AnimalKind): DinoObj {
    const color = COLORS.animal[kind];
    const stroke = COLORS.animalStroke[kind];
    switch (kind) {
      case 'triceratops':
        return this.scene.add.ellipse(0, 0, 32, 20, color).setStrokeStyle(2, stroke, 0.85).setDepth(6);
      case 'raptor':
        return this.scene.add.triangle(0, 0, 0, 0, 22, 7.5, 0, 15, color).setStrokeStyle(1.5, stroke, 0.9).setDepth(6);
      case 'trex': {
        const body = this.scene.add.circle(0, 0, DINOS.trex.radius, color).setStrokeStyle(2.5, stroke, 0.9);
        const notch = this.scene.add.rectangle(18, 0, 13, 8, COLORS.trexNotch);
        return this.scene.add.container(0, 0, [body, notch]).setDepth(6.2);
      }
    }
  }

  private syncDinos(dt: number): void {
    const seen = new Set<number>();
    for (const d of this.world.dinos) {
      seen.add(d.id);
      let obj = this.dinoObjs.get(d.id);
      if (!obj) {
        obj = this.makeDino(d.kind);
        obj.setPosition(d.x, d.y).setRotation(d.facing);
        this.dinoObjs.set(d.id, obj);
      }
      obj.setPosition(d.x, d.y);
      obj.rotation = turnToward(obj.rotation, d.facing, (d.stampede > 0 || d.charge > 0 ? 14 : 7) * dt);
      obj.setAlpha(d.state === 'secured' ? clamp(d.fade / DINO_AI.secureFadeSeconds, 0, 1) : 1);
    }
    for (const [id, obj] of this.dinoObjs) {
      if (!seen.has(id)) {
        obj.destroy();
        this.dinoObjs.delete(id);
      }
    }
  }

  private makeUnit(u: Unit): Phaser.GameObjects.Container {
    const r = UNITS[u.kind].radius;
    if (u.kind === 'tower') {
      const side = T - 8;
      const base = this.scene.add.rectangle(0, 0, side, side, COLORS.tower).setStrokeStyle(2.5, COLORS.towerTrim, 1);
      const turret = this.scene.add.container(0, 0, [
        this.scene.add.rectangle(13, 0, 12, 4, 0xe8f0ff),
        this.scene.add.circle(0, 0, 8, COLORS.unit).setStrokeStyle(2, COLORS.unitStroke, 1),
      ]);
      turret.rotation = u.facing;
      this.turrets.set(u.id, turret);
      return this.scene.add.container(u.x, u.y, [base, turret]).setDepth(5.8);
    }
    const body =
      u.kind === 'tranq'
        ? this.scene.add.circle(0, 0, r, COLORS.unit).setStrokeStyle(2, COLORS.unitStroke, 1)
        : this.scene.add.rectangle(0, 0, r * 2, r * 2, COLORS.unit).setStrokeStyle(2, COLORS.unitStroke, 1);
    const barrel = this.scene.add.rectangle(r + 3, 0, 8, 3, 0xe8f0ff);
    const obj = this.scene.add.container(u.x, u.y, [barrel, body]).setDepth(7);
    obj.rotation = u.facing;
    return obj;
  }

  private syncUnits(dt: number, selected: ReadonlySet<number>): void {
    const seen = new Set<number>();
    for (const u of this.world.units) {
      if (u.dead) continue;
      seen.add(u.id);
      let obj = this.unitObjs.get(u.id);
      if (!obj) {
        obj = this.makeUnit(u);
        this.unitObjs.set(u.id, obj);
      }
      const turret = this.turrets.get(u.id);
      if (turret) {
        turret.rotation = turnToward(turret.rotation, u.facing, 9 * dt);
        continue;
      }
      obj.setPosition(u.x, u.y);
      obj.rotation = turnToward(obj.rotation, u.facing, 9 * dt);
      obj.setDepth(selected.has(u.id) ? 7.5 : 7);
    }
    for (const [id, obj] of this.unitObjs) {
      if (!seen.has(id)) {
        obj.destroy();
        this.unitObjs.delete(id);
        this.turrets.delete(id);
      }
    }
  }

  private bar(x: number, y: number, width: number, frac: number, color: number): void {
    const g = this.overlay;
    g.fillStyle(COLORS.barBack, 0.65).fillRect(x - width / 2 - 1, y - 1, width + 2, 6);
    g.fillStyle(color, 1).fillRect(x - width / 2, y, width * clamp(frac, 0, 1), 4);
  }

  private drawOverlay(dt: number, ui: ViewUi): void {
    const g = this.overlay;
    const w = this.world;
    g.clear();

    // Targets of selected troops.
    const targeted = new Set<number>();
    for (const u of w.units) if (ui.selected.has(u.id) && u.order === 'attack') targeted.add(u.targetId);
    for (const d of w.dinos) {
      if (!targeted.has(d.id)) continue;
      g.lineStyle(2, COLORS.attackMarker, 0.9).strokeCircle(d.x, d.y, DINOS[d.kind].radius + 7);
    }

    for (const u of w.units) {
      if (u.dead) continue;
      const r = UNITS[u.kind].radius;
      if (ui.selected.has(u.id)) {
        g.lineStyle(2.5, COLORS.selection, 1).strokeCircle(u.x, u.y, r + 5);
        if (u.order === 'move' && u.path.length) {
          const end = u.path[u.path.length - 1];
          g.lineStyle(1, COLORS.selection, 0.35).lineBetween(u.x, u.y, end.x, end.y);
        }
      }
      if (u.hp < u.maxHp) this.bar(u.x, u.y - r - 11, 24, u.hp / u.maxHp, u.hp / u.maxHp > 0.35 ? COLORS.hp : COLORS.hpLow);
    }

    for (const d of w.dinos) {
      const cfg = DINOS[d.kind];
      if (d.state !== 'secured' && d.sedation < cfg.sedation) {
        const width = d.kind === 'trex' ? 38 : d.kind === 'triceratops' ? 28 : 22;
        this.bar(d.x, d.y - cfg.radius - 12, width, d.sedation / cfg.sedation, COLORS.sedation);
      }
      if (d.state === 'loose' && isTargetable(w, d) && d.kind !== 'triceratops') {
        g.lineStyle(1.5, COLORS.attackMarker, 0.35).strokeCircle(d.x, d.y, cfg.radius + 3);
      }
      if (d.kind === 'trex' && d.state === 'loose') this.drawTrexIntent(d);
    }

    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= dt;
      if (t.life <= 0) {
        this.tracers.splice(i, 1);
        continue;
      }
      g.lineStyle(t.heavy ? 2.5 : 1.5, COLORS.dart, clamp(t.life / 0.16, 0, 1));
      g.lineBetween(t.x0, t.y0, t.x1, t.y1);
    }

    for (let i = this.markers.length - 1; i >= 0; i--) {
      const m = this.markers[i];
      m.life -= dt;
      if (m.life <= 0) {
        this.markers.splice(i, 1);
        continue;
      }
      const k = 1 - m.life / 0.6;
      g.lineStyle(2, m.color, clamp(m.life / 0.6, 0, 1)).strokeCircle(m.x, m.y, 6 + 14 * k);
    }

    if (ui.box) {
      const b = ui.box;
      g.fillStyle(COLORS.selection, 0.12).fillRect(b.x, b.y, b.w, b.h);
      g.lineStyle(1.5, COLORS.selection, 0.9).strokeRect(b.x, b.y, b.w, b.h);
    }
    if (ui.press && ui.press.progress > 0.15) {
      const p = ui.press;
      g.lineStyle(3, COLORS.selection, 0.85);
      g.beginPath();
      g.arc(p.x, p.y, 22, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp(p.progress, 0, 1));
      g.strokePath();
    }
  }

  /**
   * An orange ring marks the troop or tower the T. rex has locked onto. Before a charge, an orange arc fills
   * around the T. rex and a line points at its target; during the charge it gets an orange ring and a streak.
   */
  private drawTrexIntent(d: Dino): void {
    const g = this.overlay;
    const r = DINOS.trex.radius;
    const lock = d.lockId ? this.world.unitById(d.lockId) : undefined;
    if (lock && !lock.dead) g.lineStyle(2, COLORS.charge, 0.85).strokeCircle(lock.x, lock.y, UNITS[lock.kind].radius + 8);
    if (d.windup > 0) {
      const p = clamp(1 - d.windup / DINO_AI.trexChargeWindupSeconds, 0, 1);
      if (lock && !lock.dead) g.lineStyle(3, COLORS.charge, 0.4).lineBetween(d.x, d.y, lock.x, lock.y);
      g.lineStyle(4, COLORS.charge, 0.95);
      g.beginPath();
      g.arc(d.x, d.y, r + 7, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p);
      g.strokePath();
    } else if (d.charge > 0) {
      g.lineStyle(3, COLORS.charge, 0.9).strokeCircle(d.x, d.y, r + 6);
      g.lineStyle(7, COLORS.charge, 0.3).lineBetween(d.x - d.cdx * (r + 8), d.y - d.cdy * (r + 8), d.x - d.cdx * (r + 48), d.y - d.cdy * (r + 48));
    }
  }

  private updateFloaters(dt: number): void {
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.life -= dt;
      if (f.life <= 0) {
        f.text.setVisible(false);
        this.floaterPool.push(f.text);
        this.floaters.splice(i, 1);
        continue;
      }
      f.text.y -= 18 * dt;
      f.text.setAlpha(clamp(f.life / (f.max * 0.5), 0, 1));
    }
  }

  // ---------------------------------------------------------------- static drawing

  private drawGround(): void {
    const g = this.scene.add.graphics().setDepth(0);
    g.fillStyle(COLORS.grass, 1).fillRect(0, 0, WORLD_W, WORLD_H);
    g.lineStyle(1, COLORS.gridLine, 0.12);
    for (let x = 0; x <= MAP.cols; x++) g.lineBetween(x * T, 0, x * T, WORLD_H);
    for (let y = 0; y <= MAP.rows; y++) g.lineBetween(0, y * T, WORLD_W, y * T);
    const grid = this.world.grid;
    for (let y = 0; y < MAP.rows; y++) {
      for (let x = 0; x < MAP.cols; x++) {
        const t = grid.get(x, y);
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

  drawPaths(): void {
    const g = this.pathGfx;
    const grid = this.world.grid;
    g.clear();
    g.fillStyle(COLORS.path, 1);
    for (let y = 0; y < MAP.rows; y++) {
      for (let x = 0; x < MAP.cols; x++) {
        if (grid.isPathNetwork(x, y)) g.fillRect(x * T, y * T, T, T);
      }
    }
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
    const g = this.scene.add.graphics().setDepth(4);
    g.fillStyle(COLORS.hq, 1).fillRoundedRect(px, py, pw, ph, 10);
    g.lineStyle(3, COLORS.hqTrim, 1).strokeRoundedRect(px, py, pw, ph, 10);
    g.lineStyle(2, COLORS.hqTrim, 0.45).strokeCircle(px + pw / 2, py + ph / 2, Math.min(pw, ph) * 0.36);
    this.scene.add
      .text(px + pw / 2, py + ph / 2, 'HQ', { fontFamily: '-apple-system, system-ui, sans-serif', fontSize: '26px', fontStyle: 'bold', color: '#e8f0ff' })
      .setOrigin(0.5)
      .setDepth(4.5)
      .setResolution(this.dpr * 2);
  }
}

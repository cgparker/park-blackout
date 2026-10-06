import Phaser from 'phaser';
import {
  BLACKOUT,
  CAMERA,
  COLORS,
  DINOS,
  EXHIBITS,
  EXHIBIT_KINDS,
  FIGHT,
  INPUT,
  MAP,
  SCORING,
  SIM,
  UNITS,
  type AnimalKind,
  type ExhibitKind,
  type LevelId,
  type UnitKind,
} from '../config';
import type { Point, Rect } from '../core/grid';
import { planPlacement, planTower, type PlacementPlan, type TowerPlan } from '../core/placement';
import { substationCenter } from '../core/power';
import { cancelQueued, canCommand, enqueueUnit, isTargetable, orderAttack, orderBoard, orderHold, orderMove, orderRepair, passengers, type Unit } from '../core/units';
import { World } from '../core/world';
import type { Params } from '../params';
import { WorldView } from '../render/worldView';
import { formatMoney, type ArrowView, type BriefingOptions, type BuildKind, type Hud } from '../ui/hud';
import { goalsNow } from '../ui/goals';
import { exhibitPlaceView, exhibitView, huntedToast, selectionSummary, startBanner, substationView, towerPlaceView, trainingView } from '../ui/panels';
import { loadTipsOn, saveTipsOn } from '../ui/prefs';
import { tipsFor, type Tip, type TipId } from '../ui/tips';

const T = MAP.tileSize;
const WORLD_W = MAP.cols * T;
const WORLD_H = MAP.rows * T;

interface PointerInfo {
  x: number;
  y: number;
  downX: number;
  downY: number;
  downTime: number;
  touch: boolean;
}

type Gesture = 'idle' | 'press' | 'pan' | 'pinch' | 'box';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Keeps the camera center inside the map (plus a margin), or centers the map when it all fits. */
function clampAxis(center: number, view: number, world: number, margin: number): number {
  if (view >= world + 2 * margin) return world / 2;
  return clamp(center, view / 2 - margin, world + margin - view / 2);
}

/** Settings that survive a Retry. */
interface Session {
  level: LevelId;
  quick: boolean;
  debug: boolean;
  tips: boolean;
}

export class GameScene extends Phaser.Scene {
  private readonly hud: Hud;
  private readonly dpr: number;
  private readonly params: Params;
  private readonly session: Session;

  private world!: World;
  private view!: WorldView;
  private ghostGfx!: Phaser.GameObjects.Graphics;

  /** Zoom in screen terms: 1 = one world pixel per CSS pixel. */
  private zoomLevel = CAMERA.defaultZoom;
  private cx = 0;
  private cy = 0;

  private pointers = new Map<number, PointerInfo>();
  private gesture: Gesture = 'idle';
  private panStart = { cx: 0, cy: 0 };
  private pinchStart = { dist: 1, zoom: 1, anchorX: 0, anchorY: 0 };
  private boxStart = { x: 0, y: 0 };
  private boxEnd = { x: 0, y: 0 };
  private rightDown: { x: number; y: number } | null = null;
  private keys: Record<string, Phaser.Input.Keyboard.Key> = {};

  private placingKind: BuildKind | null = null;
  private placingTile = { x: 0, y: 0 };
  private plan: PlacementPlan | null = null;
  private towerPlan: TowerPlan | null = null;

  private selected = new Set<number>();
  private accumulator = 0;
  private speed = 1;
  private wasAllClear = false;
  private escapeToasts = new Map<string, number>();
  /** Tips already shown this session (Retry doesn't repeat them), and tips waiting their turn. */
  private readonly seenTips = new Set<TipId>();
  private tipQueue: Tip[] = [];
  /** Mission levels: the view the level opened on, to go back to once the opening tips are read. */
  private startFrame: (() => void) | null = null;
  private showFps = false;
  private resizeHandler: (() => void) | null = null;
  /** A camera move in progress (to the park at the blackout, or to an arrow's target). Any pan or zoom cancels it. */
  private camMove: { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; t: number } | null = null;
  /** Fresh fence breaks, shown as edge arrows for a few seconds. */
  private breaches: { x: number; y: number; until: number }[] = [];
  /** Where each edge arrow points, by key, for taps. */
  private arrowTargets = new Map<string, Point>();

  constructor(hud: Hud, dpr: number, params: Params) {
    super({ key: 'game' });
    this.hud = hud;
    this.dpr = dpr;
    this.params = params;
    this.session = { level: params.level ?? 1, quick: false, debug: params.debug, tips: loadTipsOn() };
  }

  create(): void {
    // Everything per-game is set up here, because Retry restarts the scene on the same instance.
    this.world = new World({
      seed: this.params.seed ?? undefined,
      buildPhaseSeconds: this.params.buildPhaseSeconds ?? undefined,
      level: this.session.level,
    });
    this.view = new WorldView(this, this.world, this.dpr);
    this.view.create();
    this.ghostGfx = this.add.graphics().setDepth(10);
    this.pointers = new Map();
    this.gesture = 'idle';
    this.rightDown = null;
    this.placingKind = null;
    this.plan = null;
    this.towerPlan = null;
    this.selected = new Set();
    this.accumulator = 0;
    this.wasAllClear = false;
    this.escapeToasts = new Map();
    this.tipQueue = [];
    this.zoomLevel = CAMERA.defaultZoom;
    this.camMove = null;
    this.breaches = [];
    this.arrowTargets = new Map();

    this.setupCamera();
    this.setupInput();
    this.wireHud();
    this.hud.reset();
    this.hud.showDebug(this.session.debug);
    this.hud.setDebugSpeed(this.speed);
    this.view.setGridVisible((document.getElementById('dbg-grid') as HTMLInputElement | null)?.checked ?? false);
    this.view.setHpVisible((document.getElementById('dbg-hp') as HTMLInputElement | null)?.checked ?? false);
    this.hud.showBriefing({
      level: this.session.level,
      buildSeconds: this.world.buildPhaseSeconds,
      quickSeconds: BLACKOUT.quickBuildPhaseSeconds,
      revenueTarget: this.world.revenueTarget,
      villain: BLACKOUT.villainName,
      quick: this.session.quick,
      debug: this.session.debug,
      tips: this.session.tips,
    });

    if (this.params.debug) (window as unknown as { __pb: unknown }).__pb = { scene: this, world: this.world };

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (this.resizeHandler) this.scale.off(Phaser.Scale.Events.RESIZE, this.resizeHandler);
      this.resizeHandler = null;
    });
  }

  update(time: number, deltaMs: number): void {
    const dt = Math.min(deltaMs, 100) / 1000;
    this.updateKeyboardPan(dt);
    this.updateLongPress(time);

    this.updateCameraMove(dt);

    const w = this.world;
    // An open tip or the pause menu stops the clock. Orders can still be given under a tip.
    if (w.phase !== 'briefing' && w.phase !== 'ended' && !this.hud.tipOpen && !this.hud.menuOpen) {
      this.accumulator += dt * this.speed * w.timeScale;
      let steps = 0;
      while (this.accumulator >= SIM.step && steps < SIM.maxStepsPerFrame) {
        w.update(SIM.step);
        this.accumulator -= SIM.step;
        steps++;
      }
      if (steps >= SIM.maxStepsPerFrame) this.accumulator = 0;
    }

    const events = w.events;
    w.events = [];
    this.view.handle(events);
    this.handleEvents(events);

    // Troops that climbed into the 4x4 leave the selection; select the 4x4 to move them.
    for (const id of this.selected) {
      const u = w.unitById(id);
      if (!u || !canCommand(u)) this.selected.delete(id);
    }
    this.view.render(dt, { selected: this.selected, box: this.gesture === 'box' ? this.boxRect() : null, press: this.pressRing(time) });
    this.refreshHud();
    this.updateArrows();
    if (this.showFps) this.hud.setFps(this.game.loop.actualFps);
  }

  // ---------------------------------------------------------------- HUD wiring

  private wireHud(): void {
    this.hud.handlers = {
      selectBuild: (kind) => this.togglePlacement(kind),
      confirmPlacement: () => this.confirmPlacement(),
      cancelPlacement: () => this.endPlacement(),
      start: (o) => this.startGame(o.quick, o.debug, o.tips),
      selectLevel: (level, o) => {
        // Each level has its own park, so picking one sets up a fresh world behind the briefing.
        this.keepOptions(o);
        this.session.level = level;
        this.scene.restart();
      },
      retry: () => this.scene.restart(),
      nextLevel: () => {
        this.session.level = Math.min(5, this.session.level + 1) as LevelId;
        this.scene.restart();
      },
      openTraining: () => this.openTraining(),
      train: (kind) => this.train(kind),
      cancelQueued: (id) => cancelQueued(this.world, id),
      reinforce: (id) => this.reinforce(id),
      closePanel: () => this.closePanels(),
      selectAll: () => {
        this.selected = new Set(this.world.units.filter(canCommand).map((u) => u.id));
      },
      clearSelection: () => this.selected.clear(),
      hold: () => orderHold(this.world, this.selected),
      selectEngineer: () => {
        const e = this.world.units.find((u) => u.kind === 'engineer' && canCommand(u));
        if (!e) return;
        this.selected = new Set([e.id]);
        if (this.hud.panel) this.closePanels();
        this.moveCamera(e.x, e.y, this.zoomLevel);
      },
      tipDone: () => this.nextTip(),
      openMenu: () => this.openMenu(),
      resume: () => this.hud.hideMenu(),
      endGame: () => {
        this.hud.hideMenu();
        this.world.quit();
      },
      focusArrow: (key) => {
        const p = this.arrowTargets.get(key);
        if (p) this.moveCamera(p.x, p.y, this.zoomLevel);
      },
      tipsOff: () => {
        this.session.tips = false;
        saveTipsOn(false);
        this.tipQueue = [];
        this.hud.hideTip();
        const back = this.startFrame;
        this.startFrame = null;
        back?.();
        this.hud.toast('Tips are off. Turn them back on from the briefing.');
      },
      debugSpeed: (s) => {
        this.speed = s;
        this.hud.setDebugSpeed(s);
      },
      debugBlackout: () => {
        if (this.world.phase === 'build') this.world.startBlackout();
      },
      debugMoney: () => {
        this.world.money += 10000;
      },
      debugToggle: (name, on) => {
        if (name === 'grid') this.view.setGridVisible(on);
        if (name === 'hp') this.view.setHpVisible(on);
        if (name === 'fps') {
          this.showFps = on;
          this.hud.setFps(on ? this.game.loop.actualFps : null);
        }
      },
    };
  }

  /** The briefing's checkboxes, kept for the next game. */
  private keepOptions(o: BriefingOptions): void {
    this.session.quick = o.quick;
    this.session.debug = o.debug;
    if (o.tips !== this.session.tips) saveTipsOn(o.tips);
    this.session.tips = o.tips;
  }

  private startGame(quick: boolean, debug: boolean, tips: boolean): void {
    this.keepOptions({ quick, debug, tips });
    this.world.setBuildPhase(quick ? BLACKOUT.quickBuildPhaseSeconds : (this.params.buildPhaseSeconds ?? BLACKOUT.buildPhaseSeconds));
    this.hud.showDebug(debug);
    this.hud.hideBriefing();
    this.world.start();
  }

  private refreshHud(): void {
    const w = this.world;
    let penned = 0;
    let loose = 0;
    let contained = 0;
    for (const d of w.dinos) {
      if (d.state === 'penned') penned++;
      else if (d.state === 'loose') loose++;
      else if (d.state === 'contained') contained++;
    }
    this.hud.setTop({
      phase: w.phase,
      level: w.level,
      money: w.money,
      spent: w.troopSpending,
      returned: w.returned,
      troopsLost: w.troopsLost,
      fixed: w.fixedCount,
      substations: w.substations.length,
      spotted: w.engineerSpotted,
      killed: w.animalsKilled,
      revenue: w.revenue,
      revenueTarget: w.revenueTarget,
      clockSeconds: w.clockSeconds,
      casualties: w.casualtyTotal,
      casualtyLimit: SCORING.casualtyLimit,
      penned,
      loose,
      secured: w.dinosSecured,
      contained,
      allClear: w.allClear,
      inPark: w.visitors.reduce((n, v) => (v.done ? n : n + 1), 0),
      evacuating: w.evacuating,
    });
    const counts = Object.fromEntries(EXHIBIT_KINDS.map((k) => [k, w.countOf(k)])) as Record<ExhibitKind, number>;
    this.hud.setBuildBar(w.canBuild, w.money, counts, this.placingKind);

    const engineer = w.units.some((u) => u.kind === 'engineer' && canCommand(u));
    this.hud.setTroops(w.units.filter(canCommand).length, this.selected.size, selectionSummary(w.units, this.selected, (u) => passengers(w, u).length), w.queue.length, !w.canBuild, engineer);
    this.hud.setHq(w.trainable.length > 0);

    switch (this.hud.panel) {
      case 'place':
        this.anchorToTiles(this.placementRect());
        break;
      case 'train':
        this.hud.updateTraining(trainingView(this.world));
        this.anchorToTiles(MAP.hq);
        break;
      case 'exhibit': {
        const ex = w.exhibitById(this.hud.shownExhibit);
        if (ex) {
          this.hud.updateExhibit(exhibitView(w, ex.id)!);
          this.anchorToTiles(ex.footprint);
        }
        break;
      }
      case 'substation': {
        const s = w.substationById(this.hud.shownSubstation);
        if (s) {
          this.hud.updateSubstation(substationView(w, s.id)!);
          this.anchorToTiles({ x: s.x, y: s.y, w: 2, h: 2 });
        }
        break;
      }
    }
  }

  private anchorToTiles(r: Rect | undefined): void {
    if (!r) return;
    const tl = this.worldToCss(r.x * T, r.y * T);
    const br = this.worldToCss((r.x + r.w) * T, (r.y + r.h) * T);
    this.hud.anchor({ left: tl.x, top: tl.y, right: br.x, bottom: br.y });
  }

  private handleEvents(events: readonly import('../core/world').GameEvent[]): void {
    const w = this.world;
    // The evacuation banner names the first animal out, so that escape needs no toast of its own.
    const evacuation = events.some((e) => e.type === 'evacuation');
    // A raptor that spots a troop calls the others, so one sighting can come as several events.
    const spotted = new Set<number>();
    for (const e of events) {
      switch (e.type) {
        case 'spotted': {
          if (spotted.has(e.unitId)) break;
          spotted.add(e.unitId);
          if (e.kind === 'engineer') this.hud.showBanner('A raptor is after the Engineer.', 'danger', 3);
          else this.hud.toast(huntedToast(w, e.unitId, e.kind));
          break;
        }
        case 'started':
          if (w.mission) {
            this.hud.showBanner(startBanner(w), 'warn', 4);
            const loose = w.dinos.filter((d) => d.state === 'loose');
            // Level 4 is about the substations; the others about what is loose.
            const subs = w.substations.map((s) => substationCenter(s, T));
            const pts = w.level === 4 ? subs : [...loose, ...(w.nest ? [w.nest] : [])];
            this.frame(pts, true);
            // The opening tips each point the camera at something; when they're done, it goes back to this view.
            this.startFrame = this.session.tips ? () => this.frame(pts, true) : null;
          }
          break;
        case 'warning':
          this.hud.showBanner(`${BLACKOUT.villainName} cuts the power in 1:00`, 'warn');
          break;
        case 'blackout':
          this.endPlacement();
          if (this.hud.panel === 'exhibit') this.closePanels();
          this.hud.showBanner(`${BLACKOUT.villainName} has cut the power.`, 'danger', 4);
          this.frameParkForBlackout();
          break;
        case 'breach':
          this.breaches.push({ x: e.x, y: e.y, until: w.time + CAMERA.breachArrowSeconds });
          break;
        case 'evacuation':
          this.hud.showBanner(
            `${e.kind === 'trex' ? 'The T. rex is' : e.kind === 'raptor' ? 'Raptors are' : 'A Triceratops is'} out. The park is evacuating.`,
            'danger',
            4,
          );
          break;
        case 'escaped': {
          const last = this.escapeToasts.get(e.kind) ?? -Infinity;
          if (evacuation) this.escapeToasts.set(e.kind, w.time);
          else if (w.time - last > 3) {
            this.escapeToasts.set(e.kind, w.time);
            const name = e.kind === 'raptor' ? 'Raptors are loose!' : e.kind === 'trex' ? 'The T. rex is loose!' : 'A Triceratops broke out!';
            this.hud.toast(name);
          }
          break;
        }
        case 'trained':
          this.hud.toast(`${UNITS[e.kind].name} ready`);
          break;
        case 'unitLost':
          this.hud.toast(e.kind === 'jeep' ? 'The Patrol 4x4 is wrecked. Everyone got out.' : `${UNITS[e.kind].name} lost`);
          break;
        case 'secured': {
          // In mission levels the count left is what matters. The last one may end the level, so it needs no toast.
          const left = w.looseCount;
          if (!w.mission) this.hud.toast(`${DINOS[e.kind].name} secured`);
          else if (left) this.hud.toast(`${DINOS[e.kind].name} darted. ${left} to go.`);
          break;
        }
        case 'substationFixed': {
          const s = w.substationById(e.id);
          const held = e.contained ? ` ${e.contained} ${e.contained === 1 ? 'animal' : 'animals'} contained.` : '';
          this.hud.showBanner(e.last ? `The power is back everywhere.${held}` : `${s?.name ?? 'A'} substation fixed.${held}`, 'good', 3.5);
          break;
        }
        case 'killed':
          this.hud.showBanner(`${e.kind === 'trex' ? 'The T. rex' : 'A raptor'} was killed. ${w.animalsKilled} of ${FIGHT.killLimit}.`, 'danger', 3);
          break;
        case 'powerRestored':
          this.hud.showBanner(
            e.contained ? `Power restored. ${e.contained} ${e.contained === 1 ? 'animal' : 'animals'} contained.` : 'Power restored.',
            'good',
            4,
          );
          break;
        case 'ended':
          this.endPlacement();
          this.closePanels();
          this.tipQueue = [];
          this.hud.hideTip();
          this.hud.hideMenu();
          this.hud.setArrows([]);
          // A game ended from the menu shows its results right away; otherwise let the last moment play out.
          this.time.delayedCall(w.result?.reason === 'abandoned' ? 0 : 1200, () => {
            if (w.result) this.hud.showEnd(w.result);
          });
          break;
      }
    }
    const allClear = w.allClear;
    if (allClear && !this.wasAllClear && w.phase === 'blackout') this.hud.showBanner('All clear. Fast-forwarding to power-on.', 'good');
    this.wasAllClear = allClear;
    this.queueTips(events);
  }

  // ---------------------------------------------------------------- pause menu

  private openMenu(): void {
    const w = this.world;
    if (w.phase === 'briefing' || w.phase === 'ended') return;
    if (this.placingKind) this.endPlacement();
    this.hud.showMenu(
      goalsNow({
        phase: w.phase,
        loose: w.looseCount,
        revenue: w.revenue,
        target: w.revenueTarget,
        casualties: w.casualtyTotal,
        level: w.level,
        spent: w.troopSpending,
        timeLeft: w.clockSeconds,
        troopsLost: w.troopsLost,
        killed: w.animalsKilled,
        fixed: w.fixedCount,
        substations: w.substations.length,
        spotted: w.engineerSpotted,
      }),
    );
  }

  // ---------------------------------------------------------------- camera moves and edge arrows

  /** Eases the camera to a point and zoom. Any pan or zoom by the player cancels it. */
  private moveCamera(x: number, y: number, zoom: number): void {
    this.camMove = { x0: this.cx, y0: this.cy, z0: this.zoomLevel, x1: x, y1: y, z1: zoom, t: 0 };
  }

  private updateCameraMove(dt: number): void {
    const m = this.camMove;
    if (!m) return;
    m.t = Math.min(1, m.t + dt / CAMERA.moveSeconds);
    const k = 1 - (1 - m.t) ** 3;
    this.zoomLevel = m.z0 * (m.z1 / m.z0) ** k;
    this.cx = m.x0 + (m.x1 - m.x0) * k;
    this.cy = m.y0 + (m.y1 - m.y0) * k;
    this.applyCamera();
    if (m.t >= 1) this.camMove = null;
  }

  /** At the blackout, frame every exhibit so the first escape happens on screen. */
  private frameParkForBlackout(): void {
    const exs = this.world.exhibits;
    if (!exs.length) return;
    const corners: Point[] = [];
    for (const e of exs) corners.push({ x: e.footprint.x * T, y: e.footprint.y * T }, { x: (e.footprint.x + e.footprint.w) * T, y: (e.footprint.y + e.footprint.h) * T });
    this.frame(corners, false);
  }

  /**
   * Eases the camera to show every point, plus a margin, never closer than the default zoom.
   * With `hq`, HQ is kept in the picture too: levels 1 and 2 start there.
   */
  private frame(points: readonly Point[], hq: boolean): void {
    if (!points.length || this.gesture !== 'idle') return;
    const all = hq ? [...points, { x: MAP.hq.x * T, y: MAP.hq.y * T }, { x: (MAP.hq.x + MAP.hq.w) * T, y: (MAP.hq.y + MAP.hq.h) * T }] : points;
    const x0 = Math.min(...all.map((p) => p.x));
    const y0 = Math.min(...all.map((p) => p.y));
    const x1 = Math.max(...all.map((p) => p.x));
    const y1 = Math.max(...all.map((p) => p.y));
    const m = CAMERA.frameMarginTiles * T;
    const cam = this.cameras.main;
    const fit = Math.min(cam.width / this.dpr / (x1 - x0 + 2 * m), cam.height / this.dpr / (y1 - y0 + 2 * m));
    this.moveCamera((x0 + x1) / 2, (y0 + y1) / 2, clamp(fit, this.minZoom(), CAMERA.defaultZoom));
  }

  /** Arrows at the map edge for loose animals and fresh fence breaks that are off screen. Tap one to look there. */
  private updateArrows(): void {
    const w = this.world;
    this.arrowTargets.clear();
    if (w.phase !== 'blackout' && w.phase !== 'restored' && w.phase !== 'mission') {
      this.hud.setArrows([]);
      return;
    }
    this.breaches = this.breaches.filter((b) => b.until > w.time);
    const targets: { kind: AnimalKind | 'breach'; x: number; y: number; count: number }[] = [];
    const join = (kind: AnimalKind | 'breach', x: number, y: number) => {
      const near = targets.find((t) => t.kind === kind && Math.hypot(t.x - x, t.y - y) <= CAMERA.arrowGroupTiles * T);
      if (!near) {
        targets.push({ kind, x, y, count: 1 });
        return;
      }
      near.x = (near.x * near.count + x) / (near.count + 1);
      near.y = (near.y * near.count + y) / (near.count + 1);
      near.count++;
    };
    for (const d of w.dinos) if (d.state === 'loose') join(d.kind, d.x, d.y);
    for (const b of this.breaches) join('breach', b.x, b.y);
    const urgency: Record<AnimalKind | 'breach', number> = { trex: 0, raptor: 1, breach: 2, triceratops: 3 };
    targets.sort((a, b) => urgency[a.kind] - urgency[b.kind]);

    const cam = this.cameras.main;
    const left = cam.x / this.dpr;
    const top = cam.y / this.dpr;
    const right = (cam.x + cam.width) / this.dpr;
    const bottom = (cam.y + cam.height) / this.dpr;
    const mx = (left + right) / 2;
    const my = (top + bottom) / 2;
    const hw = (right - left) / 2 - CAMERA.arrowInsetPx;
    const hh = (bottom - top) / 2 - CAMERA.arrowInsetPx;
    const out: ArrowView[] = [];
    const banner = this.hud.bannerBox;
    const r = CAMERA.arrowInsetPx;
    for (const t of targets) {
      const p = this.worldToCss(t.x, t.y);
      if (p.x >= left && p.x <= right && p.y >= top && p.y <= bottom) continue;
      const dx = p.x - mx;
      const dy = p.y - my;
      const s = Math.min(hw / Math.max(Math.abs(dx), 1e-6), hh / Math.max(Math.abs(dy), 1e-6));
      const x = mx + dx * s;
      let y = my + dy * s;
      // Step below the banner rather than cover it. The arrow still points the right way.
      if (banner && x > banner.left - r && x < banner.right + r && y > banner.top - r && y < banner.bottom + r) y = banner.bottom + r;
      if (out.some((a) => Math.hypot(a.x - x, a.y - y) < CAMERA.arrowSpacingPx)) continue;
      const key = `${t.kind}-${out.length}`;
      this.arrowTargets.set(key, { x: t.x, y: t.y });
      out.push({ key, x, y, angle: Math.atan2(dy, dx), kind: t.kind, count: t.count });
    }
    this.hud.setArrows(out);
  }

  // ---------------------------------------------------------------- tips

  /** Each tip shows once per session, and only while tips are on and the game is running. */
  private queueTips(events: readonly import('../core/world').GameEvent[]): void {
    const w = this.world;
    if (!this.session.tips || w.phase === 'briefing' || w.phase === 'ended' || !events.length) return;
    for (const tip of tipsFor(w, events)) {
      if (this.seenTips.has(tip.id)) continue;
      this.seenTips.add(tip.id);
      this.tipQueue.push(tip);
    }
    if (!this.hud.tipOpen) this.nextTip();
  }

  /** Closes the open tip and shows the next one waiting, pointing the camera at what it's about. */
  private nextTip(): void {
    const tip = this.world.phase === 'ended' ? undefined : this.tipQueue.shift();
    if (!tip) {
      this.hud.hideTip();
      const back = this.startFrame;
      this.startFrame = null;
      back?.();
      return;
    }
    this.hud.showTip(tip.title, tip.body);
    if (tip.focus) this.focusAboveTip(tip.focus.x, tip.focus.y);
  }

  /** Puts a world point in the middle of the map area the tip card leaves uncovered. */
  private focusAboveTip(wx: number, wy: number): void {
    // The tip's subject wins over any camera move still easing.
    this.camMove = null;
    const cam = this.cameras.main;
    const top = cam.y / this.dpr;
    const bottom = (cam.y + cam.height) / this.dpr;
    const centerY = (top + bottom) / 2;
    const targetY = (top + Math.min(bottom, this.hud.tipTop)) / 2;
    this.cx = wx;
    this.cy = wy - (targetY - centerY) / this.zoomLevel;
    this.applyCamera();
  }

  // ---------------------------------------------------------------- panels

  private closePanels(): void {
    if (this.placingKind) this.endPlacement();
    this.hud.closePanels();
  }

  private openTraining(): void {
    if (this.world.phase === 'briefing' || this.world.phase === 'ended') return;
    if (this.placingKind) this.endPlacement();
    this.hud.showTraining(trainingView(this.world));
    this.anchorToTiles(MAP.hq);
  }

  private train(kind: UnitKind): void {
    if (!enqueueUnit(this.world, kind)) this.hud.toast(this.world.money < UNITS[kind].cost ? 'Not enough money' : 'The queue is full');
  }

  private openExhibit(id: number): void {
    const v = exhibitView(this.world, id);
    if (!v) return;
    this.hud.showExhibit(v);
    const ex = this.world.exhibitById(id)!;
    this.anchorToTiles(ex.footprint);
  }

  private reinforce(id: number): void {
    if (this.world.reinforce(id)) this.hud.toast('Fence reinforced');
    else this.hud.toast('Not enough money');
  }

  // ---------------------------------------------------------------- camera

  private setupCamera(): void {
    this.cameras.main.setBackgroundColor(COLORS.background);
    this.layoutViewport();
    this.cx = 0;
    this.cy = (MAP.gate.y + 0.5) * T;
    this.applyCamera();
    this.resizeHandler = () => {
      this.layoutViewport();
      this.applyCamera();
    };
    this.scale.on(Phaser.Scale.Events.RESIZE, this.resizeHandler);
  }

  /** The camera only draws between the top bar and the bottom bar. */
  private layoutViewport(): void {
    const { top, bottom } = this.hud.insets;
    const y = Math.round(top * this.dpr);
    const h = Math.max(1, Math.round(this.scale.height - (top + bottom) * this.dpr));
    this.cameras.main.setViewport(0, y, this.scale.width, h);
  }

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
    return { x: this.cx + (sx - (cam.x + cam.width / 2)) / z, y: this.cy + (sy - (cam.y + cam.height / 2)) / z };
  }

  /** World pixels to CSS pixels (for positioning HTML over the map). */
  private worldToCss(wx: number, wy: number): { x: number; y: number } {
    const cam = this.cameras.main;
    const z = this.zoomLevel * this.dpr;
    return { x: (cam.x + cam.width / 2 + (wx - this.cx) * z) / this.dpr, y: (cam.y + cam.height / 2 + (wy - this.cy) * z) / this.dpr };
  }

  private zoomAt(sx: number, sy: number, zoom: number): void {
    const a = this.screenToWorld(sx, sy);
    this.setZoomKeeping(a.x, a.y, sx, sy, zoom);
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
    this.camMove = null;
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
    this.input.on(Phaser.Input.Events.POINTER_WHEEL, (p: Phaser.Input.Pointer, _over: unknown, _dx: number, dy: number) => {
      this.camMove = null;
      this.zoomAt(p.x, p.y, this.zoomLevel * Math.exp(-dy * CAMERA.wheelZoomFactor));
    });
    const kb = this.input.keyboard;
    if (kb) {
      this.keys = kb.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT', false) as Record<string, Phaser.Input.Keyboard.Key>;
      // Phaser handles a key as it arrives and again each frame until the frame ends, and can hand an earlier
      // key event over a second time when several arrive within one slow frame. Each event acts once.
      const handled = new WeakSet<KeyboardEvent>();
      const fresh = (e: KeyboardEvent) => !handled.has(e) && !!handled.add(e);
      kb.on('keydown-ESC', (e: KeyboardEvent) => {
        if (!fresh(e)) return;
        if (this.hud.menuOpen) this.hud.hideMenu();
        else if (this.hud.tipOpen) this.nextTip();
        else if (this.placingKind) this.endPlacement();
        else if (this.hud.panel) this.closePanels();
        else if (this.selected.size) this.selected.clear();
        else this.openMenu();
      });
      kb.on('keydown-P', (e: KeyboardEvent) => {
        if (fresh(e)) (this.hud.menuOpen ? this.hud.hideMenu() : this.openMenu());
      });
      kb.on('keydown-H', (e: KeyboardEvent) => {
        if (fresh(e) && this.world.phase !== 'briefing') orderHold(this.world, this.selected);
      });
    }
  }

  private get blocked(): boolean {
    return this.world.phase === 'briefing';
  }

  private onPointerDown(p: Phaser.Input.Pointer): void {
    if (this.blocked) return;
    this.camMove = null;
    const touch = p.wasTouch;
    if (!touch && p.button === 2) {
      this.rightDown = { x: p.x, y: p.y };
      return;
    }
    const info: PointerInfo = { x: p.x, y: p.y, downX: p.x, downY: p.y, downTime: this.time.now, touch };
    this.pointers.set(p.id, info);
    if (!touch && p.button === 1) {
      this.gesture = 'pan';
      this.panStart = { cx: this.cx, cy: this.cy };
    } else if (this.pointers.size === 1) {
      this.gesture = 'press';
      this.panStart = { cx: this.cx, cy: this.cy };
    } else if (this.pointers.size === 2) {
      this.beginPinch();
    }
  }

  private onPointerMove(p: Phaser.Input.Pointer): void {
    const info = this.pointers.get(p.id);
    if (!info) return;
    info.x = p.x;
    info.y = p.y;
    if (this.gesture === 'pinch') {
      this.updatePinch();
      return;
    }
    const moved = Math.hypot(info.x - info.downX, info.y - info.downY) > INPUT.tapMoveThreshold * this.dpr;
    if (this.gesture === 'press' && moved) {
      if (info.touch) {
        this.gesture = 'pan';
      } else {
        this.gesture = 'box';
        this.boxStart = this.screenToWorld(info.downX, info.downY);
      }
    }
    if (this.gesture === 'pan') {
      const z = this.zoomLevel * this.dpr;
      this.cx = this.panStart.cx - (info.x - info.downX) / z;
      this.cy = this.panStart.cy - (info.y - info.downY) / z;
      this.applyCamera();
    } else if (this.gesture === 'box') {
      this.boxEnd = this.screenToWorld(info.x, info.y);
    }
  }

  private onPointerUp(p: Phaser.Input.Pointer): void {
    if (this.rightDown && !p.wasTouch && (p.button === 2 || this.pointers.size === 0)) {
      const moved = Math.hypot(p.x - this.rightDown.x, p.y - this.rightDown.y) > INPUT.tapMoveThreshold * this.dpr;
      const at = this.rightDown;
      this.rightDown = null;
      if (!moved && !this.blocked) this.command(at.x, at.y);
      if (!this.pointers.has(p.id)) return;
    }
    const info = this.pointers.get(p.id);
    if (!info) return;
    this.pointers.delete(p.id);

    if (this.gesture === 'press') this.handleTap(info.downX, info.downY);
    else if (this.gesture === 'box') this.finishBox();

    if (this.pointers.size === 0) {
      this.gesture = 'idle';
    } else if (this.gesture === 'pinch' && this.pointers.size === 1) {
      const rest = [...this.pointers.values()][0];
      rest.downX = rest.x;
      rest.downY = rest.y;
      this.panStart = { cx: this.cx, cy: this.cy };
      this.gesture = 'pan';
    }
  }

  /** Hold still for a moment, then drag, to draw a selection box. */
  private updateLongPress(now: number): void {
    if (this.gesture !== 'press' || this.pointers.size !== 1 || this.placingKind) return;
    const info = [...this.pointers.values()][0];
    if (!info.touch || now - info.downTime < INPUT.longPressMs) return;
    this.gesture = 'box';
    this.boxStart = this.screenToWorld(info.downX, info.downY);
    this.boxEnd = this.screenToWorld(info.x, info.y);
  }

  private pressRing(now: number): { x: number; y: number; progress: number } | null {
    if (this.gesture !== 'press' || this.pointers.size !== 1 || this.placingKind) return null;
    const info = [...this.pointers.values()][0];
    if (!info.touch) return null;
    const p = this.screenToWorld(info.downX, info.downY);
    return { x: p.x, y: p.y, progress: (now - info.downTime) / INPUT.longPressMs };
  }

  private boxRect(): Rect {
    const x = Math.min(this.boxStart.x, this.boxEnd.x);
    const y = Math.min(this.boxStart.y, this.boxEnd.y);
    return { x, y, w: Math.abs(this.boxEnd.x - this.boxStart.x), h: Math.abs(this.boxEnd.y - this.boxStart.y) };
  }

  private finishBox(): void {
    const b = this.boxRect();
    const picked = this.world.units.filter((u) => canCommand(u) && u.x >= b.x && u.x <= b.x + b.w && u.y >= b.y && u.y <= b.y + b.h);
    this.selected = new Set(picked.map((u) => u.id));
    if (picked.length) this.closePanels();
  }

  private beginPinch(): void {
    const [a, b] = [...this.pointers.values()];
    const anchor = this.screenToWorld((a.x + b.x) / 2, (a.y + b.y) / 2);
    this.pinchStart = { dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), zoom: this.zoomLevel, anchorX: anchor.x, anchorY: anchor.y };
    this.gesture = 'pinch';
  }

  private updatePinch(): void {
    const [a, b] = [...this.pointers.values()];
    if (!a || !b) return;
    const dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
    this.setZoomKeeping(this.pinchStart.anchorX, this.pinchStart.anchorY, (a.x + b.x) / 2, (a.y + b.y) / 2, (this.pinchStart.zoom * dist) / this.pinchStart.dist);
  }

  /** True when a canvas y coordinate is on the map, not under the top or bottom bar. */
  private inView(sy: number): boolean {
    const cam = this.cameras.main;
    return sy >= cam.y && sy <= cam.y + cam.height;
  }

  private handleTap(sx: number, sy: number): void {
    if (!this.inView(sy) || this.world.phase === 'ended') return;
    const p = this.screenToWorld(sx, sy);
    const tx = Math.floor(p.x / T);
    const ty = Math.floor(p.y / T);

    if (this.placingKind) {
      if (!this.world.grid.inBounds(tx, ty)) return;
      this.placingTile = { x: tx, y: ty };
      this.updatePlan();
      return;
    }

    const unit = this.unitAt(p.x, p.y);
    // With troops selected, tapping the 4x4 loads them into it.
    if (unit?.kind === 'jeep' && this.boardersSelected(unit)) {
      this.command(sx, sy);
      return;
    }
    if (unit) {
      this.selected = new Set([unit.id]);
      if (this.hud.panel) this.closePanels();
      return;
    }
    const { hq } = MAP;
    // Level 5 trains nothing, so a tap on HQ is just a tap on the map.
    if (this.world.trainable.length && tx >= hq.x && ty >= hq.y && tx < hq.x + hq.w && ty < hq.y + hq.h) {
      this.openTraining();
      return;
    }
    if (this.selected.size) {
      this.command(sx, sy);
      return;
    }
    const sub = this.world.substationAtTile(tx, ty);
    if (sub) {
      this.openSubstation(sub.id);
      return;
    }
    const ex = this.world.exhibitAtTile(tx, ty);
    if (ex) this.openExhibit(ex.id);
    else this.closePanels();
  }

  /** True when the selection has troops other than this 4x4, which a tap on it would load. */
  private boardersSelected(jeep: Unit): boolean {
    for (const id of this.selected) {
      const u = this.world.unitById(id);
      if (u && u !== jeep && u.kind !== 'jeep') return true;
    }
    return false;
  }

  /** Move or attack with the selected troops, fix a substation with Engineers, or load troops into the 4x4. */
  private command(sx: number, sy: number): void {
    if (!this.selected.size || !this.inView(sy) || this.world.phase === 'ended') return;
    const w = this.world;
    const p = this.screenToWorld(sx, sy);
    const jeep = this.unitAt(p.x, p.y);
    if (jeep?.kind === 'jeep' && this.boardersSelected(jeep)) {
      orderBoard(w, [...this.selected].filter((id) => id !== jeep.id), jeep.id);
      this.view.markMove(jeep.x, jeep.y);
      return;
    }
    const dino = this.dinoAt(p.x, p.y);
    if (dino) {
      orderAttack(w, this.selected, dino.id);
      this.view.markAttack(dino.x, dino.y);
      return;
    }
    // With an Engineer selected, a tap on a broken substation or the tiles around it sends it to the side tapped.
    const tx = Math.floor(p.x / T);
    const ty = Math.floor(p.y / T);
    const engineer = [...this.selected].some((id) => w.unitById(id)?.kind === 'engineer');
    const near = engineer ? w.substationNearTile(tx, ty) : undefined;
    const sub = near && !near.fixed ? near : w.substationAtTile(tx, ty);
    if (sub) {
      const to = orderRepair(w, this.selected, sub.id, engineer ? p : undefined) ?? substationCenter(sub, T);
      this.view.markMove(to.x, to.y);
      return;
    }
    orderMove(w, this.selected, p.x, p.y);
    this.view.markMove(p.x, p.y);
  }

  private openSubstation(id: number): void {
    const v = substationView(this.world, id);
    if (!v) return;
    if (this.placingKind) this.endPlacement();
    this.hud.showSubstation(v);
    const s = this.world.substationById(id)!;
    this.anchorToTiles({ x: s.x, y: s.y, w: 2, h: 2 });
  }

  /** The troop or 4x4 under a tap. Towers can't be selected, and troops in the 4x4 aren't on the map. */
  private unitAt(x: number, y: number) {
    const slop = INPUT.tapSlop / this.zoomLevel;
    let best = null;
    let bestD = Infinity;
    for (const u of this.world.units) {
      if (!canCommand(u)) continue;
      const d = Math.hypot(u.x - x, u.y - y);
      if (d <= UNITS[u.kind].radius + slop && d < bestD) {
        bestD = d;
        best = u;
      }
    }
    return best;
  }

  private dinoAt(x: number, y: number) {
    const slop = INPUT.tapSlop / this.zoomLevel;
    let best = null;
    let bestD = Infinity;
    for (const d of this.world.dinos) {
      if (!isTargetable(this.world, d)) continue;
      const dd = Math.hypot(d.x - x, d.y - y);
      if (dd <= DINOS[d.kind].radius + slop && dd < bestD) {
        bestD = dd;
        best = d;
      }
    }
    return best;
  }

  // ---------------------------------------------------------------- building

  private togglePlacement(kind: BuildKind): void {
    if (!this.world.canBuild) return;
    if (this.placingKind === kind) {
      this.endPlacement();
      return;
    }
    this.placingKind = kind;
    this.placingTile = this.findOpenTileNear(kind, Math.floor(this.cx / T), Math.floor(this.cy / T));
    this.updatePlan();
  }

  /** Spirals out from (tx, ty) looking for a spot where the exhibit (and a path to it) or the tower fits. */
  private findOpenTileNear(kind: BuildKind, tx: number, ty: number): { x: number; y: number } {
    const start = { x: clamp(tx, 0, MAP.cols - 1), y: clamp(ty, 0, MAP.rows - 1) };
    const grid = this.world.grid;
    const fits = (x: number, y: number) =>
      kind === 'tower' ? planTower(grid, x, y, Infinity).valid : planPlacement(grid, kind, x, y, Infinity, 0).reason === null;
    for (let r = 0; r <= 10; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = start.x + dx;
          const y = start.y + dy;
          if (this.world.grid.inBounds(x, y) && fits(x, y)) return { x, y };
        }
      }
    }
    return start;
  }

  private updatePlan(): void {
    const kind = this.placingKind;
    if (!kind) return;
    const w = this.world;
    const { x, y } = this.placingTile;
    if (kind === 'tower') {
      this.plan = null;
      this.towerPlan = planTower(w.grid, x, y, w.money);
      this.hud.showPlacement(towerPlaceView(this.towerPlan, T));
    } else {
      this.towerPlan = null;
      this.plan = planPlacement(w.grid, kind, x, y, w.money, w.countOf(kind));
      this.hud.showPlacement(exhibitPlaceView(this.plan));
    }
    this.drawGhost();
    this.anchorToTiles(this.placementRect());
  }

  /** Tiles covered by the thing being placed, for the ghost and the panel position. */
  private placementRect(): Rect | undefined {
    if (this.towerPlan) return { x: this.towerPlan.tile.x, y: this.towerPlan.tile.y, w: 1, h: 1 };
    return this.plan?.footprint;
  }

  private confirmPlacement(): void {
    if (!this.placingKind || !this.world.canBuild) return;
    this.updatePlan();
    if (this.placingKind === 'tower') {
      const plan = this.towerPlan;
      if (!plan || !plan.valid) {
        this.hud.toast(plan?.reason ?? 'Can’t build there');
        return;
      }
      this.world.buildTower(plan);
      this.hud.toast(`${UNITS.tower.name} built for ${formatMoney(plan.cost)}`);
      this.endPlacement();
      return;
    }
    const plan = this.plan;
    if (!plan || !plan.valid) {
      this.hud.toast(plan?.reason ?? 'Can’t build there');
      return;
    }
    const ex = this.world.build(plan);
    this.hud.toast(`${EXHIBITS[ex.kind].name} built for ${formatMoney(plan.totalCost)}`);
    this.endPlacement();
  }

  private endPlacement(): void {
    this.placingKind = null;
    this.plan = null;
    this.towerPlan = null;
    this.ghostGfx.clear();
    if (this.hud.panel === 'place') this.hud.closePanels();
  }

  private drawGhost(): void {
    const g = this.ghostGfx;
    g.clear();
    const tower = this.towerPlan;
    if (tower) {
      const color = tower.valid ? COLORS.ghostValid : COLORS.ghostInvalid;
      const cx = (tower.tile.x + 0.5) * T;
      const cy = (tower.tile.y + 0.5) * T;
      g.fillStyle(color, 0.08).fillCircle(cx, cy, UNITS.tower.range);
      g.lineStyle(2, color, 0.55).strokeCircle(cx, cy, UNITS.tower.range);
      g.fillStyle(color, 0.3).fillRect(tower.tile.x * T, tower.tile.y * T, T, T);
      g.lineStyle(3, color, 0.95).strokeRect(tower.tile.x * T + 1.5, tower.tile.y * T + 1.5, T - 3, T - 3);
      return;
    }
    const plan = this.plan;
    if (!plan) return;
    g.fillStyle(COLORS.path, 0.8);
    for (const p of plan.newPathTiles) g.fillRect(p.x * T + 5, p.y * T + 5, T - 10, T - 10);
    const color = plan.valid ? COLORS.ghostValid : COLORS.ghostInvalid;
    const { x, y, w, h } = plan.footprint;
    g.fillStyle(color, 0.28).fillRect(x * T, y * T, w * T, h * T);
    g.lineStyle(3, color, 0.95).strokeRect(x * T + 1.5, y * T + 1.5, w * T - 3, h * T - 3);
    g.lineStyle(2, color, 0.7).strokeRect(x * T + T / 2, y * T + T / 2, (w - 1) * T, (h - 1) * T);
    if (plan.viewingSpot) g.fillStyle(COLORS.viewingSpot, 0.95).fillCircle((plan.viewingSpot.x + 0.5) * T, (plan.viewingSpot.y + 0.5) * T, 6);
  }
}

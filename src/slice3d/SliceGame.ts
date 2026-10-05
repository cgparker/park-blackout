// The 3D build: every level drawn in real 3D with three.js. The rules come from src/core and the HUD
// from src/ui, as in the 2D game. This controller turns touches into orders and keeps the camera, the
// HUD, and the 3D view in step with the world. It only reads the world and sends it orders.
import { BLACKOUT, CAMERA, DINOS, EXHIBITS, EXHIBIT_KINDS, FIGHT, INPUT, SCORING, SIM, UNITS, VIEW3D, type AnimalKind, type ExhibitKind, type LevelId, type UnitKind } from '../config';
import type { Point, Rect } from '../core/grid';
import { planPlacement, planTower, type PlacementPlan, type TowerPlan } from '../core/placement';
import { substationCenter } from '../core/power';
import { cancelQueued, canCommand, enqueueUnit, isTargetable, orderAttack, orderBoard, orderMove, orderRepair, passengers, type Unit } from '../core/units';
import { World, type GameEvent } from '../core/world';
import type { Params } from '../params';
import { MARGIN } from '../render3d/terrain';
import { View3D, type Quality, type ViewWorld } from '../render3d/View3D';
import { viewOf } from './viewOf';
import { goalsNow } from '../ui/goals';
import { formatMoney, type ArrowView, type BriefingOptions, type BuildKind, type Hud } from '../ui/hud';
import { exhibitPlaceView, exhibitView, selectionSummary, startBanner, substationView, towerPlaceView, trainingView } from '../ui/panels';
import { loadTipsOn, saveTipsOn } from '../ui/prefs';
import { tipsFor, type Tip, type TipId } from '../ui/tips';

/** Levels the 3D build offers. */
export const SLICE_LEVELS: readonly LevelId[] = [1, 2, 3, 4, 5];

type Gesture = 'idle' | 'press' | 'pan' | 'pinch' | 'box';

interface PointerInfo {
  x: number;
  y: number;
  downX: number;
  downY: number;
  downTime: number;
  touch: boolean;
}

interface Cam {
  x: number;
  z: number;
  dist: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Body height in tiles, for picking an animal by where it shows on screen. */
const BODY_Y: Record<AnimalKind, number> = { triceratops: 0.45, raptor: 0.3, trex: 0.75 };

/** Words that float up from the map: money paid, breaches, animals secured, a T. rex charging. */
interface Float {
  el: HTMLElement;
  x: number;
  y: number;
  z: number;
  life: number;
  max: number;
  /** Money shown, for payments that join it. */
  amount?: number;
}

export class SliceGame {
  private world!: World;
  private vw!: ViewWorld;
  private view!: View3D;
  private canvas: HTMLCanvasElement;
  private readonly session: { level: LevelId; debug: boolean; tips: boolean; quick: boolean };
  private selected = new Set<number>();
  private accumulator = 0;
  private speed = 1;
  private night = false;
  private cam: Cam = { x: 20, z: 12, dist: VIEW3D.defaultDist };
  private camMove: { from: Cam; to: Cam; t: number } | null = null;
  private pointers = new Map<number, PointerInfo>();
  private gesture: Gesture = 'idle';
  private panStart = { x: 0, z: 0, gx: 0, gz: 0 };
  private pinchStart = { fingers: 1, dist: 1, gx: 0, gz: 0 };
  private boxStart = { x: 0, y: 0 };
  private boxEnd = { x: 0, y: 0 };
  private rightDown: { x: number; y: number } | null = null;
  private readonly keys = new Set<string>();
  private readonly seenTips = new Set<TipId>();
  private tipQueue: Tip[] = [];
  private escapeToasts = new Map<string, number>();
  private breaches: { x: number; y: number; until: number }[] = [];
  private arrowTargets = new Map<string, Point>();
  private last = 0;
  private fps = 0;
  private fpsFrames = 0;
  private fpsShownAt = 0;
  private endTimer = 0;
  private placingKind: BuildKind | null = null;
  private placingTile = { x: 0, y: 0 };
  private plan: PlacementPlan | null = null;
  private towerPlan: TowerPlan | null = null;
  private wasAllClear = false;
  /** The power state the lighting shows. In the blackout level, the dark comes with the power cut. */
  private powerShown = true;
  private floats: Float[] = [];
  private readonly floatLayer: HTMLElement;
  /** Seconds of play with a low frame rate, for the one-time hint to try Low quality. */
  private slowFor = 0;
  private slowHinted = false;
  /** Canvas position on the page, in CSS pixels. */
  private area = { left: 0, top: 0, width: 1, height: 1 };
  private offsets = new Map<string, { minX: number; maxX: number; minZ: number; maxZ: number }>();
  private readonly boxEl: HTMLElement;
  private readonly ringEl: HTMLElement;
  private readonly fpsEl: HTMLElement;
  private readonly nightBtn: HTMLButtonElement;

  private switching = false;
  private readonly qualityBtn: HTMLButtonElement;

  constructor(
    private readonly container: HTMLElement,
    private readonly hud: Hud,
    private readonly params: Params,
    private quality: Quality,
    private readonly saveQuality: (q: Quality) => void,
  ) {
    const level = params.level && SLICE_LEVELS.includes(params.level) ? params.level : SLICE_LEVELS[0];
    this.session = { level, debug: params.debug, tips: loadTipsOn(), quick: false };
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'view3d';
    container.append(this.canvas);
    this.boxEl = document.createElement('div');
    this.boxEl.className = 'select-box hidden';
    this.ringEl = document.createElement('div');
    this.ringEl.className = 'press-ring hidden';
    this.floatLayer = document.createElement('div');
    this.floatLayer.className = 'float-layer';
    container.append(this.boxEl, this.ringEl, this.floatLayer);

    // A small bar for testing on a phone: frame rate, a day and night switch, and the quality setting.
    const bar = document.createElement('div');
    bar.className = 'test-bar';
    this.fpsEl = document.createElement('span');
    this.fpsEl.className = 'test-fps';
    this.nightBtn = document.createElement('button');
    this.nightBtn.type = 'button';
    this.nightBtn.className = 'test-btn';
    this.nightBtn.textContent = 'Night';
    this.nightBtn.setAttribute('aria-pressed', 'false');
    this.nightBtn.addEventListener('click', () => this.setNight(!this.night));
    const q = document.createElement('button');
    q.type = 'button';
    q.className = 'test-btn';
    q.textContent = quality === 'low' ? 'Low quality' : 'High quality';
    q.addEventListener('click', () => void this.setQuality(this.quality === 'low' ? 'high' : 'low'));
    this.qualityBtn = q;
    bar.append(this.fpsEl, this.nightBtn, q);
    document.getElementById('app')!.append(bar);
  }

  /** Loads the models, builds the park, and starts the loop. */
  async boot(onProgress: (done: number, total: number) => void): Promise<void> {
    this.newWorld();
    this.view = new View3D(this.canvas, { base: '.', quality: this.quality, night: false, guests: true });
    await this.view.init(this.vw, onProgress);
    this.layout();
    this.setupInput();
    this.wireHud();
    this.resetGame();
    window.addEventListener('resize', () => this.layout());
    window.visualViewport?.addEventListener('resize', () => this.layout());
    window.addEventListener('orientationchange', () => window.setTimeout(() => this.layout(), 250));
    this.last = performance.now();
    requestAnimationFrame(this.tick);
    // Test hooks for scripted checks (#debug).
    if (this.params.debug) (window as unknown as { __pb3d: unknown }).__pb3d = this;
  }

  // ---------------------------------------------------------------- games

  private newWorld(): void {
    this.world = new World({ seed: this.params.seed ?? undefined, level: this.session.level, buildPhaseSeconds: this.params.buildPhaseSeconds ?? undefined });
    this.vw = viewOf(this.world);
  }

  /** A fresh world for the session's level, with the briefing up. Retry and level picks come here. */
  private restart(): void {
    window.clearTimeout(this.endTimer);
    this.newWorld();
    this.view.reset();
    this.resetGame();
  }

  private resetGame(): void {
    const w = this.world;
    this.placingKind = null;
    this.plan = null;
    this.towerPlan = null;
    this.view.setGhost(null);
    this.wasAllClear = false;
    this.powerShown = w.powerOn;
    for (const f of this.floats) f.el.remove();
    this.floats = [];
    // The blackout level and level 5 start by day, and level 4 is the night after the blackout. In levels 1 and 2 the
    // Night switch is a test tool and stays as set.
    if (!w.mission || w.level === 5) this.setNight(false);
    else if (w.level === 4) this.setNight(true);
    this.selected = new Set();
    this.accumulator = 0;
    this.pointers.clear();
    this.gesture = 'idle';
    this.rightDown = null;
    this.tipQueue = [];
    this.escapeToasts = new Map();
    this.breaches = [];
    this.arrowTargets = new Map();
    this.camMove = null;
    this.hud.reset();
    this.hud.showDebug(this.session.debug);
    this.hud.setDebugSpeed(this.speed);
    this.hud.showBriefing({
      level: this.session.level,
      buildSeconds: w.buildPhaseSeconds,
      quickSeconds: BLACKOUT.quickBuildPhaseSeconds,
      revenueTarget: w.revenueTarget,
      villain: BLACKOUT.villainName,
      quick: this.session.quick,
      debug: this.session.debug,
      tips: this.session.tips,
    });
    // Start at HQ, where the troops come from. The gate, where the blackout level's guests arrive, is beside it.
    const hq = w.map.hq;
    this.cam = { x: hq.x + hq.w / 2 + 6, z: hq.y + hq.h / 2 - 2, dist: VIEW3D.defaultDist };
    this.applyCamera();
    this.hud.setArrows([]);
  }

  private keepOptions(o: BriefingOptions): void {
    this.session.quick = o.quick;
    this.session.debug = o.debug;
    if (o.tips !== this.session.tips) saveTipsOn(o.tips);
    this.session.tips = o.tips;
  }

  private setNight(on: boolean): void {
    this.night = on;
    this.view.setNight(on);
    this.nightBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  /**
   * Rebuilds the 3D view at another quality without losing the game: the renderer's settings are fixed
   * when it starts, so a new one is made on a new canvas, and the old one is let go once it is ready.
   */
  private async setQuality(q: Quality): Promise<void> {
    if (q === this.quality || this.switching) return;
    this.switching = true;
    const loading = document.getElementById('loading');
    const text = loading?.querySelector('.load-text');
    if (text) text.textContent = q === 'low' ? 'Switching to Low quality' : 'Switching to High quality';
    loading?.classList.remove('hidden');
    try {
      const canvas = document.createElement('canvas');
      canvas.className = 'view3d';
      this.container.insertBefore(canvas, this.canvas);
      const view = new View3D(canvas, { base: '.', quality: q, night: this.night, guests: true });
      await view.init(this.vw);
      const old = this.view;
      this.canvas.remove();
      old.dispose();
      this.view = view;
      this.canvas = canvas;
      this.quality = q;
      this.slowFor = 0;
      this.qualityBtn.textContent = q === 'low' ? 'Low quality' : 'High quality';
      this.saveQuality(q);
      this.layout();
    } catch (e) {
      console.error(e);
      this.hud.toast('Could not switch quality.');
    } finally {
      loading?.classList.add('hidden');
      this.switching = false;
    }
  }

  // ---------------------------------------------------------------- frame

  private readonly tick = (now: number): void => {
    requestAnimationFrame(this.tick);
    const dt = Math.min(now - this.last, 100) / 1000;
    this.last = now;
    // Frames counted over half a second of real time.
    this.fpsFrames++;
    if (now - this.fpsShownAt > 500) {
      this.fps = (this.fpsFrames * 1000) / (now - this.fpsShownAt);
      this.fpsFrames = 0;
      this.fpsShownAt = now;
      // On High quality, a phone that can't keep up gets one hint (it is the player's call).
      const playing = this.world.phase !== 'briefing' && this.world.phase !== 'ended';
      if (this.quality !== 'low' && !this.slowHinted && playing && !this.hud.tipOpen && !this.hud.menuOpen) {
        this.slowFor = this.fps < 24 ? this.slowFor + 0.5 : 0;
        if (this.slowFor >= 6) {
          this.slowHinted = true;
          this.hud.toast('Running slowly. Low quality, top right, may be smoother.');
        }
      }
      const st = this.view.stats;
      this.fpsEl.textContent = this.session.debug ? `${Math.round(this.fps)} fps · ${st.calls} calls · ${Math.round(st.triangles / 1000)}k tris` : `${Math.round(this.fps)} fps`;
      if (this.session.debug) this.hud.setFps(this.fps);
    }
    this.updateKeyboardPan(dt);
    this.updateLongPress(now);
    this.updateCameraMove(dt);

    const w = this.world;
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
    this.view.handle(events, this.vw);
    this.handleEvents(events);
    // The blackout level goes dark when the power is cut and lights up again when it comes back.
    if (!w.mission && w.powerOn !== this.powerShown) {
      this.powerShown = w.powerOn;
      this.setNight(!w.powerOn);
    }
    // Troops that climbed into the 4x4, or fell, leave the selection; select the 4x4 to move them.
    for (const id of this.selected) {
      const u = w.unitById(id);
      if (!u || !canCommand(u)) this.selected.delete(id);
    }
    this.view.render(this.vw, { selected: this.selected }, dt);
    this.refreshHud();
    this.updateArrows();
    this.updateOverlays(now);
    this.updateFloats(dt);
  };

  // ---------------------------------------------------------------- HUD

  private wireHud(): void {
    this.hud.handlers = {
      selectBuild: (kind) => this.togglePlacement(kind),
      confirmPlacement: () => this.confirmPlacement(),
      cancelPlacement: () => this.endPlacement(),
      reinforce: (id) => this.reinforce(id),
      start: (o) => {
        this.keepOptions(o);
        if (!this.world.mission) this.world.setBuildPhase(o.quick ? BLACKOUT.quickBuildPhaseSeconds : (this.params.buildPhaseSeconds ?? BLACKOUT.buildPhaseSeconds));
        this.hud.showDebug(o.debug);
        this.hud.hideBriefing();
        this.world.start();
      },
      selectLevel: (level, o) => {
        if (!SLICE_LEVELS.includes(level)) return;
        this.keepOptions(o);
        this.session.level = level;
        this.restart();
      },
      retry: () => this.restart(),
      nextLevel: () => {
        const i = SLICE_LEVELS.indexOf(this.session.level);
        this.session.level = SLICE_LEVELS[Math.min(SLICE_LEVELS.length - 1, i + 1)];
        this.restart();
      },
      openTraining: () => this.openTraining(),
      train: (kind) => this.train(kind),
      cancelQueued: (id) => cancelQueued(this.world, id),
      closePanel: () => this.closePanels(),
      selectAll: () => {
        this.selected = new Set(this.world.units.filter(canCommand).map((u) => u.id));
      },
      clearSelection: () => this.selected.clear(),
      tipDone: () => this.nextTip(),
      tipsOff: () => {
        this.session.tips = false;
        saveTipsOn(false);
        this.tipQueue = [];
        this.hud.hideTip();
        this.hud.toast('Tips are off. Turn them back on from the briefing.');
      },
      openMenu: () => this.openMenu(),
      resume: () => this.hud.hideMenu(),
      endGame: () => {
        this.hud.hideMenu();
        this.world.quit();
      },
      focusArrow: (key) => {
        const p = this.arrowTargets.get(key);
        if (p) this.moveCamera({ x: p.x / this.world.T, z: p.y / this.world.T, dist: this.cam.dist });
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
        if (name === 'fps') this.hud.setFps(on ? this.fps : null);
      },
    };
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
      inPark: w.inPark,
      evacuating: w.evacuating,
    });
    const counts = Object.fromEntries(EXHIBIT_KINDS.map((k) => [k, w.countOf(k)])) as Record<ExhibitKind, number>;
    this.hud.setBuildBar(w.canBuild, w.money, counts, this.placingKind);
    const troops = w.units.reduce((n, u) => (canCommand(u) ? n + 1 : n), 0);
    this.hud.setTroops(troops, this.selected.size, selectionSummary(w.units, this.selected, (u) => passengers(w, u).length), w.queue.length, !w.canBuild);
    this.hud.setHq(w.trainable.length > 0);
    if (this.hud.panel === 'place') {
      const r = this.placementRect();
      if (r) this.anchorToTiles(r);
    } else if (this.hud.panel === 'train') {
      this.hud.updateTraining(trainingView(this.world));
      this.anchorToTiles(w.map.hq);
    } else if (this.hud.panel === 'exhibit') {
      const ex = w.exhibitById(this.hud.shownExhibit);
      if (ex) {
        this.hud.updateExhibit(exhibitView(w, ex.id)!);
        this.anchorToTiles(ex.footprint);
      }
    } else if (this.hud.panel === 'substation') {
      const s = w.substationById(this.hud.shownSubstation);
      if (s) {
        this.hud.updateSubstation(substationView(w, s.id)!);
        this.anchorToTiles({ x: s.x, y: s.y, w: 2, h: 2 });
      }
    }
  }

  /** Points a panel at a block of tiles: their outline on screen, in page coordinates. */
  private anchorToTiles(r: Rect): void {
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const [x, z] of [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]]) {
      const p = this.view.project(x, 0, z);
      left = Math.min(left, p.x);
      right = Math.max(right, p.x);
      top = Math.min(top, p.y);
      bottom = Math.max(bottom, p.y);
    }
    this.hud.anchor({ left: left + this.area.left, top: top + this.area.top, right: right + this.area.left, bottom: bottom + this.area.top });
  }

  private openTraining(): void {
    if (this.world.phase === 'briefing' || this.world.phase === 'ended') return;
    if (this.placingKind) this.endPlacement();
    this.hud.showTraining(trainingView(this.world));
    this.anchorToTiles(this.world.map.hq);
  }

  private train(kind: UnitKind): void {
    if (!enqueueUnit(this.world, kind)) this.hud.toast(this.world.money < UNITS[kind].cost ? 'Not enough money' : 'The queue is full');
  }

  private reinforce(id: number): void {
    if (this.world.reinforce(id)) this.hud.toast('Fence reinforced');
    else this.hud.toast('Not enough money');
  }

  private closePanels(): void {
    if (this.placingKind) this.endPlacement();
    this.hud.closePanels();
  }

  private openExhibit(id: number): void {
    const v = exhibitView(this.world, id);
    if (!v) return;
    this.hud.showExhibit(v);
    this.anchorToTiles(this.world.exhibitById(id)!.footprint);
  }

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

  // ---------------------------------------------------------------- events and tips

  private handleEvents(events: readonly GameEvent[]): void {
    const w = this.world;
    const T = w.T;
    // The evacuation banner names the first animal out, so that escape needs no toast of its own.
    const evacuation = events.some((e) => e.type === 'evacuation');
    // A raptor that spots a troop calls the others, so one sighting can come as several events.
    const spotted = new Set<number>();
    for (const e of events) {
      switch (e.type) {
        case 'started': {
          if (!w.mission) break;
          this.hud.showBanner(startBanner(w), 'warn', 4);
          // Level 4 is about the substations; the others about what is loose.
          const pts =
            w.level === 4
              ? w.substations.map((s) => substationCenter(s, T)).map((p) => ({ x: p.x / T, y: p.y / T }))
              : w.dinos.filter((d) => d.state === 'loose').map((d) => ({ x: d.x / T, y: d.y / T }));
          if (w.nest) pts.push({ x: w.nest.x / T, y: w.nest.y / T });
          this.frame(pts, true);
          break;
        }
        case 'spotted': {
          this.float('!', e.x / T, 0.95, e.y / T, '#ff6b5a', 1.4);
          if (spotted.has(e.unitId)) break;
          spotted.add(e.unitId);
          if (e.kind === 'engineer') this.hud.showBanner('A raptor saw the Engineer.', 'danger', 3);
          else this.hud.toast(`A raptor saw the ${UNITS[e.kind].name}.`);
          break;
        }
        case 'substationFixed': {
          const s = w.substationById(e.id);
          const held = e.contained ? ` ${e.contained} ${e.contained === 1 ? 'animal' : 'animals'} contained.` : '';
          this.hud.showBanner(e.last ? `The power is back everywhere.${held}` : `${s?.name ?? 'A'} substation fixed.${held}`, 'good', 3.5);
          if (s) {
            const c = substationCenter(s, T);
            this.float('Power on', c.x / T, 1.3, c.y / T, '#7fefff', 1.8);
          }
          break;
        }
        case 'killed':
          this.float('Killed', e.x / T, 0.9, e.y / T, '#ff6b6b', 1.8);
          this.hud.showBanner(`${e.kind === 'trex' ? 'The T. rex' : 'A raptor'} was killed. ${w.animalsKilled} of ${FIGHT.killLimit}.`, 'danger', 3);
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
          this.float('Breach!', e.x / T, 0.9, e.y / T, '#ff7a7a', 1.6);
          break;
        case 'evacuation':
          this.hud.showBanner(`${e.kind === 'trex' ? 'The T. rex is' : e.kind === 'raptor' ? 'Raptors are' : 'A Triceratops is'} out. The park is evacuating.`, 'danger', 4);
          break;
        case 'escaped': {
          const lastAt = this.escapeToasts.get(e.kind) ?? -Infinity;
          if (evacuation) this.escapeToasts.set(e.kind, w.time);
          else if (w.time - lastAt > 3) {
            this.escapeToasts.set(e.kind, w.time);
            this.hud.toast(e.kind === 'raptor' ? 'Raptors are loose!' : e.kind === 'trex' ? 'The T. rex is loose!' : 'A Triceratops broke out!');
          }
          break;
        }
        case 'paid':
          this.paid(e.amount, e.x / T, e.y / T);
          break;
        case 'charge':
          this.float('Charge!', e.x / T, 1.6, e.y / T, '#ff9a4d', 1.2);
          break;
        case 'trained':
          this.hud.toast(`${UNITS[e.kind].name} ready`);
          break;
        case 'unitLost':
          this.hud.toast(e.kind === 'jeep' ? 'The Patrol 4x4 is wrecked. Everyone got out.' : `${UNITS[e.kind].name} lost`);
          break;
        case 'secured': {
          this.float('Secured', e.x / T, 1.1, e.y / T, '#cdb4ff', 1.6);
          // In levels 1 and 2 the count left is what matters. The last one ends the level, so it needs no toast.
          const left = w.looseCount;
          if (!w.mission) this.hud.toast(`${DINOS[e.kind].name} secured`);
          else if (left) this.hud.toast(`${DINOS[e.kind].name} darted. ${left} to go.`);
          break;
        }
        case 'powerRestored':
          this.hud.showBanner(e.contained ? `Power restored. ${e.contained} ${e.contained === 1 ? 'animal' : 'animals'} contained.` : 'Power restored.', 'good', 4);
          break;
        case 'ended':
          this.endPlacement();
          this.hud.closePanels();
          this.tipQueue = [];
          this.hud.hideTip();
          this.hud.hideMenu();
          this.hud.setArrows([]);
          this.endTimer = window.setTimeout(() => {
            if (w.result && w === this.world) this.hud.showEnd(w.result);
          }, w.result?.reason === 'abandoned' ? 0 : 1200);
          break;
        default:
          break;
      }
    }
    const allClear = w.allClear;
    if (allClear && !this.wasAllClear && w.phase === 'blackout') this.hud.showBanner('All clear. Fast-forwarding to power-on.', 'good');
    this.wasAllClear = allClear;
    this.queueTips(events);
  }

  private queueTips(events: readonly GameEvent[]): void {
    const w = this.world;
    if (!this.session.tips || w.phase === 'briefing' || w.phase === 'ended' || !events.length) return;
    for (const tip of tipsFor(w, events)) {
      if (this.seenTips.has(tip.id)) continue;
      this.seenTips.add(tip.id);
      this.tipQueue.push(tip);
    }
    if (!this.hud.tipOpen) this.nextTip();
  }

  private nextTip(): void {
    const tip = this.world.phase === 'ended' ? undefined : this.tipQueue.shift();
    if (!tip) {
      this.hud.hideTip();
      return;
    }
    this.hud.showTip(tip.title, tip.body);
    if (tip.focus) this.focusAboveTip(tip.focus.x / this.world.T, tip.focus.y / this.world.T);
  }

  /** Puts a ground point in the middle of the part of the map the tip card leaves uncovered. */
  private focusAboveTip(x: number, z: number): void {
    this.camMove = null;
    this.cam.x = x;
    this.cam.z = z;
    this.applyCamera();
    const tipTop = Math.min(this.area.top + this.area.height, this.hud.tipTop) - this.area.top;
    const want = this.view.groundAt(this.area.width / 2, tipTop / 2);
    if (want) {
      this.cam.x += x - want.x;
      this.cam.z += z - want.z;
      this.applyCamera();
    }
  }

  // ---------------------------------------------------------------- camera

  /** Lays the canvas out between the top and bottom bars. */
  private layout(): void {
    const app = document.getElementById('app')!;
    const { top, bottom } = this.hud.insets;
    const width = app.clientWidth;
    const height = Math.max(1, app.clientHeight - top - bottom);
    this.canvas.style.top = `${top}px`;
    this.canvas.style.height = `${height}px`;
    this.area = { left: 0, top, width, height };
    this.view.setSize(width, height);
    this.offsets.clear();
    this.applyCamera();
  }

  /** Where the screen corners land on the ground, relative to the focus, at a given distance. */
  private viewOffsets(dist: number): { minX: number; maxX: number; minZ: number; maxZ: number } {
    const key = `${dist.toFixed(2)}`;
    const hit = this.offsets.get(key);
    if (hit) return hit;
    const keep = { ...this.view.rig };
    this.view.setRig(0, 0, dist);
    const o = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
    for (const [sx, sy] of [[0, 0], [this.area.width, 0], [0, this.area.height], [this.area.width, this.area.height]]) {
      const g = this.view.groundAt(sx, sy);
      if (!g) continue;
      o.minX = Math.min(o.minX, g.x);
      o.maxX = Math.max(o.maxX, g.x);
      o.minZ = Math.min(o.minZ, g.z);
      o.maxZ = Math.max(o.maxZ, g.z);
    }
    this.view.setRig(keep.x, keep.z, keep.dist);
    if (this.offsets.size > 400) this.offsets.clear();
    this.offsets.set(key, o);
    return o;
  }

  /** The ground drawn around the park, in tiles. The camera never shows past it. */
  private get region() {
    const w = this.world;
    return { x0: -MARGIN.x, x1: w.grid.cols + MARGIN.x, z0: -MARGIN.z, z1: w.grid.rows + MARGIN.z };
  }

  /** The farthest the camera may pull back on this screen and still only see ground. */
  private maxDist(): number {
    const r = this.region;
    for (let d = VIEW3D.maxDist; d > VIEW3D.minDist; d -= 0.5) {
      const o = this.viewOffsets(Math.round(d * 2) / 2);
      if (o.maxX - o.minX <= r.x1 - r.x0 && o.maxZ - o.minZ <= r.z1 - r.z0) return d;
    }
    return VIEW3D.minDist;
  }

  private applyCamera(): void {
    if (!this.view) return;
    const c = this.cam;
    c.dist = clamp(c.dist, VIEW3D.minDist, this.maxDist());
    const o = this.viewOffsets(Math.round(c.dist * 2) / 2);
    const r = this.region;
    const m = VIEW3D.edgeMarginTiles;
    const w = this.world;
    const axis = (v: number, lo: number, hi: number, mapLo: number, mapHi: number) => (lo > hi ? (lo + hi) / 2 : clamp(clamp(v, mapLo, mapHi), lo, hi));
    c.x = axis(c.x, r.x0 - o.minX, r.x1 - o.maxX, -m, w.grid.cols + m);
    c.z = axis(c.z, r.z0 - o.minZ, r.z1 - o.maxZ, -m, w.grid.rows + m);
    this.view.setRig(c.x, c.z, c.dist);
  }

  private moveCamera(to: Cam): void {
    this.camMove = { from: { ...this.cam }, to, t: 0 };
  }

  private updateCameraMove(dt: number): void {
    const m = this.camMove;
    if (!m) return;
    m.t = Math.min(1, m.t + dt / CAMERA.moveSeconds);
    const k = 1 - (1 - m.t) ** 3;
    this.cam = { x: m.from.x + (m.to.x - m.from.x) * k, z: m.from.z + (m.to.z - m.from.z) * k, dist: m.from.dist * (m.to.dist / m.from.dist) ** k };
    this.applyCamera();
    if (m.t >= 1) this.camMove = null;
  }

  /** Eases the camera to show every point (tiles) with a margin, never closer than the default distance. */
  private frame(points: readonly { x: number; y: number }[], withHq: boolean): void {
    if (!points.length || this.gesture !== 'idle') return;
    const hq = this.world.map.hq;
    const all = withHq ? [...points, { x: hq.x, y: hq.y }, { x: hq.x + hq.w, y: hq.y + hq.h }] : points;
    const m = CAMERA.frameMarginTiles;
    const x0 = Math.min(...all.map((p) => p.x)) - m;
    const x1 = Math.max(...all.map((p) => p.x)) + m;
    const z0 = Math.min(...all.map((p) => p.y)) - m;
    const z1 = Math.max(...all.map((p) => p.y)) + m;
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const max = this.maxDist();
    let dist = max;
    for (let d = VIEW3D.defaultDist; d <= max; d += 0.5) {
      const o = this.viewOffsets(Math.round(d * 2) / 2);
      if (cx + o.minX <= x0 && cx + o.maxX >= x1 && cz + o.minZ <= z0 && cz + o.maxZ >= z1) {
        dist = d;
        break;
      }
    }
    this.moveCamera({ x: cx, z: cz, dist });
  }

  /** At the blackout, frame every exhibit so the first escape happens on screen. */
  private frameParkForBlackout(): void {
    const pts: { x: number; y: number }[] = [];
    for (const e of this.world.exhibits) pts.push({ x: e.footprint.x, y: e.footprint.y }, { x: e.footprint.x + e.footprint.w, y: e.footprint.y + e.footprint.h });
    this.frame(pts, false);
  }

  private updateKeyboardPan(dt: number): void {
    const k = this.keys;
    const dx = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0);
    const dz = (k.has('s') || k.has('arrowdown') ? 1 : 0) - (k.has('w') || k.has('arrowup') ? 1 : 0);
    if (!dx && !dz) return;
    this.camMove = null;
    const tilesPerPx = (2 * this.cam.dist * Math.tan((VIEW3D.fov * Math.PI) / 360)) / this.area.height;
    this.cam.x += dx * CAMERA.keyPanSpeed * dt * tilesPerPx;
    this.cam.z += dz * CAMERA.keyPanSpeed * dt * tilesPerPx;
    this.applyCamera();
  }

  // ---------------------------------------------------------------- edge arrows

  private updateArrows(): void {
    const w = this.world;
    this.arrowTargets.clear();
    if (w.phase !== 'blackout' && w.phase !== 'restored' && w.phase !== 'mission') {
      this.hud.setArrows([]);
      return;
    }
    this.breaches = this.breaches.filter((b) => b.until > w.time);
    const T = w.T;
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
    const { left, top, width, height } = this.area;
    const mx = left + width / 2;
    const my = top + height / 2;
    const r = CAMERA.arrowInsetPx;
    const hw = width / 2 - r;
    const hh = height / 2 - r;
    const banner = this.hud.bannerBox;
    const out: ArrowView[] = [];
    for (const t of targets) {
      const s = this.view.project(t.x / T, 0, t.y / T);
      const px = s.x + left;
      const py = s.y + top;
      if (px >= left && px <= left + width && py >= top && py <= top + height) continue;
      const dx = px - mx;
      const dy = py - my;
      const k = Math.min(hw / Math.max(Math.abs(dx), 1e-6), hh / Math.max(Math.abs(dy), 1e-6));
      const x = mx + dx * k;
      let y = my + dy * k;
      if (banner && x > banner.left - r && x < banner.right + r && y > banner.top - r && y < banner.bottom + r) y = banner.bottom + r;
      if (out.some((a) => Math.hypot(a.x - x, a.y - y) < CAMERA.arrowSpacingPx)) continue;
      const key = `${t.kind}-${out.length}`;
      this.arrowTargets.set(key, { x: t.x, y: t.y });
      out.push({ key, x, y, angle: Math.atan2(dy, dx), kind: t.kind, count: t.count });
    }
    this.hud.setArrows(out);
  }

  // ---------------------------------------------------------------- input

  private setupInput(): void {
    // On the container, not the canvas: switching quality swaps the canvas.
    const c = this.container;
    c.addEventListener('pointerdown', (e) => this.onDown(e));
    c.addEventListener('pointermove', (e) => this.onMove(e));
    c.addEventListener('pointerup', (e) => this.onUp(e));
    c.addEventListener('pointercancel', (e) => this.onUp(e, true));
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        if (this.blocked) return;
        this.camMove = null;
        const p = this.local(e);
        this.zoomAt(p.x, p.y, this.cam.dist * Math.exp(e.deltaY * VIEW3D.wheelZoomFactor));
      },
      { passive: false },
    );
    window.addEventListener('keydown', (e) => {
      const key = e.key.toLowerCase();
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) this.keys.add(key);
      if (key === 'escape') {
        if (this.hud.menuOpen) this.hud.hideMenu();
        else if (this.hud.tipOpen) this.nextTip();
        else if (this.placingKind) this.endPlacement();
        else if (this.hud.panel) this.closePanels();
        else if (this.selected.size) this.selected.clear();
        else this.openMenu();
      } else if (key === 'p') {
        if (this.hud.menuOpen) this.hud.hideMenu();
        else this.openMenu();
      } else if (key === 'n') this.setNight(!this.night);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
  }

  private get blocked(): boolean {
    return this.world.phase === 'briefing' || this.hud.briefingOpen;
  }

  private local(e: { clientX: number; clientY: number }): { x: number; y: number } {
    return { x: e.clientX - this.area.left, y: e.clientY - this.area.top };
  }

  private onDown(e: PointerEvent): void {
    if (this.blocked) return;
    this.camMove = null;
    const p = this.local(e);
    const touch = e.pointerType !== 'mouse';
    if (!touch && e.button === 2) {
      this.rightDown = p;
      return;
    }
    try {
      this.container.setPointerCapture(e.pointerId);
    } catch {
      // Pointers the browser doesn't track (scripted ones) can't be captured; moves still arrive.
    }
    this.pointers.set(e.pointerId, { x: p.x, y: p.y, downX: p.x, downY: p.y, downTime: performance.now(), touch });
    if (!touch && e.button === 1) {
      this.beginPan(p.x, p.y);
      this.gesture = 'pan';
    } else if (this.pointers.size === 1) {
      this.gesture = 'press';
    } else if (this.pointers.size === 2) {
      this.beginPinch();
    }
  }

  private onMove(e: PointerEvent): void {
    const info = this.pointers.get(e.pointerId);
    if (!info) return;
    const p = this.local(e);
    info.x = p.x;
    info.y = p.y;
    if (this.gesture === 'pinch') {
      this.updatePinch();
      return;
    }
    const moved = Math.hypot(info.x - info.downX, info.y - info.downY) > INPUT.tapMoveThreshold;
    if (this.gesture === 'press' && moved) {
      if (info.touch) {
        this.beginPan(info.downX, info.downY);
        this.gesture = 'pan';
      } else {
        this.gesture = 'box';
        this.boxStart = { x: info.downX, y: info.downY };
      }
    }
    if (this.gesture === 'pan') this.updatePan(info.x, info.y);
    else if (this.gesture === 'box') this.boxEnd = { x: info.x, y: info.y };
  }

  private onUp(e: PointerEvent, cancelled = false): void {
    const p = this.local(e);
    if (this.rightDown && e.pointerType === 'mouse' && e.button === 2) {
      const moved = Math.hypot(p.x - this.rightDown.x, p.y - this.rightDown.y) > INPUT.tapMoveThreshold;
      const at = this.rightDown;
      this.rightDown = null;
      if (!moved && !this.blocked) this.command(at.x, at.y);
      return;
    }
    const info = this.pointers.get(e.pointerId);
    if (!info) return;
    this.pointers.delete(e.pointerId);
    if (!cancelled) {
      if (this.gesture === 'press') this.handleTap(info.downX, info.downY);
      else if (this.gesture === 'box') this.finishBox();
    }
    if (this.pointers.size === 0) {
      this.gesture = 'idle';
    } else if (this.gesture === 'pinch' && this.pointers.size === 1) {
      const rest = [...this.pointers.values()][0];
      rest.downX = rest.x;
      rest.downY = rest.y;
      this.beginPan(rest.x, rest.y);
      this.gesture = 'pan';
    }
  }

  private beginPan(sx: number, sy: number): void {
    const g = this.view.groundAt(sx, sy);
    this.panStart = { x: this.cam.x, z: this.cam.z, gx: g?.x ?? this.cam.x, gz: g?.z ?? this.cam.z };
  }

  /** Keeps the ground point first touched under the finger. */
  private updatePan(sx: number, sy: number): void {
    const g = this.view.groundAt(sx, sy);
    if (!g) return;
    // Where the finger would be on the ground with the camera back at the start of the pan.
    const gx = g.x - (this.cam.x - this.panStart.x);
    const gz = g.z - (this.cam.z - this.panStart.z);
    this.cam.x = this.panStart.x + (this.panStart.gx - gx);
    this.cam.z = this.panStart.z + (this.panStart.gz - gz);
    this.applyCamera();
  }

  private beginPinch(): void {
    const [a, b] = [...this.pointers.values()];
    const g = this.view.groundAt((a.x + b.x) / 2, (a.y + b.y) / 2);
    this.pinchStart = { fingers: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), dist: this.cam.dist, gx: g?.x ?? this.cam.x, gz: g?.z ?? this.cam.z };
    this.gesture = 'pinch';
  }

  private updatePinch(): void {
    const [a, b] = [...this.pointers.values()];
    if (!a || !b) return;
    const fingers = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
    this.cam.dist = (this.pinchStart.dist * this.pinchStart.fingers) / fingers;
    this.applyCamera();
    const g = this.view.groundAt((a.x + b.x) / 2, (a.y + b.y) / 2);
    if (g) {
      this.cam.x += this.pinchStart.gx - g.x;
      this.cam.z += this.pinchStart.gz - g.z;
      this.applyCamera();
    }
  }

  private zoomAt(sx: number, sy: number, dist: number): void {
    const before = this.view.groundAt(sx, sy);
    this.cam.dist = dist;
    this.applyCamera();
    const after = this.view.groundAt(sx, sy);
    if (before && after) {
      this.cam.x += before.x - after.x;
      this.cam.z += before.z - after.z;
      this.applyCamera();
    }
  }

  /** Hold still for a moment, then drag, to draw a selection box. */
  private updateLongPress(now: number): void {
    if (this.gesture !== 'press' || this.pointers.size !== 1 || this.placingKind) return;
    const info = [...this.pointers.values()][0];
    if (!info.touch || now - info.downTime < INPUT.longPressMs) return;
    this.gesture = 'box';
    this.boxStart = { x: info.downX, y: info.downY };
    this.boxEnd = { x: info.x, y: info.y };
  }

  /** The selection box and the ring that grows under a held finger. */
  private updateOverlays(now: number): void {
    if (this.gesture === 'box') {
      const x = Math.min(this.boxStart.x, this.boxEnd.x);
      const y = Math.min(this.boxStart.y, this.boxEnd.y);
      const s = this.boxEl.style;
      s.left = `${x + this.area.left}px`;
      s.top = `${y + this.area.top}px`;
      s.width = `${Math.abs(this.boxEnd.x - this.boxStart.x)}px`;
      s.height = `${Math.abs(this.boxEnd.y - this.boxStart.y)}px`;
      this.boxEl.classList.remove('hidden');
    } else this.boxEl.classList.add('hidden');
    const info = this.gesture === 'press' && this.pointers.size === 1 && !this.placingKind ? [...this.pointers.values()][0] : null;
    if (info?.touch) {
      const k = clamp((now - info.downTime) / INPUT.longPressMs, 0, 1);
      const s = this.ringEl.style;
      s.left = `${info.downX + this.area.left}px`;
      s.top = `${info.downY + this.area.top}px`;
      s.transform = `translate(-50%, -50%) scale(${0.4 + 0.6 * k})`;
      s.opacity = String(0.2 + 0.7 * k);
      this.ringEl.classList.remove('hidden');
    } else this.ringEl.classList.add('hidden');
  }

  private finishBox(): void {
    const x0 = Math.min(this.boxStart.x, this.boxEnd.x);
    const x1 = Math.max(this.boxStart.x, this.boxEnd.x);
    const y0 = Math.min(this.boxStart.y, this.boxEnd.y);
    const y1 = Math.max(this.boxStart.y, this.boxEnd.y);
    const T = this.world.T;
    const picked = this.world.units.filter((u) => {
      if (!canCommand(u)) return false;
      const p = this.view.project(u.x / T, 0.25, u.y / T);
      return p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;
    });
    this.selected = new Set(picked.map((u) => u.id));
    if (picked.length) this.closePanels();
  }

  private handleTap(sx: number, sy: number): void {
    if (this.world.phase === 'ended') return;
    // While placing, a tap moves the preview there.
    if (this.placingKind) {
      const p = this.view.groundAt(sx, sy);
      if (!p) return;
      const px = Math.floor(p.x);
      const py = Math.floor(p.z);
      if (!this.world.grid.inBounds(px, py)) return;
      this.placingTile = { x: px, y: py };
      this.updatePlan();
      return;
    }
    const unit = this.unitAt(sx, sy);
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
    const g = this.view.groundAt(sx, sy);
    if (!g) return;
    const tx = Math.floor(g.x);
    const ty = Math.floor(g.z);
    const hq = this.world.map.hq;
    // Levels 4 and 5 train nothing, so a tap on HQ is just a tap on the map.
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
    const ex = this.world.grid.inBounds(tx, ty) ? this.world.exhibitAtTile(tx, ty) : undefined;
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

  /** Move or attack with the selected troops, fix a substation with the Engineer, or load troops into the 4x4. */
  private command(sx: number, sy: number): void {
    const w = this.world;
    if (!this.selected.size || w.phase === 'ended') return;
    const jeep = this.unitAt(sx, sy);
    if (jeep?.kind === 'jeep' && this.boardersSelected(jeep)) {
      orderBoard(w, [...this.selected].filter((id) => id !== jeep.id), jeep.id);
      this.view.markMove(jeep.x / w.T, jeep.y / w.T);
      return;
    }
    const dino = this.dinoAt(sx, sy);
    if (dino) {
      orderAttack(w, this.selected, dino.id);
      this.view.markAttack(dino.x / w.T, dino.y / w.T);
      return;
    }
    const g = this.view.groundAt(sx, sy);
    if (!g) return;
    const sub = w.substationAtTile(Math.floor(g.x), Math.floor(g.z));
    if (sub) {
      orderRepair(w, this.selected, sub.id);
      const c = substationCenter(sub, w.T);
      this.view.markMove(c.x / w.T, c.y / w.T);
      return;
    }
    const x = clamp(g.x, 0.05, w.grid.cols - 0.05) * w.T;
    const y = clamp(g.z, 0.05, w.grid.rows - 0.05) * w.T;
    orderMove(w, this.selected, x, y);
    this.view.markMove(x / w.T, y / w.T);
  }

  private openSubstation(id: number): void {
    const v = substationView(this.world, id);
    if (!v) return;
    if (this.placingKind) this.endPlacement();
    this.hud.showSubstation(v);
    const s = this.world.substationById(id)!;
    this.anchorToTiles({ x: s.x, y: s.y, w: 2, h: 2 });
  }

  /** Screen pixels per tile around the focus, for sizing tap targets. */
  private get pxPerTile(): number {
    return this.area.height / (2 * this.cam.dist * Math.tan((VIEW3D.fov * Math.PI) / 360));
  }

  /** The troop drawn under a tap. Towers can't be selected. */
  private unitAt(sx: number, sy: number) {
    const w = this.world;
    let best = null;
    let bestD = Infinity;
    for (const u of w.units) {
      if (!canCommand(u)) continue;
      const p = this.view.project(u.x / w.T, 0.25, u.y / w.T);
      const d = Math.hypot(p.x - sx, p.y - sy);
      const reach = Math.max(VIEW3D.pickRadiusPx, (UNITS[u.kind].radius / w.T) * this.pxPerTile + INPUT.tapSlop);
      if (d <= reach && d < bestD) {
        bestD = d;
        best = u;
      }
    }
    return best;
  }

  /** The animal drawn under a tap. */
  private dinoAt(sx: number, sy: number) {
    const w = this.world;
    let best = null;
    let bestD = Infinity;
    for (const d of w.dinos) {
      if (!isTargetable(w, d)) continue;
      const feet = this.view.project(d.x / w.T, 0, d.y / w.T);
      const body = this.view.project(d.x / w.T, BODY_Y[d.kind], d.y / w.T);
      const dd = Math.min(Math.hypot(feet.x - sx, feet.y - sy), Math.hypot(body.x - sx, body.y - sy));
      const reach = Math.max(VIEW3D.pickRadiusPx, (DINOS[d.kind].radius / w.T) * this.pxPerTile + INPUT.tapSlop);
      if (dd <= reach && dd < bestD) {
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
    this.placingTile = this.findOpenTileNear(kind, Math.floor(this.cam.x), Math.floor(this.cam.z));
    this.updatePlan();
  }

  /** Spirals out from (tx, ty) looking for a spot where the exhibit (and a path to it) or the tower fits. */
  private findOpenTileNear(kind: BuildKind, tx: number, ty: number): { x: number; y: number } {
    const grid = this.world.grid;
    const start = { x: clamp(tx, 0, grid.cols - 1), y: clamp(ty, 0, grid.rows - 1) };
    const fits = (x: number, y: number) => (kind === 'tower' ? planTower(grid, x, y, Infinity).valid : planPlacement(grid, kind, x, y, Infinity, 0).reason === null);
    for (let r = 0; r <= 10; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = start.x + dx;
          const y = start.y + dy;
          if (grid.inBounds(x, y) && fits(x, y)) return { x, y };
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
      const t = this.towerPlan;
      this.hud.showPlacement(towerPlaceView(t, w.T));
      this.view.setGhost({ rect: { x: t.tile.x, y: t.tile.y, w: 1, h: 1 }, valid: t.valid, range: UNITS.tower.range / w.T });
    } else {
      this.towerPlan = null;
      this.plan = planPlacement(w.grid, kind, x, y, w.money, w.countOf(kind));
      const p = this.plan;
      this.hud.showPlacement(exhibitPlaceView(p));
      this.view.setGhost({ rect: p.footprint, valid: p.valid, paths: p.newPathTiles, spot: p.viewingSpot });
    }
    const r = this.placementRect();
    if (r) this.anchorToTiles(r);
  }

  /** Tiles covered by the thing being placed, for the panel's position. */
  private placementRect(): Rect | undefined {
    if (this.towerPlan) return { x: this.towerPlan.tile.x, y: this.towerPlan.tile.y, w: 1, h: 1 };
    return this.plan?.footprint;
  }

  private confirmPlacement(): void {
    if (!this.placingKind || !this.world.canBuild) return;
    // Checked again here, so a stale preview can't build something invalid.
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
    this.view?.setGhost(null);
    if (this.hud.panel === 'place') this.hud.closePanels();
  }

  // ---------------------------------------------------------------- floating words

  /** Money paid at a viewing spot. Guests often pay together, so a payment joins a fresh one beside it. */
  private paid(amount: number, x: number, z: number): void {
    const near = this.floats.find((f) => f.amount !== undefined && f.max - f.life < 0.35 && Math.hypot(f.x - x, f.z - z) < 1);
    if (near) {
      near.amount = (near.amount ?? 0) + amount;
      near.el.textContent = `+$${near.amount}`;
      return;
    }
    this.float(`+$${amount}`, x + (Math.random() - 0.5) * 0.4, 0.55, z, '#ffd166', 1.1);
    this.floats[this.floats.length - 1].amount = amount;
  }

  /** Text that rises from a point (tiles) and fades. */
  private float(text: string, x: number, y: number, z: number, color: string, seconds: number): void {
    // A busy park pays often; past a few dozen at once, the oldest go first.
    if (this.floats.length > 40) this.floats.shift()?.el.remove();
    const el = document.createElement('div');
    el.className = 'float-label';
    el.textContent = text;
    el.style.color = color;
    this.floatLayer.append(el);
    this.floats.push({ el, x, y, z, life: seconds, max: seconds });
  }

  private updateFloats(dt: number): void {
    for (let i = this.floats.length - 1; i >= 0; i--) {
      const f = this.floats[i];
      f.life -= dt;
      if (f.life <= 0) {
        f.el.remove();
        this.floats.splice(i, 1);
        continue;
      }
      const k = 1 - f.life / f.max;
      const p = this.view.project(f.x, f.y + k * 0.6, f.z);
      f.el.style.transform = `translate(${p.x.toFixed(1)}px, ${(p.y + this.area.top).toFixed(1)}px) translate(-50%, -50%)`;
      f.el.style.opacity = String(Math.min(1, (f.life / f.max) * 2.5));
    }
  }
}

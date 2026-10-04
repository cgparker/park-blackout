// The playable 3D slice: levels 1 and 2 drawn in real 3D with three.js. The rules come from src/core
// and the HUD from src/ui, as in the 2D game. This controller turns touches into orders and keeps the
// camera, the HUD, and the 3D view in step with the world. It only reads the world and sends it orders.
import { BLACKOUT, CAMERA, DINOS, EXHIBITS, INPUT, SCORING, SIM, UNITS, VIEW3D, type AnimalKind, type LevelId, type UnitKind } from '../config';
import { secondsToSedate } from '../core/estimates';
import type { Point, Rect } from '../core/grid';
import { animalNoun } from '../core/report';
import { cancelQueued, canTrainNow, enqueueUnit, isTargetable, isTroop, orderAttack, orderMove } from '../core/units';
import { World, type GameEvent } from '../core/world';
import type { Params } from '../params';
import { MARGIN } from '../render3d/terrain';
import { View3D, type Quality, type ViewWorld } from '../render3d/View3D';
import { viewOf } from './viewOf';
import { goalsNow } from '../ui/goals';
import { formatClock, type ArrowView, type BriefingOptions, type ExhibitView, type Hud, type TrainingView } from '../ui/hud';
import { loadTipsOn, saveTipsOn } from '../ui/prefs';
import { tipsFor, type Tip, type TipId } from '../ui/tips';

/** Levels the slice offers. */
export const SLICE_LEVELS: readonly LevelId[] = [1, 2];

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

export class SliceGame {
  private world!: World;
  private vw!: ViewWorld;
  private view!: View3D;
  private canvas: HTMLCanvasElement;
  private readonly session: { level: LevelId; debug: boolean; tips: boolean };
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
    this.session = { level, debug: params.debug, tips: loadTipsOn() };
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'view3d';
    container.append(this.canvas);
    this.boxEl = document.createElement('div');
    this.boxEl.className = 'select-box hidden';
    this.ringEl = document.createElement('div');
    this.ringEl.className = 'press-ring hidden';
    container.append(this.boxEl, this.ringEl);

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
    this.view = new View3D(this.canvas, { base: '.', quality: this.quality, night: false, guests: false });
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
    this.world = new World({ seed: this.params.seed ?? undefined, level: this.session.level });
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
      quick: false,
      debug: this.session.debug,
      tips: this.session.tips,
    });
    // Start at HQ, where the troops come from.
    const hq = w.map.hq;
    this.cam = { x: hq.x + hq.w / 2 + 6, z: hq.y + hq.h / 2 - 2, dist: VIEW3D.defaultDist };
    this.applyCamera();
    this.hud.setArrows([]);
  }

  private keepOptions(o: BriefingOptions): void {
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
      const view = new View3D(canvas, { base: '.', quality: q, night: this.night, guests: false });
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
      if (this.quality !== 'low' && !this.slowHinted && this.world.phase === 'hunt' && !this.hud.tipOpen && !this.hud.menuOpen) {
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
    for (const id of this.selected) if (!w.unitById(id)) this.selected.delete(id);
    this.view.render(this.vw, { selected: this.selected }, dt);
    this.refreshHud();
    this.updateArrows();
    this.updateOverlays(now);
  };

  // ---------------------------------------------------------------- HUD

  private wireHud(): void {
    this.hud.handlers = {
      selectBuild: () => undefined,
      confirmPlacement: () => undefined,
      cancelPlacement: () => undefined,
      reinforce: () => undefined,
      start: (o) => {
        this.keepOptions(o);
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
      closePanel: () => this.hud.closePanels(),
      selectAll: () => {
        this.selected = new Set(this.world.units.filter(isTroop).map((u) => u.id));
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
      debugBlackout: () => undefined,
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
    this.hud.setBuildBar(false, w.money, { pasture: 0, raptor: 0, trex: 0 }, null);
    let tranq = 0;
    let heavy = 0;
    for (const id of this.selected) {
      const u = w.unitById(id);
      if (u?.kind === 'tranq') tranq++;
      else if (u?.kind === 'heavy') heavy++;
    }
    const parts = [tranq ? `${tranq} Tranq` : '', heavy ? `${heavy} Heavy` : ''].filter(Boolean);
    const troops = w.units.reduce((n, u) => (isTroop(u) ? n + 1 : n), 0);
    this.hud.setTroops(troops, this.selected.size, `${parts.join(' · ')} selected`, w.queue.length, true);
    if (this.hud.panel === 'train') {
      this.hud.updateTraining(this.trainingView());
      this.anchorToTiles(w.map.hq);
    } else if (this.hud.panel === 'exhibit') {
      const ex = w.exhibitById(this.hud.shownExhibit);
      if (ex) {
        this.hud.updateExhibit(this.exhibitView(ex.id)!);
        this.anchorToTiles(ex.footprint);
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

  private trainingView(): TrainingView {
    const w = this.world;
    const team = [...w.units.filter(isTroop).map((u) => u.kind), ...w.queue.map((q) => q.kind)];
    const kinds = (Object.keys(w.startedLoose) as AnimalKind[]).map((kind) => ({ kind, count: 1 }));
    return {
      money: w.money,
      canTrain: canTrainNow(w),
      kinds: w.trainable,
      queue: w.queue.map((q, i) => ({ id: q.id, kind: q.kind, progress: i === 0 ? 1 - q.left / UNITS[q.kind].trainSeconds : 0 })),
      team: { troops: team.length, targets: kinds.map((k) => ({ ...k, seconds: secondsToSedate(team, k.kind, k.count) })) },
    };
  }

  private openTraining(): void {
    if (this.world.phase === 'briefing' || this.world.phase === 'ended') return;
    this.hud.showTraining(this.trainingView());
    this.anchorToTiles(this.world.map.hq);
  }

  private train(kind: UnitKind): void {
    if (!enqueueUnit(this.world, kind)) this.hud.toast(this.world.money < UNITS[kind].cost ? 'Not enough money' : 'The queue is full');
  }

  private exhibitView(id: number): ExhibitView | null {
    const w = this.world;
    const ex = w.exhibitById(id);
    if (!ex) return null;
    const segs = ex.segments;
    const gaps = segs.filter((s) => s.hp <= 0).length;
    const material = ex.reinforced ? 'Concrete' : 'Chain-link';
    const fence = gaps ? `${material}, ${gaps} ${gaps === 1 ? 'segment' : 'segments'} down` : `${material}, powered`;
    const kind = EXHIBITS[ex.kind].animal;
    const mine = w.dinos.filter((d) => d.home === ex.id);
    const inside = mine.filter((d) => d.state === 'penned' || d.state === 'contained').length;
    const out = mine.filter((d) => d.state === 'loose').length;
    const name = DINOS[kind];
    const animals = out ? `${inside} inside · ${out} loose` : inside ? `${inside} ${inside === 1 ? name.name : name.plural}` : 'None left';
    return { id: ex.id, name: EXHIBITS[ex.kind].name, kind: ex.kind, visits: ex.visits, revenue: ex.revenue, fence, animals, reinforceCost: null, reinforced: ex.reinforced, money: w.money, closed: true, breakout: null };
  }

  private openExhibit(id: number): void {
    const v = this.exhibitView(id);
    if (!v) return;
    this.hud.showExhibit(v);
    this.anchorToTiles(this.world.exhibitById(id)!.footprint);
  }

  private openMenu(): void {
    const w = this.world;
    if (w.phase === 'briefing' || w.phase === 'ended') return;
    this.hud.showMenu(
      goalsNow({ phase: w.phase, loose: w.looseCount, revenue: w.revenue, target: w.revenueTarget, casualties: w.casualtyTotal, level: w.level, spent: w.troopSpending, timeLeft: w.clockSeconds, troopsLost: w.troopsLost }),
    );
  }

  // ---------------------------------------------------------------- events and tips

  private handleEvents(events: readonly GameEvent[]): void {
    const w = this.world;
    const T = w.T;
    for (const e of events) {
      switch (e.type) {
        case 'started': {
          const loose = w.dinos.filter((d) => d.state === 'loose');
          const kind = (Object.keys(w.startedLoose)[0] as AnimalKind | undefined) ?? 'triceratops';
          const what = `${loose.length} ${animalNoun(kind, loose.length)}`;
          this.hud.showBanner(`${what} ${w.nest ? 'are guarding a nest' : 'are loose'}. The park opens in ${formatClock(w.clockSeconds)}.`, 'warn', 4);
          const pts = loose.map((d) => ({ x: d.x / T, y: d.y / T }));
          if (w.nest) pts.push({ x: w.nest.x / T, y: w.nest.y / T });
          this.frame(pts, true);
          break;
        }
        case 'breach':
          this.breaches.push({ x: e.x, y: e.y, until: w.time + CAMERA.breachArrowSeconds });
          break;
        case 'escaped': {
          const lastAt = this.escapeToasts.get(e.kind) ?? -Infinity;
          if (w.time - lastAt > 3) {
            this.escapeToasts.set(e.kind, w.time);
            this.hud.toast(e.kind === 'raptor' ? 'Raptors are loose!' : e.kind === 'trex' ? 'The T. rex is loose!' : 'A Triceratops broke out!');
          }
          break;
        }
        case 'trained':
          this.hud.toast(`${UNITS[e.kind].name} ready`);
          break;
        case 'unitLost':
          this.hud.toast(`${UNITS[e.kind].name} lost`);
          break;
        case 'secured': {
          const left = w.looseCount;
          if (left) this.hud.toast(`${DINOS[e.kind].name} darted. ${left} to go.`);
          break;
        }
        case 'ended':
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
    if (w.phase !== 'hunt') {
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
        else if (this.hud.panel) this.hud.closePanels();
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
    if (this.gesture !== 'press' || this.pointers.size !== 1) return;
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
    const info = this.gesture === 'press' && this.pointers.size === 1 ? [...this.pointers.values()][0] : null;
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
      if (!isTroop(u)) return false;
      const p = this.view.project(u.x / T, 0.25, u.y / T);
      return p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;
    });
    this.selected = new Set(picked.map((u) => u.id));
    if (picked.length) this.hud.closePanels();
  }

  private handleTap(sx: number, sy: number): void {
    if (this.world.phase === 'ended') return;
    const unit = this.unitAt(sx, sy);
    if (unit) {
      this.selected = new Set([unit.id]);
      if (this.hud.panel) this.hud.closePanels();
      return;
    }
    const g = this.view.groundAt(sx, sy);
    if (!g) return;
    const tx = Math.floor(g.x);
    const ty = Math.floor(g.z);
    const hq = this.world.map.hq;
    if (tx >= hq.x && ty >= hq.y && tx < hq.x + hq.w && ty < hq.y + hq.h) {
      this.openTraining();
      return;
    }
    if (this.selected.size) {
      this.command(sx, sy);
      return;
    }
    const ex = this.world.grid.inBounds(tx, ty) ? this.world.exhibitAtTile(tx, ty) : undefined;
    if (ex) this.openExhibit(ex.id);
    else this.hud.closePanels();
  }

  /** Move or attack with the selected troops. */
  private command(sx: number, sy: number): void {
    const w = this.world;
    if (!this.selected.size || w.phase === 'ended') return;
    const dino = this.dinoAt(sx, sy);
    if (dino) {
      orderAttack(w, this.selected, dino.id);
      this.view.markAttack(dino.x / w.T, dino.y / w.T);
      return;
    }
    const g = this.view.groundAt(sx, sy);
    if (!g) return;
    const x = clamp(g.x, 0.05, w.grid.cols - 0.05) * w.T;
    const y = clamp(g.z, 0.05, w.grid.rows - 0.05) * w.T;
    orderMove(w, this.selected, x, y);
    this.view.markMove(x / w.T, y / w.T);
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
      if (!isTroop(u)) continue;
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
}

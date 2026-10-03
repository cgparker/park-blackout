import {
  BLACKOUT,
  ECONOMY,
  FENCE,
  MAP,
  SCORING,
  TIPS,
  UNIT_KINDS,
  UNITS,
  type AnimalKind,
  type ExhibitKind,
  type HuntConfig,
  type LevelId,
  type MapConfig,
  type UnitKind,
} from '../config';
import { containDino, evictFromPens, spawnAnimals, updateDinos, type Dino } from './dinos';
import { buildSegments, inFootprint, reinforceCost, type Exhibit } from './exhibit';
import { createGrid, Tile, type Grid, type Point } from './grid';
import { guarded, nearestExhibit, troopsNear } from './guard';
import { huntConfig, setupHunt } from './levels';
import type { LogEntry } from './log';
import { distanceField } from './nav';
import { planTower, type PlacementPlan, type TowerPlan } from './placement';
import { buildResult, type EndReason, type Result } from './report';
import { createRng, type Rng } from './rng';
import { createUnit, isTroop, unitsAfterBuild, updateTraining, updateUnits, type QueueItem, type Unit } from './units';
import { evacuate, updateVisitors, type Visitor } from './visitors';

/** `hunt` is levels 1 and 2: the park is built and closed, and the clock runs until it opens. */
export type Phase = 'briefing' | 'build' | 'blackout' | 'restored' | 'hunt' | 'ended';
export type CasualtyCause = 'raptor' | 'trex' | 'stampede';

export type GameEvent =
  | { type: 'started' }
  | { type: 'built'; exhibitId: number }
  | { type: 'reinforced'; exhibitId: number }
  | { type: 'paid'; x: number; y: number; amount: number }
  | { type: 'warning'; secondsLeft: number }
  | { type: 'blackout' }
  | { type: 'evacuation'; kind: AnimalKind }
  | { type: 'powerRestored'; contained: number }
  | { type: 'trained'; unitId: number; kind: UnitKind }
  | { type: 'towerBuilt'; unitId: number }
  | { type: 'unitLost'; unitId: number; kind: UnitKind; x: number; y: number; by: AnimalKind | null }
  | { type: 'charge'; dinoId: number; x: number; y: number }
  | { type: 'dart'; x0: number; y0: number; x1: number; y1: number; heavy: boolean }
  | { type: 'bite'; x: number; y: number }
  /** A Triceratops starts to run. `byTroop`: a troop scared it, not a predator. */
  | { type: 'stampede'; dinoId: number; x: number; y: number; byTroop: boolean }
  | { type: 'fenceHit'; exhibitId: number; x: number; y: number }
  | { type: 'breach'; exhibitId: number; kind: ExhibitKind; x: number; y: number }
  | { type: 'escaped'; dinoId: number; kind: AnimalKind }
  | { type: 'secured'; dinoId: number; kind: AnimalKind; x: number; y: number }
  | { type: 'casualty'; x: number; y: number; cause: CasualtyCause }
  | { type: 'ended'; won: boolean };

export interface WorldOptions {
  map?: MapConfig;
  seed?: number;
  buildPhaseSeconds?: number;
  startingMoney?: number;
  /** 1 and 2 start in a built park with animals out. 3, the default, is the blackout. */
  level?: LevelId;
}

/** The whole game state and rules. No Phaser in here, so it runs in tests and headless simulations. */
export class World {
  readonly map: MapConfig;
  readonly T: number;
  readonly grid: Grid;
  readonly rng: Rng;
  buildPhaseSeconds: number;
  readonly level: LevelId;
  /** Levels 1 and 2: the level's rules. null in the blackout level. */
  readonly hunt: HuntConfig | null;
  /** Level 2: where the raptors guard their nest, in world pixels. */
  readonly nest: Point | null;
  /** Troops HQ can train in this level. */
  readonly trainable: readonly UnitKind[];
  /** Levels 1 and 2: animals back in a pen, darted and carried there or walked in. */
  returned = 0;
  /** Levels 1 and 2: what is loose when the level starts, by kind. Empty in the blackout level. */
  readonly startedLoose: Partial<Record<AnimalKind, number>> = {};

  phase: Phase = 'briefing';
  powerOn = true;
  /** Seconds since the build phase started. */
  time = 0;
  /** Seconds since the current phase started. */
  phaseTime = 0;
  private warned = false;

  money: number;
  /** Earned from visitors. Guests keep paying in the dark until the park evacuates. */
  revenue = 0;
  /** The part of revenue earned while the power was out. */
  blackoutRevenue = 0;
  /** Set when the first animal gets loose and the park sends every guest to the gate. */
  evacuating = false;
  /** Seconds into the blackout when the evacuation started, or -1. */
  evacuatedAt = -1;
  /** The animal whose escape started the evacuation. */
  evacuatedBy: AnimalKind | null = null;
  readonly spending = { exhibits: 0, paths: 0, reinforcement: 0, troops: 0, towers: 0 };

  readonly exhibits: Exhibit[] = [];
  visitors: Visitor[] = [];
  units: Unit[] = [];
  dinos: Dino[] = [];
  readonly queue: QueueItem[] = [];

  readonly casualties: Record<CasualtyCause, number> = { raptor: 0, trex: 0, stampede: 0 };
  /** Visitors in the park when the power went out, and how many of them walked out alive. */
  visitorsAtBlackout = 0;
  visitorsSafe = 0;
  troopsTrained = 0;
  troopsLost = 0;
  towersBuilt = 0;
  towersLost = 0;
  dinosSecured = 0;
  dinosContained = 0;
  result: Result | null = null;

  /** What happened after the lights went out (or, in levels 1 and 2, after the start), for the end screen. */
  readonly log: LogEntry[] = [];
  /** World time when the log's clock started (the power cut, or the start of levels 1 and 2), or -1. */
  private logStart = -1;
  private readonly escapedFrom = new Set<number>();
  private loggedEmpty = false;
  private loggedClear = false;

  /** Things that happened since the renderer last looked. */
  events: GameEvent[] = [];

  /** Visitor routing: steps over the path network to each exhibit's viewing spot, and to the gate. */
  readonly visitorFields = new Map<number, Int16Array>();
  gateField: Int16Array;
  spawnAccumulator = 0;

  /** Fence segment at each tile, encoded as exhibitIndex * 1024 + segmentIndex. -1 means none. */
  private readonly fenceIndex: Int32Array;
  private nextId = 1;

  constructor(options: WorldOptions = {}) {
    this.map = options.map ?? MAP;
    this.T = this.map.tileSize;
    this.grid = createGrid(this.map);
    this.rng = createRng(options.seed ?? Math.floor(Math.random() * 2 ** 31));
    this.buildPhaseSeconds = options.buildPhaseSeconds ?? BLACKOUT.buildPhaseSeconds;
    this.level = options.level ?? 3;
    this.hunt = huntConfig(this.level);
    const n = this.hunt?.nest;
    this.nest = n ? { x: (n[0] + 0.5) * this.T, y: (n[1] + 0.5) * this.T } : null;
    this.trainable = this.hunt?.units ?? UNIT_KINDS;
    this.money = options.startingMoney ?? this.hunt?.startingMoney ?? ECONOMY.startingMoney;
    this.fenceIndex = new Int32Array(this.grid.cols * this.grid.rows).fill(-1);
    this.gateField = this.pathField(this.map.gate);
    if (this.hunt) {
      setupHunt(this, this.hunt);
      for (const d of this.dinos) if (d.state === 'loose') this.startedLoose[d.kind] = (this.startedLoose[d.kind] ?? 0) + 1;
    }
  }

  // ------------------------------------------------------------ walkability

  /** Visitors stay on paths. */
  readonly visitorWalk = (x: number, y: number): boolean => this.grid.inBounds(x, y) && this.grid.isPathNetwork(x, y);

  /** Troops walk on grass and paths and never enter exhibits. */
  readonly unitWalk = (x: number, y: number): boolean => {
    if (!this.grid.inBounds(x, y)) return false;
    const t = this.grid.get(x, y);
    return t === Tile.Grass || t === Tile.Path || t === Tile.Gate;
  };

  /** Dinosaurs go anywhere except rocks, water, HQ, towers, and standing fence. */
  readonly dinoWalk = (x: number, y: number): boolean => {
    if (!this.grid.inBounds(x, y)) return false;
    const t = this.grid.get(x, y);
    if (t === Tile.Rock || t === Tile.Water || t === Tile.HQ || t === Tile.Tower) return false;
    if (t !== Tile.Exhibit) return true;
    const ref = this.fenceIndex[this.grid.index(x, y)];
    if (ref < 0) return true;
    return this.exhibits[Math.floor(ref / 1024)].segments[ref % 1024].hp <= 0;
  };

  // ------------------------------------------------------------ queries

  newId(): number {
    return this.nextId++;
  }

  get revenueTarget(): number {
    return Math.round((ECONOMY.revenueTargetPerMinute * this.buildPhaseSeconds) / 60);
  }

  get casualtyTotal(): number {
    return this.casualties.raptor + this.casualties.trex + this.casualties.stampede;
  }

  /** Exhibits, towers, and concrete: before the blackout, and never in levels 1 and 2, where the park is already built. */
  get canBuild(): boolean {
    return !this.hunt && (this.phase === 'briefing' || this.phase === 'build');
  }

  /** Seconds on the big clock: until the blackout, until power returns, until the park is overrun, or until it opens. */
  get clockSeconds(): number {
    switch (this.phase) {
      case 'briefing':
        return this.hunt ? this.hunt.timeLimitSeconds : this.buildPhaseSeconds;
      case 'build':
        return Math.max(0, this.buildPhaseSeconds - this.phaseTime);
      case 'blackout':
        return Math.max(0, BLACKOUT.powerRestoreSeconds - this.phaseTime);
      case 'restored':
        return Math.max(0, BLACKOUT.overrunSeconds - this.phaseTime);
      case 'hunt':
        return Math.max(0, this.hunt!.timeLimitSeconds - this.phaseTime);
      default:
        return 0;
    }
  }

  /** Seconds since the log's clock started: the power cut, or the start of levels 1 and 2. 0 before that. */
  get logTime(): number {
    return this.logStart < 0 ? 0 : this.time - this.logStart;
  }

  /** Levels 1 and 2: no troops left, none on the way, and not enough money to train one. */
  get outOfTroops(): boolean {
    if (this.units.some((u) => !u.dead && isTroop(u)) || this.queue.length) return false;
    return this.trainable.every((k) => this.money < UNITS[k].cost);
  }

  /** Spent on troops, the second star's measure in levels 1 and 2. */
  get troopSpending(): number {
    return this.spending.troops;
  }

  get looseCount(): number {
    let n = 0;
    for (const d of this.dinos) if (d.state === 'loose') n++;
    return n;
  }

  /** Nothing is loose and no predator is left to break out, so time can run fast until power returns. */
  get allClear(): boolean {
    if (this.phase !== 'blackout') return false;
    return this.dinos.every((d) => d.state === 'secured' || (d.kind === 'triceratops' && d.state === 'penned' && d.stampede <= 0));
  }

  get timeScale(): number {
    return this.allClear ? BLACKOUT.allClearSpeed : 1;
  }

  countOf(kind: ExhibitKind): number {
    let n = 0;
    for (const e of this.exhibits) if (e.kind === kind) n++;
    return n;
  }

  exhibitById(id: number): Exhibit | undefined {
    return this.exhibits.find((e) => e.id === id);
  }

  exhibitAtTile(tx: number, ty: number): Exhibit | undefined {
    if (!this.grid.inBounds(tx, ty)) return undefined;
    const id = this.grid.exhibitIds[this.grid.index(tx, ty)];
    return id ? this.exhibitById(id) : undefined;
  }

  unitById(id: number): Unit | undefined {
    return this.units.find((u) => u.id === id);
  }

  dinoById(id: number): Dino | undefined {
    return this.dinos.find((d) => d.id === id);
  }

  visitorById(id: number): Visitor | undefined {
    return this.visitors.find((v) => v.id === id);
  }

  fenceAt(tx: number, ty: number): { exhibit: Exhibit; index: number } | null {
    if (!this.grid.inBounds(tx, ty)) return null;
    const ref = this.fenceIndex[this.grid.index(tx, ty)];
    if (ref < 0) return null;
    return { exhibit: this.exhibits[Math.floor(ref / 1024)], index: ref % 1024 };
  }

  // ------------------------------------------------------------ actions

  /** Changes the build phase length. Only before the game starts. */
  setBuildPhase(seconds: number): void {
    if (this.phase === 'briefing') this.buildPhaseSeconds = seconds;
  }

  start(): void {
    if (this.phase !== 'briefing') return;
    this.phaseTime = 0;
    if (this.hunt) {
      // The park is built and closed. The clock runs until it opens.
      this.phase = 'hunt';
      this.logStart = this.time;
      this.log.push({ t: 0, type: 'start', loose: { ...this.startedLoose }, nest: !!this.nest });
    } else {
      this.phase = 'build';
    }
    this.events.push({ type: 'started' });
  }

  build(plan: PlacementPlan): Exhibit {
    if (!this.canBuild) throw new Error('Exhibits can only be built before the blackout.');
    if (!plan.valid || !plan.viewingSpot) throw new Error('Cannot build an invalid placement.');
    if (this.money < plan.totalCost) throw new Error('Not enough money.');

    this.money -= plan.totalCost;
    this.spending.exhibits += plan.exhibitCost;
    this.spending.paths += plan.pathCost;
    const exhibit = this.addExhibit(plan);
    this.events.push({ type: 'built', exhibitId: exhibit.id });
    return exhibit;
  }

  /**
   * Puts an exhibit, its path, and its animals down without charging for them.
   * `build` uses it after paying; levels 1 and 2 use it for the park they start with.
   */
  addExhibit(plan: PlacementPlan): Exhibit {
    if (!plan.viewingSpot) throw new Error('Cannot build an invalid placement.');
    const id = this.newId();
    this.grid.forEachInRect(plan.footprint, (x, y) => {
      this.grid.set(x, y, Tile.Exhibit);
      this.grid.exhibitIds[this.grid.index(x, y)] = id;
    });
    for (const p of plan.newPathTiles) this.grid.set(p.x, p.y, Tile.Path);

    const exhibit: Exhibit = {
      id,
      kind: plan.kind,
      footprint: { ...plan.footprint },
      viewingSpot: { ...plan.viewingSpot },
      segments: buildSegments(plan.footprint),
      reinforced: false,
      visits: 0,
      revenue: 0,
      packTarget: null,
      version: 0,
    };
    const index = this.exhibits.length;
    this.exhibits.push(exhibit);
    exhibit.segments.forEach((s, i) => {
      this.fenceIndex[this.grid.index(s.x, s.y)] = index * 1024 + i;
    });

    this.recomputeVisitorFields();
    unitsAfterBuild(this);
    spawnAnimals(this, exhibit);
    return exhibit;
  }

  /** Builds a Tranq Tower on one grass tile. Before the blackout only. */
  buildTower(plan: TowerPlan): Unit {
    if (!this.canBuild) throw new Error('Towers can only be built before the blackout.');
    const { x, y } = plan.tile;
    const check = planTower(this.grid, x, y, this.money);
    if (!check.valid) throw new Error(`Cannot build a tower there: ${check.reason}`);
    const cost = UNITS.tower.cost;
    this.money -= cost;
    this.spending.towers += cost;
    this.towersBuilt++;
    this.grid.set(x, y, Tile.Tower);
    const tower = createUnit(this, 'tower', { x: (x + 0.5) * this.T, y: (y + 0.5) * this.T });
    unitsAfterBuild(this);
    this.events.push({ type: 'towerBuilt', unitId: tower.id });
    return tower;
  }

  /** Upgrades an exhibit's whole fence to concrete. Build phase only, once per exhibit. */
  reinforce(exhibitId: number): boolean {
    const ex = this.exhibitById(exhibitId);
    if (!ex || ex.reinforced || !this.canBuild) return false;
    const cost = reinforceCost(ex.footprint);
    if (this.money < cost) return false;
    this.money -= cost;
    this.spending.reinforcement += cost;
    ex.reinforced = true;
    for (const s of ex.segments) s.hp = s.maxHp = FENCE.concreteHp;
    ex.version++;
    this.events.push({ type: 'reinforced', exhibitId });
    return true;
  }

  startBlackout(): void {
    if (this.phase !== 'build') return;
    this.phase = 'blackout';
    this.phaseTime = 0;
    this.powerOn = false;
    // Nobody tells the guests. They keep touring and paying until the first animal gets out.
    this.visitorsAtBlackout = this.visitors.filter((v) => !v.done).length;
    for (const ex of this.exhibits) ex.version++;
    this.logStart = this.time;
    this.log.push({ t: 0, type: 'blackout', inPark: this.visitorsAtBlackout });
    this.events.push({ type: 'blackout' });
  }

  /** The first animal is loose. The park stops pretending and sends everyone to the gate. */
  private startEvacuation(kind: AnimalKind): void {
    this.evacuating = true;
    this.evacuatedAt = this.phaseTime;
    this.evacuatedBy = kind;
    evacuate(this);
    // The escape that set this off was logged a moment ago, in this same update.
    const trigger = [...this.log].reverse().find((e) => e.type === 'escape');
    if (trigger?.type === 'escape') trigger.evacuation = true;
    this.events.push({ type: 'evacuation', kind });
  }

  /** The player gives up. The game ends now as a loss, so the end screen can show what happened so far. */
  quit(): void {
    if (this.phase === 'briefing' || this.phase === 'ended') return;
    this.end(false, 'abandoned');
  }

  // ------------------------------------------------------------ the blackout log

  /** An animal left its pen. Only the first one out of each exhibit is logged. */
  noteEscape(d: Dino): void {
    if (this.logStart < 0 || this.escapedFrom.has(d.home)) return;
    this.escapedFrom.add(d.home);
    this.log.push({ t: this.logTime, type: 'escape', kind: d.kind, inPark: this.inPark, evacuation: false });
  }

  noteDeath(cause: CasualtyCause, x: number, y: number): void {
    if (this.logStart < 0) return;
    const near = nearestExhibit(this, x, y, TIPS.killNearPenTiles);
    const pen = nearestExhibit(this, x, y, TIPS.killNearPenTiles, 'raptor');
    this.log.push({ t: this.logTime, type: 'death', cause, near: near?.kind ?? null, unguardedPen: !!pen && !guarded(this, pen) });
  }

  noteLoss(kind: UnitKind, x: number, y: number, by: AnimalKind | null): void {
    if (this.logStart < 0) return;
    const alone = kind !== 'tower' && troopsNear(this, x, y, TIPS.lonerRadiusTiles) <= TIPS.lonerMaxFriends;
    this.log.push({ t: this.logTime, type: 'lost', kind, by, alone });
  }

  /** Levels 1 and 2: an animal is back in a pen, darted or on its own. */
  noteBack(d: Dino, how: 'darted' | 'walked'): void {
    if (!this.hunt || this.logStart < 0) return;
    this.returned++;
    this.log.push({ t: this.logTime, type: 'back', kind: d.kind, how, left: this.looseCount });
  }

  /** Visitors still in the park. */
  get inPark(): number {
    let n = 0;
    for (const v of this.visitors) if (!v.done) n++;
    return n;
  }

  restorePower(): void {
    if (this.phase !== 'blackout') return;
    this.phase = 'restored';
    this.phaseTime = 0;
    this.powerOn = true;
    for (const ex of this.exhibits) {
      for (const s of ex.segments) s.hp = s.maxHp;
      ex.packTarget = null;
      ex.version++;
    }
    let contained = 0;
    for (const d of this.dinos) {
      if (d.state === 'secured') continue;
      const home = this.exhibitById(d.home);
      const tx = Math.floor(d.x / this.T);
      const ty = Math.floor(d.y / this.T);
      if (home && inFootprint(home.footprint, tx, ty)) {
        containDino(this, d, home);
        contained++;
      } else {
        d.state = 'loose';
        evictFromPens(this, d);
      }
    }
    this.dinosContained += contained;
    this.log.push({ t: this.logTime, type: 'power', contained });
    this.events.push({ type: 'powerRestored', contained });
  }

  update(dt: number): void {
    if (this.phase === 'briefing' || this.phase === 'ended') return;
    this.time += dt;
    this.phaseTime += dt;

    if (this.phase === 'build') {
      const left = this.buildPhaseSeconds - this.phaseTime;
      if (!this.warned && this.buildPhaseSeconds > BLACKOUT.warningAtSecondsLeft && left <= BLACKOUT.warningAtSecondsLeft) {
        this.warned = true;
        this.events.push({ type: 'warning', secondsLeft: Math.ceil(left) });
      }
      if (left <= 0) this.startBlackout();
    } else if (this.phase === 'blackout' && this.phaseTime >= BLACKOUT.powerRestoreSeconds) {
      this.restorePower();
    }

    updateTraining(this, dt);
    updateVisitors(this, dt);
    updateUnits(this, dt);
    updateDinos(this, dt);
    if (!this.evacuating && !this.powerOn) {
      const first = this.dinos.find((d) => d.state === 'loose');
      if (first) this.startEvacuation(first.kind);
    }
    this.cleanup();
    if (this.logStart >= 0 && !this.hunt) this.logMilestones();
    this.checkEnd();
  }

  /** The moments worth a line on the end screen that no single event marks. */
  private logMilestones(): void {
    if (!this.loggedEmpty && this.visitorsAtBlackout > 0 && this.inPark === 0) {
      this.loggedEmpty = true;
      this.log.push({ t: this.logTime, type: 'parkEmpty' });
    }
    if (!this.loggedClear && this.allClear && this.exhibits.some((e) => e.kind !== 'pasture')) {
      this.loggedClear = true;
      this.log.push({ t: this.logTime, type: 'allClear' });
    }
  }

  // ------------------------------------------------------------ internals

  private checkEnd(): void {
    if (this.hunt) {
      if (this.phase !== 'hunt') return;
      if (this.looseCount === 0) this.end(true, 'secured');
      else if (this.phaseTime >= this.hunt.timeLimitSeconds) this.end(false, 'timeUp');
      else if (this.outOfTroops) this.end(false, 'noTroops');
      return;
    }
    if (this.casualtyTotal >= SCORING.casualtyLimit) {
      this.end(false, 'shutdown');
    } else if (this.phase === 'restored') {
      if (this.looseCount === 0) this.end(true, 'secured');
      else if (this.phaseTime >= BLACKOUT.overrunSeconds) this.end(false, 'overrun');
    }
  }

  private end(won: boolean, reason: EndReason): void {
    if (this.phase === 'ended') return;
    if (this.logStart >= 0) {
      const loose: Partial<Record<AnimalKind, number>> = {};
      for (const d of this.dinos) if (d.state === 'loose') loose[d.kind] = (loose[d.kind] ?? 0) + 1;
      this.log.push({ t: this.logTime, type: 'end', reason, loose });
    }
    this.phase = 'ended';
    this.result = buildResult(this, won, reason);
    this.events.push({ type: 'ended', won });
  }

  private cleanup(): void {
    if (this.visitors.some((v) => v.done)) this.visitors = this.visitors.filter((v) => !v.done);
    if (this.units.some((u) => u.dead)) this.units = this.units.filter((u) => !u.dead);
    if (this.dinos.some((d) => d.removed)) this.dinos = this.dinos.filter((d) => !d.removed);
  }

  private pathField(p: Point): Int16Array {
    return distanceField(this.grid.cols, this.grid.rows, this.visitorWalk, p.x, p.y);
  }

  private recomputeVisitorFields(): void {
    this.gateField = this.pathField(this.map.gate);
    this.visitorFields.clear();
    for (const ex of this.exhibits) this.visitorFields.set(ex.id, this.pathField(ex.viewingSpot));
  }
}

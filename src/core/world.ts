import { BLACKOUT, ECONOMY, FENCE, MAP, SCORING, type AnimalKind, type ExhibitKind, type MapConfig, type UnitKind } from '../config';
import { containDino, evictFromPens, spawnAnimals, updateDinos, type Dino } from './dinos';
import { buildSegments, inFootprint, reinforceCost, type Exhibit } from './exhibit';
import { createGrid, Tile, type Grid, type Point } from './grid';
import { distanceField } from './nav';
import type { PlacementPlan } from './placement';
import { buildResult, type EndReason, type Result } from './report';
import { createRng, type Rng } from './rng';
import { unitsAfterBuild, updateTraining, updateUnits, type QueueItem, type Unit } from './units';
import { startFleeing, updateVisitors, type Visitor } from './visitors';

export type Phase = 'briefing' | 'build' | 'blackout' | 'restored' | 'ended';
export type CasualtyCause = 'raptor' | 'trex' | 'stampede';

export type GameEvent =
  | { type: 'started' }
  | { type: 'built'; exhibitId: number }
  | { type: 'reinforced'; exhibitId: number }
  | { type: 'paid'; x: number; y: number; amount: number }
  | { type: 'warning'; secondsLeft: number }
  | { type: 'blackout' }
  | { type: 'powerRestored'; contained: number }
  | { type: 'trained'; unitId: number; kind: UnitKind }
  | { type: 'unitLost'; unitId: number; kind: UnitKind; x: number; y: number }
  | { type: 'dart'; x0: number; y0: number; x1: number; y1: number; heavy: boolean }
  | { type: 'bite'; x: number; y: number }
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
}

/** The whole game state and rules. No Phaser in here, so it runs in tests and headless simulations. */
export class World {
  readonly map: MapConfig;
  readonly T: number;
  readonly grid: Grid;
  readonly rng: Rng;
  buildPhaseSeconds: number;

  phase: Phase = 'briefing';
  powerOn = true;
  /** Seconds since the build phase started. */
  time = 0;
  /** Seconds since the current phase started. */
  phaseTime = 0;
  private warned = false;

  money: number;
  /** Earned from visitors (build phase only). */
  revenue = 0;
  readonly spending = { exhibits: 0, paths: 0, reinforcement: 0, troops: 0 };

  readonly exhibits: Exhibit[] = [];
  visitors: Visitor[] = [];
  units: Unit[] = [];
  dinos: Dino[] = [];
  readonly queue: QueueItem[] = [];

  readonly casualties: Record<CasualtyCause, number> = { raptor: 0, trex: 0, stampede: 0 };
  visitorsSafe = 0;
  troopsTrained = 0;
  troopsLost = 0;
  dinosSecured = 0;
  dinosContained = 0;
  result: Result | null = null;

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
    this.money = options.startingMoney ?? ECONOMY.startingMoney;
    this.fenceIndex = new Int32Array(this.grid.cols * this.grid.rows).fill(-1);
    this.gateField = this.pathField(this.map.gate);
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

  /** Dinosaurs go anywhere except rocks, water, HQ, and standing fence. */
  readonly dinoWalk = (x: number, y: number): boolean => {
    if (!this.grid.inBounds(x, y)) return false;
    const t = this.grid.get(x, y);
    if (t === Tile.Rock || t === Tile.Water || t === Tile.HQ) return false;
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

  get canBuild(): boolean {
    return this.phase === 'briefing' || this.phase === 'build';
  }

  /** Seconds on the big clock: until the blackout, until power returns, or until the park is overrun. */
  get clockSeconds(): number {
    switch (this.phase) {
      case 'briefing':
        return this.buildPhaseSeconds;
      case 'build':
        return Math.max(0, this.buildPhaseSeconds - this.phaseTime);
      case 'blackout':
        return Math.max(0, BLACKOUT.powerRestoreSeconds - this.phaseTime);
      case 'restored':
        return Math.max(0, BLACKOUT.overrunSeconds - this.phaseTime);
      default:
        return 0;
    }
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
    this.phase = 'build';
    this.phaseTime = 0;
    this.events.push({ type: 'started' });
  }

  build(plan: PlacementPlan): Exhibit {
    if (!this.canBuild) throw new Error('Exhibits can only be built before the blackout.');
    if (!plan.valid || !plan.viewingSpot) throw new Error('Cannot build an invalid placement.');
    if (this.money < plan.totalCost) throw new Error('Not enough money.');

    this.money -= plan.totalCost;
    this.spending.exhibits += plan.exhibitCost;
    this.spending.paths += plan.pathCost;

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
    this.events.push({ type: 'built', exhibitId: id });
    return exhibit;
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
    startFleeing(this);
    for (const ex of this.exhibits) ex.version++;
    this.events.push({ type: 'blackout' });
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
    this.cleanup();
    this.checkEnd();
  }

  // ------------------------------------------------------------ internals

  private checkEnd(): void {
    if (this.casualtyTotal >= SCORING.casualtyLimit) {
      this.end(false, 'shutdown');
    } else if (this.phase === 'restored') {
      if (this.looseCount === 0) this.end(true, 'secured');
      else if (this.phaseTime >= BLACKOUT.overrunSeconds) this.end(false, 'overrun');
    }
  }

  private end(won: boolean, reason: EndReason): void {
    if (this.phase === 'ended') return;
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

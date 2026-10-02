// Every tuning number in the game lives in this file (see SPEC.md).

export type ExhibitKind = 'pasture' | 'raptor' | 'trex';
export type AnimalKind = 'triceratops' | 'raptor' | 'trex';
export type UnitKind = 'tranq' | 'heavy' | 'tower';

export const EXHIBIT_KINDS: readonly ExhibitKind[] = ['pasture', 'raptor', 'trex'];
/** Troops trained at HQ. Towers are built, not trained. */
export const UNIT_KINDS: readonly UnitKind[] = ['tranq', 'heavy'];

export interface ExhibitConfig {
  name: string;
  /** Shorter name for the build bar. */
  short: string;
  cost: number;
  pricePerVisit: number;
  appeal: number;
  /** Footprint is size x size tiles, fence ring included. */
  size: number;
  animal: AnimalKind;
  animalCount: number;
  /** null means no limit. */
  maxPerLevel: number | null;
}

export const EXHIBITS: Record<ExhibitKind, ExhibitConfig> = {
  pasture: {
    name: 'Pasture',
    short: 'Pasture',
    cost: 3000,
    pricePerVisit: 10,
    appeal: 1,
    size: 5,
    animal: 'triceratops',
    animalCount: 2,
    maxPerLevel: null,
  },
  raptor: {
    name: 'Raptor Pen',
    short: 'Raptors',
    cost: 6000,
    pricePerVisit: 25,
    appeal: 2,
    size: 4,
    animal: 'raptor',
    animalCount: 3,
    maxPerLevel: 3,
  },
  trex: {
    name: 'T. rex Paddock',
    short: 'T. rex',
    cost: 12000,
    pricePerVisit: 60,
    appeal: 4,
    size: 6,
    animal: 'trex',
    animalCount: 1,
    maxPerLevel: 1,
  },
};

export interface MapConfig {
  tileSize: number;
  cols: number;
  rows: number;
  /** The one gate is both entrance and exit. It must sit on a map edge. */
  gate: { x: number; y: number };
  /** Path tiles leading inward from the gate. */
  stubLength: number;
  hq: { x: number; y: number; w: number; h: number };
  /** One string per row. '.' grass, 'R' rock, 'W' pond. */
  layout: readonly string[];
}

export const MAP: MapConfig = {
  tileSize: 40,
  cols: 40,
  rows: 24,
  gate: { x: 0, y: 12 },
  stubLength: 3,
  hq: { x: 2, y: 14, w: 3, h: 3 },
  layout: [
    '........................................', // 0
    '........................................', // 1
    '........................................', // 2
    '..................WWWW..................', // 3
    '.................WWWWWW..........RRR....', // 4
    '.................WWWWWW...........RR....', // 5
    '..................WWWWW..........R......', // 6
    '...................WWW..................', // 7
    '........................................', // 8
    '.............RR.........................', // 9
    '.............R..........................', // 10
    '........................................', // 11
    '........................................', // 12 (gate row)
    '............................RR..........', // 13
    '...........................RRR..........', // 14
    '...........................RR...........', // 15
    '........................................', // 16
    '........................................', // 17
    '.........RRR............................', // 18
    '..........RR............................', // 19
    '..........R.............................', // 20
    '........................................', // 21
    '........................................', // 22
    '........................................', // 23
  ],
};

export const CAMERA = {
  /** 1 means one world pixel per screen (CSS) pixel. */
  defaultZoom: 0.8,
  maxZoom: 2,
  /** How far past the map edge you can pan, in tiles. */
  edgeMarginTiles: 1,
  /** Keyboard pan speed in screen pixels per second. */
  keyPanSpeed: 700,
  /** Mouse wheel zoom sensitivity. */
  wheelZoomFactor: 0.0015,
};

export const INPUT = {
  /** How far (CSS px) a finger can move and still count as a tap. */
  tapMoveThreshold: 10,
  /** Hold this long, then drag, to draw a selection box. */
  longPressMs: 300,
  /** Extra reach (CSS px) when tapping small things like troops and dinosaurs. */
  tapSlop: 14,
};

export const ECONOMY = {
  /** Enough to open with a T. rex, or two raptor pens and a pasture. The build phase is short. */
  startingMoney: 25000,
  pathCostPerTile: 50,
  /** 2-star target = this x build-phase minutes. */
  revenueTargetPerMinute: 4000,
};

export const FENCE = {
  chainLinkHp: 200,
  concreteHp: 600,
  reinforceCostPerSegment: 150,
};

export const VISITORS = {
  spawnBasePerSecond: 0.1,
  spawnPerAppealPerSecond: 0.12,
  maxInPark: 80,
  /** Short on purpose: a visitor who spends it walking between far-apart exhibits pays for fewer of them. */
  timeBudgetSeconds: 35,
  viewSeconds: 4,
  distanceFalloffTiles: 8,
  /** Random bump added to each exhibit's score so crowds don't all pick the same one. */
  choiceNoise: 0.05,
  walkSpeed: 50,
  fleeSpeed: 100,
  radius: 4,
  /** Visitors walk in loose lanes up to this far from the middle of the path. */
  laneJitterPx: 10,
  // Visitors don't notice the blackout. They only run when danger shows up near them:
  /** A fence breaks within this many tiles. */
  panicBreachRadiusTiles: 8,
  /** A loose dinosaur comes within this many tiles. */
  panicDinoRadiusTiles: 5,
  /** Someone is killed within this many tiles. */
  panicCasualtyRadiusTiles: 6,
};

export interface UnitConfig {
  name: string;
  cost: number;
  trainSeconds: number;
  hp: number;
  speed: number;
  range: number;
  dartSedation: number;
  fireIntervalSeconds: number;
  radius: number;
}

export const UNITS: Record<UnitKind, UnitConfig> = {
  tranq: {
    name: 'Tranq Squad',
    cost: 1500,
    trainSeconds: 8,
    hp: 100,
    speed: 100,
    range: 160,
    dartSedation: 10,
    fireIntervalSeconds: 1,
    radius: 9,
  },
  heavy: {
    name: 'Heavy Team',
    cost: 4000,
    trainSeconds: 15,
    hp: 250,
    speed: 70,
    range: 200,
    dartSedation: 50,
    fireIntervalSeconds: 2,
    radius: 11,
  },
  /** Built on grass before the blackout. Never moves. Its body fills its tile, so animals bite it from the next one. */
  tower: {
    name: 'Tranq Tower',
    cost: 3000,
    trainSeconds: 0,
    hp: 200,
    speed: 0,
    range: 200,
    dartSedation: 20,
    fireIntervalSeconds: 1.5,
    radius: 20,
  },
};

export const COMBAT = {
  /**
   * Whether darts can hit animals still behind their own fence during the blackout.
   * Off: a squad parked beside a pen would put every animal to sleep before it got out, and nothing would ever escape.
   */
  dartPennedAnimals: false,
};

export const SQUAD = {
  queueMax: 5,
  /** Spacing between troops when a group moves to one spot. */
  formationSpacing: 28,
  /** On an attack order, troops close to this fraction of their range before stopping. */
  approachFraction: 0.85,
  repathSeconds: 0.5,
};

export interface DinoConfig {
  name: string;
  plural: string;
  sedation: number;
  /** Top speed when loose. For Triceratops this is the stampede speed. */
  speed: number;
  wanderSpeed: number;
  wanderPauseSeconds: readonly [number, number];
  radius: number;
  /** Damage per bite to troops. 0 means harmless. */
  troopDamage: number;
  biteIntervalSeconds: number;
  /** Damage per hit on a fence segment. */
  fenceDamage: number;
  fenceHitIntervalSeconds: number;
  /** Seconds after the blackout before it attacks its own fence. null means never. */
  breakoutDelaySeconds: number | null;
  /** Pause after killing a visitor. */
  killPauseSeconds: number;
}

export const DINOS: Record<AnimalKind, DinoConfig> = {
  triceratops: {
    name: 'Triceratops',
    plural: 'Triceratops',
    sedation: 120,
    speed: 120,
    wanderSpeed: 12,
    wanderPauseSeconds: [1.5, 4],
    radius: 13,
    troopDamage: 0,
    biteIntervalSeconds: 1,
    fenceDamage: 40,
    fenceHitIntervalSeconds: 0,
    breakoutDelaySeconds: null,
    killPauseSeconds: 0,
  },
  raptor: {
    name: 'Raptor',
    plural: 'Raptors',
    sedation: 60,
    speed: 160,
    wanderSpeed: 34,
    wanderPauseSeconds: [0.4, 1.5],
    radius: 9,
    troopDamage: 10,
    biteIntervalSeconds: 1,
    // 20 per second, dealt as 10 every half second.
    fenceDamage: 10,
    fenceHitIntervalSeconds: 0.5,
    breakoutDelaySeconds: 20,
    killPauseSeconds: 1,
  },
  trex: {
    name: 'T. rex',
    plural: 'T. rex',
    sedation: 800,
    speed: 90,
    wanderSpeed: 16,
    wanderPauseSeconds: [1, 3],
    radius: 20,
    troopDamage: 50,
    biteIntervalSeconds: 1.5,
    fenceDamage: 80,
    fenceHitIntervalSeconds: 1.5,
    breakoutDelaySeconds: 10,
    killPauseSeconds: 1.5,
  },
};

export const DINO_AI = {
  /** How often loose dinosaurs rethink their target. */
  thinkSeconds: 0.5,
  repathSeconds: 0.5,
  /** The T. rex locks onto a troop (or tower) that darted it in the last few seconds within this range... */
  trexLockSeconds: 5,
  trexLockRadiusTiles: 8,
  /** ...and keeps chasing it until it dies or gets this far away. */
  trexLockBreakTiles: 12,
  trexVisitorRadiusTiles: 10,
  /** Charge: a short wind-up, then a straight run at double speed. */
  trexChargeCooldownSeconds: 4,
  trexChargeWindupSeconds: 0.6,
  trexChargeSeconds: 1.2,
  trexChargeSpeedMultiplier: 2,
  trexChargeMinTiles: 1.5,
  trexChargeMaxTiles: 5,
  raptorHuntRadiusTiles: 8,
  triThreatRadiusTiles: 4,
  triStampedeSeconds: 5,
  /** Rest after a stampede before another one can start. */
  triRecoverSeconds: 1.5,
  visitorContactSeconds: 0.5,
  secureFadeSeconds: 2,
  /** How far past both bodies a bite reaches. */
  biteReachPx: 6,
};

export const BLACKOUT = {
  buildPhaseSeconds: 300,
  warningAtSecondsLeft: 60,
  powerRestoreSeconds: 300,
  overrunSeconds: 180,
  /** Time runs this much faster while nothing is loose and no predator is left to escape. */
  allClearSpeed: 8,
  /** The quick-test build phase offered on the briefing screen. */
  quickBuildPhaseSeconds: 120,
  /** Placeholder: Mantah Corp is from Camp Cretaceous. Rename before sharing publicly. */
  villainName: 'Mantah Corp',
};

export const SCORING = {
  casualtyLimit: 10,
};

export const SIM = {
  /** Fixed simulation step in seconds. */
  step: 1 / 60,
  /** Most steps per frame before the game slows down instead of stuttering. */
  maxStepsPerFrame: 40,
};

export const COLORS = {
  background: 0x14251a,
  backgroundBlackout: 0x070d09,
  grass: 0x2f5d34,
  gridLine: 0x000000,
  path: 0xc9a66b,
  rock: 0x7d7d7d,
  rockLight: 0x9a9a9a,
  water: 0x3c6e91,
  waterLight: 0x5b8fb3,
  gate: 0xf2c94c,
  hq: 0x26406b,
  hqTrim: 0x9fc2ff,
  fencePowered: 0x3fe0ff,
  fenceUnpowered: 0x8a8f94,
  fenceReinforced: 0xffffff,
  fenceReinforcedUnpowered: 0xc4c8cc,
  viewingSpot: 0xffffff,
  ghostValid: 0x37d67a,
  ghostInvalid: 0xff4d4d,
  interior: { pasture: 0x88b866, raptor: 0x6b7a3c, trex: 0x6e5a3a } as Record<ExhibitKind, number>,
  animal: { triceratops: 0x2f9e44, raptor: 0xff8c1a, trex: 0xd63a3a } as Record<AnimalKind, number>,
  animalStroke: { triceratops: 0x0b2a12, raptor: 0x4a2500, trex: 0x3a0a0a } as Record<AnimalKind, number>,
  trexNotch: 0x6e1010,
  visitor: 0xffffff,
  visitorFleeing: 0xffc9c9,
  casualty: 0xff3b3b,
  unit: 0x3d8bff,
  unitStroke: 0x0a1f45,
  selection: 0xffd84d,
  dart: 0xffffff,
  sedation: 0xb28dff,
  hp: 0x37d67a,
  hpLow: 0xff5c5c,
  barBack: 0x000000,
  attackMarker: 0xff4d4d,
  moveMarker: 0xffd84d,
  dim: 0x000814,
  tower: 0x1d3a6b,
  towerTrim: 0x9fc2ff,
  charge: 0xff7a1a,
  money: 0xffd166,
};

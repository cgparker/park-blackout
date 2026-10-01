// Every tuning number in the game lives in this file (see SPEC.md).
// Values marked "later" are from the spec and get used in future milestones.

export type ExhibitKind = 'pasture' | 'raptor' | 'trex';
export type AnimalKind = 'triceratops' | 'raptor' | 'trex';

export const EXHIBIT_KINDS: readonly ExhibitKind[] = ['pasture', 'raptor', 'trex'];

export interface ExhibitConfig {
  name: string;
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
  /** Hold time before drag becomes a selection box (Milestone 3). */
  longPressMs: 300,
};

export const ECONOMY = {
  startingMoney: 15000,
  pathCostPerTile: 50,
  /** 2-star target = this x build-phase minutes. */
  revenueTargetPerMinute: 4000,
};

export const FENCE = {
  chainLinkHp: 200,
  concreteHp: 600,
  reinforceCostPerSegment: 150,
};

/** Animals idle-wander inside their pens (pixels per second). Visual only. */
export const ANIMAL_IDLE = {
  triceratops: { speed: 12, pauseSeconds: [1.5, 4] as const },
  raptor: { speed: 34, pauseSeconds: [0.4, 1.5] as const },
  trex: { speed: 16, pauseSeconds: [1, 3] as const },
};

// Later milestones.
export const VISITORS = {
  spawnBasePerSecond: 0.1,
  spawnPerAppealPerSecond: 0.12,
  maxInPark: 80,
  timeBudgetSeconds: 60,
  viewSeconds: 4,
  distanceFalloffTiles: 8,
  walkSpeed: 50,
  fleeSpeed: 100,
};

export const UNITS = {
  queueMax: 5,
  tranqSquad: { name: 'Tranq Squad', cost: 1500, trainSeconds: 8, hp: 100, speed: 100, range: 160, dartSedation: 10, fireIntervalSeconds: 1 },
  heavyTeam: { name: 'Heavy Team', cost: 4000, trainSeconds: 15, hp: 250, speed: 70, range: 200, dartSedation: 50, fireIntervalSeconds: 2 },
};

export const DINOS = {
  casualtyContactSeconds: 0.5,
  secureFadeSeconds: 2,
  triceratops: { sedation: 120, speed: 120, fenceDamage: 40, threatRadiusTiles: 4, stampedeSeconds: 5 },
  raptor: { sedation: 60, speed: 160, troopDamage: 10, attackIntervalSeconds: 1, fenceDamagePerSecond: 20, breakoutDelaySeconds: 20, huntRadiusTiles: 8 },
  trex: {
    sedation: 500,
    speed: 90,
    troopDamage: 50,
    attackIntervalSeconds: 1.5,
    fenceDamagePerHit: 80,
    breakoutDelaySeconds: 10,
    retaliateSeconds: 5,
    retaliateRadiusTiles: 6,
    visitorRadiusTiles: 10,
  },
};

export const BLACKOUT = {
  buildPhaseSeconds: 600,
  warningAtSecondsLeft: 60,
  powerRestoreSeconds: 300,
  overrunSeconds: 180,
  /** Placeholder: Mantah Corp is from Camp Cretaceous. Rename before sharing publicly. */
  villainName: 'Mantah Corp',
};

export const SCORING = {
  casualtyLimit: 10,
};

export const COLORS = {
  background: 0x14251a,
  grass: 0x2f5d34,
  gridLine: 0x000000,
  path: 0xc9a66b,
  pathEdge: 0xa88850,
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
  viewingSpot: 0xffffff,
  ghostValid: 0x37d67a,
  ghostInvalid: 0xff4d4d,
  interior: { pasture: 0x88b866, raptor: 0x6b7a3c, trex: 0x6e5a3a } as Record<ExhibitKind, number>,
  animal: { triceratops: 0x2f9e44, raptor: 0xff8c1a, trex: 0xd63a3a } as Record<AnimalKind, number>,
  trexNotch: 0x6e1010,
};

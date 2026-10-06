// Every tuning number in the game lives in this file (see SPEC.md).

export type ExhibitKind = 'pasture' | 'raptor' | 'trex';
export type AnimalKind = 'triceratops' | 'raptor' | 'trex';
/** Engineers fix level 4's substations. The jeep is level 5's Patrol 4x4. */
export type UnitKind = 'tranq' | 'heavy' | 'tower' | 'engineer' | 'jeep';

export const EXHIBIT_KINDS: readonly ExhibitKind[] = ['pasture', 'raptor', 'trex'];
/** Everything HQ trains in some level. Towers are built, not trained, and level 5's 4x4 comes with the level. */
export const UNIT_KINDS: readonly UnitKind[] = ['tranq', 'heavy', 'engineer'];

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
  /** Length of an automatic camera move: to the park at the blackout, or to an arrow's target. */
  moveSeconds: 0.5,
  /** Space around the exhibits when the camera frames the park at the blackout. */
  frameMarginTiles: 1,
  /** Edge arrows sit this far inside the map's edge. */
  arrowInsetPx: 26,
  /** Off-screen animals of one kind this close together share one arrow. */
  arrowGroupTiles: 4,
  /** An arrow that would land closer than this to a more urgent one is left out. */
  arrowSpacingPx: 36,
  /** A broken fence gets an arrow for this long. */
  breachArrowSeconds: 4,
};

/** The 3D view (the 3d-slice build). Distances are in tiles. */
export const VIEW3D = {
  /** Vertical field of view, degrees. */
  fov: 30,
  /** How steeply the camera looks down, degrees above the horizon. */
  elevationDeg: 56,
  /** Closest and farthest camera distance from the point it looks at. */
  minDist: 7,
  maxDist: 44,
  /** Distance at the start of a level, before it frames the action. */
  defaultDist: 22,
  /** How far past the map edge the camera's focus can go. */
  edgeMarginTiles: 2,
  /** Wheel zoom sensitivity. */
  wheelZoomFactor: 0.0015,
  /** Taps within this many CSS px of a troop or animal pick it. */
  pickRadiusPx: 30,
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
  /** Guests leaving because the park told them to: a brisk walk, not a run. */
  evacuateSpeed: 70,
  fleeSpeed: 100,
  radius: 4,
  /** Visitors walk in loose lanes up to this far from the middle of the path. */
  laneJitterPx: 10,
  // Visitors don't notice the blackout: they keep touring and paying, and their visit time stands still.
  // The park only evacuates them once the first animal gets loose. Some run sooner, when danger shows up near them:
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
    cost: 2250,
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
    cost: 6000,
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
    cost: 4500,
    trainSeconds: 0,
    hp: 200,
    speed: 0,
    range: 200,
    dartSedation: 20,
    fireIntervalSeconds: 1.5,
    radius: 20,
  },
  /** Level 4. Fixes substations (see GRID). Can't dart. */
  engineer: {
    name: 'Engineer',
    cost: 3000,
    trainSeconds: 8,
    hp: 60,
    speed: 100,
    range: 0,
    dartSedation: 0,
    fireIntervalSeconds: 1,
    radius: 9,
  },
  /** Level 5's Patrol 4x4. Carries troops (see JEEP). Can't dart, and isn't for sale. */
  jeep: {
    name: 'Patrol 4x4',
    cost: 0,
    trainSeconds: 0,
    hp: 400,
    speed: 210,
    range: 0,
    dartSedation: 0,
    fireIntervalSeconds: 1,
    radius: 16,
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
  /** Level 5's fights wear this down (see FIGHT). Darts don't touch it. */
  health: number;
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
    health: 300,
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
    health: 100,
    speed: 160,
    wanderSpeed: 34,
    wanderPauseSeconds: [0.4, 1.5],
    radius: 9,
    troopDamage: 10,
    biteIntervalSeconds: 1,
    // 20 per second, dealt as 10 every half second.
    fenceDamage: 10,
    fenceHitIntervalSeconds: 0.5,
    // The park only evacuates once the first animal is out. In a park with a T. rex, the gap between its escape
    // and the raptors' is the guests' head start. At 20 s the park was nearly empty by then, even with every fence
    // reinforced; at 18 s reinforcing the T. rex fence costs lives. See DECISIONS.md, Evacuation.
    breakoutDelaySeconds: 18,
    killPauseSeconds: 1,
  },
  trex: {
    name: 'T. rex',
    plural: 'T. rex',
    sedation: 800,
    health: 1200,
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
  triThreatRadiusTiles: 4,
  triStampedeSeconds: 5,
  /**
   * A stampede that meets rock, water, a building, or the park's edge turns along it in steps of this
   * many degrees, up to the most, instead of stopping dead. Only a cornered Triceratops stops.
   */
  triSlideStepDeg: 30,
  triSlideMaxDeg: 90,
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
  allClearSpeed: 30,
  /** The quick-test build phase offered on the briefing screen. */
  quickBuildPhaseSeconds: 120,
  /** What HQ trains in the blackout. */
  units: ['tranq', 'heavy'] as readonly UnitKind[],
  /** Placeholder: Mantah Corp is from Camp Cretaceous. Rename before sharing publicly. */
  villainName: 'Mantah Corp',
};

/** Tips that teach the two defense lessons. Distances decide when they fire. */
export const TIPS = {
  /** A raptor pen counts as guarded when a troop is within this many tiles of its center. */
  guardRadiusTiles: 6,
  /** A raptor kill this close to an unguarded raptor pen explains what went wrong. */
  killNearPenTiles: 8,
  /** A troop the T. rex kills counts as alone when at most this many other troops are within the radius. */
  lonerRadiusTiles: 4,
  lonerMaxFriends: 1,
};

export const SCORING = {
  /** Visitors killed before the park is shut down. Careless raptor defense reaches it; a good one usually doesn't. */
  casualtyLimit: 8,
};

// ------------------------------------------------------------ levels

/**
 * 3 is the blackout, where you build the park. The others are missions: the park is already built when they start.
 * 1 and 2 come before the blackout, and 4 and 5 after it.
 */
export type LevelId = 1 | 2 | 3 | 4 | 5;
export const LEVEL_IDS: readonly LevelId[] = [1, 2, 3, 4, 5];
export type MissionLevelId = 1 | 2 | 4 | 5;

export type Side = 'top' | 'right' | 'bottom' | 'left';

/** An exhibit standing when a level starts. */
export interface ParkExhibit {
  kind: ExhibitKind;
  /** The tile it is centered on, as if tapped to build it. Built in order, so each path joins the ones before. */
  x: number;
  y: number;
  /** The side whose fence is down. Its animals start loose. */
  open?: Side;
  /** Where its loose animals start, in tiles. Raptors guarding a nest start around it instead. */
  out?: readonly (readonly [number, number])[];
  /**
   * Level 4: a patrol route for each of its loose animals, in tiles. Each starts at its route's first stop and walks
   * the stops in a loop (STEALTH). A route that goes there and back lists the stops both ways.
   */
  patrols?: readonly (readonly (readonly [number, number])[])[];
  /** How many animals it holds, when fewer than usual: the rest were taken away earlier. */
  animals?: number;
  /** One side's fence is dented down to this many HP at the start. */
  dent?: { side: Side; hp: number };
  /** Seconds into the level when the animals inside go for the fence while it has no power. null: never on their own. */
  breakoutAt?: number | null;
  /** Whether its fence has power at the start. Default: yes, unless a broken substation powers it. */
  powered?: boolean;
}

/** Level 4: a broken substation and the pens it powers once fixed. */
export interface SubstationConfig {
  name: string;
  /** Top-left tile of its block (GRID.sizeTiles square). */
  tile: readonly [number, number];
  /** Indices into the level's park list. */
  pens: readonly number[];
}

/** The second and third star goals of a mission level. The first is always the win. */
export type StarGoal =
  | { type: 'spend'; max: number }
  | { type: 'timeLeft'; seconds: number }
  | { type: 'noTroopsLost' }
  | { type: 'noneKilled' }
  /** Level 4: no raptor ever sees the Engineer. */
  | { type: 'neverSpotted' };

export interface MissionConfig {
  /** Seconds on the clock. Anything still loose (or level 4's power still out) when it runs out loses the level. */
  timeLimitSeconds: number;
  /** What the clock runs to: the park opening, or dawn. */
  clock: 'opening' | 'dawn';
  startingMoney: number;
  /** What HQ can train in this level. */
  units: readonly UnitKind[];
  /** Levels 4 and 5: the team the level starts with, beside HQ. Positions in tiles. */
  team?: readonly { kind: UnitKind; at: readonly [number, number] }[];
  park: readonly ParkExhibit[];
  /** Raptors from the open pens guard a nest on this tile. */
  nest: readonly [number, number] | null;
  /** Level 4: the substations. Pens they power start without power. */
  substations?: readonly SubstationConfig[];
  /**
   * What wins the level. 'secure' (the default): nothing loose, and any substations fixed. 'power' (level 4): every
   * substation fixed, whatever is still loose.
   */
  win?: 'secure' | 'power';
  /** Level 4: loose raptors only notice what they see (STEALTH), instead of hunting the whole park. */
  stealth?: boolean;
  /** Level 5: the T. rex and raptors fight each other (FIGHT). */
  fights?: boolean;
  /** Levels 1 and 2: a darted animal wakes up back in its pen. Otherwise it's taken away, as in the blackout. */
  carryHome: boolean;
  /** Second and third stars. */
  stars: readonly [StarGoal, StarGoal];
}

export const MISSIONS: Record<MissionLevelId, MissionConfig> = {
  // Roundup: three pastures are open and their Triceratops are out. Tranq Squads only.
  1: {
    timeLimitSeconds: 150,
    clock: 'opening',
    startingMoney: 9000,
    units: ['tranq'],
    park: [
      { kind: 'pasture', x: 8, y: 8 },
      { kind: 'pasture', x: 16, y: 14, open: 'right', out: [[22, 13], [24, 16]] },
      { kind: 'pasture', x: 27, y: 8, open: 'top', out: [[25, 3], [31, 2]] },
      { kind: 'pasture', x: 22, y: 20, open: 'right', out: [[30, 19], [35, 21]] },
    ],
    nest: null,
    carryHome: true,
    stars: [{ type: 'spend', max: 4500 }, { type: 'timeLeft', seconds: 60 }],
  },
  // Raptor Nest: both raptor pens are open, and all six raptors guard a nest at the east edge.
  2: {
    timeLimitSeconds: 240,
    clock: 'opening',
    startingMoney: 21000,
    units: ['tranq', 'heavy'],
    park: [
      { kind: 'pasture', x: 8, y: 8 },
      { kind: 'raptor', x: 16, y: 14, open: 'right' },
      { kind: 'raptor', x: 27, y: 8, open: 'right' },
      { kind: 'pasture', x: 22, y: 20 },
    ],
    nest: [35, 16],
    carryHome: true,
    stars: [{ type: 'spend', max: 13500 }, { type: 'noTroopsLost' }],
  },
  // Grid Down: right after the blackout, the power is still out. One Engineer and one Tranq Squad fix three
  // substations, one zone each, while two raptors from the east pen walk their routes.
  4: {
    timeLimitSeconds: 210,
    clock: 'dawn',
    startingMoney: 0,
    units: [],
    team: [
      { kind: 'engineer', at: [5.6, 13.6] },
      { kind: 'tranq', at: [5.6, 15.2] },
    ],
    park: [
      { kind: 'raptor', x: 16, y: 14, breakoutAt: 60 },
      { kind: 'pasture', x: 8, y: 8 },
      { kind: 'trex', x: 27, y: 7, breakoutAt: 110, dent: { side: 'bottom', hp: 80 } },
      {
        kind: 'raptor',
        x: 33,
        y: 17,
        open: 'right',
        animals: 2,
        // Each raptor starts somewhere along its route, either way round, so no two nights are the same.
        patrols: [
          // South: round and round the south substation, a tile out from where an Engineer would stand.
          [[25, 18], [30, 18], [30, 23], [25, 23]],
          // North: up the east path, over the top of the north substation a tile out, a look back at its east side,
          // down the east edge, and back. Every side, and the east edge, is watched some of the time.
          [[31, 12], [31, 5], [29, 0], [36, 0], [36, 3], [37, 9]],
        ],
      },
      { kind: 'pasture', x: 22, y: 20 },
    ],
    nest: null,
    substations: [
      { name: 'West', tile: [10, 13], pens: [0, 1] },
      { name: 'North', tile: [31, 2], pens: [2] },
      { name: 'South', tile: [27, 20], pens: [3] },
    ],
    win: 'power',
    stealth: true,
    carryHome: false,
    stars: [{ type: 'noTroopsLost' }, { type: 'neverSpotted' }],
  },
  // Showdown: the T. rex and a raptor pack fight north of the east rocks. A fixed team and the Patrol 4x4.
  5: {
    timeLimitSeconds: 180,
    clock: 'opening',
    startingMoney: 0,
    units: [],
    team: [
      { kind: 'heavy', at: [5.2, 14] },
      { kind: 'heavy', at: [5.2, 15.2] },
      { kind: 'tranq', at: [6.3, 14] },
      { kind: 'tranq', at: [6.3, 15.2] },
      { kind: 'jeep', at: [7, 12] },
    ],
    park: [
      { kind: 'raptor', x: 16, y: 14, powered: false, breakoutAt: null },
      { kind: 'pasture', x: 8, y: 8 },
      { kind: 'trex', x: 27, y: 7, open: 'bottom', out: [[28, 11]] },
      { kind: 'raptor', x: 33, y: 17, open: 'left', out: [[27, 10.2], [29.3, 10.6], [28, 12]] },
      // The south pasture has power of its own, as in level 4, so the fight heads for the west raptor pen.
      { kind: 'pasture', x: 22, y: 20 },
    ],
    nest: null,
    fights: true,
    carryHome: false,
    stars: [{ type: 'noTroopsLost' }, { type: 'noneKilled' }],
  },
};

export const MISSION = {
  /** Loose animals start up to this many tiles from their listed spot, so games differ a little. */
  jitterTiles: 0.4,
};

/** Level 4's substations. */
export const GRID = {
  /** Seconds of one Engineer's work to fix a substation. Engineers working together add up. */
  repairSeconds: 20,
  /** A substation is this many tiles square. */
  sizeTiles: 2,
  /** An Engineer works while its center is this close to the substation's center, in tiles: the ring of tiles around it. */
  reachTiles: 2.2,
};

/**
 * What every loose raptor knows, in every level. It sees a cone ahead of it, but not through rock, a pen, HQ, a tower,
 * or a substation, and it feels anyone who walks into it. Whatever it makes out, it hunts, and it calls the others. A
 * dart from a troop it can't see sends it after the shooter alone.
 */
export const STEALTH = {
  /** How far a raptor sees, in tiles, and how wide its view is, in degrees. */
  sightTiles: 5,
  coneDeg: 90,
  /** Anyone this close (tiles) has walked into it: noticed at once, whichever way it's looking. Touching distance. */
  hearTiles: 0.6,
  /**
   * Someone in its cone takes this long to make out. It stops where it is, its cone turns orange, and it hunts once
   * the time is up. Someone who gets out of sight first is lost, and the raptor takes as long to settle back.
   */
  noticeSeconds: 0.8,
  /** Level 4: walking speed on its route (px/s). */
  patrolSpeed: 45,
  /** Level 4: at each stop on its route it looks around for this long, turning this far each way. */
  lookSeconds: 2.5,
  lookDeg: 70,
  /** A raptor that spots someone, or sees who darted it, calls the calm ones within this many tiles: the whole park. */
  alertTiles: 40,
  /** On the hunt it keeps track of its prey this far away (tiles), in any direction... */
  chaseSightTiles: 10,
  /** ...and calms down after this many seconds without seeing it. A dart shows it where the shooter is. */
  giveUpSeconds: 4,
  /** Rays in a drawn view cone. */
  coneRays: 24,
};

/**
 * Raptors hunting a troop together, in every level: they circle it before they strike. Only troops and towers that
 * can dart are worth circling; anything else, and a lone raptor, gets a straight charge.
 */
export const PACK = {
  /** Troops this close to the prey (tiles) count as its group: the ring stays out of reach of every one of them... */
  groupTiles: 3,
  /** ...by this many tiles past the farthest dart. */
  marginTiles: 1,
  /** Within this many tiles of its place, a raptor is in position. */
  placeTiles: 1.2,
  /** Going round the ring, a raptor aims this many degrees ahead of where it is. */
  aheadDeg: 30,
  /**
   * Where a rock or the corner of a pen sits on the ring, a raptor waits up to this many tiles farther out, or half
   * the margin in, so only water, a whole pen, or the park's edge cuts the ring.
   */
  slackTiles: 2,
  /** They rush once every raptor is in position, or after this long, whichever comes first. */
  circleSeconds: 6,
};

/** Level 5's fight between the T. rex and raptors. */
export const FIGHT = {
  /** Calm raptors this close to a loose T. rex (tiles) go for it. In the fight they pay troops no mind until one darts them. */
  joinTiles: 8,
  /** A raptor's bite on the T. rex, once per raptor bite interval. */
  raptorBite: 5,
  /** The T. rex bites the most wounded raptor in reach for this much, this often. */
  trexBite: 20,
  trexBiteSeconds: 3,
  /** Raptors this close count as on the T. rex (tiles between centers, past both bodies). */
  engageTiles: 0.6,
  /** Raptors on the T. rex keep circling it at this many radians per second, each from its own side. */
  circleSpeed: 0.5,
  /** While raptors are on it, the T. rex pushes toward a pen without power at this speed (px/s) instead of its own. */
  pushSpeed: 20,
  /** While this many raptors or more are on the T. rex, it is too busy with them to lock onto a troop that darts it. */
  shieldRaptors: 2,
  /** When the T. rex locks onto a troop, it roars: it stands facing the troop this long before it moves or charges. */
  lockRoarSeconds: 2,
  /** Animals killed before the level is lost. */
  killLimit: 3,
  /** A killed animal stays down this long before it's gone. */
  deadSeconds: 4,
};

/** Level 5's Patrol 4x4. */
export const JEEP = {
  seats: 2,
  /** A troop climbs in from this far past both bodies (px). */
  boardReachPx: 14,
  /** Tapping an animal with the 4x4 selected drives it to within this many tiles, then drops the troops. */
  dropTiles: 3.5,
};

export const NEST = {
  /** Calm raptors at a nest wander within this many tiles of it. On the hunt they follow the same rules as anywhere. */
  roamTiles: 2,
  /** How big the nest is drawn, in tiles. */
  drawRadiusTiles: 1.1,
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
  nest: 0x6b4a2b,
  nestRim: 0x3d2a17,
  egg: 0xefe4c8,
  substation: 0x2b3138,
  substationTrim: 0x8a96a3,
  bolt: 0xffd84d,
  substationBroken: 0xff4d4d,
  substationFixed: 0x3fe0ff,
  cableOff: 0x6b7178,
  cableOn: 0x3fe0ff,
  engineerRing: 0xffd84d,
  jeep: 0x1d2d5a,
  jeepTrim: 0xe8f0ff,
  health: 0xff4d4d,
  dead: 0x2a2a2a,
  /** Level 4: what a raptor on patrol sees, and the line to a troop it's after. */
  cone: 0xffd36b,
  coneAlert: 0xff5a4a,
  /** Level 4: a raptor making out a troop in its cone. */
  coneNotice: 0xff8a2a,
};

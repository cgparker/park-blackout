import { describe, expect, it } from 'vitest';
import { BLACKOUT, DINO_AI, DINOS, ECONOMY, EXHIBITS, FENCE, MAP, SCORING, SQUAD, UNITS, VISITORS, type ExhibitKind } from '../src/config';
import { damageSegment, hasExit, killVisitor, type Dino } from '../src/core/dinos';
import { Tile } from '../src/core/grid';
import { planPlacement, planTower } from '../src/core/placement';
import { starsFor } from '../src/core/report';
import { cancelQueued, enqueueUnit, orderAttack, orderMove, spawnUnit } from '../src/core/units';
import type { Visitor } from '../src/core/visitors';
import { World, type GameEvent } from '../src/core/world';

const STEP = 1 / 60;
const T = MAP.tileSize;
const RICH = 1_000_000;

/** Runs the world until `seconds` pass or `until` returns true. Returns the events seen. */
function run(w: World, seconds: number, until?: () => boolean): GameEvent[] {
  const seen: GameEvent[] = [];
  const n = Math.round(seconds / STEP);
  for (let i = 0; i < n; i++) {
    w.update(STEP);
    seen.push(...w.events);
    w.events = [];
    if (until?.()) break;
  }
  return seen;
}

function place(w: World, kind: ExhibitKind, x: number, y: number) {
  const plan = planPlacement(w.grid, kind, x, y, w.money, w.countOf(kind));
  if (!plan.valid) throw new Error(`Can't place ${kind} at ${x},${y}: ${plan.reason}`);
  return w.build(plan);
}

/** A visitor standing still at a point (as if viewing). */
function bystander(w: World, x: number, y: number): Visitor {
  const v: Visitor = {
    id: w.newId(),
    x,
    y,
    cx: Math.floor(x / T),
    cy: Math.floor(y / T),
    tx: Math.floor(x / T),
    ty: Math.floor(y / T),
    ox: 0,
    oy: 0,
    mode: 'viewing',
    target: 0,
    visited: [],
    budget: 999,
    timer: 999,
    contact: 0,
    done: false,
  };
  w.visitors.push(v);
  return v;
}

function setLoose(d: Dino, x: number, y: number): void {
  d.state = 'loose';
  d.x = x;
  d.y = y;
  d.path = [];
  d.pathIndex = 0;
  d.target = null;
  d.think = 0;
}

/** World already in the blackout, with no visitors left over. */
function blackoutWorld(build: (w: World) => void, seed = 7): World {
  const w = new World({ seed, startingMoney: RICH, buildPhaseSeconds: 1 });
  build(w);
  w.start();
  run(w, 1.1);
  w.visitors = [];
  expect(w.phase).toBe('blackout');
  return w;
}

describe('visitors and income', () => {
  it('nobody comes until there is an exhibit', () => {
    const w = new World({ seed: 1 });
    w.start();
    run(w, 30);
    expect(w.visitors).toHaveLength(0);
  });

  it('visitors walk to an exhibit, pay, and head home', () => {
    const w = new World({ seed: 2 });
    const ex = place(w, 'pasture', 6, 9);
    const afterBuild = w.money;
    w.start();
    const events = run(w, 150);
    const paid = events.filter((e) => e.type === 'paid');
    expect(ex.visits).toBeGreaterThan(15);
    expect(paid).toHaveLength(ex.visits);
    expect(w.revenue).toBe(ex.visits * EXHIBITS.pasture.pricePerVisit);
    expect(w.money).toBe(afterBuild + w.revenue);
    // Everyone stays on the path network.
    for (const v of w.visitors) expect(w.grid.isPathNetwork(Math.floor(v.x / T), Math.floor(v.y / T))).toBe(true);
  });

  it('spawns 0.10 + 0.12 per point of appeal each second', () => {
    const w = new World({ seed: 3 });
    place(w, 'pasture', 6, 9); // appeal 1 -> 0.22 per second
    w.start();
    const ids = new Set<number>();
    for (let i = 0; i < 100 / STEP; i++) {
      w.update(STEP);
      for (const v of w.visitors) ids.add(v.id);
    }
    expect(ids.size).toBeGreaterThanOrEqual(21);
    expect(ids.size).toBeLessThanOrEqual(23);
  });

  it('holds at most 80 visitors', () => {
    // Short visits rarely fill the park, so stretch them to hit the cap.
    const budget = VISITORS.timeBudgetSeconds;
    VISITORS.timeBudgetSeconds = 120;
    try {
      const w = new World({ seed: 4, startingMoney: RICH, buildPhaseSeconds: 900 });
      place(w, 'trex', 20, 16);
      place(w, 'raptor', 9, 8);
      place(w, 'raptor', 30, 9);
      place(w, 'raptor', 14, 20);
      place(w, 'pasture', 4, 3);
      w.start();
      let most = 0;
      for (let i = 0; i < 200 / STEP; i++) {
        w.update(STEP);
        most = Math.max(most, w.visitors.length);
      }
      expect(most).toBe(VISITORS.maxInPark);
    } finally {
      VISITORS.timeBudgetSeconds = budget;
    }
  });

  it('a visitor out of time walks back to the gate and leaves', () => {
    const w = new World({ seed: 5 });
    place(w, 'pasture', 6, 9);
    w.start();
    run(w, 30, () => w.visitors.length > 0);
    const v = w.visitors[0];
    v.budget = 0.5;
    run(w, 30, () => !w.visitors.includes(v));
    expect(w.visitors.includes(v)).toBe(false);
    expect(v.done).toBe(true);
  });

  it('warns at 1:00, then cuts the power, and visitors stroll on without paying', () => {
    const w = new World({ seed: 6, buildPhaseSeconds: 90 });
    place(w, 'pasture', 6, 9);
    w.start();
    const events = run(w, 90.5);
    const warning = events.find((e) => e.type === 'warning');
    expect(warning).toBeTruthy();
    expect(events.some((e) => e.type === 'blackout')).toBe(true);
    expect(w.phase).toBe('blackout');
    expect(w.powerOn).toBe(false);
    expect(w.visitors.length).toBeGreaterThan(0);
    expect(w.visitorsAtBlackout).toBe(w.visitors.length);
    // Nothing is loose and nothing broke, so nobody has noticed.
    expect(w.visitors.some((v) => v.mode === 'fleeing')).toBe(false);

    const revenue = w.revenue;
    run(w, VISITORS.timeBudgetSeconds + 60);
    expect(w.revenue).toBe(revenue);
    expect(w.visitors).toHaveLength(0);
    expect(w.visitorsSafe).toBe(w.visitorsAtBlackout);
  });

  it('scales the revenue target with the build phase', () => {
    const perMinute = ECONOMY.revenueTargetPerMinute;
    expect(new World({ buildPhaseSeconds: 300 }).revenueTarget).toBe(perMinute * 5);
    expect(new World({ buildPhaseSeconds: 120 }).revenueTarget).toBe(perMinute * 2);
  });
});

describe('visitors in the dark', () => {
  it('a fence breaking sends visitors within 8 tiles running; the rest stroll on', () => {
    let pen!: ReturnType<typeof place>;
    let far!: ReturnType<typeof place>;
    const w = blackoutWorld((w) => {
      pen = place(w, 'raptor', 9, 11);
      far = place(w, 'pasture', 30, 20);
    });
    const near = bystander(w, (pen.viewingSpot.x + 0.5) * T, (pen.viewingSpot.y + 0.5) * T);
    const away = bystander(w, (far.viewingSpot.x + 0.5) * T, (far.viewingSpot.y + 0.5) * T);
    const i = pen.segments.findIndex((s) => !s.corner);
    damageSegment(w, pen, i, FENCE.chainLinkHp);
    expect(near.mode).toBe('fleeing');
    expect(away.mode).toBe('viewing');
  });

  it('visitors run once a loose dinosaur is within 5 tiles', () => {
    let pen!: ReturnType<typeof place>;
    const w = blackoutWorld((w) => (pen = place(w, 'raptor', 9, 11)));
    const v = bystander(w, (pen.viewingSpot.x + 0.5) * T, (pen.viewingSpot.y + 0.5) * T);
    const raptor = w.dinos.find((d) => d.home === pen.id)!;
    setLoose(raptor, v.x, v.y + (VISITORS.panicDinoRadiusTiles + 1) * T);
    raptor.pause = 999;
    run(w, 0.5);
    expect(v.mode).toBe('viewing');
    raptor.y = v.y + (VISITORS.panicDinoRadiusTiles - 1) * T;
    run(w, STEP);
    expect(v.mode).toBe('fleeing');
  });

  it('a death sends everyone within 6 tiles running', () => {
    let pen!: ReturnType<typeof place>;
    let far!: ReturnType<typeof place>;
    const w = blackoutWorld((w) => {
      pen = place(w, 'raptor', 9, 11);
      far = place(w, 'pasture', 30, 20);
    });
    const spot = pen.viewingSpot;
    const victim = bystander(w, (spot.x + 0.5) * T, (spot.y + 0.5) * T);
    const witness = bystander(w, (spot.x + 0.5) * T + 3 * T, (spot.y + 0.5) * T);
    const away = bystander(w, (far.viewingSpot.x + 0.5) * T, (far.viewingSpot.y + 0.5) * T);
    killVisitor(w, victim, 'raptor');
    expect(witness.mode).toBe('fleeing');
    expect(away.mode).toBe('viewing');
    expect(w.casualties.raptor).toBe(1);
  });
});

describe('training and orders', () => {
  it('pays up front and trains a unit beside HQ', () => {
    const w = new World({ seed: 8 });
    w.start();
    expect(enqueueUnit(w, 'tranq')).toBe(true);
    expect(w.money).toBe(ECONOMY.startingMoney - UNITS.tranq.cost);
    expect(w.spending.troops).toBe(UNITS.tranq.cost);
    run(w, UNITS.tranq.trainSeconds - 0.2);
    expect(w.units).toHaveLength(0);
    run(w, 0.4);
    expect(w.units).toHaveLength(1);
    const u = w.units[0];
    const { hq } = MAP;
    expect(u.x).toBeGreaterThan((hq.x - 1) * T);
    expect(u.x).toBeLessThan((hq.x + hq.w + 1) * T);
    expect(u.y).toBeGreaterThan((hq.y - 1) * T);
    expect(u.y).toBeLessThan((hq.y + hq.h + 1) * T);
    expect(w.unitWalk(Math.floor(u.x / T), Math.floor(u.y / T))).toBe(true);
  });

  it('queues at most five and refunds a cancel', () => {
    const w = new World({ seed: 9, startingMoney: RICH });
    w.start();
    for (let i = 0; i < 6; i++) enqueueUnit(w, 'heavy');
    expect(w.queue).toHaveLength(SQUAD.queueMax);
    const before = w.money;
    expect(cancelQueued(w, w.queue[2].id)).toBe(true);
    expect(w.money).toBe(before + UNITS.heavy.cost);
    expect(w.queue).toHaveLength(4);
  });

  it('cannot train before the game starts or without money', () => {
    const w = new World({ seed: 10, startingMoney: 1000 });
    expect(enqueueUnit(w, 'tranq')).toBe(false);
    w.start();
    expect(enqueueUnit(w, 'tranq')).toBe(false);
  });

  it('moves a group to a spot without stacking them', () => {
    const w = new World({ seed: 11 });
    w.start();
    const units = [0, 1, 2, 3].map(() => spawnUnit(w, 'tranq', { x: 6.5 * T, y: 15.5 * T }));
    const goal = { x: 20.5 * T, y: 20.5 * T };
    orderMove(
      w,
      units.map((u) => u.id),
      goal.x,
      goal.y,
    );
    for (let i = 0; i < 30 / STEP; i++) {
      w.update(STEP);
      for (const u of units) expect(w.unitWalk(Math.floor(u.x / T), Math.floor(u.y / T))).toBe(true);
    }
    for (const u of units) {
      expect(u.order).toBe('idle');
      expect(Math.hypot(u.x - goal.x, u.y - goal.y)).toBeLessThan(2 * T);
    }
    for (let i = 0; i < units.length; i++) {
      for (let j = i + 1; j < units.length; j++) {
        expect(Math.hypot(units[i].x - units[j].x, units[i].y - units[j].y)).toBeGreaterThan(UNITS.tranq.radius * 2 - 1);
      }
    }
  });

  it('building over troops moves them off, and walkers route around the new pen', () => {
    const w = new World({ seed: 14, startingMoney: RICH });
    w.start();
    const standing = spawnUnit(w, 'tranq', { x: 20.5 * T, y: 16.5 * T });
    const walker = spawnUnit(w, 'heavy', { x: 12.5 * T, y: 16.5 * T });
    orderMove(w, [walker.id], 28.5 * T, 17.5 * T);
    run(w, 0.5);
    const paddock = place(w, 'trex', 20, 16);
    const inside = (u: { x: number; y: number }) => {
      const f = paddock.footprint;
      const tx = Math.floor(u.x / T);
      const ty = Math.floor(u.y / T);
      return tx >= f.x && ty >= f.y && tx < f.x + f.w && ty < f.y + f.h;
    };
    expect(inside(standing)).toBe(false);
    for (let i = 0; i < 20 / STEP; i++) {
      w.update(STEP);
      expect(inside(walker)).toBe(false);
    }
    expect(walker.order).toBe('idle');
  });

  it('walks around rocks and the pond', () => {
    const w = new World({ seed: 12 });
    w.start();
    const u = spawnUnit(w, 'heavy', { x: 25.5 * T, y: 14.5 * T });
    orderMove(w, [u.id], 31.5 * T, 14.5 * T);
    for (let i = 0; i < 20 / STEP; i++) {
      w.update(STEP);
      expect(w.unitWalk(Math.floor(u.x / T), Math.floor(u.y / T))).toBe(true);
    }
    expect(Math.hypot(u.x - 31.5 * T, u.y - 14.5 * T)).toBeLessThan(2);
  });
});

describe('blackout and cascade', () => {
  it('keeps everyone penned while the power is on', () => {
    const w = new World({ seed: 13, startingMoney: RICH, buildPhaseSeconds: 600 });
    place(w, 'trex', 20, 16);
    place(w, 'raptor', 9, 8);
    w.start();
    spawnUnit(w, 'tranq', { x: 16.5 * T, y: 16.5 * T });
    const events = run(w, 60);
    expect(events.some((e) => e.type === 'fenceHit')).toBe(false);
    expect(w.dinos.every((d) => d.state === 'penned')).toBe(true);
  });

  it('the T. rex breaks chain-link in 3 hits after 10 seconds', () => {
    let rex!: ReturnType<typeof place>;
    const w = blackoutWorld((w) => (rex = place(w, 'trex', 20, 16)));
    const events = run(w, 40, () => w.dinos.some((d) => d.kind === 'trex' && d.state === 'loose'));
    const breach = events.find((e) => e.type === 'breach');
    expect(breach).toBeTruthy();
    const hits = events.filter((e) => e.type === 'fenceHit' && e.exhibitId === rex.id);
    expect(hits).toHaveLength(3);
    expect(w.phaseTime).toBeGreaterThan(DINOS.trex.breakoutDelaySeconds!);
    expect(w.phaseTime).toBeLessThan(18);
  });

  it('concrete takes the T. rex 8 hits', () => {
    let rex!: ReturnType<typeof place>;
    const w = blackoutWorld((w) => {
      rex = place(w, 'trex', 20, 16);
      expect(w.reinforce(rex.id)).toBe(true);
    });
    expect(rex.segments.every((s) => s.hp === FENCE.concreteHp)).toBe(true);
    const events = run(w, 60, () => w.dinos.some((d) => d.kind === 'trex' && d.state === 'loose'));
    expect(events.filter((e) => e.type === 'fenceHit' && e.exhibitId === rex.id)).toHaveLength(8);
  });

  it('the raptor pack hits the weakest segment together after 20 seconds', () => {
    let pen!: ReturnType<typeof place>;
    const w = blackoutWorld((w) => (pen = place(w, 'raptor', 9, 11)));
    const weak = pen.segments.findIndex((s) => !s.corner && s.nx === 1);
    pen.segments[weak].hp = 30;
    const events = run(w, 40, () => w.dinos.some((d) => d.state === 'loose'));
    const breach = events.find((e) => e.type === 'breach');
    expect(breach && breach.type === 'breach' && breach.x).toBe((pen.segments[weak].x + 0.5) * T);
    expect(w.phaseTime).toBeGreaterThan(DINOS.raptor.breakoutDelaySeconds!);
    expect(w.phaseTime).toBeLessThan(DINOS.raptor.breakoutDelaySeconds! + 3);
    run(w, 1);
    expect(w.dinos.filter((d) => d.kind === 'raptor').every((d) => d.state === 'loose')).toBe(true);
  });

  it('Triceratops stampede away from troops and dent their fence', () => {
    let pasture!: ReturnType<typeof place>;
    const w = blackoutWorld((w) => (pasture = place(w, 'pasture', 6, 4)));
    const fp = pasture.footprint;
    spawnUnit(w, 'tranq', { x: (fp.x + fp.w + 1.5) * T, y: (fp.y + 2.5) * T });
    const events = run(w, 6);
    const hits = events.filter((e) => e.type === 'fenceHit' && e.exhibitId === pasture.id);
    expect(hits.length).toBeGreaterThan(0);
    const damaged = pasture.segments.filter((s) => s.hp < s.maxHp);
    for (const s of damaged) expect((s.maxHp - s.hp) % DINOS.triceratops.fenceDamage).toBe(0);
    // They ran away from the troops (west), so the west side took the hits.
    expect(damaged.every((s) => s.x === fp.x)).toBe(true);
  });

  it('a loose T. rex breaks into the nearest pen that still has animals', () => {
    let pasture!: ReturnType<typeof place>;
    const w = blackoutWorld((w) => {
      place(w, 'trex', 20, 16);
      pasture = place(w, 'pasture', 30, 20);
    });
    run(w, 90, () => pasture.segments.some((s) => s.hp === 0));
    expect(pasture.segments.some((s) => s.hp === 0)).toBe(true);
  });
});

describe('combat', () => {
  it('a Heavy Team secures a raptor with two darts', () => {
    let pen!: ReturnType<typeof place>;
    const w = blackoutWorld((w) => (pen = place(w, 'raptor', 9, 11)));
    const raptor = w.dinos.find((d) => d.home === pen.id)!;
    setLoose(raptor, 20.5 * T, 20.5 * T);
    raptor.pause = 999;
    spawnUnit(w, 'heavy', { x: 24.5 * T, y: 20.5 * T });
    const events = run(w, 5, () => raptor.state === 'secured');
    expect(events.filter((e) => e.type === 'dart')).toHaveLength(2);
    expect(raptor.state).toBe('secured');
    expect(w.dinosSecured).toBe(1);
    run(w, BLACKOUT.powerRestoreSeconds > 10 ? 2.1 : 0);
    expect(w.dinos.includes(raptor)).toBe(false);
  });

  it('a Tranq Squad needs six darts for a raptor', () => {
    let pen!: ReturnType<typeof place>;
    const w = blackoutWorld((w) => (pen = place(w, 'raptor', 9, 11)));
    const raptor = w.dinos.find((d) => d.home === pen.id)!;
    setLoose(raptor, 20.5 * T, 20.5 * T);
    raptor.pause = 999;
    spawnUnit(w, 'tranq', { x: 23.5 * T, y: 20.5 * T });
    const events = run(w, 10, () => raptor.state === 'secured');
    expect(events.filter((e) => e.type === 'dart')).toHaveLength(DINOS.raptor.sedation / UNITS.tranq.dartSedation);
  });

  it('an attack order chases the target into range', () => {
    let pen!: ReturnType<typeof place>;
    const w = blackoutWorld((w) => (pen = place(w, 'raptor', 9, 11)));
    const raptor = w.dinos.find((d) => d.home === pen.id)!;
    setLoose(raptor, 30.5 * T, 20.5 * T);
    raptor.pause = 999;
    const u = spawnUnit(w, 'tranq', { x: 16.5 * T, y: 20.5 * T });
    orderAttack(w, [u.id], raptor.id);
    run(w, 30, () => raptor.state === 'secured');
    expect(raptor.state).toBe('secured');
    run(w, STEP);
    expect(u.order).toBe('idle');
  });

  it('the T. rex bites troops for 50 and goes after whoever darted it', () => {
    let paddock!: ReturnType<typeof place>;
    const w = blackoutWorld((w) => (paddock = place(w, 'trex', 20, 16)));
    const rex = w.dinos.find((d) => d.home === paddock.id)!;
    setLoose(rex, 30.5 * T, 21.5 * T);
    const shooter = spawnUnit(w, 'tranq', { x: 34.5 * T, y: 21.5 * T });
    run(w, 1.2);
    expect(rex.target).toEqual({ type: 'unit', id: shooter.id });
    run(w, 10, () => shooter.hp < UNITS.tranq.hp);
    expect(shooter.hp).toBe(UNITS.tranq.hp - DINOS.trex.troopDamage);
  });

  it('the T. rex locks onto one troop and stays on it while others shoot', () => {
    let paddock!: ReturnType<typeof place>;
    const w = blackoutWorld((w) => (paddock = place(w, 'trex', 20, 16)));
    const rex = w.dinos.find((d) => d.home === paddock.id)!;
    setLoose(rex, 30.5 * T, 21.5 * T);
    rex.chargeCooldown = 999;
    const first = spawnUnit(w, 'tranq', { x: 34.5 * T, y: 21.5 * T });
    first.hp = first.maxHp = 100000;
    run(w, 1.2);
    expect(rex.lockId).toBe(first.id);
    const second = spawnUnit(w, 'heavy', { x: 30.5 * T, y: 17.5 * T });
    const events = run(w, 4);
    expect(events.some((e) => e.type === 'dart' && e.x0 === second.x && e.y0 === second.y)).toBe(true);
    expect(rex.lockId).toBe(first.id);
    expect(rex.target).toEqual({ type: 'unit', id: first.id });
    expect(second.hp).toBe(UNITS.heavy.hp);
  });

  it('the T. rex lets go once its troop is more than 12 tiles away', () => {
    let paddock!: ReturnType<typeof place>;
    const w = blackoutWorld((w) => (paddock = place(w, 'trex', 20, 16)));
    const rex = w.dinos.find((d) => d.home === paddock.id)!;
    setLoose(rex, 30.5 * T, 21.5 * T);
    rex.chargeCooldown = 999;
    const u = spawnUnit(w, 'tranq', { x: 34.5 * T, y: 21.5 * T });
    run(w, 0.6);
    expect(rex.lockId).toBe(u.id);
    // The troop gets clear, and a visitor is close by (but not close enough to notice).
    u.x = 8.5 * T;
    u.y = 21.5 * T;
    const v = bystander(w, rex.x, rex.y - 7 * T);
    run(w, DINO_AI.thinkSeconds + STEP);
    expect(rex.lockId).toBe(0);
    expect(rex.target).toEqual({ type: 'visitor', id: v.id });
  });

  it('the T. rex winds up, charges at double speed, and bites what it hits', () => {
    let paddock!: ReturnType<typeof place>;
    const w = blackoutWorld((w) => (paddock = place(w, 'trex', 20, 16)));
    const rex = w.dinos.find((d) => d.home === paddock.id)!;
    setLoose(rex, 24.5 * T, 21.5 * T);
    const u = spawnUnit(w, 'heavy', { x: 28.5 * T, y: 21.5 * T });
    u.hp = u.maxHp = 100000;
    const events = run(w, 0.5, () => rex.windup > 0);
    expect(rex.lockId).toBe(u.id);
    expect(events.some((e) => e.type === 'charge')).toBe(true);
    const x0 = rex.x;
    run(w, DINO_AI.trexChargeWindupSeconds - 0.05);
    expect(rex.x).toBe(x0);
    run(w, 0.2, () => rex.charge > 0);
    expect(rex.charge).toBeGreaterThan(0);
    run(w, STEP);
    const xa = rex.x;
    run(w, 0.2);
    expect((rex.x - xa) / 0.2).toBeCloseTo(DINOS.trex.speed * DINO_AI.trexChargeSpeedMultiplier, 0);
    run(w, 2, () => u.hp < u.maxHp);
    expect(u.hp).toBe(u.maxHp - DINOS.trex.troopDamage);
    expect(rex.charge).toBe(0);
    expect(rex.chargeCooldown).toBeGreaterThan(0);
  });

  it('a charging T. rex tramples visitors in its way', () => {
    let paddock!: ReturnType<typeof place>;
    const w = blackoutWorld((w) => (paddock = place(w, 'trex', 20, 16)));
    const rex = w.dinos.find((d) => d.home === paddock.id)!;
    // On the path stub by the gate, charging inward at a visitor who runs for the gate.
    setLoose(rex, (MAP.gate.x + 1.5) * T, (MAP.gate.y + 0.5) * T);
    rex.charge = 1;
    rex.cdx = 1;
    rex.cdy = 0;
    bystander(w, (MAP.gate.x + 3.5) * T, (MAP.gate.y + 0.5) * T);
    run(w, 1);
    expect(w.casualties.trex).toBe(1);
  });

  it('nothing behind its own fence can be darted', () => {
    let pen!: ReturnType<typeof place>;
    const w = blackoutWorld((w) => (pen = place(w, 'raptor', 9, 11)));
    const fp = pen.footprint;
    spawnUnit(w, 'heavy', { x: (fp.x + fp.w + 1.5) * T, y: (fp.y + 1.5) * T });
    const events = run(w, DINOS.raptor.breakoutDelaySeconds! - 1);
    expect(events.some((e) => e.type === 'dart')).toBe(false);
    expect(w.dinos.every((d) => d.sedation === DINOS[d.kind].sedation)).toBe(true);
  });

  it('a loose raptor runs down a visitor and kills after half a second of contact', () => {
    let pen!: ReturnType<typeof place>;
    const w = blackoutWorld((w) => (pen = place(w, 'raptor', 9, 11)));
    const raptor = w.dinos.find((d) => d.home === pen.id)!;
    // The visitor stands at the viewing spot; the raptor waits two tiles further out from the pen.
    const spot = pen.viewingSpot;
    const fp = pen.footprint;
    const dx = spot.x < fp.x ? -1 : spot.x >= fp.x + fp.w ? 1 : 0;
    const dy = spot.y < fp.y ? -1 : spot.y >= fp.y + fp.h ? 1 : 0;
    const v = bystander(w, (spot.x + 0.5) * T, (spot.y + 0.5) * T);
    setLoose(raptor, (spot.x + 2 * dx + 0.5) * T, (spot.y + 2 * dy + 0.5) * T);
    let contactSeen = 0;
    const events = run(w, 5, () => {
      contactSeen = Math.max(contactSeen, v.contact);
      return w.casualtyTotal > 0;
    });
    expect(w.casualties.raptor).toBe(1);
    expect(contactSeen).toBeGreaterThan(DINO_AI.visitorContactSeconds - 0.05);
    expect(events.some((e) => e.type === 'casualty')).toBe(true);
  });

  it('reaching the casualty limit shuts the park down', () => {
    const w = blackoutWorld((w) => place(w, 'pasture', 6, 9));
    w.casualties.raptor = SCORING.casualtyLimit;
    run(w, 0.1);
    expect(w.phase).toBe('ended');
    expect(w.result?.reason).toBe('shutdown');
    expect(w.result?.stars).toBe(0);
  });
});

describe('towers', () => {
  it('build on one grass tile before the blackout, block it, and take no orders', () => {
    const w = new World({ seed: 30, startingMoney: RICH });
    w.start();
    expect(planTower(w.grid, MAP.gate.x + 1, MAP.gate.y, w.money).valid).toBe(false);
    expect(planTower(w.grid, MAP.hq.x, MAP.hq.y, w.money).valid).toBe(false);
    expect(planTower(w.grid, 10, 4, UNITS.tower.cost - 1).reason).toBe('Not enough money');

    const standing = spawnUnit(w, 'tranq', { x: 12.5 * T, y: 6.5 * T });
    const tower = w.buildTower(planTower(w.grid, 12, 6, w.money));
    expect(w.grid.get(12, 6)).toBe(Tile.Tower);
    expect(w.unitWalk(12, 6)).toBe(false);
    expect(w.dinoWalk(12, 6)).toBe(false);
    expect(Math.floor(standing.x / T) !== 12 || Math.floor(standing.y / T) !== 6).toBe(true);
    expect(w.spending.towers).toBe(UNITS.tower.cost);
    expect(w.towersBuilt).toBe(1);
    expect(w.troopsTrained).toBe(1);

    orderMove(w, [tower.id], 20 * T, 20 * T);
    orderAttack(w, [tower.id], 1);
    run(w, 2);
    expect(tower.order).toBe('idle');
    expect(tower.x).toBe(12.5 * T);
    expect(tower.y).toBe(6.5 * T);

    w.startBlackout();
    expect(() => w.buildTower(planTower(w.grid, 10, 4, w.money))).toThrow();
  });

  it('dart loose dinosaurs in range, but not penned ones', () => {
    let pen!: ReturnType<typeof place>;
    const w = blackoutWorld((w) => {
      pen = place(w, 'raptor', 9, 11);
      const fp = pen.footprint;
      w.buildTower(planTower(w.grid, fp.x + fp.w + 1, fp.y + 1, w.money));
    });
    const quiet = run(w, DINOS.raptor.breakoutDelaySeconds! - 1);
    expect(quiet.some((e) => e.type === 'dart')).toBe(false);
    const fight = run(w, 40, () => w.dinosSecured > 0);
    expect(fight.some((e) => e.type === 'dart')).toBe(true);
    expect(w.dinosSecured).toBeGreaterThan(0);
  });

  it('the T. rex locks onto a tower that darts it and knocks it down; the tile turns back to grass', () => {
    let paddock!: ReturnType<typeof place>;
    const w = blackoutWorld((w) => {
      paddock = place(w, 'trex', 20, 16);
      w.buildTower(planTower(w.grid, 30, 21, w.money));
    });
    const tower = w.units.find((u) => u.kind === 'tower')!;
    const rex = w.dinos.find((d) => d.home === paddock.id)!;
    setLoose(rex, 26.5 * T, 21.5 * T);
    run(w, 1.6);
    expect(rex.lockId).toBe(tower.id);
    const events = run(w, 40, () => tower.dead);
    expect(tower.dead).toBe(true);
    expect(events.some((e) => e.type === 'unitLost' && e.kind === 'tower')).toBe(true);
    expect(w.towersLost).toBe(1);
    expect(w.troopsLost).toBe(0);
    expect(w.grid.get(30, 21)).toBe(Tile.Grass);
    expect(rex.sedation).toBeLessThan(DINOS.trex.sedation);
  });

  it('a tower outside a fence still counts as a way out, so towers cannot wall a pen in', () => {
    const w = new World({ seed: 33, startingMoney: RICH });
    const pen = place(w, 'raptor', 9, 11);
    const s = pen.segments.find((s) => !s.corner && w.grid.get(s.x + s.nx, s.y + s.ny) === Tile.Grass)!;
    w.buildTower(planTower(w.grid, s.x + s.nx, s.y + s.ny, w.money));
    s.hp = 0;
    expect(hasExit(w, pen)).toBe(true);
  });
});

describe('power return and scoring', () => {
  it('contains animals still in their pens and seals every gap', () => {
    let pasture!: ReturnType<typeof place>;
    let pen!: ReturnType<typeof place>;
    const w = blackoutWorld((w) => {
      pasture = place(w, 'pasture', 6, 4);
      pen = place(w, 'raptor', 30, 9);
    });
    const gap = pen.segments.findIndex((s) => !s.corner && s.ny === 1);
    pen.segments[gap].hp = 0;
    run(w, 25);
    const raptors = w.dinos.filter((d) => d.kind === 'raptor');
    expect(raptors.every((d) => d.state === 'loose')).toBe(true);
    // Park them out on the grass so the result doesn't depend on where they wandered.
    raptors.forEach((d, i) => setLoose(d, (20.5 + i) * T, 21.5 * T));
    raptors.forEach((d) => (d.pause = 999));
    w.phaseTime = BLACKOUT.powerRestoreSeconds - STEP;
    run(w, STEP * 2);
    expect(w.phase).toBe('restored');
    expect(pen.segments.every((s) => s.hp === s.maxHp)).toBe(true);
    expect(w.dinos.filter((d) => d.home === pasture.id).every((d) => d.state === 'contained')).toBe(true);
    expect(w.dinosContained).toBe(2);
    expect(w.looseCount).toBe(3);
  });

  it('runs fast while everything is safe, then wins when power returns', () => {
    const w = blackoutWorld((w) => place(w, 'pasture', 6, 4));
    expect(w.allClear).toBe(true);
    expect(w.timeScale).toBe(BLACKOUT.allClearSpeed);
    run(w, BLACKOUT.powerRestoreSeconds + 1);
    expect(w.phase).toBe('ended');
    expect(w.result?.won).toBe(true);
    expect(w.result?.reason).toBe('secured');
    expect(w.result?.dinosContained).toBe(2);
  });

  it('loses when dinosaurs are still loose 3:00 after power returns', () => {
    let pen!: ReturnType<typeof place>;
    const w = blackoutWorld((w) => (pen = place(w, 'raptor', 30, 9)));
    pen.segments[pen.segments.findIndex((s) => !s.corner && s.ny === 1)].hp = 0;
    run(w, 25);
    w.dinos.forEach((d, i) => setLoose(d, (20.5 + i) * T, 21.5 * T));
    run(w, BLACKOUT.powerRestoreSeconds + BLACKOUT.overrunSeconds + 2, () => w.phase === 'ended');
    expect(w.result?.reason).toBe('overrun');
    expect(w.result?.won).toBe(false);
  });

  it('awards stars for winning, revenue, and zero casualties', () => {
    expect(starsFor(false, 99999, 40000, 0)).toBe(0);
    expect(starsFor(true, 39999, 40000, 0)).toBe(1);
    expect(starsFor(true, 40000, 40000, 1)).toBe(2);
    expect(starsFor(true, 40000, 40000, 0)).toBe(3);
  });
});

describe('full game', () => {
  it('a scripted game runs to the end with every position on the map', () => {
    const w = new World({ seed: 21, buildPhaseSeconds: 600 });
    place(w, 'raptor', 9, 11);
    place(w, 'pasture', 6, 4);
    w.start();
    const checkFinite = () => {
      for (const p of [...w.units, ...w.dinos, ...w.visitors]) {
        expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
        expect(p.x).toBeGreaterThanOrEqual(-T);
        expect(p.y).toBeGreaterThanOrEqual(-T);
        expect(p.x).toBeLessThanOrEqual((MAP.cols + 1) * T);
        expect(p.y).toBeLessThanOrEqual((MAP.rows + 1) * T);
      }
      // Nobody stands on rocks, water, or HQ, and troops stay on open ground.
      for (const p of [...w.units, ...w.dinos]) {
        const tile = w.grid.get(Math.floor(p.x / T), Math.floor(p.y / T));
        expect([Tile.Rock, Tile.Water, Tile.HQ]).not.toContain(tile);
      }
      for (const u of w.units) expect(w.unitWalk(Math.floor(u.x / T), Math.floor(u.y / T))).toBe(true);
    };
    let built = false;
    let posted = false;
    for (let i = 0; i < 40 * 60 / STEP && w.phase !== 'ended'; i++) {
      w.update(STEP * w.timeScale);
      w.events = [];
      if (!built && w.money >= EXHIBITS.trex.cost + 600 && w.canBuild) {
        const plan = planPlacement(w.grid, 'trex', 20, 16, w.money, w.countOf('trex'));
        if (plan.valid) {
          w.build(plan);
          built = true;
        }
      }
      if (w.phase === 'build' && w.phaseTime > 420 && w.queue.length < 2) {
        enqueueUnit(w, w.units.length % 3 === 2 ? 'heavy' : 'tranq');
      }
      if (!posted && w.phase === 'blackout') {
        posted = true;
        orderMove(
          w,
          w.units.map((u) => u.id),
          14.5 * T,
          13.5 * T,
        );
      }
      if (i % 60 === 0) checkFinite();
    }
    checkFinite();
    expect(w.phase).toBe('ended');
    expect(w.result).not.toBeNull();
    expect(w.grid.get(MAP.gate.x, MAP.gate.y)).toBe(Tile.Gate);
  });
});

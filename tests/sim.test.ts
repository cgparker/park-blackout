import { describe, expect, it } from 'vitest';
import { BLACKOUT, DINOS, ECONOMY, EXHIBITS, FENCE, MAP, SCORING, SQUAD, UNITS, VISITORS, type ExhibitKind } from '../src/config';
import type { Dino } from '../src/core/dinos';
import { Tile } from '../src/core/grid';
import { planPlacement } from '../src/core/placement';
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

  it('warns at 1:00, then cuts the power and everyone flees', () => {
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
    expect(w.visitors.every((v) => v.mode === 'fleeing')).toBe(true);

    const revenue = w.revenue;
    run(w, 60);
    expect(w.revenue).toBe(revenue);
    expect(w.visitors).toHaveLength(0);
    expect(w.visitorsSafe).toBeGreaterThan(0);
  });

  it('scales the revenue target with the build phase', () => {
    expect(new World({ buildPhaseSeconds: 600 }).revenueTarget).toBe(40000);
    expect(new World({ buildPhaseSeconds: 180 }).revenueTarget).toBe(12000);
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

  it('a loose raptor kills a visitor after half a second of contact', () => {
    let pen!: ReturnType<typeof place>;
    const w = blackoutWorld((w) => (pen = place(w, 'raptor', 9, 11)));
    const raptor = w.dinos.find((d) => d.home === pen.id)!;
    setLoose(raptor, 20.5 * T, 20.5 * T);
    bystander(w, 22.5 * T, 20.5 * T);
    const events = run(w, 5, () => w.casualtyTotal > 0);
    expect(w.casualties.raptor).toBe(1);
    expect(events.some((e) => e.type === 'casualty')).toBe(true);
  });

  it('ten casualties shut the park down', () => {
    const w = blackoutWorld((w) => place(w, 'pasture', 6, 9));
    w.casualties.raptor = SCORING.casualtyLimit;
    run(w, 0.1);
    expect(w.phase).toBe('ended');
    expect(w.result?.reason).toBe('shutdown');
    expect(w.result?.stars).toBe(0);
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
      if (i % 600 === 0) checkFinite();
    }
    checkFinite();
    expect(w.phase).toBe('ended');
    expect(w.result).not.toBeNull();
    expect(w.grid.get(MAP.gate.x, MAP.gate.y)).toBe(Tile.Gate);
  });
});

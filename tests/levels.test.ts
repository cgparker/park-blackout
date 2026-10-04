import { describe, expect, it } from 'vitest';
import { DINO_AI, DINOS, EXHIBITS, HUNTS, MAP, NEST, UNITS, type HuntLevelId } from '../src/config';
import { sedate } from '../src/core/combat';
import { fenceRect, inFootprint } from '../src/core/exhibit';
import { huntGoalsMet } from '../src/core/report';
import { enqueueUnit, isTargetable, orderMove, spawnUnit } from '../src/core/units';
import { World, type GameEvent } from '../src/core/world';

const STEP = 1 / 60;
const T = MAP.tileSize;

function run(w: World, seconds: number, until?: () => boolean): GameEvent[] {
  const seen: GameEvent[] = [];
  for (let i = 0; i < Math.round(seconds / STEP); i++) {
    w.update(STEP);
    seen.push(...w.events);
    w.events = [];
    if (until?.()) break;
  }
  return seen;
}

const loose = (w: World) => w.dinos.filter((d) => d.state === 'loose');

describe('levels 1 and 2: the park they start with', () => {
  for (const level of [1, 2] as HuntLevelId[]) {
    const cfg = HUNTS[level];

    it(`level ${level} builds its park for free, with the open fences down and their animals out`, () => {
      const w = new World({ seed: 1, level });
      expect(w.exhibits.map((e) => e.kind)).toEqual(cfg.park.map((p) => p.kind));
      expect(w.money).toBe(cfg.startingMoney);
      expect(Object.values(w.spending).every((n) => n === 0)).toBe(true);
      // Nothing was "built", so no build tips go off.
      expect(w.events).toEqual([]);
      cfg.park.forEach((p, i) => {
        const ex = w.exhibits[i];
        const animals = w.dinos.filter((d) => d.home === ex.id);
        expect(animals).toHaveLength(EXHIBITS[p.kind].animalCount);
        const down = ex.segments.filter((s) => s.hp <= 0);
        if (!p.open) {
          expect(down).toHaveLength(0);
          expect(animals.every((d) => d.state === 'penned')).toBe(true);
          return;
        }
        // One whole side, corners left standing.
        expect(down).toHaveLength(ex.footprint.w - 2);
        expect(down.every((s) => !s.corner)).toBe(true);
        for (const d of animals) {
          expect(d.state).toBe('loose');
          expect(w.dinoWalk(Math.floor(d.x / T), Math.floor(d.y / T))).toBe(true);
          expect(inFootprint(ex.footprint, Math.floor(d.x / T), Math.floor(d.y / T))).toBe(false);
        }
      });
    });

    it(`level ${level} runs on a clock until the park opens, and HQ trains only ${cfg.units.join(' and ')}`, () => {
      const w = new World({ seed: 1, level });
      expect(w.canBuild).toBe(false);
      expect(w.clockSeconds).toBe(cfg.timeLimitSeconds);
      w.start();
      expect(w.phase).toBe('hunt');
      expect(w.canBuild).toBe(false);
      expect(w.log).toEqual([{ t: 0, type: 'start', loose: { [loose(w)[0].kind]: loose(w).length }, nest: !!cfg.nest }]);
      run(w, 10);
      expect(w.clockSeconds).toBeCloseTo(cfg.timeLimitSeconds - 10, 3);
      for (const kind of ['tranq', 'heavy'] as const) expect(enqueueUnit(w, kind)).toBe(cfg.units.includes(kind));
      expect(loose(w).every((d) => isTargetable(w, d))).toBe(true);
    });
  }

  it('level 2 raptors start around their nest; the default world is still the blackout level', () => {
    const w = new World({ seed: 1, level: 2 });
    const raptors = w.dinos.filter((d) => d.kind === 'raptor');
    expect(raptors).toHaveLength(6);
    for (const d of raptors) {
      expect(d.nest).toEqual(w.nest);
      expect(Math.hypot(d.x - w.nest!.x, d.y - w.nest!.y)).toBeLessThanOrEqual((NEST.roamTiles + 1) * T);
    }
    const blackout = new World({ seed: 1 });
    expect(blackout.level).toBe(3);
    expect(blackout.hunt).toBeNull();
    expect(blackout.exhibits).toHaveLength(0);
    blackout.start();
    expect(blackout.phase).toBe('build');
  });
});

describe('levels 1 and 2: getting animals back', () => {
  it('a darted Triceratops is carried back to its pasture and wakes up there', () => {
    const w = new World({ seed: 2, level: 1 });
    w.start();
    const d = loose(w)[0];
    const home = w.exhibitById(d.home)!;
    sedate(w, d, DINOS.triceratops.sedation, 0);
    expect(d.state).toBe('secured');
    expect(w.log.at(-1)).toEqual({ t: 0, type: 'back', kind: 'triceratops', how: 'darted', left: 5 });
    run(w, DINO_AI.secureFadeSeconds + 0.1);
    expect(d.state).toBe('penned');
    expect(d.removed).toBe(false);
    expect(d.sedation).toBe(DINOS.triceratops.sedation);
    const r = fenceRect(home.footprint, T);
    expect(d.x > r.left && d.x < r.right && d.y > r.top && d.y < r.bottom).toBe(true);
    // Back behind a powered fence, it stays put and can't be darted.
    run(w, 5);
    expect(d.state).toBe('penned');
    expect(isTargetable(w, d)).toBe(false);
    expect(w.returned).toBe(1);
  });

  it('a loose animal that walks back into its own pen counts as back', () => {
    const w = new World({ seed: 2, level: 1 });
    w.start();
    const d = loose(w)[0];
    const home = w.exhibitById(d.home)!;
    const r = fenceRect(home.footprint, T);
    d.x = (r.left + r.right) / 2;
    d.y = (r.top + r.bottom) / 2;
    run(w, STEP);
    expect(d.state).toBe('penned');
    expect(w.log.at(-1)).toMatchObject({ type: 'back', kind: 'triceratops', how: 'walked', left: 5 });
  });

  it('a stampede into the edge of the park turns and runs along it', () => {
    const w = new World({ seed: 2, level: 1 });
    w.start();
    const d = loose(w)[0];
    d.x = 10.5 * T;
    d.y = 0.3 * T;
    spawnUnit(w, 'tranq', { x: 10.5 * T, y: 2.5 * T });
    run(w, 1);
    expect(d.stampede).toBeGreaterThan(0);
    expect(Math.abs(d.x - 10.5 * T)).toBeGreaterThan(2 * T);
    expect(d.y).toBeGreaterThanOrEqual(0);
    expect(d.y).toBeLessThan(T);
  });

  it('a stampede along a powered fence goes around it, and the fence takes no damage', () => {
    const w = new World({ seed: 2, level: 1 });
    w.start();
    const whole = w.exhibits.find((e) => e.segments.every((s) => s.hp > 0))!;
    const r = fenceRect(whole.footprint, T);
    const d = loose(w)[0];
    d.x = r.left - 0.3 * T;
    d.y = (r.top + r.bottom) / 2;
    spawnUnit(w, 'tranq', { x: r.left - 2.5 * T, y: d.y });
    const hp = whole.segments.map((s) => s.hp);
    run(w, 1);
    expect(d.stampede).toBeGreaterThan(0);
    expect(d.x).toBeLessThan(r.left);
    expect(Math.abs(d.y - (r.top + r.bottom) / 2)).toBeGreaterThan(T);
    expect(whole.segments.map((s) => s.hp)).toEqual(hp);
  });

  it('a cornered Triceratops stops', () => {
    const w = new World({ seed: 2, level: 1 });
    w.start();
    const d = loose(w)[0];
    d.x = 0.2 * T;
    d.y = 0.2 * T;
    spawnUnit(w, 'tranq', { x: 2.2 * T, y: 2.2 * T });
    const events = run(w, 1);
    expect(events).toContainEqual(expect.objectContaining({ type: 'stampede', dinoId: d.id }));
    expect(d.x).toBeLessThan(0.6 * T);
    expect(d.y).toBeLessThan(0.6 * T);
  });

  it('a troop close enough to dart a Triceratops scares it into running, and says so', () => {
    const w = new World({ seed: 2, level: 1 });
    w.start();
    const d = loose(w)[0];
    spawnUnit(w, 'tranq', { x: d.x - 3 * T, y: d.y });
    const events = run(w, 0.5);
    expect(events).toContainEqual(expect.objectContaining({ type: 'stampede', dinoId: d.id, byTroop: true }));
  });
});

describe('levels 1 and 2: winning and losing', () => {
  it('getting every animal back wins, and the stars count spending and time left', () => {
    const w = new World({ seed: 3, level: 1 });
    w.start();
    expect(enqueueUnit(w, 'tranq')).toBe(true);
    expect(enqueueUnit(w, 'tranq')).toBe(true);
    run(w, 20);
    for (const d of loose(w)) sedate(w, d, 1000, 0);
    run(w, STEP);
    expect(w.phase).toBe('ended');
    const r = w.result!;
    expect(r).toMatchObject({ won: true, reason: 'secured', level: 1, stars: 3, title: 'Every Triceratops is back' });
    expect(r.hunt).toMatchObject({ kind: 'triceratops', loose: 6, returned: 6 });
    expect(r.hunt!.timeLeft).toBeCloseTo(HUNTS[1].timeLimitSeconds - 20, 0);
    expect(r.log.at(-1)).toMatchObject({ type: 'end', reason: 'secured', loose: {} });
  });

  it('the park opening with animals loose loses the level', () => {
    const w = new World({ seed: 3, level: 1 });
    w.start();
    run(w, HUNTS[1].timeLimitSeconds + 1);
    expect(w.result).toMatchObject({ won: false, reason: 'timeUp', stars: 0, title: 'The park opened with Triceratops loose' });
    expect(w.result!.log.at(-1)).toMatchObject({ type: 'end', reason: 'timeUp', loose: { triceratops: 6 } });
    expect(w.result!.log.at(-1)!.t).toBeCloseTo(HUNTS[1].timeLimitSeconds, 1);
  });

  it('no troops, none coming, and too little money for one ends the level early', () => {
    const w = new World({ seed: 3, level: 2 });
    w.start();
    const u = spawnUnit(w, 'tranq', { x: 6.5 * T, y: 13.5 * T });
    w.money = UNITS.tranq.cost - 1;
    run(w, 1);
    expect(w.phase).toBe('hunt');
    u.dead = true;
    run(w, STEP);
    expect(w.result).toMatchObject({ won: false, reason: 'noTroops', title: 'Out of troops' });
  });

  it('second star: spend no more than the cap; third: time left in level 1, no troops lost in level 2', () => {
    const one = HUNTS[1];
    const third = one.thirdStar.type === 'timeLeft' ? one.thirdStar.seconds : 0;
    expect(huntGoalsMet(one, one.spendStar, third, 3)).toEqual({ spend: true, third: true });
    expect(huntGoalsMet(one, one.spendStar + 1, third - 1, 0)).toEqual({ spend: false, third: false });
    const two = HUNTS[2];
    expect(huntGoalsMet(two, 0, 0, 0)).toEqual({ spend: true, third: true });
    expect(huntGoalsMet(two, 0, 999, 1)).toEqual({ spend: true, third: false });
  });
});

describe('level 2: raptors guarding a nest', () => {
  const setup = () => {
    const w = new World({ seed: 4, level: 2 });
    w.start();
    return { w, nest: w.nest!, raptors: w.dinos.filter((d) => d.kind === 'raptor') };
  };

  it('leave troops at HQ alone', () => {
    const { w, raptors } = setup();
    spawnUnit(w, 'tranq', { x: 6.5 * T, y: 14.5 * T });
    run(w, 30);
    expect(w.troopsLost).toBe(0);
    expect(raptors.every((d) => d.target === null)).toBe(true);
  });

  it('go after a troop close to the nest, then give up once it leaves the leash, and run home', () => {
    const { w, nest, raptors } = setup();
    const u = spawnUnit(w, 'heavy', { x: nest.x - 6 * T, y: nest.y });
    u.hp = 1e9;
    run(w, 2);
    expect(raptors.filter((d) => d.target?.type === 'unit').length).toBeGreaterThan(0);
    // Out past the leash: the chase stops and they head back.
    u.x = nest.x - (NEST.leashTiles + 2) * T;
    orderMove(w, [u.id], u.x - 4 * T, u.y);
    run(w, 1);
    expect(raptors.every((d) => d.state !== 'loose' || d.target === null)).toBe(true);
    run(w, 15);
    for (const d of raptors.filter((d) => d.state === 'loose')) {
      expect(Math.hypot(d.x - nest.x, d.y - nest.y)).toBeLessThanOrEqual((NEST.roamTiles + 1) * T);
    }
  });
});

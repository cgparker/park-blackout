import { describe, expect, it } from 'vitest';
import { DINOS, FENCE, FIGHT, GRID, JEEP, MAP, MISSIONS, STEALTH, UNITS } from '../src/config';
import { sedate } from '../src/core/combat';
import { damageSegment, hurtAnimal } from '../src/core/dinos';
import { Tile } from '../src/core/grid';
import { passengers } from '../src/core/jeep';
import { inReach, workTiles } from '../src/core/power';
import { blocksSight, inView, notices } from '../src/core/stealth';
import { canDart, enqueueUnit, orderAttack, orderBoard, orderHold, orderMove, orderRepair, spawnUnit } from '../src/core/units';
import { World, type GameEvent } from '../src/core/world';
import { playGrid } from './stealth-player';

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
/** An Engineer standing on the first work tile of a substation. */
function engineerAt(w: World, subIndex: number, tile = 0) {
  const s = w.substations[subIndex];
  const t = workTiles(s, w.unitWalk)[tile];
  return spawnUnit(w, 'engineer', { x: (t.x + 0.5) * T, y: (t.y + 0.5) * T });
}

describe('level 4: the park after the blackout', () => {
  const raptors = (w: World) => w.dinos.filter((d) => d.kind === 'raptor' && d.state === 'loose');
  const team = (w: World) => ({ e: w.units.find((u) => u.kind === 'engineer')!, sq: w.units.find((u) => u.kind === 'tranq')! });
  /** A tile centre, in world pixels. */
  const at = (x: number, y: number) => ({ x: (x + 0.5) * T, y: (y + 0.5) * T });
  /** Puts the team somewhere quiet, away from the routes. */
  function parkTeam(w: World) {
    for (const u of w.units) Object.assign(u, at(3, 19));
  }
  /** A spot on open ground a few tiles ahead of a raptor, in its cone and in clear sight. */
  function inFront(w: World, d: { x: number; y: number; facing: number }) {
    for (const r of [3, 2.5, 3.5, 2, 4]) {
      for (const da of [0, 0.2, -0.2, 0.4, -0.4]) {
        const p = { x: d.x + Math.cos(d.facing + da) * r * T, y: d.y + Math.sin(d.facing + da) * r * T };
        if (w.unitWalk(Math.floor(p.x / T), Math.floor(p.y / T)) && inView(w, d, p.x, p.y)) return p;
      }
    }
    throw new Error('no open ground in front of the raptor');
  }

  it('starts dark, with one Engineer, one Tranq Squad, three broken substations, and two raptors on patrol', () => {
    const w = new World({ seed: 1, level: 4 });
    const cfg = MISSIONS[4];
    expect(w.exhibits.map((e) => e.kind)).toEqual(cfg.park.map((p) => p.kind));
    expect(w.substations.map((s) => s.name)).toEqual(['West', 'North', 'South']);
    expect(w.powerOn).toBe(false);
    // Every pen a substation powers is dark; the south pasture has its own power.
    const powered = new Set(w.substations.flatMap((s) => s.pens));
    for (const ex of w.exhibits) expect(ex.powered).toBe(!powered.has(ex.id));
    for (const s of w.substations) {
      for (let y = s.y; y < s.y + GRID.sizeTiles; y++) for (let x = s.x; x < s.x + GRID.sizeTiles; x++) expect(w.grid.get(x, y)).toBe(Tile.Substation);
      expect(w.dinoWalk(s.x, s.y)).toBe(false);
      expect(w.unitWalk(s.x, s.y)).toBe(false);
    }
    expect(w.startedLoose).toEqual({ raptor: 2 });
    expect(w.trainable).toEqual([]);
    expect(w.money).toBe(0);
    expect(w.units.map((u) => u.kind).sort()).toEqual(['engineer', 'tranq']);
    expect(w.teamSize).toBe(2);
    for (const d of raptors(w)) expect(d.patrol?.length).toBeGreaterThan(1);
    // The T. rex paddock's south side is dented.
    const paddock = w.exhibits.find((e) => e.kind === 'trex')!;
    expect(paddock.segments.filter((s) => !s.corner && s.ny === 1).every((s) => s.hp === 80)).toBe(true);
    w.start();
    expect(w.phase).toBe('mission');
    expect(w.log[0]).toEqual({ t: 0, type: 'start', loose: { raptor: 2 }, nest: false, substations: 3, fight: false, stealth: true });
  });

  it('the west raptors go for their fence at their set time, not before', () => {
    const w = new World({ seed: 2, level: 4 });
    w.start();
    parkTeam(w);
    const pen = w.exhibits[0];
    const t = pen.breakoutAt!;
    run(w, t - 1);
    expect(pen.segments.every((s) => s.hp === s.maxHp)).toBe(true);
    const events = run(w, 8);
    expect(events.some((e) => e.type === 'fenceHit' && e.exhibitId === pen.id)).toBe(true);
  });

  it('a raptor walks its route, and at each stop it looks around', () => {
    const w = new World({ seed: 3, level: 4 });
    w.start();
    parkTeam(w);
    const d = raptors(w)[0];
    const route = d.patrol!;
    const first = d.patrolIndex;
    run(w, 30, () => d.look > 0);
    expect(Math.hypot(d.x - route[first].x, d.y - route[first].y)).toBeLessThan(3);
    // It sweeps its gaze either side of the way it came, then walks on to the next stop.
    const facings: number[] = [];
    run(w, STEALTH.lookSeconds + 0.5, () => {
      facings.push(d.facing);
      return d.look <= 0;
    });
    expect(Math.max(...facings) - Math.min(...facings)).toBeGreaterThan(((STEALTH.lookDeg * 2 - 10) * Math.PI) / 180);
    expect(d.patrolIndex).toBe((first + 1) % route.length);
    run(w, 1);
    expect(d.look).toBe(0);
  });

  it('a raptor sees what is in its cone and in range, not behind it or past cover, and notices a troop that walks into it', () => {
    const w = new World({ seed: 4, level: 4 });
    // Facing east from just west of the south substation's ring.
    const eye = { ...at(23, 17), facing: 0 };
    expect(inView(w, eye, (23.5 + 3) * T, 17.5 * T)).toBe(true);
    expect(inView(w, eye, (23.5 + STEALTH.sightTiles + 0.6) * T, 17.5 * T)).toBe(false);
    expect(inView(w, eye, (23.5 - 2) * T, 17.5 * T)).toBe(false);
    expect(inView(w, eye, 23.5 * T, (17.5 + 3) * T)).toBe(false);
    // The substation block hides the tile on its far side.
    const south = w.substations[2];
    const near = { ...at(south.x - 1, south.y), facing: 0 };
    expect(inView(w, near, (south.x + 2.5) * T, (south.y + 0.5) * T)).toBe(false);
    // A pen and rock block it too; water doesn't.
    const pen = w.exhibits.find((e) => e.kind === 'pasture' && e.footprint.y > 15)!;
    const west = { ...at(pen.footprint.x - 1, pen.footprint.y + 2), facing: 0 };
    expect(inView(w, west, (pen.footprint.x + pen.footprint.w + 0.5) * T, (pen.footprint.y + 2.5) * T)).toBe(false);
    expect(blocksSight(Tile.Rock) && blocksSight(Tile.Exhibit) && blocksSight(Tile.Substation) && blocksSight(Tile.HQ)).toBe(true);
    expect(blocksSight(Tile.Water) || blocksSight(Tile.Path) || blocksSight(Tile.Grass)).toBe(false);
    // Behind it, but touching it: noticed. A tile behind it: not.
    const { e } = team(w);
    Object.assign(e, { x: eye.x - (STEALTH.hearTiles - 0.1) * T, y: eye.y });
    expect(notices(w, eye, e)).toBe(true);
    Object.assign(e, { x: eye.x - 1 * T, y: eye.y });
    expect(notices(w, eye, e)).toBe(false);
  });

  it('each raptor starts somewhere different along its route, either way round', () => {
    const starts = new Set<string>();
    const ways = new Set<string>();
    for (let seed = 1; seed <= 10; seed++) {
      const w = new World({ seed, level: 4 });
      for (const d of raptors(w)) {
        starts.add(`${Math.round(d.x / T)},${Math.round(d.y / T)}`);
        ways.add(d.patrol!.map((p) => `${p.x},${p.y}`).join(' '));
        expect(w.dinoWalk(Math.floor(d.x / T), Math.floor(d.y / T))).toBe(true);
      }
    }
    expect(starts.size).toBeGreaterThan(12);
    // Two routes, each walked both ways.
    expect(ways.size).toBe(4);
  });

  it('a troop in a raptor’s cone takes a moment to make out: it stops and stares, and a troop that gets away in time is lost', () => {
    const w = new World({ seed: 13, level: 4 });
    w.start();
    parkTeam(w);
    const [a, b] = raptors(w);
    const { e } = team(w);
    a.look = 0;
    Object.assign(e, inFront(w, a));
    const x0 = a.x;
    const y0 = a.y;
    let events = run(w, STEALTH.noticeSeconds / 2);
    expect(events).toContainEqual(expect.objectContaining({ type: 'noticed', dinoId: a.id, unitId: e.id, kind: 'engineer' }));
    expect(events.some((x) => x.type === 'spotted')).toBe(false);
    expect(a.notice).toBeGreaterThan(0);
    expect(Math.hypot(a.x - x0, a.y - y0)).toBeLessThan(1);
    expect(a.target).toBeNull();
    // Being made out at all costs the star, even if the Engineer gets away.
    expect(w.engineerSpotted).toBe(true);
    // Out of sight before it's sure: it settles, then walks on.
    Object.assign(e, at(3, 19));
    events = run(w, STEALTH.noticeSeconds + 0.5);
    expect(events.some((x) => x.type === 'spotted')).toBe(false);
    expect(a.notice).toBe(0);
    expect(a.target).toBeNull();
    expect(b.target).toBeNull();
    run(w, 3);
    expect(Math.hypot(a.x - x0, a.y - y0)).toBeGreaterThan(T / 2);
  });

  it('a raptor that sees the Engineer hunts it and calls the other; the star for never being seen is gone', () => {
    const w = new World({ seed: 5, level: 4 });
    w.start();
    parkTeam(w);
    const [a, b] = raptors(w);
    const { e } = team(w);
    a.look = 0;
    Object.assign(e, inFront(w, a));
    const events = run(w, STEALTH.noticeSeconds + 0.1);
    expect(events).toContainEqual(expect.objectContaining({ type: 'spotted', dinoId: a.id, unitId: e.id, kind: 'engineer' }));
    expect(a.target).toEqual({ type: 'unit', id: e.id });
    expect(b.target).toEqual({ type: 'unit', id: e.id });
    expect(w.engineerSpotted).toBe(true);
    expect(w.log.filter((x) => x.type === 'spotted')).toEqual([{ t: expect.any(Number), type: 'spotted', kind: 'engineer' }]);
    run(w, 10, () => e.dead);
    expect(e.dead).toBe(true);
    expect(w.result).toMatchObject({ won: false, reason: 'noEngineers', title: 'The Engineer is down' });
  });

  it('it gives up on prey it loses sight of, and goes back to its route', () => {
    const w = new World({ seed: 6, level: 4 });
    w.start();
    parkTeam(w);
    const { sq } = team(w);
    const [a] = raptors(w);
    a.look = 0;
    Object.assign(sq, inFront(w, a));
    run(w, STEALTH.noticeSeconds + 0.1);
    expect(a.target).toEqual({ type: 'unit', id: sq.id });
    // The squad is suddenly far away, behind HQ.
    Object.assign(sq, at(1, 15));
    run(w, STEALTH.giveUpSeconds + 0.5);
    for (const d of raptors(w)) expect(d.target).toBeNull();
    expect(w.units.every((u) => !u.dead)).toBe(true);
  });

  it('troops hold fire at a raptor that is not after anyone; one darted from out of its sight comes for the shooter alone', () => {
    const w = new World({ seed: 7, level: 4 });
    w.start();
    parkTeam(w);
    const { sq } = team(w);
    const [a, b] = raptors(w);
    // Behind it, in dart range, out of its sight and hearing.
    const set = () => Object.assign(sq, { x: a.x - Math.cos(a.facing) * 3 * T, y: a.y - Math.sin(a.facing) * 3 * T, cooldown: 0 });
    set();
    a.wait = 99;
    let darts = 0;
    for (let i = 0; i < 30; i++) {
      set();
      darts += run(w, STEP).filter((x) => x.type === 'dart').length;
      if (a.target) break;
    }
    expect(darts).toBe(0);
    expect(a.target).toBeNull();
    orderAttack(w, [sq.id], a.id);
    const events = run(w, 1);
    expect(events.some((x) => x.type === 'dart')).toBe(true);
    expect(a.target).toEqual({ type: 'unit', id: sq.id });
    expect(b.target).toBeNull();
    expect(events).toContainEqual(expect.objectContaining({ type: 'spotted', kind: 'tranq' }));
    expect(w.engineerSpotted).toBe(false);
  });

  it('a raptor that sees who darts it calls the other', () => {
    const w = new World({ seed: 7, level: 4 });
    w.start();
    parkTeam(w);
    const { sq } = team(w);
    const [a, b] = raptors(w);
    a.look = 0;
    // In front of it, in its cone: the shot is seen.
    Object.assign(sq, inFront(w, a));
    sedate(w, a, UNITS.tranq.dartSedation, sq.id);
    run(w, STEP);
    expect(a.target).toEqual({ type: 'unit', id: sq.id });
    expect(b.target).toEqual({ type: 'unit', id: sq.id });
  });

  it('a Tranq Squad darts one raptor down on its own, but two kill it', () => {
    const one = new World({ seed: 8, level: 4 });
    one.start();
    parkTeam(one);
    const [a, b] = raptors(one);
    sedate(one, b, 1000, 0);
    const { sq } = team(one);
    a.look = 0;
    Object.assign(sq, inFront(one, a));
    run(one, 15, () => a.state !== 'loose');
    expect(a.state).toBe('secured');
    expect(sq.dead).toBe(false);
    expect(sq.hp).toBeLessThan(UNITS.tranq.hp);

    const two = new World({ seed: 8, level: 4 });
    two.start();
    parkTeam(two);
    const [c, d] = raptors(two);
    const s2 = team(two).sq;
    c.look = 0;
    Object.assign(d, { x: c.x, y: c.y + T });
    Object.assign(s2, inFront(two, c));
    run(two, 15, () => s2.dead);
    expect(s2.dead).toBe(true);
    // Losing the squad isn't losing the level: only the Engineer can fix the substations.
    expect(two.phase).toBe('mission');
  });

  it('Engineers can’t dart and ignore attack orders; work stays done when the Engineer leaves', () => {
    const w = new World({ seed: 9, level: 4 });
    w.start();
    parkTeam(w);
    expect(canDart('engineer')).toBe(false);
    const { e } = team(w);
    orderAttack(w, [e.id], raptors(w)[0].id);
    expect(e.order).toBe('idle');
    const west = w.substations[0];
    const tile = workTiles(west, w.unitWalk)[0];
    Object.assign(e, at(tile.x, tile.y));
    run(w, GRID.repairSeconds / 2);
    expect(west.work).toBeCloseTo(GRID.repairSeconds / 2, 0);
    orderMove(w, [e.id], (west.x - 5) * T, (west.y + 0.5) * T);
    run(w, 3);
    expect(west.workers).toBe(0);
    expect(west.work).toBeCloseTo(GRID.repairSeconds / 2, 0);
    orderRepair(w, [e.id], west.id);
    run(w, 15, () => west.fixed);
    expect(west.fixed).toBe(true);
    expect(inReach(west, e.x, e.y, T)).toBe(true);
  });

  it('a repair order sends the Engineer to the side tapped, and leaves the rest of the group where it is', () => {
    const w = new World({ seed: 14, level: 4 });
    w.start();
    parkTeam(w);
    const { e, sq } = team(w);
    const north = w.substations[1];
    // A tap on the east side of the block.
    const to = orderRepair(w, [e.id, sq.id], north.id, at(north.x + 2, north.y + 1))!;
    expect(Math.floor(to.x / T)).toBe(north.x + 2);
    expect(e.order).toBe('repair');
    expect(e.dest).toEqual(to);
    expect(sq.order).toBe('idle');
    // It only shuffles off the Engineer's spot; it doesn't head for the substation.
    const sq0 = { x: sq.x, y: sq.y };
    run(w, 2);
    expect(Math.hypot(sq.x - sq0.x, sq.y - sq0.y)).toBeLessThan(T / 2);
    expect(sq.order).toBe('idle');
    // Without a tap point, the tile nearest the Engineer.
    const near = orderRepair(w, [e.id], north.id)!;
    const ring = workTiles(north, w.unitWalk).map((t) => ({ x: (t.x + 0.5) * T, y: (t.y + 0.5) * T }));
    const best = Math.min(...ring.map((p) => Math.hypot(p.x - e.x, p.y - e.y)));
    expect(Math.hypot(near.x - e.x, near.y - e.y)).toBeCloseTo(best, 5);
    // A tap on the tiles around the block counts too.
    expect(w.substationNearTile(north.x - 1, north.y)).toBe(north);
    expect(w.substationNearTile(north.x - 2, north.y)).toBeUndefined();
  });

  it('Stop drops a troop’s orders where it stands', () => {
    const w = new World({ seed: 15, level: 4 });
    w.start();
    parkTeam(w);
    const { e } = team(w);
    orderMove(w, [e.id], 20 * T, 19.5 * T);
    run(w, 1);
    orderHold(w, [e.id]);
    expect(e.order).toBe('idle');
    const p0 = { x: e.x, y: e.y };
    run(w, 2);
    expect(Math.hypot(e.x - p0.x, e.y - p0.y)).toBeLessThan(1);
  });

  it('a fixed substation powers its pens: gaps seal and animals inside are contained', () => {
    const w = new World({ seed: 10, level: 4 });
    w.start();
    parkTeam(w);
    const west = w.substations[0];
    const pen = w.exhibitById(west.pens[0])!;
    pen.segments[1].hp = 0;
    const e = engineerAt(w, 0);
    run(w, GRID.repairSeconds - 0.5);
    expect(west.fixed).toBe(false);
    expect(west.workers).toBe(1);
    const events = run(w, 1);
    expect(west.fixed).toBe(true);
    expect(events).toContainEqual(expect.objectContaining({ type: 'substationFixed', id: west.id, last: false }));
    expect(west.pens.every((id) => w.exhibitById(id)!.powered)).toBe(true);
    expect(pen.segments.every((s) => s.hp === s.maxHp)).toBe(true);
    expect(w.dinos.filter((d) => d.home === pen.id).every((d) => d.state === 'contained' || d.state === 'penned')).toBe(true);
    expect(e.order).toBe('idle');
  });

  it('fixing every substation wins, with raptors still loose; the stars are no troops lost and never seen', () => {
    const w = new World({ seed: 11, level: 4 });
    w.start();
    parkTeam(w);
    for (const s of w.substations) w.fixSubstation(s);
    expect(w.powerOn).toBe(true);
    run(w, STEP);
    expect(w.result).toMatchObject({ won: true, reason: 'secured', level: 4, stars: 3, title: 'Power back on' });
    expect(w.result!.detail).toMatch(/The raptors never saw the Engineer\./);
    expect(w.result!.mission).toMatchObject({ fixed: 3, substations: 3, spotted: false });
    expect(raptors(w).length).toBe(2);

    const seen = new World({ seed: 11, level: 4 });
    seen.start();
    parkTeam(seen);
    seen.engineerSpotted = true;
    for (const s of seen.substations) seen.fixSubstation(s);
    run(seen, STEP);
    expect(seen.result).toMatchObject({ won: true, stars: 2 });
  });

  it('dawn with the power still out loses', () => {
    const w = new World({ seed: 12, level: 4 });
    w.start();
    parkTeam(w);
    // Keep the pens shut, so only the clock can end it.
    for (const ex of w.exhibits) ex.breakoutAt = null;
    run(w, MISSIONS[4].timeLimitSeconds + 1);
    expect(w.result).toMatchObject({ won: false, reason: 'timeUp', title: 'Dawn, and the park is still dark' });
  });

  it('a careful Engineer can fix all three without being seen, and rushing straight in gets it killed', () => {
    const careful = playGrid(1, { engineer: 'sneak', every: 0.5 });
    expect(careful.world.result).toMatchObject({ won: true, stars: 3 });
    expect(careful.seenAt).toBe(-1);
    const rush = playGrid(1, { engineer: 'rush' });
    expect(rush.world.result).toMatchObject({ won: false, reason: 'noEngineers' });
  });
});

describe('level 5: the fight', () => {
  it('starts with a fixed team, no money, the fighters loose, and some pens dark', () => {
    const w = new World({ seed: 1, level: 5 });
    const cfg = MISSIONS[5];
    expect(w.units.map((u) => u.kind).sort()).toEqual(cfg.team!.map((m) => m.kind).sort());
    expect(w.teamSize).toBe(cfg.team!.filter((m) => m.kind !== 'jeep').length);
    expect(w.money).toBe(0);
    expect(w.trainable).toEqual([]);
    w.start();
    expect(enqueueUnit(w, 'tranq')).toBe(false);
    expect(w.startedLoose).toEqual({ trex: 1, raptor: 3 });
    expect(w.powerOn).toBe(true);
    expect(w.exhibits.map((e) => e.powered)).toEqual(cfg.park.map((p) => p.powered ?? true));
    expect(w.log[0]).toMatchObject({ type: 'start', fight: true, substations: 0 });
  });

  it('raptors fight the T. rex and wound it; the T. rex kills the most wounded raptor first', () => {
    const w = new World({ seed: 2, level: 5 });
    w.start();
    const rex = w.dinos.find((d) => d.kind === 'trex')!;
    const raptors = w.dinos.filter((d) => d.kind === 'raptor' && d.state === 'loose');
    run(w, 5);
    expect(rex.health).toBeLessThan(DINOS.trex.health);
    expect(raptors.every((r) => r.target?.type === 'dino' && r.target.id === rex.id)).toBe(true);
    const events = run(w, 40, () => w.animalsKilled > 0);
    const killed = events.find((e) => e.type === 'killed');
    expect(killed).toMatchObject({ type: 'killed', kind: 'raptor', by: 'trex' });
    // One bite every FIGHT.trexBiteSeconds, the first at once, until the most wounded raptor's health runs out.
    const bites = Math.ceil(DINOS.raptor.health / FIGHT.trexBite);
    expect(w.phaseTime).toBeGreaterThan((bites - 1) * FIGHT.trexBiteSeconds - 1);
    expect(w.phaseTime).toBeLessThan(bites * FIGHT.trexBiteSeconds + 5);
    expect(w.log.some((e) => e.type === 'killed')).toBe(true);
  });

  it('the fight pushes slowly toward a dark pen with animals in it and breaks in; raptors inside join', () => {
    const w = new World({ seed: 3, level: 5 });
    w.start();
    const rex = w.dinos.find((d) => d.kind === 'trex')!;
    const x0 = rex.x;
    const y0 = rex.y;
    run(w, 10);
    const moved = Math.hypot(rex.x - x0, rex.y - y0);
    expect(moved).toBeLessThan(FIGHT.pushSpeed * 10 * 1.3);
    expect(moved).toBeGreaterThan(FIGHT.pushSpeed * 10 * 0.5);
    // Keep the raptors alive and fighting, so it can be watched all the way to the raptor pen.
    const events = run(w, 90, () => w.dinos.some((d) => d.home === w.exhibits[0].id && d.state === 'loose'));
    expect(events.some((e) => e.type === 'breach')).toBe(true);
    const freed = w.dinos.filter((d) => d.home === w.exhibits[0].id && d.state === 'loose');
    expect(freed.length).toBeGreaterThan(0);
    // Powered pens are left alone.
    const powered = w.exhibits.filter((e) => e.powered);
    expect(powered.every((e) => e.segments.every((s) => s.hp > 0 || e.kind === 'trex' || e.kind === 'raptor'))).toBe(true);
  });

  it('a darted raptor turns on whoever darted it, then goes back to the fight', () => {
    const w = new World({ seed: 4, level: 5 });
    w.start();
    run(w, 1);
    const raptor = w.dinos.find((d) => d.kind === 'raptor' && d.state === 'loose')!;
    // Out of its own dart range, so it doesn't put the raptor to sleep first.
    const tranq = w.units.find((u) => u.kind === 'tranq')!;
    tranq.x = raptor.x - 6 * T;
    tranq.y = raptor.y;
    sedate(w, raptor, 10, tranq.id);
    run(w, 0.6);
    expect(raptor.target).toEqual({ type: 'unit', id: tranq.id });
    // Once the troop is out of reach (or the grudge wears off), it goes back to the T. rex.
    tranq.x = 6.5 * T;
    tranq.y = 14.5 * T;
    run(w, 1);
    expect(raptor.target?.type).toBe('dino');
  });

  it('while two raptors are on it, the T. rex ignores whoever darts it; with fewer, it locks on and roars before it comes', () => {
    const w = new World({ seed: 8, level: 5 });
    w.start();
    run(w, 2);
    const rex = w.dinos.find((d) => d.kind === 'trex')!;
    const heavy = w.units.find((u) => u.kind === 'heavy')!;
    Object.assign(heavy, { x: rex.x - 4 * T, y: rex.y });
    sedate(w, rex, 10, heavy.id);
    run(w, 1.5);
    expect(rex.lockId).toBe(0);
    // Take the raptors off it.
    for (const r of w.dinos.filter((d) => d.kind === 'raptor' && d.state === 'loose')) sedate(w, r, 1000, 0);
    Object.assign(heavy, { x: rex.x - 4 * T, y: rex.y });
    sedate(w, rex, 10, heavy.id);
    const x0 = rex.x;
    const y0 = rex.y;
    const events = run(w, 1, () => rex.lockId !== 0);
    expect(rex.lockId).toBe(heavy.id);
    expect(events).toContainEqual(expect.objectContaining({ type: 'roar', dinoId: rex.id, unitId: heavy.id }));
    // It stands and roars, then comes.
    const more = run(w, FIGHT.lockRoarSeconds - 0.2);
    expect(Math.hypot(rex.x - x0, rex.y - y0)).toBeLessThan(T / 2);
    expect(more.some((e) => e.type === 'charge')).toBe(false);
    run(w, 2);
    expect(Math.hypot(rex.x - x0, rex.y - y0)).toBeGreaterThan(T / 2);
  });

  it('three animals killed loses the level; darting every animal wins', () => {
    const w = new World({ seed: 5, level: 5 });
    w.start();
    const raptors = w.dinos.filter((d) => d.kind === 'raptor' && d.state === 'loose');
    for (const r of raptors) hurtAnimal(w, r, 1000, null);
    run(w, STEP);
    expect(w.result).toMatchObject({ won: false, reason: 'killed', title: 'Too many animals killed' });

    const win = new World({ seed: 5, level: 5 });
    win.start();
    for (const d of loose(win)) sedate(win, d, 10000, 0);
    run(win, STEP);
    expect(win.result).toMatchObject({ won: true, reason: 'secured', stars: 3, title: 'The fight is over' });
  });

  it('fights stay out of the blackout: a loose T. rex and loose raptors ignore each other there', () => {
    const w = new World({ seed: 6, level: 3 });
    expect(w.mission).toBeNull();
    // No fight code runs without the level's flag: health never changes.
    w.start();
    run(w, 1);
    expect(w.dinos.every((d) => d.health === DINOS[d.kind].health)).toBe(true);
  });
});

describe('level 5: the Patrol 4x4', () => {
  const setup = () => {
    const w = new World({ seed: 7, level: 5 });
    w.start();
    const jeep = w.units.find((u) => u.kind === 'jeep')!;
    const heavies = w.units.filter((u) => u.kind === 'heavy');
    const tranqs = w.units.filter((u) => u.kind === 'tranq');
    return { w, jeep, heavies, tranqs };
  };

  it('troops climb in up to the seats, Heavy Teams first, and the rest stop beside it', () => {
    const { w, jeep, heavies, tranqs } = setup();
    // Everyone at once, as Select all does: the Tranq Squads are nearer and faster, but the Heavy Teams get the seats.
    const all = [...tranqs, ...heavies];
    orderBoard(w, all.map((u) => u.id), jeep.id);
    run(w, 8);
    expect(passengers(w, jeep).map((u) => u.kind).sort()).toEqual(['heavy', 'heavy']);
    const left = all.filter((u) => !u.aboard);
    expect(left.map((u) => u.kind)).toEqual(['tranq', 'tranq']);
    expect(left.every((u) => u.order === 'idle' && Math.hypot(u.x - jeep.x, u.y - jeep.y) < 2.5 * T)).toBe(true);
  });

  it('drives faster than a Heavy Team walks, and everyone climbs out where it stops', () => {
    const { w, jeep, heavies } = setup();
    orderBoard(w, heavies.map((u) => u.id), jeep.id);
    run(w, 6, () => passengers(w, jeep).length === 2);
    const x0 = jeep.x;
    orderMove(w, [jeep.id], 20.5 * T, 12.5 * T);
    const events = run(w, 2);
    expect(jeep.x - x0).toBeGreaterThan(UNITS.heavy.speed * 2 * 2);
    events.push(...run(w, 6, () => jeep.order === 'idle'));
    expect(events).toContainEqual(expect.objectContaining({ type: 'unloaded', jeepId: jeep.id, count: 2 }));
    expect(heavies.every((h) => h.aboard === 0 && Math.hypot(h.x - jeep.x, h.y - jeep.y) < T * 1.5)).toBe(true);
  });

  it('sent at an animal, it drops its troops within reach and they attack it', () => {
    const { w, jeep, heavies } = setup();
    orderBoard(w, heavies.map((u) => u.id), jeep.id);
    run(w, 6, () => passengers(w, jeep).length === 2);
    const rex = w.dinos.find((d) => d.kind === 'trex')!;
    orderAttack(w, [jeep.id], rex.id);
    run(w, 10, () => passengers(w, jeep).length === 0);
    expect(Math.hypot(rex.x - jeep.x, rex.y - jeep.y)).toBeLessThanOrEqual(JEEP.dropTiles * T + 10);
    expect(heavies.every((h) => h.order === 'attack' && h.targetId === rex.id)).toBe(true);
  });

  it('troops inside are safe; when it is wrecked they climb out unhurt, and it isn’t a troop lost', () => {
    const { w, jeep, heavies } = setup();
    orderBoard(w, heavies.map((u) => u.id), jeep.id);
    run(w, 6, () => passengers(w, jeep).length === 2);
    const hp = heavies.map((h) => h.hp);
    // The T. rex locked onto a troop that climbed in goes after the 4x4 instead.
    const rex = w.dinos.find((d) => d.kind === 'trex')!;
    for (const r of w.dinos.filter((d) => d.kind === 'raptor')) sedate(w, r, 1000, 0);
    rex.x = jeep.x + 4 * T;
    rex.y = jeep.y;
    rex.lockId = heavies[0].id;
    run(w, 0.6);
    expect(rex.lockId).toBe(jeep.id);
    jeep.hp = 1;
    run(w, 6, () => jeep.dead);
    expect(jeep.dead).toBe(true);
    expect(heavies.every((h) => h.aboard === 0 && !h.dead)).toBe(true);
    expect(heavies.map((h) => h.hp)).toEqual(hp);
    expect(w.troopsLost).toBe(0);
    expect(w.jeepsLost).toBe(1);
  });

  it('a level with no troop left that can dart is lost, even with the 4x4', () => {
    const { w, heavies, tranqs } = setup();
    for (const u of [...heavies, ...tranqs]) u.dead = true;
    run(w, STEP);
    expect(w.result).toMatchObject({ won: false, reason: 'noTroops' });
  });
});

describe('per-pen power', () => {
  it('a fence with power can’t be damaged, and one without can, in the same level', () => {
    const w = new World({ seed: 1, level: 5 });
    w.start();
    const lit = w.exhibits.find((e) => e.powered && e.segments.every((s) => s.hp > 0))!;
    const dark = w.exhibits.find((e) => !e.powered)!;
    const i = lit.segments.findIndex((s) => !s.corner);
    const j = dark.segments.findIndex((s) => !s.corner);
    damageSegment(w, lit, i, 50);
    damageSegment(w, dark, j, 50);
    expect(lit.segments[i].hp).toBe(FENCE.chainLinkHp);
    expect(dark.segments[j].hp).toBe(FENCE.chainLinkHp - 50);
  });
});

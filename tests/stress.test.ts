// Randomized whole games that check the rules never break. Skipped in normal runs.
// Run with: STRESS=1 npx vitest run tests/stress.test.ts --silent=false
import { describe, expect, it } from 'vitest';
import { DINOS, EXHIBIT_KINDS, JEEP, MAP, type LevelId } from '../src/config';
import { Tile } from '../src/core/grid';
import { planPlacement, planTower } from '../src/core/placement';
import { createRng } from '../src/core/rng';
import { passengers } from '../src/core/jeep';
import { enqueueUnit, isTroop, orderAttack, orderBoard, orderMove, orderRepair, onMap } from '../src/core/units';
import { World } from '../src/core/world';
import { nextTime, timelineLines } from '../src/ui/timeline';

declare const process: { env: Record<string, string | undefined> };

const T = MAP.tileSize;
const STEP = 1 / 60;

function playRandom(seed: number, level: LevelId = 3) {
  const r = createRng(seed * 7919);
  const pick = <V>(xs: readonly V[]) => xs[Math.floor(r() * xs.length)];
  const w = new World({ seed, buildPhaseSeconds: 120 + Math.floor(r() * 300), level });
  w.start();
  let nextOrder = 0;
  for (let i = 0; i < (60 * 60) / STEP && w.phase !== 'ended'; i++) {
    w.update(STEP * w.timeScale);
    w.events = [];
    if (i % 30 !== 0) continue;

    if (w.phase === 'build' && w.phaseTime < w.buildPhaseSeconds * 0.7 && r() < 0.2) {
      const kind = pick(EXHIBIT_KINDS);
      const plan = planPlacement(w.grid, kind, Math.floor(r() * MAP.cols), Math.floor(r() * MAP.rows), w.money, w.countOf(kind));
      if (plan.valid) w.build(plan);
    }
    if (w.phase === 'build' && w.phaseTime > w.buildPhaseSeconds * 0.4 && r() < 0.05) {
      const tower = planTower(w.grid, Math.floor(r() * MAP.cols), Math.floor(r() * MAP.rows), w.money);
      if (tower.valid) w.buildTower(tower);
    }
    if ((w.phase !== 'build' || w.phaseTime > w.buildPhaseSeconds * 0.6) && w.trainable.length) {
      if (r() < 0.3) enqueueUnit(w, pick(w.trainable));
    }
    if (w.time >= nextOrder && w.units.length) {
      nextOrder = w.time + 3 + r() * 10;
      // Towers are in the list on purpose: orders to them must be ignored.
      const ids = w.units.filter(() => r() < 0.7).map((u) => u.id);
      const target = w.dinos.filter((d) => d.state === 'loose' || ((w.phase === 'blackout' || w.phase === 'mission') && d.state === 'penned'));
      const jeep = w.units.find((u) => u.kind === 'jeep' && !u.dead);
      // Levels 1 to 3 have neither, so they draw the same random numbers as before.
      if (w.substations.length && r() < 0.3) orderRepair(w, ids, pick(w.substations).id);
      else if (jeep && r() < 0.3) orderBoard(w, ids, jeep.id);
      else if (target.length && r() < 0.6) orderAttack(w, ids, pick(target).id);
      else orderMove(w, ids, r() * MAP.cols * T, r() * MAP.rows * T);
    }

    for (const p of [...w.units, ...w.dinos, ...w.visitors]) {
      expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
    }
    const troops = w.units.filter((u) => isTroop(u) && onMap(u));
    for (const p of [...troops, ...w.dinos]) {
      const tile = w.grid.get(Math.floor(p.x / T), Math.floor(p.y / T));
      if ([Tile.Rock, Tile.Water, Tile.HQ, Tile.Tower, Tile.Substation].includes(tile as never)) {
        const who = 'state' in p ? `${p.kind} ${p.state} target ${JSON.stringify(p.target)} stampede ${p.stampede.toFixed(2)}` : `${p.kind} ${p.order}`;
        throw new Error(`level ${level} seed ${seed}: ${who} on tile ${Math.floor(p.x / T)},${Math.floor(p.y / T)} (type ${tile}) at ${w.phaseTime.toFixed(1)}s`);
      }
    }
    for (const d of w.dinos) expect(d.health >= 0 && d.health <= DINOS[d.kind].health).toBe(true);
    for (const s of w.substations) {
      expect(s.work).toBeGreaterThanOrEqual(0);
      if (s.fixed) for (const id of s.pens) expect(w.exhibitById(id)!.powered).toBe(true);
    }
    for (const u of w.units) {
      if (u.kind === 'jeep') {
        expect(passengers(w, u).length).toBeLessThanOrEqual(JEEP.seats);
      }
      if (u.aboard) {
        // A rider goes where the 4x4 goes, and its 4x4 is still there.
        const jeep = w.unitById(u.aboard)!;
        expect(jeep && !jeep.dead).toBe(true);
        expect(u.x).toBe(jeep.x);
        expect(u.y).toBe(jeep.y);
        continue;
      }
      if (u.kind === 'tower') {
        // A tower never moves off its own tile.
        expect(w.grid.get(Math.floor(u.x / T), Math.floor(u.y / T))).toBe(Tile.Tower);
        expect(u.order).toBe('idle');
        continue;
      }
      const tx = Math.floor(u.x / T);
      const ty = Math.floor(u.y / T);
      if (!w.unitWalk(tx, ty)) {
        throw new Error(
          `seed ${seed}: ${u.kind} ${u.id} on tile ${tx},${ty} (type ${w.grid.get(tx, ty)}) at ${u.x.toFixed(1)},${u.y.toFixed(1)}; ` +
            `order ${u.order}, phase ${w.phase} ${w.phaseTime.toFixed(1)}s, path ${JSON.stringify(u.path.slice(u.pathIndex, u.pathIndex + 3))}`,
        );
      }
    }
    for (const v of w.visitors) expect(w.grid.isPathNetwork(Math.floor(v.x / T), Math.floor(v.y / T))).toBe(true);
    // The first escape in the dark starts the evacuation, and from then on nobody tours. Mission levels have no guests.
    if (!w.mission && !w.powerOn && w.dinos.some((d) => d.state === 'loose')) expect(w.evacuating).toBe(true);
    if (w.evacuating) for (const v of w.visitors) expect(['leaving', 'fleeing']).toContain(v.mode);
    expect(w.revenue).toBe(w.exhibits.reduce((n, e) => n + e.revenue, 0));
    expect(w.blackoutRevenue).toBeLessThanOrEqual(w.revenue);
    expect(w.money).toBeGreaterThanOrEqual(0);
    expect(w.visitors.length).toBeLessThanOrEqual(80);
  }
  expect(w.phase).toBe('ended');
  // The blackout log reads in order, from the power cut to the end, and the end screen can always say it.
  const log = w.result!.log;
  if (log.length) {
    expect(log[0].type).toBe(level === 3 ? 'blackout' : 'start');
    expect(log[log.length - 1].type).toBe('end');
    for (let i = 1; i < log.length; i++) expect(log[i].t).toBeGreaterThanOrEqual(log[i - 1].t);
  }
  // Level 4: a sighting of the Engineer is in the log whenever it cost the star.
  if (w.engineerSpotted && log.length) expect(log.some((e) => e.type === 'spotted' && e.kind === 'engineer')).toBe(true);
  const words = [...timelineLines(log).map((l) => l.text), nextTime(w.result!) ?? ''];
  for (const text of words) expect(text).not.toMatch(/[\u2013\u2014]|\s--\s/);
  return w.result!;
}

describe.skipIf(!process.env.STRESS)('stress', () => {
  it('random games of levels 1 and 2 always end with the rules intact', { timeout: 900_000 }, () => {
    const tally: Record<string, number> = {};
    for (const level of [1, 2] as const) {
      for (let seed = 1; seed <= 20; seed++) {
        const res = playRandom(seed, level);
        // A darted animal is back in its pen, never removed, so the count always adds up.
        expect(res.mission!.returned).toBeLessThanOrEqual(res.mission!.loose);
        const key = `level ${level}: ${res.reason} (${res.stars} stars)`;
        tally[key] = (tally[key] ?? 0) + 1;
      }
    }
    console.log(`\n40 random games of levels 1 and 2:\n` + Object.entries(tally).map(([k, n]) => `  ${k}: ${n}`).join('\n'));
  });

  it('random games of levels 4 and 5 always end with the rules intact', { timeout: 900_000 }, () => {
    const tally: Record<string, number> = {};
    for (const level of [4, 5] as const) {
      for (let seed = 1; seed <= 20; seed++) {
        const res = playRandom(seed, level);
        const key = `level ${level}: ${res.reason} (${res.stars} stars)`;
        tally[key] = (tally[key] ?? 0) + 1;
      }
    }
    console.log(`\n40 random games of levels 4 and 5:\n` + Object.entries(tally).map(([k, n]) => `  ${k}: ${n}`).join('\n'));
  });

  it('random games always end with the rules intact', { timeout: 900_000 }, () => {
    const tally: Record<string, number> = {};
    let towers = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const res = playRandom(seed);
      const key = `${res.reason} (${res.stars} stars)`;
      towers += res.towersBuilt;
      tally[key] = (tally[key] ?? 0) + 1;
    }
    console.log(`\n40 random games (${towers} towers built):\n` + Object.entries(tally).map(([k, n]) => `  ${k}: ${n}`).join('\n'));
  });
});

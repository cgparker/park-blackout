// Randomized whole games that check the rules never break. Skipped in normal runs.
// Run with: STRESS=1 npx vitest run tests/stress.test.ts --silent=false
import { describe, expect, it } from 'vitest';
import { EXHIBIT_KINDS, MAP, UNIT_KINDS } from '../src/config';
import { Tile } from '../src/core/grid';
import { planPlacement } from '../src/core/placement';
import { createRng } from '../src/core/rng';
import { enqueueUnit, orderAttack, orderMove } from '../src/core/units';
import { World } from '../src/core/world';

declare const process: { env: Record<string, string | undefined> };

const T = MAP.tileSize;
const STEP = 1 / 60;

function playRandom(seed: number) {
  const r = createRng(seed * 7919);
  const pick = <V>(xs: readonly V[]) => xs[Math.floor(r() * xs.length)];
  const w = new World({ seed, buildPhaseSeconds: 240 + Math.floor(r() * 360) });
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
    if (w.phase !== 'build' || w.phaseTime > w.buildPhaseSeconds * 0.6) {
      if (r() < 0.3) enqueueUnit(w, pick(UNIT_KINDS));
    }
    if (w.time >= nextOrder && w.units.length) {
      nextOrder = w.time + 3 + r() * 10;
      const ids = w.units.filter(() => r() < 0.7).map((u) => u.id);
      const target = w.dinos.filter((d) => d.state === 'loose' || (w.phase === 'blackout' && d.state === 'penned'));
      if (target.length && r() < 0.6) orderAttack(w, ids, pick(target).id);
      else orderMove(w, ids, r() * MAP.cols * T, r() * MAP.rows * T);
    }

    for (const p of [...w.units, ...w.dinos, ...w.visitors]) {
      expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
    }
    for (const p of [...w.units, ...w.dinos]) {
      const tile = w.grid.get(Math.floor(p.x / T), Math.floor(p.y / T));
      expect([Tile.Rock, Tile.Water, Tile.HQ]).not.toContain(tile);
    }
    for (const u of w.units) {
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
    expect(w.money).toBeGreaterThanOrEqual(0);
    expect(w.visitors.length).toBeLessThanOrEqual(80);
  }
  expect(w.phase).toBe('ended');
  return w.result!;
}

describe.skipIf(!process.env.STRESS)('stress', () => {
  it('random games always end with the rules intact', { timeout: 900_000 }, () => {
    const tally: Record<string, number> = {};
    for (let seed = 1; seed <= 40; seed++) {
      const res = playRandom(seed);
      const key = `${res.reason} (${res.stars} stars)`;
      tally[key] = (tally[key] ?? 0) + 1;
    }
    console.log('\n40 random games:\n' + Object.entries(tally).map(([k, n]) => `  ${k}: ${n}`).join('\n'));
  });
});

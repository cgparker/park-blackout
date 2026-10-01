// Headless balance check for the build phase. Skipped in normal test runs.
// Run with: npm run balance
import { describe, it } from 'vitest';
import { EXHIBITS, MAP, type ExhibitKind, type UnitKind } from '../src/config';
import { inFootprint } from '../src/core/exhibit';
import type { Rect } from '../src/core/grid';
import { planPlacement, type PlacementPlan } from '../src/core/placement';
import { spawnUnit } from '../src/core/units';
import { World } from '../src/core/world';

declare const process: { env: Record<string, string | undefined> };

interface Strategy {
  name: string;
  order: ExhibitKind[];
  /** Minimum empty tiles between exhibits. */
  gap: number;
  /** Stop building exhibits after this many seconds and bank the rest for troops. */
  stopAt: number;
}

const STRATEGIES: Strategy[] = [
  { name: 'Dense: 2 raptor, T. rex, 2 pasture', order: ['raptor', 'pasture', 'raptor', 'trex', 'pasture'], gap: 0, stopAt: 420 },
  { name: 'Dense: 3 raptor, 3 pasture', order: ['raptor', 'raptor', 'raptor', 'pasture', 'pasture', 'pasture'], gap: 0, stopAt: 420 },
  { name: 'Medium spacing: 2 raptor, T. rex, 2 pasture', order: ['raptor', 'pasture', 'raptor', 'trex', 'pasture'], gap: 3, stopAt: 420 },
  { name: 'Spread out: 2 raptor, T. rex, 2 pasture', order: ['raptor', 'pasture', 'raptor', 'trex', 'pasture'], gap: 7, stopAt: 420 },
  { name: 'Herbivores only', order: Array(10).fill('pasture'), gap: 0, stopAt: 420 },
];

const gapBetween = (a: Rect, b: Rect) =>
  Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w), b.y - (a.y + a.h), a.y - (b.y + b.h), 0);

/** The valid spot closest to the gate that keeps the required gap. */
function bestSpot(w: World, kind: ExhibitKind, gap: number): PlacementPlan | null {
  let best: PlacementPlan | null = null;
  let bestScore = Infinity;
  for (let y = 0; y < MAP.rows; y++) {
    for (let x = 0; x < MAP.cols; x++) {
      const plan = planPlacement(w.grid, kind, x, y, Infinity, w.countOf(kind));
      if (!plan.valid) continue;
      if (!inFootprint(plan.footprint, x, y)) continue;
      if (w.exhibits.some((e) => gapBetween(e.footprint, plan.footprint) < gap)) continue;
      const score = plan.totalCost * 0.001 + Math.hypot(x - MAP.gate.x, y - MAP.gate.y);
      if (score < bestScore) {
        bestScore = score;
        best = plan;
      }
    }
  }
  return best;
}

function play(s: Strategy, seed: number) {
  const w = new World({ seed });
  w.start();
  const queue = [...s.order];
  const step = 1 / 30;
  let nextLook = 0;
  while (w.phase === 'build') {
    if (queue.length && w.phaseTime < s.stopAt && w.phaseTime >= nextLook && w.money >= EXHIBITS[queue[0]].cost) {
      nextLook = w.phaseTime + 1;
      const plan = bestSpot(w, queue[0], s.gap);
      if (!plan) queue.shift();
      else if (w.money >= plan.totalCost) {
        w.build(plan);
        queue.shift();
      }
    }
    w.update(step);
    w.events = [];
  }
  return { revenue: w.revenue, bank: w.money, built: w.exhibits.map((e) => e.kind) };
}

const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US');

describe.skipIf(!process.env.BALANCE)('balance', () => {
  it('prints build-phase revenue for each strategy', { timeout: 300_000 }, () => {
    const rows: string[] = [];
    for (const s of STRATEGIES) {
      const runs = [1, 2, 3].map((seed) => play(s, seed));
      const avg = (f: (r: (typeof runs)[number]) => number) => runs.reduce((a, r) => a + f(r), 0) / runs.length;
      const counts = runs[0].built.reduce<Record<string, number>>((c, k) => ((c[EXHIBITS[k].name] = (c[EXHIBITS[k].name] ?? 0) + 1), c), {});
      rows.push(
        `${s.name.padEnd(44)} revenue ${money(avg((r) => r.revenue)).padStart(8)}   left for troops ${money(avg((r) => r.bank)).padStart(8)}   built ${Object.entries(counts)
          .map(([k, n]) => `${n} ${k}`)
          .join(', ')}`,
      );
    }
    console.log('\nBuild phase 10:00, revenue target $40,000\n' + rows.join('\n'));
  });
});

/** A fight on open grass: troops in a block, the dinosaurs released 6 tiles away. */
function fight(kind: 'raptor' | 'trex', troops: UnitKind[], seed: number) {
  const T = MAP.tileSize;
  const w = new World({ seed, startingMoney: 1_000_000, buildPhaseSeconds: 1 });
  const plan = planPlacement(w.grid, kind, kind === 'raptor' ? 9 : 20, kind === 'raptor' ? 8 : 16, Infinity, 0);
  w.build(plan);
  w.start();
  for (let i = 0; i < 70; i++) w.update(1 / 60);
  w.visitors = [];
  troops.forEach((k, i) => spawnUnit(w, k, { x: (30 + (i % 3)) * T, y: (20 + Math.floor(i / 3)) * T }));
  const dinos = w.dinos.filter((d) => d.kind === kind);
  dinos.forEach((d, i) => {
    d.state = 'loose';
    d.x = (24 + i * 0.5) * T;
    d.y = 20.5 * T;
    d.path = [];
    d.target = null;
    d.think = 0;
  });
  let t = 0;
  while (t < 120 && dinos.some((d) => d.state !== 'secured') && w.units.length > 0) {
    w.update(1 / 60);
    w.events = [];
    t += 1 / 60;
  }
  return { won: dinos.every((d) => d.state === 'secured'), lost: troops.length - w.units.length, seconds: t };
}

describe.skipIf(!process.env.BALANCE)('combat', () => {
  it('prints fight outcomes', { timeout: 300_000 }, () => {
    const cases: [string, 'raptor' | 'trex', UnitKind[]][] = [
      ['Raptor pack vs 2 Tranq', 'raptor', ['tranq', 'tranq']],
      ['Raptor pack vs 3 Tranq', 'raptor', ['tranq', 'tranq', 'tranq']],
      ['Raptor pack vs 4 Tranq', 'raptor', ['tranq', 'tranq', 'tranq', 'tranq']],
      ['Raptor pack vs 2 Heavy', 'raptor', ['heavy', 'heavy']],
      ['T. rex vs 2 Heavy + 2 Tranq', 'trex', ['heavy', 'heavy', 'tranq', 'tranq']],
      ['T. rex vs 4 Tranq', 'trex', ['tranq', 'tranq', 'tranq', 'tranq']],
      ['T. rex vs 3 Heavy', 'trex', ['heavy', 'heavy', 'heavy']],
    ];
    const rows = cases.map(([name, kind, troops]) => {
      const runs = [1, 2, 3, 4, 5].map((seed) => fight(kind, troops, seed));
      const wins = runs.filter((r) => r.won).length;
      const lost = runs.reduce((a, r) => a + r.lost, 0) / runs.length;
      return `${name.padEnd(30)} won ${wins}/5   troops lost ${lost.toFixed(1)} of ${troops.length}`;
    });
    console.log('\nFights on open grass, 5 seeds each\n' + rows.join('\n'));
  });
});

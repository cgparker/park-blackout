// Headless balance check for the build phase. Skipped in normal test runs.
// Run with: npm run balance
import { describe, it } from 'vitest';
import { EXHIBITS, MAP, type ExhibitKind } from '../src/config';
import { inFootprint } from '../src/core/exhibit';
import type { Rect } from '../src/core/grid';
import { planPlacement, type PlacementPlan } from '../src/core/placement';
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

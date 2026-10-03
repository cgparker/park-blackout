// Headless balance checks. Skipped in normal test runs.
// Run with: npm run balance
import { describe, it } from 'vitest';
import { BLACKOUT, EXHIBITS, MAP, SCORING, UNITS, type ExhibitKind, type UnitKind } from '../src/config';
import { footprintCenter, inFootprint } from '../src/core/exhibit';
import type { Point, Rect } from '../src/core/grid';
import { nearestOpenTile } from '../src/core/nav';
import { planPlacement, planTower, type PlacementPlan } from '../src/core/placement';
import { enqueueUnit, isTroop, orderAttack, orderMove, spawnUnit } from '../src/core/units';
import { World } from '../src/core/world';

declare const process: { env: Record<string, string | undefined> };

const T = MAP.tileSize;
const PHASE = BLACKOUT.buildPhaseSeconds;

interface Strategy {
  name: string;
  order: ExhibitKind[];
  /** Minimum empty tiles between exhibits. */
  gap: number;
  /** Stop building exhibits at this fraction of the build phase and bank the rest. */
  stopAt: number;
}

const DENSE_TREX: ExhibitKind[] = ['raptor', 'pasture', 'raptor', 'trex', 'pasture'];

const STRATEGIES: Strategy[] = [
  { name: 'Dense: 2 raptor, T. rex, 2 pasture', order: DENSE_TREX, gap: 0, stopAt: 0.7 },
  { name: 'Dense: 3 raptor, 3 pasture', order: ['raptor', 'raptor', 'raptor', 'pasture', 'pasture', 'pasture'], gap: 0, stopAt: 0.7 },
  { name: 'Medium (3 tiles apart), same as row 1', order: DENSE_TREX, gap: 3, stopAt: 0.7 },
  { name: 'Spread (7 tiles apart), same as row 1', order: DENSE_TREX, gap: 7, stopAt: 0.7 },
  { name: 'Herbivores only', order: Array(10).fill('pasture'), gap: 0, stopAt: 0.7 },
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

/** How the defender plays the blackout. */
type Style = 'massed' | 'split';

/** What the bank buys at 70% of the build phase. Troops alternate Heavy and Tranq. */
interface Defense {
  name: string;
  /** Troops to buy. Infinity means as many as the bank allows. */
  troops: number;
  towers: number;
  /** Which fences to reinforce first: none, every predator pen, or only the raptor pens. */
  concrete: 'none' | 'predators' | 'raptors';
  style: Style;
}

const DEFENSES: Defense[] = [
  { name: 'Nothing', troops: 0, towers: 0, concrete: 'none', style: 'massed' },
  { name: '5 troops, massed', troops: 5, towers: 0, concrete: 'none', style: 'massed' },
  { name: '6 troops, massed', troops: 6, towers: 0, concrete: 'none', style: 'massed' },
  { name: '7 troops, massed', troops: 7, towers: 0, concrete: 'none', style: 'massed' },
  { name: 'Whole bank, massed', troops: Infinity, towers: 0, concrete: 'none', style: 'massed' },
  { name: 'Whole bank, split', troops: Infinity, towers: 0, concrete: 'none', style: 'split' },
  { name: 'All concrete, rest split', troops: Infinity, towers: 0, concrete: 'predators', style: 'split' },
  { name: 'Raptor concrete, rest split', troops: Infinity, towers: 0, concrete: 'raptors', style: 'split' },
  { name: '2 towers, rest massed', troops: Infinity, towers: 2, concrete: 'none', style: 'massed' },
];

/** Plays the build phase: builds the strategy's exhibits, then spends the bank on the chosen defense. */
function buildPhase(s: Strategy, seed: number, defense: Defense = DEFENSES[0]): World {
  const w = new World({ seed });
  w.start();
  const queue = [...s.order];
  const step = 1 / 30;
  let nextLook = 0;
  let prepared = false;
  while (w.phase === 'build') {
    const late = w.phaseTime >= s.stopAt * PHASE;
    if (!late && queue.length && w.phaseTime >= nextLook && w.money >= EXHIBITS[queue[0]].cost) {
      nextLook = w.phaseTime + 1;
      const plan = bestSpot(w, queue[0], s.gap);
      if (!plan) queue.shift();
      else if (w.money >= plan.totalCost) {
        w.build(plan);
        queue.shift();
      }
    }
    if (late && !prepared) {
      prepared = true;
      for (const ex of w.exhibits) {
        if ((defense.concrete === 'predators' && ex.kind !== 'pasture') || (defense.concrete === 'raptors' && ex.kind === 'raptor')) w.reinforce(ex.id);
      }
      if (defense.towers) buildTowers(w, defense.towers);
    }
    const ordered = w.troopsTrained + w.queue.length;
    if (late && ordered < defense.troops && w.queue.length < 5) {
      enqueueUnit(w, ordered % 2 === 0 ? 'heavy' : 'tranq') || enqueueUnit(w, 'tranq');
    }
    w.update(step);
    w.events = [];
  }
  return w;
}

/** Towers on the grass beside each predator pen, on the side facing its viewing spot. */
function buildTowers(w: World, max: number): void {
  const pens = w.exhibits.filter((e) => e.kind !== 'pasture').sort((a, b) => (a.kind === 'trex' ? -1 : b.kind === 'trex' ? 1 : 0));
  let built = 0;
  for (let round = 0; round < 3 && built < max; round++) {
    for (const ex of pens) {
      if (built >= max || w.money < UNITS.tower.cost) return;
      const spot = ex.viewingSpot;
      let best: Point | null = null;
      let bestD = Infinity;
      for (let y = ex.footprint.y - 2; y < ex.footprint.y + ex.footprint.h + 2; y++) {
        for (let x = ex.footprint.x - 2; x < ex.footprint.x + ex.footprint.w + 2; x++) {
          if (!w.grid.inBounds(x, y) || !planTower(w.grid, x, y, w.money).valid) continue;
          const d = Math.hypot(x - spot.x, y - spot.y);
          if (d < bestD) {
            bestD = d;
            best = { x, y };
          }
        }
      }
      if (best) {
        w.buildTower(planTower(w.grid, best.x, best.y, w.money));
        built++;
      }
    }
  }
}

const toTile = (w: World, x: number, y: number) => {
  const t = nearestOpenTile(w.grid.cols, w.grid.rows, w.unitWalk, x, y)!;
  return { x: (t.x + 0.5) * T, y: (t.y + 0.5) * T };
};

/**
 * Massed: every troop rallies between the predator pens, then all go after the nearest loose predator.
 * Split: troops are dealt out to the predator pens (raptor pens first) and wait at each viewing spot,
 * where the visitors are. Each fights whatever comes within 8 tiles of it.
 */
function blackoutPhase(w: World, style: Style) {
  const pens = w.exhibits.filter((e) => e.kind !== 'pasture');
  const c = pens.length
    ? pens.map((e) => footprintCenter(e.footprint, T)).reduce((a, p) => ({ x: a.x + p.x / pens.length, y: a.y + p.y / pens.length }), { x: 0, y: 0 })
    : { x: 10 * T, y: 12 * T };
  const rally = toTile(w, Math.floor(c.x / T), Math.floor(c.y / T));
  const posts = [...pens].sort((a, b) => Number(b.kind === 'raptor') - Number(a.kind === 'raptor')).map((e) => toTile(w, e.viewingSpot.x, e.viewingSpot.y));
  const post = new Map<number, { x: number; y: number }>();
  const troops = () => w.units.filter(isTroop);
  const placeNew = () => {
    for (const u of troops()) {
      if (post.has(u.id)) continue;
      const p = style === 'split' && posts.length ? posts[post.size % posts.length] : rally;
      post.set(u.id, p);
      orderMove(w, [u.id], p.x, p.y);
    }
  };
  placeNew();
  const inPark = w.visitorsAtBlackout;
  let firstBreach = -1;
  let next = 0;
  const step = 1 / 60;
  while (w.phase !== 'ended') {
    w.update(step * w.timeScale);
    if (firstBreach < 0 && w.events.some((e) => e.type === 'breach')) firstBreach = w.time - PHASE;
    w.events = [];
    if (w.time < next) continue;
    next = w.time + 1;
    placeNew();
    const squad = troops();
    const loose = w.dinos.filter((d) => d.state === 'loose');
    if (!squad.length || !loose.length) continue;
    const nearest = (x: number, y: number, list: typeof loose) =>
      [...list].sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))[0];
    if (style === 'massed') {
      const cx = squad.reduce((a, u) => a + u.x, 0) / squad.length;
      const cy = squad.reduce((a, u) => a + u.y, 0) / squad.length;
      const target = nearest(cx, cy, loose.filter((d) => d.kind !== 'triceratops')) ?? nearest(cx, cy, loose);
      const idle = squad.filter((u) => !(u.order === 'attack' && u.targetId === target.id));
      if (idle.length) orderAttack(w, idle.map((u) => u.id), target.id);
      continue;
    }
    const stillPenned = w.dinos.some((d) => d.state === 'penned' && d.kind !== 'triceratops');
    for (const u of squad) {
      const close = loose.filter((d) => Math.hypot(d.x - u.x, d.y - u.y) <= 8 * T);
      const target =
        nearest(u.x, u.y, close.filter((d) => d.kind !== 'triceratops')) ??
        nearest(u.x, u.y, close) ??
        (stillPenned ? undefined : nearest(u.x, u.y, loose.filter((d) => d.kind !== 'triceratops')));
      if (target && !(u.order === 'attack' && u.targetId === target.id)) orderAttack(w, [u.id], target.id);
      else if (!target && u.order === 'idle') {
        const p = post.get(u.id)!;
        if (Math.hypot(p.x - u.x, p.y - u.y) > 2 * T) orderMove(w, [u.id], p.x, p.y);
      }
    }
  }
  return { inPark, firstBreach, result: w.result! };
}

const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US');

describe.skipIf(!process.env.BALANCE)('balance', () => {
  it('prints build-phase revenue for each strategy', { timeout: 600_000 }, () => {
    const rows: string[] = [];
    let target = 0;
    for (const s of STRATEGIES) {
      const runs = [1, 2, 3].map((seed) => buildPhase(s, seed));
      target = runs[0].revenueTarget;
      const avg = (f: (w: World) => number) => runs.reduce((a, w) => a + f(w), 0) / runs.length;
      const counts = runs[0].exhibits.reduce<Record<string, number>>((c, e) => ((c[EXHIBITS[e.kind].name] = (c[EXHIBITS[e.kind].name] ?? 0) + 1), c), {});
      rows.push(
        `${s.name.padEnd(42)} revenue ${money(avg((w) => w.revenue)).padStart(8)}   left ${money(avg((w) => w.money)).padStart(8)}   ` +
          `in park ${avg((w) => w.visitors.length).toFixed(0).padStart(2)}   built ${Object.entries(counts)
            .map(([k, n]) => `${n} ${k}`)
            .join(', ')}`,
      );
    }
    console.log(`\nBuild phase ${PHASE / 60}:00, revenue target ${money(target)}\n` + rows.join('\n'));
  });

  // SEEDS=16 for steadier numbers. UNCAPPED=1 lifts the casualty limit and prints every game's deaths,
  // so you can see what a different limit would do.
  it('prints whole blackouts for two dense parks', { timeout: 1_800_000 }, () => {
    const seeds = Number(process.env.SEEDS ?? 8);
    const uncapped = !!process.env.UNCAPPED;
    const limit = SCORING.casualtyLimit;
    if (uncapped) SCORING.casualtyLimit = Infinity;
    const rows: string[] = [];
    try {
      for (const park of [STRATEGIES[0], STRATEGIES[1]]) {
        rows.push(`\n${park.name}`);
        for (const defense of DEFENSES) {
          const runs = Array.from({ length: seeds }, (_, i) => i + 1).map((seed) => {
            const w = buildPhase(park, seed, defense);
            const s = w.spending;
            const spent = s.troops + s.towers + s.reinforcement;
            const troops = w.units.filter(isTroop).length + w.queue.length;
            return { ...blackoutPhase(w, defense.style), spent, share: spent / (spent + w.money), troops };
          });
          const avg = (f: (r: (typeof runs)[number]) => number) => runs.reduce((a, r) => a + f(r), 0) / runs.length;
          const tally: Record<string, number> = {};
          for (const r of runs) {
            const k = r.result.won ? `won ${r.result.stars}★` : r.result.reason;
            tally[k] = (tally[k] ?? 0) + 1;
          }
          const killed = runs.map((r) => r.result.casualtyTotal);
          rows.push(
            `  ${defense.name.padEnd(28)} troops ${avg((r) => r.troops).toFixed(1).padStart(4)}  spent ${money(avg((r) => r.spent)).padStart(7)} ` +
              `(${Math.round(avg((r) => r.share) * 100)}% of bank)  killed ${avg((r) => r.result.casualtyTotal).toFixed(1)} [${Math.min(...killed)}-${Math.max(...killed)}]  ` +
              `troops lost ${avg((r) => r.result.troopsLost).toFixed(1)}  earned in the dark ${money(avg((r) => r.result.blackoutRevenue))}  | ${Object.entries(tally)
                .map(([k, n]) => `${n} ${k}`)
                .join(', ')}`,
          );
          if (uncapped) rows.push(`    deaths per game: ${[...killed].sort((a, b) => a - b).join(' ')}`);
        }
      }
    } finally {
      SCORING.casualtyLimit = limit;
    }
    const cap = uncapped ? 'no casualty limit' : `casualty limit ${limit}`;
    console.log(`\nWhole blackouts, ${seeds} seeds per defense (${cap}; the bank is spent at 70% of the build phase)` + rows.join('\n'));
  });
});

/** A fight on open grass: troops (and towers) in a block, the dinosaurs released 6 tiles away. */
function fight(kind: 'raptor' | 'trex', troops: UnitKind[], seed: number) {
  const w = new World({ seed, startingMoney: 1_000_000, buildPhaseSeconds: 1 });
  const plan = planPlacement(w.grid, kind, kind === 'raptor' ? 9 : 20, kind === 'raptor' ? 8 : 16, Infinity, 0);
  w.build(plan);
  let slot = 0;
  for (const k of troops) {
    if (k !== 'tower') continue;
    const x = 30 + (slot % 3);
    const y = 20 + Math.floor(slot / 3);
    slot++;
    w.buildTower(planTower(w.grid, x, y, w.money));
  }
  w.start();
  for (let i = 0; i < 70; i++) w.update(1 / 60);
  w.visitors = [];
  for (const k of troops) {
    if (k === 'tower') continue;
    const x = 30 + (slot % 3);
    const y = 20 + Math.floor(slot / 3);
    slot++;
    spawnUnit(w, k, { x: (x + 0.5) * T, y: (y + 0.5) * T });
  }
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
      ['Raptor pack vs 2 Heavy', 'raptor', ['heavy', 'heavy']],
      ['Raptor pack vs 1 Tower', 'raptor', ['tower']],
      ['Raptor pack vs 2 Towers', 'raptor', ['tower', 'tower']],
      ['T. rex vs 2 Heavy + 2 Tranq', 'trex', ['heavy', 'heavy', 'tranq', 'tranq']],
      ['T. rex vs 3 Heavy', 'trex', ['heavy', 'heavy', 'heavy']],
      ['T. rex vs 3 Heavy + 2 Tranq', 'trex', ['heavy', 'heavy', 'heavy', 'tranq', 'tranq']],
      ['T. rex vs 4 Heavy', 'trex', ['heavy', 'heavy', 'heavy', 'heavy']],
      ['T. rex vs 2 Towers + 2 Heavy', 'trex', ['tower', 'tower', 'heavy', 'heavy']],
    ];
    const rows = cases.map(([name, kind, troops]) => {
      const runs = [1, 2, 3, 4, 5].map((seed) => fight(kind, troops, seed));
      const wins = runs.filter((r) => r.won).length;
      const lost = runs.reduce((a, r) => a + r.lost, 0) / runs.length;
      const secs = runs.reduce((a, r) => a + r.seconds, 0) / runs.length;
      return `${name.padEnd(30)} won ${wins}/5   lost ${lost.toFixed(1)} of ${troops.length}   ${secs.toFixed(0)} s`;
    });
    console.log('\nFights on open grass, 5 seeds each\n' + rows.join('\n'));
  });
});


import { BLACKOUT, EXHIBITS, SCORING, type ExhibitKind } from '../config';
import type { CasualtyCause, World } from './world';

export type EndReason = 'secured' | 'shutdown' | 'overrun';

export interface Result {
  won: boolean;
  reason: EndReason;
  stars: number;
  title: string;
  detail: string;
  revenue: number;
  revenueTarget: number;
  exhibits: { id: number; kind: ExhibitKind; name: string; visits: number; revenue: number }[];
  spending: { exhibits: number; paths: number; reinforcement: number; troops: number; total: number };
  casualties: Record<CasualtyCause, number>;
  casualtyTotal: number;
  troopsTrained: number;
  troopsLost: number;
  dinosSecured: number;
  dinosContained: number;
  visitorsSafe: number;
}

/** One star for winning, two for also hitting the revenue target, three for doing that with nobody hurt. */
export function starsFor(won: boolean, revenue: number, target: number, casualties: number): number {
  if (!won) return 0;
  if (revenue < target) return 1;
  return casualties === 0 ? 3 : 2;
}

function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;
}

export function buildResult(w: World, won: boolean, reason: EndReason): Result {
  const casualtyTotal = w.casualtyTotal;
  const titles: Record<EndReason, { title: string; detail: string }> = {
    secured: {
      title: 'Park secured',
      detail: 'Power is back on and every dinosaur is accounted for.',
    },
    shutdown: {
      title: 'The park has been shut down',
      detail: `${SCORING.casualtyLimit} visitors were killed.`,
    },
    overrun: {
      title: 'The park is overrun',
      detail: `Dinosaurs were still loose ${clock(BLACKOUT.overrunSeconds)} after the power came back.`,
    },
  };
  const s = w.spending;
  return {
    won,
    reason,
    stars: starsFor(won, w.revenue, w.revenueTarget, casualtyTotal),
    ...titles[reason],
    revenue: w.revenue,
    revenueTarget: w.revenueTarget,
    exhibits: w.exhibits.map((e) => ({ id: e.id, kind: e.kind, name: EXHIBITS[e.kind].name, visits: e.visits, revenue: e.revenue })),
    spending: { ...s, total: s.exhibits + s.paths + s.reinforcement + s.troops },
    casualties: { ...w.casualties },
    casualtyTotal,
    troopsTrained: w.troopsTrained,
    troopsLost: w.troopsLost,
    dinosSecured: w.dinosSecured,
    dinosContained: w.dinosContained,
    visitorsSafe: w.visitorsSafe,
  };
}

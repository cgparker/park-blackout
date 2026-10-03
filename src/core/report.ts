import { BLACKOUT, EXHIBITS, SCORING, type AnimalKind, type ExhibitKind } from '../config';
import type { LogEntry } from './log';
import type { CasualtyCause, World } from './world';

/** `abandoned`: the player ended the game from the pause menu. */
export type EndReason = 'secured' | 'shutdown' | 'overrun' | 'abandoned';

export interface Result {
  won: boolean;
  reason: EndReason;
  stars: number;
  title: string;
  detail: string;
  revenue: number;
  /** The part of revenue earned while the power was out. */
  blackoutRevenue: number;
  revenueTarget: number;
  exhibits: { id: number; kind: ExhibitKind; name: string; visits: number; revenue: number; reinforced: boolean }[];
  spending: { exhibits: number; paths: number; reinforcement: number; troops: number; towers: number; total: number };
  casualties: Record<CasualtyCause, number>;
  casualtyTotal: number;
  troopsTrained: number;
  troopsLost: number;
  towersBuilt: number;
  towersLost: number;
  dinosSecured: number;
  dinosContained: number;
  visitorsAtBlackout: number;
  /** The first animal out, whose escape started the evacuation. null if nothing got out. */
  evacuatedBy: AnimalKind | null;
  visitorsSafe: number;
  /** What happened after the lights went out. Empty if the game ended before the blackout. */
  log: LogEntry[];
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
    abandoned: {
      title: 'Game ended early',
      detail: w.log.length ? 'You ended the game before every dinosaur was accounted for.' : 'You ended the game before the blackout.',
    },
  };
  const s = w.spending;
  return {
    won,
    reason,
    stars: starsFor(won, w.revenue, w.revenueTarget, casualtyTotal),
    ...titles[reason],
    revenue: w.revenue,
    blackoutRevenue: w.blackoutRevenue,
    revenueTarget: w.revenueTarget,
    exhibits: w.exhibits.map((e) => ({ id: e.id, kind: e.kind, name: EXHIBITS[e.kind].name, visits: e.visits, revenue: e.revenue, reinforced: e.reinforced })),
    spending: { ...s, total: s.exhibits + s.paths + s.reinforcement + s.troops + s.towers },
    casualties: { ...w.casualties },
    casualtyTotal,
    troopsTrained: w.troopsTrained,
    troopsLost: w.troopsLost,
    towersBuilt: w.towersBuilt,
    towersLost: w.towersLost,
    dinosSecured: w.dinosSecured,
    dinosContained: w.dinosContained,
    visitorsAtBlackout: w.visitorsAtBlackout,
    evacuatedBy: w.evacuatedBy,
    visitorsSafe: w.visitorsSafe,
    log: w.log.map((e) => ({ ...e })),
  };
}

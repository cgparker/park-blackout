import { BLACKOUT, EXHIBITS, SCORING, type AnimalKind, type ExhibitKind, type HuntConfig, type LevelId } from '../config';
import type { LogEntry } from './log';
import type { CasualtyCause, World } from './world';

/**
 * `abandoned`: the player ended the game from the pause menu.
 * Levels 1 and 2 only: `timeUp`, the park opened with animals still loose; `noTroops`, no troops left and no money for more.
 */
export type EndReason = 'secured' | 'shutdown' | 'overrun' | 'abandoned' | 'timeUp' | 'noTroops';

export interface Result {
  level: LevelId;
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
  /** Levels 1 and 2: the animal that is loose, how many started loose, how many are back in a pen, and the time left. */
  hunt: { kind: AnimalKind; loose: number; returned: number; timeLeft: number } | null;
  /** What happened after the lights went out (or after the start, in levels 1 and 2). Empty if the game ended before that. */
  log: LogEntry[];
}

/** Counts stars: one for the win, one for each other goal met. A loss earns none. */
function countStars(won: boolean, ...met: boolean[]): number {
  return won ? 1 + met.filter(Boolean).length : 0;
}

/** Level 3: the win, the revenue target, and nobody killed. */
export function starsFor(won: boolean, revenue: number, target: number, casualties: number): number {
  return countStars(won, revenue >= target, casualties === 0);
}

/** Levels 1 and 2: the second goal (spending) and the third (time left, or no troops lost). */
export function huntGoalsMet(cfg: HuntConfig, spent: number, timeLeft: number, troopsLost: number): { spend: boolean; third: boolean } {
  return {
    spend: spent <= cfg.spendStar,
    // Rounded up, like the countdown: while the clock still shows 1:00, there is 1:00 left.
    third: cfg.thirdStar.type === 'timeLeft' ? Math.ceil(timeLeft) >= cfg.thirdStar.seconds : troopsLost === 0,
  };
}

function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** "Triceratops", "raptors", "T. rex", for the middle of a sentence. */
export function animalNoun(kind: AnimalKind, n: number): string {
  if (kind === 'raptor') return n === 1 ? 'raptor' : 'raptors';
  return kind === 'trex' ? 'T. rex' : 'Triceratops';
}

function blackoutTitles(w: World): Record<EndReason, { title: string; detail: string }> {
  const ended = {
    title: 'Game ended early',
    detail: w.log.length ? 'You ended the game before every dinosaur was accounted for.' : 'You ended the game before the blackout.',
  };
  return {
    secured: { title: 'Park secured', detail: 'Power is back on and every dinosaur is accounted for.' },
    shutdown: { title: 'The park has been shut down', detail: `${SCORING.casualtyLimit} visitors were killed.` },
    overrun: { title: 'The park is overrun', detail: `Dinosaurs were still loose ${clock(BLACKOUT.overrunSeconds)} after the power came back.` },
    abandoned: ended,
    // Not reachable in the blackout level.
    timeUp: ended,
    noTroops: ended,
  };
}

/** Where each kind of animal lives, plural. */
const PEN_WORD: Record<AnimalKind, string> = { triceratops: 'pastures', raptor: 'pens', trex: 'paddocks' };

function huntTitles(w: World, kind: AnimalKind, loose: number, timeLeft: number): Record<EndReason, { title: string; detail: string }> {
  const nest = !!w.nest;
  const left = w.looseCount;
  const outOfTroops = {
    title: 'Out of troops',
    detail: `Every troop is gone, and there isn't enough money to train another. ${left} ${animalNoun(kind, left)} still loose.`,
  };
  return {
    secured: nest
      ? { title: 'The nest is clear', detail: `All ${loose} raptors are back in their pens with ${clock(Math.ceil(timeLeft))} to spare.` }
      : { title: `Every ${animalNoun(kind, 1)} is back`, detail: `All ${loose} are back in their ${PEN_WORD[kind]} with ${clock(Math.ceil(timeLeft))} to spare.` },
    timeUp: {
      title: `The park opened with ${animalNoun(kind, 2)} loose`,
      detail: `${left} ${left === 1 ? 'was' : 'were'} still loose when the gates opened.`,
    },
    noTroops: outOfTroops,
    abandoned: {
      title: 'Game ended early',
      detail: nest ? 'You ended the game before the nest was clear.' : `You ended the game before every ${animalNoun(kind, 1)} was back.`,
    },
    // Not reachable in levels 1 and 2.
    shutdown: outOfTroops,
    overrun: outOfTroops,
  };
}

export function buildResult(w: World, won: boolean, reason: EndReason): Result {
  const casualtyTotal = w.casualtyTotal;
  const s = w.spending;
  let stars: number;
  let hunt: Result['hunt'] = null;
  let titles: Record<EndReason, { title: string; detail: string }>;
  if (w.hunt) {
    const counts = w.startedLoose;
    const kind = (Object.keys(counts)[0] as AnimalKind | undefined) ?? 'triceratops';
    const loose = Object.values(counts).reduce((a, n) => a + (n ?? 0), 0);
    const timeLeft = Math.max(0, w.hunt.timeLimitSeconds - w.phaseTime);
    const met = huntGoalsMet(w.hunt, s.troops, timeLeft, w.troopsLost);
    stars = countStars(won, met.spend, met.third);
    hunt = { kind, loose, returned: w.returned, timeLeft };
    titles = huntTitles(w, kind, loose, timeLeft);
  } else {
    stars = starsFor(won, w.revenue, w.revenueTarget, casualtyTotal);
    titles = blackoutTitles(w);
  }
  return {
    level: w.level,
    won,
    reason,
    stars,
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
    hunt,
    log: w.log.map((e) => ({ ...e })),
  };
}

import { BLACKOUT, EXHIBITS, SCORING, type AnimalKind, type ExhibitKind, type LevelId, type MissionConfig, type StarGoal } from '../config';
import type { LogEntry } from './log';
import type { CasualtyCause, World } from './world';

/**
 * `abandoned`: the player ended the game from the pause menu.
 * Mission levels only: `timeUp`, the clock ran out (the park opened, or dawn came) first; `noTroops`, no troop left that
 * can dart and no money for one; `noEngineers` (level 4), no Engineer left for the substations;
 * `killed` (level 5), too many animals killed in the fight.
 */
export type EndReason = 'secured' | 'shutdown' | 'overrun' | 'abandoned' | 'timeUp' | 'noTroops' | 'noEngineers' | 'killed';

/** What a mission level's stars are measured on. */
export interface MissionTally {
  /** Spent on troops. */
  spent: number;
  timeLeft: number;
  troopsLost: number;
  killed: number;
  /** Level 4: a raptor saw the Engineer. */
  spotted: boolean;
}

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
  engineersLost: number;
  towersBuilt: number;
  towersLost: number;
  jeepsLost: number;
  dinosSecured: number;
  dinosContained: number;
  visitorsAtBlackout: number;
  /** The first animal out, whose escape started the evacuation. null if nothing got out. */
  evacuatedBy: AnimalKind | null;
  visitorsSafe: number;
  /**
   * Mission levels: the kind that started loose (the first one listed), how many started loose, how many came back
   * (darted, or walked into a powered pen), the time left, and the level's own numbers.
   */
  mission: {
    kind: AnimalKind;
    loose: number;
    returned: number;
    timeLeft: number;
    /** Level 4: substations fixed, out of how many, and whether a raptor saw the Engineer. */
    fixed: number;
    substations: number;
    spotted: boolean;
    /** Level 5: animals killed, and the team it started with. */
    killed: number;
    team: number;
  } | null;
  /** What happened after the lights went out (or after the start, in mission levels). Empty if the game ended before that. */
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

/** Whether one of a mission level's star goals is met. */
export function goalMet(g: StarGoal, t: MissionTally): boolean {
  switch (g.type) {
    case 'spend':
      return t.spent <= g.max;
    // Rounded up, like the countdown: while the clock still shows 1:00, there is 1:00 left.
    case 'timeLeft':
      return Math.ceil(t.timeLeft) >= g.seconds;
    case 'noTroopsLost':
      return t.troopsLost === 0;
    case 'noneKilled':
      return t.killed === 0;
    case 'neverSpotted':
      return !t.spotted;
  }
}

/** A mission level's second and third goals. */
export function missionGoalsMet(cfg: MissionConfig, t: MissionTally): [boolean, boolean] {
  return [goalMet(cfg.stars[0], t), goalMet(cfg.stars[1], t)];
}

export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** "Triceratops", "raptors", "T. rex", for the middle of a sentence. */
export function animalNoun(kind: AnimalKind, n: number): string {
  if (kind === 'raptor') return n === 1 ? 'raptor' : 'raptors';
  return kind === 'trex' ? 'T. rex' : 'Triceratops';
}

/** "the T. rex, 2 raptors, 1 Triceratops", for the middle of a sentence. With `and`, the last one joins with "and". */
export function animalList(counts: Partial<Record<AnimalKind, number>>, and = false): string {
  const parts: string[] = [];
  const t = counts.trex ?? 0;
  const r = counts.raptor ?? 0;
  const c = counts.triceratops ?? 0;
  if (t) parts.push('the T. rex');
  if (r) parts.push(`${r} ${r === 1 ? 'raptor' : 'raptors'}`);
  if (c) parts.push(`${c} Triceratops`);
  if (and && parts.length > 1) return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
  return parts.join(', ');
}

type Titles = Record<EndReason, { title: string; detail: string }>;

function blackoutTitles(w: World): Titles {
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
    noEngineers: ended,
    killed: ended,
  };
}

/** Where each kind of animal lives, plural. */
const PEN_WORD: Record<AnimalKind, string> = { triceratops: 'pastures', raptor: 'pens', trex: 'paddocks' };

function stillLoose(w: World): string {
  const loose: Partial<Record<AnimalKind, number>> = {};
  for (const d of w.dinos) if (d.state === 'loose') loose[d.kind] = (loose[d.kind] ?? 0) + 1;
  return animalList(loose);
}

function missionTitles(w: World, kind: AnimalKind, loose: number, timeLeft: number): Titles {
  const left = w.looseCount;
  const spare = clock(Math.ceil(timeLeft));
  const outOfTroops = {
    title: 'Out of troops',
    detail: left ? `No troop is left that can dart, and there isn't money for another. Still loose: ${stillLoose(w)}.` : 'No troop is left that can dart.',
  };
  const ended = { title: 'Game ended early', detail: 'You ended the game before the job was done.' };
  const base: Titles = {
    secured: { title: '', detail: '' },
    timeUp: { title: '', detail: '' },
    noTroops: outOfTroops,
    noEngineers: {
      title: 'Out of Engineers',
      detail: `No Engineer is left to fix the substations, and there isn't money for another. ${w.fixedCount} of ${w.substations.length} fixed.`,
    },
    killed: { title: 'Too many animals killed', detail: `${w.animalsKilled} animals were killed in the fight. The park can't open without them.` },
    abandoned: ended,
    // Not reachable in mission levels.
    shutdown: outOfTroops,
    overrun: outOfTroops,
  };
  switch (w.level) {
    case 4: {
      const n = w.substations.length;
      const down = n - w.fixedCount;
      return {
        ...base,
        secured: {
          title: 'Power back on',
          detail: `All ${n} substations are fixed, with ${spare} to spare before dawn.${w.engineerSpotted ? '' : ' The raptors never saw the Engineer.'}`,
        },
        timeUp: { title: 'Dawn, and the park is still dark', detail: `${down} of ${n} substations ${down === 1 ? 'is' : 'are'} still broken.` },
        noEngineers: { title: 'The Engineer is down', detail: `Nobody else can fix the substations. ${w.fixedCount} of ${n} fixed.` },
        abandoned: { title: 'Game ended early', detail: 'You ended the game before the power was back.' },
      };
    }
    case 5:
      return {
        ...base,
        secured: {
          title: 'The fight is over',
          detail: w.animalsKilled
            ? `Every animal is darted, with ${spare} to spare. ${w.animalsKilled} ${w.animalsKilled === 1 ? 'was' : 'were'} killed.`
            : `Every animal is darted and alive, with ${spare} to spare.`,
        },
        timeUp: { title: 'The park opened mid-fight', detail: `Still loose when the gates opened: ${stillLoose(w)}.` },
        abandoned: { title: 'Game ended early', detail: 'You ended the game before the fight was over.' },
      };
    default: {
      const nest = !!w.nest;
      return {
        ...base,
        secured: nest
          ? { title: 'The nest is clear', detail: `All ${loose} raptors are back in their pens with ${spare} to spare.` }
          : { title: `Every ${animalNoun(kind, 1)} is back`, detail: `All ${loose} are back in their ${PEN_WORD[kind]} with ${spare} to spare.` },
        timeUp: {
          title: `The park opened with ${animalNoun(kind, 2)} loose`,
          detail: `${left} ${left === 1 ? 'was' : 'were'} still loose when the gates opened.`,
        },
        noTroops: {
          title: 'Out of troops',
          detail: `Every troop is gone, and there isn't enough money to train another. ${left} ${animalNoun(kind, left)} still loose.`,
        },
        abandoned: {
          title: 'Game ended early',
          detail: nest ? 'You ended the game before the nest was clear.' : `You ended the game before every ${animalNoun(kind, 1)} was back.`,
        },
      };
    }
  }
}

/** A mission level's tally, for its stars. */
export function missionTally(w: World): MissionTally {
  const timeLeft = w.mission ? Math.max(0, w.mission.timeLimitSeconds - w.phaseTime) : 0;
  return { spent: w.spending.troops, timeLeft, troopsLost: w.troopsLost, killed: w.animalsKilled, spotted: w.engineerSpotted };
}

export function buildResult(w: World, won: boolean, reason: EndReason): Result {
  const casualtyTotal = w.casualtyTotal;
  const s = w.spending;
  let stars: number;
  let mission: Result['mission'] = null;
  let titles: Titles;
  if (w.mission) {
    const counts = w.startedLoose;
    const kind = (Object.keys(counts)[0] as AnimalKind | undefined) ?? 'triceratops';
    const loose = Object.values(counts).reduce((a, n) => a + (n ?? 0), 0);
    const tally = missionTally(w);
    const [second, third] = missionGoalsMet(w.mission, tally);
    stars = countStars(won, second, third);
    mission = {
      kind,
      loose,
      returned: w.returned,
      timeLeft: tally.timeLeft,
      fixed: w.fixedCount,
      substations: w.substations.length,
      spotted: w.engineerSpotted,
      killed: w.animalsKilled,
      team: w.teamSize,
    };
    titles = missionTitles(w, kind, loose, tally.timeLeft);
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
    engineersLost: w.engineersLost,
    towersBuilt: w.towersBuilt,
    towersLost: w.towersLost,
    jeepsLost: w.jeepsLost,
    dinosSecured: w.dinosSecured,
    dinosContained: w.dinosContained,
    visitorsAtBlackout: w.visitorsAtBlackout,
    evacuatedBy: w.evacuatedBy,
    visitorsSafe: w.visitorsSafe,
    mission,
    log: w.log.map((e) => ({ ...e })),
  };
}

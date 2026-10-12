import { BLACKOUT, FIGHT, MISSIONS, SCORING, type LevelId, type MissionLevelId, type StarGoal } from '../config';
import { animalNoun, goalMet, type MissionTally, type Result } from '../core/report';
import type { Phase } from '../core/world';
import { looseAtStart } from './levels';

/**
 * The three star goals, worded once for the briefing, the pause menu, and the end screen.
 * Level 3: get every dinosaur back (the win), earn the revenue target, keep every guest alive.
 * Mission levels: the level's win, then its two goals (MissionConfig.stars): spending, time left,
 * no troops lost, no Engineer lost, or no animal killed.
 * No Phaser and no DOM here, so the wording can be tested.
 */

export interface GoalLine {
  name: string;
  /** How it is going, or how it went. */
  status: string;
  /** true: met. false: missed. null: not settled yet. */
  met: boolean | null;
  /** The star is earned. Only ever true on the end screen. */
  earned: boolean;
}

/** Why a goal can be met with its star still dark. */
export const STAR_RULE = 'You need the first star to earn the other two.';

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const clock = (s: number) => {
  const t = Math.max(0, Math.floor(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

export const goalName = {
  win: 'Get every dinosaur back',
  revenue: (target: number) => `Earn ${money(target)}`,
  safe: 'Keep every guest alive',
};

/** Short name of a mission level's first goal, the win. */
function winName(level: MissionLevelId): string {
  const cfg = MISSIONS[level];
  if (level === 4) return 'Power back on';
  if (level === 5) return 'Break up the fight';
  const { kind } = looseAtStart(level);
  return cfg.nest ? 'Clear the nest' : `Get every ${animalNoun(kind, 1)} back`;
}

/** Short name of a star goal. */
function starName(g: StarGoal): string {
  switch (g.type) {
    case 'spend':
      return `Spend ${money(g.max)} or less`;
    case 'timeLeft':
      return `Finish with ${clock(g.seconds)} left`;
    case 'noTroopsLost':
      return 'Lose no troops';
    case 'noneKilled':
      return 'No animal killed';
    case 'neverSpotted':
      return 'Never spotted';
  }
}

/** The full rule of a star goal, for the briefing. */
function starRule(g: StarGoal): string {
  switch (g.type) {
    case 'spend':
      return `Spend no more than ${money(g.max)} on troops.`;
    case 'timeLeft':
      return `Finish with ${clock(g.seconds)} or more left on the clock.`;
    case 'noTroopsLost':
      return 'Lose no troops.';
    case 'noneKilled':
      return 'Keep every animal alive.';
    case 'neverSpotted':
      return 'Keep the Engineer out of every raptor’s sight.';
  }
}

/** Short names for the goals of a mission level. */
export function missionGoalNames(level: MissionLevelId): [string, string, string] {
  const [a, b] = MISSIONS[level].stars;
  return [winName(level), starName(a), starName(b)];
}

/** The full rules, for the briefing. `target` is level 3's revenue target. */
export function goalRules(target: number, level: LevelId = 3): [string, string, string] {
  if (level !== 3) {
    const cfg = MISSIONS[level];
    const { kind, count } = looseAtStart(level);
    const opens = `before the park opens in ${clock(cfg.timeLimitSeconds)}`;
    const [a, b] = cfg.stars;
    let win: string;
    if (level === 4) win = `Fix all ${cfg.substations?.length ?? 0} substations before dawn, ${clock(cfg.timeLimitSeconds)} from now.`;
    else if (level === 5) win = `Dart every animal ${opens}. ${FIGHT.killLimit} animals killed loses the level.`;
    else win = cfg.nest ? `Clear the nest ${opens}: all ${count} raptors back in their pens.` : `Get all ${count} ${animalNoun(kind, count)} back ${opens}.`;
    return [win, starRule(a), starRule(b)];
  }
  return [
    `Get every dinosaur back. None can be loose ${clock(BLACKOUT.overrunSeconds)} after the power returns, and ${SCORING.casualtyLimit} guests killed shuts the park down.`,
    `Earn ${money(target)} from visitors, counting what they pay in the dark.`,
    'Keep every guest alive.',
  ];
}

export interface GoalsNowView {
  phase: Phase;
  loose: number;
  revenue: number;
  target: number;
  casualties: number;
  /** Mission levels. */
  level?: LevelId;
  spent?: number;
  timeLeft?: number;
  troopsLost?: number;
  killed?: number;
  /** Level 4: substations fixed, how many there are, and whether a raptor has seen the Engineer. */
  fixed?: number;
  substations?: number;
  spotted?: boolean;
}

/** How a star goal is going mid-level: met only once it can't change, missed once it can't come back. */
function starNow(g: StarGoal, t: MissionTally): GoalLine {
  const name = starName(g);
  switch (g.type) {
    case 'spend':
      return { name, status: `${money(t.spent)} spent so far`, met: t.spent > g.max ? false : null, earned: false };
    case 'timeLeft':
      return { name, status: `${clock(Math.ceil(t.timeLeft))} left now`, met: Math.ceil(t.timeLeft) < g.seconds ? false : null, earned: false };
    case 'noTroopsLost':
      return { name, status: t.troopsLost ? `${t.troopsLost} lost` : 'No troops lost so far', met: t.troopsLost ? false : null, earned: false };
    case 'noneKilled':
      return { name, status: t.killed ? `${t.killed} killed` : 'None killed so far', met: t.killed ? false : null, earned: false };
    case 'neverSpotted':
      return { name, status: t.spotted ? 'A raptor saw the Engineer' : 'Not seen so far', met: t.spotted ? false : null, earned: false };
  }
}

/** How each goal is going, for the pause menu. Nothing is settled until the end except a goal already missed or reached. */
export function goalsNow(v: GoalsNowView): GoalLine[] {
  const level = v.level ?? 3;
  if (level !== 3) {
    const cfg = MISSIONS[level];
    const [win] = missionGoalNames(level);
    const t: MissionTally = {
      spent: v.spent ?? 0,
      timeLeft: v.timeLeft ?? cfg.timeLimitSeconds,
      troopsLost: v.troopsLost ?? 0,
      killed: v.killed ?? 0,
      spotted: v.spotted ?? false,
    };
    const loose = v.loose ? `${v.loose} loose now` : 'None loose now';
    const status = level === 4 ? `${v.fixed ?? 0} of ${v.substations ?? 0} fixed` : loose;
    return [{ name: win, status, met: null, earned: false }, starNow(cfg.stars[0], t), starNow(cfg.stars[1], t)];
  }
  const dark = v.phase === 'blackout' || v.phase === 'restored';
  return [
    { name: goalName.win, status: dark ? (v.loose ? `${v.loose} loose now` : 'None loose now') : 'Comes after the blackout', met: null, earned: false },
    { name: goalName.revenue(v.target), status: `${money(v.revenue)} so far`, met: v.revenue >= v.target ? true : null, earned: false },
    { name: goalName.safe, status: v.casualties ? `${v.casualties} killed` : 'Nobody killed so far', met: v.casualties ? false : null, earned: false },
  ];
}

/** How a star goal went, for the end screen. Time left only counts on a win. */
function starAtEnd(g: StarGoal, t: MissionTally, won: boolean): GoalLine {
  const name = starName(g);
  const met = goalMet(g, t);
  switch (g.type) {
    case 'spend':
      return { name, status: `${money(t.spent)} spent`, met, earned: won && met };
    case 'timeLeft': {
      const ok = won && met;
      return { name, status: won ? `${clock(Math.ceil(t.timeLeft))} left` : 'Not finished', met: ok, earned: ok };
    }
    case 'noTroopsLost':
      return { name, status: t.troopsLost ? `${t.troopsLost} lost` : 'No troops lost', met, earned: won && met };
    case 'noneKilled':
      return { name, status: t.killed ? `${t.killed} killed` : 'None killed', met, earned: won && met };
    case 'neverSpotted':
      return { name, status: t.spotted ? 'A raptor saw the Engineer' : 'Never seen', met, earned: won && met };
  }
}

/** How each goal went, for the end screen. */
export function goalsAtEnd(r: Result): GoalLine[] {
  if (r.level !== 3 && r.mission) {
    const cfg = MISSIONS[r.level];
    const [win] = missionGoalNames(r.level);
    const m = r.mission;
    const t: MissionTally = { spent: r.spending.troops, timeLeft: m.timeLeft, troopsLost: r.troopsLost, killed: m.killed, spotted: m.spotted };
    let winStatus: string;
    if (r.won) {
      winStatus = r.level === 4 ? 'Every substation fixed' : r.level === 5 ? 'Every animal darted' : cfg.nest ? 'Every raptor is back' : `All ${m.loose} are back`;
    } else {
      winStatus =
        r.reason === 'timeUp'
          ? r.level === 4
            ? 'Not done by dawn'
            : 'Still loose when the park opened'
          : r.reason === 'noTroops'
            ? 'Ran out of troops'
            : r.reason === 'noEngineers'
              ? 'The Engineer was lost'
              : r.reason === 'killed'
                ? `${m.killed} animals killed`
                : 'You ended the game';
    }
    return [{ name: win, status: winStatus, met: r.won, earned: r.won }, starAtEnd(cfg.stars[0], t, r.won), starAtEnd(cfg.stars[1], t, r.won)];
  }
  const win = r.won
    ? 'Every dinosaur accounted for'
    : r.reason === 'shutdown'
      ? `Shut down at ${SCORING.casualtyLimit} deaths`
      : r.reason === 'overrun'
        ? `Still loose ${clock(BLACKOUT.overrunSeconds)} after the power came back`
        : 'You ended the game';
  const earned = r.revenue >= r.revenueTarget;
  const safe = r.casualtyTotal === 0;
  return [
    { name: goalName.win, status: win, met: r.won, earned: r.won },
    { name: goalName.revenue(r.revenueTarget), status: `${money(r.revenue)} earned`, met: earned, earned: r.won && earned },
    { name: goalName.safe, status: safe ? 'Nobody killed' : `${r.casualtyTotal} killed`, met: safe, earned: r.won && safe },
  ];
}

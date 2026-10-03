import { BLACKOUT, HUNTS, SCORING, type HuntLevelId, type LevelId } from '../config';
import { animalNoun, huntGoalsMet, type Result } from '../core/report';
import type { Phase } from '../core/world';
import { looseAtStart } from './levels';

/**
 * The three star goals, worded once for the briefing, the pause menu, and the end screen.
 * Level 3: get every dinosaur back (the win), earn the revenue target, keep every guest alive.
 * Levels 1 and 2: get the animals back before the park opens (the win), stay under a spending cap,
 * and finish with time to spare (level 1) or lose no troops (level 2).
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

/** Short names for the goals of level 1 or 2. */
export function huntGoalNames(level: HuntLevelId): [string, string, string] {
  const cfg = HUNTS[level];
  const { kind } = looseAtStart(level);
  const third = cfg.thirdStar.type === 'timeLeft' ? `Finish with ${clock(cfg.thirdStar.seconds)} left` : 'Lose no troops';
  return [cfg.nest ? 'Clear the nest' : `Get every ${animalNoun(kind, 1)} back`, `Spend ${money(cfg.spendStar)} or less`, third];
}

/** The full rules, for the briefing. `target` is level 3's revenue target. */
export function goalRules(target: number, level: LevelId = 3): [string, string, string] {
  if (level !== 3) {
    const cfg = HUNTS[level];
    const { kind, count } = looseAtStart(level);
    const opens = `before the park opens in ${clock(cfg.timeLimitSeconds)}`;
    return [
      cfg.nest ? `Clear the nest ${opens}: all ${count} raptors back in their pens.` : `Get all ${count} ${animalNoun(kind, count)} back ${opens}.`,
      `Spend no more than ${money(cfg.spendStar)} on troops.`,
      cfg.thirdStar.type === 'timeLeft' ? `Finish with ${clock(cfg.thirdStar.seconds)} or more left on the clock.` : 'Lose no troops.',
    ];
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
  /** Levels 1 and 2. */
  level?: LevelId;
  spent?: number;
  timeLeft?: number;
  troopsLost?: number;
}

/** How each goal is going, for the pause menu. Nothing is settled until the end except a goal already missed or reached. */
export function goalsNow(v: GoalsNowView): GoalLine[] {
  const level = v.level ?? 3;
  if (level !== 3) {
    const cfg = HUNTS[level];
    const [win, spend, third] = huntGoalNames(level);
    const spent = v.spent ?? 0;
    const lost = v.troopsLost ?? 0;
    const left = v.timeLeft ?? cfg.timeLimitSeconds;
    return [
      { name: win, status: v.loose ? `${v.loose} loose now` : 'None loose now', met: null, earned: false },
      { name: spend, status: `${money(spent)} spent so far`, met: spent > cfg.spendStar ? false : null, earned: false },
      cfg.thirdStar.type === 'timeLeft'
        ? { name: third, status: `${clock(Math.ceil(left))} left now`, met: Math.ceil(left) < cfg.thirdStar.seconds ? false : null, earned: false }
        : { name: third, status: lost ? `${lost} lost` : 'No troops lost so far', met: lost ? false : null, earned: false },
    ];
  }
  const dark = v.phase === 'blackout' || v.phase === 'restored';
  return [
    { name: goalName.win, status: dark ? (v.loose ? `${v.loose} loose now` : 'None loose now') : 'Comes after the blackout', met: null, earned: false },
    { name: goalName.revenue(v.target), status: `${money(v.revenue)} so far`, met: v.revenue >= v.target ? true : null, earned: false },
    { name: goalName.safe, status: v.casualties ? `${v.casualties} killed` : 'Nobody killed so far', met: v.casualties ? false : null, earned: false },
  ];
}

/** How each goal went, for the end screen. */
export function goalsAtEnd(r: Result): GoalLine[] {
  if (r.level !== 3 && r.hunt) {
    const cfg = HUNTS[r.level];
    const [win, spend, third] = huntGoalNames(r.level);
    const spent = r.spending.troops;
    const met = huntGoalsMet(cfg, spent, r.hunt.timeLeft, r.troopsLost);
    const winStatus = r.won
      ? cfg.nest
        ? 'Every raptor is back'
        : `All ${r.hunt.loose} are back`
      : r.reason === 'timeUp'
        ? 'Still loose when the park opened'
        : r.reason === 'noTroops'
          ? 'Ran out of troops'
          : 'You ended the game';
    // Time to spare only counts if every animal got back.
    const timeMet = r.won && met.third;
    return [
      { name: win, status: winStatus, met: r.won, earned: r.won },
      { name: spend, status: `${money(spent)} spent`, met: met.spend, earned: r.won && met.spend },
      cfg.thirdStar.type === 'timeLeft'
        ? { name: third, status: r.won ? `${clock(Math.ceil(r.hunt.timeLeft))} left` : 'Not finished', met: timeMet, earned: timeMet }
        : { name: third, status: r.troopsLost ? `${r.troopsLost} lost` : 'No troops lost', met: met.third, earned: r.won && met.third },
    ];
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

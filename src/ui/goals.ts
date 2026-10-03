import { BLACKOUT, SCORING } from '../config';
import type { Result } from '../core/report';
import type { Phase } from '../core/world';

/**
 * The three star goals, worded once for the briefing, the pause menu, and the end screen.
 * One star each: get every dinosaur back (the win), earn the revenue target, keep every guest alive.
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
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

export const goalName = {
  win: 'Get every dinosaur back',
  revenue: (target: number) => `Earn ${money(target)}`,
  safe: 'Keep every guest alive',
};

/** The full rules, for the briefing. */
export function goalRules(target: number): [string, string, string] {
  return [
    `Get every dinosaur back. None can be loose ${clock(BLACKOUT.overrunSeconds)} after the power returns, and ${SCORING.casualtyLimit} guests killed shuts the park down.`,
    `Earn ${money(target)} from visitors, counting what they pay in the dark.`,
    'Keep every guest alive.',
  ];
}

/** How each goal is going, for the pause menu. Nothing is settled until the end except a death or reaching the target. */
export function goalsNow(v: { phase: Phase; loose: number; revenue: number; target: number; casualties: number }): GoalLine[] {
  const dark = v.phase === 'blackout' || v.phase === 'restored';
  return [
    { name: goalName.win, status: dark ? (v.loose ? `${v.loose} loose now` : 'None loose now') : 'Comes after the blackout', met: null, earned: false },
    { name: goalName.revenue(v.target), status: `${money(v.revenue)} so far`, met: v.revenue >= v.target ? true : null, earned: false },
    { name: goalName.safe, status: v.casualties ? `${v.casualties} killed` : 'Nobody killed so far', met: v.casualties ? false : null, earned: false },
  ];
}

/** How each goal went, for the end screen. */
export function goalsAtEnd(r: Result): GoalLine[] {
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

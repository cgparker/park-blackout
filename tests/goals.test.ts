import { describe, expect, it } from 'vitest';
import { MISSIONS, SCORING, type StarGoal } from '../src/config';
import type { Result } from '../src/core/report';
import { goalRules, goalsAtEnd, goalsNow, STAR_RULE } from '../src/ui/goals';

const spendCap = (g: StarGoal) => (g.type === 'spend' ? g.max : 0);

function result(over: Partial<Result>): Result {
  return {
    level: 3,
    won: true,
    reason: 'secured',
    stars: 3,
    title: '',
    detail: '',
    revenue: 30000,
    blackoutRevenue: 0,
    revenueTarget: 20000,
    exhibits: [],
    spending: { exhibits: 0, paths: 0, reinforcement: 0, troops: 0, towers: 0, total: 0 },
    casualties: { raptor: 0, trex: 0, stampede: 0 },
    casualtyTotal: 0,
    troopsTrained: 0,
    troopsLost: 0,
    engineersLost: 0,
    towersBuilt: 0,
    towersLost: 0,
    jeepsLost: 0,
    dinosSecured: 0,
    dinosContained: 0,
    visitorsAtBlackout: 0,
    evacuatedBy: null,
    visitorsSafe: 0,
    mission: null,
    log: [],
    ...over,
  };
}

const summary = (lines: ReturnType<typeof goalsAtEnd>) => lines.map((g) => `${g.earned ? '★' : '☆'} ${g.name}: ${g.status} ${g.met === true ? 'met' : g.met === false ? 'missed' : 'open'}`);

describe('star goals', () => {
  it('the briefing states all three goals and how the stars depend on the first', () => {
    const [win, money, safe] = goalRules(20000);
    expect(win).toContain(`${SCORING.casualtyLimit} guests killed shuts the park down`);
    expect(money).toBe('Earn $20,000 from visitors, counting what they pay in the dark.');
    expect(safe).toBe('Keep every guest alive.');
    expect(STAR_RULE).toBe('You need the first star to earn the other two.');
  });

  it('a win earns a star for each goal it met', () => {
    expect(summary(goalsAtEnd(result({ revenue: 38300, casualtyTotal: 0 })))).toEqual([
      '★ Get every dinosaur back: Every dinosaur accounted for met',
      '★ Earn $20,000: $38,300 earned met',
      '★ Keep every guest alive: Nobody killed met',
    ]);
    expect(summary(goalsAtEnd(result({ revenue: 15000, casualtyTotal: 2 })))).toEqual([
      '★ Get every dinosaur back: Every dinosaur accounted for met',
      '☆ Earn $20,000: $15,000 earned missed',
      '☆ Keep every guest alive: 2 killed missed',
    ]);
  });

  it('a loss lights no stars, even for goals it met', () => {
    const lines = goalsAtEnd(result({ won: false, reason: 'overrun', stars: 0, revenue: 30000 }));
    expect(summary(lines)).toEqual([
      '☆ Get every dinosaur back: Still loose 3:00 after the power came back missed',
      '☆ Earn $20,000: $30,000 earned met',
      '☆ Keep every guest alive: Nobody killed met',
    ]);
    expect(goalsAtEnd(result({ won: false, reason: 'shutdown', casualtyTotal: 8 }))[0].status).toBe(`Shut down at ${SCORING.casualtyLimit} deaths`);
    expect(goalsAtEnd(result({ won: false, reason: 'abandoned' }))[0].status).toBe('You ended the game');
  });

  it('the pause menu shows progress and settles only what cannot change', () => {
    const before = goalsNow({ phase: 'build', loose: 0, revenue: 5950, target: 20000, casualties: 0 });
    expect(before.map((g) => [g.status, g.met])).toEqual([
      ['Comes after the blackout', null],
      ['$5,950 so far', null],
      ['Nobody killed so far', null],
    ]);
    const during = goalsNow({ phase: 'blackout', loose: 4, revenue: 21000, target: 20000, casualties: 1 });
    expect(during.map((g) => [g.status, g.met])).toEqual([
      ['4 loose now', null],
      ['$21,000 so far', true],
      ['1 killed', false],
    ]);
    expect(during.every((g) => !g.earned)).toBe(true);
  });
});

describe('star goals in levels 1 and 2', () => {
  const hunt = (level: 1 | 2, over: Partial<Result> & { timeLeft?: number }): Result => {
    const { timeLeft = 90, ...rest } = over;
    return result({
      level,
      revenue: 0,
      revenueTarget: 0,
      mission: { kind: level === 1 ? 'triceratops' : 'raptor', loose: 6, returned: 6, timeLeft, fixed: 0, substations: 0, spotted: false, killed: 0, team: 0 },
      ...rest,
    });
  };
  const spent = (troops: number) => ({ exhibits: 0, paths: 0, reinforcement: 0, troops, towers: 0, total: troops });

  it('the briefing states each level’s goals', () => {
    expect(goalRules(0, 1)).toEqual([
      'Get all 6 Triceratops back before the park opens in 2:30.',
      `Spend no more than $${spendCap(MISSIONS[1].stars[0]).toLocaleString('en-US')} on troops.`,
      'Finish with 1:00 or more left on the clock.',
    ]);
    expect(goalRules(0, 2)).toEqual([
      'Clear the nest before the park opens in 4:00: all 6 raptors back in their pens.',
      `Spend no more than $${spendCap(MISSIONS[2].stars[0]).toLocaleString('en-US')} on troops.`,
      'Lose no troops.',
    ]);
  });

  it('the pause menu marks spending past the cap and time below the mark as missed', () => {
    const cap = spendCap(MISSIONS[1].stars[0]);
    const now = goalsNow({ phase: 'mission', loose: 4, revenue: 0, target: 0, casualties: 0, level: 1, spent: cap + 2250, timeLeft: 59.2, troopsLost: 0 });
    expect(now.map((g) => [g.name, g.status, g.met])).toEqual([
      ['Get every Triceratops back', '4 loose now', null],
      [`Spend $${cap.toLocaleString('en-US')} or less`, `$${(cap + 2250).toLocaleString('en-US')} spent so far`, false],
      ['Finish with 1:00 left', '1:00 left now', null],
    ]);
    // The clock rounds up, so 1:00 still shows until it ticks to 0:59.
    expect(goalsNow({ phase: 'mission', loose: 4, revenue: 0, target: 0, casualties: 0, level: 1, spent: 0, timeLeft: 58.9 })[2].met).toBe(false);
    const nest = goalsNow({ phase: 'mission', loose: 6, revenue: 0, target: 0, casualties: 0, level: 2, spent: 0, troopsLost: 2 });
    expect(nest.map((g) => [g.name, g.status, g.met])).toEqual([
      ['Clear the nest', '6 loose now', null],
      [`Spend $${spendCap(MISSIONS[2].stars[0]).toLocaleString('en-US')} or less`, '$0 spent so far', null],
      ['Lose no troops', '2 lost', false],
    ]);
  });

  it('the end screen marks each goal, and time to spare only counts on a win', () => {
    const cap = spendCap(MISSIONS[1].stars[0]);
    expect(summary(goalsAtEnd(hunt(1, { spending: spent(cap), timeLeft: 83.4 })))).toEqual([
      '★ Get every Triceratops back: All 6 are back met',
      `★ Spend $${cap.toLocaleString('en-US')} or less: $${cap.toLocaleString('en-US')} spent met`,
      '★ Finish with 1:00 left: 1:24 left met',
    ]);
    expect(summary(goalsAtEnd(hunt(1, { won: false, reason: 'timeUp', stars: 0, spending: spent(2250), timeLeft: 0 })))).toEqual([
      '☆ Get every Triceratops back: Still loose when the park opened missed',
      '☆ Spend $4,500 or less: $2,250 spent met',
      '☆ Finish with 1:00 left: Not finished missed',
    ]);
    expect(summary(goalsAtEnd(hunt(2, { spending: spent(12000), troopsLost: 1 })))).toEqual([
      '★ Clear the nest: Every raptor is back met',
      '★ Spend $13,500 or less: $12,000 spent met',
      '☆ Lose no troops: 1 lost missed',
    ]);
    expect(goalsAtEnd(hunt(2, { won: false, reason: 'noTroops', stars: 0 }))[0].status).toBe('Ran out of troops');
  });
});

describe('star goals in levels 4 and 5', () => {
  const mission = (level: 4 | 5, over: Partial<Result> & { spotted?: boolean; killed?: number }): Result => {
    const { spotted = false, killed = 0, ...rest } = over;
    return result({
      level,
      revenue: 0,
      revenueTarget: 0,
      mission: { kind: 'raptor', loose: 2, returned: 0, timeLeft: 60, fixed: level === 4 ? 3 : 0, substations: level === 4 ? 3 : 0, spotted, killed, team: level === 4 ? 2 : 4 },
      ...rest,
    });
  };

  it('the briefing states each level’s goals', () => {
    expect(goalRules(0, 4)).toEqual(['Fix all 3 substations before dawn, 3:30 from now.', 'Lose no troops.', 'Keep the Engineer out of every raptor’s sight.']);
    expect(goalRules(0, 5)[2]).toBe('Keep every animal alive.');
  });

  it('the pause menu counts substations, and loses the third star once the Engineer is seen', () => {
    const now = goalsNow({ phase: 'mission', loose: 2, revenue: 0, target: 0, casualties: 0, level: 4, fixed: 1, substations: 3, troopsLost: 0, spotted: true });
    expect(now.map((g) => [g.name, g.status, g.met])).toEqual([
      ['Power back on', '1 of 3 fixed', null],
      ['Lose no troops', 'No troops lost so far', null],
      ['Never spotted', 'A raptor saw the Engineer', false],
    ]);
  });

  it('the end screen marks each goal', () => {
    expect(summary(goalsAtEnd(mission(4, { troopsLost: 1, stars: 2 })))).toEqual([
      '★ Power back on: Every substation fixed met',
      '☆ Lose no troops: 1 lost missed',
      '★ Never spotted: Never seen met',
    ]);
    expect(goalsAtEnd(mission(4, { won: false, reason: 'noEngineers', stars: 0, spotted: true }))[0].status).toBe('The Engineer was lost');
    expect(summary(goalsAtEnd(mission(5, { killed: 1, stars: 2 })))[2]).toBe('☆ No animal killed: 1 killed missed');
  });
});

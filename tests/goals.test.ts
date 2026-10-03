import { describe, expect, it } from 'vitest';
import { SCORING } from '../src/config';
import type { Result } from '../src/core/report';
import { goalRules, goalsAtEnd, goalsNow, STAR_RULE } from '../src/ui/goals';

function result(over: Partial<Result>): Result {
  return {
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
    towersBuilt: 0,
    towersLost: 0,
    dinosSecured: 0,
    dinosContained: 0,
    visitorsAtBlackout: 0,
    evacuatedBy: null,
    visitorsSafe: 0,
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

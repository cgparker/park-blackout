import { describe, expect, it } from 'vitest';
import { DINOS, FIGHT } from '../src/config';
import type { LogEntry } from '../src/core/log';
import type { Result } from '../src/core/report';
import { nextTime, timelineLines } from '../src/ui/timeline';

/** A finished game with nothing notable in it. Each test overrides what it needs. */
function result(over: Partial<Result> = {}): Result {
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

const pen = (kind: 'raptor' | 'trex' | 'pasture', reinforced = false) => ({ id: 1, kind, name: '', visits: 0, revenue: 0, reinforced });
const death = (t: number, over: Partial<Extract<LogEntry, { type: 'death' }>> = {}): LogEntry => ({
  t,
  type: 'death',
  cause: 'raptor',
  near: 'raptor',
  unguardedPen: false,
  ...over,
});

describe('end-screen timeline', () => {
  it('tells the story in short lines, grouping escapes and deaths that happen together', () => {
    const log: LogEntry[] = [
      { t: 0, type: 'blackout', inPark: 52 },
      { t: 14.2, type: 'escape', kind: 'trex', inPark: 45, evacuation: true },
      { t: 21.3, type: 'escape', kind: 'raptor', inPark: 6, evacuation: false },
      { t: 21.6, type: 'escape', kind: 'raptor', inPark: 6, evacuation: false },
      death(22.1, { unguardedPen: true }),
      death(23.9),
      death(24.5),
      { t: 25, type: 'lost', kind: 'heavy', by: 'trex', alone: true },
      death(26),
      { t: 31, type: 'parkEmpty' },
      { t: 48, type: 'allClear' },
      { t: 300, type: 'power', contained: 2 },
      { t: 300, type: 'end', reason: 'secured', loose: {} },
    ];
    const lines = timelineLines(log);
    expect(lines.map((l) => `${l.time} ${l.text}`)).toEqual([
      '0:00 The power is cut with 52 guests inside.',
      '0:14 The T. rex is out. The park evacuates with 45 guests inside.',
      '0:21 Raptors are out of 2 pens with 6 guests still inside.',
      '0:22 3 guests killed by raptors near an unguarded raptor pen.',
      '0:25 Heavy Team lost to the T. rex, caught alone.',
      '0:26 1 guest killed by raptors near a raptor pen.',
      '0:31 The park is empty.',
      '0:48 Every predator is secured.',
      '5:00 The power is back. 2 animals are contained.',
      '5:00 Every dinosaur is accounted for.',
    ]);
    expect(lines[3].tone).toBe('bad');
    expect(lines[4].tone).toBe('loss');
  });

  it('says what was still loose when the game ended', () => {
    const lines = timelineLines([
      { t: 0, type: 'blackout', inPark: 3 },
      { t: 480, type: 'end', reason: 'overrun', loose: { trex: 1, raptor: 2, triceratops: 1 } },
    ]);
    expect(lines.at(-1)?.text).toBe('The park is overrun. Still loose: the T. rex, 2 raptors, 1 Triceratops.');
    expect(timelineLines([{ t: 40, type: 'end', reason: 'abandoned', loose: {} }])[0].text).toBe('You ended the game.');
  });

  it('keeps long games short: the start, a count of what was left out, and the end', () => {
    const log: LogEntry[] = [{ t: 0, type: 'blackout', inPark: 60 }];
    for (let i = 0; i < 20; i++) log.push({ t: 20 + i * 10, type: 'lost', kind: 'tranq', by: i % 2 ? 'raptor' : 'trex', alone: false });
    log.push({ t: 480, type: 'end', reason: 'overrun', loose: { raptor: 1 } });
    const lines = timelineLines(log);
    expect(lines).toHaveLength(14);
    expect(lines[0].text).toBe('The power is cut with 60 guests inside.');
    expect(lines[12].text).toBe('9 more events');
    expect(lines[13].text).toBe('The park is overrun. Still loose: 1 raptor.');
  });

  it('uses no dashes as punctuation', () => {
    const log: LogEntry[] = [
      { t: 0, type: 'blackout', inPark: 1 },
      { t: 5, type: 'escape', kind: 'triceratops', inPark: 0, evacuation: false },
      death(6, { cause: 'stampede', near: 'pasture' }),
      death(7, { cause: 'trex', near: 'trex' }),
      { t: 8, type: 'lost', kind: 'tower', by: 'raptor', alone: false },
      { t: 8.5, type: 'lost', kind: 'tranq', by: 'raptor', alone: false },
      { t: 9, type: 'end', reason: 'shutdown', loose: { raptor: 1 } },
    ];
    const texts = timelineLines(log).map((l) => l.text);
    // The evacuation starts with nobody left to evacuate: say so plainly.
    expect(timelineLines([{ t: 28, type: 'escape', kind: 'raptor', inPark: 0, evacuation: true }])[0].text).toBe('Raptors are out. The guests are already gone.');
    for (const t of texts) expect(t).not.toMatch(/[\u2013\u2014]|\s--\s/);
    expect(texts).toContain('Triceratops are out. The guests are already gone.');
    expect(texts).toContain('1 troop and a tower lost to raptors.');
  });
});

describe('next time', () => {
  it('a park without a T. rex: raptors meet a full park', () => {
    const r = result({ evacuatedBy: 'raptor', exhibits: [pen('raptor')], log: [death(22)], casualtyTotal: 1, stars: 2 });
    expect(nextTime(r)).toMatch(/^With no T. rex, the raptors are the first ones out/);
  });

  it('concrete on the T. rex let the raptors out first', () => {
    const r = result({ evacuatedBy: 'raptor', exhibits: [pen('raptor'), pen('trex', true)], log: [death(22)], casualtyTotal: 1 });
    expect(nextTime(r)).toMatch(/^The concrete held the T. rex in/);
  });

  it('deaths by an unguarded raptor pen: post troops there', () => {
    const r = result({ evacuatedBy: 'trex', exhibits: [pen('raptor'), pen('trex')], log: [death(22, { unguardedPen: true })], casualtyTotal: 1 });
    expect(nextTime(r)).toMatch(/^Guests died near an unguarded raptor pen/);
  });

  it('guests still inside when the raptors got out: buy them time', () => {
    const r = result({
      evacuatedBy: 'trex',
      exhibits: [pen('raptor'), pen('trex')],
      casualtyTotal: 1,
      log: [
        { t: 14.1, type: 'escape', kind: 'trex', inPark: 45, evacuation: true },
        { t: 21.4, type: 'escape', kind: 'raptor', inPark: 6, evacuation: false },
        death(22),
      ],
    });
    expect(nextTime(r)).toBe('The raptors got out 7 s after the evacuation began, with 6 guests still inside. Reinforce the raptor pens to give the guests more time.');
  });

  it('a troop caught alone by the T. rex, an overrun, and a short revenue each get their own advice', () => {
    expect(nextTime(result({ log: [{ t: 30, type: 'lost', kind: 'tranq', by: 'trex', alone: true }] }))).toMatch(/^The T. rex caught a troop on its own/);
    const overrun = result({ won: false, reason: 'overrun', log: [{ t: 480, type: 'end', reason: 'overrun', loose: { raptor: 2 } }] });
    expect(nextTime(overrun)).toBe('Still loose at the end: 2 raptors. Train more troops before the blackout, and keep them together.');
    expect(nextTime(result({ revenue: 15000, stars: 2 }))).toMatch(/^Revenue came in under \$20,000, so no revenue star\./);
  });

  it('a clean game needs no advice', () => {
    expect(nextTime(result())).toBeNull();
  });
});

describe('levels 1 and 2: timeline and next time', () => {
  const DASH = new RegExp('[' + String.fromCharCode(0x2013, 0x2014) + ']|\\s--\\s');
  const back = (t: number, left: number, how: 'darted' | 'walked' = 'darted', kind: 'triceratops' | 'raptor' = 'triceratops'): LogEntry => ({ t, type: 'back', kind, how, left });
  const spent = (troops: number) => ({ exhibits: 0, paths: 0, reinforcement: 0, troops, towers: 0, total: troops });
  const hunt = (level: 1 | 2, over: Partial<Result> & { timeLeft?: number }): Result => {
    const { timeLeft = 90, ...rest } = over;
    return result({ level, revenue: 0, revenueTarget: 0, mission: { kind: level === 1 ? 'triceratops' : 'raptor', loose: 6, returned: 6, timeLeft, fixed: 0, substations: 0, spotted: false, killed: 0, team: 0 }, ...rest });
  };

  it('tells a roundup: what was loose, each one back, and the end', () => {
    const log: LogEntry[] = [
      { t: 0, type: 'start', loose: { triceratops: 6 }, nest: false, substations: 0, fight: false, stealth: false },
      back(21.5, 5),
      back(22.8, 4),
      back(40, 3, 'walked'),
      back(55, 2),
      back(70, 1),
      back(81, 0),
      { t: 81, type: 'end', reason: 'secured', loose: {} },
    ];
    expect(timelineLines(log).map((l) => `${l.time} ${l.text}`)).toEqual([
      '0:00 6 Triceratops are loose in the park.',
      '0:21 2 Triceratops darted. 4 to go.',
      '0:40 A Triceratops walked back into its pasture. 3 to go.',
      '0:55 Triceratops darted. 2 to go.',
      '1:10 Triceratops darted. 1 to go.',
      '1:21 Triceratops darted.',
      '1:21 Every Triceratops is back.',
    ]);
  });

  it('tells a nest fight, and how a level ends without a win', () => {
    const start: LogEntry = { t: 0, type: 'start', loose: { raptor: 6 }, nest: true, substations: 0, fight: false, stealth: false };
    const lines = timelineLines([
      start,
      { t: 30, type: 'lost', kind: 'tranq', by: 'raptor', alone: true },
      back(33, 5, 'darted', 'raptor'),
      { t: 60, type: 'end', reason: 'secured', loose: {} },
    ]);
    expect(lines.map((l) => l.text)).toEqual(['6 raptors are guarding a nest.', 'Tranq Squad lost to raptors.', 'Raptor darted. 5 to go.', 'The nest is clear.']);
    expect(timelineLines([start, { t: 240, type: 'end', reason: 'timeUp', loose: { raptor: 2 } }])[1].text).toBe('The park opens. Still loose: 2 raptors.');
    expect(timelineLines([start, { t: 90, type: 'end', reason: 'noTroops', loose: { raptor: 3 } }])[1].text).toBe('No troops left, and no money for more. Still loose: 3 raptors.');
  });

  it('level 1 advice: more squads, cornering, or spending less', () => {
    expect(nextTime(hunt(1, { won: false, reason: 'timeUp', troopsTrained: 1, timeLeft: 0 }))).toMatch(/^One squad is too slow\./);
    expect(nextTime(hunt(1, { won: false, reason: 'timeUp', troopsTrained: 3, timeLeft: 0 }))).toMatch(/^Triceratops run straight away from the nearest troop\./);
    expect(nextTime(hunt(1, { spending: spent(6750) }))).toBe('Two squads are enough if each one goes after a different Triceratops.');
    expect(nextTime(hunt(1, { spending: spent(4500), timeLeft: 40 }))).toBe('Train your squads at the start, and send each one after a different Triceratops.');
    expect(nextTime(hunt(1, { spending: spent(4500), timeLeft: 70 }))).toBeNull();
    expect(nextTime(hunt(1, { won: false, reason: 'abandoned' }))).toBeNull();
  });

  it('level 2 advice: go in together, bring more, or lead with Heavy Teams', () => {
    const lost = (alone: boolean): LogEntry => ({ t: 30, type: 'lost', kind: 'tranq', by: 'raptor', alone });
    expect(nextTime(hunt(2, { won: false, reason: 'noTroops', log: [lost(true), lost(true)] }))).toMatch(/^Raptors attack together, so troops that go in a few at a time get bitten down\./);
    expect(nextTime(hunt(2, { won: false, reason: 'timeUp', log: [lost(false), lost(false), lost(true)] }))).toMatch(/^Bring more troops\./);
    expect(nextTime(hunt(2, { won: false, reason: 'timeUp', log: [] }))).toMatch(/^Train your team right away/);
    expect(nextTime(hunt(2, { troopsLost: 2, log: [lost(false)] }))).toBe('Heavy Teams take 25 raptor bites. Two of them together often clear the nest without a loss.');
    expect(nextTime(hunt(2, { spending: spent(16500) }))).toBe('Two Heavy Teams together can clear the nest for $12,000.');
    expect(nextTime(hunt(2, { spending: spent(12000) }))).toBeNull();
  });

  it('uses no dashes as punctuation', () => {
    const texts = [
      ...timelineLines([{ t: 0, type: 'start', loose: { raptor: 6 }, nest: true, substations: 0, fight: false, stealth: false }, back(5, 5, 'walked', 'raptor'), { t: 9, type: 'end', reason: 'abandoned', loose: { raptor: 5 } }]).map((l) => l.text),
      nextTime(hunt(1, { won: false, reason: 'timeUp', troopsTrained: 1 })) ?? '',
      nextTime(hunt(2, { won: false, reason: 'noTroops', log: [{ t: 1, type: 'lost', kind: 'heavy', by: 'raptor', alone: true }] })) ?? '',
    ];
    for (const t of texts) expect(t).not.toMatch(DASH);
  });
});

describe('levels 4 and 5: timeline and next time', () => {
  const start4: LogEntry = { t: 0, type: 'start', loose: { raptor: 2 }, nest: false, substations: 3, fight: false, stealth: true };
  const level4 = (over: Partial<Result>): Result =>
    result({ level: 4, revenue: 0, revenueTarget: 0, mission: { kind: 'raptor', loose: 2, returned: 0, timeLeft: 60, fixed: 3, substations: 3, spotted: false, killed: 0, team: 2 }, ...over });

  it('tells a night of repairs: the patrols, each fix, a sighting, and the end', () => {
    const lines = timelineLines([
      start4,
      { t: 21, type: 'fixed', name: 'West', pens: ['raptor', 'pasture'], contained: 5, last: false },
      { t: 40, type: 'spotted', kind: 'tranq' },
      { t: 95, type: 'fixed', name: 'South', pens: ['raptor'], contained: 0, last: true },
      { t: 95, type: 'end', reason: 'secured', loose: { raptor: 1 } },
    ]).map((l) => l.text);
    expect(lines).toEqual([
      'The power is out at 3 substations. 2 raptors are on patrol.',
      'The west substation is fixed. The raptor pen and the pasture have power. 5 animals are contained.',
      'A raptor saw the Tranq Squad.',
      'The south substation is fixed. The raptor pen has power. The power is back everywhere.',
      'Every substation is fixed.',
    ]);
    expect(timelineLines([start4, { t: 60, type: 'end', reason: 'noEngineers', loose: { raptor: 2 } }]).at(-1)!.text).toBe('The Engineer is down. Nobody else can fix the substations.');
    expect(timelineLines([start4, { t: 210, type: 'end', reason: 'timeUp', loose: { raptor: 2 } }]).at(-1)!.text).toBe('Dawn, and the power is still out.');
  });

  it('tells a fight: the T. rex at the cage, the break-in, a death, a pen broken, each one darted, and the end', () => {
    const start5: LogEntry = { t: 0, type: 'start', loose: { trex: 1 }, nest: false, substations: 0, fight: true, stealth: false };
    const lines = timelineLines([
      start5,
      { t: 29, type: 'escape', kind: 'raptor', inPark: 0, evacuation: false, cage: true },
      { t: 38, type: 'killed', kind: 'raptor', by: 'trex' },
      { t: 62, type: 'escape', kind: 'raptor', inPark: 0, evacuation: false },
      { t: 70, type: 'back', kind: 'trex', how: 'darted', left: 0 },
      { t: 70, type: 'end', reason: 'secured', loose: {} },
    ]).map((l) => l.text);
    expect(lines.slice(0, 4)).toEqual([
      'The T. rex is going for the caged raptors.',
      'The T. rex broke into the raptor cage, and the fight is on.',
      'A raptor was killed by the T. rex.',
      'Raptors are out of their pen.',
    ]);
  });

  it('level 4 advice: the T. rex timer, the west raptors, the cones, then working out of sight', () => {
    const lostTo = (by: 'trex' | 'raptor'): LogEntry => ({ t: 112, type: 'lost', kind: 'engineer', by, alone: true });
    expect(nextTime(level4({ won: false, reason: 'noEngineers', log: [start4, lostTo('trex')] }))).toBe('Fix the north substation before 1:50, when the T. rex goes for its fence.');
    expect(nextTime(level4({ won: false, reason: 'noEngineers', log: [start4, { t: 61, type: 'escape', kind: 'raptor', inPark: 0, evacuation: false }, lostTo('raptor')] }))).toBe(
      'Fix the west substation first. Its raptors go for their fence at 1:00.',
    );
    expect(nextTime(level4({ won: false, reason: 'noEngineers', log: [start4, { t: 30, type: 'spotted', kind: 'engineer' }, lostTo('raptor')] }))).toMatch(/^Watch the cones on the ground .* When a cone turns orange/);
    expect(nextTime(level4({ log: [start4, { t: 30, type: 'spotted', kind: 'engineer' }] }))).toMatch(/^Watch a raptor go round once/);
    expect(nextTime(level4({ troopsLost: 1, log: [start4] }))).toMatch(/^A raptor that sees who darts it calls the other\. Dart one from behind/);
    expect(nextTime(level4({ log: [start4] }))).toBeNull();
  });

  it('level 5 advice: speed when animals die, the 4x4 decoy when the T. rex takes a troop, then raptor bites, then the most hurt raptor', () => {
    const level5 = (over: Partial<Result>): Result =>
      result({ level: 5, revenue: 0, revenueTarget: 0, mission: { kind: 'raptor', loose: 4, returned: 4, timeLeft: 150, fixed: 0, substations: 0, spotted: false, killed: 0, team: 4 }, ...over });
    const start5: LogEntry = { t: 0, type: 'start', loose: { trex: 1 }, nest: false, substations: 0, fight: true, stealth: false };
    const lost = (by: 'trex' | 'raptor'): LogEntry => ({ t: 20, type: 'lost', kind: 'tranq', by, alone: false });
    const every = Math.ceil(DINOS.raptor.health / FIGHT.trexBite) * FIGHT.trexBiteSeconds;
    expect(nextTime(level5({ won: false, reason: 'killed', mission: { kind: 'raptor', loose: 4, returned: 1, timeLeft: 100, fixed: 0, substations: 0, spotted: false, killed: 3, team: 4 }, log: [start5] }))).toBe(
      `Be in place before the cage gives way, with two Heavy Teams brought over in the 4x4: once it’s in, the T. rex kills a raptor every ${every} s.`,
    );
    expect(nextTime(level5({ troopsLost: 1, log: [start5, lost('trex')] }))).toMatch(/^When the T\. rex roars at a troop, load that troop in the 4x4 and keep driving around nearby/);
    expect(nextTime(level5({ troopsLost: 1, log: [start5, lost('raptor')] }))).toBe('A darted raptor comes for whoever darted it. Dart raptors with Heavy Teams, which last 25 bites.');
    expect(nextTime(level5({ mission: { kind: 'raptor', loose: 4, returned: 3, timeLeft: 150, fixed: 0, substations: 0, spotted: false, killed: 1, team: 4 }, log: [start5] }))).toMatch(/^The T\. rex always bites the most hurt raptor\./);
    expect(nextTime(level5({ log: [start5] }))).toBeNull();
  });
});

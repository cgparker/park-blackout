import { describe, expect, it } from 'vitest';
import type { LogEntry } from '../src/core/log';
import type { Result } from '../src/core/report';
import { nextTime, timelineLines } from '../src/ui/timeline';

/** A finished game with nothing notable in it. Each test overrides what it needs. */
function result(over: Partial<Result> = {}): Result {
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

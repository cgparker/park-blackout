import { describe, expect, it } from 'vitest';
import { readParams } from '../src/params';
import { briefingFor, LEVEL_INFO, looseAtStart } from '../src/ui/levels';

const DASH = new RegExp('[' + String.fromCharCode(0x2013, 0x2014) + ']|\\s--\\s');

describe('level briefings', () => {
  it('each level says what it is and how to play it', () => {
    expect(Object.values(LEVEL_INFO).map((l) => l.name)).toEqual(['Roundup', 'Raptor Nest', 'Blackout', 'Grid Down', 'Showdown']);
    expect(looseAtStart(1)).toEqual({ kind: 'triceratops', count: 6, counts: { triceratops: 6 } });
    expect(looseAtStart(2)).toEqual({ kind: 'raptor', count: 6, counts: { raptor: 6 } });
    expect(looseAtStart(4)).toEqual({ kind: 'raptor', count: 2, counts: { raptor: 2 } });
    expect(looseAtStart(5)).toEqual({ kind: 'trex', count: 4, counts: { trex: 1, raptor: 3 } });
    const one = briefingFor(1, 300, 'Mantah Corp');
    expect(one.title).toBe('Round them up in 2:30');
    expect(one.intro).toMatch(/^Overnight, three pasture fences came down and 6 Triceratops wandered off\./);
    expect(one.controls[0]).toBe('Tap HQ to train Tranq Squads.');
    const two = briefingFor(2, 300, 'Mantah Corp');
    expect(two.title).toBe('Clear the nest in 4:00');
    expect(two.intro).toMatch(/^Two raptor pens broke open overnight, and their 6 raptors made a nest at the east end of the park\./);
    expect(briefingFor(3, 120, 'Mantah Corp').title).toBe('Lights out in 2:00');
    const four = briefingFor(4, 300, 'Mantah Corp');
    expect(four.title).toBe('Power back on by dawn');
    expect(four.intro).toMatch(/Mantah Corp wrecked the park’s three substations on the way out, and two raptors are on patrol\./);
    expect(four.intro).toMatch(/You have one Engineer and one Tranq Squad\. Fix all three substations before dawn, 3:30 away,/);
    expect(four.controls[0]).toBe('Tap the Engineer, then a substation, to fix it. Work done stays done.');
    expect(four.controls[1]).toMatch(/Rock, pens, and substations block it\.$/);
    const five = briefingFor(5, 300, 'Mantah Corp');
    expect(five.title).toBe('Break up the fight');
    expect(five.intro).toMatch(/You have 2 Heavy Teams, 2 Tranq Squads, and a Patrol 4x4\./);
    for (const b of [one, two, briefingFor(3, 300, 'Mantah Corp'), four, five]) {
      for (const text of [b.title, b.intro, ...b.controls]) expect(text).not.toMatch(DASH);
    }
  });

  it('the level can be set in the address, as a query or in the hash', () => {
    expect(readParams('?level=2', '').level).toBe(2);
    expect(readParams('?level=5', '').level).toBe(5);
    expect(readParams('', '#level-4').level).toBe(4);
    expect(readParams('', '#debug.level-1').level).toBe(1);
    expect(readParams('?level=7', '#level-9').level).toBeNull();
    expect(readParams('', '').level).toBeNull();
  });
});

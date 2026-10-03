import { describe, expect, it } from 'vitest';
import { readParams } from '../src/params';
import { briefingFor, LEVEL_INFO, looseAtStart } from '../src/ui/levels';

const DASH = new RegExp('[' + String.fromCharCode(0x2013, 0x2014) + ']|\\s--\\s');

describe('level briefings', () => {
  it('each level says what it is and how to play it', () => {
    expect(Object.values(LEVEL_INFO).map((l) => l.name)).toEqual(['Roundup', 'Raptor Nest', 'Blackout']);
    expect(looseAtStart(1)).toEqual({ kind: 'triceratops', count: 6 });
    expect(looseAtStart(2)).toEqual({ kind: 'raptor', count: 6 });
    const one = briefingFor(1, 300, 'Mantah Corp');
    expect(one.title).toBe('Round them up in 2:30');
    expect(one.intro).toMatch(/^Overnight, three pasture fences came down and 6 Triceratops wandered off\./);
    expect(one.controls[0]).toBe('Tap HQ to train Tranq Squads.');
    const two = briefingFor(2, 300, 'Mantah Corp');
    expect(two.title).toBe('Clear the nest in 4:00');
    expect(two.intro).toMatch(/^Two raptor pens broke open overnight, and their 6 raptors made a nest at the east end of the park\./);
    expect(briefingFor(3, 120, 'Mantah Corp').title).toBe('Lights out in 2:00');
    for (const b of [one, two, briefingFor(3, 300, 'Mantah Corp')]) {
      for (const text of [b.title, b.intro, ...b.controls]) expect(text).not.toMatch(DASH);
    }
  });

  it('the level can be set in the address, as a query or in the hash', () => {
    expect(readParams('?level=2', '').level).toBe(2);
    expect(readParams('', '#debug.level-1').level).toBe(1);
    expect(readParams('?level=7', '#level-9').level).toBeNull();
    expect(readParams('', '').level).toBeNull();
  });
});

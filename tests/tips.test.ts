import { describe, expect, it } from 'vitest';
import { MAP, TIPS, type ExhibitKind } from '../src/config';
import { footprintCenter } from '../src/core/exhibit';
import { planPlacement } from '../src/core/placement';
import { spawnUnit } from '../src/core/units';
import { World } from '../src/core/world';
import { tipsFor } from '../src/ui/tips';

const T = MAP.tileSize;
const RICH = 1_000_000;

function place(w: World, kind: ExhibitKind, x: number, y: number) {
  const plan = planPlacement(w.grid, kind, x, y, w.money, w.countOf(kind));
  if (!plan.valid) throw new Error(`Can't place ${kind} at ${x},${y}: ${plan.reason}`);
  return w.build(plan);
}

const ids = (tips: { id: string }[]) => tips.map((t) => t.id);

describe('tips', () => {
  it('building a raptor pen or the T. rex brings up its tip; a pasture does not', () => {
    const w = new World({ seed: 1, startingMoney: RICH });
    place(w, 'pasture', 6, 3);
    expect(tipsFor(w, w.events)).toEqual([]);
    w.events = [];
    place(w, 'raptor', 9, 11);
    const raptor = tipsFor(w, w.events);
    expect(ids(raptor)).toEqual(['raptorPen']);
    expect(raptor[0].focus).not.toBeNull();
    w.events = [];
    place(w, 'trex', 20, 16);
    expect(ids(tipsFor(w, w.events))).toEqual(['trex']);
  });

  it('the 1:00 warning explains the evacuation, then flags raptor pens with no troops nearby', () => {
    const w = new World({ seed: 2, startingMoney: RICH });
    const a = place(w, 'raptor', 9, 11);
    place(w, 'raptor', 30, 9);
    const warning = [{ type: 'warning' as const, secondsLeft: 60 }];
    const both = tipsFor(w, warning);
    expect(ids(both)).toEqual(['evacuation', 'unguarded']);
    expect(both[1].title).toBe('2 raptor pens are unguarded');

    const c = footprintCenter(a.footprint, T);
    spawnUnit(w, 'tranq', { x: c.x + 3 * T, y: c.y });
    const one = tipsFor(w, warning);
    expect(one[1].title).toBe('A raptor pen is unguarded');
  });

  it('a park of pastures gets no evacuation tip: Triceratops never break out on their own', () => {
    const w = new World({ seed: 6, startingMoney: RICH });
    place(w, 'pasture', 6, 3);
    const warning = [{ type: 'warning' as const, secondsLeft: 60 }];
    expect(tipsFor(w, warning)).toEqual([]);
    place(w, 'trex', 20, 16);
    expect(ids(tipsFor(w, warning))).toEqual(['evacuation']);
  });

  it('a raptor kill beside an unguarded pen explains itself; a guarded pen stays quiet', () => {
    const w = new World({ seed: 3, startingMoney: RICH });
    const pen = place(w, 'raptor', 9, 11);
    const c = footprintCenter(pen.footprint, T);
    const kill = (cause: 'raptor' | 'trex') => [{ type: 'casualty' as const, x: c.x + T, y: c.y + 3 * T, cause }];
    expect(ids(tipsFor(w, kill('raptor')))).toEqual(['raptorKills']);
    expect(tipsFor(w, kill('trex'))).toEqual([]);
    const far = [{ type: 'casualty' as const, x: c.x + (TIPS.killNearPenTiles + 2) * T, y: c.y, cause: 'raptor' as const }];
    expect(tipsFor(w, far)).toEqual([]);
    spawnUnit(w, 'heavy', { x: c.x, y: c.y + 3 * T });
    expect(tipsFor(w, kill('raptor'))).toEqual([]);
  });

  it('a troop the T. rex kills on its own brings up the loner tip', () => {
    const w = new World({ seed: 4, startingMoney: RICH });
    const at = { x: 20.5 * T, y: 20.5 * T };
    const lost = (by: 'trex' | 'raptor', kind: 'tranq' | 'tower' = 'tranq') => [{ type: 'unitLost' as const, unitId: 999, kind, ...at, by }];
    expect(ids(tipsFor(w, lost('trex')))).toEqual(['trexLoner']);
    expect(tipsFor(w, lost('raptor'))).toEqual([]);
    expect(tipsFor(w, lost('trex', 'tower'))).toEqual([]);
    spawnUnit(w, 'tranq', { x: at.x + T, y: at.y });
    expect(ids(tipsFor(w, lost('trex')))).toEqual(['trexLoner']);
    spawnUnit(w, 'tranq', { x: at.x - T, y: at.y });
    expect(tipsFor(w, lost('trex'))).toEqual([]);
  });

  it('tip text stays plain: no dashes used as punctuation', () => {
    const w = new World({ seed: 5, startingMoney: RICH });
    place(w, 'raptor', 9, 11);
    place(w, 'trex', 20, 16);
    const all = [
      ...tipsFor(w, w.events),
      ...tipsFor(w, [{ type: 'warning', secondsLeft: 60 }]),
      ...tipsFor(w, [{ type: 'casualty', x: 9 * T, y: 13 * T, cause: 'raptor' }]),
      ...tipsFor(w, [{ type: 'unitLost', unitId: 1, kind: 'heavy', x: 30 * T, y: 20 * T, by: 'trex' }]),
    ];
    expect(new Set(ids(all))).toEqual(new Set(['raptorPen', 'trex', 'evacuation', 'unguarded', 'raptorKills', 'trexLoner']));
    for (const t of all) expect(`${t.title} ${t.body}`).not.toMatch(/[\u2013\u2014]|\s--\s/);
  });
});

describe('tips in levels 1 and 2', () => {
  const DASH = new RegExp('[' + String.fromCharCode(0x2013, 0x2014) + ']|\\s--\\s');

  it('level 1 teaches training, sending a squad, and why Triceratops run', () => {
    const w = new World({ seed: 1, level: 1 });
    w.start();
    const start = tipsFor(w, w.events);
    expect(ids(start)).toEqual(['train']);
    expect(start[0].focus!.x).toBeLessThan(MAP.cols * T * 0.25);
    w.events = [];
    const u = spawnUnit(w, 'tranq', { x: 6.5 * T, y: 14.5 * T });
    expect(ids(tipsFor(w, w.events))).toEqual(['dart']);
    expect(tipsFor(w, w.events)[0].focus).toEqual({ x: u.x, y: u.y });
    expect(ids(tipsFor(w, [{ type: 'stampede', dinoId: 1, x: 0, y: 0, byTroop: true }]))).toEqual(['spooked']);
    expect(tipsFor(w, [{ type: 'stampede', dinoId: 1, x: 0, y: 0, byTroop: false }])).toEqual([]);
    // Level 3's tips stay out of it.
    expect(tipsFor(w, [{ type: 'warning', secondsLeft: 60 }])).toEqual([]);
  });

  it('level 2 explains the nest, and what raptors do to troops', () => {
    const w = new World({ seed: 1, level: 2 });
    w.start();
    const start = tipsFor(w, w.events);
    expect(ids(start)).toEqual(['nest']);
    expect(start[0].focus).toEqual(w.nest);
    expect(tipsFor(w, [{ type: 'trained', unitId: 1, kind: 'tranq' }])).toEqual([]);
    const lost = (by: 'raptor' | 'trex') => [{ type: 'unitLost' as const, unitId: 9, kind: 'tranq' as const, x: 30 * T, y: 16 * T, by }];
    const bites = tipsFor(w, lost('raptor'));
    expect(ids(bites)).toEqual(['raptorBites']);
    expect(bites[0].body).toContain('Heavy Teams have 250 HP, so they last 25 bites.');
    for (const t of [...start, ...bites]) expect(`${t.title} ${t.body}`).not.toMatch(DASH);
  });
});

describe('tips in levels 4 and 5', () => {
  const DASH = new RegExp('[' + String.fromCharCode(0x2013, 0x2014) + ']|\\s--\\s');

  it('level 4 teaches staying out of sight, the west substation first, and what being seen means', () => {
    const w = new World({ seed: 1, level: 4 });
    w.start();
    const start = tipsFor(w, w.events);
    expect(ids(start)).toEqual(['stealth', 'engineer']);
    expect(start[1].title).toBe('Fix the west substation');
    expect(start[1].body).toMatch(/Its raptors go for their fence at 1:00\.$/);
    const fixed = tipsFor(w, [{ type: 'substationFixed', id: w.substations[0].id, contained: 3, last: false }]);
    expect(ids(fixed)).toEqual(['powered']);
    const noticed = tipsFor(w, [{ type: 'noticed', dinoId: 1, unitId: 2, kind: 'engineer', x: 0, y: 0 }]);
    expect(noticed[0].title).toBe('A raptor noticed the Engineer');
    expect(noticed[0].body).toMatch(/before the ring fills.*costs the Engineer’s star\.$/);
    expect(tipsFor(w, [{ type: 'noticed', dinoId: 1, unitId: 3, kind: 'tranq', x: 0, y: 0 }])[0].body).not.toMatch(/star/);
    const seen = tipsFor(w, [{ type: 'spotted', dinoId: 1, unitId: 2, kind: 'engineer', x: 0, y: 0 }]);
    expect(seen[0].title).toBe('A raptor is after the Engineer');
    expect(ids(tipsFor(w, [{ type: 'unitLost', unitId: 3, kind: 'tranq', x: 0, y: 0, by: 'raptor' }]))).toEqual(['squadLost']);
    for (const t of [...start, ...fixed, ...noticed, ...seen]) expect(`${t.title} ${t.body}`).not.toMatch(DASH);
  });

  it('a raptor after a troop says whether it called the other: one darted by a troop it never saw comes alone', () => {
    const w = new World({ seed: 1, level: 4 });
    w.start();
    const squad = w.units.find((u) => u.kind === 'tranq')!;
    const [a, b] = w.dinos.filter((d) => d.kind === 'raptor' && d.state === 'loose');
    const ev = [{ type: 'spotted' as const, dinoId: a.id, unitId: squad.id, kind: 'tranq' as const, x: 0, y: 0 }];
    a.target = { type: 'unit', id: squad.id };
    expect(tipsFor(w, ev)[0].body).toMatch(/^It’s coming on its own\. A Tranq Squad can put down one raptor/);
    b.target = { type: 'unit', id: squad.id };
    expect(tipsFor(w, ev)[0].body).toMatch(/^It’s coming, and it called the other\. Two raptors are too many/);
    for (const t of tipsFor(w, ev)) expect(`${t.title} ${t.body}`).not.toMatch(DASH);
  });

  it('after the west substation, the tip points at the next pen on a timer', () => {
    const w = new World({ seed: 1, level: 4 });
    w.start();
    w.fixSubstation(w.substations[0]);
    const tip = tipsFor(w, w.events).find((t) => t.id === 'powered')!;
    expect(tip.body).toMatch(/Next, the north substation: its T\. rex goes for the fence at 1:50\.$/);
  });

  it('level 5 explains the fight and the 4x4, then a broken pen, a death, and the T. rex picking a target', () => {
    const w = new World({ seed: 1, level: 5 });
    w.start();
    const start = tipsFor(w, w.events);
    expect(ids(start)).toEqual(['fight', 'jeep']);
    expect(start[0].body).toMatch(/too busy for you while two or more raptors are on it/);
    expect(ids(tipsFor(w, [{ type: 'breach', exhibitId: 1, kind: 'raptor', x: 0, y: 0 }]))).toEqual(['penBroken']);
    expect(ids(tipsFor(w, [{ type: 'killed', dinoId: 1, kind: 'raptor', x: 0, y: 0, by: 'trex' }]))).toEqual(['killed']);
    // The roar, when it picks a troop, teaches the 4x4 decoy; the charge that follows has no tip of its own.
    const roar = tipsFor(w, [{ type: 'roar', dinoId: 1, unitId: 2, x: 0, y: 0 }]);
    expect(ids(roar)).toEqual(['jeepKite']);
    expect(roar[0].body).toMatch(/keep driving around nearby: the T\. rex chases the 4x4 instead/);
    expect(ids(tipsFor(w, [{ type: 'charge', dinoId: 1, x: 0, y: 0 }]))).toEqual([]);
    for (const t of [...start, ...roar]) expect(`${t.title} ${t.body}`).not.toMatch(DASH);
  });
});

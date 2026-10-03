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

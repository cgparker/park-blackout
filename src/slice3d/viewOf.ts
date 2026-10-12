// The world as the 3D view reads it. Live getters, so every frame sees the current lists.
import { STEALTH } from '../config';
import { repairProgress, substationCenter } from '../core/power';
import { preyOf, viewCone } from '../core/stealth';
import { workSite } from '../core/units';
import type { World } from '../core/world';
import type { ViewWorld } from '../render3d/View3D';

export function viewOf(w: World): ViewWorld {
  return {
    T: w.T,
    cols: w.grid.cols,
    rows: w.grid.rows,
    tileAt: (x, y) => w.grid.get(x, y),
    get exhibits() {
      return w.exhibits;
    },
    get dinos() {
      return w.dinos;
    },
    get units() {
      return w.units;
    },
    get guests() {
      return w.visitors;
    },
    hq: w.map.hq,
    gate: w.map.gate,
    nest: w.nest,
    get powerOn() {
      return w.powerOn;
    },
    get substations() {
      return w.substations.map((s) => ({ id: s.id, x: s.x, y: s.y, pens: s.pens, fixed: s.fixed, workers: s.workers, progress: repairProgress(s) }));
    },
    // Level 4: troops keep their flashlights off, since they are sneaking.
    stealth: !!w.mission?.stealth,
    // Every calm loose raptor shows what it sees; one on the hunt shows its prey instead. One in level 5's fight shows
    // neither: it isn't looking.
    get cones() {
      return w.dinos
        .filter((d) => d.kind === 'raptor' && d.state === 'loose' && d.target?.type !== 'dino')
        .map((d) => {
          const prey = preyOf(w, d.target);
          return {
            id: d.id,
            x: d.x,
            y: d.y,
            pts: prey ? [] : viewCone(w, d),
            prey: prey ? { x: prey.x, y: prey.y } : null,
            rush: !(d.target?.type === 'unit' && !d.rush),
            notice: d.notice / STEALTH.noticeSeconds,
          };
        });
    },
    get working() {
      const out = new Map<number, { x: number; y: number }>();
      for (const u of w.units) {
        const s = workSite(w, u);
        if (s) out.set(u.id, substationCenter(s, w.T));
      }
      return out;
    },
  };
}

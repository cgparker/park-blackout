// The world as the 3D view reads it. Live getters, so every frame sees the current lists.
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
  };
}


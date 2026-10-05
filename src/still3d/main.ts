// Renders one 3D frame for review: the level 3 moment from a saved snapshot (day or blackout),
// a sheet of fence states, or a troop lineup. Used by scripts to make comparison images.
import { buildSegments } from '../core/exhibit';
import { orderBoard, orderMove } from '../core/units';
import { World } from '../core/world';
import { viewOf } from '../slice3d/viewOf';
import { Tile, type TileType } from '../core/grid';
import type { DinoView, GuestView, UnitView } from '../render3d/actors';
import type { FenceExhibitView } from '../render3d/fences';
import { View3D, type Quality, type ViewWorld } from '../render3d/View3D';
import type { ExhibitKind, AnimalKind, UnitKind } from '../config';
import type { DinoState } from '../core/dinos';
import type { VisitorMode } from '../core/visitors';

interface SceneJson {
  tiles: string[];
  T: number;
  cols: number;
  rows: number;
  hq: { x: number; y: number; w: number; h: number };
  gate: { x: number; y: number };
  powerOn: boolean;
  camera: { cx: number; cy: number };
  exhibits: { id: number; kind: ExhibitKind; fp: { x: number; y: number; w: number; h: number }; spot: { x: number; y: number }; reinforced: boolean; segs: { x: number; y: number; hp: number; max: number; corner: boolean; nx: number; ny: number }[] }[];
  dinos: { kind: AnimalKind; x: number; y: number; facing: number; state: DinoState }[];
  units: { id: number; kind: UnitKind; x: number; y: number; facing: number; hp: number; max: number; selected: boolean }[];
  visitors: { x: number; y: number; mode: VisitorMode; i: number }[];
}

const Q = new URLSearchParams(location.hash.slice(1));
const num = (k: string, d: number) => (Q.has(k) ? Number(Q.get(k)) : d);
const mode = Q.get('mode') ?? 'day';
/** The game's own settings, 'low' or 'high', to see a frame as a phone draws it. 'still' adds ambient occlusion. */
const quality: Quality = Q.get('quality') === 'low' ? 'low' : Q.get('quality') === 'high' ? 'high' : 'still';
const CHARS: Record<string, TileType> = { g: Tile.Grass, p: Tile.Path, w: Tile.Water, r: Tile.Rock, e: Tile.Exhibit, G: Tile.Gate, h: Tile.HQ, t: Tile.Tower };

function fromJson(s: SceneJson, night: boolean): { world: ViewWorld; selected: Set<number>; cam: { x: number; z: number } } {
  const rnd = (i: number) => ((Math.sin(i * 12.9898) * 43758.5453) % 1 + 1) % 1;
  const exhibits = s.exhibits.map((e) => ({
    id: e.id,
    kind: e.kind,
    footprint: e.fp,
    viewingSpot: e.spot,
    reinforced: e.reinforced,
    segments: e.segs.map((g) => ({ x: g.x, y: g.y, hp: g.hp, maxHp: g.max, corner: g.corner, nx: g.nx, ny: g.ny })),
  }));
  const dinos: DinoView[] = s.dinos.map((d, i) => {
    let pose: string;
    if (d.state === 'loose') pose = 'Run';
    else if (d.kind === 'trex') pose = night ? 'Attack' : 'Walk';
    else pose = rnd(i) < 0.6 ? 'Idle' : 'Walk';
    return { id: 1000 + i, kind: d.kind, x: d.x, y: d.y, facing: d.facing, state: d.state, sedation: 0, fade: 0, cooldown: 0, pose, poseAt: d.kind === 'trex' && night ? 0.55 : rnd(i + 7) * 1.5 };
  });
  const units: UnitView[] = s.units.map((u, i) => ({
    id: u.id,
    kind: u.kind,
    x: u.x,
    y: u.y,
    facing: u.facing,
    hp: u.hp,
    maxHp: u.max,
    cooldown: 0,
    order: night ? 'attack' : 'idle',
    pose: u.kind === 'tower' ? undefined : night ? (i % 2 ? 'Gun_Shoot' : 'Idle_Gun_Pointing') : i % 2 ? 'Idle_Gun' : 'Idle_Gun_Pointing',
    poseAt: 0.2 + rnd(i) * 0.4,
  }));
  const exhibitCenter = (x: number, y: number) => {
    let best = 0;
    let bd = 1e9;
    for (const e of s.exhibits) {
      const cx = (e.fp.x + e.fp.w / 2) * s.T;
      const cy = (e.fp.y + e.fp.h / 2) * s.T;
      const d = Math.hypot(cx - x, cy - y);
      if (d < bd) {
        bd = d;
        best = Math.atan2(cy - y, cx - x);
      }
    }
    return best;
  };
  const guests: GuestView[] = s.visitors.map((v) => {
    const r = rnd(v.i + 3);
    let facing: number;
    let pose: string;
    if (v.mode === 'viewing') {
      facing = exhibitCenter(v.x, v.y) + (r - 0.5) * 0.8;
      pose = v.i % 3 === 0 ? 'Wave' : 'Idle';
    } else if (v.mode === 'leaving' || v.mode === 'fleeing') {
      facing = Math.PI + (r - 0.5) * 0.7;
      pose = v.mode === 'fleeing' ? 'Run' : 'Walk';
    } else {
      const vertical = Math.floor(v.x / s.T) === 9 && Math.floor(v.y / s.T) === 12;
      facing = (vertical ? (r < 0.5 ? Math.PI / 2 : -Math.PI / 2) : r < 0.5 ? 0 : Math.PI) + (r - 0.5) * 0.4;
      pose = 'Walk';
    }
    return { id: 5000 + v.i, x: v.x, y: v.y, facing, mode: v.mode, pose, poseAt: r * 1.5 };
  });
  const world: ViewWorld = {
    T: s.T,
    cols: s.cols,
    rows: s.rows,
    tileAt: (x, y) => CHARS[s.tiles[y]?.[x] ?? 'g'] ?? Tile.Grass,
    exhibits,
    dinos,
    units,
    guests,
    hq: s.hq,
    gate: s.gate,
    nest: null,
    powerOn: s.powerOn,
  };
  return { world, selected: new Set(s.units.filter((u) => u.selected).map((u) => u.id)), cam: { x: s.camera.cx / s.T, z: s.camera.cy / s.T + 0.4 } };
}

/** Six fences, standard on top and reinforced below, each with its front side going intact, dented, badly damaged, wrecked. */
function fenceSheet(): ViewWorld {
  const T = 40;
  const cols = 40;
  const rows = 24;
  const tiles: TileType[][] = Array.from({ length: rows }, () => Array<TileType>(cols).fill(Tile.Grass));
  const kinds: ExhibitKind[] = ['pasture', 'raptor', 'trex'];
  const exhibits: (FenceExhibitView & { viewingSpot: { x: number; y: number } })[] = [];
  let id = 1;
  for (let row = 0; row < 2; row++)
    kinds.forEach((kind, k) => {
      const fp = { x: 9 + k * 8, y: 4 + row * 9, w: 6, h: 6 };
      for (let y = fp.y; y < fp.y + fp.h; y++) for (let x = fp.x; x < fp.x + fp.w; x++) tiles[y][x] = Tile.Exhibit;
      const segs = buildSegments(fp).map((s) => ({ ...s }));
      const max = row ? 600 : 200;
      const front = segs.filter((s) => s.ny === 1 && !s.corner).sort((a, b) => a.x - b.x);
      for (const s of segs) {
        s.maxHp = max;
        s.hp = max;
      }
      const frac = [1, 0.5, 0.2, 0];
      front.forEach((s, i) => (s.hp = Math.round(max * frac[Math.min(i, 3)])));
      exhibits.push({ id: id++, kind, footprint: fp, segments: segs, reinforced: row === 1, viewingSpot: { x: fp.x - 1, y: fp.y + 2 } });
    });
  // Keep the ground in front of each fence open so close-ups see it.
  const clear = exhibits.map((e) => ({ x: e.footprint.x - 1, y: e.footprint.y + e.footprint.h - 0.2, w: e.footprint.w + 2, h: 3.4 }));
  return { T, cols, rows, tileAt: (x, y) => tiles[y]?.[x] ?? Tile.Grass, exhibits, dinos: [], units: [], guests: [], hq: { x: 2, y: 30, w: 3, h: 3 }, gate: { x: 0, y: 40 }, nest: null, powerOn: true, clear };
}

/** A Tranq Squad and a Heavy Team side by side, plus their kit, for a close look. With `crew`, the Engineer and the 4x4. */
function troopLineup(): ViewWorld {
  const T = 40;
  const units: UnitView[] = mode === 'crew'
    ? [
        { id: 1, kind: 'engineer', x: 19.3 * T, y: 12 * T, facing: Math.PI / 2 - 0.4, hp: 60, maxHp: 60, cooldown: 0, pose: 'Idle', poseAt: 0.3 },
        { id: 2, kind: 'engineer', x: 20.0 * T, y: 12.1 * T, facing: Math.PI / 2 + 0.4, hp: 60, maxHp: 60, cooldown: 0, pose: 'Interact', poseAt: 0.5 },
        { id: 10, kind: 'jeep', x: 21.6 * T, y: 12 * T, facing: Math.PI / 2 + 0.6, hp: 400, maxHp: 400, cooldown: 0 },
        { id: 3, kind: 'heavy', x: 21.6 * T, y: 12 * T, facing: 0, hp: 250, maxHp: 250, cooldown: 0, aboard: 10 },
        { id: 4, kind: 'tranq', x: 21.6 * T, y: 12 * T, facing: 0, hp: 100, maxHp: 100, cooldown: 0, aboard: 10 },
      ]
    : [
        { id: 1, kind: 'tranq', x: 19.2 * T, y: 12 * T, facing: Math.PI / 2 - 0.35, hp: 100, maxHp: 100, cooldown: 0, pose: 'Idle_Gun', poseAt: 0.3 },
        { id: 2, kind: 'tranq', x: 19.9 * T, y: 12.15 * T, facing: Math.PI / 2 + 0.25, hp: 100, maxHp: 100, cooldown: 0, pose: 'Idle_Gun_Pointing', poseAt: 0.6 },
        { id: 3, kind: 'heavy', x: 20.9 * T, y: 12 * T, facing: Math.PI / 2 - 0.3, hp: 250, maxHp: 250, cooldown: 0, pose: 'Idle_Gun_Pointing', poseAt: 0.4 },
        { id: 4, kind: 'heavy', x: 21.9 * T, y: 12.15 * T, facing: Math.PI / 2 + 0.3, hp: 250, maxHp: 250, cooldown: 0, pose: 'Gun_Shoot', poseAt: 0.2 },
      ];
  return { T, cols: 40, rows: 24, tileAt: () => Tile.Grass, exhibits: [], dinos: [], units, guests: [], hq: { x: 2, y: 30, w: 3, h: 3 }, gate: { x: 0, y: 40 }, nest: null, powerOn: true, clear: [{ x: 16, y: 9, w: 9, h: 6 }] };
}

async function main(): Promise<void> {
  const canvas = document.getElementById('c') as HTMLCanvasElement;
  const night = mode === 'night' || mode === 'level4' || Q.get('night') === '1';
  let world: ViewWorld;
  let selected = new Set<number>();
  let cam = { x: 20, z: 12 };
  let dist = num('dist', 25.5);
  if (mode === 'day' || mode === 'night') {
    const json = (await (await fetch(`stills/scene-${mode}.json`)).json()) as SceneJson;
    const r = fromJson(json, night);
    world = r.world;
    selected = r.selected;
    cam = r.cam;
  } else if (mode === 'level1' || mode === 'level2') {
    // A mission level as the slice starts it, a second in.
    const w = new World({ level: mode === 'level1' ? 1 : 2, seed: 7 });
    w.start();
    for (let i = 0; i < 60; i++) w.update(1 / 60);
    world = viewOf(w);
    cam = { x: 20, z: 12.5 };
    dist = num('dist', 34);
  } else if (mode === 'level4') {
    // Level 4 at night: the Engineer at the south substation, out of the raptor's sight, with the west one fixed.
    const w = new World({ level: 4, seed: 7 });
    w.start();
    w.fixSubstation(w.substations[0]);
    const e = w.units.find((u) => u.kind === 'engineer')!;
    const south = w.substations[2];
    e.x = (south.x - 0.5) * 40;
    e.y = (south.y + 0.5) * 40;
    for (let i = 0; i < 60 * num('t', 6); i++) w.update(1 / 60);
    world = viewOf(w);
    cam = { x: south.x + 1, z: south.y - 1 };
    dist = num('dist', 16);
  } else if (mode === 'level5') {
    // Level 5: two Heavy Teams in the 4x4 on the way to the fight.
    const w = new World({ level: 5, seed: 7 });
    w.start();
    const jeep = w.units.find((u) => u.kind === 'jeep')!;
    const heavies = w.units.filter((u) => u.kind === 'heavy').map((u) => u.id);
    orderBoard(w, heavies, jeep.id);
    for (let i = 0; i < 60 * 4; i++) w.update(1 / 60);
    orderMove(w, [jeep.id], 18 * 40, 12.5 * 40);
    for (let i = 0; i < 60 * num('t', 3); i++) w.update(1 / 60);
    world = viewOf(w);
    cam = { x: jeep.x / 40 + 3, z: jeep.y / 40 - 1 };
    dist = num('dist', 14);
  } else if (mode === 'fences') {
    world = fenceSheet();
    cam = { x: 20, z: 12.6 };
    dist = num('dist', 25);
  } else {
    world = troopLineup();
    cam = { x: 20.55, z: 12.05 };
    dist = num('dist', 4.2);
  }
  const view = new View3D(canvas, { base: '.', quality, night, guests: world.guests.length > 0 });
  await view.init(world);
  view.setSize(canvas.clientWidth, canvas.clientHeight);
  view.setRig(num('tx', cam.x), num('tz', cam.z), dist, num('el', 56));
  // A couple of darts in the air for the blackout moment.
  if (night && mode === 'night') {
    const loose = world.dinos.filter((d) => d.state === 'loose');
    const shots = world.units.filter((u) => u.kind !== 'tower').slice(0, 3);
    const events = shots.flatMap((u) => {
      const t = loose.slice().sort((a, b) => Math.hypot(a.x - u.x, a.y - u.y) - Math.hypot(b.x - u.x, b.y - u.y))[0];
      return t && Math.hypot(t.x - u.x, t.y - u.y) < 4 * world.T ? [{ type: 'dart' as const, x0: u.x, y0: u.y, x1: t.x, y1: t.y, heavy: u.kind === 'heavy' }] : [];
    });
    view.render(world, { selected }, 0.2);
    view.handle(events, world);
    view.render(world, { selected }, 0.05);
  } else {
    view.render(world, { selected }, 0.2);
  }
  view.renderer.info.autoReset = false;
  view.renderer.info.reset();
  view.render(world, { selected }, 0.016);
  const info = view.renderer.info;
  (window as unknown as { __stats: unknown }).__stats = { calls: info.render.calls, triangles: info.render.triangles, geometries: info.memory.geometries, textures: info.memory.textures, programs: info.programs?.length };
  info.autoReset = true;
  if (Q.get('census') === '1') (window as unknown as { __census: unknown }).__census = view.census();
  // Extra camera positions, each saved as its own image: shots=tx,tz,dist,el;tx,tz,dist,el
  const shots = (Q.get('shots') ?? '').split(';').filter(Boolean);
  if (shots.length) {
    const out: string[] = [];
    for (const shot of shots) {
      const [tx, tz, d, el] = shot.split(',').map(Number);
      view.setRig(tx, tz, d, el || 56);
      view.render(world, { selected }, 0.016);
      out.push(canvas.toDataURL('image/png'));
    }
    (window as unknown as { __shots: string[] }).__shots = out;
  }
  (window as unknown as { __view: View3D; __world: ViewWorld }).__view = view;
  (window as unknown as { __world: ViewWorld }).__world = world;
  (window as unknown as { __ready: boolean }).__ready = true;
}

main().catch((e) => {
  console.error(e);
  (window as unknown as { __error: string }).__error = String((e as Error)?.stack ?? e);
});

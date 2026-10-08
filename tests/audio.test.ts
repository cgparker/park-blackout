import { describe, expect, it } from 'vitest';
import { AUDIO, LEVEL_IDS, MAP, SOUNDS, type SoundId } from '../src/config';
import { ambienceFor, CueMaker, Gaps, leadIn, levelMusic, musicFor, pickFile, placeAt, type Cue, type Listener } from '../src/audio/cues';
import { engineLoop } from '../src/audio/engine';
import { FILES, type FileId } from '../src/audio/files';
import { SOUND_FILES } from '../src/audio/manifest';
import { planPlacement } from '../src/core/placement';
import { World, type GameEvent } from '../src/core/world';

const T = MAP.tileSize;
const ids = (cues: Cue[]) => cues.map((c) => c.id);

/** A view of the ground from (0,0) to (10,10), zoomed all the way in. */
const VIEW: Listener = { x0: 0, x1: 10, z0: 0, z1: 10, zoom: 0 };

describe('sound files', () => {
  it('every sound has files, every file is on disk, and every file on disk is listed and used', () => {
    const onDisk = Object.keys(import.meta.glob('../public3d/audio/*.mp3'))
      .map((p) => p.replace(/^.*\/(.*)\.mp3$/, '$1'))
      .sort();
    expect(onDisk).toEqual(Object.keys(FILES).sort());
    const used = new Set<string>(['music_day', 'music_chase', 'music_sneak', 'music_tension', 'amb_day', 'amb_night']);
    for (const id of Object.keys(SOUNDS) as SoundId[]) {
      expect(SOUND_FILES[id].length, id).toBeGreaterThan(0);
      for (const f of SOUND_FILES[id]) {
        expect(FILES[f], f).toBeDefined();
        used.add(f);
      }
    }
    expect([...used].sort()).toEqual(onDisk);
  });

  it('every level plays only music it loads ahead', () => {
    for (const level of LEVEL_IDS) {
      const w = new World({ seed: 1, level, buildPhaseSeconds: 5 });
      expect(musicFor(w)).toBeNull();
      w.start();
      const heard = new Set<string>();
      for (let i = 0; i < 60 * 40 && w.phase !== 'ended'; i++) {
        w.update(1 / 30);
        const m = musicFor(w);
        if (m) heard.add(m);
      }
      for (const m of heard) expect(levelMusic(level), `level ${level}`).toContain(m);
    }
  });
});

describe('music', () => {
  it('level 3 builds to a bright tune, runs once the power is cut, and calms once nothing is loose', () => {
    const w = new World({ seed: 1, buildPhaseSeconds: 5 });
    w.start();
    expect(musicFor(w)).toBe('music_day');
    w.startBlackout();
    expect(musicFor(w)).toBe('music_chase');
    w.restorePower();
    expect(w.looseCount).toBe(0);
    expect(musicFor(w)).toBe('music_day');
  });

  it('level 5 waits while the cage holds, and runs once it breaks', () => {
    const w = new World({ seed: 1, level: 5 });
    w.start();
    expect(musicFor(w)).toBe('music_tension');
    const cage = w.exhibits.find((e) => e.cage)!;
    cage.segments[0].hp = 0;
    expect(musicFor(w)).toBe('music_chase');
  });

  it('level 4 sneaks, and the night has crickets', () => {
    const w = new World({ seed: 1, level: 4 });
    w.start();
    expect(musicFor(w)).toBe('music_sneak');
    expect(ambienceFor(true)).toBe('amb_night');
    expect(ambienceFor(false)).toBe('amb_day');
  });
});

describe('placing sounds', () => {
  it('a sound on screen plays in full; off screen it fades to its floor', () => {
    expect(placeAt(VIEW, { x: 5, z: 5 }, 0).level).toBe(1);
    const half = placeAt(VIEW, { x: 10 + AUDIO.offscreenTiles / 2, z: 5 }, 0);
    expect(half.level).toBeCloseTo(0.5);
    expect(placeAt(VIEW, { x: 100, z: 5 }, 0).level).toBe(0);
    expect(placeAt(VIEW, { x: 100, z: 5 }, 0.4).level).toBe(0.4);
  });

  it('left is left, right is right, and zooming out turns things down', () => {
    expect(placeAt(VIEW, { x: 1, z: 5 }, 0).pan).toBeLessThan(0);
    expect(placeAt(VIEW, { x: 9, z: 5 }, 0).pan).toBeGreaterThan(0);
    expect(Math.abs(placeAt(VIEW, { x: 50, z: 5 }, 0).pan)).toBeCloseTo(AUDIO.panWidth);
    expect(placeAt({ ...VIEW, zoom: 1 }, { x: 5, z: 5 }, 0).level).toBeCloseTo(AUDIO.zoomedOut);
  });
});

describe('decoding', () => {
  const f: FileId = 'music_tension';
  const { samples, frames } = FILES[f];

  it('finds where the sound starts, whether or not the browser kept the MP3 lead-in', () => {
    expect(leadIn(f, samples, 44100)).toBe(0);
    expect(leadIn(f, frames * 1152, 44100)).toBe(1105);
    expect(leadIn(f, (frames + 1) * 1152, 44100)).toBe(1105 + 1152);
    const r = 48000 / 44100;
    expect(leadIn(f, Math.floor(samples * r), 48000)).toBe(0);
    expect(leadIn(f, Math.round(frames * 1152 * r), 48000)).toBe(Math.round(1105 * r));
    expect(leadIn(f, samples + 5000, 44100)).toBe(-1);
  });
});

describe('spacing', () => {
  it('drops a repeat sooner than its gap, and keeps other sounds apart from it', () => {
    const g = new Gaps();
    const gap = SOUNDS.coin.gap!;
    expect(g.pass('coin', 1)).toBe(true);
    expect(g.pass('coin', 1 + gap / 2)).toBe(false);
    expect(g.pass('build', 1 + gap / 2)).toBe(true);
    expect(g.pass('coin', 1 + gap * 1.01)).toBe(true);
  });

  it('never picks the file it played last when there are others', () => {
    const files = SOUND_FILES.raptorBite;
    let last: FileId | undefined;
    for (let i = 0; i < 50; i++) {
      const f = pickFile(files, last, Math.random);
      expect(f).not.toBe(last);
      last = f;
    }
    expect(pickFile(['coin'], 'coin', Math.random)).toBe('coin');
  });
});

describe('cues', () => {
  it('a fence sounds like what it is made of', () => {
    const w = new World({ seed: 1, startingMoney: 1_000_000 });
    const plan = planPlacement(w.grid, 'raptor', 9, 11, w.money, 0);
    const ex = w.build(plan);
    const hit = (): GameEvent => ({ type: 'fenceHit', exhibitId: ex.id, x: ex.footprint.x * T, y: ex.footprint.y * T });
    const c = new CueMaker(() => 0.5);
    expect(ids(c.cues(w, [hit()]))).toEqual(['fenceChain']);
    w.reinforce(ex.id);
    expect(ids(c.cues(w, [hit()]))).toEqual(['fenceConcrete']);
  });

  it('the T. rex hunts in silence outside level 5: no sound when it gets out or winds up to charge', () => {
    const w = new World({ seed: 1, level: 5 });
    w.start();
    const rex = w.dinos.find((d) => d.kind === 'trex')!;
    const raptor = w.dinos.find((d) => d.kind === 'raptor')!;
    const c = new CueMaker(() => 0.5);
    expect(c.cues(w, [{ type: 'escaped', dinoId: rex.id, kind: 'trex' }, { type: 'charge', dinoId: rex.id, x: rex.x, y: rex.y }])).toEqual([]);
    expect(ids(c.cues(w, [{ type: 'escaped', dinoId: raptor.id, kind: 'raptor' }]))).toEqual(['raptorCall']);
    expect(ids(c.cues(w, [{ type: 'roar', dinoId: rex.id, unitId: 0, x: rex.x, y: rex.y }]))).toEqual(['trexRoar']);
  });

  it('a bite sounds like whoever bit, and a T. rex mauling growls', () => {
    const w = new World({ seed: 1, level: 5 });
    w.start();
    const rex = w.dinos.find((d) => d.kind === 'trex')!;
    const raptor = w.dinos.find((d) => d.kind === 'raptor')!;
    const c = new CueMaker(() => 0.5);
    expect(ids(c.cues(w, [{ type: 'bite', x: rex.x + 20, y: rex.y }]))).toEqual(['trexBite']);
    expect(c.cues(w, [{ type: 'bite', x: -9999, y: -9999 }])).toEqual([]);
    expect(ids(c.cues(w, [{ type: 'maul', dinoId: rex.id, victimId: raptor.id, x: raptor.x, y: raptor.y }]))).toEqual(['trexGrowl', 'trexBite']);
    expect(ids(c.cues(w, [{ type: 'maul', dinoId: raptor.id, victimId: rex.id, x: rex.x, y: rex.y }]))).toEqual(['raptorBite']);
    raptor.state = 'loose';
    raptor.x = 30 * T;
    raptor.y = 2 * T;
    expect(ids(c.cues(w, [{ type: 'bite', x: raptor.x, y: raptor.y + 10 }]))).toEqual(['raptorBite']);
  });

  it('darts, the end of a level, and where each sound sits', () => {
    const w = new World({ seed: 1, level: 5 });
    const c = new CueMaker(() => 0.5);
    const out = c.cues(w, [
      { type: 'dart', x0: 4 * T, y0: 6 * T, x1: 0, y1: 0, heavy: true },
      { type: 'ended', won: true },
    ]);
    expect(out).toEqual([{ id: 'dartHeavy', at: { x: 4, z: 6 } }, { id: 'win' }]);
    expect(ids(c.cues(w, [{ type: 'ended', won: false }]))).toEqual(['lose']);
  });

  it('an Engineer at work makes a tool sound every so often, until the substation is fixed', () => {
    const w = new World({ seed: 1, level: 4 });
    w.start();
    const s = w.substations[0];
    const c = new CueMaker(() => 0);
    expect(c.cues(w, [])).toEqual([]);
    s.workers = 1;
    expect(ids(c.cues(w, []))).toEqual(['work']);
    expect(c.cues(w, [])).toEqual([]);
    w.time += AUDIO.workSeconds[0];
    expect(ids(c.cues(w, []))).toEqual(['work']);
    s.fixed = true;
    w.time += 10;
    expect(c.cues(w, [])).toEqual([]);
  });

  it('the 4x4 is heard while it drives, faster the faster it goes, and not when parked or held', () => {
    const w = new World({ seed: 1, level: 5 });
    w.start();
    const jeep = w.units.find((u) => u.kind === 'jeep')!;
    const c = new CueMaker(() => 0.5);
    expect(c.engine(w, false)).toBeNull();
    jeep.order = 'move';
    expect(c.engine(w, false)?.speed).toBe(0);
    w.time += 1;
    jeep.x += 105;
    const e = c.engine(w, false)!;
    expect(e.speed).toBeCloseTo(0.5);
    expect(e.x).toBeCloseTo(jeep.x / T);
    expect(c.engine(w, true)).toBeNull();
    jeep.order = 'idle';
    expect(c.engine(w, false)).toBeNull();
  });
});

describe('engine', () => {
  it('makes a second of sound that peaks at 0.9 and loops without a click', () => {
    for (const rate of [44100, 48000]) {
      const x = engineLoop(rate);
      expect(x.length).toBe(rate);
      let peak = 0;
      let step = 0;
      for (let i = 0; i < x.length; i++) {
        expect(Number.isFinite(x[i])).toBe(true);
        peak = Math.max(peak, Math.abs(x[i]));
        if (i) step = Math.max(step, Math.abs(x[i] - x[i - 1]));
      }
      expect(peak).toBeCloseTo(0.9);
      expect(Math.abs(x[0] - x[x.length - 1])).toBeLessThanOrEqual(step);
    }
  });
});

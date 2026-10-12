// What the 3D game should sound like, worked out from the world. No Web Audio in here, so all of it runs in tests;
// player.ts makes the sound. Like the renderers, it only reads the world.
import { AUDIO, SOUNDS, UNITS, type AnimalKind, type LevelId, type SoundId } from '../config';
import type { Rect } from '../core/grid';
import { engineRunning } from '../core/jeep';
import { substationCenter } from '../core/power';
import type { GameEvent, World } from '../core/world';
import { FILES, type FileId } from './files';
import type { AmbienceId, MusicId } from './manifest';

/** A point on the map, in tiles. */
export interface Spot {
  x: number;
  z: number;
}

/** A sound to play: at a spot on the map, or, without one, the same everywhere. */
export interface Cue {
  id: SoundId;
  at?: Spot;
}

/** The 4x4's engine while it runs: where it is, and how fast it's going (0 to 1). */
export interface EngineCue extends Spot {
  speed: number;
}

/** What the camera shows: the ground in view (tiles), and how far it's zoomed out (0 closest, 1 farthest). */
export interface Listener {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  zoom: number;
}

// ------------------------------------------------------------------ music

/** The music a level can play, so the game loads it ahead of time and lets the rest go. */
export function levelMusic(level: LevelId): MusicId[] {
  switch (level) {
    case 1:
      return ['music_roundup'];
    case 2:
      return ['music_tension'];
    case 3:
      return ['music_day', 'music_chase'];
    case 4:
      return ['music_sneak'];
    case 5:
      return ['music_tension', 'music_chase'];
  }
}

/**
 * The music for this moment. Level 1 is a race against the clock to round them up. Level 2 creeps up on a nest.
 * Level 3 builds to a bright tune and runs for it once the power is cut, until nothing is loose. Level 4 sneaks.
 * Level 5 waits while the T. rex works on the cage, and runs once the fight is on. Nothing plays on the briefing or
 * after the end.
 */
export function musicFor(w: World): MusicId | null {
  if (w.phase === 'briefing' || w.phase === 'ended') return null;
  switch (w.level) {
    case 1:
      return 'music_roundup';
    case 2:
      return 'music_tension';
    case 3:
      if (w.phase === 'build') return 'music_day';
      if (w.phase === 'blackout') return 'music_chase';
      return w.looseCount > 0 ? 'music_chase' : 'music_day';
    case 4:
      return 'music_sneak';
    case 5:
      return fightOn(w) ? 'music_chase' : 'music_tension';
  }
}

/** Level 5: the cage is broken, or a raptor is out. */
function fightOn(w: World): boolean {
  return w.dinos.some((d) => d.kind === 'raptor' && d.state === 'loose') || w.exhibits.some((e) => e.cage && e.segments.some((s) => s.hp <= 0));
}

/** Birds by day, crickets at night: whatever the view shows, so the blackout brings the crickets. */
export function ambienceFor(night: boolean): AmbienceId {
  return night ? 'amb_night' : 'amb_day';
}

// ------------------------------------------------------------------ where a sound sits

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * How loud a sound at a spot plays (0 to 1) and where it sits from left to right (-1 to 1). On screen it plays in
 * full; off screen it fades with distance, down to `floor`. Zoomed out, everything is a little quieter.
 */
export function placeAt(l: Listener, at: Spot, floor: number): { level: number; pan: number } {
  const dx = Math.max(l.x0 - at.x, 0, at.x - l.x1);
  const dz = Math.max(l.z0 - at.z, 0, at.z - l.z1);
  const fade = Math.max(floor, 1 - Math.hypot(dx, dz) / AUDIO.offscreenTiles);
  const zoom = 1 - (1 - AUDIO.zoomedOut) * clamp(l.zoom, 0, 1);
  const half = Math.max(1, (l.x1 - l.x0) / 2);
  const pan = clamp((at.x - (l.x0 + l.x1) / 2) / half, -1, 1) * AUDIO.panWidth;
  return { level: fade * zoom, pan };
}

// ------------------------------------------------------------------ volume

/** The pause menu's sliders, 0 to 1. Effects is every sound but the music: the background and the HUD too. */
export interface Volumes {
  music: number;
  effects: number;
}

/** A slider's position (0 to 1) as a level, on a curve so that the slider feels even (AUDIO.volumeCurve). */
export function volumeGain(v: number): number {
  return clamp(v, 0, 1) ** AUDIO.volumeCurve;
}

// ------------------------------------------------------------------ decoding

/** MP3's lead-in: the encoder's delay and the decoder's, in samples at 44.1 kHz. */
const MP3_LEAD = 576 + 529;
const MP3_FRAME = 1152;
const SOURCE_RATE = 44100;

/**
 * Where a file's own sound starts in what the browser decoded, in samples at the decoded rate. Some browsers drop
 * the MP3's lead-in and padding (Chrome does), some keep them, and some keep its header frame as silence too; the
 * decoded length says which. -1 when it matches none of them.
 */
export function leadIn(file: FileId, decodedLength: number, rate: number): number {
  const { samples, frames } = FILES[file];
  const r = rate / SOURCE_RATE;
  const near = (n: number) => Math.abs(decodedLength - n * r) <= Math.max(2, 0.002 * rate);
  if (near(samples)) return 0;
  if (near(frames * MP3_FRAME)) return Math.round(MP3_LEAD * r);
  if (near((frames + 1) * MP3_FRAME)) return Math.round((MP3_LEAD + MP3_FRAME) * r);
  return -1;
}

/** How long a file's own sound is, in samples at the decoded rate. */
export function soundLength(file: FileId, rate: number): number {
  return Math.round((FILES[file].samples * rate) / SOURCE_RATE);
}

// ------------------------------------------------------------------ spacing

/** Keeps repeats of a sound apart: none sooner than its gap (SoundMix.gap). */
export class Gaps {
  private readonly last = new Map<SoundId, number>();

  /** True when the sound may play at `now` (seconds), and notes that it did. */
  pass(id: SoundId, now: number): boolean {
    const t = this.last.get(id);
    if (t !== undefined && now - t < (SOUNDS[id].gap ?? 0)) return false;
    this.last.set(id, now);
    return true;
  }

  clear(): void {
    this.last.clear();
  }
}

/** Picks one of a sound's files, never the one it played last when it has others. */
export function pickFile(files: readonly FileId[], last: FileId | undefined, rand: () => number): FileId {
  if (files.length === 1) return files[0];
  const others = files.filter((f) => f !== last);
  return others[Math.min(others.length - 1, Math.floor(rand() * others.length))];
}

// ------------------------------------------------------------------ events to sounds

const centerOf = (r: Rect): Spot => ({ x: r.x + r.w / 2, z: r.y + r.h / 2 });

/** Whose bite it was: the nearest raptor or T. rex on the loose near it. Bites don't say. */
function biter(w: World, x: number, y: number): AnimalKind | null {
  let best: AnimalKind | null = null;
  let bestD = AUDIO.biterTiles * w.T;
  for (const d of w.dinos) {
    if (d.kind === 'triceratops' || d.state !== 'loose') continue;
    const dd = Math.hypot(d.x - x, d.y - y);
    if (dd <= bestD) {
      bestD = dd;
      best = d.kind;
    }
  }
  return best;
}

/**
 * Turns each frame's events into sounds, and keeps the sounds that run on their own: an Engineer's tools while it
 * works, and the 4x4's engine while it drives.
 */
export class CueMaker {
  /** Substation id to the game time of its next tool sound. */
  private readonly work = new Map<number, number>();
  /** Where each 4x4 was, and when, for its speed. */
  private readonly jeeps = new Map<number, { x: number; y: number; t: number; speed: number }>();

  constructor(private readonly rand: () => number = Math.random) {}

  /** A new game. */
  reset(): void {
    this.work.clear();
    this.jeeps.clear();
  }

  cues(w: World, events: readonly GameEvent[]): Cue[] {
    const out: Cue[] = [];
    const T = w.T;
    const at = (x: number, y: number): Spot => ({ x: x / T, z: y / T });
    const dino = (id: number) => w.dinos.find((d) => d.id === id);
    for (const e of events) {
      switch (e.type) {
        case 'built':
        case 'reinforced': {
          const ex = w.exhibitById(e.exhibitId);
          out.push({ id: e.type === 'built' ? 'build' : 'reinforce', at: ex && centerOf(ex.footprint) });
          break;
        }
        case 'towerBuilt': {
          const u = w.unitById(e.unitId);
          out.push({ id: 'tower', at: u && at(u.x, u.y) });
          break;
        }
        case 'paid':
          out.push({ id: 'coin', at: at(e.x, e.y) });
          break;
        case 'warning':
          out.push({ id: 'warning' });
          break;
        case 'blackout':
          out.push({ id: 'powerDown' });
          break;
        case 'evacuation':
          out.push({ id: 'siren' });
          break;
        case 'powerRestored':
          out.push({ id: 'powerUp' });
          break;
        case 'substationFixed': {
          const s = w.substationById(e.id);
          const c = s && substationCenter(s, T);
          out.push({ id: 'powerUp', at: c && at(c.x, c.y) });
          break;
        }
        case 'trained':
          out.push({ id: 'ready' });
          break;
        case 'unitLost':
          out.push(e.kind === 'jeep' ? { id: 'jeepWreck', at: at(e.x, e.y) } : { id: 'troopLost' });
          break;
        case 'boarded':
        case 'unloaded': {
          const j = w.unitById(e.jeepId);
          out.push({ id: 'jeepDoor', at: j && at(j.x, j.y) });
          break;
        }
        case 'roar':
          out.push({ id: 'trexRoar', at: at(e.x, e.y) });
          break;
        case 'dart':
          out.push({ id: e.heavy ? 'dartHeavy' : 'dartLight', at: at(e.x0, e.y0) });
          break;
        case 'bite': {
          const kind = biter(w, e.x, e.y);
          if (kind) out.push({ id: kind === 'trex' ? 'trexBite' : 'raptorBite', at: at(e.x, e.y) });
          break;
        }
        case 'maul': {
          const p = at(e.x, e.y);
          if (dino(e.dinoId)?.kind === 'trex') out.push({ id: 'trexGrowl', at: p }, { id: 'trexBite', at: p });
          else out.push({ id: 'raptorBite', at: p });
          break;
        }
        case 'killed': {
          const p = at(e.x, e.y);
          out.push({ id: e.kind === 'trex' ? 'trexDie' : e.kind === 'raptor' ? 'raptorDie' : 'trikeBellow', at: p }, { id: 'down', at: p });
          break;
        }
        case 'noticed':
          out.push({ id: 'notice', at: at(e.x, e.y) });
          break;
        case 'heard':
          out.push({ id: 'raptorHiss', at: at(e.x, e.y) });
          break;
        case 'spotted':
          out.push({ id: 'raptorCall', at: at(e.x, e.y) });
          break;
        case 'stampede':
          out.push({ id: 'trikeBellow', at: at(e.x, e.y) });
          break;
        case 'fenceHit':
          out.push({ id: w.exhibitById(e.exhibitId)?.reinforced ? 'fenceConcrete' : 'fenceChain', at: at(e.x, e.y) });
          break;
        case 'breach':
          out.push({ id: 'breach', at: at(e.x, e.y) });
          break;
        case 'escaped': {
          // The T. rex gets out without a sound: it hunts in silence where it doesn't roar (MissionConfig.roars).
          const d = dino(e.dinoId);
          if (d && d.kind !== 'trex') out.push({ id: d.kind === 'raptor' ? 'raptorCall' : 'trikeBellow', at: at(d.x, d.y) });
          break;
        }
        case 'secured': {
          const p = at(e.x, e.y);
          out.push({ id: 'down', at: p }, { id: 'secured', at: p });
          break;
        }
        case 'casualty':
          out.push({ id: 'guestCry', at: at(e.x, e.y) });
          break;
        case 'ended':
          out.push({ id: e.won ? 'win' : 'lose' });
          break;
        default:
          // 'started' has its music. A T. rex winding up to charge gives no sound: the pause is the warning.
          break;
      }
    }
    this.tools(w, out);
    return out;
  }

  /** Level 4: while Engineers work on a substation, a tool sound every so often. */
  private tools(w: World, out: Cue[]): void {
    const [lo, hi] = AUDIO.workSeconds;
    for (const s of w.substations) {
      if (s.fixed || s.workers <= 0) {
        this.work.delete(s.id);
        continue;
      }
      const next = this.work.get(s.id);
      if (next !== undefined && w.time < next) continue;
      this.work.set(s.id, w.time + lo + (hi - lo) * this.rand());
      const c = substationCenter(s, w.T);
      out.push({ id: 'work', at: { x: c.x / w.T, z: c.y / w.T } });
    }
  }

  /** The 4x4's engine: the running one, or null when none is, or the game is held (a tip, the menu). */
  engine(w: World, held: boolean): EngineCue | null {
    let out: EngineCue | null = null;
    for (const u of w.units) {
      if (u.kind !== 'jeep') continue;
      const prev = this.jeeps.get(u.id);
      let speed = prev?.speed ?? 0;
      if (prev && w.time > prev.t) speed = clamp(Math.hypot(u.x - prev.x, u.y - prev.y) / (w.time - prev.t) / UNITS.jeep.speed, 0, 1);
      if (!prev || w.time > prev.t) this.jeeps.set(u.id, { x: u.x, y: u.y, t: w.time, speed });
      if (!held && !out && engineRunning(u)) out = { x: u.x / w.T, z: u.y / w.T, speed };
    }
    return out;
  }
}

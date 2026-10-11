// Sound for the 3D game, with Web Audio. It plays what cues.ts works out: sounds placed on the map, music, the
// background, and the 4x4's engine. Browsers keep sound off until the page is tapped, so nothing plays before the
// first tap. The player can turn it all off (the Sound box on the briefing and in the pause menu) and set the music
// and the rest apart (the Music and Effects sliders in the pause menu).
import { AUDIO, SOUNDS, type SoundId } from '../config';
import { Gaps, leadIn, pickFile, placeAt, soundLength, volumeGain, type Cue, type EngineCue, type Listener, type Volumes } from './cues';
import { engineLoop } from './engine';
import { FILES, type FileId } from './files';
import { SOUND_FILES, type AmbienceId, type MusicId } from './manifest';

type LoopId = MusicId | AmbienceId;
const LOOPS: readonly LoopId[] = ['music_roundup', 'music_day', 'music_chase', 'music_sneak', 'music_tension', 'amb_day', 'amb_night'];
const isLoop = (f: FileId): f is LoopId => (LOOPS as readonly FileId[]).includes(f);

/** A decoded file, and where its own sound sits in it, in seconds. */
interface Clip {
  buffer: AudioBuffer;
  start: number;
  length: number;
}

interface Voice {
  id: SoundId;
  source: AudioBufferSourceNode;
  ends: number;
}

interface Track {
  id: LoopId;
  source: AudioBufferSourceNode;
  gain: GainNode;
}

/** What to play this frame. */
export interface SoundFrame {
  cues: readonly Cue[];
  /** What the camera shows, for placing sounds. */
  listener: Listener;
  music: MusicId | null;
  ambience: AmbienceId | null;
  engine: EngineCue | null;
  /** A tip holds the game: the music drops back. (Not the pause menu, where the Music slider needs the real level.) */
  held: boolean;
}

type AudioContextClass = typeof AudioContext;

/** Decodes with both the callback and the promise, for older Safari. */
function decode(ctx: AudioContext, data: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    const p = ctx.decodeAudioData(data, resolve, reject);
    if (p && typeof p.then === 'function') p.then(resolve, reject);
  });
}

export class AudioPlayer {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buses: { music: GainNode; ambience: GainNode; sfx: GainNode; ui: GainNode } | null = null;
  private readonly bytes = new Map<FileId, Promise<ArrayBuffer | null>>();
  private readonly clips = new Map<FileId, Clip>();
  private readonly decoding = new Map<FileId, Promise<Clip | null>>();
  private voices: Voice[] = [];
  private readonly gaps = new Gaps();
  private readonly lastFile = new Map<SoundId, FileId>();
  private music: Track | null = null;
  private ambience: Track | null = null;
  private heldNow = false;
  private engineNode: { source: AudioBufferSourceNode; gain: GainNode; pan: StereoPannerNode | null; level: number; rate: number; panAt: number } | null = null;
  private hidden = false;
  private failed = false;
  /** The music the level in play uses (keepMusic). */
  private kept: readonly MusicId[] = [];
  /** Sounds played so far, by kind. For checks. */
  readonly played = new Map<SoundId, number>();

  constructor(
    private readonly base: string,
    private soundOn: boolean,
    private vol: Volumes,
  ) {}

  get on(): boolean {
    return this.soundOn;
  }

  get volumes(): Volumes {
    return { ...this.vol };
  }

  /** For checks: what's running. */
  get state() {
    return {
      context: this.ctx?.state ?? 'none',
      on: this.soundOn,
      clips: this.clips.size,
      music: this.music?.id ?? null,
      ambience: this.ambience?.id ?? null,
      engine: this.engineNode?.level ?? 0,
      voices: this.voices.length,
      volumes: this.volumes,
      buses: this.buses && { music: this.buses.music.gain.value, effects: this.buses.sfx.gain.value },
    };
  }

  /** Starts downloading every file, so it's ready by the first tap. Nothing is decoded until then. */
  prefetch(): void {
    for (const f of Object.keys(FILES) as FileId[]) void this.fetchBytes(f);
  }

  /**
   * Call from every tap and key press: the first one sets up sound (browsers allow it only then), and later ones
   * wake it if the phone put it to sleep (a call, another app).
   */
  unlock(): void {
    if (this.failed) return;
    if (!this.ctx) {
      const Ctx = (window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextClass }).webkitAudioContext) as AudioContextClass | undefined;
      if (!Ctx) {
        this.failed = true;
        return;
      }
      try {
        this.ctx = new Ctx();
      } catch {
        this.failed = true;
        return;
      }
      this.build(this.ctx);
      for (const f of Object.keys(FILES) as FileId[]) if (!isLoop(f) || f.startsWith('amb_') || this.kept.includes(f as MusicId)) void this.clip(f);
      // Sound left off last time: a context made in a tap starts running, so rest it.
      if (!this.soundOn) void this.ctx.suspend().catch(() => undefined);
    }
    const ctx = this.ctx;
    if (this.soundOn && !this.hidden && ctx.state !== 'running') {
      void ctx.resume().catch(() => undefined);
      // iOS also wants something played inside the tap.
      const s = ctx.createBufferSource();
      s.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      s.connect(ctx.destination);
      s.start();
    }
  }

  private build(ctx: AudioContext): void {
    this.master = ctx.createGain();
    this.master.gain.value = this.soundOn ? AUDIO.master : 0;
    // A limiter: it only acts when many loud sounds land together.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = AUDIO.limiterDb;
    limiter.knee.value = 6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;
    this.master.connect(limiter);
    limiter.connect(ctx.destination);
    const bus = () => {
      const g = ctx.createGain();
      g.connect(this.master!);
      return g;
    };
    this.buses = { music: bus(), ambience: bus(), sfx: bus(), ui: bus() };
    for (const [g, level] of this.busLevels()) g.gain.value = level;
  }

  /** Each part of the mix at its level: the sliders, and the music held back while a tip is open. */
  private busLevels(): [GainNode, number][] {
    const b = this.buses!;
    const music = AUDIO.music * volumeGain(this.vol.music) * (this.heldNow ? AUDIO.heldMusic : 1);
    const effects = volumeGain(this.vol.effects);
    return [
      [b.music, music],
      [b.ambience, AUDIO.ambience * effects],
      [b.sfx, AUDIO.sfx * effects],
      [b.ui, AUDIO.ui * effects],
    ];
  }

  private applyBuses(): void {
    const ctx = this.ctx;
    if (!ctx || !this.buses) return;
    for (const [g, level] of this.busLevels()) g.gain.setTargetAtTime(level, ctx.currentTime, 0.05);
  }

  /** A slider moved. */
  setVolume(part: keyof Volumes, level: number): void {
    this.vol = { ...this.vol, [part]: Math.max(0, Math.min(1, level)) };
    this.applyBuses();
  }

  /** A sound at the Effects level, to hear it while the game is paused. */
  preview(): void {
    this.play({ id: 'secured' });
  }

  setOn(on: boolean): void {
    this.soundOn = on;
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const now = ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(on ? AUDIO.master : 0, now, 0.05);
    if (on && !this.hidden) void ctx.resume().catch(() => undefined);
    if (!on) {
      // Let it fade, then rest the sound hardware.
      window.setTimeout(() => {
        if (!this.soundOn) void ctx.suspend().catch(() => undefined);
      }, 300);
    }
  }

  /** The page went out of view, or came back. */
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    const ctx = this.ctx;
    if (!ctx) return;
    if (hidden) void ctx.suspend().catch(() => undefined);
    else if (this.soundOn) void ctx.resume().catch(() => undefined);
  }

  /** Keeps the music a level uses decoded, and lets the rest go: a decoded track takes a lot of memory. */
  keepMusic(ids: readonly MusicId[]): void {
    this.kept = ids;
    for (const f of LOOPS) {
      if (f.startsWith('amb_') || ids.includes(f as MusicId) || this.music?.id === f) continue;
      this.clips.delete(f);
    }
    for (const id of ids) void this.clip(id);
  }

  /** Stops every sound effect (not the music): a new game. */
  stopSounds(): void {
    for (const v of this.voices) {
      try {
        v.source.stop();
      } catch {
        // Already stopped.
      }
    }
    this.voices = [];
    this.gaps.clear();
  }

  // ---------------------------------------------------------------- loading

  private fetchBytes(f: FileId): Promise<ArrayBuffer | null> {
    let p = this.bytes.get(f);
    if (!p) {
      p = fetch(`${this.base}/${f}.mp3`)
        .then((r) => (r.ok ? r.arrayBuffer() : null))
        .catch(() => null);
      this.bytes.set(f, p);
    }
    return p;
  }

  /** The decoded file, once it is ready. */
  private clip(f: FileId): Promise<Clip | null> {
    const have = this.clips.get(f);
    if (have) return Promise.resolve(have);
    const ctx = this.ctx;
    if (!ctx) return Promise.resolve(null);
    let p = this.decoding.get(f);
    if (!p) {
      p = this.fetchBytes(f)
        .then(async (data) => {
          if (!data) {
            console.warn(`Sound ${f} did not load`);
            return null;
          }
          // Decoding hands the bytes over, so music keeps a copy to decode again after it's let go.
          const buffer = await decode(ctx, isLoop(f) ? data.slice(0) : data);
          if (!isLoop(f)) this.bytes.delete(f);
          const c = this.toClip(f, buffer);
          this.clips.set(f, c);
          return c;
        })
        .catch((e: unknown) => {
          console.warn(`Sound ${f} could not be decoded`, e);
          return null;
        })
        .finally(() => this.decoding.delete(f));
      this.decoding.set(f, p);
    }
    return p;
  }

  /** Finds the file's own sound in what the browser decoded (cues.leadIn). */
  private toClip(f: FileId, buffer: AudioBuffer): Clip {
    const rate = buffer.sampleRate;
    let lead = leadIn(f, buffer.length, rate);
    if (lead < 0) {
      // Not a length it knows: start at the first sound, within the first tenth of a second.
      const d = buffer.getChannelData(0);
      const max = Math.min(d.length, Math.round(rate * 0.1));
      lead = 0;
      while (lead < max && Math.abs(d[lead]) < 1e-3) lead++;
      if (lead === max) lead = 0;
    }
    const length = Math.min(soundLength(f, rate), buffer.length - lead);
    return { buffer, start: lead / rate, length: length / rate };
  }

  // ---------------------------------------------------------------- playing

  /** Everything for one frame of the game. */
  frame(f: SoundFrame): void {
    const ctx = this.ctx;
    if (!ctx || !this.buses) return;
    for (const c of f.cues) this.play(c, f.listener);
    if (f.held !== this.heldNow) {
      this.heldNow = f.held;
      this.applyBuses();
    }
    this.music = this.track(this.music, f.music, this.buses.music, f.music ? AUDIO.musicFadeSeconds : AUDIO.musicStopSeconds);
    this.ambience = this.track(this.ambience, f.ambience, this.buses.ambience, AUDIO.ambienceFadeSeconds);
    this.engine(f.engine, f.listener);
  }

  /** A HUD sound, not placed on the map. */
  ui(id: SoundId): void {
    this.play({ id });
  }

  private play(cue: Cue, listener?: Listener): void {
    const ctx = this.ctx;
    if (!ctx || !this.buses || !this.soundOn || this.hidden) return;
    const mix = SOUNDS[cue.id];
    let level = mix.level;
    let pan = 0;
    if (cue.at && listener) {
      const p = placeAt(listener, cue.at, mix.floor ?? 0);
      level *= p.level;
      pan = p.pan;
    }
    if (level < AUDIO.minLevel) return;
    const now = ctx.currentTime;
    const file = pickFile(SOUND_FILES[cue.id], this.lastFile.get(cue.id), Math.random);
    const clip = this.clips.get(file);
    if (!clip) {
      void this.clip(file);
      return;
    }
    this.voices = this.voices.filter((v) => v.ends > now);
    if (this.voices.filter((v) => v.id === cue.id).length >= AUDIO.maxSame) return;
    if (!this.gaps.pass(cue.id, now)) return;
    if (this.voices.length >= AUDIO.maxVoices) {
      const oldest = this.voices.shift()!;
      try {
        oldest.source.stop();
      } catch {
        // Already stopped.
      }
    }
    this.lastFile.set(cue.id, file);
    const src = ctx.createBufferSource();
    src.buffer = clip.buffer;
    const jitter = mix.jitter ?? AUDIO.pitchJitter;
    const rate = 1 + (Math.random() * 2 - 1) * jitter;
    src.playbackRate.value = rate;
    const gain = ctx.createGain();
    gain.gain.value = level;
    src.connect(gain);
    let out: AudioNode = gain;
    if (pan && typeof ctx.createStereoPanner === 'function') {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      gain.connect(p);
      out = p;
    }
    out.connect(mix.ui ? this.buses.ui : this.buses.sfx);
    src.start(now, clip.start, clip.length);
    this.voices.push({ id: cue.id, source: src, ends: now + clip.length / rate });
    this.played.set(cue.id, (this.played.get(cue.id) ?? 0) + 1);
  }

  /** Keeps a loop playing: fades the old one out and the new one in when what's wanted changes. */
  private track(cur: Track | null, want: LoopId | null, bus: GainNode, fade: number): Track | null {
    const ctx = this.ctx!;
    if ((cur?.id ?? null) === want) return cur;
    const now = ctx.currentTime;
    if (cur) {
      cur.gain.gain.cancelScheduledValues(now);
      cur.gain.gain.setValueAtTime(cur.gain.gain.value, now);
      cur.gain.gain.linearRampToValueAtTime(0, now + fade);
      cur.source.stop(now + fade + 0.05);
      // Music another level used is let go once it has faded (keepMusic).
      if (cur.id.startsWith('music_') && !this.kept.includes(cur.id as MusicId)) this.clips.delete(cur.id);
    }
    if (!want) return null;
    const clip = this.clips.get(want);
    if (!clip) {
      // It starts on a later frame, once decoded.
      void this.clip(want);
      return null;
    }
    const source = ctx.createBufferSource();
    source.buffer = clip.buffer;
    source.loop = true;
    source.loopStart = clip.start;
    source.loopEnd = clip.start + clip.length;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(1, now + fade);
    source.connect(gain);
    gain.connect(bus);
    source.start(now, clip.start);
    return { id: want, source, gain };
  }

  /** The 4x4's engine: one loop that runs from its first drive, silent while it's parked. */
  private engine(e: EngineCue | null, listener: Listener): void {
    const ctx = this.ctx!;
    if (!e && !this.engineNode) return;
    if (!this.engineNode) {
      const data = engineLoop(ctx.sampleRate);
      const buffer = ctx.createBuffer(1, data.length, ctx.sampleRate);
      buffer.getChannelData(0).set(data);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      source.connect(gain);
      let pan: StereoPannerNode | null = null;
      if (typeof ctx.createStereoPanner === 'function') {
        pan = ctx.createStereoPanner();
        gain.connect(pan);
        pan.connect(this.buses!.sfx);
      } else gain.connect(this.buses!.sfx);
      source.start();
      this.engineNode = { source, gain, pan, level: 0, rate: 1, panAt: 0 };
    }
    const n = this.engineNode;
    const now = ctx.currentTime;
    const place = e ? placeAt(listener, e, 0) : { level: 0, pan: n.panAt };
    const level = e ? AUDIO.engine.level * place.level : 0;
    const [slow, fast] = AUDIO.engine.rate;
    const rate = e ? slow + (fast - slow) * e.speed : n.rate;
    const tc = AUDIO.engine.fadeSeconds / 3;
    if (Math.abs(level - n.level) > 0.005) {
      n.gain.gain.setTargetAtTime(level, now, tc);
      n.level = level;
    }
    if (Math.abs(rate - n.rate) > 0.005) {
      n.source.playbackRate.setTargetAtTime(rate, now, 0.15);
      n.rate = rate;
    }
    if (n.pan && Math.abs(place.pan - n.panAt) > 0.01) {
      n.pan.pan.setTargetAtTime(place.pan, now, 0.1);
      n.panAt = place.pan;
    }
  }
}

import { afterEach, describe, expect, it, vi } from 'vitest';
import { VIEW3D } from '../src/config';
import { newPacer, paceFrame } from '../src/slice3d/pacing';
import { loadFpsCap, saveFpsCap } from '../src/ui/prefs';

/**
 * A screen ticking `hz` times a second for `seconds`, each tick up to `jitter` ms early or late, and the times of the
 * frames drawn under the cap. `stall` drops the ticks in a stretch of time, as when a frame takes far too long.
 */
function run(hz: number, seconds: number, jitter = 0, stall?: [number, number]): number[] {
  const p = newPacer();
  const drawn: number[] = [];
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < hz * seconds; i++) {
    const now = 1000 + (i * 1000) / hz + (rand() * 2 - 1) * jitter;
    if (stall && now > stall[0] && now < stall[1]) continue;
    if (paceFrame(p, now, VIEW3D.fpsCap, VIEW3D.fpsCapSlackMs)) drawn.push(now);
  }
  return drawn;
}

const gaps = (t: number[]) => t.slice(1).map((v, i) => v - t[i]);
const interval = 1000 / VIEW3D.fpsCap;

describe('frame cap', () => {
  it('draws every second tick of a 60 Hz screen, even with jitter', () => {
    const drawn = run(60, 10, 1);
    expect(drawn.length).toBeGreaterThanOrEqual(10 * VIEW3D.fpsCap - 1);
    expect(drawn.length).toBeLessThanOrEqual(10 * VIEW3D.fpsCap + 1);
    for (const g of gaps(drawn)) {
      expect(g).toBeGreaterThan(interval - 2.5);
      expect(g).toBeLessThan(interval + 2.5);
    }
  });

  it('holds the cap on 90 and 120 Hz screens, a whole number of ticks apart', () => {
    for (const hz of [90, 120]) {
      const drawn = run(hz, 10, 0.5);
      expect(Math.abs(drawn.length - 10 * VIEW3D.fpsCap)).toBeLessThanOrEqual(1);
      for (const g of gaps(drawn)) {
        expect(g).toBeGreaterThan(interval - 1.5);
        expect(g).toBeLessThan(interval + 1.5);
      }
    }
  });

  it('averages the cap on a 144 Hz screen, four or five ticks apart', () => {
    const drawn = run(144, 10, 0.5);
    expect(Math.abs(drawn.length - 10 * VIEW3D.fpsCap)).toBeLessThanOrEqual(2);
    for (const g of gaps(drawn)) {
      expect(g).toBeGreaterThan((4 * 1000) / 144 - 1.5);
      expect(g).toBeLessThan((5 * 1000) / 144 + 1.5);
    }
  });

  it('skips nothing when the screen ticks no faster than the cap (iOS Low Power Mode, or a slow frame rate)', () => {
    expect(run(30, 10, 0.5).length).toBe(300);
    expect(run(20, 10, 0.5).length).toBe(200);
  });

  it('brings no burst of frames after a stall', () => {
    const drawn = run(60, 4, 0.5, [2000, 2400]);
    const after = drawn.filter((t) => t >= 2400);
    expect(after.length).toBeGreaterThan(40);
    for (const g of gaps(after)) expect(g).toBeGreaterThan(interval - 2);
  });
});

describe('frame cap setting', () => {
  afterEach(() => vi.unstubAllGlobals());

  /** A window with storage and a pointer type; `blocked` makes storage throw, as some embedded pages do. */
  function stubWindow(coarse: boolean, blocked = false) {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => {
        if (blocked) throw new Error('blocked');
        return store.get(k) ?? null;
      },
      setItem: (k: string, v: string) => {
        if (blocked) throw new Error('blocked');
        store.set(k, v);
      },
    };
    vi.stubGlobal('window', { localStorage: storage, matchMedia: (q: string) => ({ matches: coarse && q === '(pointer: coarse)' }) });
    return store;
  }

  it('starts on for a touch screen and off elsewhere', () => {
    stubWindow(true);
    expect(loadFpsCap()).toBe(true);
    stubWindow(false);
    expect(loadFpsCap()).toBe(false);
  });

  it('keeps the last choice', () => {
    const store = stubWindow(true);
    saveFpsCap(false);
    expect(store.get('park-blackout.fps-cap')).toBe('off');
    expect(loadFpsCap()).toBe(false);
    saveFpsCap(true);
    expect(loadFpsCap()).toBe(true);
  });

  it('falls back to the screen type when storage is blocked', () => {
    stubWindow(true, true);
    expect(loadFpsCap()).toBe(true);
    expect(() => saveFpsCap(false)).not.toThrow();
  });
});

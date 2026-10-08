// Small per-player choices kept in the browser. Storage can be missing or blocked (private
// windows, some embedded pages), so every read and write is guarded and the game works without it.

const TIPS_KEY = 'park-blackout.tips';

/** Tips are on unless the player turned them off. */
export function loadTipsOn(): boolean {
  try {
    return window.localStorage.getItem(TIPS_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function saveTipsOn(on: boolean): void {
  try {
    window.localStorage.setItem(TIPS_KEY, on ? 'on' : 'off');
  } catch {
    // No storage: the choice lasts until the page closes.
  }
}

const SOUND_KEY = 'park-blackout.sound';

/** The 3D game's sound is on unless the player turned it off. */
export function loadSoundOn(): boolean {
  try {
    return window.localStorage.getItem(SOUND_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function saveSoundOn(on: boolean): void {
  try {
    window.localStorage.setItem(SOUND_KEY, on ? 'on' : 'off');
  } catch {
    // No storage: the choice lasts until the page closes.
  }
}

/** The pause menu's Music and Effects sliders, 0 to 1. */
export interface Volumes {
  music: number;
  effects: number;
}

const VOLUME_KEYS: Record<keyof Volumes, string> = { music: 'park-blackout.music', effects: 'park-blackout.effects' };

/** Both sliders start full. Anything stored that isn't a number from 0 to 1 is ignored. */
export function loadVolumes(): Volumes {
  const read = (part: keyof Volumes) => {
    try {
      const raw = window.localStorage.getItem(VOLUME_KEYS[part]);
      const v = raw === null ? NaN : Number(raw);
      return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1;
    } catch {
      return 1;
    }
  };
  return { music: read('music'), effects: read('effects') };
}

export function saveVolumes(v: Volumes): void {
  try {
    window.localStorage.setItem(VOLUME_KEYS.music, String(v.music));
    window.localStorage.setItem(VOLUME_KEYS.effects, String(v.effects));
  } catch {
    // No storage: the choice lasts until the page closes.
  }
}

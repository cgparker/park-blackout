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

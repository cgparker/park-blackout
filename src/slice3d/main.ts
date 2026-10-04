// Entry for the 3D slice (slice.html): levels 1 and 2 in real 3D, for testing the look and frame rate on phones.
import '../style.css';
import './slice.css';
import { readParams } from '../params';
import type { Quality } from '../render3d/View3D';
import { Hud } from '../ui/hud';
import { SLICE_LEVELS, SliceGame } from './SliceGame';

const QUALITY_KEY = 'pb3d.quality';

/** Quality comes from the address (#low or #high), then the last choice on this device, then High. */
function startQuality(): Quality {
  const tokens = location.hash.replace(/^#/, '').split('.');
  if (tokens.includes('low')) return 'low';
  if (tokens.includes('high')) return 'high';
  try {
    return localStorage.getItem(QUALITY_KEY) === 'low' ? 'low' : 'high';
  } catch {
    return 'high';
  }
}

/** Saves the choice and reloads, since the renderer's settings are fixed when it starts. */
function switchQuality(q: Quality): void {
  try {
    localStorage.setItem(QUALITY_KEY, q);
  } catch {
    // Storage can be off; the address below still carries the choice.
  }
  const tokens = location.hash.replace(/^#/, '').split('.').filter((t) => t && t !== 'low' && t !== 'high');
  location.hash = [...tokens, q].join('.');
  location.reload();
}

const hud = new Hud(document.getElementById('hud')!, { levels: SLICE_LEVELS });
const params = readParams(window.location.search, window.location.hash);
const loading = document.getElementById('loading')!;
const fill = loading.querySelector('.load-bar i') as HTMLElement;
const text = loading.querySelector('.load-text') as HTMLElement;
const game = new SliceGame(document.getElementById('game')!, hud, params, startQuality(), switchQuality);
game
  .boot((done, total) => {
    fill.style.width = `${Math.round((done / Math.max(1, total)) * 100)}%`;
    text.textContent = `Loading models: ${done} of ${total}`;
  })
  .then(() => loading.classList.add('hidden'))
  .catch((e: unknown) => {
    console.error(e);
    text.textContent = `The 3D view could not start: ${e instanceof Error ? e.message : String(e)}`;
  });

// Keep Safari's own pinch-zoom and double-tap zoom out of the game.
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
}
document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });

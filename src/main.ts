import Phaser from 'phaser';
import './style.css';
import { COLORS } from './config';
import { readParams } from './params';
import { GameScene } from './scenes/GameScene';
import { Hud } from './ui/hud';

// Render at the screen's real pixel density so lines stay sharp on phones.
const dpr = Math.min(window.devicePixelRatio || 1, 3);
const container = document.getElementById('game')!;
const hud = new Hud(document.getElementById('hud')!);
const params = readParams(window.location.search, window.location.hash);

function canvasSize(): { w: number; h: number } {
  return {
    w: Math.max(1, Math.round(container.clientWidth * dpr)),
    h: Math.max(1, Math.round(container.clientHeight * dpr)),
  };
}

const size = canvasSize();
const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: container,
  backgroundColor: COLORS.background,
  scale: {
    mode: Phaser.Scale.NONE,
    width: size.w,
    height: size.h,
    zoom: 1 / dpr,
  },
  input: { activePointers: 3 },
  banner: false,
  scene: [new GameScene(hud, dpr, params)],
});

let resizeQueued = false;
function onResize(): void {
  if (resizeQueued) return;
  resizeQueued = true;
  requestAnimationFrame(() => {
    resizeQueued = false;
    const s = canvasSize();
    if (s.w !== game.scale.width || s.h !== game.scale.height) game.scale.resize(s.w, s.h);
  });
}
window.addEventListener('resize', onResize);
window.visualViewport?.addEventListener('resize', onResize);
window.addEventListener('orientationchange', () => window.setTimeout(onResize, 250));

// Keep Safari's own pinch-zoom and double-tap zoom out of the game.
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
}
document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });

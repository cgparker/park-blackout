// Draws the 3D game's Home Screen icons into public3d/icons/: the park security shield from HQ's roof on night-park
// green, at 180 px (iPhone and iPad Home Screens), 192 px, and 512 px (the web app manifest). Made here, no sources.
// The shield matches drawEmblem in src/render3d/materials.ts. It sits inside the middle 80% circle, so a phone that
// crops icons to a circle or a squircle keeps all of it.
// Run: node scripts/icons3d.mjs (needs Playwright's Chromium, as the smoke tests do).
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const OUT = 'public3d/icons';
const SIZES = { 'apple-touch-icon.png': 180, 'icon-192.png': 192, 'icon-512.png': 512 };

function draw(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  // Night-park green, darker toward the foot, with a faint pool of searchlight behind the shield.
  const bg = g.createLinearGradient(0, 0, 0, size);
  bg.addColorStop(0, '#24452f');
  bg.addColorStop(1, '#0c1811');
  g.fillStyle = bg;
  g.fillRect(0, 0, size, size);
  const glow = g.createRadialGradient(size / 2, size * 0.47, 0, size / 2, size * 0.47, size * 0.5);
  glow.addColorStop(0, 'rgba(63, 224, 255, 0.24)');
  glow.addColorStop(1, 'rgba(63, 224, 255, 0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, size, size);
  // The shield with three claw marks, as drawEmblem draws it.
  const w = size * 0.64;
  const h = w;
  const x = (size - w) / 2;
  const y = (size - h) / 2;
  const shield = () => {
    g.beginPath();
    g.moveTo(x + w * 0.5, y + h * 0.06);
    g.lineTo(x + w * 0.88, y + h * 0.18);
    g.quadraticCurveTo(x + w * 0.86, y + h * 0.72, x + w * 0.5, y + h * 0.95);
    g.quadraticCurveTo(x + w * 0.14, y + h * 0.72, x + w * 0.12, y + h * 0.18);
    g.closePath();
  };
  g.shadowColor = 'rgba(0, 0, 0, 0.45)';
  g.shadowBlur = size * 0.04;
  g.shadowOffsetY = size * 0.015;
  shield();
  g.fillStyle = '#f2f4f7';
  g.fill();
  g.shadowColor = 'transparent';
  g.save();
  g.translate(x + w * 0.5, y + h * 0.5);
  g.scale(0.86, 0.86);
  g.translate(-(x + w * 0.5), -(y + h * 0.5));
  shield();
  g.fillStyle = '#2152b8';
  g.fill();
  g.restore();
  g.strokeStyle = '#f2f4f7';
  g.lineCap = 'round';
  g.lineWidth = w * 0.06;
  for (const dx of [-0.137, 0, 0.137]) {
    g.beginPath();
    g.moveTo(x + w * (0.5 + dx) - w * 0.078, y + h * 0.3);
    g.quadraticCurveTo(x + w * (0.5 + dx) - w * 0.02, y + h * 0.5, x + w * (0.5 + dx) + w * 0.059, y + h * 0.7);
    g.stroke();
  }
  return c.toDataURL('image/png');
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, size] of Object.entries(SIZES)) {
  const url = await page.evaluate(draw, size);
  writeFileSync(`${OUT}/${name}`, Buffer.from(url.split(',')[1], 'base64'));
  console.log(`${OUT}/${name} ${size}x${size}`);
}
await browser.close();

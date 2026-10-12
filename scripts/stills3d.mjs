// Renders one frame of still.html to a PNG with a software GPU, for review images.
// Start the 3D dev server first: npx vite --config vite.slice.config.ts --port 5180
// Usage: node scripts/stills3d.mjs "<hash>" out.png [width height dpr]
// Example: node scripts/stills3d.mjs "mode=night" night.png 1280 720 1
// With shots=tx,tz,dist,el;... in the hash it saves one image per camera: out-1.png, out-2.png, ...
import { chromium } from 'playwright';

const [hash = 'mode=day', out = 'still.png', w = '1280', h = '720', dpr = '1'] = process.argv.slice(2);
const url = process.env.STILL_URL ?? 'http://127.0.0.1:5180/still.html';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-gl=angle'] });
const ctx = await browser.newContext({ viewport: { width: +w, height: +h }, deviceScaleFactor: +dpr });
const page = await ctx.newPage();
const t0 = Date.now();
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') console.log(m.type() + ':', m.text().slice(0, 400));
});
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto(`${url}#${hash}`);
await page.waitForFunction(() => window.__ready === true || window.__error, null, { timeout: 900000 });
const err = await page.evaluate(() => window.__error);
if (err) {
  console.log('ERROR', err);
  process.exitCode = 1;
}
const stats = await page.evaluate(() => window.__stats);
if (stats) console.log('stats', JSON.stringify(stats));
const census = await page.evaluate(() => window.__census);
if (census) for (const [k, v] of census) console.log(k.padEnd(34), String(v.meshes).padStart(5), 'meshes', String(v.inst).padStart(6), 'inst', String(Math.round(v.tris)).padStart(9), 'tris');
const shots = await page.evaluate(() => window.__shots ?? []);
if (shots.length) {
  const fs = await import('node:fs');
  shots.forEach((url, i) => {
    const file = out.replace(/\.png$/, `-${i + 1}.png`);
    fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
    console.log('shot', file);
  });
} else await page.screenshot({ path: out, timeout: 300000 });
console.log('shot', out, ((Date.now() - t0) / 1000).toFixed(1) + 's');
await browser.close();

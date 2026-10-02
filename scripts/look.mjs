// Screenshots of the main game states, for eyeballing the UI.
// Usage: npm run build && npx vite preview --port 4173 & node scripts/look.mjs [url] [outDir]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:4173/';
const out = process.argv[3] ?? 'test-results/look';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(url + '?debug=1&seed=5');
await page.waitForFunction(() => window.__pb?.world, null, { timeout: 15000 });
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/01-briefing.png` });

await page.tap('.start');
// Build a park through the world directly (placement UI is covered by the smoke test).
await page.evaluate(() => {
  const { scene, world } = window.__pb;
  world.money = 60000;
  const build = (kind, x, y) => {
    scene.placingKind = kind;
    scene.placingTile = { x, y };
    scene.updatePlan();
    scene.confirmPlacement();
  };
  build('raptor', 9, 8);
  build('pasture', 6, 3);
  build('trex', 16, 16);
  build('raptor', 23, 9);
  build('tower', 21, 14);
  build('tower', 12, 12);
});
// Let visitors arrive.
await page.evaluate(() => {
  const { world } = window.__pb;
  for (let i = 0; i < 60 * 70; i++) world.update(1 / 60);
});
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/02-park-running.png` });

// Train troops.
await page.evaluate(() => window.__pb.scene.openTraining());
await page.waitForTimeout(100);
await page.tap('.train-btn[data-kind="tranq"]');
await page.tap('.train-btn[data-kind="heavy"]');
await page.tap('.train-btn[data-kind="tranq"]');
await page.waitForTimeout(150);
await page.screenshot({ path: `${out}/03-training.png` });
await page.evaluate(() => {
  const { world } = window.__pb;
  for (let i = 0; i < 60 * 40; i++) world.update(1 / 60);
});
await page.tap('.sel-all');
await page.evaluate(() => window.__pb.scene.closePanels());
await page.waitForTimeout(200);
await page.screenshot({ path: `${out}/04-selected.png` });

// Blackout: the T. rex picks a target, winds up, and charges.
await page.evaluate(() => window.__pb.world.startBlackout());
for (const [name, field] of [
  ['05a-trex-windup', 'windup'],
  ['05b-trex-charge', 'charge'],
]) {
  const found = await page.evaluate((field) => {
    const { world, scene } = window.__pb;
    const rex = () => world.dinos.find((d) => d.kind === 'trex');
    for (let i = 0; i < 60 * 60 && rex() && !(rex()[field] > 0); i++) world.update(1 / 60);
    const d = rex();
    if (!d || !(d[field] > 0)) return false;
    // Step a little into the wind-up so the warning arc shows.
    if (field === 'windup') for (let i = 0; i < 20; i++) world.update(1 / 60);
    scene.cx = d.x;
    scene.cy = d.y;
    scene.zoomLevel = 1.3;
    scene.applyCamera();
    // Freeze the sim so the screenshot catches this moment (the page otherwise runs in real time).
    scene.speed = 0;
    return true;
  }, field);
  await page.waitForTimeout(300);
  if (found) await page.screenshot({ path: `${out}/${name}.png` });
  else console.log(`no T. rex ${field} to show`);
  await page.evaluate(() => (window.__pb.scene.speed = 1));
}
await page.evaluate(() => {
  const { world, scene } = window.__pb;
  for (let i = 0; i < 60 * 6; i++) world.update(1 / 60);
  scene.zoomLevel = 0.8;
  scene.cx = 16 * 40;
  scene.cy = 13 * 40;
  scene.applyCamera();
});
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/05c-blackout.png` });

// Exhibit panel.
await page.evaluate(() => {
  const { world, scene } = window.__pb;
  scene.selected.clear();
  scene.openExhibit(world.exhibits[2].id);
});
await page.waitForTimeout(200);
await page.screenshot({ path: `${out}/06-exhibit-panel.png` });

// Play it out and show the end screen.
await page.evaluate(() => {
  const { world } = window.__pb;
  for (let i = 0; i < 60 * 60 * 12 && world.phase !== 'ended'; i++) world.update((1 / 60) * world.timeScale);
});
await page.waitForTimeout(1600);
await page.screenshot({ path: `${out}/07-end.png` });

console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
await browser.close();

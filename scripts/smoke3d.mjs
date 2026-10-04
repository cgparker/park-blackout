// Checks the 3D build in a phone-sized browser. Level 2: it loads, a troop trains, takes a tap to select,
// and takes an order. Level 3: a pen and a tower go up through the build bar, guests come, the lights go
// out at the blackout and come back with the power. Saves screenshots along the way. Uses a software
// GPU, so frame rates here say nothing about a phone.
// Start a server first, then: node scripts/smoke3d.mjs [url] [outDir]
// Example: npx vite --config vite.slice.config.ts --port 5180, then node scripts/smoke3d.mjs
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://127.0.0.1:5180/slice.html';
const out = process.argv[3] ?? 'smoke3d';
const quality = process.env.Q ?? 'low';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-gl=angle'] });
const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
const t0 = Date.now();
const step = (s) => console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s ${s}`);
const fail = (s) => {
  console.log('FAIL', s);
  process.exitCode = 1;
};

await page.goto(`${url}#debug.level-2.${quality}`);
await page.waitForSelector('#loading.hidden', { state: 'attached', timeout: 600000 });
step('loaded');
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/1-briefing.png`, timeout: 240000 });
if ((await page.locator('.level-btn').count()) !== 3) fail('the briefing should offer all three levels');

await page.click('button.start');
await page.waitForTimeout(3000);
step('started');
// Tips pause the game; close any that are open.
const closeTips = async () => {
  for (let i = 0; i < 5 && (await page.locator('.tip:not(.hidden) .tip-ok').count()); i++) {
    await page.click('.tip:not(.hidden) .tip-ok');
    await page.waitForTimeout(300);
  }
};
await page.screenshot({ path: `${out}/2-start.png`, timeout: 240000 });
await closeTips();

const state = () =>
  page.evaluate(() => {
    const g = window.__pb3d;
    const w = g.world;
    return {
      phase: w.phase,
      level: w.level,
      troops: w.units.filter((u) => u.kind !== 'tower' && !u.dead).map((u) => ({ id: u.id, x: u.x, y: u.y, order: u.order })),
      loose: w.dinos.filter((d) => d.state === 'loose').map((d) => ({ id: d.id, x: d.x, y: d.y })),
      stats: g.view.stats,
      fps: document.querySelector('.test-fps')?.textContent,
    };
  });
let s = await state();
step(`phase ${s.phase}, level ${s.level}, ${s.troops.length} troops, ${s.loose.length} loose, ${s.fps}`);
if (s.phase !== 'hunt') fail('level 2 should be running');

// Train a Tranq Squad at HQ, at 4x speed so the test is quick.
await page.click('.dbg-btn[data-speed="4"]').catch(() => undefined);
await page.click('.hq-btn');
await page.waitForTimeout(500);
await page.click('.train-btn[data-kind="tranq"]');
await page.screenshot({ path: `${out}/3-training.png`, timeout: 240000 });
await page.click('.train-panel .close');
// A software GPU draws about one frame a second, so run the simulation forward directly: 12 s of game time.
await closeTips();
await page.evaluate(() => {
  const w = window.__pb3d.world;
  for (let i = 0; i < 720; i++) w.update(1 / 60);
});
await page.waitForTimeout(1500);
await closeTips();
s = await state();
step(`${s.troops.length} troops after training`);
if (!s.troops.length) fail('no troop trained');

// Tap the troop to select it, then tap a loose animal to attack it.
const screenOf = (x, y, h) =>
  page.evaluate(([x, y, h]) => {
    const g = window.__pb3d;
    const p = g.view.project(x / g.world.T, h, y / g.world.T);
    const r = g.canvas.getBoundingClientRect();
    return { x: p.x + r.left, y: p.y + r.top };
  }, [x, y, h]);
const troop = s.troops[s.troops.length - 1];
const look = (x, y) =>
  page.evaluate(([x, y]) => {
    const g = window.__pb3d;
    g.cam.x = x / g.world.T;
    g.cam.z = y / g.world.T;
    g.applyCamera();
  }, [x, y]);
await look(troop.x, troop.y);
await page.waitForTimeout(300);
const tp = await screenOf(troop.x, troop.y, 0.25);
await page.touchscreen.tap(tp.x, tp.y);
await page.waitForTimeout(400);
const selected = await page.evaluate(() => window.__pb3d.selected.size);
step(`tapped the troop: ${selected} selected`);
if (selected !== 1) fail('tapping the troop should select it');
// Move the camera to the nearest loose raptor first, so it is on screen.
const target = s.loose.sort((a, b) => Math.hypot(a.x - troop.x, a.y - troop.y) - Math.hypot(b.x - troop.x, b.y - troop.y))[0];
await look(target.x, target.y);
await page.waitForTimeout(300);
const fresh = (await state()).loose.find((d) => d.id === target.id) ?? target;
const dp = await screenOf(fresh.x, fresh.y, 0.3);
await page.touchscreen.tap(dp.x, dp.y);
await page.waitForTimeout(400);
s = await state();
const ordered = s.troops.find((u) => u.id === troop.id);
step(`ordered: ${ordered?.order}`);
if (ordered?.order !== 'attack') fail('tapping a raptor with a troop selected should order an attack');
await page.screenshot({ path: `${out}/4-attack.png`, timeout: 240000 });

// Pan with one finger, pinch is hard to script; check that a drag moves the camera.
const before = await page.evaluate(() => ({ ...window.__pb3d.cam }));
await page.evaluate(() => {
  const c = window.__pb3d.canvas;
  const r = c.getBoundingClientRect();
  const ev = (type, x, y) => c.dispatchEvent(new PointerEvent(type, { pointerId: 7, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, isPrimary: true }));
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  ev('pointerdown', x, y);
  for (let i = 1; i <= 10; i++) ev('pointermove', x - i * 20, y);
  ev('pointerup', x - 200, y);
});
const after = await page.evaluate(() => ({ ...window.__pb3d.cam }));
step(`drag moved the camera by ${(after.x - before.x).toFixed(2)} tiles`);
if (!(after.x > before.x + 1)) fail('dragging left should move the view right');

// Night.
await page.click('.test-btn[aria-pressed]');
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/5-night.png`, timeout: 240000 });
s = await state();
step(`night: ${s.fps}`);

// ---------------------------------------------------------------- level 3
// Only the hash changes, so reload to start fresh on level 3. A software GPU makes loading slow.
await page.goto(`${url}#debug.level-3.${quality}`, { timeout: 300000 });
await page.reload({ timeout: 300000, waitUntil: 'domcontentloaded' });
await page.waitForSelector('#loading.hidden', { state: 'attached', timeout: 600000 });
step('level 3 loaded');
if ((await page.getAttribute('.level-btn[data-level="3"]', 'aria-pressed')) !== 'true') fail('#level-3 should open on level 3');
if (await page.isChecked('#opt-tips')) await page.click('#opt-tips');
await page.click('#opt-quick');
await page.click('button.start');
await page.waitForTimeout(1500);
const w3 = () => page.evaluate(() => {
  const g = window.__pb3d;
  const w = g.world;
  return { phase: w.phase, money: w.money, exhibits: w.exhibits.length, towers: w.units.filter((u) => u.kind === 'tower').length, guests: w.visitors.filter((v) => !v.done).length, night: g.view.night, plan: g.plan && { valid: g.plan.valid, cost: g.plan.totalCost }, ghost: !!g.view.ghost.focus };
});
s = await w3();
step(`level 3: ${s.phase}, $${s.money}`);
if (s.phase !== 'build') fail('level 3 should start in the build phase');
// A raptor pen, placed and built with the build bar.
await look(9.5 * 40, 8.5 * 40);
await page.waitForTimeout(300);
await page.click('.build-btn[data-kind="raptor"]');
await page.waitForTimeout(300);
if (!(await w3()).ghost) fail('picking an exhibit should show a placement preview');
const spot = await screenOf(9.5 * 40, 8.5 * 40, 0);
await page.touchscreen.tap(spot.x, spot.y);
await page.waitForTimeout(400);
const placed = await w3();
step(`placed: ${JSON.stringify(placed.plan)}`);
if (!placed.plan?.valid) fail('tapping open grass should place a valid preview');
await page.screenshot({ path: `${out}/6-placing.png`, timeout: 240000 });
await page.click('.place-panel .primary');
await page.waitForTimeout(400);
s = await w3();
if (s.exhibits !== 1 || s.money !== placed.money - placed.plan.cost) fail(`Build should add the pen and charge for it: ${JSON.stringify(s)}`);
if (s.ghost) fail('the preview should go once the pen is built');
// Reinforce it from its panel.
await page.evaluate(() => (window.__pb3d.world.money += 20000));
const pen = await page.evaluate(() => window.__pb3d.world.exhibits[0].footprint);
const pc = await screenOf((pen.x + pen.w / 2) * 40, (pen.y + pen.h / 2) * 40, 0);
await page.touchscreen.tap(pc.x, pc.y);
await page.waitForTimeout(400);
if (!(await page.isVisible('.exhibit-panel .reinforce'))) fail('tapping the pen should open its panel with Reinforce');
await page.click('.exhibit-panel .reinforce');
await page.waitForTimeout(300);
if (!(await page.evaluate(() => window.__pb3d.world.exhibits[0].reinforced))) fail('Reinforce should make the fence concrete');
await page.click('.exhibit-panel .close');
// A tower on open grass.
await look(9.5 * 40, 16.5 * 40);
await page.waitForTimeout(300);
await page.click('.build-btn[data-kind="tower"]');
await page.waitForTimeout(300);
const tp3 = await screenOf(9.5 * 40, 16.5 * 40, 0);
await page.touchscreen.tap(tp3.x, tp3.y);
await page.waitForTimeout(400);
await page.click('.place-panel .primary');
await page.waitForTimeout(400);
s = await w3();
step(`built: ${s.exhibits} exhibit, ${s.towers} tower`);
if (s.towers !== 1) fail('Build should put up a tower');
// Guests come during the build phase; the lights go out at the blackout.
await page.evaluate(() => {
  const w = window.__pb3d.world;
  while (w.phase === 'build') w.update(1 / 60);
  for (let i = 0; i < 300; i++) w.update(1 / 60);
});
await page.waitForTimeout(2500);
s = await w3();
step(`blackout: ${s.phase}, ${s.guests} guests, night ${s.night}`);
if (s.phase !== 'blackout' || !s.night) fail('the blackout should turn the lights out');
await page.screenshot({ path: `${out}/7-blackout.png`, timeout: 240000 });
await page.evaluate(() => {
  const w = window.__pb3d.world;
  w.restorePower();
  for (let i = 0; i < 30; i++) w.update(1 / 60);
});
await page.waitForTimeout(2500);
s = await w3();
step(`power back: ${s.phase}, night ${s.night}`);
if (s.night) fail('the lights should come back with the power');
await page.screenshot({ path: `${out}/8-power-back.png`, timeout: 240000 });

if (errors.length) fail(`page errors:\n${errors.join('\n')}`);
await browser.close();
step(process.exitCode ? 'smoke3d failed' : 'smoke3d passed');

// Browser smoke test: plays through the main flows with real taps, drags, and pinches.
// Usage: npm run build && npx vite preview --port 4173 & node scripts/smoke.mjs [url] [outDir]
// Needs a Playwright Chromium (`npx playwright install chromium`).
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:4173/';
const out = process.argv[3] ?? 'test-results';
mkdirSync(out, { recursive: true });
const T = 40;

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const withQuery = (q) => url + (url.includes('?') ? '&' : '?') + q;

async function open(ctxOptions, query = 'debug=1&seed=3') {
  const ctx = await browser.newContext(ctxOptions);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(withQuery(query));
  await page.waitForFunction(() => window.__pb?.world, null, { timeout: 15000 });
  await page.waitForTimeout(300);
  return { ctx, page, errors };
}

const S = (page, fn, arg) => page.evaluate(fn, arg);
/** Polls until fn() is truthy (the HUD updates on the next frame, which is slow in software rendering). */
async function soon(fn, timeout = 4000) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v || Date.now() > end) return v;
    await new Promise((r) => setTimeout(r, 100));
  }
}
/** Runs the simulation forward without waiting on real time. */
const advance = (page, seconds) =>
  S(page, (s) => {
    const w = window.__pb.world;
    for (let i = 0; i < s * 60 && w.phase !== 'ended'; i++) w.update(1 / 60);
  }, seconds);
const cssOf = (page, wx, wy) => S(page, ([x, y]) => window.__pb.scene.worldToCss(x, y), [wx, wy]);
const centerOn = (page, wx, wy, zoom = 0.8) =>
  S(page, ([x, y, z]) => {
    const s = window.__pb.scene;
    s.zoomLevel = z;
    s.cx = x;
    s.cy = y;
    s.applyCamera();
  }, [wx, wy, zoom]);

async function touch(page, cdp, type, points) {
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map((p, i) => ({ x: p.x, y: p.y, id: p.id ?? i })) });
  await page.waitForTimeout(16);
}

async function drag(page, cdp, from, to, { steps = 8, holdMs = 0 } = {}) {
  await touch(page, cdp, 'touchStart', [from]);
  if (holdMs) await page.waitForTimeout(holdMs);
  for (let i = 1; i <= steps; i++) {
    await touch(page, cdp, 'touchMove', [{ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps }]);
  }
  await touch(page, cdp, 'touchEnd', []);
}

async function pinch(page, cdp, center, startGap, endGap, steps = 8) {
  const pts = (gap) => [
    { x: center.x - gap / 2, y: center.y, id: 1 },
    { x: center.x + gap / 2, y: center.y, id: 2 },
  ];
  await touch(page, cdp, 'touchStart', [pts(startGap)[0]]);
  await touch(page, cdp, 'touchStart', pts(startGap));
  for (let i = 1; i <= steps; i++) await touch(page, cdp, 'touchMove', pts(startGap + ((endGap - startGap) * i) / steps));
  await touch(page, cdp, 'touchEnd', [pts(endGap)[1]]);
  await touch(page, cdp, 'touchEnd', []);
}

// ---------------------------------------------------------------- phone, landscape
{
  const { ctx, page, errors } = await open({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const cdp = await ctx.newCDPSession(page);
  const world = (fn) => S(page, fn);

  check('opens on the briefing', await page.isVisible('.briefing'));
  check('briefing names the countdown', (await page.textContent('.brief-title')) === 'Lights out in 5:00');
  check('briefing offers a 2:00 quick test', (await page.textContent('label.check')).includes('Quick test: 2:00 build phase'));
  await page.tap('#opt-quick');
  check('quick test changes the countdown', (await page.textContent('.brief-title')) === 'Lights out in 2:00');
  await page.tap('.start');
  check('Start begins the build phase', (await world(() => window.__pb.world.phase)) === 'build' && !(await page.isVisible('.briefing')));
  check('quick test sets a 2:00 build phase', (await world(() => window.__pb.world.buildPhaseSeconds)) === 120);
  await page.screenshot({ path: `${out}/1-start.png` });

  // Build a raptor pen with the UI.
  const money0 = await world(() => window.__pb.world.money);
  await page.tap('.build-btn[data-kind="raptor"]');
  const spot = await cssOf(page, 9.5 * T, 8.5 * T);
  await page.touchscreen.tap(spot.x, spot.y);
  const plan = await world(() => window.__pb.scene.plan && { valid: window.__pb.scene.plan.valid, cost: window.__pb.scene.plan.totalCost });
  check('tapping the map places a valid ghost', plan?.valid === true, JSON.stringify(plan));
  await page.tap('.place-panel .primary');
  const afterBuild = await world(() => ({ money: window.__pb.world.money, exhibits: window.__pb.world.exhibits.length }));
  check('Build spends exhibit plus path', afterBuild.exhibits === 1 && afterBuild.money === money0 - plan.cost, JSON.stringify(afterBuild));

  // Visitors arrive and pay.
  await advance(page, 60);
  await page.waitForTimeout(120);
  const econ = await world(() => ({ visits: window.__pb.world.exhibits[0].visits, revenue: window.__pb.world.revenue, money: window.__pb.world.money }));
  check('visitors pay at the exhibit', econ.visits > 3 && econ.revenue === econ.visits * 25, JSON.stringify(econ));
  check('HUD shows the money', await soon(async () => (await page.textContent('.stat.money .val')) === '$' + econ.money.toLocaleString('en-US')));
  check('HUD shows the revenue', await soon(async () => (await page.textContent('.stat.revenue .val')) === '$' + econ.revenue.toLocaleString('en-US')));
  check('clock counts down', await soon(async () => (await page.textContent('.clock .val')) === '1:00'), await page.textContent('.clock .val'));
  await page.screenshot({ path: `${out}/2-visitors.png` });
  // The page also runs in real time, so give the rest of this walkthrough room before the lights go out.
  await S(page, () => (window.__pb.world.buildPhaseSeconds = 600));

  // Exhibit panel and Reinforce.
  const pen = await world(() => window.__pb.world.exhibits[0].footprint);
  const penCenter = await cssOf(page, (pen.x + 2) * T, (pen.y + 2) * T);
  await page.touchscreen.tap(penCenter.x, penCenter.y);
  check('tapping an exhibit opens its panel', await page.isVisible('.exhibit-panel'));
  await S(page, () => (window.__pb.world.money += 5000));
  await page.tap('.exhibit-panel .reinforce');
  check('Reinforce upgrades the fence', await world(() => window.__pb.world.exhibits[0].segments.every((s) => s.hp === 600)));
  await page.tap('.exhibit-panel .close');

  // Build a Tranq Tower with the UI.
  await centerOn(page, 8 * T, 13 * T);
  await S(page, () => (window.__pb.world.money += 3000));
  await page.tap('.build-btn[data-kind="tower"]');
  check('the Tower button opens placement', await soon(() => page.isVisible('.place-panel')));
  const towerSpot = await cssOf(page, 9.5 * T, 17.5 * T);
  await page.touchscreen.tap(towerSpot.x, towerSpot.y);
  const towerPlan = await world(() => window.__pb.scene.towerPlan);
  check('tapping grass places a valid tower ghost', towerPlan?.valid === true && towerPlan.tile.x === 9 && towerPlan.tile.y === 17, JSON.stringify(towerPlan));
  await page.screenshot({ path: `${out}/2b-tower-ghost.png` });
  await page.tap('.place-panel .primary');
  const towers = await world(() => window.__pb.world.units.filter((u) => u.kind === 'tower').map((u) => ({ x: u.x, y: u.y })));
  check('Build puts a tower on that tile', towers.length === 1 && towers[0].x === 9.5 * T && towers[0].y === 17.5 * T, JSON.stringify(towers));
  check('the tower tile blocks troops', await world(() => !window.__pb.world.unitWalk(9, 17)));

  // Train at HQ.
  await centerOn(page, 8 * T, 13 * T);
  const hq = await cssOf(page, 3.5 * T, 15.5 * T);
  await page.touchscreen.tap(hq.x, hq.y);
  check('tapping HQ opens training', await page.isVisible('.train-panel'));
  await S(page, () => (window.__pb.world.money += 20000));
  await page.tap('.train-btn[data-kind="tranq"]');
  await page.tap('.train-btn[data-kind="tranq"]');
  await page.tap('.train-btn[data-kind="heavy"]');
  await page.waitForTimeout(400);
  check('queue shows three troops', await soon(async () => (await page.locator('.train-panel .chip').count()) === 3));
  await page.tap('.train-panel .chip >> nth=2');
  check('tapping a queued troop cancels it', (await world(() => window.__pb.world.queue.length)) === 2);
  await page.tap('.train-btn[data-kind="heavy"]');
  await advance(page, 32);
  await page.waitForTimeout(100);
  check('troops appear beside HQ', (await world(() => window.__pb.world.units.filter((u) => u.kind !== 'tower').length)) === 3);
  await page.screenshot({ path: `${out}/3-training.png` });
  await page.tap('.train-panel .close');

  // Tap to select, tap to move.
  const unit = await world(() => {
    const u = window.__pb.world.units.find((u) => u.kind !== 'tower');
    return { id: u.id, x: u.x, y: u.y };
  });
  const unitCss = await cssOf(page, unit.x, unit.y);
  await page.touchscreen.tap(unitCss.x, unitCss.y);
  check('tapping a troop selects it', JSON.stringify(await world(() => [...window.__pb.scene.selected])) === JSON.stringify([unit.id]));
  check('Clear shows the selection count', await soon(async () => (await page.textContent('.sel-clear')) === 'Clear 1'));
  const dest = await cssOf(page, 12.5 * T, 15.5 * T);
  await page.touchscreen.tap(dest.x, dest.y);
  const troop = (id) => S(page, (id) => window.__pb.world.unitById(id), id);
  check('tapping the ground orders a move', (await troop(unit.id)).order === 'move');
  await advance(page, 8);
  const moved = await troop(unit.id);
  check('the troop walks there', Math.hypot(moved.x - 12.5 * T, moved.y - 15.5 * T) < 30, `${Math.round(moved.x)},${Math.round(moved.y)}`);

  // Select all and Clear.
  await page.tap('.sel-clear');
  check('Clear empties the selection', (await world(() => window.__pb.scene.selected.size)) === 0);
  await page.tap('.sel-all');
  check('Select all picks every troop but not the tower', (await world(() => window.__pb.scene.selected.size)) === 3);
  check('Select all counts troops only', (await page.textContent('.sel-all')) === 'Select all 3');
  await page.tap('.sel-clear');

  // Long-press, then drag, draws a selection box.
  const box0 = await cssOf(page, 1.6 * T, 12.6 * T);
  const box1 = await cssOf(page, 6.8 * T, 18.2 * T);
  await drag(page, cdp, box0, box1, { holdMs: 420, steps: 10 });
  const boxed = await world(() => window.__pb.scene.selected.size);
  check('hold and drag box-selects troops near HQ', boxed === 2, `${boxed} selected`);
  await page.screenshot({ path: `${out}/4-box.png` });

  // Pan and pinch still work.
  const before = await world(() => ({ cx: window.__pb.scene.cx, zoom: window.__pb.scene.zoomLevel }));
  await drag(page, cdp, { x: 600, y: 200 }, { x: 420, y: 200 });
  const afterPan = await world(() => window.__pb.scene.cx);
  check('a quick drag pans', afterPan > before.cx + 40, `${Math.round(before.cx)} -> ${Math.round(afterPan)}`);
  await pinch(page, cdp, { x: 420, y: 200 }, 140, 300);
  check('pinch zooms', (await world(() => window.__pb.scene.zoomLevel)) > before.zoom * 1.5);

  // Blackout from the debug panel.
  await page.tap('.dbg-head');
  if (!(await page.isVisible('.dbg-btn >> text=Blackout now'))) await page.tap('.dbg-head');
  await page.tap('.dbg-btn >> text=Blackout now');
  await page.waitForTimeout(800);
  check('Blackout now cuts the power', (await world(() => window.__pb.world.phase)) === 'blackout');
  check('the blackout banner shows', await soon(async () => (await page.textContent('.banner')).includes('cut the power')));
  check('build buttons hide after the blackout', await soon(async () => !(await page.isVisible('.build-group'))));
  check('the revenue slot counts visitors in the dark', await soon(async () => (await page.textContent('.stat.revenue .cap')) === 'Visitors in park'));
  // Run until the first raptor is through the concrete, then freeze it for the attack order below.
  const target = await world(() => {
    const w = window.__pb.world;
    for (let i = 0; i < 60 * 60 && !w.dinos.some((d) => d.state === 'loose'); i++) w.update(1 / 60);
    const d = w.dinos.find((d) => d.state === 'loose');
    if (!d) return null;
    d.pause = 999;
    return { id: d.id, x: d.x, y: d.y, after: w.phaseTime };
  });
  check('raptors break through the concrete after the 20 s delay', target !== null && target.after > 20, JSON.stringify(target));
  await S(page, () => {
    const s = window.__pb.scene;
    s.selected = new Set(window.__pb.world.units.filter((u) => u.kind !== 'tower').map((u) => u.id));
  });
  await centerOn(page, target.x, target.y);
  const tc = await cssOf(page, target.x, target.y);
  await page.touchscreen.tap(tc.x, tc.y);
  const orders = await world(() => window.__pb.world.units.filter((u) => u.kind !== 'tower').map((u) => u.order + ':' + u.targetId));
  check('tapping a dinosaur orders an attack', orders.length > 0 && orders.every((o) => o === `attack:${target.id}`), orders.join(' '));
  await page.screenshot({ path: `${out}/5-attack.png` });

  // End screen and Retry.
  await S(page, () => (window.__pb.world.casualties.raptor = 10));
  await advance(page, 0.1);
  check('ten casualties show the end screen', await soon(() => page.isVisible('.end'), 8000));
  check('end screen names the loss', (await page.textContent('.end h1')) === 'The park has been shut down');
  const endText = await page.textContent('.end');
  check('end screen counts visitors and towers', endText.includes('Got out safely') && endText.includes('Towers lost') && endText.includes('Towers$3,000'), endText.slice(0, 80));
  await page.screenshot({ path: `${out}/6-end.png` });
  await page.tap('.retry');
  await page.waitForTimeout(400);
  const fresh = await world(() => ({ phase: window.__pb.world.phase, exhibits: window.__pb.world.exhibits.length }));
  check('Retry starts a fresh game', fresh.phase === 'briefing' && fresh.exhibits === 0 && (await soon(() => page.isVisible('.briefing'))), JSON.stringify(fresh));
  check('Retry keeps the quick-test choice', await page.isChecked('#opt-quick'));

  check('no console errors on phone', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// ---------------------------------------------------------------- phone, portrait
{
  const { ctx, page } = await open({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  check('portrait shows the rotate message', await page.isVisible('#rotate'));
  await ctx.close();
}

// ---------------------------------------------------------------- desktop, mouse
{
  const { ctx, page, errors } = await open({ viewport: { width: 1280, height: 720 } });
  await page.click('.start');
  await S(page, () => {
    const w = window.__pb.world;
    w.money = 50000;
  });
  const z0 = await S(page, () => window.__pb.scene.zoomLevel);
  await page.mouse.move(640, 360);
  await page.mouse.wheel(0, -400);
  await page.waitForTimeout(100);
  check('mouse wheel zooms', (await S(page, () => window.__pb.scene.zoomLevel)) > z0);
  await centerOn(page, 8 * T, 14 * T);

  await page.click('.build-btn[data-kind="pasture"]');
  const p = await cssOf(page, 10.5 * T, 9.5 * T);
  await page.mouse.click(p.x, p.y);
  if (await S(page, () => window.__pb.scene.plan?.valid)) await page.click('.place-panel .primary');
  check('mouse click places and builds', (await S(page, () => window.__pb.world.exhibits.length)) === 1);

  await S(page, () => {
    const w = window.__pb.world;
    for (let i = 0; i < 3; i++) window.__pb.scene.hud.handlers.train('tranq');
  });
  await advance(page, 30);
  const units = await S(page, () => window.__pb.world.units.map((u) => ({ x: u.x, y: u.y })));
  const a = await cssOf(page, Math.min(...units.map((u) => u.x)) - 20, Math.min(...units.map((u) => u.y)) - 20);
  const b = await cssOf(page, Math.max(...units.map((u) => u.x)) + 20, Math.max(...units.map((u) => u.y)) + 20);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
  check('left-drag box-selects', (await S(page, () => window.__pb.scene.selected.size)) === 3);
  const r = await cssOf(page, 14.5 * T, 16.5 * T);
  await page.mouse.click(r.x, r.y, { button: 'right' });
  check('right-click orders a move', (await S(page, () => window.__pb.world.units.every((u) => u.order === 'move'))) === true);
  await page.keyboard.down('d');
  await page.waitForTimeout(250);
  await page.keyboard.up('d');
  check('no console errors on desktop', errors.length === 0, errors.join(' | '));
  await page.screenshot({ path: `${out}/7-desktop.png` });
  await ctx.close();
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);

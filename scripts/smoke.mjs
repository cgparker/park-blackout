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
    // Stop any camera move still easing, so taps land where this puts things.
    s.camMove = null;
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
  check('tips are on by default', await page.isChecked('#opt-tips'));
  // Every level is open. The briefing starts on level 1, and picking a level sets up its park behind the briefing.
  const pressed = () => S(page, () => [...document.querySelectorAll('.level-btn')].filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.level).join(','));
  check('the briefing offers three levels and starts on level 1', (await page.locator('.level-btn').count()) === 3 && (await pressed()) === '1' && (await world(() => window.__pb.world.level)) === 1);
  check('level 1 is a roundup on a short clock', (await page.textContent('.brief-title')) === 'Round them up in 2:30' && (await page.textContent('.brief-side')).includes('Get all 6 Triceratops back before the park opens in 2:30.'));
  check('the quick test is for level 3 only', !(await page.isVisible('#opt-quick')));
  await page.tap('.level-btn[data-level="2"]');
  check('picking level 2 sets up its park', await soon(async () => (await world(() => window.__pb.world.level)) === 2 && (await pressed()) === '2'));
  check('level 2 is the raptor nest', (await page.textContent('.brief-title')) === 'Clear the nest in 4:00' && (await page.textContent('.brief-side')).includes('Lose no troops.'));
  await page.tap('.level-btn[data-level="3"]');
  check('picking level 3 brings back the blackout', await soon(async () => (await world(() => window.__pb.world.level)) === 3 && (await pressed()) === '3'));
  check('briefing names the countdown', (await page.textContent('.brief-title')) === 'Lights out in 5:00');
  check('briefing offers a 2:00 quick test', (await page.textContent('label.check')).includes('Quick test: 2:00 build phase'));
  const stars = await page.textContent('.brief-side');
  check(
    'briefing explains one star per goal',
    stars.includes('Get every dinosaur back.') && stars.includes('Earn $20,000 from visitors') && stars.includes('Keep every guest alive.') && stars.includes('You need the first star to earn the other two.'),
    stars.slice(0, 200),
  );
  await page.tap('#opt-quick');
  check('quick test changes the countdown', (await page.textContent('.brief-title')) === 'Lights out in 2:00');
  check('quick test scales the revenue goal', (await page.textContent('.brief-side')).includes('Earn $8,000 from visitors'));
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

  // The first raptor pen brings up a tip, and the game waits while it's open.
  check('a raptor pen brings up a tip', await soon(async () => (await page.isVisible('.tip')) && (await page.textContent('.tip-title')) === 'Raptors go for visitors'));
  const t0 = await world(() => window.__pb.world.phaseTime);
  await page.waitForTimeout(700);
  check('the game pauses while a tip is open', (await world(() => window.__pb.world.phaseTime)) === t0);
  await page.screenshot({ path: `${out}/1b-tip.png` });
  await page.tap('.tip-ok');
  check('Got it closes the tip', !(await page.isVisible('.tip')));
  await page.waitForTimeout(700);
  check('the game runs again after Got it', (await world(() => window.__pb.world.phaseTime)) > t0);

  // Visitors arrive and pay.
  await advance(page, 60);
  await page.waitForTimeout(120);
  const econ = await world(() => ({ visits: window.__pb.world.exhibits[0].visits, revenue: window.__pb.world.revenue, money: window.__pb.world.money }));
  check('visitors pay at the exhibit', econ.visits > 3 && econ.revenue === econ.visits * 25, JSON.stringify(econ));
  check('HUD shows the money', await soon(async () => (await page.textContent('.stat.money .val')) === '$' + econ.money.toLocaleString('en-US')));
  check('HUD shows the revenue', await soon(async () => (await page.textContent('.stat.revenue .val')) === '$' + econ.revenue.toLocaleString('en-US')));
  // About 60 s of the 2:00 phase have run (plus a moment of real time).
  const clockSecs = async () => {
    const [m, s] = (await page.textContent('.clock .val')).split(':').map(Number);
    return m * 60 + s;
  };
  check('clock counts down', await soon(async () => (await clockSecs()) <= 60 && (await clockSecs()) >= 55), await page.textContent('.clock .val'));
  await page.screenshot({ path: `${out}/2-visitors.png` });

  // The 1:00 warning explains the evacuation, then points out the unguarded raptor pen. Hide tips turns them all off.
  check('the warning explains the evacuation', await soon(async () => (await page.isVisible('.tip')) && (await page.textContent('.tip-title')) === 'Nobody will tell the guests'));
  await page.tap('.tip-ok');
  check('the warning flags an unguarded raptor pen', await soon(async () => (await page.isVisible('.tip')) && (await page.textContent('.tip-title')) === 'A raptor pen is unguarded'));
  await page.tap('.tip-off');
  check('Hide tips closes the tip and turns tips off', !(await page.isVisible('.tip')) && (await world(() => window.__pb.scene.session.tips)) === false);
  // The page also runs in real time, so give the rest of this walkthrough room before the lights go out.
  await S(page, () => (window.__pb.world.buildPhaseSeconds = 600));

  // Exhibit panel and Reinforce.
  const pen = await world(() => window.__pb.world.exhibits[0].footprint);
  const penCenter = await cssOf(page, (pen.x + 2) * T, (pen.y + 2) * T);
  await page.touchscreen.tap(penCenter.x, penCenter.y);
  check('tapping an exhibit opens its panel', await page.isVisible('.exhibit-panel'));
  const breakoutText = () =>
    S(page, () => [...document.querySelectorAll('.exhibit-panel .line')].find((l) => l.textContent.startsWith('Breaks out'))?.querySelector('.value')?.textContent ?? '');
  const chainLink = await breakoutText();
  check('the exhibit panel says when the animals break out', /^\d+ s after blackout$/.test(chainLink), chainLink);
  check('the reinforce note says how long concrete holds them', (await page.textContent('.exhibit-panel .note')).includes('holds them in until about'));
  await S(page, () => (window.__pb.world.money += 5000));
  await page.tap('.exhibit-panel .reinforce');
  check('Reinforce upgrades the fence', await world(() => window.__pb.world.exhibits[0].segments.every((s) => s.hp === 600)));
  const concrete = await soon(async () => {
    const t = await breakoutText();
    return t !== chainLink ? t : null;
  });
  check('concrete pushes the breakout later', parseInt(concrete) > parseInt(chainLink), `${chainLink} -> ${concrete}`);
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
  check('HQ says how fast the team sedates a T. rex and a raptor pack', await soon(async () => /^Your 3 troops, darting together: a T\. rex in \d+ s, a pack of 3 raptors in \d+ s\.$/.test(await page.textContent('.team-note'))), await page.textContent('.team-note'));
  await page.screenshot({ path: `${out}/3-training.png` });
  await page.tap('.train-panel .close');

  // The pause menu stops the clock.
  await page.tap('.pause-btn');
  check('the pause button opens the menu', await soon(() => page.isVisible('.menu')));
  check('the menu shows how each star goal is going', /Earn \$\d[\d,]*\$[\d,]+ so far/.test(await page.textContent('.menu .goal-rows')), await page.textContent('.menu .goal-rows'));
  const pausedAt = await world(() => window.__pb.world.phaseTime);
  await page.waitForTimeout(500);
  check('the game is paused while the menu is open', (await world(() => window.__pb.world.phaseTime)) === pausedAt);
  await page.tap('.menu-resume');
  await page.waitForTimeout(300);
  check('Resume closes the menu and the game runs again', !(await page.isVisible('.menu')) && (await world(() => window.__pb.world.phaseTime)) > pausedAt);

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
  await page.waitForTimeout(700);
  const framed = await world(() => {
    const s = window.__pb.scene;
    const cam = s.cameras.main;
    const top = cam.y / s.dpr;
    const bottom = (cam.y + cam.height) / s.dpr;
    const right = cam.width / s.dpr;
    const shown = window.__pb.world.exhibits.every((e) => {
      const c = s.worldToCss((e.footprint.x + e.footprint.w / 2) * 40, (e.footprint.y + e.footprint.h / 2) * 40);
      return c.x > 0 && c.x < right && c.y > top && c.y < bottom;
    });
    return { shown, zoom: s.zoomLevel };
  });
  check('the camera frames the park when the power goes out', framed.shown && framed.zoom <= 0.8 + 1e-6, JSON.stringify(framed));
  check('the blackout banner shows', await soon(async () => (await page.textContent('.banner')).includes('cut the power')));
  check('build buttons hide after the blackout', await soon(async () => !(await page.isVisible('.build-group'))));
  check('guests keep paying in the dark, so the revenue slot stays', (await page.textContent('.stat.revenue .cap')).startsWith('Revenue'));
  // Run until the first raptor is through the concrete, then freeze it for the attack order below.
  const target = await world(() => {
    const w = window.__pb.world;
    for (let i = 0; i < 60 * 60 && !w.dinos.some((d) => d.state === 'loose'); i++) w.update(1 / 60);
    const d = w.dinos.find((d) => d.state === 'loose');
    if (!d) return null;
    d.pause = 999;
    return { id: d.id, x: d.x, y: d.y, after: w.phaseTime };
  });
  check('raptors break through the concrete after the 18 s delay', target !== null && target.after > 18, JSON.stringify(target));
  check('the first escape starts the evacuation', (await world(() => window.__pb.world.evacuatedBy)) === 'raptor');
  check('the evacuation banner shows', await soon(async () => (await page.textContent('.banner')) === 'Raptors are out. The park is evacuating.'));
  check('the revenue slot counts visitors once the park evacuates', await soon(async () => (await page.textContent('.stat.revenue .cap')) === 'Visitors in park'));
  // Look away: an arrow at the map edge points back at the raptors, and tapping it brings the camera there.
  // Every raptor holds still meanwhile, so the one the arrow points at can't run off before the camera arrives.
  await S(page, () => window.__pb.world.dinos.forEach((d) => d.kind === 'raptor' && d.state === 'loose' && (d.pause = 999)));
  await centerOn(page, 34 * T, 21 * T, 1.6);
  check('an edge arrow points at loose raptors off screen', await soon(async () => (await page.locator('.edge-arrow[data-kind="raptor"]:not(.hidden)').count()) > 0));
  await page.tap('.edge-arrow[data-kind="raptor"]:not(.hidden) >> nth=0');
  // The camera eases over half a second of frame time, which is slower in software rendering.
  await soon(() => world(() => window.__pb.scene.camMove === null), 6000);
  const looked = await world(() => {
    const s = window.__pb.scene;
    const cam = s.cameras.main;
    const top = cam.y / s.dpr;
    const bottom = (cam.y + cam.height) / s.dpr;
    const right = cam.width / s.dpr;
    return window.__pb.world.dinos.filter((d) => d.kind === 'raptor' && d.state === 'loose').some((d) => {
      const c = s.worldToCss(d.x, d.y);
      return c.x > 0 && c.x < right && c.y > top && c.y < bottom;
    });
  });
  check('tapping the arrow brings the raptors on screen', looked);
  await S(page, (id) => window.__pb.world.dinos.forEach((d) => d.kind === 'raptor' && d.id !== id && (d.pause = 0)), target.id);
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
  // The HUD shows "killed / limit"; push the count to the limit.
  const limit = Number((await page.textContent('.stat.casualties .val')).split('/')[1]);
  check('the HUD shows a casualty limit of 8', limit === 8, String(limit));
  await S(page, (n) => (window.__pb.world.casualties.raptor = n), limit);
  await advance(page, 0.1);
  check('reaching the casualty limit shows the end screen', await soon(() => page.isVisible('.end'), 8000));
  check('end screen names the loss', (await page.textContent('.end h1')) === 'The park has been shut down');
  check('end screen marks each star goal', (await page.textContent('.end-goals')).includes('Shut down at 8 deaths'), await page.textContent('.end-goals'));
  const endText = await page.textContent('.end');
  check('end screen counts visitors and towers', endText.includes('Got out safely') && endText.includes('Towers lost') && /Towers\$4,500/.test(endText), endText.slice(0, 80));
  check('end screen shows money earned in the dark and the first animal out', endText.includes('Earned in the dark') && endText.includes('First animal outRaptors'), endText);
  check('end screen tells what happened, in order', /What happened0:00The power is cut with \d+ guests? inside\..*Raptors are out\./.test(endText), endText.slice(0, 300));
  await page.screenshot({ path: `${out}/6-end.png` });
  await page.tap('.retry');
  await page.waitForTimeout(400);
  const fresh = await world(() => ({ phase: window.__pb.world.phase, exhibits: window.__pb.world.exhibits.length, level: window.__pb.world.level }));
  check('Retry starts a fresh game of the same level', fresh.phase === 'briefing' && fresh.exhibits === 0 && fresh.level === 3 && (await soon(() => page.isVisible('.briefing'))), JSON.stringify(fresh));
  check('the end screen offers no next level after a loss', !(await page.isVisible('.next-level')));
  check('Retry keeps the quick-test choice', await page.isChecked('#opt-quick'));
  check('no tips showed after they were turned off', !(await page.isVisible('.tip')));
  check('Retry keeps tips off', !(await page.isChecked('#opt-tips')));
  await page.reload();
  await page.waitForFunction(() => window.__pb?.world, null, { timeout: 15000 });
  check('tips stay off after a reload', !(await page.isChecked('#opt-tips')));
  check('a reload opens on level 1 again', (await world(() => window.__pb.world.level)) === 1);
  await page.tap('.level-btn[data-level="3"]');
  await soon(async () => (await world(() => window.__pb.world.level)) === 3);

  // Restart and End game from the pause menu.
  await page.tap('.start');
  await page.tap('.pause-btn');
  await page.tap('.menu-restart');
  check('Restart from the menu goes back to the briefing', await soon(() => page.isVisible('.briefing')));
  await page.tap('.start');
  await page.tap('.pause-btn');
  await page.tap('.menu-end');
  check('End game shows the results right away', await soon(() => page.isVisible('.end'), 1500));
  check('a game ended early says so', (await page.textContent('.end h1')) === 'Game ended early' && (await page.textContent('.end .detail')).includes('before the blackout'));
  await page.tap('.retry');

  check('no console errors on phone', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// ---------------------------------------------------------------- phone, levels 1 and 2
{
  const { ctx, page, errors } = await open({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const world = (fn) => S(page, fn);
  await page.tap('.start');
  check('level 1 starts with the park built and Triceratops out', (await world(() => {
    const w = window.__pb.world;
    return w.phase === 'hunt' && w.exhibits.length === 4 && w.dinos.filter((d) => d.state === 'loose').length === 6;
  })) === true);
  check('the clock counts down to opening', (await page.textContent('.clock .cap')) === 'Park opens in' && (await page.textContent('.clock .val')).startsWith('2:'));
  check('the top bar tracks spending for the second star', await soon(async () => (await page.textContent('.stat.revenue .cap')).startsWith('Spent') && (await page.textContent('.stat.revenue .cap')).includes('$4,500')));
  check('nothing to build in level 1', !(await page.isVisible('.build-group')));
  check('level 1 opens with a tip on training', await soon(async () => (await page.isVisible('.tip')) && (await page.textContent('.tip-title')) === 'Train a Tranq Squad'));
  await page.tap('.tip-ok');
  await centerOn(page, 8 * T, 14 * T);
  const hq = await cssOf(page, 3.5 * T, 15.5 * T);
  await page.touchscreen.tap(hq.x, hq.y);
  check('HQ trains only Tranq Squads in level 1', (await soon(() => page.isVisible('.train-btn[data-kind="tranq"]'))) && !(await page.isVisible('.train-btn[data-kind="heavy"]')));
  await page.tap('.train-btn[data-kind="tranq"]');
  await page.tap('.train-btn[data-kind="tranq"]');
  check('the team note counts in Triceratops', await soon(async () => /a Triceratops in \d+ s\.$/.test(await page.textContent('.team-note'))), await page.textContent('.team-note'));
  await page.tap('.train-panel .close');
  await advance(page, 17);
  check('a trained squad brings up the tip on darting', await soon(async () => (await page.isVisible('.tip')) && (await page.textContent('.tip-title')) === 'Send it after a Triceratops'));
  await page.tap('.tip-ok');
  check('both squads are out', (await world(() => window.__pb.world.units.length)) === 2);
  check('edge arrows point at Triceratops off screen', await soon(async () => (await page.locator('.edge-arrow[data-kind="triceratops"]:not(.hidden)').count()) > 0));
  // Select a squad by tapping it, then tap a Triceratops held still beside it.
  const sq = await world(() => {
    const w = window.__pb.world;
    const u = w.units[0];
    const d = w.dinos.find((d) => d.state === 'loose');
    d.x = u.x + 6 * 40;
    d.y = u.y;
    d.recover = 999;
    d.wait = 999;
    return { u: { id: u.id, x: u.x, y: u.y }, d: { id: d.id, x: d.x, y: d.y } };
  });
  await centerOn(page, sq.u.x + 3 * T, sq.u.y);
  const uc = await cssOf(page, sq.u.x, sq.u.y);
  await page.touchscreen.tap(uc.x, uc.y);
  const dc = await cssOf(page, sq.d.x, sq.d.y);
  await page.touchscreen.tap(dc.x, dc.y);
  const order = await world(() => window.__pb.world.units.map((u) => `${u.order}:${u.targetId}`));
  check('tap a squad, then a Triceratops, to dart it', order.includes(`attack:${sq.d.id}`), order.join(' '));
  await page.tap('.pause-btn');
  check('the pause menu shows level 1 goals', await soon(async () => (await page.textContent('.menu .goal-rows')).includes('Spend $4,500 or less') && (await page.textContent('.menu .goal-rows')).includes('Finish with 1:00 left')));
  await page.tap('.menu-resume');
  // One dart each finishes them: put a squad beside every Triceratops left.
  await world(() => {
    const w = window.__pb.world;
    const u = w.units[0];
    for (const d of w.dinos.filter((d) => d.state === 'loose')) {
      d.sedation = 1;
      u.x = d.x - 60;
      u.y = d.y;
      u.cooldown = 0;
      for (let i = 0; i < 3 && w.phase !== 'ended'; i++) w.update(1 / 60);
    }
  });
  check('darting the last Triceratops wins level 1', await soon(() => page.isVisible('.end'), 8000));
  check('the end screen says every Triceratops is back', (await page.textContent('.end h1')) === 'Every Triceratops is back');
  check('the end screen marks the level 1 goals', /Spend \$4,500 or less\$4,500 spent/.test(await page.textContent('.end-goals')), await page.textContent('.end-goals'));
  check('the timeline counts them back', /Triceratops are loose in the park\..*darted\./.test(await page.textContent('.timeline')), await page.textContent('.timeline'));
  check('a win offers the next level', await page.isVisible('.next-level'));
  await page.screenshot({ path: `${out}/8-level1-end.png` });
  await page.tap('.next-level');
  check('Next level opens the level 2 briefing', await soon(async () => (await world(() => window.__pb.world.level)) === 2 && (await page.isVisible('.briefing'))));

  await page.tap('.start');
  check('level 2 opens with a tip about the nest', await soon(async () => (await page.isVisible('.tip')) && (await page.textContent('.tip-title')) === 'Raptors guard their nest'));
  await page.tap('.tip-ok');
  check('six raptors guard the nest', (await world(() => window.__pb.world.dinos.filter((d) => d.kind === 'raptor' && d.state === 'loose' && d.nest).length)) === 6);
  check('the top bar counts troops lost in level 2', await soon(async () => (await page.textContent('.stat.casualties .cap')) === 'Troops lost'));
  await centerOn(page, 8 * T, 14 * T);
  const hq2 = await cssOf(page, 3.5 * T, 15.5 * T);
  await page.touchscreen.tap(hq2.x, hq2.y);
  check('HQ trains Tranq Squads and Heavy Teams in level 2', (await soon(() => page.isVisible('.train-btn[data-kind="heavy"]'))) && (await page.isVisible('.train-btn[data-kind="tranq"]')));
  await page.tap('.train-panel .close');
  // A troop at HQ is safe; one walking up to the nest is not.
  await world(() => {
    const w = window.__pb.world;
    w.money += 0;
    window.__pb.scene.hud.handlers.train('tranq');
    for (let i = 0; i < 60 * 9; i++) w.update(1 / 60);
  });
  await advance(page, 10);
  check('raptors leave a troop at HQ alone', (await world(() => window.__pb.world.troopsLost)) === 0 && (await world(() => window.__pb.world.units.length)) === 1);
  await world(() => {
    const w = window.__pb.world;
    const u = w.units[0];
    u.x = w.nest.x - 5 * 40;
    u.y = w.nest.y;
    for (let i = 0; i < 60 * 8 && !w.units.every((u) => u.dead); i++) w.update(1 / 60);
  });
  check('a lone troop at the nest is bitten down', (await world(() => window.__pb.world.troopsLost)) === 1);
  check('losing a troop to raptors brings up a tip', await soon(async () => (await page.isVisible('.tip')) && (await page.textContent('.tip-title')) === 'Raptors pile on'));
  await page.tap('.tip-ok');
  await page.tap('.pause-btn');
  await page.tap('.menu-end');
  check('ending level 2 early says the nest was not clear', await soon(async () => (await page.isVisible('.end')) && (await page.textContent('.end .detail')) === 'You ended the game before the nest was clear.'));
  await page.screenshot({ path: `${out}/9-level2-end.png` });
  check('no console errors in levels 1 and 2', errors.length === 0, errors.join(' | '));
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
  // The level can be picked in the address too, for testing.
  const { ctx, page, errors } = await open({ viewport: { width: 1280, height: 720 } }, 'debug=1&seed=3&level=3');
  check('?level=3 opens on the blackout level', (await S(page, () => window.__pb.world.level)) === 3);
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
  // Phaser handles keys on its next frame, so each check waits for it.
  const escState = () => S(page, () => `selected ${window.__pb.scene.selected.size}, menu ${window.__pb.scene.hud.menuOpen}, tip ${window.__pb.scene.hud.tipOpen}, panel ${window.__pb.scene.hud.panel}, fps ${Math.round(window.__pb.scene.game.loop.actualFps)}`);
  await page.keyboard.press('Escape');
  check('Esc clears the selection first', (await soon(async () => (await S(page, () => window.__pb.scene.selected.size)) === 0, 8000)) && !(await page.isVisible('.menu')), await escState());
  await page.keyboard.press('Escape');
  check('Esc with nothing selected opens the pause menu', await soon(() => page.isVisible('.menu'), 8000), await escState());
  await page.keyboard.press('Escape');
  check('Esc closes the pause menu', await soon(async () => !(await page.isVisible('.menu')), 8000), await escState());
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

// Browser smoke test for the current milestone.
// Usage: npm run build && npx vite preview --port 4173 & node scripts/smoke.mjs [url] [outDir]
// Needs a Playwright Chromium (`npx playwright install chromium`).
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:4173/';
const out = process.argv[3] ?? 'test-results';
mkdirSync(out, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

async function phonePage() {
  const ctx = await browser.newContext({
    viewport: { width: 844, height: 390 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(url + (url.includes('?') ? '&' : '?') + 'debug=1');
  await page.waitForFunction(() => window.__pb?.scene?.cameras?.main, null, { timeout: 15000 });
  await page.waitForTimeout(300);
  return { ctx, page, errors };
}

const S = (page, fn, arg) => page.evaluate(fn, arg);
const sceneState = (page) =>
  S(page, () => {
    const s = window.__pb.scene;
    return {
      money: window.__pb.state.money,
      exhibits: window.__pb.state.exhibits.length,
      zoom: s.zoomLevel,
      cx: s.cx,
      cy: s.cy,
      placing: s.placingKind,
      tile: s.placingTile,
      plan: s.plan && { valid: s.plan.valid, reason: s.plan.reason, fp: s.plan.footprint, cost: s.plan.totalCost },
    };
  });

/** Raw multi-touch through the DevTools protocol (Playwright has no pinch helper). */
async function touch(page, cdp, type, points) {
  await cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: points.map((p, i) => ({ x: p.x, y: p.y, id: p.id ?? i })),
  });
  await page.waitForTimeout(16);
}

async function drag(page, cdp, from, to, steps = 8) {
  await touch(page, cdp, 'touchStart', [from]);
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
  const { ctx, page, errors } = await phonePage();
  const cdp = await ctx.newCDPSession(page);
  await page.screenshot({ path: `${out}/1-start.png` });

  const start = await sceneState(page);
  check('starts with $15,000', start.money === 15000, `money=${start.money}`);
  const renderer = await S(page, () => window.__pb.scene.game.renderer.type);
  check('uses the WebGL renderer', renderer === 2, `type=${renderer}`);

  // Pick the raptor pen: ghost appears mid-view.
  await page.tap('.build-btn[data-kind="raptor"]');
  await page.waitForTimeout(150);
  let st = await sceneState(page);
  check('choosing an exhibit shows a ghost', st.placing === 'raptor' && !!st.plan, JSON.stringify(st.plan));
  const panelVisible = await page.isVisible('.place-panel');
  check('placement panel is visible', panelVisible);

  // Tapping the HUD (top bar) must not move the ghost.
  const tileBefore = st.tile;
  await page.tap('.topbar', { position: { x: 420, y: 20 } });
  st = await sceneState(page);
  check('tapping the HUD does not touch the map', JSON.stringify(st.tile) === JSON.stringify(tileBefore) && st.placing === 'raptor');

  // Tap the map to move the ghost to a specific tile.
  const target = { x: 9, y: 10 };
  const css = await S(page, (t) => window.__pb.scene.worldToCss((t.x + 0.5) * 40, (t.y + 0.5) * 40), target);
  await page.touchscreen.tap(css.x, css.y);
  await page.waitForTimeout(100);
  st = await sceneState(page);
  check('tapping the map moves the ghost', st.tile.x === target.x && st.tile.y === target.y, JSON.stringify(st.tile));
  check('that spot is buildable', st.plan?.valid === true, JSON.stringify(st.plan));
  await page.screenshot({ path: `${out}/2-ghost.png` });

  // Confirm.
  const cost = st.plan.cost;
  await page.tap('.place-panel .confirm');
  await page.waitForTimeout(150);
  st = await sceneState(page);
  check('confirming builds the exhibit', st.exhibits === 1 && st.placing === null);
  check('money drops by exhibit + path cost', st.money === 15000 - cost, `money=${st.money}, cost=${cost}`);
  const hudMoney = await page.textContent('.money');
  check('HUD money matches', hudMoney === '$' + st.money.toLocaleString('en-US'), hudMoney);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/3-built.png` });

  // Blocked spot: move the camera to the rocks, then tap them.
  await page.tap('.build-btn[data-kind="pasture"]');
  await S(page, () => {
    const s = window.__pb.scene;
    s.cx = 28.5 * 40;
    s.cy = 14.5 * 40;
    s.applyCamera();
  });
  const rock = await S(page, () => window.__pb.scene.worldToCss(28.5 * 40, 14.5 * 40));
  await page.touchscreen.tap(rock.x, rock.y);
  st = await sceneState(page);
  check('rocks block placement', st.plan?.valid === false && st.plan?.reason === 'Blocked', JSON.stringify(st.plan));
  check('build button disabled when blocked', await page.isDisabled('.place-panel .confirm'));
  await page.screenshot({ path: `${out}/4-blocked.png` });
  await page.tap('.place-panel .cancel');
  st = await sceneState(page);
  check('cancel leaves placement mode', st.placing === null);

  // Pan with one finger (drag right, so the view moves left).
  const beforePan = await sceneState(page);
  await drag(page, cdp, { x: 300, y: 200 }, { x: 500, y: 220 });
  const afterPan = await sceneState(page);
  check('one-finger drag pans', afterPan.cx < beforePan.cx - 50, `cx ${beforePan.cx.toFixed(0)} -> ${afterPan.cx.toFixed(0)}`);
  check('a drag is not a tap', afterPan.placing === null && afterPan.exhibits === 1);

  // Pinch in and out.
  const z0 = (await sceneState(page)).zoom;
  await pinch(page, cdp, { x: 420, y: 200 }, 120, 260);
  const z1 = (await sceneState(page)).zoom;
  check('pinch out zooms in', z1 > z0 * 1.4, `zoom ${z0.toFixed(2)} -> ${z1.toFixed(2)}`);
  await pinch(page, cdp, { x: 420, y: 200 }, 300, 40);
  const z2 = (await sceneState(page)).zoom;
  check('pinch in zooms out', z2 < z1 * 0.5, `zoom ${z1.toFixed(2)} -> ${z2.toFixed(2)}`);
  await page.screenshot({ path: `${out}/5-zoomed-out.png` });

  // Zoomed all the way out the whole map should fit in the play area.
  const fits = await S(page, () => {
    const s = window.__pb.scene;
    const cam = s.cameras.main;
    const v = cam.worldView;
    return v.x <= 0 && v.y <= 0 && v.right >= 1600 && v.bottom >= 960;
  });
  check('min zoom shows the whole map', fits);

  // Limit: T. rex is 1 per level. Use money cheat, build one, then the button should disable.
  await S(page, () => {
    window.__pb.state.money = 100000;
    window.__pb.scene.refreshHud();
  });
  await page.tap('.build-btn[data-kind="trex"]');
  const tx = await S(page, () => window.__pb.scene.worldToCss(30 * 40, 19 * 40));
  await page.touchscreen.tap(tx.x, tx.y);
  st = await sceneState(page);
  if (st.plan?.valid) await page.tap('.place-panel .confirm');
  await page.waitForTimeout(100);
  const trexDisabled = await page.isDisabled('.build-btn[data-kind="trex"]');
  const trexMeta = await page.textContent('.build-btn[data-kind="trex"] .meta');
  check('T. rex button locks after one', trexDisabled && trexMeta === 'Limit reached', trexMeta);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/6-two-exhibits.png` });

  check('no console errors on phone', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// ---------------------------------------------------------------- phone, portrait
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(url);
  await page.waitForTimeout(500);
  check('portrait shows the rotate message', await page.isVisible('#rotate'));
  await page.screenshot({ path: `${out}/7-portrait.png` });
  await ctx.close();
}

// ---------------------------------------------------------------- desktop, mouse
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(url + '?debug=1');
  await page.waitForFunction(() => window.__pb?.scene?.cameras?.main, null, { timeout: 15000 });
  const z0 = await S(page, () => window.__pb.scene.zoomLevel);
  await page.mouse.move(640, 360);
  await page.mouse.wheel(0, -400);
  await page.waitForTimeout(100);
  const z1 = await S(page, () => window.__pb.scene.zoomLevel);
  check('mouse wheel zooms', z1 > z0, `${z0.toFixed(2)} -> ${z1.toFixed(2)}`);

  await page.click('.build-btn[data-kind="pasture"]');
  // Click a little left of the middle of the play area.
  const p = await S(page, () => {
    const s = window.__pb.scene;
    const cam = s.cameras.main;
    return { x: (cam.x + cam.width * 0.4) / s.dpr, y: (cam.y + cam.height * 0.5) / s.dpr };
  });
  await page.mouse.click(p.x, p.y);
  const placed = await S(page, () => ({ kind: window.__pb.scene.placingKind, valid: window.__pb.scene.plan?.valid }));
  if (placed.valid) await page.click('.place-panel .confirm');
  const built = await S(page, () => window.__pb.state.exhibits.map((e) => e.kind));
  check('mouse click places and builds', placed.kind === 'pasture' && built.length === 1 && built[0] === 'pasture', JSON.stringify({ placed, built }));
  await page.keyboard.down('d');
  await page.waitForTimeout(300);
  await page.keyboard.up('d');
  check('no console errors on desktop', errors.length === 0, errors.join(' | '));
  await page.screenshot({ path: `${out}/8-desktop.png` });
  await ctx.close();
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);

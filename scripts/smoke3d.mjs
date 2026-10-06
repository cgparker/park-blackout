// Checks the 3D build in a phone-sized browser. Level 2: it loads, a troop trains, takes a tap to select,
// and takes an order. Level 3: a pen and a tower go up through the build bar, guests come, the lights go
// out at the blackout and come back with the power. Raptors show view cones in every level, and troops carry
// flashlights at night. Level 4: night, with troop flashlights off, a substation's panel, the Engineer and Stop
// buttons, the Engineer sent to fix a substation from the side tapped, a raptor's cone turning orange as it makes
// out a troop, and the pack it calls circling the troop. Level 5: troops loaded into the 4x4 and driven. Saves
// screenshots along the way. Uses a software GPU, so frame rates here say nothing about a phone.
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
if ((await page.locator('.level-btn').count()) !== 5) fail('the briefing should offer all five levels');

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
if (s.phase !== 'mission') fail('level 2 should be running');
// Raptors see in cones in every level: each one at the nest shows its own.
const nestCones = await page.evaluate(() => {
  let n = 0;
  window.__pb3d.view.scene.traverse((o) => {
    if (o.isLineLoop && o.visible && o.geometry.drawRange.count > 2) n++;
  });
  return n;
});
step(`level 2: ${nestCones} cones`);
if (nestCones !== s.loose.length) fail('each raptor at the nest should show its view cone');

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
// Like a pan: it stops any camera glide, such as the one that frames the level at the start.
const look = (x, y) =>
  page.evaluate(([x, y]) => {
    const g = window.__pb3d;
    g.camMove = null;
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
// Outside level 4, troops carry flashlights at night.
const beams = await page.evaluate(() => window.__pb3d.view.effects.flashlights.filter((b) => b.cone.visible).length);
step(`level 2 at night: ${beams} flashlights`);
if (beams < 1) fail('troops should carry flashlights at night outside level 4');

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
// A night frame can take seconds with the software GPU, so give the next frame time to come.
await page.waitForTimeout(2500);
s = await w3();
for (let i = 0; i < 20 && s.night; i++) {
  await page.waitForTimeout(500);
  s = await w3();
}
step(`power back: ${s.phase}, night ${s.night}`);
if (s.night) fail('the lights should come back with the power');
await page.screenshot({ path: `${out}/8-power-back.png`, timeout: 240000 });

// ---------------------------------------------------------------- level 4
await page.goto(`${url}#debug.level-4.${quality}`, { timeout: 300000 });
await page.reload({ timeout: 300000, waitUntil: 'domcontentloaded' });
await page.waitForSelector('#loading.hidden', { state: 'attached', timeout: 600000 });
step('level 4 loaded');
if (await page.isChecked('#opt-tips')) await page.click('#opt-tips');
await page.click('button.start');
await page.waitForTimeout(1500);
const w4 = () =>
  page.evaluate(() => {
    const g = window.__pb3d;
    const w = g.world;
    const raptors = w.dinos.filter((d) => d.state === 'loose');
    let cones = 0;
    g.view.scene.traverse((o) => {
      if (o.isLineLoop && o.visible && o.geometry.drawRange.count > 2) cones++;
    });
    return {
      phase: w.phase,
      night: g.view.night,
      raptors: raptors.length,
      cones,
      fixed: w.substations.filter((s) => s.fixed).length,
      engineer: w.units.find((u) => u.kind === 'engineer'),
      west: w.substations[0],
      hq: !document.querySelector('.hq-btn')?.classList.contains('hidden'),
    };
  });
s = await w4();
step(`level 4: ${s.phase}, night ${s.night}, ${s.raptors} raptors, ${s.cones} cones`);
if (s.phase !== 'mission' || !s.night) fail('level 4 should start at night');
if (s.cones !== s.raptors || s.raptors !== 2) fail('each raptor on patrol should show its view cone');
if (s.hq) fail('level 4 trains nothing, so the HQ button should be hidden');
// Level 4's troops keep their flashlights off while they sneak, and each raptor has a ring at its feet so it can be
// found at the tip of its cone.
const marks = await page.evaluate(() => {
  const v = window.__pb3d.view;
  return { lights: v.effects.flashlights.filter((b) => b.cone.visible).length, rings: [...v.cones.sets.values()].filter((c) => c.mark.visible).length };
});
step(`level 4: ${marks.lights} flashlights on, ${marks.rings} raptor rings`);
if (marks.lights) fail('level 4 troops should keep their flashlights off');
if (marks.rings !== 2) fail('each raptor on patrol should have a ring at its feet');
// Look at the south raptor and its cone.
const south = await page.evaluate(() => {
  const d = window.__pb3d.world.dinos.find((d) => d.state === 'loose');
  return { x: d.x, y: d.y };
});
await look(south.x, south.y);
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/9-level4-cones.png`, timeout: 240000 });
// A tap on the west substation with nothing selected opens its panel.
const wc = { x: (s.west.x + 1) * 40, y: (s.west.y + 1) * 40 };
await look(wc.x, wc.y);
await page.waitForTimeout(400);
const sp = await screenOf(wc.x, wc.y, 0);
await page.touchscreen.tap(sp.x, sp.y);
await page.waitForTimeout(500);
if (!(await page.isVisible('.substation-panel'))) fail('tapping a substation should open its panel');
await page.screenshot({ path: `${out}/10-level4-substation.png`, timeout: 240000 });
await page.click('.substation-panel .close');
// The Engineer button selects the Engineer; Stop shows once something is selected.
if (!(await page.isVisible('.sel-engineer')) || (await page.isVisible('.sel-stop'))) fail('level 4 should show the Engineer button, and no Stop with nothing selected');
await page.click('.sel-engineer');
await page.waitForTimeout(400);
const picked = await page.evaluate(() => {
  const g = window.__pb3d;
  return [...g.selected].map((id) => g.world.unitById(id).kind).join(' ');
});
step(`Engineer button selects: ${picked}`);
if (picked !== 'engineer') fail('the Engineer button should select the Engineer');
// The HUD catches up on the next frame, which takes about a second on a software GPU.
if (!(await page.waitForSelector('.sel-stop', { state: 'visible', timeout: 8000 }).catch(() => null))) fail('Stop should show once something is selected');
// Then a tap above the substation sends it to work from the top side.
await look(wc.x, wc.y);
await page.waitForTimeout(400);
const top = await screenOf(wc.x, wc.y - 1.5 * 40, 0);
await page.touchscreen.tap(top.x, top.y);
await page.waitForTimeout(400);
const sent = await page.evaluate(() => {
  const w = window.__pb3d.world;
  const e = w.units.find((u) => u.kind === 'engineer');
  return { order: e.order, row: e.dest ? Math.floor(e.dest.y / 40) : null, top: w.substations[0].y - 1 };
});
step(`Engineer order: ${JSON.stringify(sent)}`);
if (sent.order !== 'repair' || sent.row !== sent.top) fail('a tap above a substation should send the Engineer to fix it from the top side');
await page.click('.sel-stop');
await page.waitForTimeout(300);
const stopped = await page.evaluate(() => window.__pb3d.world.units.find((u) => u.kind === 'engineer').order);
if (stopped !== 'idle') fail(`Stop should halt the Engineer, not leave it on ${stopped}`);
await page.touchscreen.tap(sp.x, sp.y);
await page.waitForTimeout(400);
const order = await page.evaluate(() => window.__pb3d.world.units.find((u) => u.kind === 'engineer').order);
if (order !== 'repair') fail('a tap on the substation should send the Engineer again');
await page.evaluate(() => {
  const w = window.__pb3d.world;
  for (let i = 0; i < 60 * 12; i++) w.update(1 / 60);
});
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/11-level4-working.png`, timeout: 240000 });
await page.evaluate(() => {
  const w = window.__pb3d.world;
  for (let i = 0; i < 60 * 15 && !w.substations[0].fixed; i++) w.update(1 / 60);
});
await page.waitForTimeout(1500);
s = await w4();
step(`fixed ${s.fixed}`);
if (s.fixed !== 1) fail('the Engineer should fix the west substation');
await page.screenshot({ path: `${out}/12-level4-fixed.png`, timeout: 240000 });
// Put the Tranq Squad in front of a raptor on open grass. Hold the game still while it makes the squad out:
// its cone turns orange and a ring fills at its feet.
await page.click('.sel-clear').catch(() => undefined);
const watcher = await page.evaluate(() => {
  const g = window.__pb3d;
  const w = g.world;
  const d = w.dinos.find((d) => d.state === 'loose' && d.patrol);
  const sq = w.units.find((u) => u.kind === 'tranq');
  Object.assign(d, { x: 23.5 * 40, y: 16.5 * 40, facing: 0, look: 0, notice: 0, target: null, path: [], pathIndex: 0 });
  Object.assign(sq, { x: 28 * 40, y: 16.5 * 40, order: 'idle', dest: null, path: [], pathIndex: 0 });
  for (let i = 0; i < 25; i++) w.update(1 / 60);
  g.speed = 0;
  return d.id;
});
await look(25 * 40, 16.5 * 40);
await page.waitForTimeout(2000);
const seeing = await page.evaluate((id) => {
  const g = window.__pb3d;
  const c = g.view.cones.sets.get(id);
  return { notice: g.world.dinos.find((d) => d.id === id).notice, arcs: c.arcs.filter((a) => a.visible).length, fan: c.fan.material.color.getHexString() };
}, watcher);
step(`noticing: ${JSON.stringify(seeing)}`);
if (!(seeing.notice > 0) || seeing.arcs < 1 || seeing.fan !== 'ff8a2a') fail('a raptor making out a troop should show an orange cone and a filling ring');
await page.screenshot({ path: `${out}/12b-level4-noticing.png`, timeout: 240000 });
await page.evaluate(() => {
  const g = window.__pb3d;
  g.speed = 1;
  for (let i = 0; i < 60 && !g.world.events.some((e) => e.type === 'spotted'); i++) g.world.update(1 / 60);
});
let toast = '';
const packToast = /^Raptors are circling the Tranq Squad\.$/;
for (let i = 0; i < 20 && !packToast.test(toast); i++) {
  await page.waitForTimeout(250);
  toast = (await page.locator('.toast').textContent().catch(() => '')) ?? '';
}
step(`toast: ${toast}`);
if (!packToast.test(toast)) fail('once sure, the raptor should call the other, and they should circle the squad, and say so');

// ---------------------------------------------------------------- level 5
await page.goto(`${url}#debug.level-5.${quality}`, { timeout: 300000 });
await page.reload({ timeout: 300000, waitUntil: 'domcontentloaded' });
await page.waitForSelector('#loading.hidden', { state: 'attached', timeout: 600000 });
step('level 5 loaded');
if (await page.isChecked('#opt-tips')) await page.click('#opt-tips');
await page.click('button.start');
await page.waitForTimeout(1500);
const w5 = () =>
  page.evaluate(() => {
    const g = window.__pb3d;
    const w = g.world;
    const jeep = w.units.find((u) => u.kind === 'jeep');
    return { phase: w.phase, night: g.view.night, jeep: jeep && { id: jeep.id, x: jeep.x, y: jeep.y, order: jeep.order }, heavy: w.units.find((u) => u.kind === 'heavy'), riders: w.units.filter((u) => u.aboard).length };
  });
s = await w5();
step(`level 5: ${s.phase}, night ${s.night}`);
if (s.phase !== 'mission' || s.night) fail('level 5 should start by day');
// Tap a Heavy Team, then the 4x4, to load it.
await look((s.heavy.x + s.jeep.x) / 2, (s.heavy.y + s.jeep.y) / 2);
await page.waitForTimeout(400);
const hp5 = await screenOf(s.heavy.x, s.heavy.y, 0.3);
await page.touchscreen.tap(hp5.x, hp5.y);
await page.waitForTimeout(400);
const jp = await screenOf(s.jeep.x, s.jeep.y, 0.3);
await page.touchscreen.tap(jp.x, jp.y);
await page.waitForTimeout(400);
await page.evaluate(() => {
  const w = window.__pb3d.world;
  for (let i = 0; i < 60 * 3; i++) w.update(1 / 60);
});
await page.waitForTimeout(800);
s = await w5();
step(`riders: ${s.riders}`);
if (s.riders !== 1) fail('tapping a troop, then the 4x4, should load it');
// Tap the 4x4, then the map, to drive.
const jp2 = await screenOf(s.jeep.x, s.jeep.y, 0.3);
await page.touchscreen.tap(jp2.x, jp2.y);
await page.waitForTimeout(400);
const to = await screenOf(s.jeep.x + 3 * 40, s.jeep.y, 0);
await page.touchscreen.tap(to.x, to.y);
await page.waitForTimeout(400);
s = await w5();
step(`4x4 order: ${s.jeep.order}`);
if (s.jeep.order !== 'move') fail('tapping the 4x4, then the map, should drive it');
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/13-level5-4x4.png`, timeout: 240000 });
// Let the fight go on a few seconds, for the wounds.
await page.evaluate(() => {
  const w = window.__pb3d.world;
  for (let i = 0; i < 60 * 10; i++) w.update(1 / 60);
  const rex = w.dinos.find((d) => d.kind === 'trex');
  const g = window.__pb3d;
  g.cam.x = rex.x / 40;
  g.cam.z = rex.y / 40;
  g.applyCamera();
});
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/14-level5-fight.png`, timeout: 240000 });

if (errors.length) fail(`page errors:\n${errors.join('\n')}`);
await browser.close();
step(process.exitCode ? 'smoke3d failed' : 'smoke3d passed');

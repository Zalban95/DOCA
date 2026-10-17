// The game in a real browser, the way a person meets it: on a desk and on a phone held both ways. It checks the page
// (the game centred and as large as the space allows; on a touch screen the pads big, on screen, and never over the
// game), that every level starts and finishes and the ending is reached (through window.__game, src/hook.js), that
// the keyboard and the touch pads move the player, and that nothing raised an error. Pictures of each go to
// test/shots/ — look at them: a test proves it works, a picture shows whether it looks right.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { serve } from '../scripts/serve.js';
import { findChrome, launch, newPage } from '../scripts/chrome.js';

const SHOTS = path.join(import.meta.dirname, 'shots');
const VIEWS = [
  { name: 'desk', width: 1280, height: 720, mobile: false, touch: false },
  { name: 'phone-upright', width: 390, height: 844, mobile: true, touch: true },
  { name: 'phone-sideways', width: 844, height: 390, mobile: true, touch: true },
];
const exe = findChrome();
let server, base, browser;

before(async () => {
  if (!exe) return;
  server = await serve({ port: 0 });
  base = `http://127.0.0.1:${server.address().port}`;
  browser = launch(exe);
});
after(async () => { await browser?.close(); server?.close(); });

async function open(view) {
  const p = await newPage(browser);
  await p.send('Emulation.setDeviceMetricsOverride', { width: view.width, height: view.height, deviceScaleFactor: 1, mobile: view.mobile });
  if (view.touch) await p.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await p.send('Page.navigate', { url: `${base}/${view.touch ? '?touch=1' : ''}` });
  await p.until('window.__game && window.__game.active().includes("Menu")', 15000);
  await p.sleep(300);
  return p;
}

const LAYOUT = `(() => {
  const box = e => { const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
  return { canvas: box(document.querySelector('#game canvas')), stage: box(document.querySelector('#stage')),
    pads: [...document.querySelectorAll('.pad .btn')].map(box).filter(b => b.w > 0), pause: box(document.querySelector('#pause')), vw: innerWidth, vh: innerHeight };
})()`;
const overlap = (a, b) => a.x < b.r && b.x < a.r && a.y < b.b && b.y < a.b;

for (const view of VIEWS) {
  test(`the page on ${view.name} (${view.width}×${view.height}): the game centred and whole${view.touch ? ', the pads big and beside it' : ''}`, { skip: !exe && 'no Chrome, Chromium or Edge found — set CHROME to one' }, async () => {
    const p = await open(view);
    const { canvas: c, stage: s, pads, pause, vw, vh } = await p.evaluate(LAYOUT);
    await p.shot(path.join(SHOTS, `${view.name}-menu.png`));
    assert.ok(c.x >= -1 && c.y >= -1 && c.r <= vw + 1 && c.b <= vh + 1, `the game is cut off by the screen: ${JSON.stringify(c)} in ${vw}×${vh}`);
    assert.ok(Math.abs((c.x - s.x) - (s.r - c.r)) <= 2, `the game is not centred across its space: ${Math.round(c.x - s.x)} px left, ${Math.round(s.r - c.r)} px right`);
    assert.ok(Math.abs((c.y - s.y) - (s.b - c.b)) <= 2, `the game is not centred top to bottom: ${Math.round(c.y - s.y)} px above, ${Math.round(s.b - c.b)} px below`);
    assert.ok(c.w >= s.w - 2 || c.h >= s.h - 2, `the game does not use its space: ${Math.round(c.w)}×${Math.round(c.h)} in ${Math.round(s.w)}×${Math.round(s.h)}`);
    if (view.touch) {
      assert.ok(pads.length >= 4, `the touch pads are not shown (${pads.length} buttons visible)`);
      for (const b of pads) {
        assert.ok(b.w >= 56 && b.h >= 56, `a touch button is ${Math.round(b.w)}×${Math.round(b.h)} px — at least 56 for a thumb`);
        assert.ok(b.x >= 0 && b.y >= 0 && b.r <= vw && b.b <= vh, `a touch button is off the screen: ${JSON.stringify(b)}`);
        assert.ok(!overlap(b, c), `a touch button covers the game: ${JSON.stringify(b)} over ${JSON.stringify(c)}`);
      }
      assert.ok(pause.w >= 44 && !overlap(pause, c) && pause.x >= 0 && pause.y >= 0, `the pause button is too small, off screen or over the game: ${JSON.stringify(pause)}`);
    } else assert.equal(pads.length, 0, 'touch pads show on a desk with a mouse');
    assert.deepEqual(p.errors, [], 'the page raised errors');
  });
}

test('every level starts and finishes, and the ending is reached', { skip: !exe && 'no Chrome' }, async () => {
  const p = await open(VIEWS[0]);
  const n = await p.evaluate('window.__game.levels().length');
  for (let i = 0; i < n; i++) {
    await p.evaluate(`window.__game.start(${i})`);
    await p.until(`(s => s.scenes.includes('Game') && s.level === ${i} && s.player)(window.__game.state())`, 8000);
    await p.sleep(500);
    await p.shot(path.join(SHOTS, `level-${i + 1}.png`));
    const st = await p.evaluate('window.__game.state()');
    assert.ok(Number.isFinite(st.player.x) && Number.isFinite(st.player.y), `level ${i + 1}: the player has no position`);
    await p.evaluate('window.__game.win()');
    await p.until(`(s => !(s.scenes.includes('Game') && s.level === ${i}))(window.__game.state())`, 6000);
  }
  // After the last level: its story (if any), then the end screen.
  for (let k = 0; k < 40; k++) {
    const on = await p.evaluate('window.__game.active()');
    if (on.includes('End')) break;
    if (on.includes('Story')) await p.evaluate('window.__game.press("confirm", 80)');
    await p.sleep(250);
  }
  await p.until('window.__game.active().includes("End")', 4000);
  await p.shot(path.join(SHOTS, 'ending.png'));
  assert.deepEqual(p.errors, [], 'errors while playing through');
});

async function moved(p, act, release) {
  await p.evaluate('window.__game.start(0)');
  await p.until('(s => s.player && s.player.onGround)(window.__game.state())', 8000);
  await p.sleep(200);
  const x0 = (await p.evaluate('window.__game.state()')).player.x;
  await act();
  await p.sleep(450);
  await release();
  return (await p.evaluate('window.__game.state()')).player.x - x0;
}

test('the keyboard moves the player', { skip: !exe && 'no Chrome' }, async () => {
  const p = await open(VIEWS[0]);
  const key = (type, code, vk) => p.send('Input.dispatchKeyEvent', { type, code, key: code, windowsVirtualKeyCode: vk });
  const dx = await moved(p, () => key('keyDown', 'ArrowRight', 39), () => key('keyUp', 'ArrowRight', 39));
  assert.ok(dx > 20, `ArrowRight moved the player ${dx} px`);
  await key('keyDown', 'Space', 32);
  await p.until('window.__game.state().player.vy < 0', 2000);
  await key('keyUp', 'Space', 32);
  assert.deepEqual(p.errors, []);
});

test('the touch pads move the player', { skip: !exe && 'no Chrome' }, async () => {
  const p = await open(VIEWS[1]);
  const at = await p.evaluate(`(b => ({ x: b.left + b.width / 2, y: b.top + b.height / 2 }))(document.querySelector('[data-key=right]').getBoundingClientRect())`);
  const dx = await moved(p, () => p.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: at.x, y: at.y }] }),
    () => p.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }));
  assert.ok(dx > 20, `the right pad moved the player ${dx} px`);
  await p.shot(path.join(SHOTS, 'phone-playing.png'));
  assert.deepEqual(p.errors, []);
});

'use strict';

/**
 * The floating chat's geometry, which is the part of drag-and-resize that can be
 * wrong in a way nobody notices until the window is gone.
 *
 * There is no browser here, so the pointer plumbing itself is not exercised —
 * what is exercised is the arithmetic underneath it: the clamp that decides
 * where a window may end up, and the storage that decides where it was left.
 * Both are pure functions of `window` and `localStorage`, so both are run
 * directly, with a fake of each.
 *
 * The two failures worth preventing are the ones with no way back:
 *
 *   - A window dragged past an edge, or resized to nothing, cannot be grabbed
 *     again. There is no title bar and no double-click to bring it home.
 *   - `localStorage` throws rather than returns null when site data is blocked,
 *     which is a normal thing for a browser to do and must not be a blank panel.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'chat.js'), 'utf8');

/** The constants and the geometry helpers, with `window`/`localStorage` supplied. */
function geom({ innerWidth = 1400, innerHeight = 900, store = null } = {}) {
  const consts = ['CHAT_GEOM_KEY', 'CHAT_MIN_W', 'CHAT_MIN_H']
    .map(k => SRC.match(new RegExp(`const ${k} = [^;]+;`))[0]).join('\n');
  const fns = ['_chatGeomRead', '_chatGeomWrite', '_chatClamp']
    .map(f => SRC.match(new RegExp(`function ${f}\\([\\s\\S]*?\\n\\}`))[0]).join('\n');

  const ls = store === 'throws'
    ? { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } }
    : store || { _m: new Map(), getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
                 setItem(k, v) { this._m.set(k, String(v)); } };

  return new Function('window', 'localStorage', `${consts}\n${fns}; return { _chatClamp, _chatGeomRead, _chatGeomWrite };`)(
    { innerWidth, innerHeight }, ls);
}

/* ── The clamp ────────────────────────────────────────── */

test('a window dragged past an edge keeps enough of itself to be grabbed again', () => {
  const { _chatClamp } = geom();

  // Flung off each side by a fast drag. The header is 40px tall and the margin
  // is 90px wide, so that much of the panel is always on screen and clickable.
  const right = _chatClamp({ x: 5000, y: 400, w: 380, h: 500 });
  assert.equal(right.x, 1400 - 90, 'the right edge stays on screen');
  assert.ok(right.x + right.w > 90, 'which is enough of it to grab');

  const left = _chatClamp({ x: -5000, y: 400, w: 380, h: 500 });
  assert.equal(left.x, 16 - 380 + 90, 'and so does the left');

  const up = _chatClamp({ x: 400, y: -5000, w: 380, h: 500 });
  assert.equal(up.y, 0, 'the header cannot be pushed above the viewport — it is the only handle there is');

  const down = _chatClamp({ x: 400, y: 5000, w: 380, h: 500 });
  assert.equal(down.y, 900 - 40);
});

test('a window cannot be resized to nothing, or past the screen', () => {
  const { _chatClamp } = geom();

  const tiny = _chatClamp({ x: 100, y: 100, w: 10, h: 10 });
  assert.equal(tiny.w, 320, 'below the minimum it stops shrinking');
  assert.equal(tiny.h, 260);

  const huge = _chatClamp({ x: 100, y: 100, w: 9999, h: 9999 });
  assert.equal(huge.w, 1400 - 16, 'and above the viewport it stops growing');
  assert.equal(huge.h, 900 - 16);

  // The minimum is a floor, not a preference: it wins over the viewport when
  // the two disagree. That only happens on a viewport this code is never asked
  // about — everything here is behind `_chatIsDesktop()`, and below 769px the
  // stylesheet owns the panel's geometry outright — so it is recorded rather
  // than defended against.
  const small = geom({ innerWidth: 300, innerHeight: 200 });
  assert.equal(small._chatClamp({ x: 0, y: 0, w: 380, h: 500 }).w, 320);
  assert.equal(small._chatClamp({ x: 0, y: 0, w: 380, h: 500 }).x, 0, 'and it is left-aligned, so the header is reachable');
});

/* ── Where it was left ────────────────────────────────── */

test('the position survives a reload, and a browser that forbids storage is not a blank panel', () => {
  const store = { _m: new Map(), getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
                  setItem(k, v) { this._m.set(k, String(v)); } };
  const g = geom({ store });

  // Nothing stored yet is the ordinary first run.
  assert.equal(g._chatGeomRead(), null);

  const at = { x: 300, y: 120, w: 420, h: 560 };
  g._chatGeomWrite(at);
  assert.deepEqual(g._chatGeomRead(), at, 'a window left somewhere comes back there');

  // Site data blocked: `localStorage` accessibility itself throws, which is a
  // normal browser behaviour rather than a corrupt value.
  const blocked = geom({ store: 'throws' });
  assert.equal(blocked._chatGeomRead(), null);
  blocked._chatGeomWrite(at);            // must not throw into the caller

  // And a value that is not geometry is treated as nothing rather than trusted,
  // because the panel is positioned from it without a second look.
  const junk = geom({ store: { getItem: () => '{"x":10}', setItem() {} } });
  assert.equal(junk._chatGeomRead(), null, 'a partial record is not a position');
  const notJson = geom({ store: { getItem: () => 'not json at all', setItem() {} } });
  assert.equal(notJson._chatGeomRead(), null);

  // The value is read back through the same clamp, so a window saved on a large
  // monitor and restored on a small one is brought back into view rather than
  // restored off the screen.
  const small = geom({ innerWidth: 800, innerHeight: 600, store });
  assert.deepEqual(small._chatClamp(g._chatGeomRead()), { x: 300, y: 120, w: 420, h: 560 });
  g._chatGeomWrite({ x: 3000, y: 2000, w: 420, h: 560 });
  const back = small._chatClamp(small._chatGeomRead());
  assert.equal(back.x, 800 - 90);
  assert.equal(back.y, 600 - 40);
});

/* ── The one thing the pointer plumbing must not do ───── */

test('a press on a button in the header is a press on that button', () => {
  // The header carries Close, Clear and the voice toggles, and it is also the
  // only drag handle. If the gesture started on a control, the panel would move
  // out from under a button that was being pressed — and preventDefault() on
  // that pointerdown would be reaching into a click that was never a drag.
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'chat.js'), 'utf8');
  const body = src.match(/function chatDragStart\([\s\S]*?\n\}/)[0];

  assert.match(body, /ev\.target\.closest\('button/, 'the guard is what keeps the buttons clickable');
  assert.ok(body.indexOf('closest(') < body.indexOf('_chatGesture('), 'and it has to come before the gesture, not after');

  // Run it: a press that began on a button reaches nothing.
  let gestures = 0;
  const drag = new Function('_chatGesture', 'document',
    `${body}; return chatDragStart;`)(() => { gestures++; }, { getElementById: () => ({}) });

  drag({ target: { closest: sel => (sel.includes('button') ? {} : null) } });
  assert.equal(gestures, 0);

  // And a press on the header itself still moves it.
  drag({ target: { closest: () => null } });
  assert.equal(gestures, 1);
});

'use strict';

/**
 * The panel's status lines: how long one lives, and which of the two restart
 * phrases one may carry.
 *
 * `setStatus()` is the only thing that clears a line now, so the rule lives
 * there and this drives it for real: `public/js/lib/status.js` is loaded into a vm
 * context with a fake element and a mocked clock, which is all it needs because
 * the function touches nothing but `textContent`, `className` and one timer.
 *
 * The wording half is the same kind of consistency one level up — three
 * phrasings of "restart to apply" became two, each meaning exactly one thing,
 * and these assertions are what stop a later edit merging the external stack's
 * restart with this panel's.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('node:fs');
const path = require('node:path');
const vm   = require('node:vm');

const JS   = path.join(__dirname, '..', 'public', 'js');
const read = f => fs.readFileSync(path.join(JS, f), 'utf8');
const { files } = require('./frontend');

/** A clock that only moves when the test says so, so nothing waits three seconds. */
function fakeClock() {
  const pending = new Map();
  let id = 0, now = 0;
  return {
    setTimeout(fn, ms) { pending.set(++id, { fn, at: now + ms }); return id; },
    clearTimeout(timer) { pending.delete(timer); },
    tick(ms) {
      now += ms;
      for (const [timer, { fn, at }] of [...pending]) if (at <= now) { pending.delete(timer); fn(); }
    },
  };
}

/** The real setStatus, out of the real file, in a context with no window. */
function loadUtils(clock) {
  const sandbox = { setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, console };
  vm.createContext(sandbox);
  return vm.runInContext(read('lib/status.js') + '\n;({ setStatus, STATUS_CLEAR_MS })', sandbox);
}

test('a status line fades when it is good news and stays when it is bad', () => {
  const clock = fakeClock();
  const { setStatus, STATUS_CLEAR_MS } = loadUtils(clock);
  const el = { textContent: '', className: '' };

  setStatus(el, '✓ Saved', 'ok');
  assert.equal(el.textContent, '✓ Saved');
  clock.tick(STATUS_CLEAR_MS - 1);
  assert.equal(el.textContent, '✓ Saved', 'long enough to read, which is the whole point of the delay');
  clock.tick(1);
  assert.equal(el.textContent, '', 'a success gets out of the way');

  setStatus(el, '✗ Nothing was saved', 'err');
  clock.tick(STATUS_CLEAR_MS * 10);
  assert.equal(el.textContent, '✗ Nothing was saved',
    'an error is the one message that outlives the moment it was drawn — a failure that erases itself reads as nothing having happened');
  assert.match(el.className, /status-line err/, 'and it keeps the class that colours it');

  // Why the timer is tracked per element rather than left to fire: a ✓ schedules
  // a wipe, the next call draws a ✗, and the stale timer erases an error nobody
  // has read yet.
  setStatus(el, '✓ Saved', 'ok');
  clock.tick(1000);
  setStatus(el, '✗ Came back wrong', 'err');
  clock.tick(STATUS_CLEAR_MS);
  assert.equal(el.textContent, '✗ Came back wrong', "the ✓'s timer must not wipe the ✗ that replaced it");

  // Overridable per call in both directions: a standing state is replaced by
  // the next report rather than by a clock, and a one-off can still pick its own
  // delay.
  setStatus(el, '✓ Enabled — openclaw-panel.service is running', 'ok', { clear: 0 });
  clock.tick(STATUS_CLEAR_MS * 10);
  assert.match(el.textContent, /service is running/, 'clear: 0 is how a state stays up');

  setStatus(el, 'gone shortly', 'warn', { clear: 10 });
  clock.tick(10);
  assert.equal(el.textContent, '');

  setStatus(el, '', '');
  assert.equal(el.textContent, '', 'an empty message wipes the line, as callers expect');
});

test('no panel clears its own status line', () => {
  // What this replaced: a 3000 in three files, a 4000 in setup.js, a 5000 in
  // the llama.cpp health check, and no clear at all almost everywhere else.
  // lib/status.js is the one place a status timer belongs; a second one at a call
  // site is how they drifted apart in the first place, and a second one is
  // also what would erase a newer message when the old delay elapses.
  const offenders = files().filter(f => f !== 'lib/status.js')
    .filter(f => /setTimeout\(\s*\(\s*\)\s*=>\s*setStatus\(/.test(read(f)));
  assert.deepEqual(offenders, [], 'a call site has gone back to timing its own status line');
});

test('the two restart phrases stay two phrases', () => {
  // Two restarts, two phrasings: "restart OpenClaw" is the external stack,
  // which reads ~/.openclaw/openclaw.json and docker-compose.yml; "restart
  // DOCA" is this process, which reads the prefs and the paths at boot. Both
  // comments say so where they are set — what must not come back is a third
  // phrasing for one of them, which is how "Restart the server" got here.
  assert.match(read('keys.js'), /restart OpenClaw to apply/);
  assert.match(read('config.js'), /restart OpenClaw\?/);
  assert.match(read('paths.js'), /restart DOCA to apply/);
  assert.match(read('settings/updates.js'), /Restart DOCA<\/strong> to apply/);

  const third = files()
    .filter(f => /restart the server/i.test(read(f)));
  assert.deepEqual(third, [], 'a third phrasing is back, and it belongs to one of the two meanings');

  // Nor may a hint say restart without naming what restarts, which is the shape
  // that let the same words mean either one.
  const vague = files()
    .filter(f => /restart to apply/i.test(read(f)));
  assert.deepEqual(vague, [], 'a restart hint does not say which restart it is');
});

test('no source file is stored as a binary', () => {
  // `public/js/harness.js` spent a release with a single NUL byte in it, put
  // there by an editor, inside a string that used it as a sentinel for "no
  // error to look for". Nothing looked wrong: git only sniffs the first 8 KB
  // for a NUL, so the diffs and the line counts were normal, and the file
  // loaded and ran. But `grep` classifies the *whole* file as binary and prints
  // nothing for it, and `file` calls it "data" — so every search across the
  // panel silently skipped its largest file, and a function that was right
  // there read as missing. That is how this was found, twice: once believing a
  // feature was never built, once believing a field name appeared nowhere.
  const walk = dir => fs.readdirSync(dir, { withFileTypes: true })
    .flatMap(e => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));

  const files = [...walk(JS), ...walk(path.join(__dirname, '..', 'modules'))].filter(f => f.endsWith('.js'));
  assert.ok(files.length > 50, 'the walk found the source tree');   // not an empty pass

  const binary = files.filter(f => fs.readFileSync(f).includes(0));
  assert.deepEqual(binary, [], 'a source file contains a NUL byte, so grep skips it entirely');
});

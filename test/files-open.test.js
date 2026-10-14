'use strict';

/**
 * Hub → Files opens a folder with the mouse (newcomer run 2026-10-14, a5): a click on a folder's name opens it, a
 * click elsewhere on the row selects, Ctrl/Shift on the name still add to the selection, and the hint line says how.
 * Run in a sandbox over the page's own scripts.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..', 'public');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

function sandbox() {
  const went = [];
  const ctx = { document: { addEventListener() {} }, localStorage: { getItem() { return null; }, setItem() {} },
    escHtml: s => String(s), fmtBytes: n => `${n} B`, jsArg: s => JSON.stringify(s), went };
  vm.createContext(ctx);
  vm.runInContext(`${read('js/lib/filetree.js')}\n${read('js/files.js')}`, ctx);
  vm.runInContext(read('js/files-open.js'), ctx);
  vm.runInContext('fmNavigate = p => { fm.cwd = p; went.push(p); }; fm.cwd = "/home/u";', ctx);
  return ctx;
}

test('a folder\'s name carries the click that opens it; a file\'s does not', () => {
  const c = sandbox();
  const dir = vm.runInContext('fmRowHTML({ name: "docs", isDir: true })', c);
  const file = vm.runInContext('fmRowHTML({ name: "a.txt", isDir: false, size: 3 })', c);
  assert.match(dir, /class="fm-name"[^>]*onclick="fmOpenByName\(event, "\/home\/u\/docs"\)"/);
  assert.match(dir, /ondblclick="fmDblClick/, 'a double-click on the row still opens');
  assert.doesNotMatch(file, /fmOpenByName/);
});

test('one click on the name opens; with Ctrl or Shift it leaves the row to select', () => {
  const c = sandbox();
  let stopped = 0;
  const ev = mods => ({ ctrlKey: false, metaKey: false, shiftKey: false, ...mods, stopPropagation() { stopped++; } });
  c.fmOpenByName(ev({ ctrlKey: true }), '/home/u/docs');
  c.fmOpenByName(ev({ shiftKey: true }), '/home/u/docs');
  assert.equal(c.went.length, 0);
  assert.equal(stopped, 0, 'the row\'s own click still runs and selects');
  c.fmOpenByName(ev({}), '/home/u/docs');
  c.fmOpenByName(ev({}), '/home/u/docs');   // the second click of a double-click
  assert.deepEqual([...c.went], ['/home/u/docs']);
});

test('the hint line names the mouse\'s way in, and the page loads the script', () => {
  const html = read('index.html');
  assert.match(html, /fm-kbd-hints">Click a folder's name or double-click its row to open it/);
  assert.match(html, /<script src="js\/files-open\.js"><\/script>/);
});

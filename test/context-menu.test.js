'use strict';

/**
 * The shared file menu (public/js/lib/context-menu.js, asked 2026-10-12): one list of actions, in one order, for the
 * Files list, its tree and the Projects tree — each entry only when the page gave the function behind it, Delete last,
 * "Show in Files" only away from Files, and the keyboard's menu key. Run in a sandbox: the menu's own DOM is checked
 * in a browser (the screenshots and `npm run smoke`).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = f => fs.readFileSync(path.join(__dirname, '..', 'public', 'js', f), 'utf8');

function sandbox(tab = 'files') {
  const ctx = { currentTab: tab, fmNavigate() {}, fmMediaType: n => (/\.png$/.test(n) ? 'image' : null), mediaViewerOpen() {},
    escHtml: s => String(s), appAlert() {}, navigator: {}, window: {}, document: {}, encodeURIComponent };
  vm.createContext(ctx);
  vm.runInContext(read('lib/context-menu.js'), ctx);
  return ctx;
}

const labels = items => JSON.parse(JSON.stringify(items.filter(Boolean).map(i => (i.sep ? '—' : i.label))));
const all = { open() {}, rename() {}, duplicate() {}, newFile() {}, newFolder() {}, upload() {}, remove() {} };

test('a file in Files: open, preview, a new tab, rename, duplicate, download, copy path, new and upload beside it, ask, delete', () => {
  const c = sandbox('files');
  const items = c.fileMenuItems({ abs: '/home/u/pic.png', isDir: false, ...all });
  assert.deepEqual(labels(items), ['Open', 'Preview', 'Open in a new tab', '—', 'Rename', 'Duplicate', 'Download', 'Copy path', '—',
    'New file beside it', 'New folder beside it', 'Upload beside it', '—', 'Ask the agent about this', '—', 'Delete']);
  assert.equal(items.filter(Boolean).pop().danger, true, 'Delete is the danger, and last');
});

test('a folder from Projects: no download or new tab, "here", and Show in Files', () => {
  const c = sandbox('projects');
  const got = [];
  const items = c.fileMenuItems({ abs: '/p/src', isDir: true, ...all, newFile: d => got.push(d), extra: [{ label: 'Mine', fn() {} }] }).filter(Boolean);
  const l = labels(items);
  assert.ok(!l.includes('Download') && !l.includes('Open in a new tab'));
  assert.ok(l.includes('New file here') && l.includes('Upload here'));
  assert.ok(l.indexOf('Mine') < l.indexOf('Show in Files'), 'the page\'s own entries come before Show in Files');
  items.find(i => i.label === 'New file here').fn();
  assert.deepEqual(got, ['/p/src'], 'a new file goes into the folder itself');
});

test('only what the page offers: no rename, duplicate or delete when it gave none; a file\'s new file goes beside it', () => {
  const c = sandbox('files');
  const got = [];
  const l = labels(c.fileMenuItems({ abs: '/a/b.txt', isDir: false, newFile: d => got.push(d) }));
  for (const missing of ['Open', 'Rename', 'Duplicate', 'Delete', 'Upload beside it']) assert.ok(!l.includes(missing), missing);
  c.fileMenuItems({ abs: '/a/b.txt', isDir: false, newFile: d => got.push(d) }).find(i => i && i.label === 'New file beside it').fn();
  assert.deepEqual(got, ['/a']);
});

test('the keyboard\'s right-click: the context-menu key and Shift+F10, not F10 alone', () => {
  const c = sandbox();
  assert.equal(c.ctxMenuKey({ key: 'ContextMenu' }), true);
  assert.equal(c.ctxMenuKey({ key: 'F10', shiftKey: true }), true);
  assert.equal(c.ctxMenuKey({ key: 'F10' }), false);
});

test('Files, its tree and Projects all open this one menu', () => {
  const tree = read('lib/filetree.js'), list = read('files-menu.js');
  assert.match(tree, /ctxMenuOpen\(x, y, fileMenuItems\(/, 'the tree (Files\' sidebar and Projects)');
  assert.match(tree, /ctxMenuKey\(ev\)/, 'with Shift+F10 in the tree');
  assert.match(tree, /ctxLongPress\(row/, 'and a long press');
  assert.match(list, /fileMenuItems\(\{/, 'the Files list');
  assert.match(list, /ctxMenuKey\(ev\)/);
  assert.doesNotMatch(read('files.js'), /function fmContextMenu|function showContextModal/, 'no second copy left in files.js');
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.ok(html.indexOf('js/lib/context-menu.js') < html.indexOf('js/lib/filetree.js'), 'loaded before the tree');
});

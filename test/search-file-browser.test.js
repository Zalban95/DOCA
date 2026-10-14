'use strict';

/**
 * A file the header search found opens in Files at its own folder, selected (asked 2026-10-14: it opened the home
 * folder — the tab's first load went home after the search had asked for the file's folder). In a real browser, on a
 * panel whose Files tab was never opened. Skipped where no Chrome, Edge or Chromium is found.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const H = require('./helpers');   // first: it points the settings at a temporary folder
const B = require('./panel-browser');

let dir, file;
before(async () => {
  dir = fs.mkdtempSync(path.join(require('node:os').homedir(), '.doca-search-file-'));
  for (let i = 0; i < 40; i++) fs.writeFileSync(path.join(dir, `note-${String(i).padStart(2, '0')}.txt`), 'x');
  file = path.join(dir, 'note-33.txt');
  await B.start({ setup: B.pastFirstRun });
});
after(async () => { await B.stop(); fs.rmSync(dir, { recursive: true, force: true }); });

test('a file result opens its own folder with the file selected, on a Files tab never opened before', { skip: B.skip }, async () => {
  await B.evaluate(`globalSearchGo(${JSON.stringify(file)}, false)`);
  assert.ok(await B.until(`fm.cwd === ${JSON.stringify(dir)} && document.querySelector('.fm-row.selected')?.dataset.path === ${JSON.stringify(file)}`, 15000),
    await B.evaluate('JSON.stringify({ cwd: fm.cwd, sel: [...fm.selected] })'));
  assert.deepEqual(await B.evaluate('[...fm.selected]'), [file]);
  // And again once the tab is drawn: another file, in another folder (here the same), selected.
  const other = path.join(dir, 'note-05.txt');
  await B.evaluate(`globalSearchGo(${JSON.stringify(other)}, false)`);
  assert.ok(await B.until(`document.querySelector('.fm-row.selected')?.dataset.path === ${JSON.stringify(other)}`, 10000));
});

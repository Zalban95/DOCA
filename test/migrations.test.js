'use strict';

/**
 * Prefs migrations (TODO H2.5): a renamed or moved key reaches the installs that have the old one, once, with a
 * copy of the file kept first; a new file is born having had them all.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const H = require('./helpers');

before(H.start);
after(H.stop);

const M = () => require('../modules/migrations');
const list = () => [
  { id: 'a-rename', note: 'tts.voice became voice.tts', steps: [M().move('tts.voice', 'voice.tts')] },
  { id: 'b-default', note: 'the poll wait went from 10 to 25', steps: [M().defaultChanged('channels.telegram.pollSec', 10, 25)] },
  { id: 'c-drop', note: 'nothing reads skin', steps: [M().drop('skin')] },
];

test('a moved key arrives under its new name, and the old one leaves no empty object behind', () => {
  const { prefs, ran } = M().run({ tts: { voice: 'alba' }, theme: 'dark' }, list(), 'T');
  assert.equal(prefs.voice.tts, 'alba');
  assert.equal(prefs.tts, undefined, 'the emptied parent is gone too');
  assert.equal(prefs.theme, 'dark', 'everything else is untouched');
  assert.deepEqual(ran.map(r => r.id), ['a-rename', 'b-default', 'c-drop']);
  assert.deepEqual(ran[0].changed, ['tts.voice → voice.tts']);
  assert.deepEqual(prefs.migrations.applied, ['a-rename', 'b-default', 'c-drop']);
  assert.deepEqual(prefs.migrations.log.map(l => l.id), ['a-rename'], 'only what changed something is logged');
});

test('when both names exist the new one wins: newer code wrote it', () => {
  const { prefs } = M().run({ tts: { voice: 'old', speed: 1 }, voice: { tts: 'new' } }, list());
  assert.equal(prefs.voice.tts, 'new');
  assert.deepEqual(prefs.tts, { speed: 1 }, 'a sibling of the moved key stays');
});

test('a value equal to the old default follows it; a chosen one stays', () => {
  assert.equal(M().run({ channels: { telegram: { pollSec: 10 } } }, list()).prefs.channels.telegram.pollSec, 25);
  assert.equal(M().run({ channels: { telegram: { pollSec: 40 } } }, list()).prefs.channels.telegram.pollSec, 40);
});

test('a migration runs once per file, and the record says so', () => {
  const first = M().run({ tts: { voice: 'x' } }, list()).prefs;
  first.tts = { voice: 'written again by an old version' };
  const again = M().run(first, list());
  assert.deepEqual(again.ran, [], 'nothing runs twice');
  assert.equal(again.prefs.tts.voice, 'written again by an old version');
  // A new migration later runs on its own.
  const more = [...list(), { id: 'd-new', note: '', steps: [M().move('tts.voice', 'voice.tts')] }];
  assert.deepEqual(M().run(first, more).ran.map(r => r.id), ['d-new']);
});

test('at start the file is rewritten only when something ran, with a copy kept first; no file is never created', () => {
  const dir = path.join(H.tmp, 'mig'); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'prefs.json');
  assert.deepEqual(M().apply({ file, list: list(), log: () => {} }).ran, []);
  assert.equal(fs.existsSync(file), false, 'a missing prefs file stays missing');

  fs.writeFileSync(file, '{not json');
  assert.match(M().apply({ file, list: list(), log: () => {} }).error, /not JSON/);
  assert.equal(fs.readFileSync(file, 'utf8'), '{not json', 'a broken file is left for a person');

  const before = JSON.stringify({ tts: { voice: 'alba' } });
  fs.writeFileSync(file, before);
  const lines = [];
  const r = M().apply({ file, list: list(), log: l => lines.push(l) });
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).voice.tts, 'alba');
  assert.equal(fs.readFileSync(r.backup, 'utf8'), before, 'the copy is the file as it was');
  assert.match(lines.join('\n'), /a-rename: tts\.voice → voice\.tts/);
  const mtime = fs.statSync(file).mtimeMs;
  assert.deepEqual(M().apply({ file, list: list(), log: () => {} }).ran, []);
  assert.equal(fs.statSync(file).mtimeMs, mtime, 'nothing to do writes nothing');
});

test('a new prefs file is born having had every migration; an existing one is never stamped', () => {
  assert.deepEqual(M().stamp({ theme: 'x' }, list()).migrations.applied, ['a-rename', 'b-default', 'c-drop']);
  const existing = { theme: 'x', migrations: { applied: ['a-rename'] } };
  assert.equal(M().stamp(existing, list()), existing);

  const { savePrefs, loadPrefs } = require('../modules/utils');
  const { PREFS_FILE } = require('../modules/paths');
  const kept = fs.existsSync(PREFS_FILE) ? fs.readFileSync(PREFS_FILE) : null;
  try {
    fs.rmSync(PREFS_FILE, { force: true });
    savePrefs({ theme: 'dark' });
    assert.ok(Array.isArray(loadPrefs().migrations.applied), 'the record is written with the file');
  } finally { if (kept) fs.writeFileSync(PREFS_FILE, kept); else fs.rmSync(PREFS_FILE, { force: true }); }
});

test('Settings → System lists every migration and whether this install has had it', async () => {
  const r = await H.api(null, 'GET', '/api/settings/migrations');
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body.migrations));
  for (const m of r.body.migrations) assert.ok(m.id && Array.isArray(m.steps) && typeof m.applied === 'boolean');
});

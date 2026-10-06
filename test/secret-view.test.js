'use strict';

/**
 * The agent's file tools see the settings file's secrets masked (harness/secret-view.js; audit 2026-10-06, coh F1):
 * read_file masks them, search_files leaves the file out, write_file refuses the mask, http_fetch never uploads it.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const H     = require('./helpers');
const paths = require('../modules/paths');
const store = require('../modules/store');
const tools = require('../modules/harness/tools');
const sv    = require('../modules/harness/secret-view');

const BOT = 'bot-123456:SECRETVALUE', BEARER = 'ha-long-lived-SECRET';

test.before(() => H.start());
test.after(() => H.stop());

function writePrefs() {
  fs.writeFileSync(paths.PREFS_FILE, JSON.stringify({
    theme: 'dark',
    channels: { telegram: { enabled: true, botToken: BOT } },
    mcpServers: { ha: { url: 'http://ha.local/mcp', headers: { Authorization: `Bearer ${BEARER}` } } },
  }, null, 2));
}

test('read_file shows the settings file with its secrets masked, and everything else as it is', async () => {
  writePrefs();
  const out = await tools.call('read_file', { path: paths.PREFS_FILE });
  assert.doesNotMatch(out, /SECRET/);
  assert.match(out, /"botToken": "••••••••"/);
  assert.match(out, /"theme": "dark"/);
  assert.match(out, /ha\.local/, 'addresses stay readable');

  const copy = path.join(store.DATA_DIR, 'migrations', 'prefs-2026-10-06.json');
  fs.mkdirSync(path.dirname(copy), { recursive: true });
  fs.copyFileSync(paths.PREFS_FILE, copy);
  assert.doesNotMatch(await tools.call('read_file', { path: copy }), /SECRET/, 'a migration copy');

  const cp = path.join(store.DATA_DIR, 'checkpoints', 'prefs', 'x.json');
  fs.mkdirSync(path.dirname(cp), { recursive: true });
  fs.writeFileSync(cp, JSON.stringify({ id: 'x', prefs: fs.readFileSync(paths.PREFS_FILE, 'utf8') }));
  assert.doesNotMatch(await tools.call('read_file', { path: cp }), /SECRET/, 'a checkpoint, whose prefs are a string');

  const env = path.join(H.tmp, '.env');
  fs.writeFileSync(env, `PORT=4242\nexport TELEGRAM_BOT_TOKEN=${BOT}\nOPENAI_API_KEY=sk-SECRET\n`);
  const e = await tools.call('read_file', { path: env });
  assert.doesNotMatch(e, /SECRET/);
  assert.match(e, /PORT=4242/);

  const plain = path.join(H.tmp, 'fixture.json');
  fs.writeFileSync(plain, JSON.stringify({ token: 'not-a-real-one' }));
  assert.match(await tools.call('read_file', { path: plain }), /not-a-real-one/, 'an ordinary JSON file is not touched');
});

test('broken JSON is masked line by line', () => {
  const out = sv.view(paths.PREFS_FILE, `{ "botToken": "${BOT}", "theme": "dark", `);
  assert.doesNotMatch(out, /SECRET/);
  assert.match(out, /dark/);
});

test('search_files leaves a file holding secrets out and says so', async () => {
  writePrefs();
  const out = await tools.call('search_files', { path: path.dirname(paths.PREFS_FILE), query: 'SECRETVALUE', include: '*.json' });
  assert.doesNotMatch(out, /bot-123456/);
  if (out.includes('left out')) assert.match(out, /hold secrets/);
  const one = await tools.call('search_files', { path: paths.PREFS_FILE, query: 'SECRET' });
  assert.doesNotMatch(one, /bot-123456/, 'one file named');
  assert.match(one, /left out: .*hold secrets/);
});

test('write_file refuses to write the mask back over the secrets', async () => {
  writePrefs();
  const masked = await tools.call('read_file', { path: paths.PREFS_FILE });
  const env = path.join(fs.mkdtempSync(path.join(H.tmp, 'proj-')), '.env');   // a project's, not the panel's own
  fs.writeFileSync(env, 'A=1\n');
  assert.match(await tools.call('write_file', { path: env, content: `A=1\nHF_TOKEN=${sv.MASK}\n` }), /holds secrets/);
  assert.match(await tools.call('write_file', { path: paths.PREFS_FILE, content: masked }), /^Error:/);
  assert.match(fs.readFileSync(paths.PREFS_FILE, 'utf8'), /bot-123456/, 'the real token is still there');
});

test('kindOf knows the copies and leaves examples alone', () => {
  assert.equal(sv.kindOf(paths.PREFS_FILE), 'json');
  assert.equal(sv.kindOf(`${paths.PREFS_FILE}.bak`), 'json');
  assert.equal(sv.kindOf(paths.CONFIG_PATH), 'json');
  assert.equal(sv.kindOf(path.join(H.tmp, '.env.local')), 'env');
  assert.equal(sv.kindOf(path.join(H.tmp, '.env.example')), null);
  assert.equal(sv.kindOf(path.join(H.tmp, 'notes.json')), null);
});

'use strict';

/**
 * The feature index (modules/features; CONSTITUTION §0 and W14, TODO P1.7): every experiment, every page, every
 * Settings section and every tool has an entry, so a feature cannot land without the agents being able to find it;
 * the agent finds them with a free tool; alternatives are counted, and an unused one is hidden from the default —
 * by the admin, never removed.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const H      = require('./helpers');   // first: it points the settings at a temporary folder

test.before(() => H.start());
test.after(() => H.stop());

const features = () => require('../modules/features');

test('every experiment, page, Settings section and tool has an entry', () => {
  const all = features().all();
  const { NAV_TABS, SUB } = require('../modules/features/pages').lists();
  assert.ok(NAV_TABS.length > 10 && SUB.length > 10, 'the panel\'s lists were read');
  const pages = new Set(all.flatMap(f => f.page));
  // Settings is the sections below it: each of those has its own.
  for (const t of NAV_TABS.filter(x => x !== 'settings')) assert.ok(pages.has(t), `the page ${t} has no feature: add one to modules/features/data`);
  for (const s of SUB) assert.ok(pages.has(`settings/${s.id}`) || (s.page && pages.has(s.page)), `Settings → ${s.label} has no feature`);
  for (const e of require('../modules/experiments').EXPERIMENTS)
    assert.ok(all.some(f => f.flag === e.id && f.state === 'experiment'), `the experiment ${e.id} has no feature`);
  const tools = new Set(all.flatMap(f => f.tools));
  for (const t of require('../modules/harness/tools').TOOLS) assert.ok(tools.has(t.name), `the tool ${t.name} has no feature`);
  for (const alias of Object.keys(require('../modules/harness/tools').ALIASES))
    assert.ok(all.some(f => f.state === 'alternative' && f.uses === `tool:${alias}`), `the old name ${alias} is an alternative`);
});

test('each entry is well formed: one id, a line that says what it is for, a real page, setting and switch', () => {
  const all = features().all();
  const { NAV_TABS, SUB } = require('../modules/features/pages').lists();
  const schema = require('../modules/settings-schema').SCHEMA;
  const flags = new Set(require('../modules/experiments').EXPERIMENTS.map(e => e.id));
  const ids = all.map(f => f.id);
  assert.equal(new Set(ids).size, ids.length, 'an id used twice');
  for (const f of all) {
    assert.ok(/^[a-z0-9-]+$/.test(f.id) && f.name, `${f.id}: an id and a name`);
    assert.ok(f.use.length >= 30 && f.use.length <= 200 && /[.!?]$/.test(f.use), `${f.id}: one whole line about what it is for`);
    assert.ok(Object.keys(features().STATES).includes(f.state), `${f.id}: state ${f.state}`);
    for (const p of f.page) assert.ok(NAV_TABS.includes(p) || SUB.some(s => `settings/${s.id}` === p), `${f.id}: no page ${p}`);
    for (const s of f.settings) assert.ok(schema[s.split('.')[0]], `${f.id}: no setting ${s}`);
    if (f.flag) assert.ok(flags.has(f.flag), `${f.id}: no experiment ${f.flag}`);
    if (f.state === 'alternative') {
      assert.ok(features().get(f.beside) && f.uses, `${f.id}: stands beside a feature and is counted`);
      assert.ok(features().get(f.beside).uses, `${f.beside}: counts its own use, to compare with ${f.id}`);
    }
  }
});

test('the agent looks features up with a free tool, and finds them by plain words', async () => {
  const tools = require('../modules/harness/tools');
  assert.ok(require('../modules/harness/approval').FREE.has('features'), 'reading the index asks nobody');
  assert.equal(require('../modules/harness/kits').kitOf('features'), 'panel');
  assert.match(await tools.call('features', { find: 'telegram bot' }), /Channels: Telegram/);
  assert.match(await tools.call('features', { find: 'say its name to start a call' }), /wake/i);
  assert.match(await tools.call('features', { id: 'web-search' }), /Kept beside it: .*DuckDuckGo/);
  assert.match(await tools.call('features', { find: 'zzqx' }), /Nothing indexed/);
  assert.match(await tools.call('features', {}), /\d+ features are indexed/);
  const prompt = require('../modules/harness/agent').preview({ message: 'x' });
  assert.ok(!prompt.includes('Every word on the screen and where'), 'the index is looked up, not pasted into the prompt');
});

test('alternatives are counted; an unused one is a candidate, and the admin hides it from the default — never removes it', async () => {
  const usage = require('../modules/features/usage');
  const store = require('../modules/store');
  // Counting began 40 days ago; since then web search ran 50 times through the default provider, never through Brave.
  usage.reset();
  store.writeJson('features/usage', { since: new Date(Date.now() - 40 * 86400000).toISOString(), keys: {} });
  usage.reset();
  for (let i = 0; i < 50; i++) usage.count('tool:web_search');
  usage.count('search:duckduckgo');
  await require('../modules/harness/tools').call('show_image', { path: '/nonexistent.png' });   // an old name is counted as called
  assert.equal(usage.of('tool:show_image').n, 1);

  const rows = Object.fromEntries(require('../modules/features/review').review().map(r => [r.id, r]));
  assert.equal(rows['search-brave'].candidate, true, 'unused for 40 days while its replacement ran 50 times');
  assert.match(rows['search-brave'].recommendation, /hide it from the default/);
  assert.equal(rows['search-duckduckgo'].candidate, false, 'in use');
  assert.equal(rows['show-image'].candidate, false);

  const list = (await H.api(null, 'GET', '/api/features')).body;
  assert.ok(list.features.length > 100 && list.review.some(r => r.id === 'search-brave' && r.candidate));
  assert.equal((await H.api(null, 'POST', '/api/features/search-brave/hidden', { on: true })).body.hidden, true);
  assert.equal((await H.api(null, 'POST', '/api/features/web-search/hidden', { on: true })).status, 400, 'only an alternative leaves the default');
  assert.ok(require('../modules/harness/settings').refuse('features.hidden', []), 'the admin\'s decision: never proposable');
  const out = await require('../modules/harness/tools').call('features', { find: 'brave search' });
  assert.match(out, /hidden from the default by the admin, still works/);
  assert.ok(features().get('search-brave'), 'still in the index');

  const member = await H.signIn('member');
  assert.equal((await H.api(null, 'POST', '/api/features/search-brave/hidden', { on: false }, { Cookie: member.cookie })).status, 403);
  assert.equal((await H.api(null, 'POST', '/api/features/search-brave/hidden', { on: false })).body.hidden, false);
  usage.flush();
  assert.ok(store.readJson('features/usage', {}).keys['tool:web_search'].n >= 50, 'kept in the data folder');
});

test('every feature names its licence code, and every table, route and socket belongs to a feature', () => {
  const all = features().all();
  const { CODES } = require('../modules/license/codes');
  const gate = require('../modules/license/gate');
  for (const f of all) assert.ok(CODES[f.licence], `${f.id}: licence "${f.licence}" is not a code in modules/license/codes.js`);
  for (const f of all.filter(x => x.state === 'experiment')) assert.equal(f.licence, 'lab', `${f.id}: an experiment is the lab's (CONSTITUTION S5)`);
  // Tables: each made by a schema step that names its feature, and owned by exactly one feature of the same licence.
  const owner = {};
  for (const f of all) for (const t of f.tables) { assert.ok(!owner[t], `the table ${t} is in two features`); owner[t] = f; }
  for (const s of require('../modules/db/migrations').STEPS) {
    const sf = features().get(s.feature);
    assert.ok(sf, `db step ${s.id} names no feature (modules/db/migrations.js)`);
    for (const sql of s.sql) {
      const m = /CREATE TABLE IF NOT EXISTS (\w+)/.exec(sql);
      if (!m || /_v\d+$/.test(m[1])) continue;   // a table rebuilt and renamed back to its own name
      assert.ok(owner[m[1]], `the table ${m[1]} has no feature: add it to an entry's tables`);
      assert.equal(owner[m[1]].licence, sf.licence, `the table ${m[1]} and its step ${s.id} are licensed alike`);
    }
  }
  // Routes: every path the app and its routers register, and every socket terminal.js routes, is some feature's.
  const app = require('../server').createApp();
  const paths = [];
  const walk = (stack, prefix) => {
    for (const layer of stack) {
      if (layer.route) for (const p of [].concat(layer.route.path)) { if (typeof p === 'string') paths.push(prefix + p); }
      else if (layer.handle?.stack) {
        const mount = (layer.regexp.source.match(/^\^\\\/((?:[^?\\]|\\\/)+)/) || [])[1];
        walk(layer.handle.__licenceAll || layer.handle.stack, mount ? `${prefix}/${mount.replace(/\\\//g, '/')}` : prefix);
      }
    }
  };
  walk(app._router.stack, '');
  assert.ok(paths.length > 500 && paths.some(p => p.startsWith('/api/v1/')), 'the walk found the routes and the device API');
  const sockets = [...require('fs').readFileSync(require.resolve('../modules/terminal'), 'utf8').matchAll(/req\.url(\.startsWith\(|\s===\s)'([^']+)'/g)].map(m => (m[1] === ' === ' ? m[2] : `${m[2]}x`));
  assert.ok(sockets.length >= 8, 'the sockets were read');
  const orphans = [...paths, ...sockets].filter(p => p !== '/' && !gate.ownerOf(p));
  assert.deepEqual(orphans, [], 'add a routes pattern to the feature it belongs to (modules/features/data)');
});

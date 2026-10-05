'use strict';

// An edition is a pack (modules/packs/edition.js; hive.md §6, TODO H12): names, how screens start out, a face and a
// level travel in edition.json; importing it is the same dry run as any pack, and a level never carries more rights
// than the person bringing it in holds.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

before(() => H.start());
after(() => H.stop());

const upload = async (route, buffer, fields = {}, headers) => {
  const form = new FormData();
  form.append('file', new Blob([buffer]), 'e.dpack');
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  return H.api(null, 'POST', route, form, headers);
};
const exportPack = async body => {
  try { return { status: 200, buffer: require('../modules/packs/export').build(body).buffer }; } catch (e) { return { status: e.status || 500, error: e.message }; }
};

let pack;

test('an edition carries names, the screens\' defaults, a face and a level of your own', async () => {
  const lvl = await H.api(null, 'POST', '/api/auth/levels', { id: 'support', name: 'Support', rights: ['read', 'chat'], tools: { allow: ['memory_search'], deny: [] } });
  assert.equal(lvl.status, 200, JSON.stringify(lvl.body));
  const u = require('../modules/utils');
  u.savePrefs({ ...u.loadPrefs(), branding: { product: 'Acme Desk', vendor: 'Acme' }, theme: 'dracula', hiddenTabs: ['docker', 'vms'], face: { spec: { palette: { dot: '#ff6600' } } } });
  const builtin = await exportPack({ name: 'x', edition: { level: 'admin' } });
  assert.equal(builtin.status, 400, 'a built-in level is in every DOCA already');
  const r = await exportPack({ name: 'acme', edition: { branding: true, look: true, face: true, level: 'support' } });
  assert.equal(r.status, 200);
  pack = r.buffer;
  const files = require('../modules/packs/zip').read(pack);
  const e = JSON.parse(files.find(f => f.name === 'edition.json').data.toString());
  assert.deepEqual(e.branding, { product: 'Acme Desk', vendor: 'Acme' });
  assert.deepEqual(e.look, { theme: 'dracula', hiddenTabs: ['docker', 'vms'] });
  assert.deepEqual(e.face, { palette: { dot: '#ff6600' } });
  assert.equal(e.level.name, 'Support');
  assert.deepEqual(JSON.parse(files.find(f => f.name === 'pack.json').data.toString()).contents, [{ kind: 'edition', parts: ['branding', 'look', 'face', 'level'], path: 'edition.json' }]);
});

test('another hive sees each part in the plan, and gets them on import', async () => {
  const u = require('../modules/utils');
  const { branding, theme, hiddenTabs, face, ...rest } = u.loadPrefs();
  u.savePrefs(rest);
  const levels = require('../modules/auth/levels');
  require('../modules/db').syncHandle().prepare("DELETE FROM levels WHERE id = 'support'").run();
  const plan = (await upload('/api/packs/plan', pack)).body;
  const it = plan.items.find(i => i.kind === 'edition');
  assert.equal(it.overwrites, false);
  assert.match(it.parts, /names: product "Acme Desk"/);
  assert.match(it.parts, /2 tabs hidden/);
  assert.match(it.parts, /level "Support" \(read, chat\)/);
  const done = (await upload('/api/packs/import', pack, { only: JSON.stringify([it.key]) })).body.done;
  assert.equal(done[0].ok, true, JSON.stringify(done));
  assert.match(done[0].note, /names, look, face, level "Support" added/);
  assert.equal(require('../modules/branding').name('product'), 'Acme Desk');
  assert.equal(levels.get('support').name, 'Support');
  const screen = (await H.api(null, 'GET', '/api/screen')).body;
  assert.deepEqual(screen.settings.hiddenTabs, ['docker', 'vms'], 'every screen starts out with the edition\'s look');
  assert.deepEqual(screen.settings.face.spec, { palette: { dot: '#ff6600' } }, 'and its face');
});

test('a level that exists is replaced only when asked; the importer\'s ceiling holds', async () => {
  const levels = require('../modules/auth/levels');
  levels.update('support', { name: 'Support (local)' }, { actorLevel: 'owner' });
  const key = (await upload('/api/packs/plan', pack)).body.items.find(i => i.kind === 'edition').key;
  let done = (await upload('/api/packs/import', pack, { only: JSON.stringify([key]) })).body.done;
  assert.match(done[0].note, /kept as it is here/);
  assert.equal(levels.get('support').name, 'Support (local)');
  done = (await upload('/api/packs/import', pack, { only: JSON.stringify([key]), overwrite: 'true' })).body.done;
  assert.match(done[0].note, /replaced/);
  assert.equal(levels.get('support').name, 'Support');

  // An edition whose level holds host, brought in by someone without it, is refused that part.
  const zip = require('../modules/packs/zip');
  const evil = zip.write([{ name: 'edition.json', data: JSON.stringify({ format: 'doca-edition', version: 1, branding: { product: 'X', nonsense: 'dropped' }, level: { id: 'root', name: 'Root', rights: ['read', 'host'] } }) }]);
  const r = require('../modules/packs/import').apply(evil, { actorLevel: 'member' });
  assert.match(r.done[0].error, /rights you do not hold: host/);
  assert.equal(levels.get('root'), null);
  assert.equal(require('../modules/utils').loadPrefs().branding.nonsense, undefined, 'only names the panel has');
});

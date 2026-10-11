'use strict';

/** Hub → Files' shortcuts as the platform this is (modules/files-places.js; the owner, 2026-10-12). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const H = require('./helpers');

test.before(() => H.start());
test.after(() => H.stop());

test('the shortcuts come in groups: the product\'s own folders, projects, harnesses — never OpenClaw first', async () => {
  const r = await H.api(null, 'GET', '/api/paths');
  const places = r.body.places;
  assert.ok(Array.isArray(places) && places.length);
  assert.equal(places[0].id, 'home');
  const groups = [...new Set(places.map(p => p.group))];
  assert.equal(groups[0], require('../modules/branding').name('product'), 'the product\'s own come first, by its branded name');
  assert.ok(!places.some(p => p.group !== 'Harnesses' && /openclaw/i.test(p.label)), 'OpenClaw is one harness among others');
  for (const p of places) assert.ok(p.missing || fs.existsSync(p.path), `${p.label} leads somewhere`);
});

test('a project is a shortcut; a command-line harness is one by its own settings folder, never the home folder', () => {
  const fp = require('../modules/files-places');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fp-proj-'));
  const store = require('../modules/projects/store');
  const p = store.create({ name: 'Shortcut test', root: dir });
  assert.ok(fp.projectPlaces().some(x => x.path === dir && x.group === 'Projects'));
  store.remove?.(p.id);
  assert.ok(!fp.harnessPlaces(require('../modules/paths')).some(x => path.resolve(x.path) === path.resolve(os.homedir())));
});

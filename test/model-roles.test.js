'use strict';

/** Which model does what is one list (modules/model-roles.js; audit 2026-10-06, coh F11, TODO C4). */
const test   = require('node:test');
const assert = require('node:assert/strict');

const H = require('./helpers');
test.before(() => H.start());
test.after(() => H.stop());

test('every model setting the schema declares is a role, and the scout reads its own subset', () => {
  const roles = require('../modules/model-roles').roles();
  const settings = new Set(roles.map(r => r.setting).filter(Boolean));
  const { SCHEMA } = require('../modules/settings-schema');
  const leaves = [];
  for (const [top, def] of Object.entries(SCHEMA)) for (const k of Object.keys(def.keys || {})) if (/model$/i.test(k) && top !== 'experiments') leaves.push(`${top}.${k}`);
  assert.ok(leaves.length >= 5, leaves.join());
  assert.deepEqual(leaves.filter(l => !settings.has(l)), [], 'a model setting with no row in model-roles.js');
  const scout = require('../modules/scout/roles').roles();
  assert.ok(scout.every(r => Array.isArray(r.tasks) && r.tasks.length) && scout.some(r => r.id === 'harness') && !scout.some(r => r.id === 'fallback'));
});

test('the panel and the agent read the same list', async () => {
  const r = await H.api(null, 'GET', '/api/models/roles');
  assert.equal(r.status, 200);
  assert.ok(r.body.roles.some(x => x.id === 'stt'));
  const out = await require('../modules/harness/tools').call('settings_read', {});
  assert.match(out, /Models in use:\n- The agent's model: /);
});

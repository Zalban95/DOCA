'use strict';

// Every setting declared once (modules/settings-schema.js, TODO H2.1): its home, whether it travels, where the
// agent may propose, and its typed leaves with defaults that reach every install which never set them.

const test = require('node:test');
const assert = require('node:assert/strict');
const schema = require('../modules/settings-schema');

test('every key says what it is, whether it travels and where it lives', () => {
  for (const [k, d] of Object.entries(schema.SCHEMA)) {
    assert.ok(['travels', 'local', 'mixed'].includes(d.is), `${k}.is`);
    assert.ok(['hive', 'device', 'person'].includes(d.home), `${k}.home`);
    if (d.home === 'device') assert.ok(['host', 'screen'].includes(d.on), `${k}: a device key says whether it is the host's or a screen's`);
    assert.ok(d.note?.length > 5, `${k}.note`);
    for (const [leaf, s] of Object.entries(d.keys || {})) {
      assert.ok(['boolean', 'integer', 'number', 'string', 'array'].includes(s.type), `${k}.${leaf}.type`);
      assert.ok(s.hint?.length > 10, `${k}.${leaf} has a hint`);
      assert.equal(schema.value(`${k}.${leaf}`, {}), s.default, `${k}.${leaf}: nothing set reads the default`);
    }
  }
});

test('what the agent may propose is built from the schema, and is the same list it always was', () => {
  const prefixes = require('../modules/harness/settings').SETTABLE.map(s => s.prefix).sort();
  assert.deepEqual(prefixes, ['agents.enabled', 'assistant', 'computers', 'customTheme', 'favorites', 'fmFavorites', 'harness.config', 'harness.default',
    'hiddenBuiltins', 'hiddenTabs', 'mcpSettings', 'models', 'paths', 'retrieval', 'scout', 'search', 'serviceSettings', 'sidebarSections', 'sidebarStats',
    'snapshotSettings', 'theme', 'toolNotes', 'vision', 'vms', 'voiceServices']);
  for (const k of ['mcpServers', 'channels', 'network', 'backup', 'branding', 'experiments', 'migrations', 'logs', 'tracing']) assert.ok(!schema.SCHEMA[k].propose, `${k} is never proposable`);
  assert.equal(require('../modules/harness/settings').SETTABLE.find(s => s.prefix === 'agents.enabled').exact, true);
});

test('a value is the prefs file\'s when valid for its type, else the default; an undeclared leaf is an error', () => {
  assert.equal(schema.value('computers.maxRunning', { computers: { maxRunning: 7 } }), 7);
  assert.equal(schema.value('computers.maxRunning', { computers: { maxRunning: '7' } }), 7, 'a number typed as text');
  assert.equal(schema.value('computers.maxRunning', { computers: { maxRunning: 2.5 } }), 4, 'not an integer');
  assert.equal(schema.value('computers.maxRunning', { computers: { maxRunning: -1 } }), 4, 'below the minimum');
  assert.equal(schema.value('channels.telegram.pollSec', { channels: { telegram: { pollSec: 99 } } }), 25, 'above the maximum');
  assert.equal(schema.value('channels.telegram.enabled', { channels: { telegram: { enabled: 'yes' } } }), false, 'not a boolean');
  assert.throws(() => schema.value('computers.nope', {}), /not a declared setting/);
});

test('the agent\'s settings list carries the declared leaves of proposable sections, with hints', () => {
  const rows = require('../modules/harness/settings').readable();
  const max = rows.find(r => r.path === 'computers.maxRunning');
  assert.equal(max.value, 4);
  assert.match(max.detail, /at once/);
  assert.ok(!rows.some(r => r.path.startsWith('channels.')), 'a section that is not proposable is not listed for proposing');
});

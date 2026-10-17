'use strict';

// Blender, Unity and Unreal as catalogue rows, side by side with an open server for each (modules/mcp/catalog-engines.js;
// asked 2026-10-17), the software list's "Real-time 3D and interactive" job, and the editors' System tools rows.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');   // first: it points the settings at a temporary folder

before(() => H.start());
after(() => H.stop());

test('each engine has its maker\'s server and an open one, and Unity\'s relay is looked for where its package puts it', () => {
  const ids = require('../modules/mcp/catalog').CATALOG.map(c => c.id);
  for (const id of ['blender', 'unity', 'mcp-for-unity', 'unreal', 'enginewire']) assert.ok(ids.includes(id), id);
  const { unityRelay } = require('../modules/mcp/catalog-engines');
  assert.match(unityRelay('linux', '/home/a'), /\/home\/a\/\.unity\/relay\/relay_linux$/);
  assert.match(unityRelay('win32', 'C:\\Users\\a'), /relay_win\.exe$/);
  assert.match(unityRelay('darwin', '/Users/a'), /relay_mac_(arm64|x64)\.app\/Contents\/MacOS\/relay_mac_(arm64|x64)$/);
  const unreal = require('../modules/mcp/catalog').get('unreal');
  assert.equal(unreal.transport, 'http');
  assert.ok(!/:8000\//.test(unreal.url), 'not on 8000, which the panel\'s own speech-to-text uses');
});

test('adding EngineWire carries the environment it needs, empty for the person to fill', async () => {
  require('../modules/mcp/catalog').setup = async () => ({ ok: true, log: '' });
  assert.equal((await H.api(null, 'POST', '/api/mcp/catalog/enginewire')).status, 200);
  const spec = require('../modules/mcp/registry').get('enginewire');
  assert.deepEqual(Object.keys(spec.env || {}), ['UE_PROJECT_PATH']);
  assert.equal(spec.autostart, false);
});

test('the real-time job lists Unity, Unreal and Godot; one missing offers its maker\'s page, never a panel install it cannot do', () => {
  const sw = require('../modules/mcp/software');
  assert.ok(sw.jobs().some(j => j.id === 'realtime'));
  const list = sw.forJob('realtime', { platform: 'linux', which: () => null });
  assert.deepEqual(list.map(c => c.name).sort(), ['Godot', 'Unity', 'Unreal Engine']);
  for (const c of list) assert.equal(c.state, 'download', c.name);
  assert.equal(list.find(c => c.name === 'Unreal Engine').transport, 'http', 'Connect opens its address form');
});

test('System tools finds the editors by their files, never by starting them', () => {
  const rows = require('../modules/system-tools-catalog').SYSTEM_TOOLS;
  for (const id of ['blender', 'unity-hub', 'epic-launcher', 'godot']) assert.ok(rows.some(r => r.id === id), id);
  const hub = rows.find(r => r.id === 'unity-hub');
  assert.ok(hub.detect.any.every(d => d.file && !d.bin), 'Unity Hub is a desktop app: looked for, not run');
  assert.match(hub.install.linux, /apt-get install -y unityhub/);
  assert.ok(!rows.find(r => r.id === 'epic-launcher').install.linux, 'no Linux command for Epic\'s launcher: its row shows the link');
});

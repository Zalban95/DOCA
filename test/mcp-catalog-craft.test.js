'use strict';

// The Craft App Suite in the MCP catalogue (modules/mcp/catalog-craft.js, 2026-10-12): twelve suggested servers,
// `<app>-cli mcp` found where the app's release puts its CLI, said missing until the app is installed, added off.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const H = require('./helpers');   // first: it points the settings at a temporary folder

before(() => H.start());
after(() => H.stop());

test('twelve suggested apps, each `<app>-cli mcp`, folded as one kit and said missing until installed', async () => {
  const r = await H.api(null, 'GET', '/api/mcp/catalog');
  const kit = r.body.servers.filter(s => s.kit === 'Craft App Suite');
  assert.equal(kit.length, 12);
  const photo = kit.find(s => s.id === 'photocraft');
  assert.match(photo.command, /photocraft-cli mcp$/);
  assert.deepEqual(photo.missing, ['photocraft-cli (install PhotoCraft)'], 'not on this machine: said, with what to install');
});

test('an installed app is found on PATH and added as an ordinary stdio server, off', async () => {
  const bin = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'craft-'));
  const exe = path.join(bin, process.platform === 'win32' ? 'gridcraft-cli.exe' : 'gridcraft-cli');
  fs.writeFileSync(exe, process.platform === 'win32' ? '' : '#!/bin/sh\n'); fs.chmodSync(exe, 0o755);
  const was = process.env.PATH; process.env.PATH = `${bin}${path.delimiter}${was}`;
  try {
    const row = (await H.api(null, 'GET', '/api/mcp/catalog')).body.servers.find(s => s.id === 'gridcraft');
    assert.deepEqual(row.missing, []);
    const added = await require('../modules/mcp/catalog').add('gridcraft');
    // Windows' PATHEXT names the extension in capitals (.EXE); its paths ignore case.
    const same = p => (process.platform === 'win32' ? p.toLowerCase() : p);
    assert.equal(same(added.command || require('../modules/mcp/registry').get('gridcraft').command), same(exe));
    assert.deepEqual(require('../modules/mcp/registry').get('gridcraft').args, ['mcp']);
    assert.notEqual(require('../modules/mcp/registry').get('gridcraft').autostart, true, 'off until a person starts it');
  } finally { process.env.PATH = was; }
});

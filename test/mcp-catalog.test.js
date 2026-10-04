'use strict';

// The MCP catalogue (modules/mcp/catalog.js, TODO H5.1) and how a stdio server is started per OS
// (modules/mcp/spawn-spec.js): npx is npx.cmd on Windows, which Node will not spawn without a shell.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

let setups = [];
before(async () => {
  await H.start();
  require('../modules/mcp/catalog').setup = async c => { setups.push(c.id); return { ok: true, log: '' }; };   // no browser download in a test
});
after(() => H.stop());

test('on Windows a .cmd server runs through cmd.exe, quoted; elsewhere the command is spawned as it is', () => {
  const { spawnSpec } = require('../modules/mcp/spawn-spec');
  const which = () => 'C:\\Program Files\\nodejs\\npx.cmd';
  const w = spawnSpec('npx', ['-y', '@playwright/mcp@latest', 'a b'], { platform: 'win32', which });
  assert.match(w.file, /cmd(\.exe)?$/i);
  assert.deepEqual(w.args.slice(0, 3), ['/d', '/s', '/c']);
  assert.equal(w.args[3], '""C:\\Program Files\\nodejs\\npx.cmd" -y @playwright/mcp@latest "a b""');
  assert.equal(w.opts.windowsVerbatimArguments, true);
  const exe = spawnSpec('node', ['x.js'], { platform: 'win32', which: () => 'C:\\node\\node.exe' });
  assert.deepEqual([exe.file, exe.args], ['C:\\node\\node.exe', ['x.js']]);
  const nix = spawnSpec('npx', ['-y', 'pkg'], { platform: 'linux' });
  assert.deepEqual([nix.file, nix.args], ['npx', ['-y', 'pkg']]);
});

test('the catalogue lists browser servers; Add makes an ordinary stdio server, not started', async () => {
  const r = await H.api(null, 'GET', '/api/mcp/catalog');
  assert.equal(r.status, 200);
  const pw = r.body.servers.find(s => s.id === 'playwright');
  assert.ok(pw && !pw.added && /@playwright\/mcp/.test(pw.command));
  assert.equal((await H.api(null, 'POST', '/api/mcp/catalog/playwright')).status, 200);
  assert.deepEqual(setups, ['playwright'], 'its browser is set up before it is added');
  const spec = require('../modules/mcp/registry').get('playwright');
  assert.equal(spec.transport, 'stdio');
  assert.equal(spec.command, 'npx');
  assert.equal(spec.autostart, false);
  assert.notEqual(require('../modules/mcp/registry').list().find(s => s.id === 'playwright').state, 'running', 'not started');
  assert.ok((await H.api(null, 'GET', '/api/mcp/catalog')).body.servers.find(s => s.id === 'playwright').added);
  assert.equal((await H.api(null, 'POST', '/api/mcp/catalog/nope')).status, 404);
  const member = await H.signIn('member', 'mcp-cat@test.local');
  assert.equal((await H.api(null, 'POST', '/api/mcp/catalog/chrome-devtools', undefined, { Cookie: member.cookie })).status, 403);
});

test('a setup that fails adds nothing and says why', async () => {
  const cat = require('../modules/mcp/catalog');
  const real = cat.setup;
  cat.setup = async () => ({ ok: false, log: 'npm ERR! network unreachable' });
  try {
    require('../modules/mcp/registry').remove('playwright');
    const r = await H.api(null, 'POST', '/api/mcp/catalog/playwright');
    assert.equal(r.status, 500);
    assert.match(r.body.error, /network unreachable/);
    assert.equal(require('../modules/mcp/registry').get('playwright'), null);
  } finally { cat.setup = real; }
});

test('the agent proposes a catalogue server by id; only the click adds it', async () => {
  const installs = require('../modules/harness/installs');
  assert.throws(() => installs.propose({ kind: 'mcp', id: 'rm -rf', reason: 'x' }), /No catalogue server/);
  const p = installs.propose({ kind: 'mcp', id: 'chrome-devtools', reason: 'to test the page' });
  assert.equal(require('../modules/mcp/registry').get('chrome-devtools'), null, 'nothing added by proposing');
  const done = await installs.apply(p.id);
  assert.equal(done.status, 'installed', JSON.stringify(done));
  assert.equal(require('../modules/mcp/registry').get('chrome-devtools').command, 'npx');
});

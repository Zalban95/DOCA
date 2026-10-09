'use strict';

// The hosted profile (modules/hosted.js) is read once from the environment, as the image sets it: set before anything.
process.env.DOCA_PROFILE = 'hosted';
const H = require('./helpers');

/**
 * A hosted hive: nobody using it, nor its agents, reads DOCA's code or uses the machine it runs on. The machine's
 * routes, sockets, tools and pages are absent; every file route and tool stays in the workspace and never reaches the
 * code's folder — by a path, a relative path, /proc, or a symlink made in the workspace.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const net = require('net');
const path = require('path');

const hosted = require('../modules/hosted');
const tools = require('../modules/harness/tools');
const APP = hosted.APP_DIR;
const SERVER = path.join(APP, 'server.js');

test.before(() => H.start());
test.after(() => H.stop());

test('the profile is on, read from the environment', () => {
  assert.strictEqual(hosted.on(), true);
  assert.deepStrictEqual(require('../modules/paths').FM_ALLOWED_ROOTS.filter(r => !r.startsWith(H.tmp)), [], 'only the workspace folders');
});

test('the tools that run a command line or git on the machine are not in the list at all', async () => {
  const names = tools.schemas().map(s => s.function.name);
  for (const t of hosted.TOOLS) {
    assert.ok(!names.includes(t), `${t} is offered`);
    assert.ok(!tools.TOOLS.some(x => x.name === t), `${t} exists`);
    assert.match(await tools.call(t, { command: 'cat server.js', action: 'status' }), /no tool named/);
  }
});

test('no file tool reads, lists or searches the code, by any path', async () => {
  const ws = H.tmp;
  // Windows lets an ordinary account make a junction but not always a file link: what could not be made is not asked.
  try { fs.symlinkSync(SERVER, path.join(ws, 'link-to-server.js')); } catch { /* EPERM on Windows without developer mode */ }
  fs.symlinkSync(APP, path.join(ws, 'link-to-app'), 'junction');
  fs.writeFileSync(path.join(ws, 'mine.txt'), 'the tenant\'s own file');
  const fileLink = fs.existsSync(path.join(ws, 'link-to-server.js')) ? [path.join(ws, 'link-to-server.js')] : [];
  const reads = [SERVER, path.relative(ws, SERVER), '/proc/self/cwd/server.js', '/proc/self/environ',
    ...fileLink, path.join(ws, 'link-to-app', 'server.js'), 'link-to-app/package.json'];
  for (const p of reads) assert.match(await tools.call('read_file', { path: p }), /^Error: Path is outside/, `read_file ${p}`);
  for (const p of [APP, path.join(ws, 'link-to-app'), '/', '/proc/self/cwd'])
    assert.match(await tools.call('list_dir', { path: p }), /^Error: Path is outside/, `list_dir ${p}`);
  assert.match(await tools.call('search_files', { query: 'createApp', path: APP }), /^Error: Path is outside/);
  assert.doesNotMatch(await tools.call('search_files', { query: 'createApp', path: ws }), /server\.js/, 'a search does not follow a link');
  assert.match(await tools.call('canvas', { action: 'open', path: SERVER, title: 'x' }), /^Error: Path is outside/);
  assert.match(await tools.call('show_media', { path: path.join(ws, 'link-to-app', 'server.js') }), /^Error:/);
  assert.match(await tools.call('write_file', { path: path.join(APP, 'x.txt'), content: 'x' }), /^Error: Path is outside/);
  assert.match(await tools.call('read_file', { path: 'mine.txt' }), /the tenant's own file/, 'the workspace still reads');
});

test('the Files and Projects routes stay in the workspace; the machine list is absent', async () => {
  const q = p => encodeURIComponent(p);
  for (const p of [SERVER, path.join(H.tmp, 'link-to-app', 'server.js'), ...(process.platform === 'win32' ? [] : ['/proc/self/cwd/server.js'])]) {
    assert.strictEqual((await H.api(null, 'GET', `/api/files/read?path=${q(p)}`)).status, 403, p);
    assert.strictEqual((await H.api(null, 'GET', `/api/files/raw?path=${q(p)}`)).status, 403, p);
    assert.strictEqual((await H.api(null, 'GET', `/api/files/download?path=${q(p)}`)).status, 403, p);
  }
  assert.strictEqual((await H.api(null, 'GET', `/api/files/list?path=${q(APP)}`)).status, 403);
  assert.strictEqual((await H.api(null, 'GET', `/api/files/search?root=${q(APP)}&q=server`)).status, 403);
  assert.strictEqual((await H.api(null, 'POST', '/api/projects', { root: APP })).status, 403);
  assert.strictEqual((await H.api(null, 'POST', '/api/projects', { root: path.join(H.tmp, 'link-to-app') })).status, 403);
  assert.strictEqual((await H.api(null, 'GET', `/api/files/read?path=${q(path.join(H.tmp, 'mine.txt'))}`)).status, 200);
});

test('the machine\'s routes are absent: the panel\'s 404, before any handler', async () => {
  const absent = [['GET', '/api/files/roots'], ['GET', '/api/system/tools'], ['POST', '/api/system/tools/install'], ['GET', '/api/versions'],
    ['POST', '/api/versions/use'], ['POST', '/api/update'], ['GET', '/api/startup'], ['GET', '/api/docker/containers'],
    ['GET', '/api/configs/openclaw'], ['GET', '/api/setup/scripts'], ['POST', '/api/snapshots/create'], ['POST', '/api/paths'],
    ['POST', '/api/harness/custom'], ['POST', '/api/harness/claude-code/install'], ['POST', '/api/harness/claude-code/config'],
    ['GET', '/api/models/llamacpp/list'], ['POST', '/api/services/start'], ['GET', '/api/vms'], ['POST', '/api/skills/install'],
    ['POST', '/api/projects/p1/run'], ['GET', '/api/projects/p1/git/status'], ['PUT', '/api/devices/d1/console'],
    ['POST', '/api/clients/apps/mobile/build'], ['POST', '/api/action']];
  for (const [m, p] of absent) {
    const r = await H.api(null, m, p, m === 'GET' ? undefined : {});
    assert.strictEqual(r.status, 404, `${m} ${p}`);
    assert.strictEqual(r.body.code, 'not_found', `${m} ${p}`);
  }
  // What a hosted hive keeps: the DOCA harness's own settings, attachments, backups.
  assert.notStrictEqual((await H.api(null, 'POST', '/api/harness/doca/config', {})).status, 404);
  assert.strictEqual((await H.api(null, 'GET', '/api/backups')).status, 200);
});

test('an MCP server run as a command cannot be added or started; one at an address can', async () => {
  const stdio = await H.api(null, 'POST', '/api/mcp', { label: 'cat', transport: 'stdio', command: process.execPath, args: ['-e', `require('fs').readFileSync(${JSON.stringify(SERVER)})`] });
  assert.ok(stdio.status >= 400, `stdio added: ${stdio.status}`);
  assert.match(JSON.stringify(stdio.body), /not part of a hosted hive/);
  const registry = require('../modules/mcp/registry');
  await assert.rejects(registry.start('nope'), /Unknown/);
  // One written into the prefs by hand (an older file, a restored backup) is still never started.
  const { loadPrefs, savePrefs } = require('../modules/utils');
  savePrefs({ ...loadPrefs(), mcpServers: [{ id: 'old', label: 'old', transport: 'stdio', command: process.execPath, args: [] }] });
  await assert.rejects(registry.start('old'), /not part of a hosted hive/);
  await assert.rejects(require('../modules/mcp/catalog').add('playwright'), /not part of a hosted hive/);
  const http = await H.api(null, 'POST', '/api/mcp', { label: 'remote', transport: 'http', url: 'https://example.invalid/mcp' });
  assert.ok(http.status < 400, `http refused: ${http.status}`);
});

test('nothing types a command line into the machine, and nothing is installed onto it', async () => {
  const shell = require('../modules/shell');
  const r = await shell.run(`cat ${SERVER}`);
  assert.strictEqual(r.code, 1);
  assert.doesNotMatch(r.out, /createApp/);
  assert.throws(() => shell.spawnShell('cat server.js'), /not part of a hosted hive/);
  await assert.rejects(require('../modules/utils').run('cat server.js'), e => /not part of a hosted hive/.test(e.error));
  assert.deepStrictEqual(Object.keys(require('../modules/harness/installs').KINDS), ['ollama-model']);
  assert.deepStrictEqual(require('../modules/api-v1/commands').ids().filter(id => hosted.COMMANDS.test(id)), []);
});

test('the page says it is hosted, and the machine\'s pages are not in the nav', async () => {
  assert.strictEqual((await H.api(null, 'GET', '/api/branding')).body.profile, 'hosted');
  const page = await fetch(`${H.base}/`, { headers: { Cookie: H.owner.cookie } }).then(r => r.text());
  assert.match(page, /window\.DOCA_HOSTED = true/);
  const { resolved } = (await H.api(null, 'GET', '/api/screen/layout')).body;
  const shown = resolved.groups.flatMap(g => g.tabs);
  for (const t of hosted.TABS) assert.ok(!shown.includes(t), `${t} is in the nav`);
  assert.deepStrictEqual(resolved.absent, hosted.TABS);
});

test('the terminal\'s socket is not there', async () => {
  require('../modules/terminal').setup(H.server());
  const { port } = H.server().address();
  const reply = await new Promise((resolve, reject) => {
    const s = net.connect(port, '127.0.0.1', () => s.write('GET /ws/terminal HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
      + `Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\nCookie: ${H.owner.cookie}\r\n\r\n`));
    let buf = ''; s.on('data', d => { buf += d; }); s.on('end', () => resolve(buf)); s.on('error', reject);
  });
  assert.match(reply, /^HTTP\/1\.1 404/);
});

test('the container\'s gateway is read from its route table; outside a container there is none', () => {
  const route = 'Iface\tDestination\tGateway\tFlags\neth0\t00000000\t010012AC\t0003\neth0\t000012AC\t00000000\t0001\n';
  assert.strictEqual(hosted.parseGateway(route), '172.18.0.1');
  assert.strictEqual(hosted.parseGateway('Iface\tDestination\tGateway\n'), null);
  if (!fs.existsSync('/.dockerenv') && !fs.existsSync('/run/.containerenv')) assert.strictEqual(hosted.fromHost('172.18.0.1'), false);
});

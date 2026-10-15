'use strict';

/**
 * Pages of connected services (modules/service-pages): an admin names a service and its key; while its health route
 * answers it is listed for the people who see it, and its own UI is served under /s/<id>/ on the canvas origin — the
 * key added by the hub, the prefix said, DOCA's cookies left behind, a pass needed; not answering, it is gone.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const H = require('./helpers');   // first: it points the settings at a temporary folder

let svc, up = true, seen = [], canvas;
before(async () => {
  await H.start();
  svc = http.createServer((req, res) => {
    seen.push({ url: req.url, key: req.headers['x-api-key'] || null, prefix: req.headers['x-forwarded-prefix'] || null, cookie: req.headers.cookie || '' });
    if (req.url === '/api/health') { res.writeHead(up ? 200 : 503); return res.end(up ? '{"ok":true}' : ''); }
    res.writeHead(200, { 'Content-Type': 'text/html', 'X-Frame-Options': 'DENY' }); res.end(`<h1>DoMac</h1>${req.url}`);
  });
  await new Promise(r => svc.listen(0, '127.0.0.1', r));
  require('../modules/service-keys').save({ name: 'domac', origin: `http://127.0.0.1:${svc.address().port}`, field: 'X-Api-Key', prefix: '', key: 'sk-domac-test-0123456789' });
  canvas = http.createServer((req, res) => { if (!require('../modules/service-pages/proxy').handle(req, res)) { res.writeHead(404); res.end(); } });
  await new Promise(r => canvas.listen(0, '127.0.0.1', r));
});
after(async () => { svc.close(); canvas.close(); await H.stop(); });

test('set up by an admin, listed while it answers, its UI through the hub with its key and prefix, never DOCA\'s cookies', async () => {
  const r = await H.api(null, 'POST', '/api/service-pages', { name: 'DoMac', url: `http://127.0.0.1:${svc.address().port}`, key: 'domac', group: 'intelligence' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.state.up, true);
  assert.deepEqual((await H.api(null, 'GET', '/api/service-pages')).body.pages.map(p => p.id), ['domac']);
  const member = await H.signIn('member', 'svc-member@test.local');
  assert.deepEqual((await H.api(null, 'GET', '/api/service-pages', undefined, { Cookie: member.cookie })).body.pages, [], 'admins only by default');
  assert.equal((await H.api(null, 'POST', '/api/service-pages/domac/open', {}, { Cookie: member.cookie })).status, 404);

  const open = await H.api(null, 'POST', '/api/service-pages/domac/open', {});
  assert.equal(open.status, 200);
  const pass = new URL(open.body.url);
  assert.match(pass.pathname + pass.search, /^\/s\/domac\/\?doca_t=[A-Za-z0-9_-]{20,}$/);
  const base = `http://127.0.0.1:${canvas.address().port}`;
  assert.equal((await fetch(`${base}/s/domac/`)).status, 403, 'no pass, no page');
  const enter = await fetch(`${base}${pass.pathname}${pass.search}`, { redirect: 'manual' });
  assert.equal(enter.status, 302);
  const cookie = enter.headers.get('set-cookie').split(';')[0];
  seen = [];
  const page = await fetch(`${base}/s/domac/machines/1`, { headers: { Cookie: `${cookie}; doca_session=secret-panel-session` } });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /DoMac<\/h1>\/machines\/1/);
  assert.equal(page.headers.get('x-frame-options'), null, 'framed by the panel');
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors/);
  assert.deepEqual([seen[0].key, seen[0].prefix], ['sk-domac-test-0123456789', '/s/domac']);
  assert.doesNotMatch(seen[0].cookie, /doca_/, 'none of DOCA\'s cookies reach the service');

  up = false;
  await require('../modules/service-pages/health').checkAll();
  assert.deepEqual((await H.api(null, 'GET', '/api/service-pages')).body.pages, [], 'not answering: no page');
  assert.equal((await fetch(`${base}/s/domac/`, { headers: { Cookie: cookie } })).status, 503);
  up = true;
  assert.equal((await H.api(null, 'DELETE', '/api/service-pages/domac')).status, 200);
});

test('a definition is checked: an address, a key that exists, a known group', async () => {
  assert.equal((await H.api(null, 'POST', '/api/service-pages', { name: 'X', url: 'ftp://x' })).status, 400);
  assert.equal((await H.api(null, 'POST', '/api/service-pages', { name: 'X', url: 'http://127.0.0.1:1', key: 'nope' })).status, 400);
});

test('started here and with DOCA: by its command and settings file, stopped by its own PID, never by name', async () => {
  const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'svc-run-'));
  const port = 40000 + Math.floor(Math.random() * 2000);
  fs.writeFileSync(path.join(dir, 'app.js'), "require('http').createServer((q, s) => { s.writeHead(200); s.end('ok'); }).listen(Number(process.env.APP_PORT), '127.0.0.1');");
  fs.writeFileSync(path.join(dir, 'app.env'), `# the stand-in's port\nAPP_PORT="${port}"\n`);
  let r = await H.api(null, 'POST', '/api/service-pages', { name: 'Runner', url: `http://127.0.0.1:${port}`, health: '/',
    run: { command: process.execPath, args: 'app.js', cwd: dir, envFile: path.join(dir, 'app.env') } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.state.up, false, 'not started yet');
  r = await H.api(null, 'POST', '/api/service-pages/runner/start', {});
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.pid > 0);
  assert.equal(r.body.state.up, true, 'it answers');
  r = await H.api(null, 'POST', '/api/service-pages/runner/stop', {});
  assert.equal(r.body.stopped, true);
  assert.equal(r.body.state.up, false);
  assert.equal((await H.api(null, 'POST', '/api/service-pages/runner/boot', { on: true })).body.service.boot, true);
  await require('../modules/service-pages/run').boot();
  await H.sleep(1200);
  assert.equal((await require('../modules/service-pages/health').check(require('../modules/service-pages').get('runner'))).up, true, 'started with DOCA');
  require('../modules/service-pages/run').stop(require('../modules/service-pages').get('runner'));
  assert.equal((await H.api(null, 'POST', '/api/service-pages', { name: 'No way', url: 'http://127.0.0.1:1', boot: true })).status, 400, 'Start with DOCA needs a command');
  await H.api(null, 'DELETE', '/api/service-pages/runner');
  // Windows holds a killed process's working folder for a moment (EBUSY): wait it out, never fail on the clean-up.
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch { /* the temp folder goes later */ }
});

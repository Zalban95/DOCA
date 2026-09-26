'use strict';

/**
 * Canvases (modules/canvas): pages the agent makes run only on their own
 * origin, sandboxed, reachable by an unguessable address — never on the
 * panel's, where /api runs shell commands.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const http   = require('node:http');

const H        = require('./helpers');
const canvases = require('../modules/canvas/store');
const origin   = require('../modules/canvas/origin');
const tools    = require('../modules/harness/tools');

let cbase, cserver;
test.before(async () => {
  await H.start();
  cserver = http.createServer(origin.handler);
  await new Promise(r => cserver.listen(0, '127.0.0.1', r));
  cbase = `http://127.0.0.1:${cserver.address().port}`;
});
test.after(async () => { cserver.close(); await H.stop(); });

const PAGE = '<!doctype html><title>t</title><h1>Hello</h1><script>1</script>';

test('the agent opens a canvas and the chat gets a chip, not the page', async () => {
  const shown = [];
  const out = await tools.call('canvas', { action: 'open', title: 'Port table', html: PAGE }, [], { sessionId: 's1', show: m => shown.push(m) });
  assert.match(out, /Opened canvas cnv_[a-z0-9]{12} \("Port table"\)/);
  assert.equal(shown.length, 1);
  assert.equal(shown[0].kind, 'canvas');
  assert.equal(shown[0].rev, 1);
  assert.equal(JSON.stringify(shown[0]).includes('<h1>'), false, 'the transcript carries no page');
  assert.equal(JSON.stringify(shown[0]).includes(canvases.get(shown[0].canvasId).token), false, 'nor its address');

  const w = await tools.call('canvas', { action: 'write', id: shown[0].canvasId, html: PAGE.replace('Hello', 'Again') }, [], { sessionId: 's1', show: m => shown.push(m) });
  assert.match(w, /revision 2/);
  assert.match(await tools.call('canvas', { action: 'read', id: shown[0].canvasId, rev: 1 }), /Hello/);
  assert.match(await tools.call('canvas', { action: 'list' }, [], { sessionId: 's1' }), /Port table \(revision 2/);
  assert.match(await tools.call('canvas', { action: 'write', id: 'cnv_nope00000000', html: PAGE }), /^Error: No canvas/);
  assert.match(await tools.call('canvas', { action: 'open', html: '  ' }), /^Error: Give the page/);
});

test('the canvas origin serves the page sandboxed, and nothing else', async () => {
  const c = canvases.create({ title: 'Served', html: PAGE });
  let r = await fetch(`${cbase}/c/${c.token}`);
  assert.equal(r.status, 200);
  assert.match(await r.text(), /Hello/);
  const csp = r.headers.get('content-security-policy');
  assert.match(csp, /^sandbox allow-scripts/);
  assert.doesNotMatch(csp, /allow-same-origin/, 'an opaque origin: no storage, no cookies, not even its own');
  assert.match(csp, /connect-src 'none'/);
  assert.match(csp, /frame-ancestors https:\/\/\*:\d+/);
  assert.equal(r.headers.get('set-cookie'), null);

  canvases.write(c.id, { html: PAGE.replace('Hello', 'Second') });
  assert.match(await (await fetch(`${cbase}/c/${c.token}/1`)).text(), /Hello/, 'an old revision still opens what it showed');
  assert.match(await (await fetch(`${cbase}/c/${c.token}`)).text(), /Second/);

  for (const p of [`/c/${'A'.repeat(22)}`, `/c/${c.id}`, '/', '/api/harness/sessions', `/c/${c.token}/99`])
    assert.equal((await fetch(cbase + p)).status, 404, p);
  assert.equal((await fetch(`${cbase}/c/${c.token}`, { method: 'POST' })).status, 405);
});

test('the panel gives the address, never the page; and devices are not sent canvases', async () => {
  const c = canvases.create({ title: 'Addr', html: PAGE, sessionId: 's2' });
  let r = await H.api(null, 'GET', `/api/harness/canvases/${c.id}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.path, `/c/${c.token}`);
  assert.equal(typeof r.body.port, 'number');
  assert.equal(JSON.stringify(r.body).includes('<h1>'), false);
  r = await H.api(null, 'GET', '/api/harness/canvases?sessionId=s2');
  assert.deepEqual(r.body.canvases.map(x => x.id), [c.id]);
  assert.equal(r.body.canvases[0].token, undefined, 'the list does not hand out addresses');
  assert.equal((await H.api(null, 'GET', '/api/harness/canvases/cnv_nope00000000')).status, 404);
  assert.equal((await H.api(null, 'GET', `/api/harness/canvases/${c.id}`, undefined, { Cookie: '' })).status, 401);

  // A device has nowhere safe to run one yet: its transcript leaves canvases out.
  const memory = require('../modules/harness/memory');
  const s = memory.createSession('Canvas for devices', { activate: false });
  memory.append(s.id, { role: 'tool', name: 'canvas', content: 'ok', images: [
    { kind: 'canvas', name: `${c.id}@1`, canvasId: c.id, rev: 1, caption: 'Addr' },
    { name: 'pic.png', mime: 'image/png', kind: 'image', bytes: 3 },
  ] });
  const rows = require('../modules/api-v1/harness').transcript(s.id).messages;
  assert.deepEqual(rows.flatMap(m => m.images || []).map(i => i.name), ['pic.png']);
});

test('a revision is capped, and old revisions go past the limit', () => {
  assert.throws(() => canvases.create({ html: 'x'.repeat(canvases.MAX_HTML + 1) }), /capped/);
  const c = canvases.create({ html: PAGE });
  for (let i = 0; i < canvases.MAX_REVS + 3; i++) canvases.write(c.id, { html: `${PAGE}${i}` });
  const revs = canvases.get(c.id).revisions;
  assert.equal(revs.length, canvases.MAX_REVS);
  assert.equal(revs.at(-1).rev, canvases.MAX_REVS + 4);
});

test('a preview shows a localhost port through the canvas origin — and only that port, only with its cookie', async () => {
  const previews = require('../modules/canvas/previews');
  const seen = [];
  const app = http.createServer((req, res) => {
    seen.push({ url: req.url, cookie: req.headers.cookie || '' });
    res.setHeader('X-Frame-Options', 'DENY');
    if (req.url === '/') return res.end('<script src="/assets/app.js"></script>');
    if (req.url === '/assets/app.js') return res.end('console.log("app")');
    res.writeHead(404); res.end();
  });
  const { WebSocketServer } = require('ws');
  const wss = new WebSocketServer({ server: app });
  wss.on('connection', s => s.on('message', m => s.send(`echo ${m}`)));
  await new Promise(r => app.listen(0, '127.0.0.1', r));
  // The canvas origin with upgrades, as origin.start() wires it.
  const csrv = http.createServer(origin.handler);
  csrv.on('upgrade', (req, sock, head) => require('../modules/canvas/proxy').upgrade(req, sock, head));
  await new Promise(r => csrv.listen(0, '127.0.0.1', r));
  const cb = `http://127.0.0.1:${csrv.address().port}`;
  try {
    const shown = [];
    const out = await tools.call('canvas', { action: 'preview', port: app.address().port, title: 'Vite app' }, [], { show: m => shown.push(m) });
    assert.match(out, /Preview prv_[0-9a-f]{12} of localhost:\d+ is a button/);
    const p = previews.get(shown[0].previewId);
    assert.throws(() => previews.create({ port: require('../modules/paths').PORT }), /panel's own ports/);

    let r = await fetch(`${cb}/p/${p.token}/`, { redirect: 'manual' });
    assert.equal(r.status, 302);
    const cookie = r.headers.get('set-cookie').split(';')[0];
    assert.match(r.headers.get('set-cookie'), /HttpOnly; Secure/);

    r = await fetch(`${cb}/assets/app.js`, { headers: { cookie: `${cookie}; theirs=1` } });
    assert.equal(await r.text(), 'console.log("app")', 'a root-relative URL reaches the app');
    assert.equal(seen.at(-1).cookie, 'theirs=1', 'the app never sees the preview cookie');
    r = await fetch(`${cb}/`, { headers: { cookie } });
    assert.equal(r.headers.get('x-frame-options'), null);
    assert.match(r.headers.get('content-security-policy'), /frame-ancestors https:\/\/\*:\d+/);
    assert.equal((await fetch(`${cb}/assets/app.js`)).status, 404, 'no cookie, no proxy');

    // Hot reload: a WebSocket through the same cookie.
    const WebSocket = require('ws');
    const ws = new WebSocket(`ws://127.0.0.1:${csrv.address().port}/hmr`, { headers: { cookie } });
    const reply = await new Promise((resolve, reject) => {
      ws.on('open', () => ws.send('hi')); ws.on('message', m => resolve(String(m))); ws.on('error', reject);
    });
    assert.equal(reply, 'echo hi');
    ws.close();

    // Nothing listening: said plainly.
    const dead = previews.create({ port: 1 });
    r = await fetch(`${cb}/x`, { headers: { cookie: `doca_preview=${dead.token}` } });
    assert.equal(r.status, 502);
    assert.match(await r.text(), /Nothing answered on localhost:1/);

    const member = await H.signIn('member');
    r = await H.api(null, 'POST', '/api/harness/previews', { port: 5173 }, { Cookie: member.cookie });
    assert.equal(r.status, 403, 'showing a local port to the tailnet is a host right');
    r = await H.api(null, 'GET', `/api/harness/previews/${p.id}`);
    assert.equal(r.body.path, `/p/${p.token}`);
  } finally { wss.close(); app.close(); csrv.close(); }
});

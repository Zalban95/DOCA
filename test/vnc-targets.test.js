'use strict';

/**
 * Machines → VNC (modules/vnc-targets): targets kept in a protected file and never handed back with their password,
 * a row each in the status column (connected, reachable, unreachable), a picture in Live, the console bridged with the
 * hub signing in (a watching socket cannot act), and the agent's vnc_look / vnc_input — there once a screen is added,
 * under the ordinary approvals on a person's turn and always asked for a specialist, never typing a kept secret, waiting
 * while a person drives. A member gets none of it. Against fixtures/rfb-stub.js.
 */
const H = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const stub = require('./fixtures/rfb-stub');

test.after(() => H.stop());

const closedPort = async () => { const s = net.createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const p = s.address().port; await new Promise(r => s.close(r)); return p; };

/** A WebSocket's bytes as a stream: read(n) waits for exactly n. */
function wsReader(ws) {
  let buf = Buffer.alloc(0), want = null;
  ws.on('message', d => { buf = Buffer.concat([buf, Buffer.from(d)]); pump(); });
  const pump = () => { if (want && buf.length >= want.n) { const out = buf.subarray(0, want.n); buf = buf.subarray(want.n); const w = want; want = null; w.resolve(out); } };
  return n => new Promise(resolve => { want = { n, resolve }; pump(); });
}

/** Through the hub as noVNC would: the hub's None handshake, ClientInit, then `msgs`; resolves with the screen's size. */
async function viaHub(id, { drive = false, msgs = [] } = {}) {
  const WebSocket = require('ws');
  const ws = new WebSocket(`${H.base.replace('http', 'ws')}/ws/vnc/${id}${drive ? '?drive=1' : ''}`, ['binary'], { headers: { Cookie: H.owner.cookie } });
  const read = wsReader(ws);
  await new Promise((resolve, reject) => { ws.on('open', resolve); ws.on('error', reject); });
  assert.equal((await read(12)).toString(), 'RFB 003.008\n');
  ws.send(Buffer.from('RFB 003.008\n'));
  assert.deepEqual([...await read(2)], [1, 1], 'the browser is offered no password at all: the hub holds it');
  ws.send(Buffer.from([1]));
  assert.deepEqual([...await read(4)], [0, 0, 0, 0]);
  ws.send(Buffer.from([1]));   // ClientInit
  const init = await read(24);
  await read(init.readUInt32BE(20));
  for (const m of msgs) ws.send(m);
  return { ws, width: init.readUInt16BE(0) };
}

test('VNC targets: kept apart, rows, Live, the console through the hub, the agent\'s tools behind the owner\'s switch', async t => {
  const s = await stub.start({ password: 'secret', width: 4, height: 2 });
  t.after(() => s.close());
  await H.start();
  require('../modules/terminal').setup(H.server());
  const tools = require('../modules/harness/tools');
  const names = () => tools.schemas().map(x => x.function?.name || x.name);
  assert.ok(!names().includes('vnc_look') && !names().includes('vnc_input'), 'no screen added: the tools are not offered');

  // Added with a password; nothing handed back holds it, and the file it lives in is protected.
  const add = await H.api(null, 'POST', '/api/machines/vnc', { name: 'desk', host: '127.0.0.1', port: s.port, password: 'secret' });
  assert.equal(add.status, 201, JSON.stringify(add.body));
  const id = add.body.id;
  assert.equal(add.body.hasPassword, true);
  const gone = await H.api(null, 'POST', '/api/machines/vnc', { name: 'gone', host: '127.0.0.1', port: await closedPort() });
  assert.equal((await H.api(null, 'POST', '/api/machines/vnc', { name: 'bad', host: 'a b;c', port: 5900 })).status, 400);
  assert.equal((await H.api(null, 'POST', '/api/machines/vnc', { name: 'desk', host: '127.0.0.1', port: 5900 })).status, 409, 'names are unique');
  const paths = require('../modules/paths');
  assert.ok(paths.PROTECTED_FILES.includes(paths.VNC_KEYS_FILE));
  if (process.platform !== 'win32') assert.equal(fs.statSync(paths.VNC_KEYS_FILE).mode & 0o777, 0o600);
  // Renaming without a password keeps it; the masked value posted back keeps it too.
  const ren = await H.api(null, 'PUT', `/api/machines/vnc/${id}`, { name: 'desk', password: require('../modules/secrets-mask').MASK });
  assert.equal(ren.body.hasPassword, true);

  const list = await H.api(null, 'GET', '/api/machines/vnc');
  assert.equal(list.status, 200);
  const desk = list.body.targets.find(x => x.id === id);
  assert.deepEqual([desk.state, desk.hasPassword, desk.console.watch], ['reachable', true, `/api/machines/vnc/${id}/console?view=1`]);
  assert.equal(list.body.targets.find(x => x.id === gone.body.id).state, 'unreachable');
  const test1 = await H.api(null, 'GET', `/api/machines/vnc/${id}/test`);
  assert.deepEqual([test1.body.ok, test1.body.width, test1.body.name], [true, 4, 'stub screen']);
  assert.match((await H.api(null, 'GET', `/api/machines/vnc/${gone.body.id}/test`)).body.why, /nothing listens there/);

  // The status column: a reachable target is a row with its point, an unreachable one is counted.
  require('../modules/machines/rows')._reset();
  const rows = (await H.api(null, 'GET', '/api/machines/rows')).body;
  const row = rows.rows.find(r => r.kind === 'vnc' && r.id === id);
  assert.deepEqual([row.point, row.state, row.tab, row.live], ['up', 'reachable', 'vnc', true]);
  assert.equal(rows.rows.find(r => r.id === gone.body.id).point, 'down');
  assert.deepEqual(rows.counts.vnc, { total: 2, running: 1, stopped: 1 });

  // Live: the reachable one, pictured by the hub's own RFB client.
  let live = (await H.api(null, 'GET', '/api/machines?shots=1')).body;
  assert.deepEqual(live.vnc.map(v => v.id), [id], 'an unreachable target has no tile');
  await require('../modules/vnc-targets/shots').round();
  live = (await H.api(null, 'GET', '/api/machines?shots=1')).body;
  assert.ok(live.vnc[0].shot, live.vnc[0].why);
  const shot = await fetch(`${H.base}/api/machines/vnc/${id}/shot`, { headers: { Cookie: H.owner.cookie } });
  assert.equal(shot.headers.get('content-type'), 'image/png');
  assert.ok(require('../modules/machines/png').fromPng(Buffer.from(await shot.arrayBuffer())).rgb.equals(stub.expected(4, 2)));

  // The console: the page names the socket; watching cannot type or click, driving can — and counts as at the keyboard.
  const page = await fetch(`${H.base}/api/machines/vnc/${id}/console?drive=1`, { headers: { Cookie: H.owner.cookie } });
  const html = await page.text();
  assert.match(html, new RegExp(`ws/vnc/${id}\\?drive=1`));
  assert.ok(!html.includes('secret'), 'the page carries no password');
  const key = Buffer.from([4, 1, 0, 0, 0, 0, 0, 0x61]), ptr = Buffer.from([5, 1, 0, 1, 0, 1]), req = Buffer.from([3, 0, 0, 0, 0, 0, 0, 4, 0, 2]);
  const before = s.got.length;
  const watch = await viaHub(id, { msgs: [key, ptr, req] });
  assert.equal(watch.width, 4);
  await new Promise(r => setTimeout(r, 200));
  assert.equal((await H.api(null, 'GET', '/api/machines/vnc')).body.targets.find(x => x.id === id).state, 'connected');
  const seen = s.got.slice(before).map(g => g.type);
  assert.ok(seen.includes('update-request'), 'what only reads passes');
  assert.ok(!seen.includes('key') && !seen.includes('pointer'), 'a watching socket\'s keys and clicks are dropped at the hub');
  watch.ws.close();
  const drive = await viaHub(id, { drive: true, msgs: [key] });
  await new Promise(r => setTimeout(r, 200));
  assert.ok(s.got.slice(before).some(g => g.type === 'key'), 'a driving socket types');
  assert.ok(require('../modules/vnc-targets/state').driving(id));

  // The agent's tools: offered now; on a person's turn they act under the ordinary approvals, for a specialist always asked.
  assert.ok(names().includes('vnc_look') && names().includes('vnc_input'));
  const approval = require('../modules/harness/approval');
  assert.ok(!approval.FREE.has('vnc_input') && !approval.FREE.has('vnc_look'), 'asked in Manual, as any tool that acts');
  const asked = approval.gate('vnc_input', { target: 'desk', action: 'click', x: 1, y: 1 }, { mission: true });
  assert.deepEqual([asked.forced, asked.keys], [true, null], 'a specialist\'s every vnc_input is a person\'s decision, never "always"');
  assert.match(approval.missionRefusal(asked), /not lent to this mission: report what you meant to do on it/);
  assert.match(await tools.call('vnc_input', { target: 'desk', action: 'click', x: 1, y: 1 }), /a person is driving desk/);
  drive.ws.close();
  await new Promise(r => setTimeout(r, 200));
  assert.match(await tools.call('vnc_input', { target: 'desk', action: 'click', x: 1, y: 1 }), /handed it back[\s\S]*Click at 1,1 on desk \(4×2\)/);
  assert.match(await tools.call('vnc_input', { target: 'desk', action: 'type', text: 'my secret is out' }), /not typed: the text holds a password or key DOCA keeps/);
  const look = await tools.call('vnc_look', { target: 'desk' });
  assert.match(look, /saved as .*\.png[\s\S]*desk's screen is 4×2/);
  assert.ok(!look.includes('secret'));

  // A specialist holds them only for a target lent to its mission; a member is allotted none.
  const { disabledFor } = require('../modules/harness/turn/prompt');
  assert.ok(require('../modules/agents/registry').NEVER.includes('vnc_input'));
  const spec = { level: 'specialist', kits: ['computer'] };
  assert.ok(disabledFor(spec, {}).includes('vnc_input'));
  assert.ok(!disabledFor({ ...spec, vnc: id }, {}).includes('vnc_input'), 'lent: held');
  const member = await H.signIn('member', 'vnc-member@test.local');
  assert.equal(require('../modules/auth/allot').uses({ id: member.user.id, role: 'member' }, 'vnc', id), false, 'an admin\'s until allotted');
  assert.match(await tools.call('vnc_look', { target: 'desk' }, [], { user: { ...member.user, role: 'member' } }), /does not have the vnc desk allotted/);
  for (const [method, p] of [['GET', '/api/machines/vnc'], ['POST', '/api/machines/vnc'], ['GET', `/api/machines/vnc/${id}/console`], ['DELETE', `/api/machines/vnc/${id}`]])
    assert.equal((await H.api(null, method, p, method === 'POST' ? { host: '127.0.0.1', port: 1 } : undefined, { Cookie: member.cookie })).status, 403, `${method} ${p}`);

  // No response of the whole run, and no file but the protected one, holds the password.
  for (const p of ['/api/machines/vnc', '/api/machines/rows', '/api/machines?shots=1', '/api/prefs'])
    assert.ok(!JSON.stringify((await H.api(null, 'GET', p)).body).includes('secret'), p);
  assert.equal((await H.api(null, 'DELETE', `/api/machines/vnc/${id}`)).status, 200);
  assert.ok(!fs.readFileSync(paths.VNC_KEYS_FILE, 'utf8').includes('secret'), 'removed with its password');
  require('../modules/vnc-targets/shots').stop();
});

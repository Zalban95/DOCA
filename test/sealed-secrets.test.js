'use strict';

// Secrets used, never read, on any device (CONSTITUTION S4; TODO P1.3; modules/sealed): a secret kept encrypted in the
// database, handed to one of the person's devices sealed for it alone, always asked, used once (or for a few pastes)
// and forgotten — and never in a tool result, a transcript, a log, a trace or any file of the hub's data.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const H = require('./helpers');   // first: it points the settings at a temporary folder

const VALUE = 'Pin-7d1f-ZQ93-only-here';
let dir, client, sealed, lending, deviceId, serverId;
const typed = [], clipped = [];
let gone = null;

before(async () => {
  await H.start();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doca-sealed-'));
  process.env.DOCA_CLIENT_DIR = path.join(dir, 'cfg');
  client = require('../clients/node/doca-client');
  sealed = require('../clients/node/sealed');
  // A desktop cannot be typed into here: the OS's ways in are stood in for, the rest is the real client.
  sealed.adapter.type = async v => { typed.push(v); };
  sealed.adapter.clip = async (v, uses, onGone) => { clipped.push({ v, uses }); gone = onGone; return { counted: true, stop: () => onGone() }; };
});
after(async () => { try { require('../modules/mcp/registry').stop(serverId); } catch {} await lending?.stop(); await H.stop(); fs.rmSync(dir, { recursive: true, force: true }); });

test('a secret is kept encrypted in the database, its key in the protected keys folder; never read back', async () => {
  const r = await H.api(null, 'POST', '/api/connectors/sealed/all', { name: 'bank-pin', value: VALUE, origin: 'https://bank.example/login', note: 'the card PIN' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.secret.origin, 'https://bank.example');
  const list = await H.api(null, 'GET', '/api/connectors/sealed/all');
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.secrets.map(s => s.name), ['bank-pin']);
  assert.ok(!JSON.stringify(list.body).includes(VALUE), 'never a value back');
  const vault = require('../modules/sealed/vault');
  const keyFile = path.join(vault.keysDir(), 'sealed.key');
  if (process.platform !== 'win32') assert.equal(fs.statSync(keyFile).mode & 0o777, 0o600);
  assert.equal(require('../modules/utils').fmSafe(keyFile), false, 'the keys folder is refused to the agent\'s file tools');
  assert.equal(require('../modules/utils').fmSafe(path.join(vault.keysDir(), 'device-seals.json')), false);
  const member = await H.signIn('member');
  assert.equal((await H.api(null, 'GET', '/api/connectors/sealed/all', undefined, { Cookie: member.cookie })).status, 403, 'an admin\'s, like the logins');
  assert.equal((await H.api(null, 'POST', '/api/connectors/sealed/all', { name: 'Bad Name', value: 'x' })).status, 400);
  assert.match(require('../modules/harness/turn/fits').inventory(new Set(['secret_use'])), /Secrets for secret_use[^\n]*bank-pin \(https:\/\/bank\.example\)/);
});

test('using one is always a person\'s question, never "always", and no specialist holds it', async () => {
  const approval = require('../modules/harness/approval');
  const g = approval.gate('secret_use', { secret: 'bank-pin', device: 'laptop', mode: 'type' });
  assert.equal(g.forced, true);
  assert.equal(g.keys, null);
  assert.match(g.summary, /bank-pin.*laptop.*typed into what has focus/);
  const q = approval.ask(g, { timeoutMs: 2000 });
  assert.throws(() => approval.decide(q.id, 'always'), /only be allowed once/);
  approval.decide(q.id, 'deny');
  assert.equal(await q.answer, 'deny');
  assert.ok(require('../modules/agents/registry').NEVER.includes('secret_use'));
});

test('a device takes its own seal key with its token; the agent cannot reach the hidden tool', async () => {
  const start = await H.api(null, 'POST', '/api/devices/pair', { name: 'laptop', preset: 'phone' });
  const cfg = await client.pair(H.base, start.body.code, { name: 'laptop' });
  deviceId = cfg.deviceId;
  lending = await client.run({ grant: ['device'], bind: '127.0.0.1', port: 0, root: dir });
  assert.ok(lending.cfg.sealKey, 'taken at run');
  const again = await H.api(cfg.token, 'GET', '/api/v1/mcp/self/seal');
  assert.equal(again.body.key, lending.cfg.sealKey, 'the same key each time');
  assert.equal((await H.api(null, 'GET', '/api/v1/mcp/self/seal', undefined, { Cookie: '' })).status, 401);
  const offer = (await H.api(null, 'GET', '/api/mcp')).body.offers.find(o => o.deviceId === deviceId);
  assert.ok(!offer.tools.includes('secret_fill'), 'never offered');
  await H.api(null, 'POST', `/api/mcp/offers/${offer.id}/accept`);
  const reg = require('../modules/mcp/registry');
  serverId = reg.forDevice(deviceId).id;
  if (reg.client(serverId)?.state !== 'running') await reg.start(serverId);
  const tools = require('../modules/harness/tools');
  assert.match(await tools.call(`mcp__${serverId}__secret_fill`, { sealed: {} }), /no MCP tool named/, 'not in the agent\'s tools');
  // Even straight at the device: what is not sealed with its key is refused.
  assert.match(await reg.client(serverId).callTool('secret_fill', { sealed: { v: 1, iv: 'AAAAAAAAAAAAAAAA', data: Buffer.alloc(40).toString('base64') } }), /not sealed for this machine/);
});

test('typed once into what has focus: the device got the value, the agent got a sentence', async () => {
  const out = await require('../modules/harness/tools').call('secret_use', { secret: 'bank-pin', device: 'laptop', mode: 'type' });
  assert.match(out, /Used "bank-pin" on laptop by typing it/);
  assert.ok(!out.includes(VALUE));
  assert.deepEqual(typed, [VALUE]);
});

test('on the clipboard for N pastes: the shell and clipboard reads wait until it is gone', async () => {
  const tools = require('../modules/harness/tools');
  const out = await tools.call('secret_use', { secret: 'bank-pin', device: deviceId, uses: 3, seconds: 20 });
  assert.match(out, /on its clipboard\. It is forgotten after 3 pastes or 20 s/);
  assert.deepEqual(clipped.at(-1), { v: VALUE, uses: 3 });
  assert.equal(sealed.armed(), true);
  assert.match(await tools.call(`mcp__${serverId}__device_clipboard_read`, {}), /A secret is on this machine's clipboard/);
  gone();   // the pastes were served
  assert.equal(sealed.armed(), false);
  const uses = (await H.api(null, 'GET', '/api/connectors/sealed/all')).body.uses;
  assert.ok(uses.length >= 2 && uses.every(u => u.outcome === 'done' && u.device === 'laptop'));
  assert.match(uses[0].target, /clipboard, 3 pastes or 20 s/);
});

test('a sealed payload opens once, only on its own device, and is refused when replayed', () => {
  const seal = require('../modules/sealed/seal');
  const s = seal.seal(deviceId, { how: 'type', value: 'x' });
  const cfg = lending.cfg;
  assert.equal(sealed.open(cfg, s).value, 'x');
  assert.throws(() => sealed.open(cfg, s), /already used/);
  assert.throws(() => sealed.open({ ...cfg, deviceId: 'dev_other' }, seal.seal(deviceId, { how: 'type', value: 'y' })), /not sealed for this machine/);
});

test('refusals: another person\'s device, an unknown secret, a field without its site, and a member\'s turn', async () => {
  const use = require('../modules/sealed/use');
  const member = { id: 'usr_someone', role: 'member' };
  await assert.rejects(use.use({ secret: 'bank-pin', device: 'laptop' }, { user: member }), /someone else's device/);
  await assert.rejects(use.use({ secret: 'nope', device: 'laptop' }), /No secret "nope"[^]*bank-pin/);
  await H.api(null, 'POST', '/api/connectors/sealed/all', { name: 'wifi', value: 'guest-pass-123' });
  await assert.rejects(use.use({ secret: 'wifi', device: 'laptop', ref: 3 }), /filled into a web page only on its own site/);
  await assert.rejects(use.use({ secret: 'login:none', device: 'laptop' }, { user: { id: H.owner.user.id, role: 'member' } }), /an admin's/);
  assert.match(await use.use({ secret: 'bank-pin', device: 'laptop', ref: 2 }).catch(e => e.message), /no web page to fill/, 'a desktop refuses a field');
});

test('the browser extension fills a field only on the secret\'s own site, after opening what the hub sealed with WebCrypto', async () => {
  const mcp = require('../clients/browser/mcp');
  const seal = require('../modules/sealed/seal');
  const bid = 'dev_browser_test';
  const key = seal.mint(bid);
  const b64 = x => Uint8Array.from(Buffer.from(x, 'base64'));
  const filled = [];
  const env = { tabUrl: 'https://bank.example/login',
    tabs: async () => [{ id: 1, url: env.tabUrl, active: true }], tab: async () => ({ id: 1, url: env.tabUrl, active: true }), allowed: async () => true,
    deviceId: async () => bid,
    unseal: async s => JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(s.iv), additionalData: new TextEncoder().encode(`doca-seal:${bid}`) },
      await crypto.subtle.importKey('raw', b64(key), 'AES-GCM', false, ['decrypt']), b64(s.data)))),
    page: async (_t, fn, ...a) => (fn === 'fillSecret' ? (filled.push(a), { ok: true }) : true) };
  const call = async sealedArg => (await mcp.handle(env, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'secret_fill', arguments: { sealed: sealedArg } } })).result;
  const list = (await mcp.handle(env, { jsonrpc: '2.0', id: 0, method: 'tools/list' })).result.tools.map(t => t.name);
  assert.ok(!list.includes('secret_fill'));
  const r = await call(seal.seal(bid, { how: 'field', value: VALUE, ref: 2, tab: 1, origin: 'https://bank.example' }));
  assert.ok(!r.isError, JSON.stringify(r));
  assert.deepEqual(filled, [[2, VALUE]]);
  assert.ok(!JSON.stringify(r).includes(VALUE));
  env.tabUrl = 'https://bank.example.evil.test/login';
  const evil = await call(seal.seal(bid, { how: 'field', value: VALUE, ref: 2, tab: 1, origin: 'https://bank.example' }));
  assert.equal(evil.isError, true);
  assert.match(evil.content[0].text, /only on its own site/);
  assert.equal(filled.length, 1, 'a look-alike gets nothing');
  const page = require('../clients/browser/page');
  const field = { tagName: 'INPUT', type: 'password', value: '', dispatchEvent() {}, focus() {} };
  const r2 = page.fillSecret(2, VALUE, { querySelector: () => field });
  assert.ok(r2.ok && field.value === VALUE && !JSON.stringify(r2).includes(VALUE));
  assert.equal(page.fillSecret(2, VALUE, { querySelector: () => ({ tagName: 'BUTTON' }) }).ok, false);
});

test('a real turn: asked, used, answered — and the value is nowhere in the hub\'s data, logs or transcript', async () => {
  const sse = frames => res => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); for (const f of frames) res.write(`data: ${JSON.stringify(f)}\n\n`); res.end('data: [DONE]\n\n'); };
  const server = http.createServer((req, res) => {
    let raw = ''; req.on('data', c => { raw += c; }); req.on('end', () => {
      const msgs = JSON.parse(raw || '{}').messages || [];
      if (msgs.some(m => m.role === 'tool')) return sse([{ choices: [{ delta: { content: 'Typed it on your laptop.' } }] }])(res);
      return sse([{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'secret_use', arguments: JSON.stringify({ secret: 'bank-pin', device: 'laptop', mode: 'type' }) } }] } }] }])(res);
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try {
    fs.writeFileSync(require('../modules/paths').CONFIG_PATH, JSON.stringify({ models: { providers: { sstub: { baseUrl: `http://127.0.0.1:${server.address().port}/v1` } } } }));
    require('../modules/harness/catalog').saveConfig('doca', { provider: 'sstub', model: 'm', fallbackChain: [], summarizeAfter: 0 });
    const memory = require('../modules/harness/memory'), approval = require('../modules/harness/approval');
    const s = memory.createSession('sealed', { activate: false });
    let asked = null;
    const answering = (async () => { for (let i = 0; i < 200 && !asked; i++) { await H.sleep(25); asked = approval.pending().find(p => p.tool === 'secret_use'); } if (asked) approval.decide(asked.id, 'once'); })();
    typed.length = 0;
    const r = await require('../modules/harness/agent').turn({ message: 'Type my bank PIN on the laptop.', sessionId: s.id, emit: () => {} });
    await answering;
    assert.ok(asked, 'the person was asked');
    assert.match(r.text, /Typed it/);
    assert.deepEqual(typed, [VALUE], 'used once');
    const rows = JSON.stringify(memory.messages(s.id));
    assert.match(rows, /Used \\"bank-pin\\" on laptop/);
    assert.ok(!rows.includes(VALUE), 'not in the transcript');
    assert.ok(!JSON.stringify(require('../modules/logs')._ring).includes(VALUE), 'not in the logs');
    // Every file under the hub's data folder (doca.db and its journal included: traces, audit, the bus's queue).
    const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
    assert.ok(walk(process.env.DOCA_DATA_DIR).some(f => /doca\.db$/.test(f)), 'the database is among them');
    const hits = walk(process.env.DOCA_DATA_DIR).filter(f => fs.readFileSync(f).includes(Buffer.from(VALUE)));
    assert.deepEqual(hits, [], 'the value is in no file of the hub');
  } finally { server.closeAllConnections(); await new Promise(r => server.close(r)); }
});

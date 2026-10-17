'use strict';

/**
 * Tokens per provider on Field → API keys (asked 2026-10-16): today, this month and in all, money only where the owner
 * priced the model ("no price" is null, never 0), each model under its provider; a host reads the hive's, anyone else
 * their own. And what OpenRouter and DeepSeek say of their own, read with the hive's key from stub servers: the key
 * goes only to the provider's own origin and never comes back to the browser.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const http   = require('http');
const H      = require('./helpers');   // first: it points the settings at a temporary folder

const seen = [];
let stub, deepStub, stubUrl, deepUrl;
function serve(handler) {
  return new Promise(resolve => {
    const s = http.createServer((req, res) => { seen.push({ url: req.url, auth: req.headers.authorization, host: req.headers.host }); handler(req, res); });
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
}

test.before(async () => {
  stub = await serve((req, res) => {
    if (req.url !== '/api/v1/key' && req.url !== '/api/v1/credits') { res.writeHead(404); return res.end(); }
    if (req.headers.authorization !== 'Bearer sk-or-good-key-123456') { res.writeHead(401); return res.end('{}'); }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (req.url === '/api/v1/credits') return res.end(JSON.stringify({ data: { total_credits: 10, total_usage: 9.21 } }));
    res.end(JSON.stringify({ data: { label: 'sk-or-…', usage: 3.25, limit: 10, limit_remaining: 6.75, is_free_tier: false } }));
  });
  deepStub = await serve((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '110.00', granted_balance: '10.00', topped_up_balance: '100.00' }] }));
  });
  stubUrl = `http://127.0.0.1:${stub.address().port}`;
  deepUrl = `http://127.0.0.1:${deepStub.address().port}`;
  process.env.DOCA_OPENROUTER_ORIGIN = stubUrl;
  process.env.DOCA_DEEPSEEK_ORIGIN = deepUrl;
  await H.start();
});
test.after(async () => { stub.close(); deepStub.close(); await H.stop(); });

const memory = () => require('../modules/harness/memory');
async function row(at, provider, model, prompt, completion, cached, { who = null, source = 'provider' } = {}) {
  let sid = null;
  if (who) {
    const s = memory().createSession('usage per provider', { activate: false });
    memory().updateSession(s.id, { person: { id: who.user.id, orgId: who.orgId } });
    sid = s.id;
  }
  await require('../modules/harness/usage').summary({ days: 1 });
  await require('../modules/db').run('INSERT INTO usage (at, kind, provider, model, session_id, prompt, completion, cached, source, person_id) VALUES (?,?,?,?,?,?,?,?,?,?)',
    [at, 'turn', provider, model, sid, prompt, completion, cached, source, null]);
}

test('each provider: tokens today, this month and in all, money where priced, each model in its own row', async () => {
  const now = new Date();
  const today = now.toISOString();
  const lastYear = new Date(Date.UTC(now.getUTCFullYear() - 1, 0, 15)).toISOString();
  const member = await H.signIn('member', 'upp-m@test.local');
  await row(today, 'pv-a', 'big', 1000000, 2000, 500000);
  await row(lastYear, 'pv-a', 'big', 4000000, 0, 0);
  await row(today, 'pv-a', 'free', 100, 10, 0, { source: 'estimated' });
  await row(today, 'pv-b', 'x', 700, 70, 0, { who: member });
  require('../modules/harness/prices').save({ currency: 'USD', models: { 'pv-a/big': { input: 1, cached: 0.1, output: 2 } } });

  let r = await H.api(null, 'GET', '/api/usage/providers');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.person, false, 'a host reads the hive\'s');
  const a = r.body.providers['pv-a'];
  assert.equal(a.today.prompt, 1000100);
  assert.equal(a.today.cached, 500000);
  assert.equal(a.today.estimated, 1);
  assert.equal(a.all.prompt, 5000100, 'in all counts last year too');
  // 500000 uncached at 1 + 500000 cached at 0.1 + 2000 out at 2, per million
  assert.ok(Math.abs(a.today.money - (0.5 + 0.05 + 0.004)) < 1e-9, String(a.today.money));
  assert.equal(a.today.unpriced, 1, 'the free model\'s call is counted, not priced');
  assert.deepEqual(a.models.map(m => m.model), ['big', 'free'], 'largest first');
  const free = a.models.find(m => m.model === 'free');
  assert.equal(free.today.money, null, 'no price is null, never 0');
  assert.equal(free.priced, false);
  assert.ok(r.body.providers['pv-b'], 'the member\'s use is in the hive\'s');

  r = await H.api(null, 'GET', '/api/usage/providers', undefined, { Cookie: member.cookie });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.person, true);
  assert.deepEqual(Object.keys(r.body.providers), ['pv-b'], 'a member reads only their own');
  assert.equal(r.body.providers['pv-b'].month.prompt, 700);

  assert.equal((await H.api(null, 'GET', '/api/usage/providers', undefined, { Cookie: '' })).status, 401);
});

test('the providers\' own figures: asked with the key at their own origin only, never returned, kept five minutes', async () => {
  const keys = require('../modules/provider-keys');
  keys.set('openrouter', { baseUrl: `${stubUrl}/api/v1`, apiKey: 'sk-or-good-key-123456', api: 'openai-chat-completions', models: [] });
  keys.set('deepseek', { baseUrl: `${deepUrl}/v1`, apiKey: 'sk-deep-secret-7890abcd', api: 'openai-chat-completions', models: [] });
  keys.set('or-elsewhere', { baseUrl: 'http://127.0.0.1:9/v1', apiKey: 'sk-elsewhere-000000000', api: 'openai-chat-completions', models: [] });
  seen.length = 0;

  let r = await H.api(null, 'GET', '/api/keys/balances');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const b = r.body.balances;
  assert.equal(b.openrouter.ok, true, JSON.stringify(b.openrouter));
  assert.deepEqual([b.openrouter.figure.used, b.openrouter.figure.limit, b.openrouter.figure.remaining], [3.25, 10, 6.75]);
  assert.equal(b.openrouter.figure.credit, 0.79, 'the account\'s own credit beside the key\'s limit (2026-10-17)');
  assert.equal(b.deepseek.figure.balance, 110);
  assert.equal(b.deepseek.figure.currency, 'CNY');
  assert.ok(!b['or-elsewhere'], 'a provider at another address has no dialect: DOCA\'s count alone');
  const text = JSON.stringify(r.body);
  assert.ok(!text.includes('sk-or-good') && !text.includes('sk-deep-secret'), 'no key reaches the browser');
  assert.deepEqual(seen.map(s => s.auth).sort(), ['Bearer sk-deep-secret-7890abcd', 'Bearer sk-or-good-key-123456', 'Bearer sk-or-good-key-123456']);

  seen.length = 0;
  await H.api(null, 'GET', '/api/keys/balances');
  assert.equal(seen.length, 0, 'kept five minutes');

  // A refused key is said in words.
  keys.set('openrouter', { apiKey: 'sk-or-wrong-key-000000' });
  r = await H.api(null, 'GET', '/api/keys/balances?fresh=1');
  assert.equal(r.body.balances.openrouter.ok, false);
  assert.match(r.body.balances.openrouter.error, /refused the key/);

  // A member does not read the hive's accounts.
  const member = await H.signIn('member', 'upp-b@test.local');
  assert.equal((await H.api(null, 'GET', '/api/keys/balances', undefined, { Cookie: member.cookie })).status, 403);
});

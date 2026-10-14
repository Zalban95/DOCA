'use strict';

/**
 * The model relay (modules/relay; the owner's, 2026-10-14): an agents' computer whose switch is on asks the hub's
 * models with its own relay token, through the hub's provider — whose key never reaches the computer or the answer —
 * streamed or not; an absent, unknown or switched-off token is refused in OpenAI's error shape; what it spends is the
 * usage ledger's, for the computer's person, and their budget refuses it like a turn. No Docker: the computer is a
 * record, and the relay listens on loopback.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const http   = require('node:http');
const H      = require('./helpers');   // first: it points the settings at a temporary folder

const SECRET = 'sk-relay-test-provider-key-0123456789';
let stub, seen = [], relayUrl;

test.before(async () => {
  await H.start();
  stub = http.createServer((req, res) => {
    let raw = ''; req.on('data', d => { raw += d; });
    req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      seen.push({ auth: req.headers.authorization, body });
      const usage = { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 };
      const text = body.model === 'leaky' ? `the key is ${SECRET}` : 'Hello there';
      if (!body.stream) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ id: 'x', object: 'chat.completion', model: body.model, choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }], usage }));
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      for (const part of ['Hello', ' there']) res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: part } }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
      if (body.stream_options?.include_usage) res.write(`data: ${JSON.stringify({ choices: [], usage })}\n\n`);
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise(r => stub.listen(0, '127.0.0.1', r));
  fs.writeFileSync(process.env.CONFIG_PATH, JSON.stringify({ models: { providers: {
    stub: { baseUrl: `http://127.0.0.1:${stub.address().port}/v1`, apiKey: SECRET },
  } } }));
  require('../modules/harness/catalog').saveConfig('doca', { provider: 'stub', model: 'm1', fallbackChain: [{ provider: 'stub', model: 'm2' }] });
  require('../modules/computers/strays').docker = async () => '';   // no Docker: writing relay.env into it is a no-op
  await require('../modules/relay').sync({ address: '127.0.0.1', port: 0 });
});
test.after(async () => {
  await require('../modules/relay').close();
  stub.closeAllConnections();
  await new Promise(r => stub.close(r));
  await H.stop();
});

const computers = () => require('../modules/computers');
const ask = (path, { token, body, method = body ? 'POST' : 'GET' } = {}) => fetch(`${relayUrl}${path}`, {
  method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });

/** A computer an agent of `who` made in their conversation, with the relay switched on through the panel. */
async function computer(who, id) {
  const memory = require('../modules/harness/memory');
  const s = memory.createSession('relay test', { activate: false });
  memory.updateSession(s.id, { person: { id: who.user.id, orgId: who.orgId } });
  computers().save([...computers().rows(), { id, name: `relay-${id}`, by: s.id, auto: true, token: 'control', mcpPort: 1, vncPort: 2, createdAt: new Date().toISOString() }]);
  const r = await H.api(null, 'POST', `/api/computers/${id}/relay`, { on: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return { token: computers().get(id).relayToken, sessionId: s.id };
}

test('off by default; the owner switches it on for computers, and it listens apart from the panel', async () => {
  let r = await H.api(null, 'GET', '/api/computers/relay');
  assert.equal(r.status, 200);
  assert.equal(r.body.enabled, false, 'a new install has no relay');
  assert.equal(r.body.listening, null);
  r = await H.api(null, 'POST', '/api/computers/relay', { devices: true });
  assert.equal(r.status, 409, 'devices wait for a scope of their own (S11)');
  r = await H.api(null, 'POST', '/api/computers/relay', { address: '100.101.102.103' });
  assert.equal(r.status, 400, 'never the tailnet');
  r = await H.api(null, 'POST', '/api/computers/relay', { enabled: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.enabled, true);
  assert.ok(r.body.listening, r.body.reason);
  relayUrl = `http://127.0.0.1:${r.body.listening.port}`;
  assert.deepEqual(r.body.offered.map(e => e.model), ['m1', 'm2'], 'by default the harness\'s model and its fallbacks');
  const m = await H.signIn('member', 'relay-off@test.local');
  r = await H.api(null, 'POST', '/api/computers/relay', { enabled: false }, { Cookie: m.cookie });
  assert.equal(r.status, 403, 'the machine\'s: a host\'s');
});

test('a computer\'s token gets answers, streamed and not; the key never reaches it', async () => {
  const m = await H.signIn('member', 'relay-use@test.local');
  const { token, sessionId } = await computer(m, 'aa11bb22');
  const view = JSON.stringify(computers().view(computers().get('aa11bb22')));
  assert.ok(!view.includes(token), 'the card and the tool never show the relay token');
  assert.match(view, /"relay":\{"on":true/);
  const env = require('../modules/relay/computer').vars(computers().get('aa11bb22'));
  assert.equal(env.OPENAI_API_KEY, token);
  assert.match(env.OPENAI_BASE_URL, /^http:\/\/host\.docker\.internal:\d+\/v1$/);
  assert.ok(!JSON.stringify(env).includes(SECRET) && !require('../modules/relay/computer').dockerEnv({ id: 'x' }).join(' ').includes(SECRET), 'no provider key in its environment');

  let r = await ask('/v1/models', { token });
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).data.map(x => x.id), ['m1', 'm2']);

  seen = [];
  r = await ask('/v1/chat/completions', { token, body: { model: 'm2', messages: [{ role: 'user', content: 'hi' }], temperature: 0.3 } });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.choices[0].message.content, 'Hello there');
  assert.equal(seen[0].auth, `Bearer ${SECRET}`, 'the hub adds its own key');
  assert.equal(seen[0].body.temperature, 0.3, 'the body goes on as written');
  assert.equal(seen[0].body.model, 'm2');

  r = await ask('/v1/chat/completions', { token, body: { model: 'leaky', messages: [{ role: 'user', content: 'hi' }] } });
  assert.equal(r.status, 404, 'only what it offers');
  assert.equal((await r.json()).error.code, 'model_not_found');

  r = await ask('/v1/chat/completions', { token, body: { messages: [{ role: 'user', content: 'hi' }], stream: true } });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /event-stream/);
  const sse = await r.text();
  const frames = sse.split('\n').filter(l => l.startsWith('data:') && !l.includes('[DONE]')).map(l => JSON.parse(l.slice(5)));
  assert.equal(frames.map(f => f.choices?.[0]?.delta?.content || '').join(''), 'Hello there');
  assert.ok(frames.every(f => !f.usage), 'a usage frame only when the caller asked for one');
  assert.match(sse, /\[DONE\]/);
  assert.equal(seen.at(-1).body.stream_options.include_usage, true, 'asked of the provider for the ledger');
  assert.equal(seen.at(-1).body.model, 'm1', 'no model named: the first it offers');

  r = await ask('/v1/chat/completions', { token, body: { messages: [{ role: 'user', content: 'hi' }], stream: true, stream_options: { include_usage: true } } });
  assert.ok((await r.text()).includes('"prompt_tokens":11'), 'asked for, it is passed on');

  // Counted for the computer's person, in the ledger the budgets read.
  const db = require('../modules/db');
  let rows = [];
  for (let i = 0; i < 40 && rows.length < 3; i++) { rows = await db.all("SELECT * FROM usage WHERE kind = 'relay' AND session_id = ?", [sessionId]); await new Promise(x => setTimeout(x, 25)); }
  assert.equal(rows.length, 3);
  assert.ok(rows.every(x => x.person_id === m.user.id && x.agent === 'computer:aa11bb22' && x.source === 'provider'));
});

test('a provider\'s answer carrying its key is scrubbed', async () => {
  const relay = require('../modules/relay/routes');
  relay.save({ models: ['stub/leaky'] });
  try {
    const m = await H.signIn('member', 'relay-leak@test.local');
    const { token } = await computer(m, 'cc33dd44');
    const r = await ask('/v1/chat/completions', { token, body: { model: 'leaky', messages: [{ role: 'user', content: 'hi' }] } });
    const text = await r.text();
    assert.equal(r.status, 200);
    assert.ok(!text.includes(SECRET), 'not even when the provider says it');
  } finally { relay.save({ models: [] }); }
});

test('no token, a token the hub did not make, a switched-off computer and a switched-off relay are refused', async () => {
  const m = await H.signIn('member', 'relay-refused@test.local');
  const { token } = await computer(m, 'ee55ff66');
  const body = { messages: [{ role: 'user', content: 'hi' }] };
  let r = await ask('/v1/chat/completions', { body });
  assert.equal(r.status, 401);
  assert.equal((await r.json()).error.code, 'invalid_api_key');
  r = await ask('/v1/models', { token: `relay-${'0'.repeat(48)}` });
  assert.equal(r.status, 401);

  r = await H.api(null, 'POST', '/api/computers/ee55ff66/relay', { on: false });
  assert.equal(r.status, 200);
  r = await ask('/v1/chat/completions', { token, body });
  assert.equal(r.status, 401, 'switched off, the token it had is refused as no token of the hub\'s');
  r = await ask('/v1/chat/completions', { token: computers().get('ee55ff66').relayToken, body });
  assert.equal(r.status, 403, 'and the one kept in its place is refused while it is off');
  assert.equal((await r.json()).error.code, 'relay_off');
  assert.notEqual(computers().get('ee55ff66').relayToken, token, 'switched off, its token is replaced: a copy taken out is dead');
  await H.api(null, 'POST', '/api/computers/ee55ff66/relay', { on: true });
  const fresh = computers().get('ee55ff66').relayToken;
  assert.notEqual(fresh, token, 'switched back on, a new one');
  assert.equal(computers().get('ee55ff66').relayEnv, false, 'its environment holds the dead one: relay.env holds the live one');
  r = await ask('/v1/chat/completions', { token, body });
  assert.equal(r.status, 401, 'the old token is nobody\'s now');
  r = await ask('/v1/chat/completions', { token: fresh, body });
  assert.equal(r.status, 200);
  await H.api(null, 'POST', '/api/computers/ee55ff66/relay', { on: true });
  assert.equal(computers().get('ee55ff66').relayToken, fresh, 'switched on again while on: unchanged');

  const routes = require('../modules/relay/routes');
  routes.save({ enabled: false });   // saved, the listener not yet closed: the relay itself still refuses
  try {
    r = await ask('/v1/models', { token: fresh });
    assert.equal(r.status, 403);
    assert.match((await r.json()).error.message, /off for agents' computers/);
  } finally { routes.save({ enabled: true }); }

  computers().save(computers().rows().filter(c => c.id !== 'ee55ff66'));
  r = await ask('/v1/models', { token: fresh });
  assert.equal(r.status, 401, 'its computer removed, the token is nobody\'s');
});

test('the person\'s budget refuses it, in OpenAI\'s error shape', async () => {
  const m = await H.signIn('member', 'relay-budget@test.local');
  const { token } = await computer(m, 'aa77bb88');
  let r = await ask('/v1/chat/completions', { token, body: { messages: [{ role: 'user', content: 'hi' }] } });
  assert.equal(r.status, 200);
  await new Promise(x => setTimeout(x, 200));   // the ledger's write
  r = await H.api(null, 'POST', '/api/spending/budget', { personId: m.user.id, budget: { tokensPerDay: 5 } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  r = await ask('/v1/chat/completions', { token, body: { messages: [{ role: 'user', content: 'hi' }] } });
  assert.equal(r.status, 429);
  const e = (await r.json()).error;
  assert.equal(e.code, 'budget_reached');
  assert.equal(e.type, 'insufficient_quota');
  assert.match(e.message, /budget/i);
});

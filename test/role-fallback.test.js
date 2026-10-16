'use strict';

// Round 1 of the DOCA-vs-Claude-Code test (2026-10-16): the mastermind's provider refused the reply cap the worker took
// (HTTP 400 "supports at most 131072 completion tokens"), every mastermind step failed, and with it the turn and every
// later message in that conversation. Two fixes: the model's maximum is learned (contracts.js maxOutput, from the refusal
// or the server's /models list), and a role's model that fails hands the step to the turn's own model, said once.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');   // first: it points the settings at a temporary folder
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const contracts = () => require('../modules/harness/contracts');
const memory = () => require('../modules/harness/memory');
const catalog = () => require('../modules/harness/catalog');
const utils = () => require('../modules/utils');

let model;
before(async () => { await H.start(); model = await stubModel(); });
after(async () => { await model.close(); await H.stop(); });

function setRoles(mastermind, worker) {
  const prefs = utils().loadPrefs();
  utils().savePrefs({ ...prefs, harness: { ...(prefs.harness || {}), models: { mastermind, worker } } });
}

// `capped` takes at most 1000 reply tokens and says so the way OpenRouter does; `broken` refuses everything; `listed`
// says its maximum in /models (top_provider.max_completion_tokens); `base` takes anything.
async function stubModel() {
  const m = { seen: [], reply: () => ({ content: 'Done.' }) };
  const server = http.createServer((req, res) => {
    let raw = ''; req.on('data', c => { raw += c; }); req.on('end', () => {
      if (req.method === 'GET') {
        res.writeHead(/\/models$/.test(req.url) ? 200 : 404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ data: [{ id: 'listed', context_length: 200000, top_provider: { context_length: 200000, max_completion_tokens: 4096 } }, { id: 'base' }] }));
      }
      const body = JSON.parse(raw);
      m.seen.push(body);
      const cap = body.max_tokens ?? body.max_completion_tokens;
      const refuse = text => { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { message: text, code: 400 } })); };
      if (body.model === 'capped' && cap > 1000)
        return refuse(`The request parameter max_tokens is too large: ${cap}. This model supports at most 1000 completion tokens`);
      if (body.model === 'broken') return refuse('No endpoints found that support this request.');
      const message = m.reply(m.seen.filter(b => b.model !== 'broken').length - 1, body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 5 } }));
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const { CONFIG_PATH } = require('../modules/paths');
  const cfg = fs.existsSync(CONFIG_PATH) ? JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) : {};
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ ...cfg, models: { providers: { ...(cfg.models?.providers || {}), capstub: { baseUrl: `http://127.0.0.1:${server.address().port}/v1` } } } }));
  m.use = reply => { m.seen = []; m.reply = reply; return m; };
  m.close = async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); };
  return m;
}

const call = (id, name, args = {}) => ({ content: '', tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });

async function turn(events = []) {
  catalog().saveConfig('doca', { provider: 'capstub', model: 'base', maxSteps: 6, maxTokens: 256000, fallbackChain: [], contextWindow: 0 });
  const s = memory().createSession('round1', { activate: false });
  memory().updateSession(s.id, { kind: 'work' });
  const r = await require('../modules/harness/agent').turn({ message: 'look around', sessionId: s.id, emit: e => events.push(e) });
  return { r, events };
}

test('the refusal\'s wordings are read for the most a reply may be; a context-length refusal is not one', () => {
  const c = contracts();
  assert.equal(c.maxOutputFrom('{"error":{"message":"The request parameter max_tokens is too large: 256000. This model supports at most 131072 completion tokens"}}'), 131072);
  assert.equal(c.maxOutputFrom('max_tokens: 256000 > 64000, which is the maximum allowed number of output tokens for claude-x'), 64000);
  assert.equal(c.maxOutputFrom('Invalid max_tokens value, the valid range of max_tokens is [1, 8192]'), 8192);
  assert.equal(c.maxOutputFrom('`max_tokens` must be less than or equal to `8192`, the maximum value for `max_tokens` is less than the `context_window`'), 8192);
  assert.equal(c.maxOutputFrom("This model's maximum context length is 131072 tokens. However, you requested 300000 tokens"), null);
  assert.equal(c.maxOutputFrom(''), null);
  assert.deepEqual(c.shape({ max_tokens: 256000 }, { maxOutput: 131072 }), { max_tokens: 131072 });
  assert.deepEqual(c.shape({ max_tokens: 256000 }, { maxOutput: 9, tokenField: 'max_completion_tokens' }), { max_completion_tokens: 9 });
});

test('a mastermind over its reply maximum: retried once at the maximum, learned for the model, sent that way after', async () => {
  contracts().forget('capstub');
  setRoles('capstub/capped', '');
  try {
    model.use(() => ({ content: 'Done.' }));
    const { r } = await turn();
    assert.equal(r.text, 'Done.');
    const capped = model.seen.filter(b => b.model === 'capped').map(b => b.max_tokens ?? b.max_completion_tokens);
    assert.deepEqual(capped, [256000, 1000], 'refused once, then asked at the maximum it named');
    assert.equal(contracts().forProvider('capstub', 'capped').maxOutput, 1000);
    assert.equal(contracts().forProvider('capstub', 'base').maxOutput, undefined, 'another model on the server is not assumed to share it');

    model.use(() => ({ content: 'Done.' }));
    await turn();
    assert.deepEqual(model.seen.map(b => b.max_tokens ?? b.max_completion_tokens), [1000], 'the next turn is sent the cap it takes, first time');
  } finally { setRoles('', ''); contracts().forget('capstub'); }
});

test('a mastermind that keeps failing does not fail the turn: its steps go to the harness\'s model, said once', async () => {
  setRoles('capstub/broken', '');
  try {
    // Step 1 (mastermind) reads a missing file — a failure, so step 2 is the mastermind's again (a re-plan); then done.
    model.use(i => [call('a', 'read_file', { path: path.join(H.tmp, 'round1-missing.txt') }), { content: 'Done.' }][i] || { content: 'Done.' });
    const { r, events } = await turn();
    assert.equal(r.text, 'Done.', 'the turn answers');
    const warned = events.filter(e => e.type === 'warning' && e.kind === 'role-fallback');
    assert.equal(warned.length, 1, 'said once a turn, not once a step');
    assert.equal(warned[0].role, 'mastermind');
    assert.match(warned[0].text, /capstub\/broken.*No endpoints found.*harness's own model \(capstub\/base\)/s);
    const order = model.seen.map(b => b.model);
    const lastBroken = order.lastIndexOf('broken');
    assert.ok(lastBroken < order.indexOf('base'), `the broken model is asked only on the first step: ${order.join(', ')}`);
    assert.equal(order.filter(m => m === 'base').length, 2, 'both mastermind steps answered by the harness\'s model');
    const steps = events.filter(e => e.type === 'step');
    assert.ok(steps.every(e => e.model === 'base' && e.role === 'mastermind'), 'the steps still say which role they ran as');

    // The next message in that conversation is not refused at once.
    model.use(() => ({ content: 'Again.' }));
    const again = await turn();
    assert.equal(again.r.text, 'Again.');
  } finally { setRoles('', ''); }
});

test('a model\'s reply maximum in the server\'s /models list is kept as its contract', async () => {
  contracts().forget('capstub');
  const found = await require('../modules/harness/context-window').discover('capstub', 'listed');
  assert.equal(found.tokens, 200000);
  assert.equal(contracts().forProvider('capstub', 'listed').maxOutput, 4096);
  assert.equal(contracts().forProvider('capstub', 'base').maxOutput, undefined, 'an entry that says nothing teaches nothing');
  contracts().forget('capstub');
});

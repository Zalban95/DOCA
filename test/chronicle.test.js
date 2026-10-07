'use strict';

// Chronicle (modules/chronicle, TODO P1.13): every run found again, filtered, and the story of a piece of work told
// from its runs and traces — what ran, why, what it cost, what failed — each row the viewer's own unless host.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const H = require('./helpers');
const memory = require('../modules/harness/memory');

let server, script = [];
const sse = frames => res => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); for (const f of frames) res.write(`data: ${JSON.stringify(f)}\n\n`); res.end('data: [DONE]\n\n'); };

before(async () => {
  await H.start();
  server = http.createServer((req, res) => {
    req.resume(); req.on('end', () => {
      const next = script.shift() || { text: 'done' };
      const usage = { prompt_tokens: 500, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 300 } };
      if (next.tool) return sse([{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: next.tool, arguments: JSON.stringify(next.args) } }] } }] }, { choices: [], usage }])(res);
      return sse([{ choices: [{ delta: { content: next.text } }] }, { choices: [], usage }])(res);
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const { CONFIG_PATH } = require('../modules/paths');
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ models: { providers: { cstub: { baseUrl: `http://127.0.0.1:${server.address().port}/v1` } } } }));
  require('../modules/harness/catalog').saveConfig('doca', { provider: 'cstub', model: 'm1', fallbackChain: [], summarizeAfter: 0 });
});
after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); await H.stop(); });

const turn = (sessionId, message, client) => require('../modules/harness/agent').turn({ message, sessionId, ...(client ? { client } : {}) });

test('a turn is a row: its conversation, agent, device, cost; searchable and filtered', async () => {
  const s = memory.createSession('Chronicle: the printer', { activate: false });
  memory.updateSession(s.id, { person: { id: H.owner.user.id } });
  script = [{ tool: 'memory_search', args: { query: 'printer' } }, { text: 'The printer is on the shelf.' }];
  const r = await turn(s.id, 'where is the printer', { id: 'dev_chron', name: 'Kitchen tablet', kind: 'phone' });
  const { status, body } = await H.api(null, 'GET', '/api/chronicle?q=printer');
  assert.equal(status, 200, JSON.stringify(body));
  const row = body.rows.find(x => x.id === r.runId);
  assert.ok(row, 'the run is found by a word of its title');
  assert.equal(row.source, 'turn');
  assert.equal(row.state, 'done');
  assert.match(row.title, /printer/, 'the conversation\'s title');
  assert.equal(row.device.name, 'Kitchen tablet', 'which device asked is kept on the run');
  assert.equal(row.agent.id, 'work');
  assert.match(row.outcome, /shelf/);
  assert.ok(body.facets.devices.some(d => d.id === 'dev_chron'));
  assert.ok(body.facets.sources.includes('log'), 'a host also reads the harness log');
  assert.equal((await H.api(null, 'GET', '/api/chronicle?device=dev_chron')).body.rows.length, 1);
  assert.equal((await H.api(null, 'GET', '/api/chronicle?q=nothing-like-this')).body.rows.length, 0);
  assert.equal((await H.api(null, 'GET', '/api/chronicle?source=job')).body.rows.filter(x => x.id === r.runId).length, 0);
});

test('the story of a conversation: what ran, why, what it cost, what failed', async () => {
  const s = memory.createSession('Chronicle: the story', { activate: false });
  script = [{ tool: 'read_file', args: { path: '/no/such/file/anywhere' } }, { text: 'It is not there.' }];
  const r = await turn(s.id, 'read it');
  const run = await H.api(null, 'GET', `/api/chronicle/story?run=${r.runId}`);
  assert.equal(run.status, 200, JSON.stringify(run.body));
  assert.equal(run.body.runs.length, 1);
  const one = run.body.runs[0];
  assert.ok(Array.isArray(one.spans) && one.spans.length >= 3, 'one run carries its spans');
  assert.deepEqual(Object.keys(one.summary.models), ['cstub/m1']);
  assert.equal(one.summary.models['cstub/m1'], 2);
  assert.equal(one.summary.tools.read_file, 1);
  assert.equal(one.summary.prompt, 1000);
  assert.equal(one.summary.cached, 600);
  assert.ok(one.why.length > 5);
  const whole = await H.api(null, 'GET', `/api/chronicle/story?session=${s.id}`);
  assert.equal(whole.status, 200);
  assert.equal(whole.body.totals.runs, 1);
  assert.equal(whole.body.totals.toolCalls, 1);
  assert.equal(whole.body.runs[0].spans, undefined, 'a whole conversation is summarised, not every span');
  assert.ok(whole.body.log.some(l => /read_file/.test(l.text)), 'its lines in the harness log');
  assert.equal((await H.api(null, 'GET', '/api/chronicle/story?run=run_nope')).status, 404);
});

test('a member sees only their own runs; the harness log is a host\'s', async () => {
  const mine = memory.createSession('Chronicle: owner only', { activate: false });
  memory.updateSession(mine.id, { person: { id: H.owner.user.id } });
  script = [{ text: 'hi' }];
  const r = await turn(mine.id, 'hi');
  const member = await H.signIn('member', 'chron-member@test.local');
  const theirs = memory.createSession('Chronicle: the member\'s', { activate: false });
  memory.updateSession(theirs.id, { person: { id: member.user.id } });
  script = [{ text: 'hello' }];
  const t = await turn(theirs.id, 'hello');
  const as = { Cookie: member.cookie };
  const list = await H.api(null, 'GET', '/api/chronicle', undefined, as);
  assert.equal(list.status, 200);
  assert.ok(list.body.rows.some(x => x.id === t.runId), 'their own run');
  assert.ok(!list.body.rows.some(x => x.id === r.runId), 'not the owner\'s');
  assert.ok(!list.body.facets.sources.includes('log'));
  assert.equal((await H.api(null, 'GET', '/api/chronicle?source=log', undefined, as)).body.rows.length, 0);
  assert.equal((await H.api(null, 'GET', `/api/chronicle/story?run=${r.runId}`, undefined, as)).status, 404);
  assert.equal((await H.api(null, 'GET', `/api/chronicle/story?session=${mine.id}`, undefined, as)).status, 404);
  assert.equal((await H.api(null, 'GET', `/api/chronicle/story?run=${t.runId}`, undefined, as)).status, 200);
  const log = await H.api(null, 'GET', '/api/chronicle?source=log');
  assert.ok(log.body.rows.length > 0 && log.body.rows.every(x => x.source === 'log'));
});

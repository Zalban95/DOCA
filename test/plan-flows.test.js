'use strict';

/**
 * Plans from the person's side (deep test A, 2026-10-08): a rejected plan is said in the conversation and answered in
 * a line, never silence; the work stops there.
 */
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const H = require('./helpers');   // first: it points the settings at a temporary folder
const memory = require('../modules/harness/memory');
const org = require('../modules/harness/organization');

let server, script = [], seen = [];
before(async () => {
  await H.start();
  server = http.createServer((req, res) => {
    let raw = ''; req.on('data', c => { raw += c; }); req.on('end', () => {
      if (!raw) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"data":[]}'); }
      seen.push(JSON.parse(raw));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: script.shift() || 'done' } }] }));
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const { CONFIG_PATH } = require('../modules/paths');
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ models: { providers: { pstub: { baseUrl: `http://127.0.0.1:${server.address().port}/v1` } } } }));
  require('../modules/harness/catalog').saveConfig('doca', { provider: 'pstub', model: 'm', fallbackChain: [], summarizeAfter: 0, compactTokens: 0 });
});
after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); await H.stop(); });
beforeEach(() => { script = []; seen = []; });

const answered = async (id, n = 1) => {
  for (let i = 0; i < 100; i++) {
    if (memory.messages(id).filter(m => m.role === 'assistant').length >= n && !require('../modules/harness/agent').isRunning(id)) return true;
    await new Promise(r => setTimeout(r, 50));
  }
  return false;
};
const proposed = (kind = 'work') => {
  const s = memory.createSession('plan here', { activate: false, kind });
  org.plan(s.id, { action: 'draft', title: 'A small site', steps: ['index page', 'about page'] });
  org.plan(s.id, { action: 'propose' });
  return s;
};

test('rejecting a plan tells the conversation, which answers in a line; its job stops', async () => {
  const s = proposed();
  memory.updateSession(s.id, { job: { state: 'working', since: new Date().toISOString(), autoTurns: 0, idleTurns: 0 } });
  script = ['Set aside — tell me what to change and I will draft another revision.'];
  const r = await H.api(null, 'POST', `/api/harness/sessions/${s.id}/plan`, { action: 'reject', revision: 1 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.plan.state, 'rejected');
  assert.deepEqual(r.body.rejected, { told: true });
  assert.ok(await answered(s.id), 'the conversation answered');
  const rows = memory.messages(s.id);
  assert.match(rows.find(m => m.role === 'user').content, /^Plan rejected — revision 1 of "A small site"\. Do not carry it out\./);
  assert.match(rows.at(-1).content, /Set aside/);
  assert.equal(memory.getSession(s.id).job.state, 'stopped', 'nothing carries on with a plan the person turned down');
  assert.equal(memory.getSession(s.id).job.stoppedWhy, 'its plan was rejected');
});

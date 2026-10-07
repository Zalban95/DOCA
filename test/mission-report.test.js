'use strict';

/**
 * A mission's last step is its report (turn/mission-report.js; self-test 2026-10-08, #6): the request carries no
 * tools, DOCA says why, the answer reaches the leader with a line saying the mission ended on its limit.
 */
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
require('./helpers'); // Isolated data, prefs and provider files.
const { CONFIG_PATH } = require('../modules/paths');
const agent = require('../modules/harness/agent');
const catalog = require('../modules/harness/catalog');
const memory = require('../modules/harness/memory');
const missions = require('../modules/agents/missions');
const registry = require('../modules/agents/registry');
const report = require('../modules/harness/turn/mission-report');
let server, seen = [];

/** Calls a tool until it is offered none; then answers with a report. */
before(async () => {
  server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      const body = JSON.parse(raw);
      seen.push(body);
      const message = body.tools?.length
        ? { content: '', tool_calls: [{ id: `c${seen.length}`, type: 'function', function: { name: 'memory_search', arguments: JSON.stringify({ query: `q${seen.length}` }) } }] }
        : { content: 'Report: searched twice, found nothing; left: the third search.' };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message }] }));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ models: { providers: {
    stub: { baseUrl: `http://127.0.0.1:${server.address().port}/v1` },
  } } }));
});
after(async () => {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
});
beforeEach(() => {
  seen = [];
  catalog.saveConfig('doca', { provider: 'stub', model: 'm', contextWindow: 0, summarizeAfter: 0, fallbackChain: [], maxSteps: 3 });
});

async function finished(id) {
  for (let i = 0; i < 200 && missions.get(id).state === 'running'; i++) await new Promise(r => setTimeout(r, 10));
  return missions.get(id);
}

test('a mission at its limit writes its report on the step kept for it, and says it ended on the limit', async () => {
  registry.setEnabled(true);
  try {
    registry.save({ id: 'searcher', role: 'Search memory.', tools: ['memory_search'], maxSteps: 3 });
    const m = await finished(missions.dispatch({ agentId: 'searcher', task: 'search for ever' }).id);
    assert.equal(seen.length, 3, 'two tool steps, then the report step');
    assert.ok(seen[0].tools?.length && seen[1].tools?.length, 'tools are offered until the last step');
    assert.equal(seen[2].tools, undefined, 'the report step offers no tools');
    assert.equal(seen[2].tool_choice, undefined);
    assert.match(JSON.stringify(seen[2].messages), /This is your last step: the mission's limit is 3 steps, \\"maxSteps\\" in the searcher agent definition/);
    assert.equal(m.state, 'done');
    assert.equal(m.limited, true);
    assert.match(m.result, /^Report: searched twice/, 'the leader gets the report');
    assert.match(m.result, /ended on its step limit \(3, "maxSteps" in the searcher agent definition\)/);
    assert.doesNotMatch(m.result, /Stopped after/, 'not the bare limit sentence');
  } finally { registry.setEnabled(false); }
});

test('a turn that is not a mission still stops on the limit as before', async () => {
  const r = await agent.turn({ message: 'go', sessionId: memory.createSession('not a mission').id });
  assert.equal(seen.length, 3);
  assert.ok(seen.every(b => b.tools?.length), 'every step is a tool step');
  assert.match(r.text, /Stopped after 3 tool steps/);
  assert.equal(r.limited, undefined);
});

test('the report step is only a mission\'s last, and only with more than one step', () => {
  const profile = { id: 'x' };
  assert.equal(report.due({ profile, step: 3, maxSteps: 3 }), true);
  assert.equal(report.due({ profile, step: 2, maxSteps: 3 }), false);
  assert.equal(report.due({ profile, step: 1, maxSteps: 1 }), false, 'a one-step mission keeps its one step');
  assert.equal(report.due({ profile: { level: 'orchestrator' }, step: 3, maxSteps: 3 }), false);
  assert.equal(report.due({ profile: null, step: 3, maxSteps: 3 }), false);
  assert.match(report.ending({ id: 'x' }, 9, { ceiling: 64 }), /experiment adaptiveLimits, up to limits\.maxStepsCeiling, 64/);
});

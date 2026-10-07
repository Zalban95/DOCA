'use strict';

/** turn/claims.js (experiment claimCheck, TODO B7c): an answer claiming what no call made gets one more step. */
const test   = require('node:test');
const assert = require('node:assert/strict');
const claims = require('../modules/harness/turn/claims');

const held = new Set(['memory_write', 'remind', 'settings_propose', 'git', 'tell_device', 'install_propose']);
const rows = calls => [{ role: 'user', content: 'x' }, ...calls.map(n => ({ role: 'assistant', tool_calls: [{ function: { name: n } }] }))];

test('a claimed memory with no memory_write is caught; with the call it stands', () => {
  assert.equal(claims.unmade('Written to memory as router-ip.', new Set(), held).what, 'a memory saved');
  assert.equal(claims.unmade('Written to memory as router-ip.', claims.calledSince(rows(['memory_write']), 0), held), null);
  assert.equal(claims.unmade('Got it — I\'ll remember that.', new Set(['shell']), held).what, 'a memory saved');
});

test('each kind of claim, and the sentences that are not claims', () => {
  assert.equal(claims.unmade('Reminder set for 9:00.', new Set(), held).what, 'a reminder or schedule set');
  assert.equal(claims.unmade('I proposed the setting change.', new Set(), held).what, 'a setting proposed or changed');
  assert.equal(claims.unmade('I committed the change to the branch.', new Set(), held).what, 'a commit or a push');
  assert.equal(claims.unmade('Sent a notification to your phone.', new Set(), held).what, 'a message sent to a device');
  assert.equal(claims.unmade('The router is at 192.168.1.1.', new Set(), held), null);
  assert.equal(claims.unmade('Shall I save this to memory?', new Set(), held), null, 'a question is not a claim');
});

test('a claim the turn could not have made true is left alone: no such tool held', () => {
  assert.equal(claims.unmade('I\'ll remember that.', new Set(), new Set(['shell'])), null);
});

test('the check is off with the flag, once per turn, and its note names the tools', () => {
  assert.equal(claims.check({ text: 'Saved to memory.', rows: rows([]), from: 0, held, asked: false }), null, 'the flag is off by default');
  assert.match(claims.note(claims.CLAIMS[0]), /no call to memory_write or memory_rules_write[\s\S]*Do not say it was done/);
});

test('a real turn: the claim is caught, the next step makes the call, and only once', async () => {
  const H = require('./helpers'), http = require('node:http'), fs = require('node:fs');
  const experiments = require('../modules/experiments'), memory = require('../modules/harness/memory');
  await H.start();
  const sse = frames => res => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); for (const f of frames) res.write(`data: ${JSON.stringify(f)}\n\n`); res.end('data: [DONE]\n\n'); };
  const usage = { prompt_tokens: 100, completion_tokens: 5 };
  const server = http.createServer((req, res) => {
    let raw = ''; req.on('data', c => { raw += c; }); req.on('end', () => {
      const msgs = JSON.parse(raw || '{}').messages || [];
      const told = msgs.some(m => m.role === 'user' && /\[DOCA\] Your answer says a memory saved/.test(m.content));
      if (msgs.some(m => m.role === 'tool')) return sse([{ choices: [{ delta: { content: 'Saved now.' } }] }, { choices: [], usage }])(res);
      if (told) return sse([{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'memory_write', arguments: JSON.stringify({ key: 'router-ip', value: '192.168.1.1' }) } }] } }] }, { choices: [], usage }])(res);
      return sse([{ choices: [{ delta: { content: 'Written to memory as router-ip.' } }] }, { choices: [], usage }])(res);
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try {
    fs.writeFileSync(require('../modules/paths').CONFIG_PATH, JSON.stringify({ models: { providers: { cstub: { baseUrl: `http://127.0.0.1:${server.address().port}/v1` } } } }));
    require('../modules/harness/catalog').saveConfig('doca', { provider: 'cstub', model: 'm', fallbackChain: [], summarizeAfter: 0 });
    experiments.setDeveloper(true); experiments.set('claimCheck', true);
    const s = memory.createSession('claims', { activate: false });
    const events = [];
    const r = await require('../modules/harness/agent').turn({ message: 'My router is 192.168.1.1, remember it.', sessionId: s.id, emit: e => events.push(e) });
    assert.ok(events.some(e => e.type === 'warning' && e.kind === 'claim'));
    assert.equal(memory.memFind('router-ip')?.value, '192.168.1.1');
    assert.equal(r.steps, 3, `claim, call, answer — got ${r.steps}: ${events.filter(e => !['text', 'thinking', 'usage'].includes(e.type)).map(e => e.type + (e.kind ? ':' + e.kind : '') + (e.name ? ':' + e.name : '')).join(' ')}`);
    assert.match(r.text, /Saved now/);
  } finally {
    experiments.set('claimCheck', false);
    server.closeAllConnections(); await new Promise(r => server.close(r)); await H.stop();
  }
});

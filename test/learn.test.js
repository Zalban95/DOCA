'use strict';

// The learning loop (modules/harness/learn.js, TODO H10.3): a conversation becomes a skill drafted by a model and
// saved only after a host has read it — the draft writes nothing.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const H = require('./helpers');
const { CONFIG_PATH } = require('../modules/paths');

let model, lastSystem = '', lastUser = '';
before(async () => {
  model = http.createServer((req, res) => {
    if (req.url.endsWith('/models')) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"data":[{"id":"stub-model"}]}'); }
    let raw = ''; req.on('data', d => { raw += d; });
    req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      lastSystem = body.messages?.[0]?.content || ''; lastUser = body.messages?.[1]?.content || '';
      const draft = { name: 'Rotate Logs', description: 'When a service\'s logs fill the disk.', body: '1. Find the biggest logs with `du`.\n2. Rotate with logrotate -f.' };
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: `Here it is:\n${JSON.stringify(draft)}` } }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  await new Promise(r => model.listen(0, '127.0.0.1', r));
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ models: { providers: { stub: { baseUrl: `http://127.0.0.1:${model.address().port}/v1`, apiKey: 'k', models: ['stub-model'] } } } }));
  await H.start();
  await H.api(null, 'POST', '/api/harness/doca/config', { provider: 'stub', model: 'stub-model' });
});
after(async () => { await H.stop(); await new Promise(r => model.close(r)); });

test('a conversation is drafted into a skill without writing anything; Save writes it', async () => {
  const memory = require('../modules/harness/memory');
  const s = memory.createSession('logs', { activate: false });
  require('../modules/harness/session-access').claim({ id: H.owner.user.id, role: 'owner' }, s.id);
  memory.append(s.id, { role: 'user', content: 'the disk is full of logs' });
  memory.append(s.id, { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'shell', arguments: '{"command":"du -sh /var/log/*"}' } }] });
  memory.append(s.id, { role: 'tool', tool_call_id: 'c1', name: 'shell', content: 'exit 0\n4G /var/log/journal' });
  const before = require('../modules/harness/skills').list().length;
  const d = await H.api(null, 'POST', '/api/harness/skills/draft', { sessionId: s.id });
  assert.equal(d.status, 200, JSON.stringify(d.body));
  assert.deepEqual([d.body.name, d.body.description], ['rotate-logs', 'When a service\'s logs fill the disk.']);
  assert.match(lastUser, /TOOL CALL shell: \{"command":"du -sh \/var\/log\/\*"\}/, 'the model reads what was done');
  assert.match(lastSystem, /Agent Skills format/);
  assert.equal(require('../modules/harness/skills').list().length, before, 'a draft writes nothing');
  const saved = await H.api(null, 'POST', '/api/harness/skills', { name: d.body.name, description: d.body.description, body: `${d.body.body}\n3. Check with df -h.` });
  assert.equal(saved.status, 200);
  assert.match(require('../modules/harness/skills').read('rotate-logs').body, /Check with df -h/, 'the person\'s edit is what is saved');
  assert.equal((await H.api(null, 'POST', '/api/harness/skills', { name: 'rotate-logs', description: 'x', body: 'y' })).status, 409, 'an existing skill is not replaced silently');
});

test('only a host drafts or saves a skill, and only from a conversation they may open', async () => {
  const member = await H.signIn('member', 'learn-member@test.local');
  assert.equal((await H.api(null, 'POST', '/api/harness/skills/draft', { sessionId: 'x' }, { Cookie: member.cookie })).status, 403);
  assert.equal((await H.api(null, 'POST', '/api/harness/skills', { name: 'a', description: 'b', body: 'c' }, { Cookie: member.cookie })).status, 403);
  assert.equal((await H.api(null, 'POST', '/api/harness/skills/draft', { sessionId: 's_nope' })).status, 404);
});

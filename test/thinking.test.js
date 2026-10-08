'use strict';

/**
 * Thinking per mode (turn/thinking.js, asked 2026-10-08): each provider family hears off and on in its own dialect; a
 * mode's setting applies to its turns; a conversation's 💭 overrides the mode; "think harder" overrides off for that
 * message; a refused word or field is asked once more another way and remembered; the trace and Chronicle say which.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const H = require('./helpers');   // first: it points the settings at a temporary folder (see its top)

let server;
const bodies = [];
const sse = text => res => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
  res.end(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 2 } })}\n\ndata: [DONE]\n\n`);
};
before(async () => {
  await H.start();
  server = http.createServer((req, res) => {
    let raw = ''; req.on('data', c => { raw += c; }); req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      bodies.push(body);
      // A strict server: OpenAI's newer models say "none", not "minimal"; a chat template raises on a word it lacks.
      if (body.model === 'strict-none' && body.reasoning_effort === 'minimal') { res.writeHead(400); return res.end('{"error":{"message":"reasoning_effort: unsupported value minimal; use one of none, low, medium, high"}}'); }
      if (body.model === 'jinja' && body.reasoning_effort === 'minimal') { res.writeHead(500); return res.end('{"error":{"code":500,"message":"Jinja Exception: Unexpected reasoning effort minimal"}}'); }
      return sse('Done.')(res);
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  fs.writeFileSync(require('../modules/paths').CONFIG_PATH, JSON.stringify({ models: { providers: { tstub: { baseUrl: `http://127.0.0.1:${server.address().port}/v1` } } } }));
  require('../modules/harness/catalog').saveConfig('doca', { provider: 'tstub', model: 'm', fallbackChain: [], summarizeAfter: 0, maxSteps: 2 });
});
after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); await H.stop(); });

const effort = () => require('../modules/harness/turn/effort');
const thinking = () => require('../modules/harness/turn/thinking');
const setModes = modes => { const u = require('../modules/utils'); u.savePrefs({ ...u.loadPrefs(), thinking: { ...(u.loadPrefs().thinking || {}), ...modes } }); };
const sentLast = () => bodies.filter(b => !/You sort requests/.test(b.messages?.[0]?.content || '')).at(-1);

test('each provider family hears off and on in its own dialect', () => {
  const e = effort(), f = (level, id, baseUrl, model) => e.fields(level, { id, baseUrl }, model);
  assert.deepEqual(f('off', 'openai', 'https://api.openai.com/v1', 'gpt-5'), { reasoning_effort: 'minimal' }, 'gpt-5 says minimal');
  assert.deepEqual(f('off', 'openai', 'https://api.openai.com/v1', 'gpt-5.1'), { reasoning_effort: 'none' }, 'gpt-5.1 and later say none');
  assert.deepEqual(f('off', 'google', 'https://generativelanguage.googleapis.com/v1beta/openai'), { reasoning_effort: 'none' });
  assert.deepEqual(f('off', 'llamacpp', 'http://127.0.0.1:8080/v1'), { reasoning_effort: 'none' }, 'llama.cpp hands it to the template: never minimal');
  assert.deepEqual(f('medium', 'groq', 'https://api.groq.com/openai/v1'), { reasoning_effort: 'medium' });
  assert.deepEqual(f('off', 'openrouter', 'https://openrouter.ai/api/v1'), { reasoning: { enabled: false } });
  assert.deepEqual(f('high', 'openrouter', 'https://openrouter.ai/api/v1'), { reasoning: { effort: 'high' } });
  assert.deepEqual(f('off', 'deepseek', 'https://api.deepseek.com/v1'), { thinking: { type: 'disabled' } });
  assert.deepEqual(f('high', 'anthropic', 'https://api.anthropic.com/v1'), { thinking: { type: 'enabled', budget_tokens: 16000 } }, 'Anthropic wants a budget');
  assert.deepEqual(f('medium', 'moonshot', 'https://api.moonshot.ai/v1'), { thinking: { type: 'enabled' } });
  assert.deepEqual(f('off', 'vllm', 'http://gpu:8000/v1'), { chat_template_kwargs: { enable_thinking: false } });
  assert.deepEqual(f('high', 'vllm', 'http://gpu:8000/v1'), { chat_template_kwargs: { enable_thinking: true } });
  // /no_think: the owner names the dialect; it rides on the body unseen and is said at the end of the system prompt.
  const u = require('../modules/utils');
  u.savePrefs({ ...u.loadPrefs(), providerContracts: { qwenbox: { effortField: 'no_think' } } });
  const nt = f('off', 'qwenbox', 'http://127.0.0.1:11434/v1');
  assert.equal(JSON.stringify(nt), '{}', 'nothing is sent as a field');
  const dressed = e.dress({ ...nt, messages: [{ role: 'system', content: 'S' }, { role: 'user', content: 'hi' }] });
  assert.equal(dressed.messages[0].content, 'S\n\n/no_think');
  assert.deepEqual(f('high', 'qwenbox', 'http://127.0.0.1:11434/v1'), {}, 'on: the model thinks by default');
  u.savePrefs({ ...u.loadPrefs(), providerContracts: {} });
});

test('which mode a turn is in', () => {
  const m = c => thinking().modeOf(c);
  assert.equal(m({ client: { kind: 'dashboard' }, session: { kind: 'orchestrator' } }), 'chat');
  assert.equal(m({ client: { kind: 'agent' }, session: { kind: 'work' } }), 'work');
  assert.equal(m({ profile: { id: 'archivist', level: 'specialist' } }), 'specialist');
  assert.equal(m({ client: { kind: 'dashboard', mode: 'assistant' } }), 'liveCall');
  assert.equal(m({ client: { kind: 'dashboard', mode: 'call' } }), 'deepCall');
  assert.equal(m({ client: { kind: 'dashboard', mode: 'assistant', ambient: true } }), 'ambient');
  assert.equal(m({ client: { kind: 'watch', mode: 'assistant' } }), 'device');
  assert.equal(m({ client: { kind: 'phone' }, session: { kind: 'orchestrator' } }), 'chat', 'typing on a phone is a chat');
});

test('who wins: the message, the call\'s toggle, the conversation, the mode, then auto', () => {
  setModes({ chat: 'off', liveCall: 'off' });
  const r = a => thinking().resolve({ client: { kind: 'dashboard' }, session: { kind: 'orchestrator' }, p: {}, ...a });
  assert.deepEqual([r({}).level, r({}).from], ['off', 'mode setting: off (thinking.chat)']);
  assert.equal(r({ session: { effort: 'medium', effortBy: 'toggle' } }).from, 'toggle: on (medium)');
  assert.equal(r({ session: { effort: 'high' } }).from, 'this conversation (the effort tool)');
  assert.deepEqual([r({ message: 'Think harder about the plan' }).level, r({ message: 'Think harder about the plan' }).from], ['high', 'asked in this message ("think harder")']);
  const call = r({ client: { kind: 'dashboard', mode: 'assistant', thinking: 'on' } });
  assert.deepEqual([call.level, call.from], ['medium', 'toggle: on (medium) — this call']);
  assert.equal(r({ client: { kind: 'agent' }, profile: { level: 'specialist' }, message: 'Research it thoroughly' }).level, null, 'an errand\'s words are not the person\'s');
  setModes({ chat: 'auto', liveCall: 'auto', specialist: 'high' });
  assert.equal(r({ client: { kind: 'dashboard', mode: 'assistant' } }).level, 'low', 'auto: assistant mode\'s effort, as before');
  assert.equal(r({ profile: { level: 'specialist' } }).level, 'high');
  assert.equal(thinking().toggleLevel('on', 'specialist'), 'high', 'on means the mode\'s own level when it names one');
  setModes({ specialist: 'auto' });
});

test('a Live call turn with liveCall off sends no thinking; auto keeps assistant mode\'s low', async () => {
  setModes({ liveCall: 'off' });
  bodies.length = 0;
  const r = await H.api(null, 'POST', '/api/chat', { message: 'What time is it?', voice: 'assistant' });
  assert.equal(r.status, 200);
  assert.equal(sentLast().reasoning_effort, 'none', JSON.stringify(sentLast()).slice(0, 300));
  setModes({ liveCall: 'auto' });
  await H.api(null, 'POST', '/api/chat', { message: 'And the date?', voice: 'assistant' });
  assert.equal(sentLast().reasoning_effort, 'low');
  // Ambient's assistant is its own mode, and the call's 💭 lasts the call.
  setModes({ ambient: 'off' });
  await H.api(null, 'POST', '/api/chat', { message: 'Is it raining?', voice: 'assistant', ambient: true });
  assert.equal(sentLast().reasoning_effort, 'none');
  await H.api(null, 'POST', '/api/chat', { message: 'Is it raining?', voice: 'assistant', ambient: true, thinking: 'on' });
  assert.equal(sentLast().reasoning_effort, 'medium');
  setModes({ ambient: 'auto' });
});

test('the conversation\'s 💭 overrides the mode; "think harder" overrides off for that message; trace and Chronicle say why', async () => {
  setModes({ chat: 'off' });
  const memory = require('../modules/harness/memory');
  const s = memory.createSession('thinking test', { activate: false, kind: 'chat' });
  const say = async message => { await H.api(null, 'POST', '/api/harness/chat', { message, sessionId: s.id }); return sentLast(); };
  assert.equal((await say('Hello there')).reasoning_effort, 'none', 'the mode: off');
  const set = await H.api(null, 'POST', `/api/harness/sessions/${s.id}/settings`, { thinking: 'on' });
  assert.equal(set.status, 200);
  assert.deepEqual([set.body.thinking, set.body.thinkingBy], ['medium', 'toggle']);
  assert.equal((await say('Hello again')).reasoning_effort, 'medium', 'the toggle wins over the mode');
  await H.api(null, 'POST', `/api/harness/sessions/${s.id}/settings`, { thinking: 'off' });
  assert.equal((await say('Think harder about why the sky is blue')).reasoning_effort, 'high', 'the person\'s words win for that message');
  assert.equal((await say('And the sea?')).reasoning_effort, 'none', 'and only for that message');
  assert.equal((await H.api(null, 'POST', `/api/harness/sessions/${s.id}/settings`, { thinking: 'loud' })).status, 400);
  await H.api(null, 'POST', `/api/harness/sessions/${s.id}/settings`, { thinking: 'auto' });
  assert.equal(memory.getSession(s.id).effort, null);

  const run = require('../modules/harness/runs').forSession(s.id).find(x => x.state === 'done');
  const spans = require('../modules/harness/trace').spans(run.id).filter(x => x.kind === 'thinking');
  assert.equal(spans.length, 1);
  assert.match(spans[0].data.from, /toggle: off|asked in this message|mode setting/);
  const story = await H.api(null, 'GET', `/api/chronicle/story?session=${s.id}`);
  const told = story.body.runs.flatMap(x => x.summary.thinking);
  assert.ok(told.some(k => k.from === 'asked in this message ("think harder")' && k.level === 'high'), JSON.stringify(told));
  assert.ok(told.some(k => k.from === 'mode setting: off (thinking.chat)'));
  setModes({ chat: 'auto' });
});

test('the usage event says it', async () => {
  setModes({ chat: 'low' });
  const memory = require('../modules/harness/memory');
  const s = memory.createSession('usage test', { activate: false, kind: 'chat' });
  const seen = [];
  const on = evt => { if (evt.sessionId === s.id && evt.type === 'usage') seen.push(evt.thinking); };
  require('../modules/harness/agent').events.on('event', on);
  await H.api(null, 'POST', '/api/harness/chat', { message: 'Hi', sessionId: s.id });
  require('../modules/harness/agent').events.off('event', on);
  assert.deepEqual(seen[0], { level: 'low', from: 'mode setting: low (thinking.chat)', mode: 'chat' });
  setModes({ chat: 'auto' });
});

test('a refused word for off is asked once more with the other one, and remembered', async () => {
  const { post } = require('../modules/harness/turn/transport');
  const contracts = require('../modules/harness/contracts');
  const ep = { id: 'openai-like', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, label: 'strict' };
  bodies.length = 0;
  const r = await post(ep, { model: 'strict-none', messages: [], reasoning_effort: 'minimal' }, undefined, {});
  assert.equal(r.status, 200);
  assert.deepEqual(bodies.map(b => b.reasoning_effort), ['minimal', 'none']);
  assert.equal(contracts.forProvider('openai-like', 'strict-none').effortOff, 'none');
  // A local chat template that raises a 500 on the word is treated the same way.
  bodies.length = 0;
  const j = await post({ ...ep, id: 'jinja-box' }, { model: 'jinja', messages: [], reasoning_effort: 'minimal' }, undefined, {});
  assert.equal(j.status, 200);
  assert.deepEqual(bodies.map(b => b.reasoning_effort), ['minimal', 'none']);
  assert.equal(contracts.forProvider('jinja-box', 'jinja').effortOff, 'none');
});

test('the card reads each mode and each provider\'s dialect', async () => {
  const r = await H.api(null, 'GET', '/api/harness/thinking');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.modes.map(m => m.id), ['chat', 'work', 'specialist', 'liveCall', 'deepCall', 'ambient', 'device']);
  assert.ok(r.body.providers.find(p => p.id === 'tstub'), 'a provider with an address is listed');
  assert.ok(require('../modules/settings-schema').settable().some(x => x.prefix === 'thinking'), 'a preference the agent may propose');
});

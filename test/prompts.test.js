'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const H = require('./helpers');

let agent, watch, phone, mock, mockCalls = [];

/** Mock OpenClaw gateway (chat completions) + STT service on one port. */
function startMock() {
  return new Promise(resolve => {
    mock = http.createServer((req, res) => {
      let body = [];
      req.on('data', c => body.push(c)).on('end', () => {
        const raw = Buffer.concat(body);
        mockCalls.push({ url: req.url, headers: req.headers, raw });
        if (req.url === '/v1/chat/completions') {
          const msg = JSON.parse(raw.toString());
          const user = msg.messages.find(m => m.role === 'user');
          const text = typeof user.content === 'string' ? user.content : user.content.map(p => p.text || '[image]').join(' ');
          const hasImage = Array.isArray(user.content) && user.content.some(p => p.type === 'image_url');
          const reply = hasImage
            ? { summary: 'Photo received — nothing to run', detail: 'looked at the picture' }
            : { summary: `Will act on: ${/answered: "([^"]*)"/.exec(text)?.[1] || '?'}`, action: { commandId: 'compose.start' }, confirmLabel: 'Go' };
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '```json\n' + JSON.stringify(reply) + '\n```' } }] }));
        } else if (req.url === '/v1/audio/transcriptions') {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ text: 'cap the power to two fifty watts' }));
        } else { res.statusCode = 404; res.end(); }
      });
    });
    mock.listen(0, '127.0.0.1', () => {
      const port = mock.address().port;
      process.env.OPENCLAW_GATEWAY_URL = `http://127.0.0.1:${port}`;
      process.env.DOCA_STT_URL = `http://127.0.0.1:${port}`;
      fs.writeFileSync(process.env.CONFIG_PATH, JSON.stringify({ gateway: { http: { endpoints: { chatCompletions: { enabled: true } } }, auth: { token: 'gw-secret' } } }));
      resolve();
    });
  });
}

before(async () => {
  await H.start();
  await startMock();
  agent = H.mkDevice('agent', 'agent');
  watch = H.mkDevice('watch', 'watch', H.WATCH_CAPS);
  phone = H.mkDevice('phone', 'phone', H.PHONE_CAPS);
});
after(async () => { await H.stop(); mock.close(); });

const PROMPT = (targets, extra = {}) => ({
  id: extra.id, title: 'GPU 0 has been at 97 °C for 10 min', priority: 'high', targets,
  body: [{ type: 'text', text: 'vLLM is the only tenant. What should I do?' }],
  choices: [
    { id: 'stop', type: 'option', label: 'Stop vLLM', outcome: { summary: 'Stop container doca-vllm', detail: 'Frees VRAM', action: { commandId: 'services.stop', params: { id: 'vllm' } }, confirmLabel: 'Stop it' } },
    { id: 'wait', type: 'option', label: 'Wait 10 min', outcome: { summary: 'Check again in 10 minutes' } },
    { id: 'say',  type: 'voice', label: 'Tell me', maxSec: 20 },
    { id: 'type', type: 'text',  label: 'Type instead' },
    { id: 'shoot', type: 'image', label: 'Show me' },
    { id: 'no',   type: 'dismiss', label: 'Ignore' },
  ],
  ...extra,
});

test('prompt fan-out is tailored to device capabilities (no camera → no image choice)', async () => {
  const w = H.sse(watch.token); const p = H.sse(phone.token);
  await Promise.all([w.ready, p.ready]);
  const r = await H.api(agent.token, 'POST', '/api/v1/agent/prompts', PROMPT([watch.device.id, phone.device.id]));
  assert.equal(r.status, 201);
  const ew = await w.waitFor('prompt.new'); const ep = await p.waitFor('prompt.new');
  assert.equal(ew.class, 'durable'); assert.equal(ew.priority, 'high');
  assert.deepEqual(ew.payload.prompt.choices.map(c => c.id), ['stop', 'wait', 'say', 'type', 'no'], 'watch has no camera');
  assert.deepEqual(ep.payload.prompt.choices.map(c => c.id), ['stop', 'wait', 'say', 'type', 'shoot', 'no']);
  assert.equal(ew.payload.prompt.haptic, true);
  assert.equal(ew.payload.prompt.choices[0].outcome.actionAllowed, false, 'watch preset cannot run services.stop');
  assert.equal(ep.payload.prompt.choices[0].outcome.actionAllowed, true);
  // idempotent creation on agent-supplied id
  const again = await H.api(agent.token, 'POST', '/api/v1/agent/prompts', { ...PROMPT([watch.device.id]), id: r.body.prompt.id });
  assert.equal(again.status, 200); assert.equal(again.body.created, false);
  w.close(); p.close();
});

test('option → outcome_ready → confirm is idempotent; back reopens; first confirmation wins', async () => {
  const w = H.sse(watch.token); const p = H.sse(phone.token); const a = H.sse(agent.token);
  await Promise.all([w.ready, p.ready, a.ready]);
  const { body: { prompt } } = await H.api(agent.token, 'POST', '/api/v1/agent/prompts', PROMPT([watch.device.id, phone.device.id]));

  const sel = await H.api(watch.token, 'POST', `/api/v1/prompts/${prompt.id}/select`, { selectionId: 'sel-1', choiceId: 'wait' });
  assert.equal(sel.status, 200); assert.equal(sel.body.status, 'outcome_ready'); assert.equal(sel.body.outcome.summary, 'Check again in 10 minutes');
  const dup = await H.api(watch.token, 'POST', `/api/v1/prompts/${prompt.id}/select`, { selectionId: 'sel-1', choiceId: 'wait' });
  assert.equal(dup.status, 200); assert.equal(dup.body.replay, true);
  const second = await H.api(watch.token, 'POST', `/api/v1/prompts/${prompt.id}/select`, { selectionId: 'sel-2', choiceId: 'stop' });
  assert.equal(second.status, 409); assert.equal(second.body.error.code, 'invalid_state');

  const back = await H.api(watch.token, 'POST', `/api/v1/prompts/${prompt.id}/confirm`, { selectionId: 'sel-1', decision: 'back' });
  assert.equal(back.body.status, 'open');
  const view = await H.api(watch.token, 'GET', `/api/v1/prompts/${prompt.id}`);
  assert.equal(view.body.prompt.state, 'open'); assert.equal(view.body.prompt.selectionId, null);

  const sel3 = await H.api(watch.token, 'POST', `/api/v1/prompts/${prompt.id}/select`, { selectionId: 'sel-3', choiceId: 'wait' });
  assert.equal(sel3.status, 200);
  const stale = await H.api(watch.token, 'POST', `/api/v1/prompts/${prompt.id}/confirm`, { selectionId: 'sel-1', decision: 'confirm' });
  assert.equal(stale.status, 409); assert.equal(stale.body.error.code, 'stale_selection');

  const conf = await H.api(watch.token, 'POST', `/api/v1/prompts/${prompt.id}/confirm`, { selectionId: 'sel-3', decision: 'confirm' });
  assert.equal(conf.status, 200); assert.equal(conf.body.status, 'confirmed'); assert.equal(conf.body.execution, null);
  const conf2 = await H.api(watch.token, 'POST', `/api/v1/prompts/${prompt.id}/confirm`, { selectionId: 'sel-3', decision: 'confirm' });
  assert.equal(conf2.status, 200); assert.equal(conf2.body.replay, true);

  const closed = await p.waitFor('prompt.closed');
  assert.equal(closed.payload.reason, 'confirmed_elsewhere');
  const confirmedEv = await a.waitFor('prompt.confirmed');
  assert.equal(confirmedEv.payload.deviceId, watch.device.id); assert.equal(confirmedEv.payload.choiceId, 'wait');
  const late = await H.api(phone.token, 'POST', `/api/v1/prompts/${prompt.id}/select`, { selectionId: 'sel-p', choiceId: 'wait' });
  assert.equal(late.status, 409); assert.equal(late.body.error.code, 'prompt_closed');
  w.close(); p.close(); a.close();
});

test('confirming an option with an action runs the command under the device scope', async () => {
  const a = H.sse(agent.token); await a.ready;
  const { body: { prompt } } = await H.api(agent.token, 'POST', '/api/v1/agent/prompts', {
    title: 'Start stack?', targets: [phone.device.id],
    choices: [{ id: 'go', type: 'option', label: 'Go', outcome: { summary: 'docker compose up -d', action: { commandId: 'compose.start' } } }],
  });
  await H.api(phone.token, 'POST', `/api/v1/prompts/${prompt.id}/select`, { selectionId: 'sel-act', choiceId: 'go' });
  const conf = await H.api(phone.token, 'POST', `/api/v1/prompts/${prompt.id}/confirm`, { selectionId: 'sel-act', decision: 'confirm' });
  // docker is not installed in the test environment: the command fails, the failure is reported, the prompt stays open.
  assert.equal(conf.status, 500); assert.equal(conf.body.error.code, 'command_failed');
  const view = await H.api(phone.token, 'GET', `/api/v1/prompts/${prompt.id}`);
  assert.equal(view.body.prompt.state, 'outcome_ready', 'a failed action leaves the selection confirmable again');
  a.close();
});

test('text escape hatch with resolver=agent: pending → agent outcome arrives over push → confirm', async () => {
  const w = H.sse(watch.token); const a = H.sse(agent.token);
  await Promise.all([w.ready, a.ready]);
  const { body: { prompt } } = await H.api(agent.token, 'POST', '/api/v1/agent/prompts', PROMPT([watch.device.id], { resolver: 'agent' }));
  const sel = await H.api(watch.token, 'POST', `/api/v1/prompts/${prompt.id}/select`, { selectionId: 'sel-txt', choiceId: 'type', payload: { kind: 'text', text: 'just cap the power to 250W', ext: { locale: 'en-GB' } } });
  assert.equal(sel.status, 202); assert.equal(sel.body.status, 'pending'); assert.equal(sel.body.stage, 'thinking');
  assert.equal(sel.body.pollUrl, `/api/v1/prompts/${prompt.id}`);

  const selected = await a.waitFor('prompt.selected');
  assert.equal(selected.payload.selectionId, 'sel-txt');
  assert.equal(selected.payload.payload.text, 'just cap the power to 250W');
  assert.deepEqual(selected.payload.payload.ext, { locale: 'en-GB' });
  assert.equal(selected.payload.resolver, 'agent');

  const poll = await H.api(watch.token, 'GET', `/api/v1/prompts/${prompt.id}`);
  assert.equal(poll.body.prompt.state, 'pending');

  const bad = await H.api(agent.token, 'POST', `/api/v1/agent/prompts/${prompt.id}/outcome`, { selectionId: 'sel-txt', outcome: { summary: 'x', action: { commandId: 'nope' } } });
  assert.equal(bad.status, 400);
  const out = await H.api(agent.token, 'POST', `/api/v1/agent/prompts/${prompt.id}/outcome`, { selectionId: 'sel-txt', outcome: { summary: 'Power limit → 250 W on GPU 0', blocks: [{ type: 'kv', items: [{ k: 'Before', v: '350 W' }, { k: 'After', v: '250 W' }] }], confirmLabel: 'Apply' } });
  assert.equal(out.status, 200);

  const ev = await w.waitFor('prompt.outcome');
  assert.equal(ev.class, 'durable'); assert.equal(ev.payload.status, 'outcome_ready'); assert.equal(ev.payload.selectionId, 'sel-txt');
  assert.equal(ev.payload.outcome.summary, 'Power limit → 250 W on GPU 0');
  const again = await H.api(agent.token, 'POST', `/api/v1/agent/prompts/${prompt.id}/outcome`, { selectionId: 'sel-txt', outcome: { summary: 'late' } });
  assert.equal(again.status, 409, 'outcome can only be delivered once');

  const conf = await H.api(watch.token, 'POST', `/api/v1/prompts/${prompt.id}/confirm`, { selectionId: 'sel-txt', decision: 'confirm' });
  assert.equal(conf.status, 200);
  const done = await a.waitFor(e => e.type === 'prompt.confirmed' && e.payload.promptId === prompt.id);
  assert.equal(done.payload.input.text, 'just cap the power to 250W');
  w.close(); a.close();
});

test('voice escape hatch with audio → server transcribes and resolves via the gateway', async () => {
  const w = H.sse(watch.token); await w.ready;
  const { body: { prompt } } = await H.api(agent.token, 'POST', '/api/v1/agent/prompts', PROMPT([watch.device.id]));
  const fd = new FormData();
  fd.append('selectionId', 'sel-voice');
  fd.append('choiceId', 'say');
  fd.append('payload', JSON.stringify({ kind: 'voice', durationMs: 3200 }));
  fd.append('audio', new Blob([Buffer.from('OggS fake audio bytes')], { type: 'audio/ogg' }), 'clip.ogg');
  const sel = await H.api(watch.token, 'POST', `/api/v1/prompts/${prompt.id}/select`, fd);
  assert.equal(sel.status, 202); assert.equal(sel.body.stage, 'transcribing');

  const ev = await w.waitFor(e => e.type === 'prompt.outcome' && e.payload.selectionId === 'sel-voice', 10000);
  assert.equal(ev.payload.status, 'outcome_ready');
  assert.equal(ev.payload.outcome.summary, 'Will act on: cap the power to two fifty watts');
  assert.equal(ev.payload.outcome.action.commandId, 'compose.start');
  assert.equal(ev.payload.outcome.actionAllowed, false);
  const stages = w.events.filter(e => e.type === 'prompt.progress').map(e => e.payload.stage);
  assert.ok(stages.includes('transcribing') && stages.includes('thinking'), `progress stages: ${stages}`);
  const stt = mockCalls.find(c => c.url === '/v1/audio/transcriptions');
  assert.ok(stt, 'audio was sent to STT');
  const gw = mockCalls.find(c => c.url === '/v1/chat/completions');
  assert.equal(gw.headers.authorization, 'Bearer gw-secret');
  // the agent can fetch the stored clip
  const p = await H.api(agent.token, 'GET', `/api/v1/agent/prompts/${prompt.id}`);
  const media = p.body.prompt.perDevice[watch.device.id].input.mediaId;
  const clip = await H.api(agent.token, 'GET', `/api/v1/media/${media}`);
  assert.equal(clip.status, 200); assert.equal(clip.headers.get('content-type'), 'audio/ogg');
  w.close();
});

test('voice with a device-side transcript skips STT', async () => {
  const w = H.sse(watch.token); await w.ready;
  const before = mockCalls.filter(c => c.url === '/v1/audio/transcriptions').length;
  const { body: { prompt } } = await H.api(agent.token, 'POST', '/api/v1/agent/prompts', PROMPT([watch.device.id]));
  const sel = await H.api(watch.token, 'POST', `/api/v1/prompts/${prompt.id}/select`, { selectionId: 'sel-vt', choiceId: 'say', payload: { kind: 'voice', transcript: 'wait for now' } });
  assert.equal(sel.status, 202); assert.equal(sel.body.stage, 'thinking');
  const ev = await w.waitFor(e => e.type === 'prompt.outcome' && e.payload.selectionId === 'sel-vt', 10000);
  assert.equal(ev.payload.outcome.summary, 'Will act on: wait for now');
  assert.equal(mockCalls.filter(c => c.url === '/v1/audio/transcriptions').length, before);
  w.close();
});

test('image input: the phone uploads a photo, the server forwards it to the gateway as a vision part', async () => {
  const p = H.sse(phone.token); await p.ready;
  const { body: { prompt } } = await H.api(agent.token, 'POST', '/api/v1/agent/prompts', PROMPT([phone.device.id]));
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  const fd = new FormData();
  fd.append('selectionId', 'sel-img'); fd.append('choiceId', 'shoot');
  fd.append('payload', JSON.stringify({ kind: 'image', caption: 'the fan is not spinning', w: 1, h: 1 }));
  fd.append('image', new Blob([png], { type: 'image/png' }), 'photo.png');
  const sel = await H.api(phone.token, 'POST', `/api/v1/prompts/${prompt.id}/select`, fd);
  assert.equal(sel.status, 202);
  const ev = await p.waitFor(e => e.type === 'prompt.outcome' && e.payload.selectionId === 'sel-img', 10000);
  assert.equal(ev.payload.outcome.summary, 'Photo received — nothing to run');
  const gw = mockCalls.filter(c => c.url === '/v1/chat/completions').pop();
  const msg = JSON.parse(gw.raw.toString());
  const user = msg.messages.find(m => m.role === 'user');
  assert.ok(Array.isArray(user.content) && user.content.some(x => x.type === 'image_url' && x.image_url.url.startsWith('data:image/png;base64,')));
  assert.ok(user.content[0].text.includes('the fan is not spinning'));
  p.close();
});

test('dismiss and agent cancel close the cycle', async () => {
  const w = H.sse(watch.token); const a = H.sse(agent.token);
  await Promise.all([w.ready, a.ready]);
  const { body: { prompt } } = await H.api(agent.token, 'POST', '/api/v1/agent/prompts', PROMPT([watch.device.id]));
  const d = await H.api(watch.token, 'POST', `/api/v1/prompts/${prompt.id}/select`, { selectionId: 'sel-dis', choiceId: 'no' });
  assert.equal(d.body.status, 'dismissed');
  await a.waitFor(e => e.type === 'prompt.dismissed' && e.payload.promptId === prompt.id);
  assert.equal((await H.api(watch.token, 'GET', '/api/v1/prompts')).body.prompts.some(x => x.id === prompt.id), false);

  const { body: { prompt: p2 } } = await H.api(agent.token, 'POST', '/api/v1/agent/prompts', PROMPT([watch.device.id]));
  const c = await H.api(agent.token, 'DELETE', `/api/v1/agent/prompts/${p2.id}`);
  assert.equal(c.body.prompt.state, 'cancelled');
  const closed = await w.waitFor(e => e.type === 'prompt.closed' && e.payload.promptId === p2.id);
  assert.equal(closed.payload.reason, 'cancelled');
  w.close(); a.close();
});

test('oversized inline SVG falls back to an image reference so prompt.new fits the event budget', async () => {
  const p = H.sse(phone.token); await p.ready;
  // ~40 KB of SVG: within the 64 KB figure cap but over the 32 KB event budget when inlined.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="${'M0 0 L1 1 '.repeat(4500)}"/></svg>`;
  const big = { ...PROMPT([phone.device.id]), body: [{ type: 'figure', alt: 'thermal map', svg }] };
  const { status, body: { prompt } } = await H.api(agent.token, 'POST', '/api/v1/agent/prompts', big);
  assert.equal(status, 201);
  const ev = await p.waitFor(e => e.type === 'prompt.new' && e.payload.prompt.id === prompt.id);
  const fig = ev.payload.prompt.body.find(b => b.type === 'figure');
  assert.equal(fig.representation.kind, 'image');
  assert.match(fig.representation.url, /^\/api\/v1\/render\/figure\//);
  // The pull view is not budget-constrained, so the phone still gets the full SVG when it asks.
  const full = await H.api(phone.token, 'GET', `/api/v1/prompts/${prompt.id}`);
  assert.equal(full.body.prompt.body[0].representation.kind, 'svg');
  p.close();
});

test('prompt validation: choice ids unique, options need outcomes, size limit', async () => {
  let r = await H.api(agent.token, 'POST', '/api/v1/agent/prompts', { title: 'x', choices: [{ id: 'a', type: 'option', label: 'A' }] });
  assert.equal(r.status, 400); assert.equal(r.body.error.code, 'invalid_outcome');
  r = await H.api(agent.token, 'POST', '/api/v1/agent/prompts', { title: 'x', choices: [{ id: 'a', type: 'dismiss' }, { id: 'a', type: 'dismiss' }] });
  assert.equal(r.status, 400);
  r = await H.api(agent.token, 'POST', '/api/v1/agent/prompts', { title: 'x', choices: [{ id: 'a', type: 'dismiss' }], body: Array.from({ length: 24 }, () => ({ type: 'text', text: 'y'.repeat(2000) })) });
  assert.equal(r.status, 413); assert.equal(r.body.error.code, 'payload_too_large');
});

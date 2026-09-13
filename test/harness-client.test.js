'use strict';

/**
 * The device-facing conversation: `/api/v1/harness/*` and the turn events.
 *
 * What is worth asserting here is not that a model replies — `harness.test.js`
 * covers the loop — but that a turn belongs to the *user* rather than to the
 * request that started it: the answer reaches a device that did not ask, a watch
 * is not billed for per-token deltas, and a client that arrives late still learns
 * what happened. The model is the same scripted stub, so no key and no network.
 */
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('fs');
const http = require('http');
const H = require('./helpers');

const { CONFIG_PATH } = require('../modules/paths');

let stub, stubUrl;
/**
 * Queued replies, consumed in order: `{ text }`, `{ tool, args }`, `{ status }`
 * to fail, and `delayMs` on any of them to hold the turn open long enough to
 * observe one in flight.
 */
let script = [];
/** Every request body the harness sent, so the prompt itself can be asserted. */
let seen = [];

function sseReply(res, frames) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  for (const f of frames) res.write(`data: ${JSON.stringify(f)}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
}

let phone, watch, viewer, admin;

before(async () => {
  stub = http.createServer((req, res) => {
    if (req.url.endsWith('/models')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ data: [{ id: 'stub-model' }] }));
    }
    let raw = '';
    req.on('data', d => { raw += d; });
    req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      seen.push(body);
      const next = script.shift() || { text: '(script exhausted)' };
      const answer = () => {
        if (next.status) { res.writeHead(next.status, { 'Content-Type': 'application/json' }); return res.end('{"error":"stub failure"}'); }
        if (body.stream === false) {   // the summariser
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }));
        }
        if (next.tool) {
          return sseReply(res, [{ choices: [{ delta: { tool_calls: [{
            index: 0, id: 'call_1', type: 'function',
            function: { name: next.tool, arguments: JSON.stringify(next.args || {}) },
          }] } }] }]);
        }
        const mid = Math.ceil((next.text || '').length / 2);
        return sseReply(res, [
          { choices: [{ delta: { content: (next.text || '').slice(0, mid) } }] },
          { choices: [{ delta: { content: (next.text || '').slice(mid) } }] },
        ]);
      };
      if (next.delayMs) setTimeout(answer, next.delayMs).unref();
      else answer();
    });
  });
  await new Promise(r => stub.listen(0, '127.0.0.1', r));
  stubUrl = `http://127.0.0.1:${stub.address().port}/v1`;

  fs.writeFileSync(CONFIG_PATH, JSON.stringify({
    models: { providers: { stub: { baseUrl: stubUrl, apiKey: 'test-key', models: ['stub-model'] } } },
  }, null, 2));

  await H.start();
  await H.api(null, 'POST', '/api/harness/doca/config', { provider: 'stub', model: 'stub-model' });

  phone  = H.mkDevice('phone',  'phone',  H.PHONE_CAPS);
  watch  = H.mkDevice('watch',  'watch',  H.WATCH_CAPS);
  viewer = H.mkDevice('viewer', 'viewer');
  admin  = H.mkDevice('admin',  'admin');
});

after(async () => {
  await H.stop();
  await new Promise(r => stub.close(r));
});

beforeEach(() => { script = []; seen = []; });

/** The system prompt of the last turn the stub was asked to answer. */
const lastSystemPrompt = () => seen[seen.length - 1].messages.find(m => m.role === 'system').content;

/**
 * How *this* turn ended. Scoped to a turnId on purpose: `agent.turn` is durable,
 * so a stream opened at cursor 0 replays every turn the suite has run, and a
 * bare "wait for a done event" would pass on somebody else's answer.
 */
const settled = (s, turnId) => s.waitFor(e => e.type === 'agent.turn' && e.payload.turnId === turnId && e.payload.state !== 'started');

test('a turn asked for on one device is answered on every device the user owns', async () => {
  script = [{ text: 'Twelve containers are running.' }];

  const onPhone = H.sse(phone.token);
  const onWatch = H.sse(watch.token);
  await Promise.all([onPhone.ready, onWatch.ready]);

  const posted = await H.api(phone.token, 'POST', '/api/v1/harness/messages', { message: 'how many containers?' });
  assert.equal(posted.status, 202, 'accepted, not answered: the reply travels on the bus');
  assert.match(posted.body.turnId, /^trn_/);
  assert.ok(posted.body.sessionId, 'the caller learns which conversation this landed in');

  // The watch never asked, and still sees the turn start and finish.
  const started = await onWatch.waitFor(e => e.type === 'agent.turn' && e.payload.state === 'started');
  assert.equal(started.payload.turnId, posted.body.turnId);
  assert.equal(started.payload.by, phone.device.id, 'so a client can say who asked');
  assert.equal(started.payload.message, 'how many containers?');

  const done = await settled(onWatch, posted.body.turnId);
  assert.equal(done.payload.state, 'done');
  assert.equal(done.payload.text, 'Twelve containers are running.');
  assert.equal(done.payload.steps, 1);

  // The device that asked also gets the reply as it is typed.
  const deltas = onPhone.events.filter(e => e.type === 'agent.text');
  assert.ok(deltas.length >= 1, 'the client with a screen open streams the answer');
  assert.equal(deltas.map(e => e.payload.delta).join(''), 'Twelve containers are running.');

  // …and the watch is not billed for radio time it cannot read.
  assert.equal(onWatch.events.filter(e => e.type === 'agent.text').length, 0);

  onPhone.close(); onWatch.close();
});

test('turn state is durable, so a client that was away still gets the answer', async () => {
  script = [{ text: 'It finished while you were gone.' }];
  const bystander = H.mkDevice('late-phone', 'phone', H.PHONE_CAPS);

  const posted = await H.api(phone.token, 'POST', '/api/v1/harness/messages', { message: 'run it' });
  const live = H.sse(phone.token); await live.ready;
  await settled(live, posted.body.turnId);
  live.close();

  // Connecting afterwards replays the turn from the cursor.
  const late = H.sse(bystander.token);
  await late.ready;
  const done = await settled(late, posted.body.turnId);
  assert.equal(done.payload.turnId, posted.body.turnId);
  assert.equal(done.payload.text, 'It finished while you were gone.');
  // Deltas were ephemeral: nothing to replay, and nothing lost.
  assert.equal(late.events.filter(e => e.type === 'agent.text').length, 0);
  late.close();
});

test('the tools the agent runs are visible to every client, bounded', async () => {
  script = [{ tool: 'system_status', args: { verbose: true } }, { text: 'All good.' }];

  const onWatch = H.sse(watch.token); await onWatch.ready;
  const posted = await H.api(phone.token, 'POST', '/api/v1/harness/messages', { message: 'check the box' });

  const call = await onWatch.waitFor(e => e.type === 'agent.tool' && e.payload.phase === 'call');
  assert.equal(call.payload.name, 'system_status');
  assert.equal(call.payload.step, 1);
  assert.match(call.payload.args, /verbose/);

  const result = await onWatch.waitFor(e => e.type === 'agent.tool' && e.payload.phase === 'result');
  assert.equal(result.payload.name, 'system_status');
  assert.equal(typeof result.payload.ok, 'boolean');
  assert.ok(result.payload.preview.length <= 401, 'a tool result is previewed, not shipped whole');

  await settled(onWatch, posted.body.turnId);
  onWatch.close();
});

test('a turn that fails says so on the bus, because there is no response left to fail', async () => {
  script = [{ status: 500 }];

  const onPhone = H.sse(phone.token); await onPhone.ready;
  const posted = await H.api(phone.token, 'POST', '/api/v1/harness/messages', { message: 'break' });
  assert.equal(posted.status, 202, 'the failure is not the POST\'s to report');

  const ended = await settled(onPhone, posted.body.turnId);
  assert.equal(ended.payload.state, 'failed');
  assert.equal(ended.payload.error.code, 'harness_error');
  assert.ok(ended.payload.error.message);
  onPhone.close();
});

test('two clients cannot interleave one transcript', async () => {
  script = [{ text: 'first answer', delayMs: 400 }];
  const first = await H.api(phone.token, 'POST', '/api/v1/harness/messages', { message: 'one' });
  const second = await H.api(watch.token, 'POST', '/api/v1/harness/messages', { message: 'two', sessionId: first.body.sessionId });

  assert.equal(second.status, 409);
  assert.equal(second.body.error.code, 'turn_in_flight');
  assert.equal(second.body.error.turnId, first.body.turnId, 'so a client can wait for the right turn');

  const onPhone = H.sse(phone.token); await onPhone.ready;
  await settled(onPhone, first.body.turnId);
  onPhone.close();

  // Once it settles, the same session accepts the next turn.
  script = [{ text: 'second answer' }];
  const third = await H.api(watch.token, 'POST', '/api/v1/harness/messages', { message: 'two', sessionId: first.body.sessionId });
  assert.equal(third.status, 202);
  const after = H.sse(phone.token); await after.ready;
  await settled(after, third.body.turnId);
  after.close();
});

test('an empty message is refused, and media is refused honestly rather than ignored', async () => {
  const empty = await H.api(phone.token, 'POST', '/api/v1/harness/messages', { message: '   ' });
  assert.equal(empty.status, 400);
  assert.equal(empty.body.error.code, 'invalid_request');

  const media = await H.api(phone.token, 'POST', '/api/v1/harness/messages', { message: 'look', mediaId: 'med_x' });
  assert.equal(media.status, 400);
  assert.equal(media.body.error.code, 'unsupported');

  const big = await H.api(phone.token, 'POST', '/api/v1/harness/messages', { message: 'x'.repeat(9000) });
  assert.equal(big.status, 413);
});

test('conversations are listed, created, switched and read by a client that may hold them', async () => {
  const created = await H.api(phone.token, 'POST', '/api/v1/harness/sessions', { title: 'Kitchen' });
  assert.equal(created.status, 201);
  const id = created.body.session.id;

  const list = await H.api(phone.token, 'GET', '/api/v1/harness/sessions');
  assert.equal(list.status, 200);
  assert.equal(list.body.active, id, 'a new conversation becomes the active one');
  assert.ok(list.body.sessions.some(s => s.id === id));

  script = [{ text: 'noted' }];
  const turn = await H.api(phone.token, 'POST', '/api/v1/harness/messages', { message: 'remember the milk', sessionId: id });
  const s = H.sse(phone.token); await s.ready; await settled(s, turn.body.turnId); s.close();

  const read = await H.api(phone.token, 'GET', `/api/v1/harness/sessions/${id}`);
  assert.equal(read.status, 200);
  assert.deepEqual(read.body.messages.map(m => m.role), ['user', 'assistant']);
  assert.equal(read.body.messages[0].content, 'remember the milk');
  assert.equal(read.body.messages[1].content, 'noted');

  assert.equal((await H.api(phone.token, 'POST', `/api/v1/harness/sessions/${id}/activate`)).status, 200);
  assert.equal((await H.api(phone.token, 'GET', '/api/v1/harness/sessions/nope')).status, 404);
  assert.equal((await H.api(phone.token, 'DELETE', `/api/v1/harness/sessions/${id}`)).status, 200);
  assert.equal((await H.api(phone.token, 'GET', `/api/v1/harness/sessions/${id}`)).status, 404);
});

test('a watch may ask, but not administer conversations or read memory', async () => {
  // It holds harness:chat …
  script = [{ text: 'on it' }];
  const asked = await H.api(watch.token, 'POST', '/api/v1/harness/messages', { message: 'lights off' });
  assert.equal(asked.status, 202);
  const s = H.sse(watch.token); await s.ready; await settled(s, asked.body.turnId); s.close();

  // … and nothing else from that family.
  const sessions = await H.api(watch.token, 'GET', '/api/v1/harness/sessions');
  assert.equal(sessions.status, 403);
  assert.deepEqual(sessions.body.error.required, ['harness:sessions']);
  assert.equal((await H.api(watch.token, 'GET', '/api/v1/harness/memory')).status, 403);
});

test('a device with no harness scope can neither ask nor overhear', async () => {
  const refused = await H.api(viewer.token, 'POST', '/api/v1/harness/messages', { message: 'hello?' });
  assert.equal(refused.status, 403);
  assert.deepEqual(refused.body.error.required, ['harness:chat']);

  const onViewer = H.sse(viewer.token); await onViewer.ready;
  script = [{ text: 'not for you' }];
  const posted = await H.api(phone.token, 'POST', '/api/v1/harness/messages', { message: 'private thing' });

  const onPhone = H.sse(phone.token); await onPhone.ready;
  await settled(onPhone, posted.body.turnId);
  await H.sleep(50);
  // It still gets its surfaces — `read:*` is untouched — but not a word of the
  // conversation, which is what pairing a screen in a shared room must not leak.
  assert.deepEqual(onViewer.events.filter(e => e.type.startsWith('agent.')), []);
  onViewer.close(); onPhone.close();
});

test('memory is readable with the scope for it, and proposals are visible but not applicable', async () => {
  const r = await H.api(admin.token, 'GET', '/api/v1/harness/memory');
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body.entries));
  assert.ok(Array.isArray(r.body.rules.categories), 'the rules both sides may edit travel with their categories');
  assert.ok(Array.isArray(r.body.proposals));

  // There is no route that writes memory or applies a proposal from a device:
  // the /api/harness ones are dashboard routes, deliberately not in /api/v1.
  assert.equal((await H.api(admin.token, 'POST', '/api/v1/harness/memory', { key: 'k', value: 'v' })).status, 404);
});

test('the agent is told which client asked, and how much answer it can hold', async () => {
  script = [{ text: 'ok' }];
  const fromWatch = await H.api(watch.token, 'POST', '/api/v1/harness/messages', { message: 'status?' });
  let s = H.sse(watch.token); await s.ready; await settled(s, fromWatch.body.turnId); s.close();

  const watchPrompt = lastSystemPrompt();
  assert.match(watchPrompt, /# Who is asking/);
  assert.match(watchPrompt, new RegExp(`"watch" \\(${watch.device.id}\\) — a watch, 450×450 round`));
  assert.match(watchPrompt, /One or two short sentences/);
  assert.match(watchPrompt, /Other devices of the same user may be reading this conversation/);
  // The tag is a fact about the turn, not an edit of the user's words.
  const asAsked = seen[seen.length - 1].messages.filter(m => m.role === 'user').pop();
  assert.equal(asAsked.content, 'status?');

  script = [{ text: 'ok' }];
  const fromPhone = await H.api(phone.token, 'POST', '/api/v1/harness/messages', { message: 'status?' });
  s = H.sse(phone.token); await s.ready; await settled(s, fromPhone.body.turnId); s.close();

  const phonePrompt = lastSystemPrompt();
  assert.match(phonePrompt, new RegExp(`"phone" \\(${phone.device.id}\\) — a phone, 1080×2400`));
  assert.match(phonePrompt, /A few short paragraphs/);
  assert.equal(/One or two short sentences/.test(phonePrompt), false, 'the phone is not treated as a watch');

  // An agent client is told to stop formatting for a human at all.
  script = [{ text: 'ok' }];
  const headless = H.mkDevice('sim', 'agent', {}, ['harness:chat']);
  const fromAgent = await H.api(headless.token, 'POST', '/api/v1/harness/messages', { message: 'status?' });
  s = H.sse(headless.token); await s.ready; await settled(s, fromAgent.body.turnId); s.close();
  assert.match(lastSystemPrompt(), /Complete and machine-readable/);

  // And the transcript keeps who asked, so one shared conversation still shows
  // which window each question came through.
  const read = await H.api(phone.token, 'GET', `/api/v1/harness/sessions/${fromPhone.body.sessionId}?limit=12`);
  const asked = read.body.messages.filter(m => m.role === 'user' && m.from);
  assert.deepEqual(asked.find(m => m.from.id === phone.device.id).from,
    { id: phone.device.id, name: 'phone', formFactor: 'phone' });
  assert.deepEqual(asked.find(m => m.from.id === headless.device.id).from,
    { id: headless.device.id, name: 'sim', formFactor: 'other' });
});

test('the dashboard console tags itself as well, so no turn is anonymous', async () => {
  script = [{ text: 'ok' }];
  const res = await fetch(`${H.base}/api/harness/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'who am I talking from?' }),
  });
  await res.text();
  const prompt = lastSystemPrompt();
  assert.match(prompt, /"Dashboard console"/);
  assert.match(prompt, /Full detail is welcome/);
});

test('the new event types are advertised with the class a client should expect', async () => {
  const caps = await H.api(watch.token, 'GET', '/api/v1/capabilities');
  const types = Object.fromEntries(caps.body.protocol.eventTypes.map(e => [e.type, e.class]));
  assert.equal(types['agent.turn'], 'durable', 'so a client that reconnects learns the outcome');
  assert.equal(types['agent.text'], 'ephemeral');
  assert.equal(types['agent.tool'], 'ephemeral');
});

test('a mid-turn arrival can draw "typing" without waiting for the next event', async () => {
  script = [{ text: 'done thinking', delayMs: 400 }];
  const posted = await H.api(phone.token, 'POST', '/api/v1/harness/messages', { message: 'slow one' });

  const inFlight = await H.api(watch.token, 'GET', '/api/v1/harness/turns');
  assert.equal(inFlight.status, 200);
  assert.deepEqual(inFlight.body.turns, [{ sessionId: posted.body.sessionId, turnId: posted.body.turnId }]);

  const s = H.sse(phone.token); await s.ready; await settled(s, posted.body.turnId); s.close();
  assert.deepEqual((await H.api(watch.token, 'GET', '/api/v1/harness/turns')).body.turns, []);
});

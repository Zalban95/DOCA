'use strict';

/**
 * AG-UI (TODO H9.2; hive.md §3.7): any front end that speaks the Agent–User Interaction protocol — CopilotKit and
 * the others built on it — is a client of the hive. `POST /api/v1/agui` takes AG-UI's RunAgentInput (`threadId`,
 * `runId`, `messages`, …) with a paired device's bearer token and answers with AG-UI's event stream over SSE:
 *
 *   RUN_STARTED → TEXT_MESSAGE_START / _CONTENT / _END, TOOL_CALL_START / _ARGS / _END / TOOL_CALL_RESULT … → RUN_FINISHED
 *   (RUN_ERROR when the turn fails; CUSTOM "doca.prompt" when the hive asks this device a question)
 *
 * It is the device adapter underneath — `harness.post()` as that device, its person's level and approvals, the
 * queue when the conversation is working — and the events are the bus's for that turn, renamed. A thread is a
 * conversation: an AG-UI `threadId` that is one of the person's conversation ids is that conversation; any other is
 * mapped to a new conversation the first time and to the same one after (`agui-threads`, per device).
 *
 * What it does not do: run the front end's own tools (`tools` in the input: the hive's agent uses its own), or
 * take `state` — said in one CUSTOM "doca.note" event rather than ignored silently. Closing the stream does not stop
 * the turn (as for every device): stop it with POST /harness/turns/:id/cancel.
 */
const crypto = require('crypto');
const harness = require('./harness');
const { can } = require('./auth');

const DOC = 'agui-threads';
const id = p => `${p}_${crypto.randomBytes(6).toString('hex')}`;

/** The user's words in an AG-UI message: a string, or text parts. */
function textOf(m) {
  if (typeof m?.content === 'string') return m.content;
  if (Array.isArray(m?.content)) return m.content.filter(c => c?.type === 'text').map(c => c.text).join('\n');
  return '';
}

/** The conversation a thread is: the person's own id, or the one this device's thread was mapped to. */
function sessionFor(device, threadId, firstWords) {
  const store = require('../store');
  try { harness.requireSession(threadId, device); return threadId; } catch { /* not one of theirs */ }
  const map = store.readJson(DOC, {});
  const key = `${device.id}:${threadId}`;
  if (map[key]) { try { harness.requireSession(map[key], device); return map[key]; } catch { /* deleted since */ } }
  const s = harness.createSession(firstWords.slice(0, 60) || 'AG-UI', { activate: false, device });
  store.writeJson(DOC, { ...map, [key]: s.id });
  return s.id;
}

function mount(router) {
  router.post('/agui', (req, res) => {
    if (!can(req, 'harness:chat')) return res.status(403).json({ error: { code: 'forbidden', message: 'This device\'s token lacks harness:chat.' } });
    const input = req.body || {};
    const message = textOf([...(input.messages || [])].reverse().find(m => m.role === 'user')).trim();
    if (!message) return res.status(400).json({ error: { code: 'invalid_request', message: 'messages must end with a user message' } });
    const device = require('./devices').get(req.device.id);
    const threadId = String(input.threadId || id('thread')), runId = String(input.runId || id('run'));
    let sessionId;
    try { sessionId = sessionFor(device, threadId, message); }
    catch (e) { return res.status(e.status || 500).json({ error: { code: 'error', message: e.message } }); }

    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    const send = evt => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(evt)}\n\n`); };
    send({ type: 'RUN_STARTED', threadId, runId });
    const ignored = [Array.isArray(input.tools) && input.tools.length ? 'the front end\'s own tools (the hive uses its own)' : '',
      input.state && Object.keys(input.state).length ? 'state' : ''].filter(Boolean);
    if (ignored.length) send({ type: 'CUSTOM', name: 'doca.note', value: `Not used by DOCA: ${ignored.join(' and ')}.` });

    const bus = require('./bus');
    let turnId = null, textId = null, n = 0;
    const calls = new Map();   // tool name → [toolCallId…], paired call → result in order
    const closeText = () => { if (textId) { send({ type: 'TEXT_MESSAGE_END', messageId: textId }); textId = null; } };
    let sub = null;
    const end = () => { sub?.unsubscribe(); res.end(); };
    const on = env => {
      const p = env.payload || {};
      if (env.type === 'prompt.new') return send({ type: 'CUSTOM', name: 'doca.prompt', value: p.prompt });
      if (!turnId || p.turnId !== turnId) return;
      if (env.type === 'agent.text' && p.delta) {
        if (!textId) { textId = id('msg'); send({ type: 'TEXT_MESSAGE_START', messageId: textId, role: 'assistant' }); }
        return send({ type: 'TEXT_MESSAGE_CONTENT', messageId: textId, delta: p.delta });
      }
      if (env.type === 'agent.tool' && p.phase === 'call') {
        const parent = textId; closeText();
        const callId = `${runId}-call-${++n}`;
        calls.set(p.name, [...(calls.get(p.name) || []), callId]);
        send({ type: 'TOOL_CALL_START', toolCallId: callId, toolCallName: p.name, ...(parent ? { parentMessageId: parent } : {}) });
        if (p.args) send({ type: 'TOOL_CALL_ARGS', toolCallId: callId, delta: typeof p.args === 'string' ? p.args : JSON.stringify(p.args) });
        return send({ type: 'TOOL_CALL_END', toolCallId: callId });
      }
      if (env.type === 'agent.tool' && p.phase === 'result') {
        const callId = (calls.get(p.name) || []).shift() || `${runId}-call-${++n}`;
        return send({ type: 'TOOL_CALL_RESULT', messageId: id('msg'), toolCallId: callId, role: 'tool', content: String(p.preview ?? '') });
      }
      if (env.type !== 'agent.turn' || p.state === 'started') return;
      // A device that never got deltas (the turn was read from a queue) still gets the answer as one message.
      if (p.state === 'done' && p.text && !textId && !n) { textId = id('msg'); send({ type: 'TEXT_MESSAGE_START', messageId: textId, role: 'assistant' }); send({ type: 'TEXT_MESSAGE_CONTENT', messageId: textId, delta: p.text }); }
      closeText();
      if (env.ack) bus.ackUpTo(device.id, env.seq);   // delivered: this stream is the device's screen
      if (p.state === 'failed') send({ type: 'RUN_ERROR', message: p.error?.message || 'The turn failed.', code: p.error?.code || 'harness_error' });
      else send({ type: 'RUN_FINISHED', threadId, runId, result: { conversation: sessionId, state: p.state, ...(p.images?.length ? { images: p.images } : {}) } });
      end();
    };
    // A subscriber like any client's stream (ephemeral deltas reach only a device that is listening); what was
    // already waiting for this device is not this run's, so the replay is left alone.
    sub = bus.subscribe(device.id, 0, { send: on });
    res.on('close', () => sub?.unsubscribe());
    try { ({ turnId } = harness.post({ message, sessionId }, device)); }
    catch (e) { send({ type: 'RUN_ERROR', message: e.message, code: e.code || 'error' }); end(); }
  });
}

module.exports = { mount, textOf };

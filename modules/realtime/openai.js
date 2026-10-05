'use strict';

/**
 * The OpenAI Realtime protocol (TODO H8.3; docs/experiments/realtime-voice.md) — the surface most realtime speech
 * services speak: OpenAI itself, Azure OpenAI, and local servers such as Hugging Face's speech-to-speech
 * (`ws://…:8765/v1/realtime`). One WebSocket; PCM16 mono at 24 kHz both ways; the server's own voice activity
 * detection, so talking over an answer cancels it (barge-in is the protocol's, not ours).
 *
 * `dialect` 'ga' (default) sends the GA session shape; 'beta' the earlier one (`OpenAI-Beta: realtime=v1`), which some
 * compatible servers still expect. Events are read in both spellings.
 *
 * The adapter interface (gemini.js has the same): an EventEmitter with `audio(Buffer)`, `toolResult(id, text)`,
 * `say(text)`, `userText(text)`, `close()`, emitting ready, audio (Buffer, PCM16 24 kHz), user (transcript), agent (transcript delta),
 * interrupted, tool ({id, name, args}), turn (an answer finished), error (message), closed.
 */
const { EventEmitter } = require('events');

function connect({ url, key, model, voice, instructions, tools = [], dialect = 'ga' }) {
  const WebSocket = require('ws');
  const em = new EventEmitter();
  const u = new URL(url);
  if (model && !u.searchParams.has('model') && !/deployment=/.test(u.search)) u.searchParams.set('model', model);
  const headers = {};
  if (key) Object.assign(headers, /azure/i.test(u.hostname) ? { 'api-key': key } : { Authorization: `Bearer ${key}` });
  if (dialect === 'beta') headers['OpenAI-Beta'] = 'realtime=v1';
  const ws = new WebSocket(u.toString(), { headers, handshakeTimeout: 15000 });
  const send = o => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
  const fns = tools.map(t => ({ type: 'function', name: t.name, description: t.description, parameters: t.parameters }));

  ws.on('open', () => {
    send(dialect === 'beta'
      ? { type: 'session.update', session: { modalities: ['audio', 'text'], instructions, ...(voice ? { voice } : {}), input_audio_format: 'pcm16', output_audio_format: 'pcm16',
          input_audio_transcription: { model: 'whisper-1' }, turn_detection: { type: 'server_vad' }, tools: fns, tool_choice: 'auto' } }
      : { type: 'session.update', session: { type: 'realtime', ...(model ? { model } : {}), instructions, output_modalities: ['audio'],
          audio: { input: { format: { type: 'audio/pcm', rate: 24000 }, transcription: { model: 'gpt-4o-mini-transcribe' }, turn_detection: { type: 'server_vad' } },
            output: { format: { type: 'audio/pcm', rate: 24000 }, ...(voice ? { voice } : {}) } }, tools: fns, tool_choice: 'auto' } });
    em.emit('ready');
  });
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw.toString()); } catch { return; }
    switch (m.type) {
      case 'response.output_audio.delta': case 'response.audio.delta': em.emit('audio', Buffer.from(m.delta || '', 'base64')); break;
      case 'response.output_audio_transcript.delta': case 'response.audio_transcript.delta': em.emit('agent', m.delta || ''); break;
      case 'conversation.item.input_audio_transcription.completed': em.emit('user', m.transcript || ''); break;
      case 'input_audio_buffer.speech_started': em.emit('interrupted'); break;
      case 'response.function_call_arguments.done': {
        let args = {}; try { args = JSON.parse(m.arguments || '{}'); } catch { /* the model's JSON */ }
        em.emit('tool', { id: m.call_id, name: m.name, args }); break;
      }
      case 'response.done': em.emit('turn'); break;
      case 'error': em.emit('error', m.error?.message || 'the realtime service reported an error'); break;
      default: break;
    }
  });
  ws.on('error', e => em.emit('error', e.message));
  ws.on('close', (code, reason) => em.emit('closed', { code, reason: String(reason || '') }));

  em.audio = pcm => send({ type: 'input_audio_buffer.append', audio: pcm.toString('base64') });
  em.toolResult = (id, text) => { send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: id, output: String(text) } }); send({ type: 'response.create' }); };
  em.say = text => { send({ type: 'conversation.item.create', item: { type: 'message', role: 'system', content: [{ type: 'input_text', text: String(text) }] } }); send({ type: 'response.create' }); };
  em.userText = text => { send({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: String(text) }] } }); send({ type: 'response.create' }); };   // typed words (the measurement)
  em.close = () => { try { ws.close(); } catch { /* gone */ } };
  return em;
}

/** The socket address for an OpenAI-compatible base URL: https://api.openai.com/v1 → wss://api.openai.com/v1/realtime. */
const urlFor = baseUrl => `${String(baseUrl).replace(/\/+$/, '').replace(/^http/, 'ws')}/realtime`;

module.exports = { connect, urlFor, RATE: 24000 };

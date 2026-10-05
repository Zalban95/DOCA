'use strict';

/**
 * Google's Gemini Live (TODO H8.3; docs/experiments/realtime-voice.md): BidiGenerateContent over a WebSocket, the
 * other protocol realtime speech is spoken in — and at a fraction of the price per minute. It takes PCM16 at 16 kHz
 * and answers at 24 kHz, so what the hub receives at 24 kHz is resampled here; transcripts of both sides are native,
 * and the server says `interrupted` itself when the person talks over an answer.
 *
 * Same interface as openai.js: `audio(Buffer)`, `toolResult(id, text)`, `say(text)`, `close()`; events ready, audio,
 * user, agent, interrupted, tool, turn, error, closed.
 */
const { EventEmitter } = require('events');

const DEFAULT_URL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

/** PCM16 mono 24 kHz → 16 kHz: each output sample the mean of the input it covers (a box filter against aliasing). */
function to16k(pcm) {
  const n = Math.floor(pcm.length / 2), out = Buffer.alloc(Math.floor(n * 2 / 3) * 2);
  for (let i = 0; i < out.length / 2; i++) {
    const a = i * 1.5, lo = Math.floor(a);
    const s0 = pcm.readInt16LE(lo * 2), s1 = lo + 1 < n ? pcm.readInt16LE((lo + 1) * 2) : s0;
    out.writeInt16LE(Math.round(a === lo ? (s0 * 2 + s1) / 3 : (s0 + s1 * 2) / 3), i * 2);   // 1.5 input samples each
  }
  return out;
}

function connect({ url, key, model, voice, instructions, tools = [] }) {
  const WebSocket = require('ws');
  const em = new EventEmitter();
  const u = new URL(url || DEFAULT_URL);
  if (key && !u.searchParams.has('key')) u.searchParams.set('key', key);
  const ws = new WebSocket(u.toString(), { handshakeTimeout: 15000 });
  const send = o => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
  const names = new Map();   // a call's id → its name, which a response must repeat

  ws.on('open', () => send({ setup: {
    model: String(model).startsWith('models/') ? model : `models/${model}`,
    generationConfig: { responseModalities: ['AUDIO'], ...(voice ? { speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } } : {}) },
    systemInstruction: { parts: [{ text: instructions }] },
    tools: tools.length ? [{ functionDeclarations: tools.map(t => ({ name: t.name, description: t.description, parameters: t.parameters })) }] : [],
    inputAudioTranscription: {}, outputAudioTranscription: {},
  } }));
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw.toString()); } catch { return; }
    if (m.setupComplete) em.emit('ready');
    const sc = m.serverContent;
    if (sc) {
      for (const p of sc.modelTurn?.parts || []) if (p.inlineData?.data) em.emit('audio', Buffer.from(p.inlineData.data, 'base64'));
      if (sc.inputTranscription?.text) em.emit('user', sc.inputTranscription.text);
      if (sc.outputTranscription?.text) em.emit('agent', sc.outputTranscription.text);
      if (sc.interrupted) em.emit('interrupted');
      if (sc.turnComplete) em.emit('turn');
    }
    for (const c of m.toolCall?.functionCalls || []) { names.set(c.id, c.name); em.emit('tool', { id: c.id, name: c.name, args: c.args || {} }); }
    if (m.error) em.emit('error', m.error.message || 'Gemini Live reported an error');
  });
  ws.on('error', e => em.emit('error', e.message));
  ws.on('close', (code, reason) => em.emit('closed', { code, reason: String(reason || '') }));

  em.audio = pcm => send({ realtimeInput: { audio: { data: to16k(pcm).toString('base64'), mimeType: 'audio/pcm;rate=16000' } } });
  em.toolResult = (id, text) => send({ toolResponse: { functionResponses: [{ id, name: names.get(id) || 'doca', response: { result: String(text) } }] } });
  em.say = text => send({ clientContent: { turns: [{ role: 'user', parts: [{ text: String(text) }] }], turnComplete: true } });
  em.userText = em.say;   // typed words as the person's turn (the measurement)
  em.close = () => { try { ws.close(); } catch { /* gone */ } };
  return em;
}

module.exports = { connect, to16k, DEFAULT_URL, RATE: 24000 };

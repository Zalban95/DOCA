'use strict';

/**
 * Realtime voice (TODO H8.3; an experiment, docs/experiments/realtime-voice.md): a spoken call with a speech-to-speech
 * model in place of STT → turn → TTS. The hub relays it — a client streams its microphone to the hub and hears the
 * model through it — so the provider's key never leaves the hub, the protocol is the hub's choice (an adapter per
 * protocol: openai.js for the OpenAI Realtime surface, gemini.js for Gemini Live), and any client can call: the panel
 * at /ws/realtime, a paired device at /api/v1/realtime (routes.js).
 *
 * The voice model is a front, not the agent. It holds one tool, `doca`, which hands the person's request to their
 * conversation as an ordinary turn — their level, approvals, the charter, the conversation's queue — and reads back
 * its answer. A turn that takes longer than `realtime.waitSec` keeps working: the model is told it is still running,
 * and when it finishes the answer is given to the model to say. Spoken small talk that never reaches the tool is not
 * written into the conversation; what the tool asked and answered is, as the turn itself.
 *
 * The wire to the client: binary frames are PCM16 little-endian mono at 24 kHz, both ways; text frames are JSON —
 * from the hub {type: ready | user | agent | interrupted | working | done | error | closed}, from the client {type: 'stop'}.
 */
const ADAPTERS = { openai: require('./openai'), gemini: require('./gemini') };

const MAX_SAY = 4000;
const TOOL = {
  name: 'doca',
  description: 'Ask the DOCA hive to answer or to do something: anything about the person\'s machine, files, devices, accounts, memory, '
    + 'the web, or any action at all. Pass the person\'s request in their own words; the answer comes back as text to say briefly.',
  parameters: { type: 'object', properties: { request: { type: 'string', description: 'What the person asked, in their words.' } }, required: ['request'] },
};

const settings = () => {
  const sc = require('../settings-schema');
  return { protocol: sc.value('realtime.protocol'), provider: sc.value('realtime.provider'), url: sc.value('realtime.url'), model: sc.value('realtime.model'),
    voice: sc.value('realtime.voice'), dialect: sc.value('realtime.dialect'), waitSec: sc.value('realtime.waitSec') };
};
const on = () => require('../experiments').on('realtimeVoice') && !!settings().model && !!ADAPTERS[settings().protocol];

/** What a client needs to know before it calls. */
function status() {
  const s = settings();
  return { available: on(), experiment: require('../experiments').on('realtimeVoice'), protocol: s.protocol, provider: s.provider, model: s.model || null,
    audio: { format: 'pcm16', rate: 24000, channels: 1 }, protocols: Object.keys(ADAPTERS) };
}

/**
 * A device's live call (`/api/v1/call`, docs/design/watch-call.md): the realtime model when one is on, else the hive's
 * own speech-to-text, turn and text-to-speech (pipeline.js) — one wire either way, so a client is written once.
 */
async function callStatus() {
  if (on()) return { available: true, engine: 'realtime', protocol: settings().protocol, audio: { format: 'pcm16', rate: 24000, channels: 1 } };
  const vs = require('../chat').loadVoiceServices();
  const up = async url => { try { return (await fetch(`${url}/v1/models`, { signal: AbortSignal.timeout(3000) })).ok; } catch { return false; } };
  const [stt, tts] = await Promise.all([up(vs.sttUrl), up(vs.ttsUrl)]);
  return { available: stt && tts, engine: 'pipeline', stt, tts, audio: { format: 'pcm16', rate: 24000, channels: 1 },
    ...(stt && tts ? {} : { reason: `The hive's ${[!stt && 'speech-to-text', !tts && 'text-to-speech'].filter(Boolean).join(' and ')} did not answer (Settings → Voice).` }) };
}

/** The address and key: the setting's URL, else derived from the provider (Settings → API Keys holds the key). */
function target(s = settings()) {
  let ep = null;
  try { ep = require('../harness/providers').endpoint(s.provider); } catch { /* a URL alone may be enough */ }
  const url = s.url || (s.protocol === 'gemini' ? require('./gemini').DEFAULT_URL : ep ? require('./openai').urlFor(ep.baseUrl) : null);
  if (!url) throw Object.assign(new Error('No address for the realtime service: set realtime.url or a provider with a base URL.'), { status: 409 });
  return { url, key: ep?.apiKey || '' };
}

const INSTRUCTIONS = 'You are the voice of DOCA, a person\'s own AI hive, in a live spoken call. Keep what you say short and natural to hear. '
  + 'For anything beyond small talk — facts about their machine, files, devices, memory, accounts or the web, or doing anything — call the doca tool '
  + 'with what they asked, in their words, then say its answer briefly. Never say something was done unless the doca tool reported it. If the tool '
  + 'says the work is still running, say so and that you will tell them when it is done. When you are told a request finished, tell them briefly.';

/** The last few things said in the conversation, so the call starts knowing what it is about. */
function recent(sessionId) {
  try {
    const rows = require('../harness/memory').messages(sessionId).filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim());
    const tail = rows.slice(-6).map(m => `${m.role === 'user' ? 'Person' : 'DOCA'}: ${m.content.replace(/\s+/g, ' ').slice(0, 300)}`);
    return tail.length ? `\n\nThe conversation so far (most recent last):\n${tail.join('\n')}` : '';
  } catch { return ''; }
}

/**
 * One call. `ws` is the client's socket; `ask(text)` starts a turn as the caller and resolves with its answer text
 * (a rejection is said as a failure); `sessionId` is the conversation it lands in.
 */
function serve(ws, { ask, sessionId, onEnd = () => {}, engine = 'realtime' }) {
  const s = settings();
  const tell = o => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
  const pipeline = engine === 'auto' && !on();   // a device's call: the hive's own voice when no realtime model is on
  if (!pipeline && !on()) { tell({ type: 'error', message: 'Realtime voice is off: switch on the experiment and set realtime.model (Settings → Voice → Live call).' }); ws.close(); return; }
  let t;
  if (!pipeline) { try { t = target(s); } catch (e) { tell({ type: 'error', message: e.message }); ws.close(); return; } }
  const stats = { at: Date.now(), firstAudioMs: null, spokeAt: null, tools: 0, background: 0, interrupted: 0 };
  const model = pipeline ? require('./pipeline').connect({})
    : ADAPTERS[s.protocol].connect({ ...t, model: s.model, voice: s.voice, dialect: s.dialect, instructions: INSTRUCTIONS + recent(sessionId), tools: [TOOL] });
  if (pipeline) s.protocol = 'pipeline';
  let ended = false;
  const end = why => {
    if (ended) return; ended = true;
    model.close();
    tell({ type: 'closed', reason: why, stats: { ...stats, minutes: Math.round((Date.now() - stats.at) / 6000) / 10 } });
    try { ws.close(); } catch { /* gone */ }
    onEnd(stats);
  };

  model.on('ready', () => tell({ type: 'ready', protocol: s.protocol, model: s.model, sessionId }));
  model.on('audio', pcm => {
    if (stats.spokeAt && stats.firstAudioMs === null) stats.firstAudioMs = Date.now() - stats.spokeAt;
    if (ws.readyState === 1) ws.send(pcm, { binary: true });
  });
  model.on('user', text => { stats.spokeAt = stats.spokeAt || Date.now(); tell({ type: 'user', text }); });
  model.on('agent', text => tell({ type: 'agent', text }));
  model.on('turn', () => tell({ type: 'done' }));
  model.on('interrupted', () => { stats.interrupted++; tell({ type: 'interrupted' }); });
  model.on('error', message => tell({ type: 'error', message: `${s.protocol}: ${message}` }));
  model.on('closed', ({ code, reason }) => end(`the realtime service closed the call (${code}${reason ? `: ${reason}` : ''})`));
  model.on('tool', ({ id, name, args }) => {
    if (name !== TOOL.name) return model.toolResult(id, `There is no tool named ${name}; use doca.`);
    const request = String(args.request || '').trim();
    if (!request) return model.toolResult(id, 'Say what the person asked in the request.');
    stats.tools++;
    tell({ type: 'working', text: request });
    const answer = Promise.resolve().then(() => ask(request)).then(a => String(a || '(no answer)').slice(0, MAX_SAY), e => `It failed: ${e.message}`);
    let late = false;
    const wait = new Promise(r => setTimeout(() => { late = true; r(null); }, Math.max(3, Number(s.waitSec) || 20) * 1000));
    Promise.race([answer, wait]).then(first => {
      if (first !== null && !late) return model.toolResult(id, first);
      stats.background++;
      // A model is told what to say; the pipeline says what it is given, so its words are for the listener.
      model.toolResult(id, model.literal ? 'That will take a while. I will tell you when it is done.'
        : 'Still working on it in the background. Tell the person it is under way and that you will say when it is done.');
      answer.then(text => { if (!ended) model.say(model.literal ? text : `The earlier request finished ("${request.slice(0, 200)}"). DOCA's answer: ${text}`); });
    });
  });

  ws.on('message', (data, isBinary) => {
    if (isBinary) return model.audio(Buffer.from(data));
    let m; try { m = JSON.parse(String(data)); } catch { return; }
    if (m.type === 'stop') end('stopped');
  });
  ws.on('close', () => end('the caller hung up'));
}

/** A turn as the panel's person, answered with its text (the floating chat's own conversation by default). */
function askAsPanel({ sessionId, client }) {
  const agent = require('../harness/agent');
  return request => new Promise((resolve, reject) => {
    const opts = { message: request, sessionId, client };
    const r = agent.send(opts, { onAnswer: x => resolve(x?.text), start: () => agent.turn(opts).then(x => resolve(x?.text), reject) });
    if (r && typeof r.then === 'function') r.then(x => resolve(x?.text), reject);
  });
}

/** A turn as a paired device (api-v1/harness.post), answered with its text from the bus. */
function askAsDevice(device, sessionId) {
  const bus = require('../api-v1/bus'), harness = require('../api-v1/harness');
  return request => new Promise((resolve, reject) => {
    let turnId = null;
    const timer = setTimeout(() => { bus.emitter.off('event', hear); resolve('No answer after 10 minutes; the work may still be running in the conversation.'); }, 10 * 60 * 1000);
    const hear = (deviceId, env) => {
      if (deviceId !== device.id || env.type !== 'agent.turn' || env.payload?.turnId !== turnId || env.payload.state === 'started') return;
      clearTimeout(timer); bus.emitter.off('event', hear);
      if (env.payload.state === 'done') resolve(env.payload.text);
      else reject(new Error(env.payload.state === 'cancelled' ? 'it was stopped' : env.payload.error?.message || 'the turn failed'));
    };
    bus.emitter.on('event', hear);
    try { ({ turnId } = harness.post({ message: request, sessionId, voice: device.kind === 'watch' ? 'assistant' : 'call' }, device)); }   // spoken: a watch is assistant mode
    catch (e) { clearTimeout(timer); bus.emitter.off('event', hear); reject(e); }
  });
}

module.exports = { ADAPTERS, TOOL, INSTRUCTIONS, settings, on, status, callStatus, target, serve, askAsPanel, askAsDevice };

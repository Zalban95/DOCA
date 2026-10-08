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
 * from the hub FRAMES below, from the client {type: 'stop'}.
 */
const ADAPTERS = { openai: require('./openai'), gemini: require('./gemini') };

const MAX_SAY = 4000;
/** A device's call with nothing said either way this long is ended: a watch that left its call screen keeps the socket
 *  open, sending silence, and held a call (and so a restart, harness/drain.js) for an hour on 2026-10-08. */
const idleEndMs = () => Number(process.env.DOCA_CALL_IDLE_MS) || 5 * 60 * 1000;   // the variable: tests

/**
 * The JSON frames a call sends, and what each carries — the contract a client draws its states from (PROTOCOL.md
 * §23.1; docs/api/fixtures/call-frames.json is written from this). `heard`, `background` and `report` since 2.304.0.
 */
const FRAMES = {
  ready:       { fields: ['protocol', 'model', 'sessionId'], means: 'the call is open: listening' },
  heard:       { fields: [], means: 'speech just ended and is being written down (the pipeline only)' },
  user:        { fields: ['text'], means: 'what the person was heard to say' },
  working:     { fields: ['text'], means: 'a request handed to the hive; its answer is being made' },
  agent:       { fields: ['text'], means: 'words of the answer as they are spoken' },
  done:        { fields: [], means: 'an answer finished: listening again' },
  background:  { fields: ['text', 'sessionId'], means: 'work goes on out of the call (a work chat, or a request past realtime.waitSec); it will be said here when it ends' },
  report:      { fields: ['text'], means: 'something that went on out of the call came back, and is said now (agent frames follow)' },
  interrupted: { fields: [], means: 'the person talked over the answer: drop audio queued to play' },
  notice:      { fields: ['stage', 'text'], means: 'a stage did not go as it should — nothing heard, no words found, the transcriber or the voice failed, an answer cut — said in words to show (since 2.314.0)' },
  error:       { fields: ['message'], means: 'something failed, in words' },
  closed:      { fields: ['reason', 'stats'], means: 'the call ended' },
};
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

/** The address and key: the setting's URL, else derived from the provider (Field → API keys holds the key). */
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
const _live = new Map();   // the calls being served now: a restart waits for them (harness/drain.js)
let _liveN = 0;
/** The calls in progress, for drain.busy(). */
const live = () => [..._live.values()];

function serve(ws, { ask, sessionId, onEnd = () => {}, engine = 'realtime', person = null, deviceId = null, label = 'a call' }) {
  const s = settings();
  const tell = o => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
  const pipeline = engine === 'auto' && !on();   // a device's call: the hive's own voice when no realtime model is on
  if (!pipeline && !on()) { tell({ type: 'error', message: 'Realtime voice is off: switch on the experiment and set realtime.model (Settings → Voice → Live call).' }); ws.close(); return; }
  let t;
  if (!pipeline) { try { t = target(s); } catch (e) { tell({ type: 'error', message: e.message }); ws.close(); return; } }
  const stats = { at: Date.now(), firstAudioMs: null, spokeAt: null, replyMs: [], tools: 0, background: 0, interrupted: 0, reports: 0 };
  let heardAt = null;   // when the last utterance ended, until its answer's first audio: replyMs, end of speech → first audio
  // The hub's own voice speaks a device's call in its Live call voice (call-voices.js): the device's screen's, its person's, the hive's.
  const model = pipeline ? require('./pipeline').connect({ voice: require('../call-voices').forDevice(deviceId) })
    : ADAPTERS[s.protocol].connect({ ...t, model: s.model, voice: s.voice, dialect: s.dialect, instructions: INSTRUCTIONS + recent(sessionId), tools: [TOOL] });
  if (pipeline) s.protocol = 'pipeline';
  // Each stage of this call, kept (call-log.js): a call that fails is never only a quiet call.
  const log = require('./call-log').begin({ kind: 'device', label, sessionId, person, deviceId, engine: s.protocol });
  const notify = (stage, text) => { log.notice(stage, text); tell({ type: 'notice', stage, text }); };
  let ended = false, lastWords = Date.now(), answering = 0, idle = null;
  const callId = ++_liveN;
  _live.set(callId, { sessionId, since: stats.at });
  // What lands in this conversation while the call is open is said here (calls.js), and work handed off is followed.
  const notice = (text, title) => {
    if (ended) return;
    stats.reports++;
    tell({ type: 'report', text: String(title || '').slice(0, 200) });
    model.say(model.literal ? text : `Tell the person briefly, this just came back${title ? ` (${title})` : ''}: ${text}`);
  };
  const unregister = require('./calls').open(sessionId, { person, deviceId, notice });
  const onTurnEvent = e => {
    if (e.type !== 'handoff' || e.from !== sessionId) return;
    stats.background++;
    require('./calls').follow(sessionId, e.sessionId);
    tell({ type: 'background', text: String(e.title || '').slice(0, 200), sessionId: e.sessionId });
  };
  const lifecycle = require('../harness/turn/lifecycle');
  lifecycle.events.on('event', onTurnEvent);
  const end = why => {
    if (ended) return; ended = true;
    _live.delete(callId);
    unregister();
    lifecycle.events.off('event', onTurnEvent);
    model.close();
    if (idle) clearInterval(idle);
    log.end(why);
    tell({ type: 'closed', reason: why, stats: { ...stats, minutes: Math.round((Date.now() - stats.at) / 6000) / 10 } });
    try { ws.close(); } catch { /* gone */ }
    onEnd(stats);
  };

  model.on('ready', () => {
    tell({ type: 'ready', protocol: s.protocol, model: s.model, sessionId });
    // No sound at all after a few seconds: the microphone never opened, or the phone is not passing it on.
    setTimeout(() => { if (!ended && !log.record.audio.bytes) notify('audio', 'No sound is reaching the hub from the microphone.'); }, 6000).unref?.();
  });
  model.on('utterance', u => { lastWords = Date.now(); log.utterance(u); });
  idle = pipeline ? setInterval(() => {
    if (ended || answering || Date.now() - lastWords < idleEndMs()) return;
    notify('audio', 'Nothing was said for five minutes, so the call has ended.');
    end('nothing was said for five minutes');
  }, Math.min(15000, idleEndMs() / 3)) : null;
  idle?.unref?.();
  model.on('dropped', why => log.dropped(why));
  model.on('stt', r => log.stt(r));
  model.on('notice', ({ stage, text }) => notify(stage, text));
  model.on('audio', pcm => {
    if (stats.spokeAt && stats.firstAudioMs === null) stats.firstAudioMs = Date.now() - stats.spokeAt;
    if (heardAt) { stats.replyMs = [...stats.replyMs, Date.now() - heardAt].slice(-20); heardAt = null; }
    if (ws.readyState === 1) ws.send(pcm, { binary: true });
  });
  model.on('heard', () => { heardAt = Date.now(); stats.spokeAt = stats.spokeAt || heardAt; tell({ type: 'heard' }); });
  model.on('user', text => { stats.spokeAt = stats.spokeAt || Date.now(); tell({ type: 'user', text }); });
  model.on('agent', text => { lastWords = Date.now(); log.spoken(); tell({ type: 'agent', text }); });
  model.on('turn', () => tell({ type: 'done' }));
  model.on('interrupted', () => { stats.interrupted++; heardAt = null; tell({ type: 'interrupted' }); });
  model.on('error', message => { log.note(`error: ${String(message).slice(0, 200)}`, 'error'); tell({ type: 'error', message: `${s.protocol}: ${message}` }); });
  model.on('closed', ({ code, reason }) => end(`the realtime service closed the call (${code}${reason ? `: ${reason}` : ''})`));
  model.on('tool', ({ id, name, args }) => {
    if (name !== TOOL.name) return model.toolResult(id, `There is no tool named ${name}; use doca.`);
    const request = String(args.request || '').trim();
    if (!request) return model.toolResult(id, 'Say what the person asked in the request.');
    stats.tools++; answering++;
    log.turn('started', `${request.split(/\s+/).length} words asked`);
    tell({ type: 'working', text: request });
    // The pipeline says the answer while the model is still writing it: its first sentence plays before the last exists.
    const live = model.stream ? model.stream() : null, gather = live && require('./pipeline').gatherer();
    let streamed = false, late = false;
    const onText = live && (delta => { if (late || ended) return; for (const x of gather.push(delta)) { streamed = true; live.part(x); } });
    const answer = Promise.resolve().then(() => ask(request, { ...(onText ? { onText } : {}), hubVoice: pipeline }))
      .then(a => ({ text: String(a || '(no answer)').slice(0, MAX_SAY) }), e => ({ text: `It failed: ${e.message}`, failed: true, why: e.message }));
    // How the turn ended, kept; a turn cut short is said, so the call never just goes quiet on it.
    answer.then(a => {
      answering = Math.max(0, answering - 1); lastWords = Date.now();
      if (!a.failed) return log.turn('done', `${a.text.length} characters`);
      const cut = /stopped|cancel|abort/i.test(a.why || '');
      log.turn(cut ? 'cut' : 'failed', a.why);
      if (!ended) notify('turn', cut ? 'The answer was cut short — go on, I am listening.' : `The answer failed: ${String(a.why || '').slice(0, 160)}`);
    });
    let timer;
    const wait = new Promise(r => { timer = setTimeout(() => r(null), Math.max(3, Number(s.waitSec) || 20) * 1000); });
    answer.then(() => clearTimeout(timer));
    Promise.race([answer, wait]).then(first => {
      if (first || streamed) {   // answered in time, or already being said: finish saying it
        return answer.then(a => (streamed ? live.end(`${gather.rest()}${a.failed ? ` ${a.text}` : ''}`) : model.toolResult(id, a.text)));
      }
      late = true;
      stats.background++;
      tell({ type: 'background', text: request.slice(0, 200) });
      // A model is told what to say; the pipeline says what it is given, so its words are for the listener.
      model.toolResult(id, model.literal ? 'That will take a while. I will tell you when it is done.'
        : 'Still working on it in the background. Tell the person it is under way and that you will say when it is done.');
      answer.then(a => { if (!ended) { tell({ type: 'report', text: request.slice(0, 200) }); model.say(model.literal ? a.text : `The earlier request finished ("${request.slice(0, 200)}"). DOCA's answer: ${a.text}`); } });
    });
  });

  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      const buf = Buffer.from(data);
      model.audio(buf);
      return log.audio(buf.length, model.stats ? { level: model.stats.peak, floor: model.stats.floor } : {});
    }
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

/**
 * A turn as a paired device (api-v1/harness.post), answered with its text from the bus. `onText` hears the answer as it
 * is written — the turn's own `text` events while it runs (the bus's `agent.text` is ephemeral and published only to a
 * device listening on its stream, which a call is not) — and `null` where a tool call breaks it.
 */
function askAsDevice(device, sessionId) {
  const bus = require('../api-v1/bus'), harness = require('../api-v1/harness'), turns = require('../harness/turn/lifecycle').events;
  return (request, { onText, hubVoice = false } = {}) => new Promise((resolve, reject) => {
    let turnId = null, writing = false;
    const words = e => {
      if (!writing || e.sessionId !== sessionId) return;
      if (e.type === 'text') onText(String(e.spoken ?? e.text ?? ''));   // with its tone tags: this is for the voice
      else if (e.type === 'tool_call') onText(null);
    };
    const stop = () => { clearTimeout(timer); bus.emitter.off('event', hear); if (onText) turns.off('event', words); };
    const timer = setTimeout(() => { stop(); resolve('No answer after 10 minutes; the work may still be running in the conversation.'); }, 10 * 60 * 1000);
    const hear = (deviceId, env) => {
      if (deviceId !== device.id || env.type !== 'agent.turn' || env.payload?.turnId !== turnId) return;
      if (env.payload.state === 'started') { writing = true; return; }   // ours now (or read by the turn running there)
      stop();
      if (env.payload.state === 'done') resolve(env.payload.text);
      else reject(new Error(env.payload.state === 'cancelled' ? 'it was stopped' : env.payload.error?.message || 'the turn failed'));
    };
    bus.emitter.on('event', hear);
    if (onText) turns.on('event', words);
    // Spoken: a watch is assistant mode. A device's kind is never "watch" (devices.KINDS); its paired form factor says so.
    const wrist = (device.caps?.formFactor || device.kind) === 'watch';
    try {
      const r = harness.post({ message: request, sessionId, voice: wrist ? 'assistant' : 'call', ...(hubVoice ? { [harness.HUB_SPOKEN]: true } : {}) }, device);
      turnId = r.turnId;
      writing = !r.queued;   // started already (its "started" went out before the id came back); queued: when it is read
    } catch (e) { stop(); reject(e); }
  });
}

module.exports = { live, FRAMES, ADAPTERS, TOOL, INSTRUCTIONS, settings, on, status, callStatus, target, serve, askAsPanel, askAsDevice };

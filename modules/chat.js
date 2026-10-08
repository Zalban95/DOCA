'use strict';

const { CONFIG_PATH } = require('./paths');
const { sseHeaders, loadPrefs } = require('./utils');
const catalog = require('./harness/catalog');
const agent   = require('./harness/agent');

// Module-scoped state
const chatHistory = [];

const { parseOpenclawConfig, gatewayConfig: loadGatewayChatConfig } = require('./harness/one-shot');

/** GET /api/chat/status */
function handleStatus(req, res) {
  let parseError = null, gatewayCfg = null;
  try {
    const cfg = parseOpenclawConfig();
    gatewayCfg = cfg?.gateway || null;
  } catch (e) { parseError = e.message; }

  const cfg     = loadGatewayChatConfig();
  const harness = catalog.get(catalog.defaultId());
  const adapter = harness?.kind === 'builtin' ? null : require('./harness/one-shot').adapterFor(harness);
  res.json({
    harness: harness && { id: harness.id, label: harness.label, kind: harness.kind },
    gateway: !!cfg,
    via: harness?.kind === 'builtin' ? 'builtin' : adapter?.kind || null,
    chatEnabled: harness?.kind === 'builtin' || !!adapter,
    parseError,
    gatewayCfg,
    configPath: CONFIG_PATH,
    hint: harness?.kind === 'builtin' ? `Using ${harness.label}`
      : adapter ? `Using ${harness.label} (${adapter.kind === 'gateway' ? 'its gateway' : 'one question at a time, no tools of DOCA\'s'})`
      : require('./harness/one-shot').whyNot(harness),
  });
}

/** GET /api/chat/history */
function handleHistory(req, res) {
  if (catalog.defaultId() === catalog.BUILTIN_ID) {
    const memory = require('./harness/memory');
    const messages = [];
    for (const row of memory.messages(memory.mainSession().id)) {
      if (row.role === 'user') {
        messages.push({ role: row.role, content: row.content, time: row.at,
          ...(row.attachments?.length ? { attachments: row.attachments.map(a => a.name) } : {}) });
      } else if (row.role === 'assistant' || row.role === 'tool') {
        let reply = messages.at(-1);
        if (reply?.role !== 'assistant') {
          reply = { role: 'assistant', content: '', time: row.at, working: [] };
          messages.push(reply);
        }
        if (row.role === 'assistant') {
          if (row.reasoning?.text) reply.working.push({ kind: 'thinking', body: row.reasoning.text, at: row.at });
          reply.content += row.content || '';
          for (const call of row.tool_calls || []) reply.working.push({
            kind: 'tool-call', label: call.function?.name, body: call.function?.arguments || '', at: row.at,
          });
        } else {
          reply.working.push({ kind: 'tool-result', label: row.name, body: row.content || '', at: row.at });
          if (row.images?.length) reply.images = [...(reply.images || []), ...row.images];
        }
      }
    }
    // The ring the panel draws, seeded on open. Only the built-in harness has
    // a window to report: the gateway and the CLI harnesses own their own and
    // tell us nothing, so there the ring is absent rather than drawn against a
    // number we invented.
    return res.json({ messages, sessionId: memory.mainSession().id, context: agent.contextOf(memory.mainSession().id) });   // sessionId: other screens' changes to it (H10.5)
  }
  res.json({ messages: chatHistory });
}

/** POST /api/chat/clear */
function handleClear(req, res) {
  if (catalog.defaultId() === catalog.BUILTIN_ID) require('./harness/memory').resetMain();
  chatHistory.length = 0;
  res.json({ ok: true });
}

/**
 * POST /api/chat — the floating panel's chat.
 *
 * Whichever harness is the default answers here, so the panel and the Harness
 * tab always talk to the same agent. With the built-in one selected that is
 * modules/harness/agent.js; otherwise it is the OpenClaw Gateway, falling back
 * to the `claude` CLI.
 */
/** A live call says so (chat-call.js `voice`): assistant mode — the face — answers in its own style and effort. */
function voiceClient(client, voice, req) {
  // The call's 💭 for the rest of the call, and whether it is Ambient's (turn/thinking.js modes).
  const own = { ...(['off', 'on', 'low', 'medium', 'high'].includes(req?.body?.thinking) ? { thinking: req.body.thinking } : {}), ...(req?.body?.ambient === true ? { ambient: true } : {}) };
  // The voice that will speak it — the Live call's for the face, the Deep call's for the chat's 🎙 (call-voices.js) —
  // takes a tone in words: then the agent is told it may write a few tags (voice-tags.js).
  // Ambient's assistant is assistant mode too, spoken in its own voice (`speaks: 'ambient'`, chat-call.js; call-voices.js).
  const ambient = voice === 'assistant' && req?.body?.speaks === 'ambient';
  const kind = ambient ? 'ambient' : require('./call-voices').kindOf(voice);
  const tags = kind ? require('./call-voices').forRequest(req, kind).tags : false;
  if (voice === 'assistant') return { ...client, ...own, mode: 'assistant', name: ambient ? 'Ambient’s assistant (spoken)' : 'Live call (the face, spoken)', ...(tags ? { voiceTags: true } : {}) };
  if (voice === 'call') return { ...client, ...own, mode: 'call', name: `${client.name || 'The panel'} — Deep call`, ...(tags ? { voiceTags: true } : {}) };
  return client;
}

async function handleChat(req, res) {
  const { message, attachments: attached } = req.body;
  if (!message) return res.status(400).json({ error: 'No message' });
  chatHistory.push({
    role: 'user', content: message, time: new Date().toISOString(),
    ...(Array.isArray(attached) && attached.length ? { attachments: attached } : {}),
  });

  if (catalog.defaultId() === catalog.BUILTIN_ID) {
    // res, not req: the request stream closes as soon as express.json() has
    // read the body, which would abort the turn before it started.
    const ctrl = new AbortController();
    res.on('close', () => ctrl.abort());
    const settled = require('./realtime/panel-call').turn(req, res);   // a live call's turn, in its call log
    sseHeaders(res);
    const images = [];
    try {
      // Busy (a turn in the console, say): it waits and is read mid-turn, or starts the next (send-stream.js).
      const r = await require('./harness/send-stream').sendStreamed({
        message, sessionId: require('./harness/memory').mainSession().id, client: voiceClient(require('./harness/turn/client').dashboardClient(req), req.body.voice, req),
        // Only the built-in harness understands attachments: the gateway and the claude CLI get the message alone.
        attachments: attached,
        emit: evt => {
          if (evt.type === 'text')   // `spoken`: the same piece with its tone tags, for the call's voice only (voice-tags.js)
            res.write(`data: ${JSON.stringify({ type: 'text', text: evt.text, ...(evt.spoken !== undefined ? { spoken: evt.spoken } : {}) })}\n\n`);
          if (evt.type === 'thinking')
            res.write(`data: ${JSON.stringify({ type: 'thinking', text: evt.text })}\n\n`);
          if (evt.type === 'tool_call')
            res.write(`data: ${JSON.stringify({ type: 'tool_call', name: evt.name, args: evt.args })}\n\n`);
          if (evt.type === 'tool_result')
            res.write(`data: ${JSON.stringify({ type: 'tool_result', name: evt.name, result: evt.result })}\n\n`);
          if (evt.type === 'form_fill')   // the agent filling a form on this screen as a draft (agent-ui/form-help.js)
            res.write(`data: ${JSON.stringify({ type: 'form_fill', form: evt.form, fields: evt.fields })}\n\n`);
          if (evt.type === 'image') {
            images.push(evt.image);
            res.write(`data: ${JSON.stringify({ type: 'image', image: evt.image })}\n\n`);
          }
          // Forwarded whole: `usage` is `budget.report()`, the object the console draws; `approval` is the card
          // a Manual-mode turn blocks on, and `warning` the budget and cut-off notices — both were dropped here,
          // so a turn from this chat waited five minutes on a question nobody could see (audit 2026-10-04).
          if (['usage', 'approval', 'warning', 'queued', 'queued_read', 'queued_started', 'user_added', 'handoff'].includes(evt.type)) res.write(`data: ${JSON.stringify(evt)}\n\n`);
          // Silence, and the end of it. A provider that has the request and has
          // not started answering looks exactly like a frozen page, and a hop
          // down the fallback chain is the one event the user must not miss:
          // the answer that follows came from a different model than the one
          // they chose. Forwarded rather than filtered to text and tools,
          // because a switch nobody is told about is worse than the outage it
          // was covering for.
          if (evt.type === 'waiting')
            res.write(`data: ${JSON.stringify({ type: 'waiting', provider: evt.provider,
              seconds: evt.seconds, frames: evt.frames, timeoutMs: evt.timeoutMs })}\n\n`);
          if (evt.type === 'failover')
            res.write(`data: ${JSON.stringify({ type: 'failover', text: evt.text,
              toModel: evt.toModel, remaining: evt.remaining })}\n\n`);
        },
        signal: ctrl.signal,
      }, { res, emit: evt => res.write(`data: ${JSON.stringify(evt)}\n\n`) });
      const text = req.body.voice ? require('./voice-tags').strip(r?.text) : r?.text;   // a spoken answer's tone tags are not words to keep
      if (text || images.length) chatHistory.push({
        role: 'assistant', content: text || '', time: new Date().toISOString(),
        ...(images.length ? { images } : {}),
      });
      settled(true);
      res.write(`data: ${JSON.stringify({ type: 'done', code: 0 })}\n\n`);
    } catch (e) {
      if (!ctrl.signal.aborted) settled(false, e.message);
      res.write(`data: ${JSON.stringify({ type: 'stderr', text: e.message })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'done', code: 1 })}\n\n`);
    }
    return res.end();
  }

  // Another harness is the default (TODO H11.1): asked the way it says it can be (harness/one-shot.js) — its gateway,
  // or its own one-question mode by argv. Someone else's agent acting on this machine: a host's chat only.
  sseHeaders(res);
  const say = o => res.write(`data: ${JSON.stringify(o)}\n\n`);
  const row = catalog.get(catalog.defaultId());
  const shot = require('./harness/one-shot');
  const adapter = shot.adapterFor(row);
  if (!adapter || !require('./auth/rights').can(req.auth?.role, 'host')) {
    say({ type: 'stderr', text: adapter ? `${row.label} is an agent acting on this machine with its own permissions: only a host can chat with it here. Ask the host, or use DOCA's own agent.` : shot.whyNot(row) });
    say({ type: 'done', code: 1 });
    return res.end();
  }
  const ctrl = new AbortController();
  res.on('close', () => ctrl.abort());
  try {
    const history = chatHistory.filter(m => m.role === 'user' || m.role === 'assistant').map(m => ({ role: m.role, content: m.content }));
    const r = await shot.ask(adapter, { message, history, signal: ctrl.signal, onText: text => say({ type: 'text', text }), onErr: text => say({ type: 'stderr', text }) });
    if (r.error) say({ type: 'stderr', text: r.error });
    if (r.text) chatHistory.push({ role: 'assistant', content: r.text, time: new Date().toISOString() });
    say({ type: 'done', code: r.code });
  } catch (e) {
    if (e.name !== 'AbortError') say({ type: 'stderr', text: `${row.label}: ${e.message}` });
    say({ type: 'done', code: 1 });
  }
  res.end();
}

/* ── Voice call helpers ───────────────────────────────── */

function loadVoiceServices() {
  const prefs = loadPrefs();
  const vs = prefs.voiceServices || {};
  return {
    sttUrl:   (process.env.DOCA_STT_URL || vs.sttUrl || 'http://localhost:8000').replace(/\/+$/, ''),
    sttModel: vs.sttModel  || 'whisper-1',
    ttsUrl:   (process.env.DOCA_TTS_URL || vs.ttsUrl || 'http://localhost:8880').replace(/\/+$/, ''),
    ttsModel: vs.ttsModel  || 'kokoro',
    ttsVoice: vs.ttsVoice  || 'af_heart',
    ttsSpeed: parseFloat(vs.ttsSpeed) || 1.0,
  };
}

/** GET /api/chat/call-status — check if STT + TTS services are reachable */
async function handleCallStatus(req, res) {
  const vs = loadVoiceServices();
  const check = async (url) => {
    try {
      const r = await fetch(`${url}/v1/models`, { signal: AbortSignal.timeout(3000) });
      return r.ok;
    } catch { return false; }
  };
  const [stt, tts] = await Promise.all([check(vs.sttUrl), check(vs.ttsUrl)]);
  res.json({ stt, tts, sttUrl: vs.sttUrl, ttsUrl: vs.ttsUrl });
}

// Speech → text lives in stt.js; chat.transcribeAudio and chat.transcribeHeard stay the names callers use.
const { transcribeAudio, transcribeHeard } = require('./stt');

/**
 * A speech service that is not there, in words a person can act on (deep test A, #9): a voice note answered a bare
 * 500 "TTS request failed: fetch failed", and nothing in the chat. Nothing answering at the address is a 503 that
 * says where to set one up; any other failure keeps its own words.
 */
const NOT_THERE = /fetch failed|ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|EAI_AGAIN|ETIMEDOUT|timed? ?out|aborted due to timeout/i;
const NO_SPEECH = 'No speech service: set one up in Settings → Voice.';
function speechDown(res, e, what, url) {
  const code = String(e?.cause?.code || '');
  if (!NOT_THERE.test(`${e?.message || ''} ${code}`)) return false;
  res.status(503).json({ error: `${NO_SPEECH} (${what} at ${url} does not answer.)`, code: 'no_speech_service' });
  return true;
}

/** POST /api/chat/transcribe — proxy audio to configured STT service */
async function handleTranscribe(req, res) {
  if (!req.file) return res.status(400).json({ error: 'No audio file' });
  try {
    const t0 = Date.now();
    // prompt: a wake word's spelling; the language this screen chose, else the person's usual one (call-language.js)
    const { language, usual } = require('./call-language').forRequest(req);
    const got = await transcribeHeard(req.file.buffer, req.file.mimetype, req.file.originalname, { prompt: req.body?.prompt, language, usual });
    require('./realtime/panel-call').heard(req, { ...got, ms: Date.now() - t0 });   // a live call's recording, in its call log
    res.json({ text: got.text, ...(got.filtered ? { screened: true } : {}), ...(got.language ? { language: got.language } : {}) });
  } catch (e) {
    require('./realtime/panel-call').heard(req, { error: e.message });
    if (!e.status && speechDown(res, e, 'speech-to-text', loadVoiceServices().sttUrl)) return;
    res.status(e.status && e.status >= 400 ? e.status : 500).json({ error: e.status ? e.message : `STT request failed: ${e.message}` });
  }
}

/**
 * GET /api/chat/voices[?engine=] — a speech engine's voices, for a screen to pick from (the hive's when none is named),
 * and the engines it can pick between: the hive's, and each speech service of the Services tab while it runs.
 */
async function handleVoices(req, res) {
  const engines = require('./tts-engines');
  const host = require('./auth/rights').can(req.auth?.role, 'host');
  const engine = engines.forVoice({ engine: String(req.query?.engine || '') });
  // A voice from a service lists its voices by name too; and every service is offered, with how to set it up (hosted-voices/).
  const named = engine.hosted ? await require('./tts-voices').named(engine, { host }) : null;
  res.json({ voices: named ? named.map(v => v.id) : await require('./tts-voices').list(engine), ...(named ? { names: Object.fromEntries(named.map(v => [v.id, v.name])) } : {}),
    hive: loadVoiceServices().ttsVoice, engine: engine.id, default: engine.ttsVoice, engines: await engines.available({ host }),
    hosted: require('./hosted-voices').list({ host }), host });
}

/** A voice from a service (hosted-voices/): the hub calls it with the kept key, the screen gets only the audio. */
async function sendHosted(res, engine, text, opts) {
  const out = await require('./hosted-voices').speak(engine, text, opts).catch(e => ({ error: e }));
  if (out.error) return res.status(out.error.status >= 400 && out.error.status < 600 ? out.error.status : 502).json({ error: out.error.message });
  if (out.empty) return res.status(204).end();
  res.setHeader('Content-Type', out.type);
  res.send(out.buf);
}

/** The voice a ▶ tries: an engine by id, its voice and speed, a service's model and options (only those fields). */
function tried({ engine, voice, speed, hosted }) {
  const h = hosted && typeof hosted === 'object' ? Object.fromEntries(['model', 'style', 'stability', 'language'].filter(k => hosted[k] !== undefined).map(k => [k, hosted[k]])) : undefined;
  return { engine: require('./tts-engines').forVoice({ engine: String(engine).slice(0, 80), ...(h ? { hosted: h } : {}) }),
    voice: String(voice || '').slice(0, 120), speed: Number(speed) > 0 ? Math.min(4, Number(speed)) : null };
}

/** POST /api/chat/synthesize — proxy text to configured TTS service, return audio */
async function handleSynthesize(req, res) {
  const { text, voice, call } = req.body;
  if (!text) return res.status(400).json({ error: 'No text' });
  // `call`: which kind of call speaks (quick: the face; ambient: Ambient's assistant; deep: the chat's 🎙) — its own
  // voice when one was chosen, else this screen's own voice, else the hive's (call-voices.js). No call: this screen's
  // voice, as before. `engine` (with `voice`, `speed`, `hosted`): a voice being tried before it is saved — the ▶ beside
  // each voice on Settings → Voice. It reaches nothing a screen could not choose: a service's key is still the hub's to
  // use only for whom it was opened (hosted-voices keys.apply).
  const engines = require('./tts-engines');
  const mine = typeof req.body.engine === 'string' ? tried(req.body)
    : require('./call-voices').forRequest(req, require('./call-voices').kindOf(call));
  const vs = mine.engine;                             // the hive's speech service, or the speech service it chose

  try {
    // A voice DOCA stopped for being idle starts again; the page says so and asks once more (service-life/demand.js).
    const up = vs.hosted ? { state: 'off' } : await require('./service-life').ensure(vs.ttsUrl, { wait: false, role: 'speech' });
    if (up.state === 'starting') { res.setHeader('Retry-After', '3'); return res.status(503).json({ starting: true, notice: up.notice, error: up.notice }); }
    const host = require('./auth/rights').can(req.auth?.role, 'host');
    const chosen = await require('./tts-voices').resolve(voice || mine.voice, vs, { host });   // "Heart" → af_heart; unknown → the engine's own
    if (chosen.fellBack) res.setHeader('X-Doca-Voice-Fallback', `${voice || mine.voice} -> ${chosen.voice}`);
    if (vs.hosted) return sendHosted(res, vs, text, { voice: chosen.voice, speed: mine.speed, host });
    const sent = engines.body(vs, text, { voice: chosen.voice, speed: mine.speed });   // tags as words, or dropped
    if (!sent.input) return res.status(204).end();   // nothing but tags: nothing to say
    const resp = await require('./service-life').use(vs.ttsUrl, () => fetch(`${vs.ttsUrl}/v1/audio/speech`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sent),
      signal: AbortSignal.timeout(30000),
    }));
    if (!resp.ok) return res.status(resp.status).json({ error: `TTS error ${resp.status}: ${(await resp.text()).slice(0, 300)}` });
    res.setHeader('Content-Type', resp.headers.get('content-type') || 'audio/mpeg');
    res.send(Buffer.from(await resp.arrayBuffer()));
  } catch (e) {
    if (speechDown(res, e, 'text-to-speech', vs.ttsUrl || 'its address')) return;
    res.status(500).json({ error: `TTS request failed: ${e.message}` });
  }
}

module.exports = {
  handleStatus, handleHistory, handleClear, handleChat,
  handleCallStatus, handleTranscribe, handleSynthesize, handleVoices,
  loadGatewayChatConfig, loadVoiceServices, transcribeAudio, transcribeHeard, voiceClient, NO_SPEECH,
};

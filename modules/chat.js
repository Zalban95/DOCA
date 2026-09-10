'use strict';

const fs = require('fs');
const { spawn } = require('child_process');

const { CONFIG_PATH, WORKSPACE_DIR } = require('./paths');
const { sseHeaders, loadPrefs, resolveEnvVars } = require('./utils');
const catalog = require('./harness/catalog');
const agent   = require('./harness/agent');

// Module-scoped state
const chatHistory = [];

/** Parse openclaw.json tolerantly (strip control chars and trailing commas) */
function parseOpenclawConfig() {
  const raw = fs.readFileSync(CONFIG_PATH, 'utf8')
    .replace(/[\x00-\x1F\x7F]/g, ' ')
    .replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(raw);
}

/** Load gateway URL + auth from openclaw.json for chat completions */
function loadGatewayChatConfig() {
  try {
    const cfg = parseOpenclawConfig();
    const gw = cfg?.gateway || {};
    const http = gw?.http || {};
    const endpoints = http?.endpoints || {};
    const chatEp = endpoints?.chatCompletions || {};
    if (!chatEp.enabled) return null;

    let url;
    const envUrl = process.env.OPENCLAW_GATEWAY_URL;
    if (envUrl) {
      url = envUrl.replace(/\/$/, '') + '/v1/chat/completions';
    } else {
      const port = process.env.OPENCLAW_GATEWAY_PORT || gw?.port || 18789;
      const host = '127.0.0.1';
      url = `http://${host}:${port}/v1/chat/completions`;
    }

    const token = resolveEnvVars(gw?.auth?.token || gw?.auth?.password || '');
    return { url, token: token || null };
  } catch { return null; }
}

/** GET /api/chat/status */
function handleStatus(req, res) {
  let parseError = null, gatewayCfg = null;
  try {
    const cfg = parseOpenclawConfig();
    gatewayCfg = cfg?.gateway || null;
  } catch (e) { parseError = e.message; }

  const cfg     = loadGatewayChatConfig();
  const harness = catalog.get(catalog.defaultId());
  res.json({
    harness: harness && { id: harness.id, label: harness.label, kind: harness.kind },
    gateway: !!cfg,
    chatEnabled: !!cfg || harness?.kind === 'builtin',
    parseError,
    gatewayCfg,
    configPath: CONFIG_PATH,
    hint: harness?.kind === 'builtin'
      ? `Using the ${harness.label}`
      : cfg ? 'Using OpenClaw Gateway' : 'Enable gateway.http.endpoints.chatCompletions in openclaw.json'
  });
}

/** GET /api/chat/history */
function handleHistory(req, res) {
  res.json({ messages: chatHistory });
}

/** POST /api/chat/clear */
function handleClear(req, res) {
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
async function handleChat(req, res) {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'No message' });
  chatHistory.push({ role: 'user', content: message, time: new Date().toISOString() });

  if (catalog.defaultId() === catalog.BUILTIN_ID) {
    // res, not req: the request stream closes as soon as express.json() has
    // read the body, which would abort the turn before it started.
    const ctrl = new AbortController();
    res.on('close', () => ctrl.abort());
    sseHeaders(res);
    try {
      const { text } = await agent.turn({
        message,
        emit: evt => {
          // The panel renders plain text; tool activity shows as a one-line note
          // so a long silence while a tool runs does not look like a hang.
          if (evt.type === 'text')      res.write(`data: ${JSON.stringify({ type: 'text', text: evt.text })}\n\n`);
          if (evt.type === 'tool_call') res.write(`data: ${JSON.stringify({ type: 'text', text: `\n· ${evt.name}\n` })}\n\n`);
        },
        signal: ctrl.signal,
      });
      if (text) chatHistory.push({ role: 'assistant', content: text, time: new Date().toISOString() });
      res.write(`data: ${JSON.stringify({ type: 'done', code: 0 })}\n\n`);
    } catch (e) {
      res.write(`data: ${JSON.stringify({ type: 'stderr', text: `Harness error: ${e.message}` })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'done', code: 1 })}\n\n`);
    }
    return res.end();
  }

  const gw = loadGatewayChatConfig();
  sseHeaders(res);

  if (gw?.url) {
    const messages = chatHistory
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({ role: m.role, content: m.content }));

    try {
      const controller = new AbortController();
      res.on('close', () => controller.abort());

      const headers = {
        'Content-Type': 'application/json',
        'x-openclaw-agent-id': 'main'
      };
      if (gw.token) headers['Authorization'] = `Bearer ${gw.token}`;

      const resp = await fetch(gw.url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: 'openclaw',
          stream: true,
          messages
        }),
        signal: controller.signal
      });

      if (!resp.ok) {
        const err = await resp.text();
        throw new Error(`Gateway ${resp.status}: ${err.slice(0, 200)}`);
      }

      let response = '';
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;
            try {
              const obj = JSON.parse(data);
              const content = obj?.choices?.[0]?.delta?.content;
              if (content) {
                response += content;
                res.write(`data: ${JSON.stringify({ type: 'text', text: content })}\n\n`);
              }
            } catch {}
          }
        }
      }

      if (response) chatHistory.push({ role: 'assistant', content: response, time: new Date().toISOString() });
      res.write(`data: ${JSON.stringify({ type: 'done', code: 0 })}\n\n`);
      res.end();
      return;
    } catch (e) {
      console.error('[chat] gateway error:', e.message);
      res.write(`data: ${JSON.stringify({ type: 'stderr', text: `Gateway error: ${e.message}\nFalling back to claude CLI…\n` })}\n\n`);
    }
  } else {
    console.warn('[chat] gateway chat not configured or chatCompletions not enabled');
  }

  /* Fallback: claude CLI */
  let clauDeAvailable = false;
  try {
    const test = spawn('which', ['claude']);
    await new Promise(resolve => test.on('close', code => { clauDeAvailable = code === 0; resolve(); }));
  } catch {}

  if (!clauDeAvailable) {
    res.write(`data: ${JSON.stringify({ type: 'stderr', text: 'Chat not available: Gateway unreachable and claude CLI not installed.\nCheck gateway config or install claude CLI.' })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: 'done', code: 1 })}\n\n`);
    res.end();
    return;
  }

  const child = spawn('claude', ['-p', message], {
    cwd: WORKSPACE_DIR,
    env: { ...process.env, TERM: 'dumb' }
  });
  let response = '';
  child.on('error', err => {
    console.error('[chat] claude spawn error:', err.message);
    res.write(`data: ${JSON.stringify({ type: 'stderr', text: `claude CLI error: ${err.message}` })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: 'done', code: 1 })}\n\n`);
    res.end();
  });
  child.stdout.on('data', d => {
    const text = d.toString();
    response += text;
    res.write(`data: ${JSON.stringify({ type: 'text', text })}\n\n`);
  });
  child.stderr.on('data', d => res.write(`data: ${JSON.stringify({ type: 'stderr', text: d.toString() })}\n\n`));
  child.on('close', code => {
    if (response) chatHistory.push({ role: 'assistant', content: response, time: new Date().toISOString() });
    res.write(`data: ${JSON.stringify({ type: 'done', code })}\n\n`);
    res.end();
  });
  req.on('close', () => child.kill());
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

/**
 * Transcribe an audio buffer via the configured STT service.
 * Shared by the legacy chat endpoint and the /api/v1 voice escape hatch.
 * @returns {Promise<string>} transcript text
 */
async function transcribeAudio(buffer, mimetype, filename) {
  const vs = loadVoiceServices();
  const formData = new FormData();
  formData.append('file', new Blob([buffer], { type: mimetype || 'audio/webm' }), filename || 'audio.webm');
  formData.append('model', vs.sttModel);

  const resp = await fetch(`${vs.sttUrl}/v1/audio/transcriptions`, {
    method: 'POST',
    body: formData,
    signal: AbortSignal.timeout(30000),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw Object.assign(new Error(`STT error ${resp.status}: ${err.slice(0, 300)}`), { status: resp.status });
  }
  const data = await resp.json();
  return data.text || '';
}

/** POST /api/chat/transcribe — proxy audio to configured STT service */
async function handleTranscribe(req, res) {
  if (!req.file) return res.status(400).json({ error: 'No audio file' });
  try {
    const text = await transcribeAudio(req.file.buffer, req.file.mimetype, req.file.originalname);
    res.json({ text });
  } catch (e) {
    res.status(e.status && e.status >= 400 ? e.status : 500).json({ error: e.status ? e.message : `STT request failed: ${e.message}` });
  }
}

/** POST /api/chat/synthesize — proxy text to configured TTS service, return audio */
async function handleSynthesize(req, res) {
  const { text, voice } = req.body;
  if (!text) return res.status(400).json({ error: 'No text' });
  const vs = loadVoiceServices();

  try {
    const resp = await fetch(`${vs.ttsUrl}/v1/audio/speech`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: vs.ttsModel,
        input: text,
        voice: voice || vs.ttsVoice,
        response_format: 'mp3',
        speed: vs.ttsSpeed,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!resp.ok) {
      const err = await resp.text();
      return res.status(resp.status).json({ error: `TTS error ${resp.status}: ${err.slice(0, 300)}` });
    }

    const contentType = resp.headers.get('content-type') || 'audio/mpeg';
    res.setHeader('Content-Type', contentType);
    const arrayBuf = await resp.arrayBuffer();
    res.send(Buffer.from(arrayBuf));
  } catch (e) {
    res.status(500).json({ error: `TTS request failed: ${e.message}` });
  }
}

module.exports = {
  handleStatus, handleHistory, handleClear, handleChat,
  handleCallStatus, handleTranscribe, handleSynthesize,
  loadGatewayChatConfig, loadVoiceServices, transcribeAudio,
};

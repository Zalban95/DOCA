'use strict';

const fs = require('fs');
const { spawn } = require('child_process');

const { CONFIG_PATH, WORKSPACE_DIR } = require('./paths');
const { sseHeaders, loadPrefs } = require('./utils');

// Module-scoped state
const chatHistory = [];

/** Resolve ${VAR} in string from process.env */
function resolveEnvVars(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/\$\{([^}]+)\}/g, (_, name) => process.env[name] ?? '');
}

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

  const cfg = loadGatewayChatConfig();
  res.json({
    gateway: !!cfg,
    chatEnabled: !!cfg,
    parseError,
    gatewayCfg,
    configPath: CONFIG_PATH,
    hint: cfg ? 'Using OpenClaw Gateway' : 'Enable gateway.http.endpoints.chatCompletions in openclaw.json'
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

/** POST /api/chat — main chat endpoint (gateway -> claude CLI fallback) */
async function handleChat(req, res) {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'No message' });
  chatHistory.push({ role: 'user', content: message, time: new Date().toISOString() });

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
    sttUrl:   (vs.sttUrl   || 'http://localhost:8000').replace(/\/+$/, ''),
    sttModel: vs.sttModel  || 'whisper-1',
    ttsUrl:   (vs.ttsUrl   || 'http://localhost:8880').replace(/\/+$/, ''),
    ttsModel: vs.ttsModel  || 'kokoro',
    ttsVoice: vs.ttsVoice  || 'af_heart',
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

/** POST /api/chat/transcribe — proxy audio to configured STT service */
async function handleTranscribe(req, res) {
  if (!req.file) return res.status(400).json({ error: 'No audio file' });
  const vs = loadVoiceServices();

  try {
    const formData = new FormData();
    formData.append('file', new Blob([req.file.buffer], { type: req.file.mimetype }), req.file.originalname || 'audio.webm');
    formData.append('model', vs.sttModel);

    const resp = await fetch(`${vs.sttUrl}/v1/audio/transcriptions`, {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(30000),
    });

    if (!resp.ok) {
      const err = await resp.text();
      return res.status(resp.status).json({ error: `STT error ${resp.status}: ${err.slice(0, 300)}` });
    }

    const data = await resp.json();
    res.json({ text: data.text || '' });
  } catch (e) {
    res.status(500).json({ error: `STT request failed: ${e.message}` });
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
};

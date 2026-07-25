'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { exec } = require('child_process');

const { loadModelsPrefs, saveModelsPrefs, loadPrefs, detectBinary, streamCmd } = require('./utils');

/**
 * Known non-LLM AI tools.
 * - cmd tools are detected as binaries (custom path override via prefs);
 *   `installCmd` makes them installable from the UI.
 * - API tools (cmd:null) are detected by probing `apiUrl` (pref or default);
 *   `serviceId` links them to the matching Inference Service for startup.
 */
const KNOWN_TOOLS = [
  { id: 'whisper',        label: 'Whisper (STT)',          cmd: 'whisper',        type: 'stt',
    note: 'OpenAI Whisper CLI — local speech-to-text',
    installCmd: 'pip install --user --break-system-packages openai-whisper' },
  { id: 'faster-whisper', label: 'Faster-Whisper (STT)',   cmd: 'faster-whisper', type: 'stt',
    note: 'CTranslate2 Whisper — use the Whisper STT inference service',
    serviceId: 'whisper' },
  { id: 'kokoro',         label: 'Kokoro TTS (API)',       cmd: null,             type: 'tts',
    note: 'OpenAI-compatible TTS — run via the Kokoro inference service',
    defaultApiUrl: 'http://localhost:8880', serviceId: 'kokoro' },
  { id: 'piper',          label: 'Piper TTS',              cmd: 'piper',          type: 'tts',
    note: 'Fast local neural text-to-speech CLI',
    installCmd: 'pip install --user --break-system-packages piper-tts' },
  { id: 'stable-diffusion', label: 'Stable Diffusion (API)', cmd: null,           type: 'image',
    note: 'A1111 WebUI REST API — run via the Stable Diffusion service',
    defaultApiUrl: 'http://localhost:7860', serviceId: 'sdwebui' },
  { id: 'comfyui',        label: 'ComfyUI (API)',           cmd: null,            type: 'image',
    note: 'Node-based SD workflows — run via the ComfyUI service',
    defaultApiUrl: 'http://localhost:8188', serviceId: 'comfyui' },
];

/** Curated popular Ollama model list — used as fallback / suggestions */
const OLLAMA_POPULAR = [
  { name: 'llama3.2',       description: 'Meta Llama 3.2 — best general-purpose 3B/1B model' },
  { name: 'llama3.1',       description: 'Meta Llama 3.1 — 8B/70B/405B multilingual model' },
  { name: 'mistral',        description: 'Mistral 7B — fast efficient language model' },
  { name: 'qwen2.5',        description: 'Alibaba Qwen2.5 — strong coding & reasoning model' },
  { name: 'qwen2.5-coder',  description: 'Qwen2.5 Coder — specialised code model' },
  { name: 'gemma3',         description: "Google Gemma 3 — lightweight model" },
  { name: 'phi4',           description: 'Microsoft Phi-4 — small but capable model' },
  { name: 'phi4-mini',      description: 'Microsoft Phi-4 Mini — ultra-compact model' },
  { name: 'deepseek-r1',    description: 'DeepSeek R1 — reasoning-focused model' },
  { name: 'deepseek-coder-v2', description: 'DeepSeek Coder V2 — powerful code model' },
  { name: 'nomic-embed-text', description: 'Nomic Embed Text — embedding model' },
  { name: 'mxbai-embed-large', description: 'MixedBread large embedding model' },
  { name: 'codellama',      description: 'Meta CodeLlama — code generation model' },
  { name: 'dolphin-mistral',description: 'Dolphin Mistral — uncensored fine-tune' },
  { name: 'vicuna',         description: 'Vicuna — LLaMA fine-tune for chat' },
  { name: 'wizardlm2',      description: 'WizardLM2 — instruction following' },
  { name: 'solar',          description: 'SOLAR 10.7B — high performance Korean/English' },
  { name: 'neural-chat',    description: 'Intel Neural Chat — optimised for Intel hardware' },
  { name: 'starling-lm',    description: 'Starling — RLHF fine-tuned chat model' },
  { name: 'openchat',       description: 'OpenChat 3.5 — fine-tuned on C-RLFT data' },
  { name: 'orca-mini',      description: 'Orca Mini — small reasoning model' },
  { name: 'zephyr',         description: 'Zephyr 7B — HuggingFace RLHF model' },
  { name: 'llava',          description: 'LLaVA — vision + language model' },
  { name: 'moondream',      description: 'Moondream 2 — tiny vision model' },
  { name: 'bakllava',       description: 'BakLLaVA — Mistral+LLaVA multimodal' },
  { name: 'whisper',        description: 'Whisper — speech recognition model' },
  { name: 'all-minilm',     description: 'all-MiniLM — small fast embedding model' },
];

/** GET /api/models/settings */
function handleGetSettings(req, res) {
  res.json(loadModelsPrefs());
}

/** POST /api/models/settings */
function handlePostSettings(req, res) {
  try {
    saveModelsPrefs(req.body);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/** GET /api/models/tools — detect non-LLM tools */
async function handleGetTools(req, res) {
  const mp = loadModelsPrefs();
  const toolPrefs = mp.tools || {};

  const results = await Promise.all(KNOWN_TOOLS.map(async t => {
    const pref = toolPrefs[t.id] || {};
    let detected = false;
    let detectedPath = '';

    if (t.cmd) {
      const customPath = pref.path || '';
      if (customPath && fs.existsSync(customPath)) {
        detected = true; detectedPath = customPath;
      } else {
        const found = await detectBinary(t.cmd);
        if (found.detected) { detected = true; detectedPath = found.path; }
      }
    } else {
      const apiUrl = pref.apiUrl || t.defaultApiUrl || '';
      if (apiUrl) {
        try {
          await fetch(apiUrl, { signal: AbortSignal.timeout(2000) });
          detected = true; detectedPath = apiUrl;
        } catch {}
      }
    }

    return {
      id:                   t.id,
      label:                t.label,
      type:                 t.type,
      note:                 t.note || '',
      isApi:                !t.cmd,
      canInstall:           !!t.installCmd,
      serviceId:            t.serviceId || null,
      detected,
      path:                 pref.path    || detectedPath,
      apiUrl:               pref.apiUrl  || (!t.cmd ? t.defaultApiUrl || '' : ''),
      availableForOpenclaw: pref.available !== false && detected,
    };
  }));

  res.json({ tools: results });
}

/** POST /api/models/tools/:id/install — SSE progress */
function handleToolInstall(req, res) {
  const tool = KNOWN_TOOLS.find(t => t.id === req.params.id);
  if (!tool || !tool.installCmd) return res.status(400).json({ error: 'No install command for this tool' });
  streamCmd(res, tool.installCmd, { label: tool.label });
}

// ─── Storage tracking (model directories + free disk space) ──────────────────

const _diskCache = new Map(); // path -> { at, data }
const DISK_CACHE_TTL = 60 * 1000;

function _execOut(cmd, timeout) {
  return new Promise(resolve =>
    exec(cmd, { timeout }, (err, stdout) => resolve(err ? null : (stdout || '').trim())));
}

/** df + du for one path (cached 60 s — du can be slow on huge model dirs). */
async function _diskInfo(id, label, p) {
  const hit = _diskCache.get(p);
  if (hit && Date.now() - hit.at < DISK_CACHE_TTL) return { id, label, path: p, ...hit.data };

  if (!fs.existsSync(p)) return { id, label, path: p, exists: false };

  const data = { exists: true, mount: null, totalKB: null, usedKB: null, availKB: null, pct: null, dirSizeKB: null };

  const df = await _execOut(`df -kP "${p}"`, 5000);
  if (df) {
    const parts = df.split('\n').slice(1).join(' ').trim().split(/\s+/);
    if (parts.length >= 6) {
      data.totalKB = parseInt(parts[1], 10) || null;
      data.usedKB  = parseInt(parts[2], 10) || null;
      data.availKB = parseInt(parts[3], 10) || null;
      data.pct     = parseInt(parts[4], 10) || null;
      data.mount   = parts.slice(5).join(' ');
    }
  }

  const du = await _execOut(`du -sk "${p}"`, 15000);
  if (du) data.dirSizeKB = parseInt(du.split(/\s+/)[0], 10) || null;

  _diskCache.set(p, { at: Date.now(), data });
  return { id, label, path: p, ...data };
}

/** GET /api/models/disk — storage overview for every model location */
async function handleGetDisk(req, res) {
  if (req.query && req.query.force === '1') _diskCache.clear();
  const mp   = loadModelsPrefs();
  const home = process.env.HOME || os.homedir();

  const targets = [
    { id: 'ollama', label: 'Ollama models',     path: mp.ollamaPath || path.join(home, '.ollama') },
    { id: 'hf',     label: 'HuggingFace cache', path: mp.hf?.cacheDir || path.join(home, '.cache', 'huggingface', 'hub') },
  ];

  // Unique llama.cpp model directories (may live on separate drives)
  const instances = (loadPrefs().llamacpp || {}).instances || [];
  const seen = new Set(targets.map(t => t.path));
  instances.forEach(inst => {
    if (!inst.modelPath) return;
    const dir = path.dirname(inst.modelPath);
    if (seen.has(dir)) return;
    seen.add(dir);
    targets.push({ id: `llamacpp-${inst.id}`, label: `llama.cpp — ${inst.name || inst.id}`, path: dir });
  });

  const disks = await Promise.all(targets.map(t => _diskInfo(t.id, t.label, t.path)));
  res.json({ disks });
}

/** POST /api/models/tools/:id/config */
function handleToolConfig(req, res) {
  const { id } = req.params;
  const { path: toolPath, apiUrl, available } = req.body;
  try {
    const mp = loadModelsPrefs();
    if (!mp.tools) mp.tools = {};
    mp.tools[id] = { path: toolPath || '', apiUrl: apiUrl || '', available: !!available };
    saveModelsPrefs(mp);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

module.exports = {
  KNOWN_TOOLS,
  OLLAMA_POPULAR,
  handleGetSettings,
  handlePostSettings,
  handleGetTools,
  handleToolConfig,
  handleToolInstall,
  handleGetDisk,
};

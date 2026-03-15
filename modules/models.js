'use strict';

const fs   = require('fs');
const os   = require('os');
const { exec } = require('child_process');

const { loadPrefs, loadModelsPrefs, saveModelsPrefs } = require('./utils');

/** Known non-LLM tools with detection commands */
const KNOWN_TOOLS = [
  { id: 'whisper',        label: 'Whisper (STT)',          cmd: 'whisper',        type: 'stt'   },
  { id: 'faster-whisper', label: 'Faster-Whisper (STT)',   cmd: 'faster-whisper', type: 'stt'   },
  { id: 'kokoro',         label: 'Kokoro TTS',             cmd: 'kokoro',         type: 'tts'   },
  { id: 'piper',          label: 'Piper TTS',              cmd: 'piper',          type: 'tts'   },
  { id: 'stable-diffusion', label: 'Stable Diffusion (API)', cmd: null,           type: 'image' },
  { id: 'comfyui',        label: 'ComfyUI (API)',           cmd: null,            type: 'image' },
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
        try {
          const { stdout } = await new Promise((resolve, reject) =>
            exec(`which ${t.cmd}`, (e, o) => e ? reject(e) : resolve({ stdout: o.trim() }))
          );
          if (stdout) { detected = true; detectedPath = stdout; }
        } catch {}
      }
    } else {
      const apiUrl = pref.apiUrl || '';
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
      detected,
      path:                 pref.path    || detectedPath,
      apiUrl:               pref.apiUrl  || '',
      availableForOpenclaw: pref.available !== false && detected,
    };
  }));

  res.json({ tools: results });
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
};

'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { spawn } = require('child_process');

const { loadModelsPrefs, saveModelsPrefs, sseHeaders } = require('./utils');

const NLM_MODEL_EXTS = new Set(['.pt', '.safetensors', '.ckpt', '.bin', '.gguf', '.onnx', '.pth']);

const LOCAL_NLM_TOOLS = {
  whisper: {
    label: 'Whisper (STT)',
    models: [
      { name: 'tiny',    description: 'Tiny — fastest, lowest accuracy (~39 MB)' },
      { name: 'base',    description: 'Base — good balance of speed/accuracy (~74 MB)' },
      { name: 'small',   description: 'Small — better accuracy (~244 MB)' },
      { name: 'medium',  description: 'Medium — high accuracy (~769 MB)' },
      { name: 'large',   description: 'Large v2/v3 — best accuracy (~1.5 GB)' },
      { name: 'large-v3',description: 'Large v3 — latest, best accuracy (~1.5 GB)' },
    ],
    installCmd: (model) => `pip install --user --break-system-packages openai-whisper && python3 -c "import whisper; whisper.load_model('${model}')"`,
    detectFile: (dir, model) => path.join(dir || os.homedir(), '.cache', 'whisper', `${model}.pt`),
  },
  kokoro: {
    label: 'Kokoro TTS',
    models: [
      { name: 'kokoro-v0_19', description: 'Kokoro v0.19 — main model (~326 MB)' },
      { name: 'voices',       description: 'Voice pack (~100 MB)' },
    ],
    installCmd: (model) => `pip install --user --break-system-packages kokoro-onnx`,
    detectFile: (dir) => path.join(dir || os.homedir(), 'kokoro'),
  },
  'stable-diffusion': {
    label: 'Stable Diffusion',
    models: [
      { name: 'stable-diffusion-v1-5',    description: 'SD 1.5 — classic, widely compatible (~4 GB)' },
      { name: 'stable-diffusion-xl-base', description: 'SDXL Base — higher quality (~6.7 GB)' },
      { name: 'stable-diffusion-3',       description: 'SD 3 — latest architecture (~5 GB)' },
    ],
    installCmd: (model) => `pip install --user --break-system-packages diffusers transformers accelerate && python3 -c "from huggingface_hub import snapshot_download; snapshot_download('runwayml/${model}')"`,
    detectFile: (dir) => dir || '',
  },
  comfyui: {
    label: 'ComfyUI Models',
    models: [
      { name: 'v1-5-pruned-emaonly', description: 'SD 1.5 pruned checkpoint (~4 GB)' },
      { name: 'sdxl_base_1.0',       description: 'SDXL base checkpoint (~6.5 GB)' },
    ],
    installCmd: (model) => `wget -c https://huggingface.co/runwayml/stable-diffusion-v1-5/resolve/main/${model}.safetensors`,
    detectFile: (dir) => dir || '',
  },
};

/** GET /api/models/local/settings */
function handleGetSettings(req, res) {
  const mp = loadModelsPrefs();
  res.json(mp.local || {});
}

/** POST /api/models/local/settings */
function handlePostSettings(req, res) {
  try {
    const mp = loadModelsPrefs();
    if (!mp.local) mp.local = {};
    const { tool, modelsPath, apiUrl, configPath } = req.body;
    if (!tool) return res.status(400).json({ error: 'tool required' });
    if (!mp.local[tool]) mp.local[tool] = {};
    if (modelsPath  !== undefined) mp.local[tool].modelsPath  = modelsPath;
    if (apiUrl      !== undefined) mp.local[tool].apiUrl      = apiUrl;
    if (configPath  !== undefined) mp.local[tool].configPath  = configPath;
    saveModelsPrefs(mp);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/** GET /api/models/local/search */
function handleSearch(req, res) {
  const tool = req.query.tool || 'whisper';
  const q    = (req.query.q || '').toLowerCase().trim();
  const def  = LOCAL_NLM_TOOLS[tool];
  if (!def) return res.json({ results: [] });
  const list = def.models;
  const results = q
    ? list.filter(m => m.name.includes(q) || m.description.toLowerCase().includes(q))
    : list;
  res.json({ results });
}

/** GET /api/models/local/list */
function handleList(req, res) {
  const tool = req.query.tool || 'whisper';
  const mp   = loadModelsPrefs();
  const dir  = mp.local?.[tool]?.modelsPath || '';
  const def  = LOCAL_NLM_TOOLS[tool];
  if (!def) return res.json({ models: [] });

  const known = new Set();
  const models = def.models.map(m => {
    const filePath = def.detectFile(dir, m.name);
    const detected = filePath ? fs.existsSync(filePath) : false;
    if (detected) known.add(m.name);
    return { name: m.name, description: m.description, detected, path: filePath || '' };
  });

  if (dir && fs.existsSync(dir)) {
    try {
      fs.readdirSync(dir).forEach(f => {
        if (!NLM_MODEL_EXTS.has(path.extname(f).toLowerCase())) return;
        if (known.has(f)) return;
        models.push({ name: f, description: 'Detected on disk', detected: true, path: path.join(dir, f) });
      });
    } catch {}
  }

  res.json({ models });
}

/** POST /api/models/local/install — SSE progress */
function handleInstall(req, res) {
  const { tool, model } = req.body;
  if (!tool || !model) return res.status(400).json({ error: 'tool and model required' });
  const def = LOCAL_NLM_TOOLS[tool];
  if (!def) return res.status(400).json({ error: 'unknown tool' });

  sseHeaders(res);
  const sseWrite = d => res.write(`data: ${JSON.stringify(d)}\n\n`);

  const cmd     = def.installCmd(model);
  const home    = process.env.HOME || os.homedir();
  const nlmPath = `${home}/.local/bin:/usr/local/bin:/usr/bin:/bin`;
  const child   = spawn('bash', ['-c', `PATH="${nlmPath}:$PATH" ${cmd}`], {
    cwd: home,
    env: { ...process.env, HOME: home, PATH: `${nlmPath}:${process.env.PATH || ''}` },
  });

  sseWrite({ status: `Running: ${cmd}` });
  child.stdout.on('data', d => sseWrite({ status: d.toString() }));
  child.stderr.on('data', d => sseWrite({ status: d.toString() }));
  child.on('close', (code, signal) => {
    const ok  = code === 0;
    const msg = ok ? '✓ Done'
      : code !== null ? `✗ Exit ${code}`
      : `✗ Killed by signal (${signal || 'unknown'})`;
    sseWrite({ done: true, error: !ok, status: msg });
    res.end();
  });
  child.on('error', e => {
    sseWrite({ done: true, error: true, status: `Error: ${e.message}` });
    res.end();
  });
  res.on('close', () => { if (!child.killed) child.kill(); });
}

/** POST /api/models/local/delete */
function handleDelete(req, res) {
  const { tool, model } = req.body;
  if (!tool || !model) return res.status(400).json({ error: 'tool and model required' });
  const mp  = loadModelsPrefs();
  const dir = mp.local?.[tool]?.modelsPath || '';
  const def = LOCAL_NLM_TOOLS[tool];
  if (!def) return res.status(400).json({ error: 'unknown tool' });

  const filePath = def.detectFile(dir, model);
  if (!filePath || !fs.existsSync(filePath))
    return res.status(404).json({ error: 'File not found' });

  try {
    fs.rmSync(filePath, { recursive: true, force: true });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

module.exports = {
  handleGetSettings,
  handlePostSettings,
  handleSearch,
  handleList,
  handleInstall,
  handleDelete,
};

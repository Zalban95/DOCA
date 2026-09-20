'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const { loadModelsPrefs, saveModelsPrefs, streamCmd } = require('./utils');

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
    defaultDir: () => path.join(os.homedir(), '.cache', 'whisper'),
    fileFor: (dir, model) => path.join(dir, `${model}.pt`),
  },
  kokoro: {
    label: 'Kokoro TTS',
    models: [
      { name: 'kokoro-v0_19', description: 'Kokoro v0.19 — main model (~326 MB)' },
      { name: 'voices',       description: 'Voice pack (~100 MB)' },
    ],
    installCmd: () => `pip install --user --break-system-packages kokoro-onnx`,
    defaultDir: () => path.join(os.homedir(), 'kokoro'),
  },
  'stable-diffusion': {
    label: 'Stable Diffusion',
    models: [
      { name: 'stable-diffusion-v1-5',    description: 'SD 1.5 — classic, widely compatible (~4 GB)' },
      { name: 'stable-diffusion-xl-base', description: 'SDXL Base — higher quality (~6.7 GB)' },
      { name: 'stable-diffusion-3',       description: 'SD 3 — latest architecture (~5 GB)' },
    ],
    installCmd: (model) => `pip install --user --break-system-packages diffusers transformers accelerate && python3 -c "from huggingface_hub import snapshot_download; snapshot_download('runwayml/${model}')"`,
  },
  comfyui: {
    label: 'ComfyUI Models',
    models: [
      { name: 'v1-5-pruned-emaonly', description: 'SD 1.5 pruned checkpoint (~4 GB)' },
      { name: 'sdxl_base_1.0',       description: 'SDXL base checkpoint (~6.5 GB)' },
    ],
    installCmd: (model) => `wget -c https://huggingface.co/runwayml/stable-diffusion-v1-5/resolve/main/${model}.safetensors`,
  },
};

/**
 * Where one model sits on disk, or null when nothing there answers to that name.
 *
 * Three of the four tools used to have a `detectFile` that ignored the model
 * and returned the *directory*, which made two things wrong at once: every
 * model in the list drew as "detected" the moment the folder existed, and
 * deleting any one of them handed that folder to `rmSync(..., {recursive})` —
 * one click on one model, and the whole models directory was gone.
 *
 * So the name is resolved against what is actually in the directory: the
 * tool's own filename if it has a rule for one, otherwise a file whose base
 * name is the model. A name that resolves to nothing is not detected and
 * cannot be deleted, which is the honest answer in both directions.
 */
function modelFile(def, dir, model) {
  if (!safeModelName(model)) return null;
  const base = dir || (def.defaultDir ? def.defaultDir() : '');
  if (!base) return null;

  if (def.fileFor) {
    const exact = def.fileFor(base, model);
    if (exact && fs.existsSync(exact)) return exact;
  }
  let entries;
  try { entries = fs.readdirSync(base, { withFileTypes: true }); } catch { return null; }
  for (const e of entries) {
    if (!e.isFile()) continue;
    if (e.name === model || path.basename(e.name, path.extname(e.name)) === model)
      return path.join(base, e.name);
  }
  return null;
}

/**
 * A model name is a leaf, never a path.
 *
 * It arrives from a request body and is used two ways that both punish a
 * separator: joined onto a directory that something may then delete, and — for
 * the tools with an `installCmd` — interpolated into a shell string. `/api/models`
 * has no auth in front of it, the same fact that made `GET /api/mcp` leak bearer
 * tokens, so "the panel would never send that" is not the guarantee here.
 */
function safeModelName(model) {
  return typeof model === 'string'
    && model.length > 0 && model.length <= 128
    && /^[\w][\w.\-]*$/.test(model)
    && !model.includes('..');
}

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

  // What is on disk, by the file each catalogue entry resolved to — so a file
  // already claimed by a known model is not listed a second time under its own
  // name. The old check compared a bare model name against a filename with an
  // extension, which never matched, so every detected model appeared twice.
  const claimed = new Set();
  const models = def.models.map(m => {
    const filePath = modelFile(def, dir, m.name);
    if (filePath) claimed.add(path.resolve(filePath));
    return { name: m.name, description: m.description, detected: !!filePath, path: filePath || '' };
  });

  const scanDir = dir || (def.defaultDir ? def.defaultDir() : '');
  if (scanDir && fs.existsSync(scanDir)) {
    try {
      fs.readdirSync(scanDir).forEach(f => {
        if (!NLM_MODEL_EXTS.has(path.extname(f).toLowerCase())) return;
        const full = path.join(scanDir, f);
        if (claimed.has(path.resolve(full))) return;
        models.push({ name: f, description: 'Detected on disk', detected: true, path: full });
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

  // The install command is a shell string with the model name in it, so the
  // name has to be one this module put in the catalogue — not merely one that
  // looks harmless. The refusal lists what does exist, because a dead end is
  // worse than a no.
  if (!def.models.some(m => m.name === model)) {
    return res.status(400).json({
      error: `Unknown ${def.label} model "${model}". Installable models: ${def.models.map(m => m.name).join(', ')}`,
    });
  }

  streamCmd(res, def.installCmd(model), { label: `${def.label} — ${model}` });
}

/** POST /api/models/local/delete */
function handleDelete(req, res) {
  const { tool, model } = req.body;
  if (!tool || !model) return res.status(400).json({ error: 'tool and model required' });
  const mp  = loadModelsPrefs();
  const dir = mp.local?.[tool]?.modelsPath || '';
  const def = LOCAL_NLM_TOOLS[tool];
  if (!def) return res.status(400).json({ error: 'unknown tool' });

  const filePath = modelFile(def, dir, model);
  if (!filePath) return res.status(404).json({ error: `No file for "${model}" under ${dir || '(no models path set)'}` });

  // One file, never a tree. `recursive: true` is what turned "delete this
  // model" into "delete the models directory" for every tool whose lookup
  // returned the folder; `modelFile` cannot return a directory now, and this
  // is the second lock on the same door.
  try {
    if (fs.statSync(filePath).isDirectory())
      return res.status(400).json({ error: `Refusing to delete a directory: ${filePath}` });
    fs.rmSync(filePath, { force: true });
    res.json({ ok: true, deleted: filePath });
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

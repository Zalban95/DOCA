'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { exec, execSync, spawn } = require('child_process');

const { PREFS_FILE } = require('./paths');
const { sseHeaders, loadPrefs, loadModelsPrefs } = require('./utils');

const INFERENCE_SERVICES = [
  { id: 'whisper',  label: 'Whisper STT',     image: 'fedirz/faster-whisper-server:latest-cuda', port: 8000, internalPort: 8000, apiPath: '/v1', multiGpu: false,
    description: 'OpenAI-compatible speech-to-text API (faster-whisper, CUDA)' },
  { id: 'vllm',     label: 'vLLM (LLM)',      image: 'vllm/vllm-openai:latest',      port: 8001, internalPort: 8000, apiPath: '/v1', multiGpu: true,
    description: 'OpenAI-compatible LLM inference for HuggingFace models, multi-GPU' },
  { id: 'sdwebui',  label: 'Stable Diffusion',image: 'ghcr.io/ai-dock/stable-diffusion-webui:latest-cuda', port: 7860, internalPort: 7860, apiPath: '/sdapi/v1', multiGpu: false,
    description: 'Stable Diffusion AUTOMATIC1111 WebUI with REST API (ai-dock)' },
  { id: 'comfyui',  label: 'ComfyUI',         image: 'mmartial/comfyui-nvidia-docker:latest', port: 8188, internalPort: 8188, apiPath: '', multiGpu: false,
    description: 'Node-based Stable Diffusion workflow runner with ComfyUI-Manager' },
];

/** GET /api/services */
function handleList(req, res) {
  const prefs = loadPrefs();
  const saved = prefs.serviceSettings || {};
  res.json({ services: INFERENCE_SERVICES.map(s => ({
    id: s.id, label: s.label, image: s.image, port: s.port,
    apiPath: s.apiPath, description: s.description, multiGpu: s.multiGpu,
    savedGpu: saved[s.id]?.gpu || 'all',
    savedModelId: saved[s.id]?.modelId || '',
  })) });
}

/** POST /api/services/settings */
function handleSettings(req, res) {
  const { id, gpu, modelId } = req.body;
  if (!id) return res.status(400).json({ error: 'id required' });
  try {
    const prefs = loadPrefs();
    if (!prefs.serviceSettings) prefs.serviceSettings = {};
    prefs.serviceSettings[id] = { gpu: gpu || 'all', modelId: modelId || '' };
    fs.writeFileSync(PREFS_FILE, JSON.stringify(prefs, null, 2), 'utf8');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/** GET /api/services/status */
function handleStatus(req, res) {
  exec(`docker ps -a --filter "name=doca-" --format '{{json .}}'`, (err, stdout) => {
    const running = {};
    (stdout || '').trim().split('\n').filter(Boolean).forEach(line => {
      try {
        const c = JSON.parse(line);
        const svc = INFERENCE_SERVICES.find(s => c.Names === `doca-${s.id}`);
        if (svc) running[svc.id] = { state: c.State, status: c.Status, id: c.ID };
      } catch {}
    });
    res.json({ running });
  });
}

/** POST /api/services/start — SSE progress */
function handleStart(req, res) {
  const { id, gpu, modelId } = req.body;
  const svc = INFERENCE_SERVICES.find(s => s.id === id);
  if (!svc) return res.status(400).json({ error: 'Unknown service' });

  // Persist settings
  try {
    const prefs = loadPrefs();
    if (!prefs.serviceSettings) prefs.serviceSettings = {};
    prefs.serviceSettings[id] = { gpu: gpu || 'all', modelId: modelId || '' };
    fs.writeFileSync(PREFS_FILE, JSON.stringify(prefs, null, 2), 'utf8');
  } catch {}

  sseHeaders(res);
  const sseWrite = d => { try { res.write(`data: ${JSON.stringify(d)}\n\n`); } catch {} };

  const containerName = `doca-${id}`;
  try { execSync(`docker rm -f ${containerName} 2>/dev/null`); } catch {}

  const mp   = loadModelsPrefs();
  const home = process.env.HOME || os.homedir();
  const hfCache = mp.hf?.cacheDir || path.join(home, '.cache', 'huggingface', 'hub');
  const hfToken = mp.hf?.token || '';

  const dockerArgs = [
    'run', '-d',
    '--name', `doca-${id}`,
    '--restart', 'unless-stopped',
    '-p', `${svc.port}:${svc.internalPort}`,
  ];
  if      (gpu === 'all') dockerArgs.push('--gpus', 'all');
  else if (gpu === '0')   dockerArgs.push('--gpus', 'device=0');
  else if (gpu === '1')   dockerArgs.push('--gpus', 'device=1');

  if (id === 'vllm') {
    dockerArgs.push('-v', `${hfCache}:/root/.cache/huggingface`);
    if (hfToken) dockerArgs.push('-e', `HUGGING_FACE_HUB_TOKEN=${hfToken}`);
    dockerArgs.push(svc.image);
    if (modelId) dockerArgs.push('--model', modelId);
    if (gpu === 'all' && svc.multiGpu) dockerArgs.push('--tensor-parallel-size', '2');
  } else if (id === 'sdwebui') {
    dockerArgs.push('-v', `${hfCache}:/root/.cache/huggingface`);
    dockerArgs.push(svc.image);
    dockerArgs.push('--listen', '--api');
  } else if (id === 'comfyui') {
    const comfyDir = path.join(home, 'comfyui-data');
    try { if (!fs.existsSync(comfyDir)) fs.mkdirSync(comfyDir, { recursive: true }); } catch {}
    const uid = process.getuid ? process.getuid() : 1000;
    const gid = process.getgid ? process.getgid() : 1000;
    dockerArgs.push('-e', `WANTED_UID=${uid}`, '-e', `WANTED_GID=${gid}`);
    dockerArgs.push('-v', `${comfyDir}:/comfy/mnt`);
    dockerArgs.push('-v', `${hfCache}:/root/.cache/huggingface`);
    dockerArgs.push(svc.image);
  } else {
    dockerArgs.push(svc.image);
  }

  const cmdDisplay = `docker ${dockerArgs.join(' ')}`;
  sseWrite({ status: `Starting ${svc.label}…\n$ ${cmdDisplay}\n` });

  const child = spawn('docker', dockerArgs, { cwd: home });
  child.stdout.on('data', d => sseWrite({ status: d.toString() }));
  child.stderr.on('data', d => sseWrite({ status: d.toString() }));
  child.on('close', (code, signal) => {
    const ok  = code === 0;
    const msg = ok ? `✓ ${svc.label} started on http://localhost:${svc.port}`
      : code !== null ? `✗ Exit ${code}` : `✗ Killed (${signal || 'unknown'})`;
    sseWrite({ done: true, ok, status: msg });
    res.end();
  });
  child.on('error', e => { sseWrite({ done: true, ok: false, status: `Error: ${e.message}` }); res.end(); });
  res.on('close', () => { if (!child.killed) child.kill(); });
}

/** POST /api/services/stop */
function handleStop(req, res) {
  const { id } = req.body;
  const svc = INFERENCE_SERVICES.find(s => s.id === id);
  if (!svc) return res.status(400).json({ error: 'Unknown service' });
  exec(`docker stop doca-${id} && docker rm doca-${id}`, (err, stdout, stderr) => {
    if (err) return res.status(500).json({ error: stderr || err.message });
    res.json({ ok: true });
  });
}

module.exports = {
  handleList,
  handleSettings,
  handleStatus,
  handleStart,
  handleStop,
};

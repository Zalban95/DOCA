'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { exec, execSync, spawn } = require('child_process');

const { sseHeaders, loadPrefs, savePrefs, loadModelsPrefs } = require('./utils');

// Where each answers once it is really up: `docker run` returns as soon as the container exists, minutes before the
// application inside answers (AGENTS.md: "a start is not a service").
const READY = { roboflow: '/info', whisper: '/v1/models', kokoro: '/v1/audio/voices', vllm: '/v1/models', sdwebui: '/sdapi/v1/sd-models', comfyui: '/system_stats' };
const READY_SEC = { vllm: 900, sdwebui: 900, comfyui: 600 };

/** What a crash says, in a sentence a person can act on. */
function diagnose(log) {
  if (/no kernel image is available|sm_\d+ is not compatible|CUDA capability sm_\d+/i.test(log))
    return 'This image\'s PyTorch was not built for this GPU (it is newer than the image). Pick "No GPU (CPU)" where the service has a CPU image, or wait for a newer image.';
  if (/CUDA out of memory|OutOfMemoryError/i.test(log)) return 'The GPU ran out of memory: pick the other GPU, or stop what is using it.';
  if (/could not select device driver|nvidia-container|--gpus/i.test(log)) return 'Docker cannot reach the GPU: install the NVIDIA Container Toolkit (Settings → System → System tools).';
  if (/address already in use|port is already allocated/i.test(log)) return 'Its port is taken by another container or program: stop that one first.';
  return null;
}

/**
 * After `docker run`: wait until the service answers, or until its container keeps failing — then say why from its
 * log, and remove it, so a crash loop is not left restarting forever behind a "started".
 */
async function waitReady(svc, say) {
  const cli = require('./containers').cli();
  const name = `doca-${svc.id}`;
  const url = `http://127.0.0.1:${svc.port}${READY[svc.id] || '/'}`;
  const until = Date.now() + (READY_SEC[svc.id] || 300) * 1000;
  let restarts = 0, said = 0;
  while (Date.now() < until) {
    try { const r = await fetch(url, { signal: AbortSignal.timeout(3000) }); if (r.status < 500) return { ok: true }; } catch { /* not yet */ }
    const st = await new Promise(r => exec(`${cli} inspect ${name} --format '{{.State.Status}} {{.RestartCount}}'`, (e, out) => r(e ? 'gone 0' : String(out).trim())));
    const [state, count] = st.split(' ');
    restarts = Number(count) || 0;
    if (state === 'gone' || state === 'exited' || state === 'dead' || restarts >= 2) {
      const log = await new Promise(r => exec(`${cli} logs --tail 15 ${name}`, { maxBuffer: 1 << 20 }, (e, out, err) => r(`${out || ''}${err || ''}`.replace(/\x1b\[[0-9;]*m/g, ''))));
      await new Promise(r => exec(`${cli} rm -f ${name}`, () => r()));   // gone before the answer says so
      return { ok: false, log, why: diagnose(log) || `The container ${state === 'gone' ? 'is gone' : `stopped (${state}, restarted ${restarts}×)`} before ${svc.label} answered.` };
    }
    if (Date.now() - said > 15000) { say(`… waiting for ${svc.label} to answer on :${svc.port} (${state})\n`); said = Date.now(); }
    await new Promise(r => setTimeout(r, 2000));
  }
  return { ok: false, why: `${svc.label} did not answer on :${svc.port} within ${Math.round((READY_SEC[svc.id] || 300) / 60)} minutes; it may still be starting (see its logs in the Docker tab).` };
}

const INFERENCE_SERVICES = [
  { id: 'whisper',  label: 'Whisper STT',     image: 'fedirz/faster-whisper-server:latest-cuda', port: 8000, internalPort: 8000, apiPath: '/v1', multiGpu: false,
    description: 'OpenAI-compatible speech-to-text API (faster-whisper, CUDA)' },
  { id: 'kokoro',   label: 'Kokoro TTS',      image: 'ghcr.io/remsky/kokoro-fastapi-gpu:latest', cpuImage: 'ghcr.io/remsky/kokoro-fastapi-cpu:latest',
    port: 8880, internalPort: 8880, apiPath: '/v1', multiGpu: false,
    description: 'OpenAI-compatible text-to-speech API (Kokoro-82M) — matches the Voice tab default port' },
  { id: 'vllm',     label: 'vLLM (LLM)',      image: 'vllm/vllm-openai:latest',      port: 8001, internalPort: 8000, apiPath: '/v1', multiGpu: true,
    description: 'OpenAI-compatible LLM inference for HuggingFace models, multi-GPU' },
  { id: 'sdwebui',  label: 'Stable Diffusion',image: 'ghcr.io/ai-dock/stable-diffusion-webui:latest-cuda', port: 7860, internalPort: 7860, apiPath: '/sdapi/v1', multiGpu: false,
    description: 'Stable Diffusion AUTOMATIC1111 WebUI with REST API (ai-dock)' },
  { id: 'comfyui',  label: 'ComfyUI',         image: 'mmartial/comfyui-nvidia-docker:latest', port: 8188, internalPort: 8188, apiPath: '', multiGpu: false,
    description: 'Node-based Stable Diffusion workflow runner with ComfyUI-Manager' },
  { id: 'roboflow', label: 'Roboflow Inference', image: 'roboflow/roboflow-inference-server-gpu:latest', cpuImage: 'roboflow/roboflow-inference-server-cpu:latest',
    port: 9001, internalPort: 9001, apiPath: '', multiGpu: false,
    description: 'Open-source object detection server (any Roboflow Universe model, or your own) — a computer_look reader (vision.detectorModel)' },
];

/** Pick the image for a service given the GPU selection (CPU fallback image). */
function serviceImage(svc, gpu) {
  return gpu === '' && svc.cpuImage ? svc.cpuImage : svc.image;
}

/** GET /api/services */
function handleList(req, res) {
  const prefs = loadPrefs();
  const saved = prefs.serviceSettings || {};
  res.json({ services: INFERENCE_SERVICES.map(s => ({
    id: s.id, label: s.label, image: s.image, cpuImage: s.cpuImage || null, port: s.port,
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
    savePrefs(prefs);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/** GET /api/services/status — running containers + local image presence */
function handleStatus(req, res) {
  exec(`${require('./containers').cli()} ps -a --filter "name=doca-" --format '{{json .}}'`, (err, stdout) => {
    const running = {};
    (stdout || '').trim().split('\n').filter(Boolean).forEach(line => {
      try {
        const c = JSON.parse(line);
        const svc = INFERENCE_SERVICES.find(s => c.Names === `doca-${s.id}`);
        if (svc) running[svc.id] = { state: c.State, status: c.Status, id: c.ID };
      } catch {}
    });

    exec(`${require('./containers').cli()} images --format '{{.Repository}}:{{.Tag}}'`, { timeout: 5000 }, (imgErr, imgOut) => {
      const local  = new Set((imgOut || '').trim().split('\n').filter(Boolean));
      const images = {};
      INFERENCE_SERVICES.forEach(s => {
        images[s.id] = {
          image:   s.image,
          present: local.has(s.image) || (s.cpuImage ? local.has(s.cpuImage) : false),
        };
      });
      res.json({ running, images });
    });
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
    savePrefs(prefs);
  } catch {}

  sseHeaders(res);
  const sseWrite = d => { try { res.write(`data: ${JSON.stringify(d)}\n\n`); } catch {} };

  const containerName = `doca-${id}`;
  try { execSync(`docker rm -f ${containerName} 2>/dev/null`); } catch {}

  const mp   = loadModelsPrefs();
  const home = process.env.HOME || os.homedir();
  const hfCache = mp.hf?.cacheDir || path.join(home, '.cache', 'huggingface', 'hub');
  const hfToken = mp.hf?.token || '';
  const image   = serviceImage(svc, gpu); // CPU-only fallback image when no GPU selected

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
    dockerArgs.push(image);
    if (modelId) dockerArgs.push('--model', modelId);
    if (gpu === 'all' && svc.multiGpu) dockerArgs.push('--tensor-parallel-size', '2');
  } else if (id === 'sdwebui') {
    dockerArgs.push('-v', `${hfCache}:/root/.cache/huggingface`);
    dockerArgs.push(image);
    dockerArgs.push('--listen', '--api');
  } else if (id === 'comfyui') {
    const comfyDir = path.join(home, 'comfyui-data');
    try { if (!fs.existsSync(comfyDir)) fs.mkdirSync(comfyDir, { recursive: true }); } catch {}
    const uid = process.getuid ? process.getuid() : 1000;
    const gid = process.getgid ? process.getgid() : 1000;
    dockerArgs.push('-e', `WANTED_UID=${uid}`, '-e', `WANTED_GID=${gid}`);
    // The image's init ends in `comfy setup --project-dir /basedir` run as WANTED_UID, and it
    // never creates /basedir itself: the host directory must exist and be owned by that uid
    // before the first run, or that step exits 1 and the container restart-loops. The image's
    // README binds it on every run beside /comfy/mnt, so we do the same.
    const basedir = path.join(comfyDir, 'basedir');
    try {
      if (!fs.existsSync(basedir)) { fs.mkdirSync(basedir, { recursive: true }); fs.chownSync(basedir, uid, gid); }
    } catch {}
    dockerArgs.push('-v', `${comfyDir}:/comfy/mnt`);
    dockerArgs.push('-v', `${basedir}:/basedir`);
    dockerArgs.push('-v', `${hfCache}:/root/.cache/huggingface`);
    dockerArgs.push(image);
  } else {
    dockerArgs.push(image);
  }

  const cmdDisplay = `docker ${dockerArgs.join(' ')}`;
  sseWrite({ status: `Starting ${svc.label}…\n$ ${cmdDisplay}\n` });

  const child = spawn(require('./containers').cli(), dockerArgs, { cwd: home });
  child.stdout.on('data', d => sseWrite({ status: d.toString() }));
  child.stderr.on('data', d => sseWrite({ status: d.toString() }));
  child.on('close', async (code, signal) => {
    if (code !== 0) { sseWrite({ done: true, ok: false, status: code !== null ? `✗ Exit ${code}` : `✗ Killed (${signal || 'unknown'})` }); return res.end(); }
    sseWrite({ status: `Container up; waiting for ${svc.label} to answer…\n` });
    const r = await waitReady(svc, status => sseWrite({ status }));
    if (r.ok) sseWrite({ done: true, ok: true, status: `✓ ${svc.label} answers on http://localhost:${svc.port}` });
    else sseWrite({ done: true, ok: false, status: `${r.log ? `--- its last log lines ---\n${r.log.trim()}\n---\n` : ''}✗ ${r.why}${r.log ? ' The container was removed so it does not restart in a loop.' : ''}` });
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
  exec(`${require('./containers').cli()} stop doca-${id} && ${require('./containers').cli()} rm doca-${id}`, (err, stdout, stderr) => {
    if (err) return res.status(500).json({ error: stderr || err.message });
    res.json({ ok: true });
  });
}

module.exports = {
  INFERENCE_SERVICES,
  handleList,
  handleSettings,
  handleStatus,
  handleStart,
  handleStop,
  diagnose,
};

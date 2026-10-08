'use strict';

/**
 * A llama.cpp server from a GGUF on Hugging Face, in one click: the files named by `org/repo:<quant or file>` are
 * resolved from the repository's listing (hub.js), downloaded into the models folder (download.js — a split set whole,
 * the vision projector when the repository has one and the person wants pictures read), and a managed llama.cpp
 * instance is made for them (models-llamacpp.js) with sensible starting values (defaults.js) and `--jinja`, so the
 * GGUF's own chat template — and with it tool calling — is used. It is made off: Start is the person's.
 *
 * The same handler serves the Models tab's Install and an accepted install proposal (installs.js kind `llamacpp-hf`,
 * through invokeHandler), so the agent proposing one can only bring about what that button does.
 */
const os = require('os');
const path = require('path');
const fs = require('fs');
const hub = require('./hub');

/** The folder GGUF files go to: the setting, else models/gguf in the home folder. */
function modelsDir() {
  const set = require('../settings-schema').value('llamacpp.modelsDir');
  return set && String(set).trim() ? path.resolve(String(set).trim()) : path.join(os.homedir(), 'models', 'gguf');
}

/** A short instance id from the repository and quantization, not one already taken. */
function freeId(repo, quant, taken) {
  const base = `${repo.split('/')[1].replace(/-?gguf$/i, '')}-${quant || 'gguf'}`.toLowerCase().replace(/[^a-z0-9.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  let id = base, n = 2;
  while (taken.has(id)) id = `${base}-${n++}`;
  return id;
}

/** The first port from 11435 no instance uses. */
function freePort(instances) {
  const used = new Set(instances.map(i => Number(i.port)));
  let p = 11435;
  while (used.has(p)) p++;
  return p;
}

/**
 * POST /api/models/llamacpp/hf/install {id: "org/repo:Q4_K_M", vision?, ctxSize?, nGpuLayers?, port?, name?} — SSE.
 * Advanced values override the estimate; anything else is the panel's.
 */
async function handleInstall(req, res) {
  const b = req.body || {};
  const p = hub.parse(b.id);
  if (p.error) return res.status(400).json({ error: p.error });
  require('../utils').sseHeaders(res);
  const say = status => { try { res.write(`data: ${JSON.stringify({ status })}\n\n`); } catch { /* the page went */ } };
  const end = (ok, status) => { try { res.write(`data: ${JSON.stringify({ done: true, ok, status, ...(ok ? {} : { error: status }) })}\n\n`); res.end(); } catch { /* gone */ } };
  const ctrl = new AbortController();
  res.on('close', () => { if (!res.writableFinished) ctrl.abort(); });
  try {
    say(`Looking at ${p.repo} on Hugging Face…\n`);
    const r = await hub.resolve(b.id, { vision: b.vision !== false && b.vision !== 'false' });
    const dir = modelsDir();
    say(`${r.quant || r.file}: ${r.files.length > 1 ? `${r.files.length} parts, ` : ''}${(r.modelBytes / 2 ** 30).toFixed(2)} GB`
      + `${r.mmproj ? ` + vision projector ${(r.mmproj.size / 2 ** 30).toFixed(2)} GB` : r.hasVision ? ' (vision projector left out)' : ''} → ${dir}\n`);
    fs.mkdirSync(dir, { recursive: true });
    try {
      const free = fs.statfsSync(dir); const avail = Number(free.bavail) * Number(free.bsize);
      if (avail && avail < r.bytes * 1.02) return end(false, `Not enough disk: ${(r.bytes / 2 ** 30).toFixed(1)} GB needed, ${(avail / 2 ** 30).toFixed(1)} GB free in ${dir} (llamacpp.modelsDir chooses the folder).`);
    } catch { /* unknown: try */ }
    const dl = require('./download');
    const [first] = await dl.all(dir, r.repo, r.files, { say, signal: ctrl.signal });
    const mmprojPath = r.mmproj ? (await dl.all(dir, r.repo, [r.mmproj], { say, signal: ctrl.signal }))[0] : '';

    const a = await require('../guided/assess').assess().catch(() => ({}));
    const d = require('./defaults').plan({ bytes: r.bytes, native: r.context, gpuGB: a.gpuGB, gpuTotalGB: a.gpuTotalGB });
    const llama = require('../models-llamacpp');
    const instances = llama.loadInstances();
    const same = instances.find(i => i.modelPath === first);
    const entry = {
      id: same?.id || freeId(r.repo, r.quant, new Set(instances.map(i => i.id))),
      name: String(b.name || '').trim().slice(0, 80) || same?.name || `${r.repo.split('/')[1]} ${r.quant || ''}`.trim(),
      modelPath: first,
      port: parseInt(b.port) || same?.port || freePort(instances),
      nGpuLayers: b.nGpuLayers === 'auto' ? 'auto' : Number.isFinite(parseInt(b.nGpuLayers)) ? parseInt(b.nGpuLayers) : d.nGpuLayers,
      ctxSize: parseInt(b.ctxSize) || d.ctxSize,
      jinja: true,
      mmprojPath,
      source: { repo: r.repo, quant: r.quant, files: r.files.map(f => f.path), at: new Date().toISOString() },
    };
    const inst = llama.saveInstance(entry);
    end(true, `\n✓ ${entry.name}: a llama.cpp server is ready, off until started (Field → Models → llama.cpp Servers → Start).\n`
      + `  ${d.where}; context ${entry.ctxSize.toLocaleString('en')} tokens${r.context ? ` of the model's ${r.context.toLocaleString('en')}` : ''}`
      + `${entry.nGpuLayers === 'auto' ? ', layers placed by llama.cpp' : ''}; --jinja on (its own chat template, for tool calls)`
      + `${mmprojPath ? '; reads pictures' : ''}. Once started it answers at ${inst.endpoint}.\n`);
  } catch (e) {
    end(false, ctrl.signal.aborted ? 'Stopped — install again to carry on where it left off.' : e.message);
  }
}

module.exports = { handleInstall, modelsDir, freeId, freePort };

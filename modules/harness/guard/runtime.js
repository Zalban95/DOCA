'use strict';

/**
 * What a model guard needs on this machine: transformers.js (ONNX on CPU,
 * ~740 MB, installed on demand into DOCA's data folder like the language
 * servers — never a dependency every install carries), the model's files
 * (downloaded from Hugging Face and laid out as transformers.js expects), and
 * one worker process that holds the models (./worker.mjs).
 */
const fs   = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');

const store = require('../../store');
const shell = require('../../shell');

const root = () => store.dir('guards');
const runtimeDir = () => path.join(root(), 'runtime');
const modelDir = id => path.join(root(), 'models', id);
const PKG = '@huggingface/transformers@4';

function runtimeInstalled() { return fs.existsSync(path.join(runtimeDir(), 'node_modules', '@huggingface', 'transformers', 'package.json')); }

function installRuntime() {
  const npm = shell.which('npm');
  if (!npm) return Promise.reject(Object.assign(new Error('npm is not on this machine.'), { status: 501 }));
  fs.mkdirSync(runtimeDir(), { recursive: true });
  if (!fs.existsSync(path.join(runtimeDir(), 'package.json'))) fs.writeFileSync(path.join(runtimeDir(), 'package.json'), '{"private":true}\n');
  return new Promise((resolve, reject) => execFile(npm, ['install', '--no-audit', '--no-fund', '--prefix', runtimeDir(), PKG],
    { timeout: 20 * 60e3, maxBuffer: 16 << 20 },
    (err, _out, errOut) => (err ? reject(Object.assign(new Error(String(errOut || err.message).trim().split('\n').slice(-3).join(' ')), { status: 500 }))
      : resolve({ installed: runtimeInstalled() }))));
}

function modelInstalled(g) {
  const d = modelDir(g.id);
  return fs.existsSync(path.join(d, 'config.json')) && fs.existsSync(path.join(d, 'onnx', g.dtype === 'q8' ? 'model_quantized.onnx' : 'model.onnx'));
}

/** Fetch the model's files into models/<id>/ in transformers.js's layout (onnx/ beside the tokenizer). */
async function downloadModel(g, { token } = {}) {
  const d = modelDir(g.id);
  fs.mkdirSync(path.join(d, 'onnx'), { recursive: true });
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  for (const [from, to] of Object.entries(g.files || {})) {
    const url = `https://huggingface.co/${g.repo}/resolve/main/${from}`;
    const r = await fetch(url, { headers, redirect: 'follow' });
    if (!r.ok) throw Object.assign(new Error(`${g.repo}/${from}: HTTP ${r.status}${r.status === 401 || r.status === 403 ? ' — gated: add a Hugging Face token in Models → Hugging Face' : ''}`), { status: 502 });
    const tmp = path.join(d, `${to}.part`);
    fs.mkdirSync(path.dirname(tmp), { recursive: true });
    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(tmp);
      require('stream').Readable.fromWeb(r.body).pipe(out).on('finish', resolve).on('error', reject);
    });
    fs.renameSync(tmp, path.join(d, to));
  }
  return { installed: modelInstalled(g) };
}

/* ── The worker ── */
let worker = null, seq = 0;
const waiting = new Map();

function start() {
  if (worker) return worker;
  if (!runtimeInstalled()) throw Object.assign(new Error('The guard runtime is not installed: Harness settings → Guards → Install runtime.'), { status: 409 });
  const child = spawn(process.execPath, [path.join(__dirname, 'worker.mjs'), runtimeDir()], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let buf = '';
  child.stdout.on('data', c => {
    buf += c;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
      let m; try { m = JSON.parse(line); } catch { continue; }
      const w = m.id != null && waiting.get(m.id);
      if (w) { waiting.delete(m.id); clearTimeout(w.timer); m.error ? w.reject(new Error(m.error)) : w.resolve(m.results); }
    }
  });
  child.stderr.on('data', () => { /* onnxruntime warnings */ });
  child.on('exit', () => {
    worker = null;
    for (const w of waiting.values()) { clearTimeout(w.timer); w.reject(new Error('the guard worker stopped')); }
    waiting.clear();
  });
  worker = child;
  return child;
}

/** Classify texts with one model guard: [{ label, score }] per text. */
function classify(g, texts, { timeoutMs = 120000 } = {}) {
  const w = start();
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { waiting.delete(id); reject(new Error(`${g.id} gave no answer in ${timeoutMs / 1000}s`)); }, timeoutMs);
    timer.unref?.();
    waiting.set(id, { resolve, reject, timer });
    w.stdin.write(JSON.stringify({ id, model: modelDir(g.id), dtype: g.dtype || null, texts }) + '\n');
  });
}

function stop() { try { worker?.kill(); } catch { /* gone */ } worker = null; }

module.exports = { runtimeInstalled, installRuntime, modelInstalled, downloadModel, classify, stop, modelDir, runtimeDir };

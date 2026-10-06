'use strict';

/**
 * Setting up the trainer, and training a word (jobs, job.js). Both are a person's — an admin's — click: setup
 * downloads ~20 GB once, a training spends about an hour of GPU. Everything runs by argv, never a shell.
 *
 * Setup: uv makes a Python 3.11 environment (System tools → uv), PyTorch for this machine (CUDA 12.8 wheels where
 * nvidia-smi answers — the build that knows RTX 50-series — the default build on a Mac, CPU elsewhere), the trainer's
 * requirements, then fetch.py the data.
 * Training: train.py (synthetic voices, the hub's speech voices, the person's recordings and near misses), then
 * evaluate.py scores the model on what it was not trained on, and the model is kept with its scores.
 */
const fs = require('fs');
const path = require('path');
const ww = require('./index');
const job = require('./job');

const uvEnv = () => ({ UV_HTTP_TIMEOUT: '600' });

function setup() {
  const uv = require('../shell').which('uv');
  if (!uv) throw Object.assign(new Error('Training needs uv, which makes its Python environment: Settings → System → System tools → uv.'), { status: 409 });
  const d = ww.dir(), py = ww.python();
  fs.mkdirSync(d, { recursive: true });
  const gpu = !!require('../shell').which('nvidia-smi');
  // 2.8: torchaudio 2.9 removed the file I/O openWakeWord's augmentation uses (torchaudio.info); 2.8's CUDA 12.8 build
  // still knows RTX 50-series.
  const pins = ['torch==2.8.*', 'torchaudio==2.8.*'];
  const torch = process.platform === 'darwin' ? pins : [...pins, '--index-url', `https://download.pytorch.org/whl/${gpu ? 'cu128' : 'cpu'}`];
  const steps = [];
  if (!fs.existsSync(py)) steps.push({ label: 'Python environment', cmd: uv, args: ['venv', '--python', '3.11', path.join(d, 'env')], env: uvEnv() });
  steps.push({ label: `PyTorch (${process.platform === 'darwin' ? 'Mac' : gpu ? 'NVIDIA GPU' : 'CPU'})`, cmd: uv, args: ['pip', 'install', '--python', py, ...torch], env: uvEnv() });
  steps.push({ label: 'the trainer\'s libraries', cmd: uv, args: ['pip', 'install', '--python', py, '-r', path.join(ww.TRAINER, 'requirements.txt')], env: uvEnv() });
  steps.push({ label: 'training data (about 20 GB, once)', cmd: py, args: [path.join(ww.TRAINER, 'fetch.py'), d], env: uvEnv() });
  return job.start('setup', steps);
}

/** Train a model for `word` from the synthetic voices, the hub's speech voices and the person's samples. */
function train({ word, samples = 8000, steps = 30000, near = '' } = {}) {
  const name = ww.slug(word);
  if (!name || name.length < 3) throw Object.assign(new Error('A wake word of at least three letters.'), { status: 400 });
  const r = ww.ready();
  const missing = Object.entries(r).filter(([, ok]) => !ok).map(([k]) => k);
  if (missing.length) throw Object.assign(new Error(`Set up the trainer first (missing: ${missing.join(', ')}).`), { status: 409 });
  const d = ww.dir(), py = ww.python(), mine = path.join(d, 'samples', name);
  const own = k => (fs.existsSync(path.join(mine, k)) && fs.readdirSync(path.join(mine, k)).length ? [path.join(mine, k)] : []);
  const tts = require('../chat').loadVoiceServices().ttsUrl;
  const run = path.join(d, 'runs');
  const onnx = path.join(run, name, `${name}.onnx`);
  return job.start('training', [
    { label: `training “${word}”`, cmd: py, cwd: ww.TRAINER, args: [path.join(ww.TRAINER, 'train.py'), '--word', String(word), '--out', run, '--data', d,
      ...(own('word').length ? ['--person', ...own('word')] : []), ...(own('other').length ? ['--negatives', ...own('other')] : []),
      ...(near ? ['--near', String(near)] : []), '--tts', tts, '--samples', String(Number(samples) || 8000), '--steps', String(Number(steps) || 30000)] },
    { label: 'scoring it on what it did not train on', cmd: py, cwd: ww.TRAINER, args: [path.join(ww.TRAINER, 'evaluate.py'), '--model', onnx,
      '--pos', path.join(run, name, name, 'positive_test'), ...own('word').flatMap(p => ['--pos-person', p]),
      '--neg', path.join(run, name, name, 'negative_test'), ...own('other').flatMap(p => ['--neg-person', p])],
      done: scores => ww.keep(word, onnx, { scores, from: { synthetic: Number(samples) || 8000, person: countIn(own('word')), personOther: countIn(own('other')) } }) },
  ]);
}

const countIn = dirs => dirs.reduce((n, p) => n + fs.readdirSync(p).length, 0);

module.exports = { setup, train };

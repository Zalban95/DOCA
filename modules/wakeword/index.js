'use strict';

/**
 * Wake words as models this hub trains and keeps (asked 2026-10-06: "add whatever you are using to the panel … when
 * the panel is sold to a customer that wants to train their own word … not hard coded but as a possibility, like the
 * other models"; TODO H8.4, docs/experiments/wake-model.md).
 *
 * Everything lives under one folder, `wakeword.dir` (default DATA_DIR/wakeword) — it is large, so it may be put on
 * another disk:
 *   env/        the trainer's Python environment (setup.js: uv, Python 3.11, PyTorch for this machine's GPU or CPU)
 *   piper-sample-generator/ data/ rir/ noise/   what training needs, fetched once (trainers/wakeword/fetch.py)
 *   samples/<word>/{word,other}/*.wav           the person's own recordings, split into utterances (samples.js)
 *   runs/<word>/                                a training's working files (train.js)
 *   models/<word>/{model.onnx, meta.json}       the models kept: the word, when, how it scored
 * The openWakeWord runtime's two shared models (melspectrogram, embedding) come from the environment's package.
 */
const fs = require('fs');
const path = require('path');

const dir = () => {
  const set = require('../settings-schema').value('wakeword.dir');
  return set || path.join(require('../store').DATA_DIR, 'wakeword');
};
const slug = word => String(word || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '').slice(0, 30);
const python = () => path.join(dir(), 'env', process.platform === 'win32' ? 'Scripts\\python.exe' : 'bin/python');
const TRAINER = path.join(__dirname, '..', '..', 'trainers', 'wakeword');

/** Whether each part training needs is here (the same checks fetch.py makes). */
function ready() {
  const d = dir(), size = p => { try { return fs.statSync(p).size; } catch { return 0; } };
  const count = p => { try { return fs.readdirSync(p).length; } catch { return 0; } };
  return {
    env: fs.existsSync(python()),
    generator: size(path.join(d, 'piper-sample-generator', 'models', 'en_US-libritts_r-medium.pt')) > 100 << 20,
    features: size(path.join(d, 'data', 'openwakeword_features_ACAV100M_2000_hrs_16bit.npy')) >= 16 << 30
      && size(path.join(d, 'data', 'validation_set_features.npy')) > 150 << 20,
    rir: count(path.join(d, 'rir')) >= 200,
    noise: count(path.join(d, 'noise')) >= 1000,
    runtime: !!runtimeFile('melspectrogram.onnx') && !!runtimeFile('embedding_model.onnx'),
  };
}

/** The models kept, newest first. */
function models() {
  const root = path.join(dir(), 'models');
  let names = [];
  try { names = fs.readdirSync(root); } catch { return []; }
  return names.map(n => {
    try { return { name: n, ...JSON.parse(fs.readFileSync(path.join(root, n, 'meta.json'), 'utf8')) }; } catch { return null; }
  }).filter(m => m && fs.existsSync(path.join(root, m.name, 'model.onnx'))).sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

const modelFile = name => path.join(dir(), 'models', slug(name), 'model.onnx');

/** Keep a trained model under its word, with what it was trained from and how it scored. */
function keep(word, onnx, meta) {
  const to = path.join(dir(), 'models', slug(word));
  fs.mkdirSync(to, { recursive: true });
  fs.copyFileSync(onnx, path.join(to, 'model.onnx'));
  const sha256 = require('crypto').createHash('sha256').update(fs.readFileSync(path.join(to, 'model.onnx'))).digest('hex');
  const full = { word, at: new Date().toISOString(), sha256, bytes: fs.statSync(path.join(to, 'model.onnx')).size, ...meta };
  fs.writeFileSync(path.join(to, 'meta.json'), JSON.stringify(full, null, 2));
  return full;
}

function remove(name) {
  const to = path.join(dir(), 'models', slug(name));
  if (!fs.existsSync(to)) throw Object.assign(new Error(`No model for "${name}".`), { status: 404 });
  fs.rmSync(to, { recursive: true, force: true });
  return { removed: slug(name) };
}

/** The openWakeWord runtime's shared models, from the trainer's environment (a screen needs both with a word's model). */
function runtimeFile(name) {
  if (!['melspectrogram.onnx', 'embedding_model.onnx'].includes(name)) return null;
  const lib = path.join(dir(), 'env', process.platform === 'win32' ? 'Lib' : 'lib');
  let site = null;
  try {
    site = process.platform === 'win32' ? path.join(lib, 'site-packages')
      : path.join(lib, fs.readdirSync(lib).find(d => d.startsWith('python')) || '', 'site-packages');
  } catch { return null; }
  const p = path.join(site, 'openwakeword', 'resources', 'models', name);
  return fs.existsSync(p) ? p : null;
}

function state() {
  return { dir: dir(), ready: ready(), models: models(), job: require('./job').view(), trainer: TRAINER };
}

module.exports = { dir, slug, python, TRAINER, ready, models, modelFile, keep, remove, runtimeFile, state };

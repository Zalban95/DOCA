'use strict';

/**
 * Laya on this hub (experiment `systemOne`): a managed Python process, set up the way the wake-word trainer is — uv
 * makes a Python 3.11 environment under `systemOne.dir` and installs the `laya` package with its server and the
 * PyTorch build for this machine (`--torch-backend=auto`: CUDA where a driver answers, the Mac's build, else CPU) —
 * then `python -m laya.serve`, the package's own Jev-compatible server, is started by argv.
 *
 * Why a process and not a container like the other inference services: it is one Python package and ~1 GB of weights,
 * the same on Linux, Windows and macOS through uv, and a container gets no GPU on a Mac or Windows without more set-up.
 *
 * It listens on 127.0.0.1 only (LAYA_HOST; its own default is every interface) at `systemOne.port`, behind a bearer
 * secret made at each start and kept in memory, so another account on the machine cannot use it either. The weights go
 * to the Hugging Face cache the Models tab shows (models.hf.cacheDir), with the hub's Hugging Face token if one is kept.
 * A person starts and stops it (Field → Models → Decision models); `systemOne.autostart` starts it with DOCA, said in
 * the activity log.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const job = require('../step-job').make();
const PACKAGE = 'laya[serve]==0.4.*';

const schema = () => require('../settings-schema');
const dir = () => schema().value('systemOne.dir') || path.join(require('../store').DATA_DIR, 'system-one');
const python = () => path.join(dir(), 'env', process.platform === 'win32' ? 'Scripts\\python.exe' : 'bin/python');
const port = () => Number(process.env.DOCA_SYSTEM_ONE_PORT) || Number(schema().value('systemOne.port')) || 8791;

let _proc = null;   // { child, secret, state: starting|running|stopped|failed, log: [], startedAt, error }

const ready = () => fs.existsSync(python()) && fs.existsSync(path.join(dir(), 'env', '.laya-installed'));
const running = () => _proc?.state === 'running';
const secret = () => _proc?.secret || '';

/** Install (or refresh) the environment: a person's click — it downloads PyTorch, 1–6 GB. */
function setup() {
  const uv = require('../shell').which('uv');
  if (!uv) throw Object.assign(new Error('Laya\'s environment is made by uv: Settings → System → System tools → uv.'), { status: 409 });
  const d = dir(), py = python(), env = { UV_HTTP_TIMEOUT: '600' };
  fs.mkdirSync(d, { recursive: true });
  const steps = [];
  if (!fs.existsSync(py)) steps.push({ label: 'Python environment', cmd: uv, args: ['venv', '--python', '3.11', path.join(d, 'env')], env });
  steps.push({ label: 'Laya and PyTorch for this machine', cmd: uv, args: ['pip', 'install', '--python', py, '--torch-backend=auto', PACKAGE], env,
    done: () => { fs.writeFileSync(path.join(d, 'env', '.laya-installed'), new Date().toISOString()); return { installed: PACKAGE }; } });
  return job.start('setup', steps);
}

function say(line) {
  if (!_proc) return;
  _proc.log.push(String(line).slice(0, 300));
  if (_proc.log.length > 200) _proc.log.splice(0, _proc.log.length - 200);
}

/** The environment the server starts with: where, how, and the cache — never logged (the token is in it). */
function serverEnv(s) {
  const mp = (() => { try { return require('../utils').loadModelsPrefs(); } catch { return {}; } })();
  const device = String(schema().value('systemOne.device') || 'auto');
  const hf = (() => { try { return require('../hf-token').get(); } catch { return ''; } })();
  return { ...process.env, LAYA_HOST: '127.0.0.1', LAYA_PORT: String(port()), LAYA_API_KEY: s,
    LAYA_MODELS: schema().value('systemOne.checkpoint') || 'english', LAYA_PRELOAD: '1', LAYA_LOG_LEVEL: 'warning', USE_TF: '0', PYTHONUNBUFFERED: '1',
    ...(device !== 'auto' ? { LAYA_DEVICE: device } : {}), ...(mp.hf?.cacheDir ? { HF_HUB_CACHE: mp.hf.cacheDir } : {}), ...(hf ? { HF_TOKEN: hf } : {}) };
}

/** Start the server and wait until it answers (the first start downloads the weights, ~0.8 GB). */
async function start({ why = 'started by a person', waitMs = 600e3 } = {}) {
  if (_proc && ['starting', 'running'].includes(_proc.state)) return status();
  if (!ready()) throw Object.assign(new Error('Set Laya up first (Field → Models → Decision models → Install).'), { status: 409 });
  const s = crypto.randomBytes(24).toString('hex');
  const child = spawn(python(), ['-m', 'laya.serve'], { env: serverEnv(s), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  _proc = { child, secret: s, state: 'starting', log: [], startedAt: new Date().toISOString(), error: null };
  const me = _proc;
  process.once('exit', () => { try { child.kill(); } catch { /* gone */ } });   // never left holding the port
  const take = d => String(d).split(/[\r\n]+/).filter(Boolean).forEach(l => (me === _proc ? say(l) : null));
  child.stdout.on('data', take); child.stderr.on('data', take);
  child.on('error', e => { me.state = 'failed'; me.error = e.message; });
  child.on('exit', code => { if (me.state !== 'stopped') { me.state = 'failed'; me.error = me.error || `it stopped (exit ${code}) — the log says why`; } });
  require('../activity').note({ from: 'system-one', what: `started Laya on 127.0.0.1:${port()}`, why });
  const until = Date.now() + waitMs;
  while (me.state === 'starting' && Date.now() < until) {
    if (await health(1500)) me.state = 'running';
    else await new Promise(r => setTimeout(r, 1000));
  }
  if (me.state === 'starting') { stop(); me.state = 'failed'; me.error = 'it did not answer in time'; }
  return status();
}

function stop() {
  if (!_proc) return status();
  if (_proc.state !== 'failed') _proc.state = 'stopped';
  try { _proc.child.kill(); } catch { /* gone */ }
  return status();
}

/** /health, as the server reports it (loaded checkpoints, where each computes), or null. */
async function health(timeoutMs = 3000) {
  if (!_proc || ['stopped', 'failed'].includes(_proc.state)) return null;
  try {
    // With its secret: without one the server answers only "ok" (its details name the machine's devices).
    const r = await fetch(`http://127.0.0.1:${port()}/health`, { signal: AbortSignal.timeout(timeoutMs), headers: { Authorization: `Bearer ${secret()}` } });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

/** What the panel shows: where it is, what it runs, how far its set-up and its process are — never the secret. */
function status() {
  return { dir: dir(), port: port(), ready: ready(), package: PACKAGE, setup: job.view(),
    autostart: schema().value('systemOne.autostart') === true, state: _proc?.state || 'stopped', startedAt: _proc?.startedAt || null, error: _proc?.error || null, log: (_proc?.log || []).slice(-40) };
}

/** At boot: start it when the owner asked for that and it is set up. */
function autostart() {
  if (schema().value('systemOne.autostart') !== true || !ready()) return;
  start({ why: 'systemOne.autostart is on' }).catch(() => { /* its state says why */ });
}

module.exports = { dir, python, port, ready, running, secret, setup, start, stop, health, status, autostart, job, PACKAGE };

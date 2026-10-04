'use strict';

/**
 * Which environment a project runs in (asked for 2026-10-04: "does a project
 * have a separate environment, or does it use the machine's?").
 *
 * Until now the answer was "the machine's, always, and nobody could tell": a
 * project with a `.venv` still ran `python3 -m pip install` into whatever
 * python3 the PATH found first. This module makes it a visible, per-project
 * choice:
 *
 *   runtimes()       what the machine has — Python, Node, Java, Go, Rust, .NET,
 *                    conda, uv — with versions and paths
 *   local(root)      what the project has of its own — a Python venv (any folder
 *                    with pyvenv.cfg, one level down), node_modules, an
 *                    environment.yml, a .nvmrc / .python-version
 *   chosen(p)        the project's choice: `p.env.python` is 'machine' or the
 *                    venv's folder (relative to the root); unset means a venv
 *                    found in the project is used, the way an IDE opens it
 *   vars(p)          what that means to a command: the venv's bin (Scripts on
 *                    Windows) and node_modules/.bin first on PATH, VIRTUAL_ENV set
 *
 * The project's commands (run.js) and its terminal-free jobs get `vars()`; the
 * agent's project brief says which Python it is, so its own shell commands use
 * the same one. Creating a venv and installing into it are ordinary jobs.
 */
const fs = require('fs');
const path = require('path');
const shell = require('../shell');
const { detect } = require('../detect');

const WIN = process.platform === 'win32';
const BIN = WIN ? 'Scripts' : 'bin';

const RUNTIMES = {
  python: { label: 'Python', any: [{ bin: 'python3', args: ['--version'] }, { bin: 'python', args: ['--version'] }, { bin: 'py', args: ['--version'] }] },
  node: { label: 'Node.js', bin: 'node', args: ['--version'] },
  java: { label: 'Java', bin: 'java', args: ['-version'], stderr: true, match: /version/ },
  go: { label: 'Go', bin: 'go', args: ['version'] },
  rust: { label: 'Rust (cargo)', bin: 'cargo', args: ['--version'] },
  dotnet: { label: '.NET', bin: 'dotnet', args: ['--version'] },
  conda: { label: 'conda', bin: 'conda', args: ['--version'] },
  uv: { label: 'uv', bin: 'uv', args: ['--version'] },
};

let _rt = null;
/** The machine's runtimes, probed once a minute at most. */
async function runtimes() {
  if (_rt && Date.now() - _rt.at < 60e3) return _rt.list;
  const list = await Promise.all(Object.entries(RUNTIMES).map(async ([id, { label, ...spec }]) => {
    const r = await detect(spec);
    const bins = spec.any ? spec.any.map(s => s.bin) : [spec.bin];
    const bin = bins.map(b => shell.which(b)).find(Boolean) || null;
    return { id, label, detected: r.detected, version: r.detected ? r.version : null, path: r.detected ? bin : null };
  }));
  _rt = { at: Date.now(), list };
  return list;
}

const venvPython = dir => path.join(dir, BIN, WIN ? 'python.exe' : 'python');

/** A venv's Python version, from pyvenv.cfg — no process started. */
function venvVersion(dir) {
  try { return /^version(?:_info)?\s*=\s*(.+)$/m.exec(fs.readFileSync(path.join(dir, 'pyvenv.cfg'), 'utf8'))?.[1].trim() || null; } catch { return null; }
}

/** What the project has of its own. */
function local(root) {
  let entries = [];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return { venvs: [], files: [] }; }
  const venvs = entries.filter(e => e.isDirectory() && fs.existsSync(path.join(root, e.name, 'pyvenv.cfg')))
    .map(e => ({ dir: e.name, version: venvVersion(path.join(root, e.name)), python: fs.existsSync(venvPython(path.join(root, e.name))) }));
  const has = f => fs.existsSync(path.join(root, f));
  const files = ['requirements.txt', 'pyproject.toml', 'environment.yml', '.python-version', 'package.json', '.nvmrc', '.node-version']
    .filter(has);
  return { venvs, files, nodeModules: has('node_modules') };
}

/** The Python the project uses: { kind: 'machine' } or { kind: 'venv', dir }. */
function chosen(p) {
  const want = p.env?.python;
  const { venvs } = local(p.root);
  if (want === 'machine') return { kind: 'machine' };
  const v = venvs.find(x => x.dir === want) || (!want ? venvs.find(x => x.python) : null);
  return v ? { kind: 'venv', dir: v.dir, version: v.version } : { kind: 'machine', ...(want ? { missing: want } : {}) };
}

/** Environment variables for a command run in the project. */
function vars(p) {
  const env = { ...process.env };
  const front = [];
  const c = chosen(p);
  if (c.kind === 'venv') {
    const dir = path.join(p.root, c.dir);
    front.push(path.join(dir, BIN));
    env.VIRTUAL_ENV = dir;
    delete env.PYTHONHOME;
  }
  if (fs.existsSync(path.join(p.root, 'node_modules', '.bin'))) front.push(path.join(p.root, 'node_modules', '.bin'));
  const key = Object.keys(env).find(k => k.toUpperCase() === 'PATH') || 'PATH';
  if (front.length) env[key] = [...front, env[key] || ''].join(path.delimiter);
  return env;
}

/**
 * The command line with the project's PATH put first *inside* it. Scripted
 * commands run in `bash -lc`, and a login shell's profile prepends its own
 * entries (~/.local/bin, pyenv shims) after the environment we hand it — so
 * the variable alone would leave the venv behind the machine's python.
 */
function wrap(p, command) {
  const v = vars(p);
  const key = Object.keys(v).find(k => k.toUpperCase() === 'PATH') || 'PATH';
  const front = String(v[key]).split(path.delimiter).slice(0, Number(!!v.VIRTUAL_ENV) + Number(fs.existsSync(path.join(p.root, 'node_modules', '.bin'))));
  if (!front.length) return command;
  if (WIN) return `$env:PATH = '${front.join(';').replace(/'/g, "''")};' + $env:PATH; ${command}`;
  return `export PATH=${front.map(f => `'${f.replace(/'/g, "'\\''")}'`).join(':')}:"$PATH"; ${command}`;
}

/** One line for the agent's project brief. */
function briefLine(p) {
  const c = chosen(p);
  return c.kind === 'venv'
    ? `Python: the project's own venv ${c.dir}${c.version ? ` (${c.version})` : ''} — the project's commands run with it first on PATH; in your own shell commands use ${path.join(c.dir, BIN, 'python')}.`
    : `Python: the machine's${c.missing ? ` (the chosen venv ${c.missing} is gone)` : ''}.`;
}

/** The command line that makes a venv, or installs a project's Python or Node dependencies. */
function setupCommand(p, action, { dir = '.venv' } = {}) {
  if (!/^[\w.-]{1,40}$/.test(dir)) throw Object.assign(new Error('A venv folder name is letters, digits, . _ and -.'), { status: 400 });
  const machinePy = shell.which('python3') ? 'python3' : shell.which('python') ? 'python' : shell.which('py') ? 'py' : null;
  const c = chosen(p);
  const py = c.kind === 'venv' ? `"${venvPython(path.join(p.root, c.dir))}"` : machinePy;
  const has = f => fs.existsSync(path.join(p.root, f));
  if (action === 'venv') {
    if (!machinePy) throw Object.assign(new Error('There is no Python on this machine to make a venv with.'), { status: 424 });
    return { run: `${machinePy} -m venv ${dir}`, then: { python: dir } };
  }
  if (action === 'pip') {
    if (!py) throw Object.assign(new Error('There is no Python to install with.'), { status: 424 });
    if (has('requirements.txt')) return { run: `${py} -m pip install -r requirements.txt` };
    if (has('pyproject.toml')) return { run: `${py} -m pip install -e .` };
    throw Object.assign(new Error('Neither requirements.txt nor pyproject.toml is in the project.'), { status: 400 });
  }
  if (action === 'npm') {
    if (!has('package.json')) throw Object.assign(new Error('There is no package.json in the project.'), { status: 400 });
    return { run: has('pnpm-lock.yaml') ? 'pnpm install' : has('yarn.lock') ? 'yarn install' : 'npm install' };
  }
  throw Object.assign(new Error('action is venv, pip or npm.'), { status: 400 });
}

/** Everything the Environment view draws. */
async function view(p) {
  return { runtimes: await runtimes(), local: local(p.root), chosen: chosen(p) };
}

module.exports = { runtimes, local, chosen, vars, wrap, briefLine, setupCommand, view, RUNTIMES };

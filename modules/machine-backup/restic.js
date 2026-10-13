'use strict';

/**
 * restic, driven by argv (docs: AGENTS.md "This machine's files, backed up"). restic is one binary on Linux, macOS and
 * Windows (the System tools row `restic`); its repository is deduplicated, encrypted with a password, and opens on any
 * OS — what a fresh install needs. So DOCA wraps it rather than being a backup engine of its own, and a person can use
 * restic by hand on a machine without DOCA.
 *
 * Always an argv array and no shell. The password never travels on argv or in the environment as a value: it is
 * written to a file of its own in a private temporary folder (0700, the file 0600) that RESTIC_PASSWORD_FILE names, and
 * removed when the command ends. RESTIC_PASSWORD and RESTIC_PASSWORD_COMMAND inherited from DOCA's own environment are
 * dropped, so they cannot win over it. restic's cache goes under DOCA's data folder, never the person's home.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

/** Exit codes restic documents (0.17+), said as sentences. */
const EXIT = {
  1: 'restic failed',
  3: 'some files could not be read',
  10: 'there is no backup repository at that place yet',
  11: 'the repository is locked by another restic',
  12: 'the password does not open this backup',
  130: 'it was stopped',
};

function bin() { return process.env.DOCA_RESTIC || require('../shell').which('restic'); }

let _version = null;
/** Whether restic is here, and which version (asked once per path). */
async function available() {
  const b = bin();
  if (!b) return { found: false, bin: null, version: null };
  if (_version?.bin === b) return _version;
  const r = await raw(b, ['version'], { env: { ...process.env } }).catch(e => ({ code: -1, stdout: '', stderr: e.message }));
  const m = /restic\s+(\d+\.\d+\.\d+)/.exec(r.stdout || '');
  _version = { found: r.code === 0, bin: b, version: m ? m[1] : null };
  return _version;
}

/** The environment a backend reads its keys from, by the address's scheme. */
function backendEnv(repo, remote) {
  if (!remote || !(remote.id || remote.secret)) return {};
  const scheme = (/^([a-z0-9]+):/i.exec(repo || '') || [])[1]?.toLowerCase();
  const pairs = { s3: ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'], b2: ['B2_ACCOUNT_ID', 'B2_ACCOUNT_KEY'],
    azure: ['AZURE_ACCOUNT_NAME', 'AZURE_ACCOUNT_KEY'], rest: ['RESTIC_REST_USERNAME', 'RESTIC_REST_PASSWORD'] }[scheme];
  return pairs ? { [pairs[0]]: remote.id, [pairs[1]]: remote.secret } : {};
}

/**
 * What a command is spawned with — pure, so a test can hold that the password is never on argv. `passwordFile` is the
 * path of the file holding it; the password itself is not an argument.
 */
function spec(args, { repo, passwordFile = null, remote = null, cacheDir = null, base = process.env } = {}) {
  const env = { ...base, RESTIC_REPOSITORY: repo, RESTIC_PROGRESS_FPS: '0.5', ...backendEnv(repo, remote) };
  delete env.RESTIC_PASSWORD; delete env.RESTIC_PASSWORD_COMMAND; delete env.RESTIC_REPOSITORY_FILE;
  if (passwordFile) env.RESTIC_PASSWORD_FILE = passwordFile; else delete env.RESTIC_PASSWORD_FILE;
  if (cacheDir) env.RESTIC_CACHE_DIR = cacheDir;
  return { bin: bin(), args: args.map(String), env };
}

/** Run fn(file) with the password in a private temporary file, removed afterwards whatever happens. */
async function withPasswordFile(password, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doca-restic-'));
  try { fs.chmodSync(dir, 0o700); } catch { /* Windows: the temp folder is the user's own */ }
  const file = path.join(dir, 'pw');
  try {
    fs.writeFileSync(file, String(password), { mode: 0o600 });
    return await fn(file);
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* gone with the temp folder */ } }
}

const running = new Set();   // the children this module started, so a shutdown can stop exactly those

function raw(b, args, { env, onLine, stdout = null, signal = null, timeoutMs = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(b, args, { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    running.add(child);
    let out = '', err = '', buf = '', timer = null;
    const stop = () => { try { child.kill(); } catch { /* gone */ } };
    if (signal) { if (signal.aborted) stop(); else signal.addEventListener('abort', stop, { once: true }); }
    if (timeoutMs) timer = setTimeout(stop, timeoutMs);
    if (stdout) child.stdout.pipe(stdout);
    else child.stdout.on('data', d => {
      const s = d.toString('utf8');
      if (!onLine) { out += s; return; }
      buf += s;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (line.trim()) onLine(line); }
    });
    let ebuf = '';   // restic --json writes its errors to stderr, a JSON line each
    child.stderr.on('data', d => {
      const s = d.toString('utf8');
      err = (err + s).slice(-20000);
      if (!onLine) return;
      ebuf += s;
      let i;
      while ((i = ebuf.indexOf('\n')) >= 0) { const line = ebuf.slice(0, i); ebuf = ebuf.slice(i + 1); if (line.trim().startsWith('{')) onLine(line); }
    });
    child.on('error', e => { running.delete(child); clearTimeout(timer); reject(e); });
    child.on('close', code => { running.delete(child); clearTimeout(timer); if (onLine && buf.trim()) onLine(buf); resolve({ code, stdout: out, stderr: err }); });
  });
}

/** One JSON value per line, the lines that are not JSON skipped. */
function jsonLines(text) {
  const out = [];
  for (const l of String(text || '').split('\n')) { const t = l.trim(); if (!t) continue; try { out.push(JSON.parse(t)); } catch { /* a progress line or a plain one */ } }
  return out;
}

/** The sentence for a failed command: restic's own last words, and what its exit code means. */
function failure(r) {
  const lines = String(r.stderr || '').split('\n').map(s => s.trim()).filter(s => s && !s.startsWith('{'));
  const last = lines.slice(-2).join(' ').replace(/^Fatal:\s*/, '');
  const exitErr = jsonLines(r.stderr).find(j => j.message_type === 'exit_error');
  return Object.assign(new Error([EXIT[r.code], exitErr?.message || last].filter(Boolean).join(': ') || `restic exited with ${r.code}`), { status: r.code === 12 ? 403 : 502, resticCode: r.code });
}

/**
 * Run restic against the configured repository. `opts`: repo, password (else the kept one), onLine (each stdout line,
 * for --json progress), stdout (a stream the output goes to: dump), signal, timeoutMs, ok (exit codes that count as
 * success; 0 by default). Resolves {code, stdout, stderr}; rejects with failure() otherwise.
 */
async function run(args, opts = {}) {
  const cfg = require('./config');
  const repo = opts.repo ?? cfg.get().repo;
  if (!repo) throw require('../switch-off').unset('No backup destination is set yet.', { what: 'A backup destination', page: 'settings/backups', card: 'This machine\'s files',
    why: 'This machine\'s files are kept in a place you choose — a disk or a service — with a password of their own: Settings → Backups sets it up.' });
  const password = opts.password ?? cfg.password();
  if (!password) throw Object.assign(new Error('No backup password is kept yet: set the backup up first.'), { status: 409 });
  if (!bin()) throw Object.assign(new Error('restic is not installed on this machine: install it from System tools (or the button in this card).'), { status: 409 });
  const cacheDir = require('../store').dir('machine-backup/cache');
  return withPasswordFile(password, async file => {
    const s = spec(args, { repo, passwordFile: file, remote: opts.remote ?? cfg.remoteKeys(), cacheDir });
    const r = await raw(s.bin, s.args, { env: s.env, onLine: opts.onLine, stdout: opts.stdout, signal: opts.signal, timeoutMs: opts.timeoutMs });
    if (!(opts.ok || [0]).includes(r.code)) throw failure(r);
    return r;
  });
}

/** Stop every restic this module started (DOCA shutting down). */
function stopAll() { for (const c of running) try { c.kill(); } catch { /* gone */ } }

module.exports = { bin, available, spec, backendEnv, withPasswordFile, run, jsonLines, failure, stopAll, EXIT, _reset: () => { _version = null; } };

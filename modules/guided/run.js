'use strict';

/**
 * "Install everything" in Set-up (asked 2026-10-13: "during the first setup this has to only require the password once
 * and make sure what can be installed in parallel can start but the sequential ones need to wait"). The installs are
 * the plan's own proposals (plan.js: each with a `key` and the keys it waits for, `after`), run here on the hub — a
 * page closed halfway does not stop them — each through installs.apply, the same as its own Install button:
 *
 *   - this machine's tools (kind `tool`: Ollama, Docker, llama.cpp, Ollama's MLX runtime) one at a time, in the plan's
 *     order: they share the package manager's lock and sudo;
 *   - everything else (models pulled, services, GGUF downloads) as soon as what it waits for is installed, side by side;
 *   - one that waits for a failed install is not started, and says which and why.
 *
 * The password is asked once, checked with sudo before anything starts (a mistyped one would fail every install that
 * needs it), held in this module's memory only while an install that needs it remains, then dropped. Never written.
 * One run at a time; its progress is `view()` and the live feed's `guided` topic.
 */
const LANE = 'tool';
let _run = null;   // { id, items, startedAt, endedAt, password }

const changed = () => { try { require('../live').changed('guided', 'run', 'progress'); } catch { /* no feed */ } };

/** Whether sudo takes this password here — `sudo -A -k -v` with a helper that says it, nothing else run. */
let checkPassword = async password => {
  const shell = require('../shell');
  const sudo = shell.which('sudo');
  if (!sudo || shell.WIN) return { ok: true };   // Windows elevates through UAC; no sudo, nothing to check
  const fs = require('fs'), os = require('os'), path = require('path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), '.doca-askpass-'));
  const ask = path.join(dir, 'askpass.sh');
  fs.writeFileSync(ask, `#!/bin/sh\nprintf '%s\\n' '${String(password).replace(/'/g, `'\\''`)}'\n`, { mode: 0o700 });
  try {
    return await new Promise(resolve => {
      require('child_process').execFile(sudo, ['-A', '-k', '-v'], { env: { ...process.env, SUDO_ASKPASS: ask }, timeout: 20000 },
        err => resolve(err ? { ok: false, why: 'sudo did not take that password — it is your account\'s password on this machine' } : { ok: true }));
    });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
};

function view() {
  if (!_run) return null;
  const { password, ...rest } = _run;
  return { ...rest, running: !_run.endedAt, items: _run.items.map(({ proposalId, key, label, lane, after, state, error, needsPassword }) => ({ proposalId, key, label, lane, after, state, error, needsPassword })) };
}

/**
 * Start installing every pending proposal of the plan's steps. `steps`: plan.apply's install steps (with `proposal`).
 * → view(). Refused while a run is going, or when sudo does not take the password and one is needed.
 */
async function start(steps, { password = null } = {}) {
  if (_run && !_run.endedAt) throw Object.assign(new Error('Set-up is already installing.'), { status: 409 });
  // One model can serve two roles (the agent's and pictures'): one proposal, installed once, under the first step's key.
  const seen = new Map();
  for (const s of steps) if (s.type === 'install' && s.proposal && !seen.has(s.proposal.id)) seen.set(s.proposal.id, s);
  const items = [...seen.values()].filter(s => s.proposal.status === 'pending').map(s => ({
    proposalId: s.proposal.id, key: s.key || `${s.kind}:${s.id}`, label: s.label, lane: s.kind === 'tool' ? LANE : 'side',
    after: s.after || [], needsPassword: !!s.proposal.needsPassword, state: 'waiting', error: null }));
  const done = new Set(steps.filter(s => s.type === 'install' && s.proposal?.status === 'installed').map(s => s.key || `${s.kind}:${s.id}`));
  if (!items.length) throw Object.assign(new Error('Nothing is waiting to be installed.'), { status: 409 });
  if (items.some(i => i.needsPassword)) {
    if (!password) throw Object.assign(new Error('Some of these need your password (sudo).'), { status: 400, code: 'password_needed' });
    const c = await checkPassword(password);
    if (!c.ok) throw Object.assign(new Error(c.why), { status: 400, code: 'password_refused' });
  }
  _run = { id: `run_${Date.now().toString(36)}`, items, startedAt: new Date().toISOString(), endedAt: null, password: items.some(i => i.needsPassword) ? password : null };
  for (const i of items) if (done.has(i.key)) i.state = 'installed';
  require('../activity').note({ from: 'setup', what: `installing ${items.length} thing${items.length === 1 ? '' : 's'} for the set-up`, why: 'Install everything in Settings → Set-up' });
  pump(_run, done);
  changed();
  return view();
}

/** Start whatever may start now; called again whenever one ends. */
function pump(run, done) {
  const failed = new Set(run.items.filter(i => i.state === 'failed' || i.state === 'skipped').map(i => i.key));
  for (const i of run.items.filter(x => x.state === 'waiting')) {
    const bad = i.after.find(k => failed.has(k));
    if (bad) { i.state = 'skipped'; i.error = `not started: ${run.items.find(x => x.key === bad)?.label || bad} did not install`; failed.add(i.key); }
  }
  for (const i of run.items.filter(x => x.state === 'waiting')) {
    if (!i.after.every(k => done.has(k))) continue;
    if (i.lane === LANE) {
      if (run.items.some(x => x.lane === LANE && x.state === 'running')) continue;
      if (run.items.find(x => x.lane === LANE && x.state === 'waiting') !== i) continue;   // the plan's order
    }
    i.state = 'running';
    require('../harness/installs').apply(i.proposalId, i.needsPassword ? { password: run.password } : {})
      .then(row => { i.state = row.status === 'installed' ? 'installed' : 'failed'; i.error = row.error || null; })
      .catch(e => { i.state = 'failed'; i.error = e.message; })
      .finally(() => {
        if (i.state === 'installed') done.add(i.key);
        if (!run.items.some(x => x.needsPassword && (x.state === 'waiting' || x.state === 'running'))) run.password = null;
        pump(run, done);
        changed();
      });
  }
  if (!run.endedAt && run.items.every(i => !['waiting', 'running'].includes(i.state))) {
    run.endedAt = new Date().toISOString();
    run.password = null;
    const n = s => run.items.filter(i => i.state === s).length;
    require('../activity').note({ from: 'setup', what: `set-up installs ended: ${n('installed')} installed, ${n('failed')} failed, ${n('skipped')} not started`,
      why: 'Install everything in Settings → Set-up', level: n('failed') || n('skipped') ? 'warn' : 'info' });
  }
}

module.exports = { start, view, LANE, _check: fn => { checkPassword = fn; }, _reset: () => { _run = null; } };

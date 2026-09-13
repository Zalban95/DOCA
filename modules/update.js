'use strict';

const fs    = require('fs');
const path  = require('path');
const https = require('https');
const { exec, spawn } = require('child_process');

const pkg = require(path.join(__dirname, '..', 'package.json'));
const LOCAL_VERSION = pkg.version;
const REPO = 'Zalban95/DOCA';
const DASHBOARD_DIR = path.join(__dirname, '..');

let cached = null;
let cachedAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // background cache: 5 min

/**
 * The newest *version* tag, which is not the same thing as the first tag GitHub
 * returns.
 *
 * `/tags` is ordered however the API feels like ordering it — not by semver and
 * not reliably by date — so `per_page=1` was asking one arbitrary tag whether it
 * was the latest release. With tags v2.1.1 … v2.3.5 present and the package at
 * 2.12.0 this happened to answer "no update", which is right by accident: the
 * same code would have announced a downgrade just as confidently. Take a page of
 * them and pick the highest.
 */
function fetchLatestTag() {
  return new Promise((resolve) => {
    const url = `https://api.github.com/repos/${REPO}/tags?per_page=100`;
    const req = https.get(url, {
      headers: { 'User-Agent': 'DOCA-update-check', Accept: 'application/vnd.github.v3+json' },
      timeout: 8000,
    }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        if (res.statusCode !== 200) return resolve(null);
        try {
          const tags = JSON.parse(body);
          if (!Array.isArray(tags) || !tags.length) return resolve(null);
          const versions = tags
            .map(t => String(t?.name || '').replace(/^v/, ''))
            .filter(v => /^\d+\.\d+\.\d+$/.test(v));
          if (!versions.length) return resolve(null);
          resolve(versions.reduce((a, b) => (compareSemver(a, b) < 0 ? b : a)));
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

function compareSemver(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
  }
  return 0;
}

/** GET /api/update-check?force=1 */
async function handleUpdateCheck(req, res) {
  const force = req.query.force === '1';
  const now   = Date.now();

  if (!force && cached && (now - cachedAt) < CACHE_TTL_MS) {
    return res.json(cached);
  }

  const latest = await fetchLatestTag();
  const result = {
    current: LOCAL_VERSION,
    latest: latest || LOCAL_VERSION,
    updateAvailable: latest ? compareSemver(LOCAL_VERSION, latest) < 0 : false,
    repo: `https://github.com/${REPO}`,
    checkedAt: new Date().toISOString(),
  };
  cached   = result;
  cachedAt = now;
  res.json(result);
}

/** Promisified exec in the dashboard dir (never rejects). */
function gitRun(cmd) {
  return new Promise(resolve => {
    exec(cmd, { cwd: DASHBOARD_DIR, timeout: 60000 }, (err, stdout, stderr) =>
      resolve({ err, stdout: stdout || '', stderr: stderr || '' }));
  });
}

const AUTOSTASH_PREFIX = 'DOCA auto-stash before update';

/** POST /api/update — auto-stash local changes, git pull, restore, stream output.
 *  Local modifications are NEVER deleted: they are stashed with a labeled
 *  message and restored after the pull; if restoring conflicts, the stash is
 *  kept intact for manual recovery. */
async function handleUpdate(req, res) {
  const { sseHeaders } = require('./utils');
  sseHeaders(res);
  const sseWrite = d => { try { res.write(`data: ${JSON.stringify(d)}\n\n`); } catch {} };

  sseWrite({ status: `Updating dashboard from ${REPO}…\n$ cd ${DASHBOARD_DIR}\n` });

  // Remember where we were so we can diff exactly what the pull brought in.
  const beforeHead = (await gitRun('git rev-parse HEAD')).stdout.trim();

  // ── 1. Preserve local changes (git pull refuses a dirty tree) ──────────────
  // -uno: tracked files only for the dirty check; the stash still includes
  // untracked files so a pull can never clobber them either.
  const dirty = (await gitRun('git status --porcelain -uno')).stdout.trim() !== '';
  let stashed = false;
  if (dirty) {
    sseWrite({ status: `\nLocal changes detected — stashing them safely (nothing is deleted):\n$ git stash push --include-untracked\n` });
    const st = await gitRun(`git stash push --include-untracked -m "${AUTOSTASH_PREFIX} ${new Date().toISOString()}"`);
    if (st.err) {
      sseWrite({ done: true, ok: false, status: `✗ Could not stash local changes: ${st.stderr || st.err.message}\nUpdate aborted — your files are untouched.\n` });
      return res.end();
    }
    stashed = !/No local changes/i.test(st.stdout + st.stderr);
    sseWrite({ status: (st.stdout || '') + '\n' });
  }

  /** Put the user's stashed changes back. Keeps the stash on any conflict. */
  const restoreStash = async () => {
    if (!stashed) return;
    sseWrite({ status: `\nRestoring your local changes:\n$ git stash pop\n` });
    const pop = await gitRun('git stash pop');
    if (!pop.err) {
      sseWrite({ status: (pop.stdout || '') + '✓ Local changes restored.\n' });
      return;
    }
    // Pop conflicted: get back to a clean updated tree; the stash entry is
    // KEPT by git on failed pop, so the user's work is safe.
    await gitRun('git reset --hard HEAD');
    sseWrite({ status:
      `⚠ Your local changes conflict with the update and were NOT applied automatically.\n` +
      `They are preserved in git stash — recover them with:\n` +
      `  git stash list      (look for "${AUTOSTASH_PREFIX}")\n` +
      `  git stash pop       (then resolve the conflicts)\n` });
  };

  // ── 2. Pull (streamed) ──────────────────────────────────────────────────────
  sseWrite({ status: `$ git pull\n\n` });
  const child = spawn('git', ['pull'], { cwd: DASHBOARD_DIR });

  child.stdout.on('data', chunk => sseWrite({ status: chunk.toString() }));
  child.stderr.on('data', chunk => sseWrite({ status: chunk.toString() }));

  child.on('close', async (code) => {
    if (code !== 0) {
      await restoreStash(); // put things back even when the pull failed
      sseWrite({ done: true, ok: false, status: `\n✗ git pull exited with code ${code}\n` });
      return res.end();
    }
    sseWrite({ status: '\n✓ Pull complete.\n' });

    const afterHead = (await gitRun('git rev-parse HEAD')).stdout.trim();

    // ── 3. Restore the user's changes on top of the updated code ─────────────
    await restoreStash();

    if (!beforeHead || beforeHead === afterHead) {
      sseWrite({ done: true, ok: true, status: '\n✓ Already up to date — nothing to apply.\n' });
      cached = null;
      return res.end();
    }

    // ── 4. Refresh dependencies when the pulled range touched package.json ───
    const diff = await gitRun(`git diff ${beforeHead} ${afterHead} --name-only`);
    const changed = diff.stdout.trim().split('\n');
    if (changed.includes('package.json')) {
      sseWrite({ status: '\npackage.json changed — running npm install…\n' });
      const npm = spawn('npm', ['install', '--omit=dev'], { cwd: DASHBOARD_DIR });
      npm.stdout.on('data', chunk => sseWrite({ status: chunk.toString() }));
      npm.stderr.on('data', chunk => sseWrite({ status: chunk.toString() }));
      npm.on('close', (npmCode) => {
        if (npmCode === 0) {
          sseWrite({ done: true, ok: true, status: '\n✓ Dependencies updated. Restart the server to apply.\n' });
        } else {
          sseWrite({ done: true, ok: false, status: `\n✗ npm install exited with code ${npmCode}\n` });
        }
        cached = null;
        res.end();
      });
      npm.on('error', e => {
        sseWrite({ done: true, ok: false, status: `\nnpm error: ${e.message}\n` });
        res.end();
      });
    } else {
      sseWrite({ done: true, ok: true, status: '\n✓ Restart the server to apply the update.\n' });
      cached = null;
      res.end();
    }
  });

  child.on('error', e => {
    sseWrite({ done: true, ok: false, status: `Error: ${e.message}. Is git installed?` });
    res.end();
  });

  res.on('close', () => { if (!child.killed) child.kill(); });
}

/** The supervisor that will start us again after we exit, or null if we are on
 *  our own. Inside a container we must report one either way: if node is PID 1
 *  a detached child dies with the container, so only the restart policy can
 *  bring the panel back. */
function supervisorName() {
  if (process.env.INVOCATION_ID) return 'systemd';   // set by systemd >= 232 per unit
  if (process.env.pm_id)         return 'pm2';
  try { if (fs.existsSync('/.dockerenv')) return 'container'; } catch {}
  return null;
}

/** POST /api/restart — exit, having made sure something will start us again.
 *
 *  Under a supervisor, exiting is the whole job and spawning a successor would
 *  only race it for the port. Started by hand (`npm start`, a login shell, a
 *  tmux window) nothing would ever come back and this endpoint would be a kill
 *  switch, so we hand off to a detached successor first. That successor starts
 *  while we still hold the port and retries the bind until we are gone — see
 *  listenWithRetry() in server.js. Its output goes to a log file because a
 *  detached process has nowhere else to report a failed boot. */
function handleRestart(_req, res) {
  const supervisor  = supervisorName();
  const selfRespawn = !supervisor;
  let handoff = null;

  if (selfRespawn) {
    try {
      const dataDir = process.env.DOCA_DATA_DIR || path.join(DASHBOARD_DIR, '.doca');
      fs.mkdirSync(dataDir, { recursive: true });
      const logPath = path.join(dataDir, 'restart.log');
      const out = fs.openSync(logPath, 'a');
      fs.writeSync(out, `\n── restart requested ${new Date().toISOString()} ──\n`);

      const child = spawn(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
        cwd: DASHBOARD_DIR, detached: true, stdio: ['ignore', out, out], env: process.env,
      });
      child.unref();
      handoff = { pid: child.pid, log: logPath };
    } catch (e) {
      // Say so instead of exiting into a hole the user cannot see.
      return res.status(500).json({
        ok: false,
        error: `Could not start a successor process: ${e.message}. DOCA is still running — restart it manually.`,
      });
    }
  }

  res.json({ ok: true, message: 'Server restarting…', supervisor, selfRespawn, handoff });
  setTimeout(() => process.exit(0), 500);
}

module.exports = { handleUpdateCheck, handleUpdate, handleRestart };

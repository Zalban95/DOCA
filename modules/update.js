'use strict';

const fs    = require('fs');
const path  = require('path');
const https = require('https');
const { exec, spawn } = require('child_process');

const pkg = require(path.join(__dirname, '..', 'package.json'));
const LOCAL_VERSION = pkg.version;
const REPO = 'Zalban95/DOCA';
// The checkout: what `git pull` updates and where run.sh lives — not the release
// folder this code may be running from.
const DASHBOARD_DIR = process.env.DOCA_HOME || path.join(__dirname, '..');

let cached = null;
let cachedAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // background cache: 5 min

/**
 * The newest version tag, asked of git before GitHub.
 *
 * `git ls-remote --tags origin` is the better question and it was not being
 * asked. It uses the credentials that are already working — the same ones that
 * pushed the tag — so it reads a **private** repository, which the public API
 * cannot: GitHub answers 404 for a private repo to avoid confirming it exists,
 * and 404 arrived here as "no tags", which arrived at the user as "up to date".
 * That is why a push never showed up. It needs no new secret, no PAT in prefs,
 * and no outbound HTTPS beyond what git already does.
 *
 * GIT_TERMINAL_PROMPT=0 matters: without it, a machine whose credential helper
 * has expired sits waiting for a username that nobody is there to type, and the
 * update check hangs rather than failing.
 *
 * The API stays as the fallback for a checkout with no remote, and takes a
 * token from the environment if one is there. Deliberately environment-only:
 * prefs are served by an unauthenticated route, and a PAT in there would be the
 * same leak `/api/mcp` had in 2.13.1.
 */
function highest(versions) {
  const ok = versions.filter(v => /^\d+\.\d+\.\d+$/.test(v));
  return ok.length ? ok.reduce((a, b) => (compareSemver(a, b) < 0 ? b : a)) : null;
}

/** Version tags out of `git ls-remote --tags` output. Exported so it is testable. */
function parseLsRemote(stdout) {
  return String(stdout || '')
    .split('\n')
    .map(l => (l.match(/refs\/tags\/v?(\d+\.\d+\.\d+)(?:\^\{\})?$/) || [])[1])
    .filter(Boolean);
}

function fetchLatestTagFromGit() {
  return new Promise(resolve => {
    exec('git ls-remote --tags origin', {
      cwd: DASHBOARD_DIR,
      timeout: 15000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'echo' },
    }, (err, stdout) => {
      if (err) return resolve(null);
      resolve(highest(parseLsRemote(stdout)));
    });
  });
}

function fetchLatestTagFromApi() {
  return new Promise((resolve) => {
    const url = `https://api.github.com/repos/${REPO}/tags?per_page=100`;
    const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
    const req = https.get(url, {
      headers: {
        'User-Agent': 'DOCA-update-check',
        Accept: 'application/vnd.github.v3+json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      timeout: 8000,
    }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        if (res.statusCode !== 200) return resolve(null);
        try {
          const tags = JSON.parse(body);
          if (!Array.isArray(tags) || !tags.length) return resolve(null);
          resolve(highest(tags.map(t => String(t?.name || '').replace(/^v/, ''))));
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

/** @returns {Promise<{version: string, source: string}|null>} */
async function fetchLatestTag() {
  const fromGit = await fetchLatestTagFromGit();
  if (fromGit) return { version: fromGit, source: 'git ls-remote' };
  const fromApi = await fetchLatestTagFromApi();
  if (fromApi) return { version: fromApi, source: 'GitHub API' };
  return null;
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

  const found = await fetchLatestTag();

  // "I looked and you are current" and "I could not look" are different
  // answers, and giving both as `updateAvailable: false` is how a private repo,
  // a rate limit or no egress all rendered as a green "up to date" tick. A
  // check that cannot fail visibly is not a check.
  const result = {
    current: LOCAL_VERSION,
    latest: found ? found.version : null,
    checked: !!found,
    source: found ? found.source : null,
    reason: found ? null
      : 'Could not read the tags of this repository. `git ls-remote` failed (no remote, or credentials that '
        + 'need renewing) and the GitHub API returned nothing — for a private repo it answers 404 unless '
        + 'GITHUB_TOKEN is set in the environment. This is not a statement that you are up to date.',
    updateAvailable: found ? compareSemver(LOCAL_VERSION, found.version) < 0 : false,
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

  // Running an installed release, a pull would change only the checkout, which
  // the launcher is not starting — the update would look applied and not be.
  // So "update" means the newest release, installed and switched to.
  const releases = require('./releases');
  if (releases.current() !== releases.CHECKOUT) {
    try {
      const tag = await releases.latest();
      if (!tag || releases.cmpVersion(tag, LOCAL_VERSION) <= 0) {
        sseWrite({ done: true, ok: true, status: `✓ Already on the newest version (v${LOCAL_VERSION}).\n` });
      } else {
        const r = await releases.use(tag, { by: 'update', say: status => sseWrite({ status }) });
        sseWrite({ done: true, ok: true, restarting: r.restarting, status: '\n✓ Restarting into the new version.\n' });
      }
    } catch (e) {
      sseWrite({ done: true, ok: false, status: `\n✗ ${e.message}\n` });
    }
    cached = null;
    return res.end();
  }

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
          // "DOCA", not "the server": this restarts the panel process, and the
          // phrase is reserved for that meaning — the other one is the external
          // OpenClaw stack. See public/js/keys.js for the pair.
          sseWrite({ done: true, ok: true, status: '\n✓ Dependencies updated. Restart DOCA to apply.\n' });
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
      sseWrite({ done: true, ok: true, status: '\n✓ Restart DOCA to apply the update.\n' });
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
function handleRestart(req, res) {
  // Running turns are not cut off unless asked: { whenIdle: true } waits for
  // them (harness/drain.js), { cancel: true } calls a waiting restart off.
  const drain = require('./harness/drain');
  if (req.body?.cancel) return res.json({ ok: true, cancelled: drain.cancel() });
  if (req.body?.whenIdle && drain.busy().length) {
    const waiting = drain.whenIdle(() => restartNow(), { label: 'restart' });
    return res.status(202).json({ ok: true, waiting });
  }
  restartNow(res);
}

function restartNow(res = null) {
  const reply = (status, body) => { if (res) res.status(status).json(body); else if (!body.ok) console.warn(`[restart] ${body.error}`); };
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

      // Started by run.sh, the successor is run.sh again: it is what reads
      // .releases/current, so a restart after switching versions starts the
      // version that was chosen rather than the one that is exiting.
      const [cmd, args] = process.env.DOCA_HOME
        ? ['bash', [path.join(DASHBOARD_DIR, 'run.sh'), 'start']]
        : [process.execPath, [...process.execArgv, ...process.argv.slice(1)]];
      const child = spawn(cmd, args, {
        cwd: DASHBOARD_DIR, detached: true, stdio: ['ignore', out, out], env: process.env,
      });
      child.unref();
      handoff = { pid: child.pid, log: logPath };
    } catch (e) {
      // Say so instead of exiting into a hole the user cannot see.
      return reply(500, {
        ok: false,
        error: `Could not start a successor process: ${e.message}. DOCA is still running — restart it manually.`,
      });
    }
  }

  reply(200, { ok: true, message: 'Server restarting…', supervisor, selfRespawn, handoff });
  setTimeout(() => process.exit(0), 500);
}

/** The panel's own lifecycle routes: update, restart, versions, backups. */
function mount(app) {
  app.get ('/api/update-check', handleUpdateCheck);
  app.post('/api/update',       handleUpdate);
  app.post('/api/restart',      handleRestart);
  require('./releases').mount(app);          // /api/versions: roll back or forward
  require('./backup/routes').mount(app);     // /api/backups: .dBac
}

module.exports = { mount, handleUpdateCheck, handleUpdate, handleRestart, supervisorName, fetchLatestTag, parseLsRemote, highest, compareSemver };

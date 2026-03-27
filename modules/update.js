'use strict';

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

function fetchLatestTag() {
  return new Promise((resolve) => {
    const url = `https://api.github.com/repos/${REPO}/tags?per_page=1`;
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
          resolve(tags[0].name.replace(/^v/, ''));
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

/** POST /api/update — run git pull in the dashboard directory, stream output */
function handleUpdate(req, res) {
  const { sseHeaders } = require('./utils');
  sseHeaders(res);
  const sseWrite = d => { try { res.write(`data: ${JSON.stringify(d)}\n\n`); } catch {} };

  sseWrite({ status: `Updating dashboard from ${REPO}…\n` });
  sseWrite({ status: `$ cd ${DASHBOARD_DIR}\n$ git pull\n\n` });

  const child = spawn('git', ['pull'], { cwd: DASHBOARD_DIR });

  child.stdout.on('data', chunk => sseWrite({ status: chunk.toString() }));
  child.stderr.on('data', chunk => sseWrite({ status: chunk.toString() }));

  child.on('close', (code) => {
    if (code === 0) {
      sseWrite({ status: '\n✓ Pull complete.\n' });
      // Check if package.json changed (dependencies might need updating)
      exec('git diff HEAD~1 --name-only', { cwd: DASHBOARD_DIR }, (err, stdout) => {
        const changed = (stdout || '').trim().split('\n');
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
    } else {
      sseWrite({ done: true, ok: false, status: `\n✗ git pull exited with code ${code}\n` });
      res.end();
    }
  });

  child.on('error', e => {
    sseWrite({ done: true, ok: false, status: `Error: ${e.message}. Is git installed?` });
    res.end();
  });

  res.on('close', () => { if (!child.killed) child.kill(); });
}

/** POST /api/restart — graceful server restart */
function handleRestart(_req, res) {
  res.json({ ok: true, message: 'Server restarting…' });
  setTimeout(() => process.exit(0), 500);
}

module.exports = { handleUpdateCheck, handleUpdate, handleRestart };

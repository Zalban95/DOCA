'use strict';

const path = require('path');
const https = require('https');

const pkg = require(path.join(__dirname, '..', 'package.json'));
const LOCAL_VERSION = pkg.version;
const REPO = 'Zalban95/DOCA';
const CACHE_TTL_MS = 60 * 60 * 1000; // re-check at most once per hour

let cached = null;
let cachedAt = 0;

function fetchLatestTag() {
  return new Promise((resolve, reject) => {
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

/** GET /api/update-check */
async function handleUpdateCheck(_req, res) {
  const now = Date.now();
  if (cached && (now - cachedAt) < CACHE_TTL_MS) return res.json(cached);

  const latest = await fetchLatestTag();
  const result = {
    current: LOCAL_VERSION,
    latest: latest || LOCAL_VERSION,
    updateAvailable: latest ? compareSemver(LOCAL_VERSION, latest) < 0 : false,
    repo: `https://github.com/${REPO}`,
  };
  cached = result;
  cachedAt = now;
  res.json(result);
}

module.exports = { handleUpdateCheck };

'use strict';

/**
 * Installing a suggested Craft app from the panel (asked 2026-10-12: "we can get them all if you think is safe"): its
 * latest GitHub release for this OS and processor — the Linux tarball, the Windows portable zip, the macOS CLI zip —
 * checked against the release's own SHA256SUMS.txt before anything is unpacked, then unpacked into this hub's data
 * folder (`apps/craft/<app>/<version>`), never system-wide and with no administrator rights. catalog-craft.js finds the
 * CLI there. Only the storytold repository the row names is ever fetched; a file the sums do not name, or that does not
 * match, is refused and removed.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const REPO = id => `storytold/${id}`;
const API = () => process.env.DOCA_GITHUB_API || 'https://api.github.com';   // read each time: a test points it at a stand-in
const bad = (m, status = 400) => Object.assign(new Error(m), { status });

const root = () => path.join(require('../store').DATA_DIR, 'apps', 'craft');

/** The release asset for this machine, by the names the Craft releases use. */
function assetName(id, version, { platform = process.platform, arch = process.arch } = {}) {
  const a = arch === 'arm64' ? 'aarch64' : 'x86_64';
  if (platform === 'linux') return `${id}-${version}-linux-${a}.tar.gz`;
  if (platform === 'win32') return `${id}-${version}-windows-${arch === 'arm64' ? 'arm64' : 'x64'}-portable.zip`;
  if (platform === 'darwin') return `${id}-cli-${version}-macos-universal.zip`;
  return null;
}

async function getJson(url) {
  const r = await fetch(url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'doca-hub' }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw bad(`GitHub answered ${r.status} for ${url}.`, 502);
  return r.json();
}

async function download(url, to) {
  const r = await fetch(url, { headers: { 'User-Agent': 'doca-hub' }, redirect: 'follow', signal: AbortSignal.timeout(15 * 60000) });
  if (!r.ok) throw bad(`The download answered ${r.status}.`, 502);
  fs.writeFileSync(to, Buffer.from(await r.arrayBuffer()));
}

const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/** The newest installed version's CLI, or null. */
function installedCli(id) {
  const dir = path.join(root(), id);
  let versions = [];
  try { versions = fs.readdirSync(dir).sort((a, b) => b.localeCompare(a, undefined, { numeric: true })); } catch { return null; }
  const want = process.platform === 'win32' ? `${id}-cli.exe` : `${id}-cli`;
  for (const v of versions) {
    const found = (function walk(d, depth = 0) {
      let entries = [];
      try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return null; }
      for (const e of entries) if (e.isFile() && e.name === want) return path.join(d, e.name);
      if (depth < 3) for (const e of entries) if (e.isDirectory()) { const f = walk(path.join(d, e.name), depth + 1); if (f) return f; }
      return null;
    })(path.join(dir, v));
    if (found) return found;
  }
  return null;
}

/** Download, check and unpack one app's latest release: {id, version, cli}. */
async function install(id) {
  const row = require('./catalog-craft').APPS.find(([x]) => x === id);
  if (!row) throw bad(`No Craft app "${id}".`, 404);
  const rel = await getJson(`${API()}/repos/${REPO(id)}/releases/latest`);
  const version = String(rel.tag_name || '').replace(/^v/, '');
  const name = assetName(id, version);
  if (!name) throw bad(`No ${row[1]} release is made for this system (${process.platform}).`, 409);
  const asset = (rel.assets || []).find(a => a.name === name), sums = (rel.assets || []).find(a => a.name === 'SHA256SUMS.txt');
  if (!asset) throw bad(`${row[1]} ${version} has no ${name}.`, 409);
  if (!sums) throw bad(`${row[1]} ${version} publishes no SHA256SUMS.txt, so it is not installed unchecked.`, 409);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `craft-${id}-`));
  try {
    const file = path.join(tmp, name), sumsFile = path.join(tmp, 'SHA256SUMS.txt');
    await download(sums.browser_download_url, sumsFile);
    const line = fs.readFileSync(sumsFile, 'utf8').split('\n').find(l => l.trim().endsWith(` ${name}`) || l.trim().endsWith(`*${name}`));
    if (!line) throw bad(`SHA256SUMS.txt does not name ${name}: not installed.`, 409);
    await download(asset.browser_download_url, file);
    if (sha256(file) !== line.trim().split(/\s+/)[0].toLowerCase()) throw bad(`${name} does not match its published checksum: not installed.`, 409);
    const dest = path.join(root(), id, version);
    fs.rmSync(dest, { recursive: true, force: true });
    fs.mkdirSync(dest, { recursive: true });
    await new Promise((resolve, reject) => require('child_process').execFile('tar', ['-xf', file, '-C', dest], { windowsHide: true, timeout: 10 * 60000 },
      e => (e ? reject(bad(`Unpacking ${name} failed: ${e.message}`, 500)) : resolve())));
    const cli = installedCli(id);
    if (!cli) throw bad(`${name} unpacked, but no ${id}-cli was in it.`, 500);
    if (process.platform !== 'win32') try { fs.chmodSync(cli, 0o755); } catch { /* as unpacked */ }
    require('../activity').note({ from: 'mcp', what: `installed ${row[1]} ${version} (checksum checked)`, why: 'a person installed it from the MCP catalogue',
      machine: { kind: 'app', id, name: row[1] }, act: 'install', ok: true });
    return { id, version, cli };
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

module.exports = { install, installedCli, assetName, root };

'use strict';

/**
 * Where releases come from: the project's licence server (Keygen's distribution API, https://keygen.sh/docs/api/releases/),
 * asked with this hive's licence key — so only a hive with a licence for the product sees its releases, and Keygen's
 * own rules (an expired licence, entitlement constraints on a release) decide which. Each release carries, in its
 * metadata, the manifest and its signature (manifest.js); nothing the server says is trusted unsigned.
 *
 *   newer(current)      the releases newer than `current` whose manifest verifies here, newest first
 *   download(r, file)   the release's zip into `file`: Keygen's artifact (a licence-gated download, redirected to
 *                       the server's storage) when the release has one, else the manifest's `url`; checked against
 *                       the manifest's size and sha256 before it is kept
 */
const fs = require('fs');
const crypto = require('crypto');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const manifest = require('./manifest');

const licenceKey = () => require('../license/files').readJson(require('../license/files').CONFIG, {}).key || '';
const base = () => require('../license/checkin').base();

function where() {
  const b = base();
  if (!b) return { ok: false, why: 'No licence server is set (Settings → System → Licence → Advanced): this hive has no update channel. It keeps running what it has.' };
  if (!licenceKey()) return { ok: false, why: 'No licence key is entered (Settings → System → Licence): the update channel answers a licensed hive only.' };
  return { ok: true, base: b };
}

async function call(url, { auth = true, redirect = 'follow', timeout = 20000 } = {}) {
  const res = await fetch(url, { redirect, headers: { Accept: 'application/vnd.api+json', ...(auth ? { Authorization: `License ${licenceKey()}` } : {}) }, signal: AbortSignal.timeout(timeout) });
  return res;
}

/** Every release newer than `current` that verifies, newest first, as {version, manifest, keyId, id, artifacts}. */
async function newer(current, { keys = require('./keys').RELEASE_KEYS } = {}) {
  const w = where();
  if (!w.ok) throw Object.assign(new Error(w.why), { code: 'no_channel' });
  const product = require('../license/files').readJson(require('../license/files').STATE, {}).productId;
  const out = [], skipped = [];
  for (let page = 1; page <= 5; page++) {
    const q = `?channel=stable&page[size]=50&page[number]=${page}${product ? `&product=${encodeURIComponent(product)}` : ''}`;
    const res = await call(`${w.base}/releases${q}`);
    const json = await res.json().catch(() => null);
    if (res.status >= 400) throw Object.assign(new Error(`the update channel answered ${res.status}: ${json?.errors?.[0]?.detail || 'no detail'}`), { code: 'channel_error' });
    const rows = Array.isArray(json?.data) ? json.data : [];
    for (const r of rows) {
      const a = r.attributes || {}, md = a.metadata || {};
      if (a.status && a.status !== 'PUBLISHED') continue;
      if (!manifest.SEMVER.test(String(a.version || '')) || manifest.cmp(a.version, current) <= 0) continue;
      let m;
      try { m = typeof md.manifest === 'string' ? JSON.parse(md.manifest) : md.manifest; } catch { m = null; }
      try {
        const v = manifest.verify(m, md.signature, keys);
        if (v.manifest.version !== a.version) throw new Error('its manifest names another version');
        out.push({ version: a.version, manifest: v.manifest, signature: md.signature, keyId: v.keyId, id: r.id, url: md.url || null });
      } catch (e) { skipped.push({ version: a.version, why: e.message }); }
    }
    if (rows.length < 50) break;
  }
  out.sort((x, y) => manifest.cmp(y.version, x.version));
  return { releases: out, skipped };
}

/** The address the zip is fetched from: Keygen's artifact (its redirect to storage, followed without the key), or the manifest's url. */
async function addressOf(r) {
  const w = where();
  if (w.ok && r.id) {
    const res = await call(`${w.base}/releases/${encodeURIComponent(r.id)}/artifacts`);
    const json = await res.json().catch(() => null);
    const art = (Array.isArray(json?.data) ? json.data : []).find(x => x.attributes?.filename === r.manifest.file);
    if (art) {
      const dl = await call(`${w.base}/artifacts/${encodeURIComponent(art.id)}`, { redirect: 'manual' });
      const to = dl.headers.get('location');
      if (to) return { url: new URL(to, w.base).href, auth: false };
      const body = await dl.json().catch(() => null);
      if (body?.data?.links?.redirect) return { url: body.data.links.redirect, auth: false };
    }
  }
  if (r.url || r.manifest.url) return { url: r.url || r.manifest.url, auth: false };
  throw Object.assign(new Error(`The release ${r.version} has no file to download (no artifact on the licence server, and no url in its metadata).`), { code: 'no_file' });
}

/** Download a release's zip to `file`, checked against its manifest. Resolves to {file, sha256, size}. */
async function download(r, file) {
  const { url } = await addressOf(r);
  const res = await fetch(url, { signal: AbortSignal.timeout(30 * 60e3) });
  if (!res.ok || !res.body) throw Object.assign(new Error(`The release's file could not be fetched (${res.status}).`), { code: 'download' });
  const part = `${file}.part`;
  const hash = crypto.createHash('sha256');
  let size = 0;
  const count = async function* (src) { for await (const chunk of src) { hash.update(chunk); size += chunk.length; yield chunk; } };
  await pipeline(Readable.fromWeb(res.body), count, fs.createWriteStream(part));
  const sha256 = hash.digest('hex');
  if (sha256 !== r.manifest.sha256 || (r.manifest.size && size !== r.manifest.size)) {
    fs.rmSync(part, { force: true });
    throw Object.assign(new Error(`The downloaded file does not match the signed release (sha256 ${sha256.slice(0, 12)}…, ${size} bytes): it was not kept.`), { code: 'checksum' });
  }
  fs.renameSync(part, file);
  return { file, sha256, size };
}

module.exports = { where, newer, download, addressOf };

'use strict';

/**
 * An off-site copy of the scheduled backups: any S3-compatible store (AWS S3,
 * Backblaze B2, Cloudflare R2, Hetzner, Wasabi, MinIO…), signed with AWS
 * Signature V4 by hand — a few lines of crypto instead of an SDK.
 *
 * Settings: prefs `backup.remote` { enabled, endpoint, region, bucket, prefix,
 * keep, encryptedOnly } (travels); the key pair in `<DATA_DIR>/keys/backup-remote.json`
 * (this machine's, never sent back by the API). After each scheduled backup the
 * new file is uploaded and only the last `keep` `auto-…` files under `prefix`
 * are kept there; nothing else in the bucket is touched.
 */
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const store = require('../store');
const { loadPrefs, savePrefs } = require('../utils');

const DEFAULTS = { enabled: false, endpoint: '', region: 'us-east-1', bucket: '', prefix: 'doca/', keep: 14, encryptedOnly: true };
const bad = (m, status = 400) => Object.assign(new Error(m), { status });
const keysFile = () => path.join(store.dir('keys'), 'backup-remote.json');

function config() { return { ...DEFAULTS, ...((loadPrefs().backup || {}).remote || {}) }; }
function keys() { try { return JSON.parse(fs.readFileSync(keysFile(), 'utf8')); } catch { return null; } }

/** What the panel shows: the settings, and whether keys are saved (never the keys). */
function view() { return { ...config(), hasKeys: !!keys()?.accessKeyId }; }

function setConfig(patch = {}) {
  const next = { ...config() };
  for (const k of ['endpoint', 'region', 'bucket', 'prefix']) if (patch[k] !== undefined) next[k] = String(patch[k]).trim();
  if (next.endpoint && !/^https?:\/\/[^/\s]+\/?$/.test(next.endpoint)) throw bad('The endpoint is the store\'s address, like https://s3.eu-central-1.amazonaws.com or http://minio:9000.');
  next.endpoint = next.endpoint.replace(/\/$/, '');
  if (next.prefix && !next.prefix.endsWith('/')) next.prefix += '/';
  if (patch.keep !== undefined) { const k = Number(patch.keep); if (!Number.isInteger(k) || k < 1 || k > 365) throw bad('keep is between 1 and 365.'); next.keep = k; }
  for (const k of ['enabled', 'encryptedOnly']) if (typeof patch[k] === 'boolean') next[k] = patch[k];
  if (next.enabled && (!next.endpoint || !next.bucket)) throw bad('Set the endpoint and the bucket before switching the off-site copy on.');
  if (patch.accessKeyId || patch.secretAccessKey) {
    if (!patch.accessKeyId || !patch.secretAccessKey) throw bad('Both the access key id and the secret are needed.');
    fs.mkdirSync(path.dirname(keysFile()), { recursive: true });
    fs.writeFileSync(keysFile(), JSON.stringify({ accessKeyId: String(patch.accessKeyId), secretAccessKey: String(patch.secretAccessKey) }), { mode: 0o600 });
  }
  const prefs = loadPrefs();
  prefs.backup = { ...(prefs.backup || {}), remote: next };
  savePrefs(prefs);
  return view();
}

/* ── Signature V4 ── */
const sha256 = d => crypto.createHash('sha256').update(d).digest('hex');
const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest();
const enc = s => encodeURIComponent(s).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/**
 * Sign a request. `path` is the URL path (already encoded, starting with /),
 * `query` an object, `headers` lower-case names; the payload hash is given, or
 * UNSIGNED-PAYLOAD for a streamed upload.
 */
function sign({ method, host, path: p, query = {}, headers = {}, payloadHash, region, accessKeyId, secretAccessKey, now = new Date() }) {
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const day = amzDate.slice(0, 8);
  const all = { ...headers, host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  const names = Object.keys(all).map(h => h.toLowerCase()).sort();
  const canonicalHeaders = names.map(h => `${h}:${String(all[h]).trim()}\n`).join('');
  const signed = names.join(';');
  const qs = Object.keys(query).sort().map(k => `${enc(k)}=${enc(String(query[k]))}`).join('&');
  const request = [method, p, qs, canonicalHeaders, signed, payloadHash].join('\n');
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(request)].join('\n');
  const key = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, day), region), 's3'), 'aws4_request');
  const signature = crypto.createHmac('sha256', key).update(toSign).digest('hex');
  return { ...all, authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signed}, Signature=${signature}`, _qs: qs };
}

/** One request to the bucket (path-style: works on every S3-compatible store). */
async function request(method, key, { query = {}, body = null, length = null, headers = {} } = {}) {
  const c = config(), k = keys();
  if (!c.endpoint || !c.bucket) throw bad('The off-site copy has no endpoint or bucket yet.');
  if (!k?.accessKeyId) throw bad('The off-site copy has no access key saved.');
  const u = new URL(c.endpoint);
  const p = `/${enc(c.bucket)}${key ? `/${key.split('/').map(enc).join('/')}` : ''}`;
  const payloadHash = body === null ? sha256('') : 'UNSIGNED-PAYLOAD';
  const h = sign({ method, host: u.host, path: p, query, headers, payloadHash, region: c.region || 'us-east-1', ...k });
  const qs = h._qs; delete h._qs;
  const res = await fetch(`${u.protocol}//${u.host}${p}${qs ? `?${qs}` : ''}`, {
    method, headers: { ...h, ...(length != null ? { 'content-length': String(length) } : {}) },
    ...(body !== null ? { body, duplex: 'half' } : {}), signal: AbortSignal.timeout(6 * 3600e3),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const code = /<Code>([^<]+)<\/Code>/.exec(text)?.[1];
    throw bad(`The store answered ${res.status}${code ? ` ${code}` : ''}: ${(/<Message>([^<]+)<\/Message>/.exec(text)?.[1] || text).slice(0, 200)}`, 502);
  }
  return res;
}

async function upload(file, name = path.basename(file)) {
  const size = fs.statSync(file).size;
  await request('PUT', `${config().prefix}${name}`, { body: require('stream').Readable.toWeb(fs.createReadStream(file)), length: size });
  return { key: `${config().prefix}${name}`, bytes: size };
}

async function list() {
  const out = [];
  let token = null;
  do {
    const res = await request('GET', '', { query: { 'list-type': '2', prefix: config().prefix, ...(token ? { 'continuation-token': token } : {}) } });
    const xml = await res.text();
    for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      out.push({ key: /<Key>([^<]+)<\/Key>/.exec(m[1])?.[1], at: /<LastModified>([^<]+)<\/LastModified>/.exec(m[1])?.[1], bytes: Number(/<Size>(\d+)<\/Size>/.exec(m[1])?.[1] || 0) });
    }
    token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? /<NextContinuationToken>([^<]+)</.exec(xml)?.[1] : null;
  } while (token);
  return out;
}

/** Keep the last `keep` scheduled backups under the prefix; others (by hand, other files) are never touched. */
async function prune(keep = config().keep) {
  const auto = (await list()).filter(o => o.key?.startsWith(`${config().prefix}auto-`)).sort((a, b) => b.key.localeCompare(a.key));
  const drop = auto.slice(keep);
  for (const o of drop) await request('DELETE', o.key);
  return drop.map(o => o.key);
}

/** Reach the bucket: write, list and remove a small file. */
async function test() {
  const name = `.doca-test-${Date.now()}.txt`;
  const body = 'DOCA can write here.\n';
  await request('PUT', `${config().prefix}${name}`, { body: require('stream').Readable.toWeb(require('stream').Readable.from([body])), length: Buffer.byteLength(body) });
  const seen = (await list()).some(o => o.key === `${config().prefix}${name}`);
  await request('DELETE', `${config().prefix}${name}`);
  return { ok: true, listed: seen };
}

/** After a scheduled backup: send it, then keep the last N there. Refuses an open backup when encryptedOnly. */
async function afterBackup(file, { encrypted }) {
  const c = config();
  if (!c.enabled) return null;
  if (c.encryptedOnly && !encrypted) throw bad('Not sent off-site: this backup is not password-protected, and the off-site copy only takes protected ones.');
  const sent = await upload(file);
  return { ...sent, removed: await prune(c.keep) };
}

module.exports = { config, view, setConfig, sign, upload, list, prune, test, afterBackup };

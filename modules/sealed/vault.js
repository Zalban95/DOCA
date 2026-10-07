'use strict';

/**
 * Secrets for devices (CONSTITUTION S4; TODO P1.3): a password, a PIN or a token the owner keeps here so an agent can
 * have it typed or pasted on one of the person's devices without ever seeing it (sealed/use.js).
 *
 * Where: the owner asked for "the SQL, in a safe place". The rows live in doca.db (`sealed_secrets`, schema step 10),
 * so they travel with the database like the rest of the hive's state — but only as AES-256-GCM ciphertext. The key
 * is DATA_DIR/keys/sealed.key (0600, inside the protected keys folder, PROTECTED_DIRS), never in the database: a copy
 * of doca.db alone, a PostgreSQL dump, or an agent reading the database file through `shell` gets nothing usable.
 * Each row's ciphertext is bound to its name (GCM's additional data), so a row's data cannot be moved under another
 * name. What the panel and the agent see is `view()`: the name, the site, a note, never the value.
 *
 * Where each was used is `sealed_uses`: when, which secret, which device, into what, by whom, and how it went — a
 * record, never a value.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../db');

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;
// The protected keys folder (paths.PROTECTED_DIRS): every file in it is refused to the agent's file tools.
const keysDir = () => path.dirname(require('../paths').LOGIN_KEYS_FILE);
const keyFile = () => path.join(keysDir(), 'sealed.key');

/** The at-rest key: made the first time, 0600, in the keys folder. */
function atRestKey() {
  const f = keyFile();
  try { const k = Buffer.from(fs.readFileSync(f, 'utf8').trim(), 'base64'); if (k.length === 32) return k; } catch { /* first use */ }
  if (fs.existsSync(f)) throw bad('keys/sealed.key is damaged: the secrets for devices cannot be read until it is restored from a backup.', 500);
  const k = crypto.randomBytes(32);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, k.toString('base64'), { mode: 0o600 });
  try { fs.chmodSync(f, 0o600); } catch { /* Windows */ }
  return k;
}

function encrypt(name, value) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', atRestKey(), iv);
  c.setAAD(Buffer.from(`doca-sealed:${name}`));
  const data = Buffer.concat([c.update(String(value), 'utf8'), c.final(), c.getAuthTag()]);
  return { iv: iv.toString('base64'), data: data.toString('base64') };
}

function decrypt(name, row) {
  const raw = Buffer.from(row.data, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', atRestKey(), Buffer.from(row.iv, 'base64'));
  d.setAAD(Buffer.from(`doca-sealed:${name}`));
  d.setAuthTag(raw.subarray(raw.length - 16));
  return Buffer.concat([d.update(raw.subarray(0, raw.length - 16)), d.final()]).toString('utf8');
}

const view = r => ({ name: r.name, origin: r.origin || null, note: r.note || '', createdAt: r.created_at, hasValue: true });

let _names = [];   // the last list seen, for a reading that must stay synchronous on PostgreSQL

async function list() {
  const rows = (await db.all("SELECT name, origin, note, created_at FROM sealed_secrets WHERE tenant_id = 'local' ORDER BY name")).map(view);
  _names = rows.map(r => ({ name: r.name, origin: r.origin }));
  return rows;
}

/** Names and sites, synchronously (the prompt's readings are assembled on every step): SQLite directly, else the last list. */
function namesSync() {
  const raw = db.syncHandle();
  if (!raw) return _names;
  return raw.prepare("SELECT name, origin FROM sealed_secrets WHERE tenant_id = 'local' ORDER BY name").all().map(r => ({ name: r.name, origin: r.origin || null }));
}

/** Keep one (a new name, or a new value for an existing one). `value` is never returned. */
async function save({ name, value, origin, note } = {}, by = null) {
  name = String(name || '').trim().toLowerCase();
  if (!NAME.test(name)) throw bad('A secret\'s name is short, lowercase letters, digits and dashes: wifi-guest, bank-pin.');
  let o = null;
  if (origin) {
    try { o = new URL(String(origin)).origin; } catch { throw bad('The site is its address, like https://bank.example.'); }
    if (!/^https?:/.test(o)) throw bad('The site is an http(s) address.');
  }
  const MASK = require('../secrets-mask').MASK;
  const have = await db.get("SELECT name, iv, data FROM sealed_secrets WHERE tenant_id = 'local' AND name = ?", [name]);
  const given = typeof value === 'string' && value && value !== MASK ? value : null;
  if (!given && !have) throw bad('Type the secret itself.');
  if (given && given.length > 4096) throw bad('A secret is at most 4096 characters.');
  const sealed = given ? encrypt(name, given) : { iv: have.iv, data: have.data };
  const at = new Date().toISOString();
  await db.run("DELETE FROM sealed_secrets WHERE tenant_id = 'local' AND name = ?", [name]);
  await db.run("INSERT INTO sealed_secrets (tenant_id, name, origin, note, owner_id, iv, data, created_at) VALUES ('local', ?, ?, ?, ?, ?, ?, ?)",
    [name, o, String(note || '').slice(0, 200), by, sealed.iv, sealed.data, at]);
  return view({ name, origin: o, note, created_at: at });
}

async function remove(name) {
  const r = await db.run("DELETE FROM sealed_secrets WHERE tenant_id = 'local' AND name = ?", [String(name || '')]);
  if (!r.changes) throw bad('No such secret.', 404);
  return { removed: name };
}

/** The value, for sealed/use.js only — the one place that hands it on, sealed for one device. */
async function reveal(name) {
  const r = await db.get("SELECT name, origin, iv, data FROM sealed_secrets WHERE tenant_id = 'local' AND name = ?", [String(name || '').toLowerCase()]);
  if (!r) return null;
  return { label: r.name, origin: r.origin || null, value: decrypt(r.name, r) };
}

/** A use, recorded: never a value. */
async function record({ secret, device, target, uses, by, sessionId, outcome }) {
  await db.run("INSERT INTO sealed_uses (tenant_id, at, secret, device_id, device_name, target, uses, by_user, session_id, outcome) VALUES ('local', ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [new Date().toISOString(), String(secret).slice(0, 80), device?.id || null, device?.name || null, String(target || '').slice(0, 200), uses || null,
      by || null, sessionId || null, String(outcome || '').slice(0, 300)]);
}

async function uses({ limit = 30 } = {}) {
  return (await db.all("SELECT at, secret, device_id, device_name, target, uses, by_user, outcome FROM sealed_uses WHERE tenant_id = 'local' ORDER BY id DESC LIMIT ?",
    [Math.min(200, Math.max(1, Number(limit) || 30))]))
    .map(r => ({ at: r.at, secret: r.secret, deviceId: r.device_id, device: r.device_name, target: r.target, uses: r.uses, by: r.by_user, outcome: r.outcome }));
}

module.exports = { list, namesSync, save, remove, reveal, record, uses, keysDir, NAME };

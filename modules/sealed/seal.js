'use strict';

/**
 * Each device's seal key (TODO P1.3): 32 random bytes the hub mints for one paired device the first time that device
 * asks (`GET /api/v1/mcp/self/seal`, its own token, scope `mcp:self`), kept in DATA_DIR/keys/device-seals.json (0600,
 * the protected keys folder). A secret leaves the hub only sealed with it — AES-256-GCM over a small JSON (the value,
 * how to use it, how many uses, how long, when, a nonce), bound to the device's id as additional data — and goes to
 * the device's hidden `secret_fill` tool, which no `tools/list` offers. So the call carries ciphertext only, a device
 * cannot open another device's, and nothing that is not the hub can ask a device's hidden tool to type anything: an
 * agent never holds a seal key (the keys folder is refused to its file tools), and the hub's own MCP calls are the
 * only ones that carry a sealed payload. PROTOCOL.md §22.3 is the device's side.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const file = () => path.join(require('./vault').keysDir(), 'device-seals.json');
const all = () => { try { return JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { return {}; } };
function write(d) {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(d, null, 2), { mode: 0o600 });
  try { fs.chmodSync(file(), 0o600); } catch { /* Windows */ }
}

/** The device's seal key (base64), made the first time it asks. */
function mint(deviceId) {
  const d = all();
  if (!d[deviceId]) { d[deviceId] = { key: crypto.randomBytes(32).toString('base64'), at: new Date().toISOString() }; write(d); }
  return d[deviceId].key;
}

/** Whether a device has taken its key (an older client has not, and cannot open a sealed secret). */
const has = deviceId => !!all()[deviceId];

const AAD = deviceId => Buffer.from(`doca-seal:${deviceId}`);

/** A payload sealed for one device: { v, iv, data } — data is ciphertext then the 16-byte tag, as WebCrypto writes it. */
function seal(deviceId, payload) {
  const k = all()[deviceId]?.key;
  if (!k) throw Object.assign(new Error('no seal key'), { status: 409 });
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', Buffer.from(k, 'base64'), iv);
  c.setAAD(AAD(deviceId));
  const body = { ...payload, device: deviceId, iat: Date.now(), nonce: crypto.randomBytes(12).toString('hex') };
  const data = Buffer.concat([c.update(JSON.stringify(body), 'utf8'), c.final(), c.getAuthTag()]);
  return { v: 1, iv: iv.toString('base64'), data: data.toString('base64') };
}

module.exports = { mint, has, seal, AAD };

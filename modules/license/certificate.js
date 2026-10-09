'use strict';

/**
 * Reading a Keygen licence file (https://keygen.sh/docs/api/cryptography/): a PEM-like block
 *
 *   -----BEGIN LICENSE FILE-----   (or MACHINE FILE: one bound to a machine's fingerprint)
 *   base64 of {"enc": …, "sig": …, "alg": …}
 *   -----END LICENSE FILE-----
 *
 * `sig` is an Ed25519 signature of `license/<enc>` (`machine/<enc>`), verified against the vendor keys (keys.js).
 * `alg` is `base64+ed25519` (enc is the payload, base64) or `aes-256-gcm+ed25519` (enc is ciphertext.iv.tag, each
 * base64, under sha256(licence key) — or sha256(licence key + fingerprint) for a machine file). Other algorithms
 * Keygen offers (RSA, ECDSA) are refused by name: DOCA's licences are signed with Ed25519.
 *
 * The payload is Keygen's JSON:API document: {meta: {issued, expiry, ttl}, data: the licence or machine, included}.
 */
const crypto = require('crypto');

const ED25519_SPKI = Buffer.from('302a300506032b6570032100', 'hex');   // the DER prefix of a raw 32-byte Ed25519 key

function fail(code, error) { return Object.assign(new Error(error), { code }); }

/** The block's kind and its three fields; throws on anything that is not one. */
function parse(text) {
  const m = /-----BEGIN (LICENSE|MACHINE) FILE-----([\s\S]*?)-----END \1 FILE-----/.exec(String(text || ''));
  if (!m) throw fail('not_a_licence', 'This is not a licence file: it should start with -----BEGIN LICENSE FILE----- or -----BEGIN MACHINE FILE-----.');
  let doc;
  try { doc = JSON.parse(Buffer.from(m[2].replace(/\s+/g, ''), 'base64').toString('utf8')); }
  catch { throw fail('not_a_licence', 'The licence file is damaged: its contents are not readable.'); }
  if (typeof doc?.enc !== 'string' || typeof doc?.sig !== 'string' || typeof doc?.alg !== 'string') throw fail('not_a_licence', 'The licence file is damaged: it lacks its contents, signature or algorithm.');
  return { kind: m[1] === 'MACHINE' ? 'machine' : 'license', ...doc };
}

const publicKey = hex => crypto.createPublicKey({ key: Buffer.concat([ED25519_SPKI, Buffer.from(hex, 'hex')]), format: 'der', type: 'spki' });

/** Which vendor key signed it, or null. */
function signer(cert, keys) {
  const [, sigAlg] = cert.alg.split('+');
  if (sigAlg !== 'ed25519') throw fail('algorithm', `This licence is signed with ${sigAlg}; DOCA accepts Ed25519 licences only.`);
  const data = Buffer.from(`${cert.kind}/${cert.enc}`);
  const sig = Buffer.from(cert.sig, 'base64');
  for (const k of keys) {
    try { if (/^[0-9a-f]{64}$/i.test(k.hex) && crypto.verify(null, data, publicKey(k.hex), sig)) return k; } catch { /* a malformed key: the next */ }
  }
  return null;
}

/** The payload as JSON, decrypting it when it is encrypted. */
function open(cert, { key = '', fingerprint = '' } = {}) {
  const [encAlg] = cert.alg.split('+');
  let plain;
  if (encAlg === 'base64') plain = Buffer.from(cert.enc, 'base64').toString('utf8');
  else if (encAlg === 'aes-256-gcm') {
    if (!key) throw fail('needs_key', 'This licence file is encrypted: enter its licence key too.');
    const [ct, iv, tag] = cert.enc.split('.').map(p => Buffer.from(p, 'base64'));
    const secret = crypto.createHash('sha256').update(cert.kind === 'machine' ? key + fingerprint : key).digest();
    try {
      const d = crypto.createDecipheriv('aes-256-gcm', secret, iv);
      d.setAuthTag(tag);
      plain = Buffer.concat([d.update(ct), d.final()]).toString('utf8');
    } catch { throw fail('wrong_key', cert.kind === 'machine' ? 'This licence file does not open with this key on this machine.' : 'This licence file does not open with this key.'); }
  } else throw fail('algorithm', `This licence file is encoded as ${encAlg}, which DOCA does not read.`);
  try { return JSON.parse(plain); } catch { throw fail('not_a_licence', 'The licence file is damaged: its payload is not JSON.'); }
}

/**
 * Verify and open: { kind, keyId, payload } — throws with a `code` saying what is wrong. Expiry, binding and the
 * clock are judged by the caller (read.js), which needs the payload to say so.
 */
function read(text, keys, opts) {
  const cert = parse(text);
  const k = signer(cert, keys);
  if (!k) throw fail('signature', keys.length ? 'This licence is not signed by the product\'s licence server, or it was changed after signing.' : 'This build trusts no licence server yet, so no licence can be checked.');
  return { kind: cert.kind, alg: cert.alg, keyId: k.id || null, payload: open(cert, opts) };
}

/** Make a certificate (tests and the licence server's tooling sign their own with a private key they hold). */
function sign(payload, privateKey, { kind = 'license', key = '', fingerprint = '' } = {}) {
  let enc, alg;
  const json = JSON.stringify(payload);
  if (key) {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', crypto.createHash('sha256').update(kind === 'machine' ? key + fingerprint : key).digest(), iv);
    const ct = Buffer.concat([c.update(json), c.final()]);
    enc = [ct, iv, c.getAuthTag()].map(b => b.toString('base64')).join('.');
    alg = 'aes-256-gcm+ed25519';
  } else { enc = Buffer.from(json).toString('base64'); alg = 'base64+ed25519'; }
  const sig = crypto.sign(null, Buffer.from(`${kind}/${enc}`), privateKey).toString('base64');
  const body = Buffer.from(JSON.stringify({ enc, sig, alg })).toString('base64').replace(/.{1,80}/g, '$&\n');
  const word = kind === 'machine' ? 'MACHINE' : 'LICENSE';
  return `-----BEGIN ${word} FILE-----\n${body}-----END ${word} FILE-----\n`;
}

module.exports = { parse, signer, open, read, sign, publicKey };

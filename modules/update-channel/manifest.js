'use strict';

/**
 * A release's manifest: what the update channel offers, signed by the project's release key (keys.js).
 *
 *   { product: 'doca', version: 'X.Y.Z', channel: 'stable', file: 'doca-X.Y.Z.zip', sha256, size,
 *     dataFormat, urgent: false, applyBy: null | ISO date, notes: '…', image: null | 'repo/name:tag', imageDigest }
 *
 * The signature is Ed25519 over the manifest's canonical JSON (keys sorted, no spaces), so a manifest travels as
 * text in the licence server's release metadata and is checked here byte for byte; `urgent` and `applyBy` are signed
 * with the rest, so nobody between can make an update urgent. The zip's sha256 ties the code to it.
 */
const crypto = require('crypto');

const SPKI = Buffer.from('302a300506032b6570032100', 'hex');
const SEMVER = /^\d+\.\d+\.\d+$/;

/** The text that is signed: keys sorted at every level, no whitespace. */
function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}

const fail = (code, why) => Object.assign(new Error(why), { code });

/** The manifest's own shape, or throws saying what is wrong. */
function check(m) {
  if (!m || typeof m !== 'object') throw fail('manifest', 'The release has no manifest.');
  if (m.product !== 'doca') throw fail('manifest', 'The release is not for this product.');
  if (!SEMVER.test(String(m.version || ''))) throw fail('manifest', `The release's version "${m.version}" is not X.Y.Z.`);
  if (!/^[0-9a-f]{64}$/.test(String(m.sha256 || ''))) throw fail('manifest', 'The release names no sha256 for its code.');
  if (m.applyBy && !Number.isFinite(Date.parse(m.applyBy))) throw fail('manifest', 'The release\'s applyBy is not a date.');
  return m;
}

/** {manifest, keyId} when `signature` (base64) is one of `keys` over the manifest; throws otherwise. */
function verify(manifest, signature, keys) {
  check(manifest);
  if (!keys.length) throw fail('no_keys', 'This build trusts no release key yet, so no update can be checked. A release that names one brings it.');
  const data = Buffer.from(canonical(manifest));
  const sig = Buffer.from(String(signature || ''), 'base64');
  for (const k of keys) {
    try {
      if (/^[0-9a-f]{64}$/i.test(k.hex) && crypto.verify(null, data, crypto.createPublicKey({ key: Buffer.concat([SPKI, Buffer.from(k.hex, 'hex')]), format: 'der', type: 'spki' }), sig))
        return { manifest, keyId: k.id || null };
    } catch { /* a malformed key: the next */ }
  }
  throw fail('signature', 'The release is not signed by the project\'s release key, or it was changed after signing.');
}

/** Sign (doca-licensing's publish script, and tests, with a private key they hold). */
function sign(manifest, privateKey) {
  return crypto.sign(null, Buffer.from(canonical(check(manifest))), privateKey).toString('base64');
}

const cmp = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };

module.exports = { canonical, check, verify, sign, cmp, SEMVER };

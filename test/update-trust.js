'use strict';

/**
 * Tests sign their own releases for the update channel (modules/update-channel; docs/design/production.md): this file
 * trusts a test release key whose private half is in test/fixtures/update, as test/licence-trust.js does for licences.
 * Nothing in modules/ trusts it: only a process that loads this file does.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const keys = require('../modules/update-channel/keys');
const manifest = require('../modules/update-channel/manifest');

const priv = crypto.createPrivateKey(fs.readFileSync(path.join(__dirname, 'fixtures', 'update', 'test-release-key.pem')));
const hex = crypto.createPublicKey(priv).export({ format: 'der', type: 'spki' }).subarray(12).toString('hex');
if (!keys.RELEASE_KEYS.some(k => k.id === 'test-release')) keys.RELEASE_KEYS.push({ id: 'test-release', hex, note: 'test only (test/update-trust.js)' });

/** A release's zip: a minimal DOCA of `version` (package.json, server.js, a lock) plus `files`. */
function zip(version, files = {}) {
  return require('../modules/packs/zip').write([
    { name: 'package.json', data: JSON.stringify({ name: 'openclaw-dashboard', version, docaDataFormat: 1 }) },
    { name: 'package-lock.json', data: JSON.stringify({ name: 'openclaw-dashboard', version, lockfileVersion: 3, packages: { '': { version } } }) },
    { name: 'server.js', data: `// DOCA ${version}\n` },
    ...Object.entries(files).map(([name, data]) => ({ name, data })),
  ]);
}

/** A signed release as the licence server keeps it: manifest + signature in the metadata, and its zip. */
function release(version, { urgent = false, applyBy = null, notes = `What ${version} changes.`, key = priv, tamper = false, image = null } = {}) {
  const buf = zip(version);
  const m = { product: 'doca', version, channel: 'stable', file: `doca-${version}.zip`, sha256: crypto.createHash('sha256').update(buf).digest('hex'),
    size: buf.length, dataFormat: 1, urgent, applyBy, notes, image, imageDigest: null };
  const signature = manifest.sign(m, key);
  const shown = tamper ? { ...m, urgent: !urgent } : m;
  return { version, buf, manifest: shown, signature };
}

/**
 * An update file (modules/update-channel/update-file.js) at `out`: a signed release of `version`, with `image` (bytes
 * standing in for a `docker save` tarball, its sha256 signed) when given. `key` signs it; `tamper` changes the zip after.
 */
function file(out, version, { key = priv, image = null, imageTag = `doca-hive:${version}`, tamper = false } = {}) {
  const buf = zip(version);
  const m = { product: 'doca', version, channel: 'stable', file: `doca-${version}.zip`, sha256: crypto.createHash('sha256').update(buf).digest('hex'),
    size: buf.length, dataFormat: 1, urgent: false, applyBy: null, notes: `What ${version} changes.`, image: image ? imageTag : null, imageDigest: null,
    ...(image ? { imageSha256: crypto.createHash('sha256').update(image).digest('hex') } : {}) };
  const signature = manifest.sign(m, key);
  const z = tamper ? Buffer.concat([buf.subarray(0, buf.length - 1), Buffer.from([buf[buf.length - 1] ^ 1])]) : buf;
  return require('../modules/update-channel/update-file').write(out, { manifest: m, signature, zip: z, image });
}

module.exports = { priv, hex, zip, release, file, other: () => crypto.generateKeyPairSync('ed25519').privateKey };

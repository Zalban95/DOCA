'use strict';

/**
 * Tests sign their own licences (docs/design/licence.md, "Development and CI"). This file — loaded by test/helpers.js,
 * and by every node process a test starts (helpers puts it in NODE_OPTIONS) — trusts a test vendor key whose private
 * half is in test/fixtures/licence, and preloads a licence granting `all` for any machine, so the suite runs every
 * feature. Nothing in modules/ trusts this key or reads an environment variable to: only a process that loads this
 * file does, which is a patched product by definition. DOCA_TEST_NO_LICENCE=1 leaves the preloaded licence out (a
 * test of an unlicensed hive in a child process).
 *
 * It must load nothing that reads the settings' places (modules/paths.js): test/helpers.js refuses to run after that.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const keys = require('../modules/license/keys');
const cert = require('../modules/license/certificate');

const keyAt = name => crypto.createPrivateKey(fs.readFileSync(path.join(__dirname, 'fixtures', 'licence', name)));
const rawHex = priv => crypto.createPublicKey(priv).export({ format: 'der', type: 'spki' }).subarray(12).toString('hex');

const vendor = keyAt('test-vendor-key.pem');
const rotated = keyAt('test-rotated-key.pem');
if (!keys.VENDOR_KEYS.some(k => k.id === 'test')) keys.VENDOR_KEYS.push({ id: 'test', hex: rawHex(vendor), note: 'test only (test/licence-trust.js)' });

/** A Keygen-shaped payload: a licence (or a machine file when `machine` is a fingerprint) with entitlements. */
function payload({ codes = ['all'], machine = null, anyMachine = !machine, expiry = null, fileExpiry = null, issued = new Date().toISOString(),
  status = 'ACTIVE', checkInDays = null, customer = 'Test hive', edition = 'test', seats = null, maxDevices = null, maxGraceDays } = {}) {
  const licence = { id: 'lic-test', type: 'licenses', attributes: { name: customer, status, expiry, maxUsers: null,
    metadata: { customer, edition, anyMachine, ...(checkInDays ? { checkInDays } : {}), ...(seats ? { seats } : {}), ...(maxDevices ? { maxDevices } : {}), ...(maxGraceDays !== undefined ? { maxGraceDays } : {}) } } };
  const ents = codes.map((code, i) => ({ id: `ent-${i}`, type: 'entitlements', attributes: { code } }));
  const meta = { issued, expiry: fileExpiry, ttl: null };
  return machine
    ? { meta, data: { id: 'mach-test', type: 'machines', attributes: { fingerprint: machine } }, included: [licence, ...ents] }
    : { meta, data: licence, included: ents };
}

/** A signed licence file; `with: 'rotated'` signs with a key nobody trusts until a test adds it. */
function sign(opts = {}, { key = '', fingerprint = '', with: signer = 'vendor' } = {}) {
  return cert.sign(payload(opts), signer === 'rotated' ? rotated : vendor, { kind: opts.machine ? 'machine' : 'license', key, fingerprint });
}

if (process.env.DOCA_TEST_NO_LICENCE !== '1' && !keys.preloaded.certificate) keys.preloaded.certificate = sign({ codes: ['all'] });

module.exports = { sign, payload, rawHex, vendor, rotated, preloadedFull: keys.preloaded.certificate };

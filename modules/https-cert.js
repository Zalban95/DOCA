'use strict';

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { CERTS_DIR } = require('./paths');

const KEY_PATH  = path.join(CERTS_DIR, 'key.pem');
const CERT_PATH = path.join(CERTS_DIR, 'cert.pem');
const TS_MARKER = path.join(CERTS_DIR, '.tailscale');

let _tsFqdn = null;

function getTailscaleFqdn() {
  if (_tsFqdn !== null) return _tsFqdn;
  try {
    const raw = execSync('tailscale status --json', { timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] });
    const status = JSON.parse(raw.toString());
    const dns = status.Self?.DNSName || '';
    _tsFqdn = dns.replace(/\.$/, '') || false;
  } catch {
    _tsFqdn = false;
  }
  return _tsFqdn;
}

function provisionTailscaleCert(fqdn) {
  fs.mkdirSync(CERTS_DIR, { recursive: true });
  execSync(
    `tailscale cert --cert-file "${CERT_PATH}" --key-file "${KEY_PATH}" "${fqdn}"`,
    { timeout: 30000, stdio: 'pipe' }
  );
  fs.writeFileSync(TS_MARKER, fqdn, 'utf8');
  console.log(`[HTTPS] Provisioned Tailscale cert for ${fqdn}`);
}

async function ensureCerts() {
  const fqdn = getTailscaleFqdn();

  if (fqdn) {
    const needsRefresh = !fs.existsSync(CERT_PATH) || !fs.existsSync(KEY_PATH)
      || !fs.existsSync(TS_MARKER) || fs.readFileSync(TS_MARKER, 'utf8').trim() !== fqdn;

    if (needsRefresh) {
      try {
        provisionTailscaleCert(fqdn);
      } catch (e) {
        console.warn(`[HTTPS] Tailscale cert failed (${e.message}), trying self-signed`);
        return generateSelfSigned();
      }
    }
    return {
      key: fs.readFileSync(KEY_PATH),
      cert: fs.readFileSync(CERT_PATH),
      tailscale: fqdn,
    };
  }

  if (fs.existsSync(KEY_PATH) && fs.existsSync(CERT_PATH)) {
    const isTailscale = fs.existsSync(TS_MARKER);
    return {
      key: fs.readFileSync(KEY_PATH),
      cert: fs.readFileSync(CERT_PATH),
      tailscale: isTailscale ? fs.readFileSync(TS_MARKER, 'utf8').trim() : null,
    };
  }

  return generateSelfSigned();
}

async function generateSelfSigned() {
  const selfsigned = require('selfsigned');
  const attrs = [{ name: 'commonName', value: 'OpenClaw Dashboard' }];
  const opts  = {
    keySize: 2048,
    days: 3650,
    algorithm: 'sha256',
    extensions: [
      { name: 'subjectAltName', altNames: [
        { type: 2, value: 'localhost' },
        { type: 7, ip: '127.0.0.1' },
        { type: 7, ip: '0.0.0.0' },
      ]},
    ],
  };

  const pems = await selfsigned.generate(attrs, opts);

  fs.mkdirSync(CERTS_DIR, { recursive: true });
  fs.writeFileSync(KEY_PATH,  pems.private, { mode: 0o600 });
  fs.writeFileSync(CERT_PATH, pems.cert,    { mode: 0o644 });
  if (fs.existsSync(TS_MARKER)) fs.unlinkSync(TS_MARKER);
  console.log(`[HTTPS] Generated self-signed certificate in ${CERTS_DIR}`);

  return { key: pems.private, cert: pems.cert, tailscale: null };
}

module.exports = { ensureCerts };

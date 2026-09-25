'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { X509Certificate } = require('crypto');
const { execSync } = require('child_process');
const { CERTS_DIR } = require('./paths');
const branding = require('./branding');

/** Renew this many days before expiry. Tailscale hands out Let's Encrypt certs,
 *  which live ~90 days, so a cert provisioned once and never revisited stops
 *  validating a quarter later. */
const RENEW_BEFORE_DAYS = 21;

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

/** Days until the certificate on disk expires; null if it cannot be read.
 *  Negative means it has already expired. */
function certDaysLeft() {
  try {
    const cert = new X509Certificate(fs.readFileSync(CERT_PATH));
    return (new Date(cert.validTo).getTime() - Date.now()) / 86400000;
  } catch {
    return null;
  }
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
    const haveFiles = fs.existsSync(CERT_PATH) && fs.existsSync(KEY_PATH);
    const markerOk  = fs.existsSync(TS_MARKER)
      && fs.readFileSync(TS_MARKER, 'utf8').trim() === fqdn;
    const daysLeft  = haveFiles && markerOk ? certDaysLeft() : null;

    // `tailscale cert` is idempotent and cheap when nothing needs renewing.
    const needsRefresh = !haveFiles || !markerOk
      || daysLeft === null || daysLeft < RENEW_BEFORE_DAYS;

    if (needsRefresh) {
      try {
        provisionTailscaleCert(fqdn);
      } catch (e) {
        // A failed renewal must not throw away a certificate that still works.
        if (haveFiles && daysLeft !== null && daysLeft > 0) {
          console.warn(`[HTTPS] Tailscale cert renewal failed (${e.message}); serving the existing certificate, which expires in ${Math.floor(daysLeft)} day(s).`);
        } else {
          console.warn(`[HTTPS] Tailscale cert failed (${e.message}), trying self-signed`);
          return generateSelfSigned(fqdn);
        }
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
    const daysLeft = certDaysLeft();
    const expiredBy = daysLeft === null ? null : Math.abs(Math.floor(daysLeft));

    if (daysLeft !== null && daysLeft < 0) {
      if (!isTailscale) {
        console.warn(`[HTTPS] Self-signed certificate expired ${expiredBy} day(s) ago — regenerating.`);
        return generateSelfSigned(fqdn);
      }
      // A Tailscale cert we cannot reissue, because Tailscale is not answering.
      console.warn(`[HTTPS] The Tailscale certificate expired ${expiredBy} day(s) ago and Tailscale is unreachable, so it cannot be reissued. Clients will reject this certificate — reconnect Tailscale, or delete ${CERTS_DIR} to fall back to a self-signed certificate.`);
    }

    return {
      key: fs.readFileSync(KEY_PATH),
      cert: fs.readFileSync(CERT_PATH),
      tailscale: isTailscale ? fs.readFileSync(TS_MARKER, 'utf8').trim() : null,
    };
  }

  return generateSelfSigned(fqdn);
}

async function generateSelfSigned(fqdn) {
  const selfsigned = require('selfsigned');
  const host  = os.hostname();
  const attrs = [{ name: 'commonName', value: fqdn || host || branding.name('panel') }];

  // Name every address the panel is actually reached on. With only localhost in
  // here, hostname verification fails for any LAN or tailnet client, so an app
  // that pins the certificate still cannot complete a handshake.
  const altNames = [
    { type: 2, value: 'localhost' },
    { type: 7, ip: '127.0.0.1' },
    { type: 7, ip: '0.0.0.0' },
  ];
  for (const dns of [fqdn, host, host && `${host}.local`]) {
    if (dns && !altNames.some(a => a.value === dns)) altNames.push({ type: 2, value: dns });
  }
  for (const iface of Object.values(os.networkInterfaces()).flat()) {
    if (iface && !iface.internal && iface.family === 'IPv4'
        && !altNames.some(a => a.ip === iface.address)) {
      altNames.push({ type: 7, ip: iface.address });
    }
  }

  const opts  = {
    keySize: 2048,
    // selfsigned v5 wants a date here; its `days` option is silently ignored,
    // which is how these quietly became 365-day certs instead of 10-year ones.
    notAfterDate: new Date(Date.now() + 3650 * 86400000),
    algorithm: 'sha256',
    extensions: [{ name: 'subjectAltName', altNames }],
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

'use strict';

const fs   = require('fs');
const path = require('path');
const { CERTS_DIR } = require('./paths');

const KEY_PATH  = path.join(CERTS_DIR, 'key.pem');
const CERT_PATH = path.join(CERTS_DIR, 'cert.pem');

async function ensureCerts() {
  if (fs.existsSync(KEY_PATH) && fs.existsSync(CERT_PATH)) {
    return { key: fs.readFileSync(KEY_PATH), cert: fs.readFileSync(CERT_PATH) };
  }

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
  console.log(`[HTTPS] Generated self-signed certificate in ${CERTS_DIR}`);

  return { key: pems.private, cert: pems.cert };
}

module.exports = { ensureCerts };

'use strict';

/**
 * The hub's release channel for its own clients (TODO H6.5): `doca-client` is in this repository (clients/node), so
 * the hub a client is paired with serves the copy that matches its own version — `GET /clients/node` lists each file
 * with its sha256, `GET /clients/node/:file` is the file. The client compares and replaces what changed
 * (`doca-client update`), over the connection whose certificate it pinned at pairing, so an update comes only from
 * its own hub. Any paired device's token; the files are the same for every one.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = path.join(__dirname, '..', '..', 'clients', 'node');
const FILES = ['doca-client.js', 'families.js', 'discover.js', 'boot.js', 'README.md'];

function manifest() {
  return { client: 'doca-client', version: require('../../package.json').version,
    files: FILES.filter(f => fs.existsSync(path.join(DIR, f))).map(f => {
      const b = fs.readFileSync(path.join(DIR, f));
      return { name: f, bytes: b.length, sha256: crypto.createHash('sha256').update(b).digest('hex') };
    }) };
}

function mount(router) {
  router.get('/clients/node', (_req, res) => res.json(manifest()));
  router.get('/clients/node/:file', (req, res) => {
    if (!FILES.includes(req.params.file)) return res.status(404).json({ error: { code: 'not_found', message: `No client file ${req.params.file}.` } });
    res.type(req.params.file.endsWith('.md') ? 'text/markdown' : 'application/javascript').send(fs.readFileSync(path.join(DIR, req.params.file)));
  });
}

module.exports = { mount, manifest, FILES };

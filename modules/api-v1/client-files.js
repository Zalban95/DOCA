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
const FILES = ['doca-client.js', 'families.js', 'sealed.js', 'discover.js', 'boot.js', 'update.js', 'socket.js', 'ws-lite.js', 'home.js', 'home-shared.js', 'nearby.js', 'cast.js', 'README.md'];
// The hub's own nearby readers, unchanged, in a folder beside the client (clients/node/nearby.js). Listed only to an
// updater that makes folders (`?dirs=1`, update.js since 3.60.0): an older one would fail writing into one.
const NEARBY_DIR = path.join(__dirname, '..', 'nearby');
const CAST_DIR = path.join(__dirname, '..', 'cast', 'castv2');   // the hub's Cast sender, for the client's cast family (clients/node/cast.js)
const SUB = Object.fromEntries([...require('../../clients/node/nearby').SHIPPED.map(f => [`nearby/${f}`, path.join(NEARBY_DIR, f)]),
  ...require('../../clients/node/cast').SHIPPED.map(f => [`castv2/${f}`, path.join(CAST_DIR, f)])]);
const fileOf = name => (FILES.includes(name) ? path.join(DIR, name) : SUB[name] || null);

function manifest({ dirs = false } = {}) {
  const names = [...FILES, ...(dirs ? Object.keys(SUB) : [])];
  return { client: 'doca-client', version: require('../../package.json').version,
    files: names.filter(f => fs.existsSync(fileOf(f))).map(f => {
      const b = fs.readFileSync(fileOf(f));
      return { name: f, bytes: b.length, sha256: crypto.createHash('sha256').update(b).digest('hex') };
    }) };
}

/** The browser extension (clients/browser, TODO H5.5) as a zip, to load unpacked in Chromium or as a Firefox add-on. */
const BROWSER_DIR = path.join(__dirname, '..', '..', 'clients', 'browser');
function browserZip() {
  const files = fs.readdirSync(BROWSER_DIR).filter(f => /\.(js|json|html|md|png)$/.test(f)).sort()
    .map(f => ({ name: `doca-browser/${f}`, data: fs.readFileSync(path.join(BROWSER_DIR, f)) }));
  return require('../packs/zip').write(files);
}
const sendZip = (_req, res) => res.type('application/zip').attachment(`doca-browser-${require('../../package.json').version}.zip`).send(browserZip());

/** The panel's own download link (Field → API keys, preset "extension"). */
function mountPanel(app) { app.get('/api/clients/browser.zip', sendZip); }

function mount(router) {
  router.get('/clients/browser.zip', sendZip);
  router.get('/clients/node', (req, res) => res.json(manifest({ dirs: req.query.dirs === '1' })));
  const send = (name, res) => {
    const f = fileOf(name);
    if (!f) return res.status(404).json({ error: { code: 'not_found', message: `No client file ${name}.` } });
    res.type(name.endsWith('.md') ? 'text/markdown' : 'application/javascript').send(fs.readFileSync(f));
  };
  router.get('/clients/node/:file', (req, res) => send(req.params.file, res));
  router.get('/clients/node/:dir/:file', (req, res) => send(`${req.params.dir}/${req.params.file}`, res));
}

module.exports = { mount, mountPanel, browserZip, manifest, FILES };

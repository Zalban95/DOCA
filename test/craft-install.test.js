'use strict';

// Installing a suggested Craft app (modules/mcp/craft-install.js): its release for this system, checked against the
// release's SHA256SUMS.txt before it is unpacked, into the data folder; a file that does not match is refused.
// A stand-in GitHub serves a real tarball holding `<app>-cli`.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const H = require('./helpers');   // first: it points the settings at a temporary folder

let srv, tarball, sumsGood = true;
const VERSION = '9.9.9';
before(async () => {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-stage-'));
  const ci = require('../modules/mcp/craft-install');
  const name = ci.assetName('gridcraft', VERSION);
  const top = path.join(stage, `gridcraft-${VERSION}`, 'bin');
  fs.mkdirSync(top, { recursive: true });
  fs.writeFileSync(path.join(top, process.platform === 'win32' ? 'gridcraft-cli.exe' : 'gridcraft-cli'), '#!/bin/sh\necho gridcraft\n');
  tarball = path.join(stage, name);
  execFileSync('tar', [process.platform === 'win32' ? '-acf' : '-czf', tarball, '-C', stage, `gridcraft-${VERSION}`]);
  srv = http.createServer((req, res) => {
    const base = `http://127.0.0.1:${srv.address().port}`;
    if (req.url === '/repos/storytold/gridcraft/releases/latest') return res.end(JSON.stringify({ tag_name: `v${VERSION}`,
      assets: [{ name, browser_download_url: `${base}/dl/${name}` }, { name: 'SHA256SUMS.txt', browser_download_url: `${base}/dl/sums` }] }));
    if (req.url === `/dl/${name}`) return res.end(fs.readFileSync(tarball));
    if (req.url === '/dl/sums') {
      const sum = sumsGood ? crypto.createHash('sha256').update(fs.readFileSync(tarball)).digest('hex') : '0'.repeat(64);
      return res.end(`${sum}  ${name}\n`);
    }
    res.statusCode = 404; res.end();
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  process.env.DOCA_GITHUB_API = `http://127.0.0.1:${srv.address().port}`;
  await H.start();
});
after(async () => { delete process.env.DOCA_GITHUB_API; await H.stop(); srv.close(); });

test('a release that does not match its checksum is refused, and nothing is installed', async () => {
  sumsGood = false;
  const r = await H.api(null, 'POST', '/api/mcp/catalog/gridcraft/install', {});
  assert.equal(r.status, 409);
  assert.match(r.body.error, /does not match its published checksum/);
  assert.equal(require('../modules/mcp/craft-install').installedCli('gridcraft'), null);
});

test('a matching release is unpacked into the data folder and its CLI is what the catalogue runs', async () => {
  sumsGood = true;
  const r = await H.api(null, 'POST', '/api/mcp/catalog/gridcraft/install', {});
  assert.equal(r.status, 200, r.body.error);
  assert.equal(r.body.installed.version, VERSION);
  assert.ok(r.body.installed.cli.startsWith(require('../modules/mcp/craft-install').root()));
  const row = (await H.api(null, 'GET', '/api/mcp/catalog')).body.servers.find(s => s.id === 'gridcraft');
  assert.deepEqual(row.missing, []);
  assert.equal(row.command, `${r.body.installed.cli} mcp`);
  assert.equal((await H.api(null, 'POST', '/api/mcp/catalog/nothere/install', {})).status, 404);
});

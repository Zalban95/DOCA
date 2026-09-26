'use strict';

/**
 * Code intelligence (projects/lsp.js): a language server bridged to a
 * WebSocket, with stdio's Content-Length framing added and removed. Driven
 * against a fake server that speaks the protocol.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');
const http   = require('node:http');

const H        = require('./helpers');
const lsp      = require('../modules/projects/lsp');
const projects = require('../modules/projects/store');
const WebSocket = require('ws');

test.before(() => H.start());
test.after(() => H.stop());

test('framing: whole messages out of split chunks', () => {
  const got = [];
  const feed = lsp.framer(m => got.push(JSON.parse(m)));
  const buf = Buffer.concat([lsp.frame('{"id":1,"result":"héllo"}'), lsp.frame('{"method":"x"}')]);
  feed(buf.subarray(0, 7)); feed(buf.subarray(7, 30)); feed(buf.subarray(30));
  assert.deepEqual(got, [{ id: 1, result: 'héllo' }, { method: 'x' }]);
});

test('a language server bridged: initialize, then diagnostics after didOpen; the process ends with the socket', async () => {
  const fake = path.join(H.tmp, 'fake-lsp.js');
  fs.writeFileSync(fake, `#!/usr/bin/env node
const { framer, frame } = require(${JSON.stringify(require.resolve('../modules/projects/lsp'))});
process.stdin.on('data', framer(raw => {
  const m = JSON.parse(raw);
  if (m.method === 'initialize') process.stdout.write(frame(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { capabilities: { hoverProvider: true }, cwd: process.cwd() } })));
  if (m.method === 'textDocument/didOpen') process.stdout.write(frame(JSON.stringify({ jsonrpc: '2.0', method: 'textDocument/publishDiagnostics',
    params: { uri: m.params.textDocument.uri, diagnostics: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } }, message: 'fake problem', severity: 1 }] } })));
}));
`);
  fs.chmodSync(fake, 0o755);
  lsp.SERVERS.fake = { label: 'Fake', langs: ['plaintext'], bin: fake, args: [] };
  const root = fs.mkdtempSync(path.join(H.tmp, 'lsp-proj-'));
  const p = projects.create({ root, name: 'LSP' });

  const srv = http.createServer();
  srv.on('upgrade', (req, sock, head) => lsp.upgrade(req, sock, head));
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${srv.address().port}/ws/lsp?project=${p.id}&server=fake`);
    const next = () => new Promise(r => ws.once('message', d => r(JSON.parse(String(d)))));
    await new Promise(r => ws.on('open', r));
    ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }));
    const init = await next();
    assert.equal(init.result.capabilities.hoverProvider, true);
    assert.equal(fs.realpathSync(init.result.cwd), fs.realpathSync(root), 'the server runs in the project root');
    ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: { textDocument: { uri: `file://${root}/a.txt`, text: 'abc' } } }));
    const diag = await next();
    assert.equal(diag.params.diagnostics[0].message, 'fake problem');
    ws.close();

    // An unknown server, or a server that is not here, is refused.
    const bad = new WebSocket(`ws://127.0.0.1:${srv.address().port}/ws/lsp?project=${p.id}&server=nope`);
    await new Promise(r => bad.on('error', r).on('unexpected-response', r));
  } finally { delete lsp.SERVERS.fake; srv.close(); }

  const st = lsp.status().find(s => s.name === 'typescript');
  assert.equal(st.installable, true);
  const r = await H.api(null, 'GET', '/api/projects/lsp/servers');
  assert.ok(r.body.servers.some(s => s.name === 'python'));
});

test('TypeScript: the project\'s own tsserver when it has one, else ours; and never typescript@7, which has none', () => {
  const ts = lsp.SERVERS.typescript;
  assert.ok(ts.npm.includes('typescript@<7'), 'typescript@7 is the native compiler, with no tsserver.js');
  const root = fs.mkdtempSync(path.join(H.tmp, 'ts-proj-'));
  const own = path.join(root, 'node_modules', 'typescript', 'lib', 'tsserver.js');
  fs.mkdirSync(path.dirname(own), { recursive: true });
  fs.writeFileSync(own, '');
  assert.deepEqual(ts.init(root), { tsserver: { path: own } });
});
